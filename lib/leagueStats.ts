import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Zentrale Liga-Spielerstatistik-Schicht — einzige Quelle für alles, was aus
 * `match_lineups` aggregiert wird (Torjäger, Vorlagen, Scorer, Karten,
 * Einsätze/Minuten, Vereins-Kader-Seite). Jede Statistikseite muss hier
 * durchgehen statt selbst zu aggregieren.
 *
 * WICHTIGE DATENGRENZEN (siehe Phase-1+2-Analyse, hier bewusst nicht
 * verschwiegen):
 * - `match_lineups` hat KEINE Positions-Spalte. Eine Gruppierung nach
 *   Tor/Abwehr/Mittelfeld/Sturm ist für Nicht-Wildenroth-Spieler technisch
 *   nicht möglich — computeTeamRoster liefert deshalb eine flache Liste,
 *   nicht nach Position gruppiert.
 * - `player_id` ist nur für ~7% der Zeilen gesetzt (nur Spieler mit Eintrag
 *   in wildenroth_players). Für den Rest ist team_name+player_name der
 *   einzige Schlüssel — siehe player_name_aliases für die (vorsichtige)
 *   Normalisierung bekannter Tippfehler.
 * - B-Klasse/Wildenroth-II haben aktuell 0 Aufstellungszeilen — jede
 *   Funktion hier filtert standardmäßig auf match_category='kreisliga'.
 */

export const LEAGUE_STATS_SEASON_START = '2026-08-01'
export const LEAGUE_STATS_CATEGORY = 'kreisliga' as const

export type LeaguePlayerMetric = 'goals' | 'assists' | 'scorer' | 'appearances' | 'starts' | 'minutes' | 'yellow_cards' | 'red_cards'

/**
 * FuPa-Season-Snapshot-Zusatzdaten (siehe Migration `add_player_season_snapshot_and_known_roster`,
 * Import 2026-09-08). Bewusst NICHT in TeamRosterEntry gemischt — diese Felder haben KEINE
 * match_lineups-Entsprechung (kein Per-Spiel-Nachvollzug möglich) und bleiben eine rein
 * ergänzende Anzeige-Schicht, sourced aus einem einmaligen externen Snapshot, nicht laufend
 * aus eigenen Spielberichten aktualisiert.
 */
export interface PlayerSeasonSnapshot {
  mvpValue: number | null
  penaltiesScored: number | null
  penaltiesTaken: number | null
  subbedIn: number | null
  subbedOut: number | null
}

/** Lädt die Snapshot-Zusatzdaten eines Vereins, keyed nach kanonischem Spielernamen. */
export async function fetchPlayerSnapshots(supabase: SupabaseClient, teamName: string): Promise<Map<string, PlayerSeasonSnapshot>> {
  const { data } = await supabase
    .from('player_season_snapshot')
    .select('player_name, mvp_value, penalties_scored, penalties_taken, subbed_in, subbed_out')
    .eq('team_name', teamName)
  const map = new Map<string, PlayerSeasonSnapshot>()
  for (const r of data ?? []) {
    map.set(r.player_name, {
      mvpValue: r.mvp_value, penaltiesScored: r.penalties_scored, penaltiesTaken: r.penalties_taken,
      subbedIn: r.subbed_in, subbedOut: r.subbed_out,
    })
  }
  return map
}

export interface LeaguePlayerEntry {
  /** Kanonischer (normalisierter) Name, siehe player_name_aliases. */
  playerName: string
  teamName: string
  value: number
  matches: number
  /** true, wenn der Name nach einem Abkürzungsmuster ("L. Sporer") aussieht
   *  und deshalb mehreren Personen im selben Verein gehören könnte — nicht
   *  aus der Liste entfernt, aber intern gehalten (nicht mehr in der UI
   *  gerendert, siehe Modulkommentar zu #7). */
  isUncertain: boolean
}

export interface LeaguePlayerRankedEntry extends LeaguePlayerEntry {
  /** Geteilter Rang bei Gleichstand (1,2,2,4 — "competition ranking"), nicht
   *  einfach der Array-Index. */
  rank: number
}

/** Mindestminuten, ab denen ein Per-90-Wert als Ranking-Grundlage taugt —
 *  bei z.B. 9 gespielten Minuten macht "3,0 Tore/90" rechnerisch Sinn, ist
 *  aber als Vergleichswert bedeutungslos. NUR für Rankings/Auszeichnungen
 *  relevant; auf reinen Spieler-/Vereinsdetailseiten werden die Werte auch
 *  unterhalb der Schwelle angezeigt (der Nutzer sieht dort ohnehin die
 *  absoluten Minuten daneben und kann selbst einordnen). */
export const MIN_MINUTES_FOR_PER90_RANKING = 270 // = 3 volle Spiele

export interface TeamRosterEntry {
  playerName: string
  appearances: number
  starts: number
  minutes: number
  goals: number
  assists: number
  yellowCards: number
  redCards: number
  isUncertain: boolean
  /** starts / appearances, in Prozent. null ohne Einsätze. */
  starterRate: number | null
  goalsPer90: number | null
  assistsPer90: number | null
  scorerPer90: number | null
  /** Optionales Positionsfeld aus match_lineups.position (siehe Migration
   *  "add_position_to_match_lineups") — für historische Zeilen aktuell immer
   *  null, da bewusst nicht rückwirkend befüllt. Zukünftige Importe können
   *  es setzen. null, wenn keine Aufstellungszeile dieses Spielers je eine
   *  Position trug (nicht: "unbekannt", sondern "nie erfasst"). */
  position: string | null
  /** Provenienz je Feld — siehe computeEffectivePlayerSeasonStats. Nicht für
   *  die normale UI gedacht (Rule #19: technisch nachvollziehbar, nicht
   *  zwangsläufig sichtbar), aber z.B. für Debug-/Admin-Zwecke verfügbar. */
  provenance?: EffectivePlayerProvenance
}

// ---------------------------------------------------------------------------
// BFV-Overlay (Runde 4) + zentrale Effective-Stats-Schicht
//
// Ziel: EIN effektiver Saisonwert pro Spieler und Statistikfeld, gemischt aus
// verschiedenen Quellen je nach Datenabdeckung — siehe Nutzeranweisung Runde 4
// ("gemischte effektive Werte", Feldpriorität pro Statistikfeld). Diese
// Funktion ist die EINZIGE Stelle, die BFV- und Matchdaten-Zahlen mischt;
// computeTeamRoster/computeLeaguePlayerLeaderboard/computeMvpLeaderboard
// bauen alle darauf auf, damit Vereinsseite und Liga-Rankings garantiert
// dieselben Werte zeigen.
//
// "FuPa" im Sinne der Nutzeranweisung = unsere bereits erfassten
// `match_lineups`-Zeilen (bei den meisten Vereinen ursprünglich aus FuPa-
// Spielberichten transkribiert; bei TSV Altenstadt aus BFV-Spielberichten
// derselben Quelle wie das neue Bündel — dort gibt es keine FuPa-Quelle,
// siehe Punkt 17 der Anweisung, die Matchdaten übernehmen dort exakt dieselbe
// Rolle als "bereits vorhandene, granulare Quelle" gegenüber dem neuen
// BFV-Saison-Overlay). `player_bfv_snapshot` = die neue BFV-Saison-Overlay-
// Tabelle (nur Summen, keine Einzelspiel-Zuordnung — bewusst NICHT auf
// einzelne match_lineups-Zeilen verteilt, siehe Punkt 1 der Anweisung).
// ---------------------------------------------------------------------------

export type StatSource = 'bfv' | 'matchdata' | 'bfv+matchdata' | 'fupa' | 'roster' | 'none'

export interface EffectivePlayerProvenance {
  gamesSource: StatSource
  minutesSource: StatSource
  goalsSource: StatSource
  assistsSource: StatSource
  cardsSource: StatSource
  subsSource: StatSource
  positionSource: StatSource
  /** FuPa/Matchdaten melden MEHR Einsätze als BFV — bewusst NICHT reduziert
   *  (Regel 3), aber als ungeklärter Konflikt markiert, siehe Modulkommentar. */
  gamesConflict: boolean
  /** BFV deckt weniger Spiele ab als Matchdaten — Karten wurden deshalb NICHT
   *  aus BFV übernommen, sondern die vollständigeren Matchdaten behalten. */
  cardsConflictKeptMatchdata: boolean
  /** BFV-Torsumme weicht von den granularen Matchdaten ab, obwohl die
   *  Matchdaten (gleiche oder größere Abdeckung) als effektiver Wert
   *  verwendet wurden — nicht automatisch korrigiert (Regel 6). */
  goalsConflictNotApplied: boolean
}

export interface EffectivePlayerSeasonStats {
  playerName: string
  teamName: string
  games: number
  minutes: number
  starts: number
  goals: number
  assists: number
  yellowCards: number
  redCards: number
  subbedIn: number | null
  subbedOut: number | null
  position: string | null
  mvpValue: number | null
  penaltiesScored: number | null
  penaltiesTaken: number | null
  isUncertain: boolean
  provenance: EffectivePlayerProvenance
}

interface BfvRow {
  team_name: string
  player_name: string
  games: number | null
  minutes: number | null
  goals: number | null
  subbed_in: number | null
  subbed_out: number | null
  yellow_cards: number | null
  yellow_red_cards: number | null
  red_cards: number | null
}

async function fetchBfvSnapshots(supabase: SupabaseClient): Promise<BfvRow[]> {
  const { data } = await supabase
    .from('player_bfv_snapshot')
    .select('team_name, player_name, games, minutes, goals, subbed_in, subbed_out, yellow_cards, yellow_red_cards, red_cards')
  return (data ?? []) as BfvRow[]
}

async function fetchKnownRosterPositions(supabase: SupabaseClient): Promise<Map<string, string | null>> {
  const { data } = await supabase.from('known_roster_players').select('team_name, player_name, position')
  const map = new Map<string, string | null>()
  for (const r of data ?? []) map.set(`${r.team_name}::${r.player_name}`, r.position)
  return map
}

async function fetchAllPlayerSnapshots(supabase: SupabaseClient): Promise<Map<string, PlayerSeasonSnapshot>> {
  const { data } = await supabase
    .from('player_season_snapshot')
    .select('team_name, player_name, mvp_value, penalties_scored, penalties_taken, subbed_in, subbed_out')
  const map = new Map<string, PlayerSeasonSnapshot>()
  for (const r of data ?? []) {
    map.set(`${r.team_name}::${r.player_name}`, {
      mvpValue: r.mvp_value, penaltiesScored: r.penalties_scored, penaltiesTaken: r.penalties_taken,
      subbedIn: r.subbed_in, subbedOut: r.subbed_out,
    })
  }
  return map
}

type MatchdataAccum = { appearances: number; starts: number; minutes: number; goals: number; assists: number; yellowCards: number; redCards: number; position: string | null }

/** Merge-Kern pro Spieler — siehe Modulkommentar für die Feldprioritäts-
 *  Regeln. `m` = Matchdaten-Aggregat (undefined = keine Zeile), `b` = BFV-
 *  Snapshot-Zeile (undefined = keine BFV-Daten), `krPosition` = intern
 *  gepflegte Position aus known_roster_players, `snap` = FuPa-Season-
 *  Snapshot (MVP/11m/Ein-Aus). */
function mergeEffectiveStats(
  teamName: string, playerName: string,
  m: MatchdataAccum | undefined, b: BfvRow | undefined,
  krPosition: string | null | undefined, snap: PlayerSeasonSnapshot | undefined,
): EffectivePlayerSeasonStats {
  const mGames = m?.appearances ?? 0
  const bGames = b?.games ?? null

  let games: number, gamesSource: StatSource, gamesConflict = false
  if (b == null) { games = mGames; gamesSource = m ? 'matchdata' : 'none' }
  else if (m == null) { games = bGames as number; gamesSource = 'bfv' }
  else if (bGames! > mGames) { games = bGames as number; gamesSource = 'bfv' }
  else if (bGames === mGames) { games = mGames; gamesSource = 'bfv+matchdata' }
  else { games = mGames; gamesSource = 'matchdata'; gamesConflict = true } // FuPa/Matchdaten > BFV: nicht reduzieren, Konflikt melden

  let minutes: number, minutesSource: StatSource
  if (b == null) { minutes = m?.minutes ?? 0; minutesSource = m ? 'matchdata' : 'none' }
  else if (m == null) { minutes = b.minutes ?? 0; minutesSource = 'bfv' }
  else if (gamesSource === 'bfv') { minutes = b.minutes ?? 0; minutesSource = 'bfv' } // BFV deckt mehr Spiele ab — Matchdaten-Minuten unvollständig
  else { minutes = m.minutes; minutesSource = 'matchdata' } // gleiche/größere Abdeckung: FuPa/Matchdaten-Minuten bevorzugt

  let goals: number, goalsSource: StatSource, goalsConflict = false
  if (b == null) { goals = m?.goals ?? 0; goalsSource = m ? 'matchdata' : 'none' }
  else if (m == null) { goals = b.goals ?? 0; goalsSource = 'bfv' }
  else if (gamesSource === 'bfv') { goals = b.goals ?? 0; goalsSource = 'bfv' } // BFV deckt mehr Spiele ab -> vollständigerer Torwert
  else {
    goals = m.goals; goalsSource = 'matchdata'
    if ((b.goals ?? 0) !== m.goals) goalsConflict = true // Abweichung dokumentiert, nicht automatisch übernommen (Regel 6)
  }

  const assists = m?.assists ?? 0 // BFV liefert keine Assist-Daten (Regel 7)

  let yellowCards: number, redCards: number, cardsSource: StatSource, cardsConflict = false
  if (b == null) { yellowCards = m?.yellowCards ?? 0; redCards = m?.redCards ?? 0; cardsSource = m ? 'matchdata' : 'none' }
  else if (m == null) { yellowCards = b.yellow_cards ?? 0; redCards = (b.yellow_red_cards ?? 0) + (b.red_cards ?? 0); cardsSource = 'bfv' }
  else if (gamesSource === 'bfv' || gamesSource === 'bfv+matchdata') {
    // BFV deckt mind. so viele Spiele ab wie unsere Matchdaten -> offizielle Referenz
    yellowCards = b.yellow_cards ?? 0
    redCards = (b.yellow_red_cards ?? 0) + (b.red_cards ?? 0) // Gelb-Rot + Rot = Gesamt-Platzverweise, kein Doppelzählen
    cardsSource = 'bfv'
  } else {
    yellowCards = m.yellowCards; redCards = m.redCards; cardsSource = 'matchdata'; cardsConflict = true // BFV deckt weniger ab -> nicht reduzieren
  }

  let subbedIn: number | null, subbedOut: number | null, subsSource: StatSource
  const fupaHasSubs = snap && (snap.subbedIn != null || snap.subbedOut != null)
  const bfvHasSubs = b && (b.subbed_in != null || b.subbed_out != null)
  if (fupaHasSubs && gamesSource !== 'bfv') { subbedIn = snap!.subbedIn; subbedOut = snap!.subbedOut; subsSource = 'fupa' }
  else if (bfvHasSubs) { subbedIn = b!.subbed_in; subbedOut = b!.subbed_out; subsSource = 'bfv' }
  else if (fupaHasSubs) { subbedIn = snap!.subbedIn; subbedOut = snap!.subbedOut; subsSource = 'fupa' }
  else { subbedIn = null; subbedOut = null; subsSource = 'none' }

  const position = m?.position ?? krPosition ?? null
  const positionSource: StatSource = m?.position ? 'matchdata' : (krPosition ? 'roster' : 'none')

  return {
    playerName, teamName,
    games, minutes, starts: m?.starts ?? 0, goals, assists, yellowCards, redCards,
    subbedIn, subbedOut, position,
    mvpValue: snap?.mvpValue ?? null, penaltiesScored: snap?.penaltiesScored ?? null, penaltiesTaken: snap?.penaltiesTaken ?? null,
    isUncertain: looksAbbreviated(playerName),
    provenance: {
      gamesSource, minutesSource, goalsSource, assistsSource: m ? 'matchdata' : 'none', cardsSource, subsSource, positionSource,
      gamesConflict, cardsConflictKeptMatchdata: cardsConflict, goalsConflictNotApplied: goalsConflict,
    },
  }
}

/**
 * Zentrale Effective-Stats-Schicht (Runde 4) — für ALLE Vereine gleichzeitig,
 * damit sowohl die Vereinsseite als auch die ligaweiten Ranglisten garantiert
 * dieselben gemischten Werte pro Spieler verwenden (siehe Modulkommentar).
 * Intern gecached für die Dauer eines Seiten-Requests (mehrere Aufrufe
 * innerhalb derselben Page/Request sparen sich die wiederholten Fetches).
 */
async function computeEffectiveStatsAllTeams(supabase: SupabaseClient, category: string | string[] = LEAGUE_STATS_CATEGORY): Promise<Map<string, EffectivePlayerSeasonStats[]>> {
  const [lineupRows, aliasMap, bfvRows, knownRosterPositions, snapshots] = await Promise.all([
    fetchKreisligaLineups(supabase, category),
    getAliasMap(supabase),
    fetchBfvSnapshots(supabase),
    fetchKnownRosterPositions(supabase),
    fetchAllPlayerSnapshots(supabase),
  ])

  // Matchdaten-Aggregat pro Verein+Spieler (kanonisiert via Alias-Map) — exakt
  // dieselbe Aggregationslogik wie computeTeamRoster vor Runde 4.
  const matchdata = new Map<string, MatchdataAccum>()
  for (const r of lineupRows) {
    const name = resolveName(aliasMap, r.team_name, r.player_name)
    const key = `${r.team_name}::${name}`
    const e = matchdata.get(key) ?? { appearances: 0, starts: 0, minutes: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, position: null }
    if ((r.minutes_played ?? 0) > 0 || r.is_starter) e.appearances += 1
    if (r.is_starter) e.starts += 1
    e.minutes += r.minutes_played ?? 0
    e.goals += r.goals ?? 0
    e.assists += r.assists ?? 0
    e.yellowCards += r.yellow_cards ?? 0
    if (r.position != null) e.position = r.position
    if (r.red_card_minute != null) e.redCards += 1
    matchdata.set(key, e)
  }

  // BFV-Snapshot ebenfalls über dieselbe Alias-Map kanonisiert (BFV-Rohnamen
  // können von unseren bisherigen Matchdaten-Namen abweichen, siehe Migration
  // `bfv_round4_new_aliases`).
  const bfvByKey = new Map<string, BfvRow>()
  for (const r of bfvRows) {
    const name = resolveName(aliasMap, r.team_name, r.player_name)
    bfvByKey.set(`${r.team_name}::${name}`, r)
  }

  const allKeys = new Set<string>([...matchdata.keys(), ...bfvByKey.keys()])
  const byTeam = new Map<string, EffectivePlayerSeasonStats[]>()
  for (const key of allKeys) {
    const sep = key.indexOf('::')
    const teamName = key.slice(0, sep)
    const playerName = key.slice(sep + 2)
    const entry = mergeEffectiveStats(
      teamName, playerName,
      matchdata.get(key), bfvByKey.get(key),
      knownRosterPositions.get(key), snapshots.get(key),
    )
    const list = byTeam.get(teamName) ?? []
    list.push(entry)
    byTeam.set(teamName, list)
  }

  // known_roster_players kann zusätzliche 0-Spiele-Kadermitglieder enthalten,
  // die weder in match_lineups noch in player_bfv_snapshot auftauchen (z.B.
  // TSV Altenstadt "Simon Reich", Punkt 17). Nicht überschreiben, falls der
  // Spieler bereits über Matchdaten/BFV existiert.
  for (const [key, position] of knownRosterPositions) {
    if (allKeys.has(key)) continue
    const sep = key.indexOf('::')
    const teamName = key.slice(0, sep)
    const playerName = key.slice(sep + 2)
    const entry = mergeEffectiveStats(teamName, playerName, undefined, undefined, position, snapshots.get(key))
    const list = byTeam.get(teamName) ?? []
    list.push(entry)
    byTeam.set(teamName, list)
  }

  return byTeam
}

/**
 * Öffentliche Einstiegsstelle der zentralen Effective-Stats-Schicht (Runde 4)
 * für EINEN Verein — siehe Modulkommentar. Jede Statistikanzeige (Vereins-
 * seite, Liga-Ranglisten, Torjäger/Vorlagen/Scorer/MVP/Einsätze/Minuten/
 * Karten) MUSS hierüber (oder über computeTeamRoster/computeLeaguePlayer-
 * Leaderboard/computeMvpLeaderboard, die intern hierauf aufbauen) gehen —
 * keine Statistikseite darf mehr direkt aus match_lineups aggregieren.
 */
export async function computeEffectivePlayerSeasonStats(
  supabase: SupabaseClient, teamName: string, category: string | string[] = LEAGUE_STATS_CATEGORY,
): Promise<EffectivePlayerSeasonStats[]> {
  const all = await computeEffectiveStatsAllTeams(supabase, category)
  return all.get(teamName) ?? []
}

export interface TeamMatchSummary {
  played: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  cleanSheets: number
  form: ('W' | 'D' | 'L')[]
}

/** Abkürzungsmuster wie "L. Sporer" oder "T. Kessler" — necessary but not
 *  sufficient signal für "mehrdeutig", siehe Modulkommentar. */
function looksAbbreviated(name: string): boolean {
  return /^[A-ZÄÖÜ]\.\s/.test(name.trim())
}

let aliasCache: Map<string, string> | null = null

/** Lädt die manuell geprüften Tippfehler-Normalisierungen einmal pro
 *  Request-Zyklus (kein persistenter Server-Cache — Next.js erstellt für
 *  jeden Request eine neue Modul-Instanz in Serverless-Umgebungen ohnehin
 *  nicht wieder, dieser Cache spart nur wiederholte Aufrufe INNERHALB einer
 *  Seite, die mehrere League-Stats-Funktionen nacheinander aufruft). */
async function getAliasMap(supabase: SupabaseClient): Promise<Map<string, string>> {
  if (aliasCache) return aliasCache
  const { data } = await supabase.from('player_name_aliases').select('team_name, source_name, canonical_name').eq('is_ambiguous', false)
  const map = new Map<string, string>()
  for (const r of data ?? []) map.set(`${r.team_name}::${r.source_name}`, r.canonical_name)
  aliasCache = map
  return map
}

function resolveName(aliasMap: Map<string, string>, teamName: string, rawName: string): string {
  return aliasMap.get(`${teamName}::${rawName}`) ?? rawName
}

type LineupRow = {
  team_name: string
  player_name: string
  minutes_played: number | null
  goals: number | null
  assists: number | null
  is_starter: boolean | null
  yellow_cards: number | null
  red_card_minute: number | null
  match_id: number
  position: string | null
}

/** `category` defaults to the Kreisliga (the only category with real lineup
 *  data today, see Modulkommentar) — pass e.g. 'wildenroth_ii'/'b-klasse', or
 *  an array of several, for a team playing in categories other than
 *  Kreisliga once lineup data exists there. */
async function fetchKreisligaLineups(supabase: SupabaseClient, category: string | string[] = LEAGUE_STATS_CATEGORY): Promise<LineupRow[]> {
  let query = supabase
    .from('match_lineups')
    .select('team_name, player_name, minutes_played, goals, assists, is_starter, yellow_cards, red_card_minute, match_id, position, matches!inner(match_date, matchday, match_category, competition_type)')
    .gte('matches.match_date', LEAGUE_STATS_SEASON_START)
    .neq('matches.matchday', 999)
    // One-off cup fixtures (e.g. Pokal-Spezial, see CLAUDE.md) keep
    // match_category='kreisliga' for betting/display purposes but must never
    // feed real league player statistics (Torjäger/Vorlagen/Scorer/Karten/
    // Minuten) even if lineup data is later entered for one.
    .or('matches.competition_type.is.null,matches.competition_type.neq.cup')
  query = Array.isArray(category) ? query.in('matches.match_category', category) : query.eq('matches.match_category', category)
  const { data } = await query
  return (data ?? []) as LineupRow[]
}

/** Ergebnis einer Top-`limit`-Rangliste: `entries` sind höchstens `limit`
 *  einzeln anzuzeigende Zeilen (Gleichstände teilen sich einen Rang, aber
 *  die Liste selbst wird bei `limit` gedeckelt — sie läuft NICHT über, auch
 *  wenn am Cutoff mehr Spieler denselben Wert haben). `overflowCount`/
 *  `overflowValue` beschreiben die Spieler, die deshalb NICHT einzeln
 *  gezeigt werden, aber denselben Wert wie die letzte gezeigte Zeile haben
 *  — für eine kompakte "+N weitere Spieler mit Y ..."-Zeile in der UI.
 *  `overflowCount` ist 0 (und `overflowValue` null), wenn nichts wegfällt. */
export interface RankedLeaderboardResult<T> {
  entries: T[]
  overflowCount: number
  overflowValue: number | null
}

/** Gemeinsame Top-`limit`-mit-Gleichstand-Logik für alle Ligaranglisten
 *  (Torjäger/Vorlagen/Scorer/Einsätze/Minuten/Karten/MVP):
 *
 * 1. Volle absteigend sortierte Liste (bei Gleichstand alphabetisch) bilden.
 * 2. Die ersten `limit` Einträge werden einzeln angezeigt (`entries`) — mit
 *    geteiltem Rang bei Gleichstand (1,2,2,4 — "competition ranking"), NICHT
 *    dem Array-Index.
 * 3. Gibt es über diese `limit` Zeilen hinaus weitere Spieler mit demselben
 *    Wert wie die letzte gezeigte Zeile, werden diese NICHT einzeln
 *    ausgeschrieben, sondern als `overflowCount` gezählt (Wert selbst in
 *    `overflowValue`) — die aufrufende UI rendert daraus z.B.
 *    "+5 weitere Spieler mit 2 Toren". Die Berechnung selbst nutzt dafür
 *    immer den vollständigen Datensatz (keine Limit-Abfrage auf DB-Ebene),
 *    nur die DARSTELLUNG wird auf `limit` gedeckelt.
 */
function buildRankedLeaderboard<E extends { value: number }>(
  list: E[],
  limit: number,
): RankedLeaderboardResult<E & { rank: number }> {
  const displayed = list.slice(0, limit)

  let rank = 0
  let lastValue: number | null = null
  const entries = displayed.map((e, idx) => {
    if (e.value !== lastValue) {
      rank = idx + 1
      lastValue = e.value
    }
    return { ...e, rank }
  })

  const cutoffValue = entries.length > 0 ? entries[entries.length - 1].value : null
  const totalAtCutoff = cutoffValue == null ? 0 : list.filter(e => e.value === cutoffValue).length
  const shownAtCutoff = cutoffValue == null ? 0 : entries.filter(e => e.value === cutoffValue).length
  const overflowCount = totalAtCutoff - shownAtCutoff
  const overflowValue = overflowCount > 0 ? cutoffValue : null

  return { entries, overflowCount, overflowValue }
}

/**
 * Ligaweite Top-Liste für eine Kennzahl. `scorer` = Tore + Vorlagen aus den
 * tatsächlich vorhandenen Daten summiert (kein separates Feld in der DB).
 *
 * Maximal `limit` Zeilen werden einzeln zurückgegeben (siehe
 * `buildRankedLeaderboard`); weitere Spieler mit demselben Wert wie die
 * letzte gezeigte Zeile werden über `overflowCount`/`overflowValue`
 * zusammengefasst statt einzeln angehängt.
 */
export async function computeLeaguePlayerLeaderboard(
  supabase: SupabaseClient,
  metric: LeaguePlayerMetric,
  limit = 15,
): Promise<RankedLeaderboardResult<LeaguePlayerRankedEntry>> {
  const byTeam = await computeEffectiveStatsAllTeams(supabase)
  const all = [...byTeam.values()].flat()

  const valueOf = (e: EffectivePlayerSeasonStats): number => {
    switch (metric) {
      case 'goals': return e.goals
      case 'assists': return e.assists
      case 'scorer': return e.goals + e.assists
      case 'appearances': return e.games
      case 'starts': return e.starts
      case 'minutes': return e.minutes
      case 'yellow_cards': return e.yellowCards
      case 'red_cards': return e.redCards
    }
  }

  const list: LeaguePlayerEntry[] = all
    .map((e) => ({ playerName: e.playerName, teamName: e.teamName, value: valueOf(e), matches: e.games, isUncertain: e.isUncertain }))
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value || a.playerName.localeCompare(b.playerName, 'de'))

  return buildRankedLeaderboard(list, limit)
}

/**
 * Flache Spielerliste eines Vereins aus den erfassten Aufstellungen — NICHT
 * nach Position gruppiert (match_lineups.position ist bewusst nicht
 * rückwirkend befüllt, siehe Modulkommentar und `position`-Feld auf
 * TeamRosterEntry). Sortiert nach Einsatzminuten absteigend.
 *
 * `category` defaults to Kreisliga — Wildenroth-II-Seiten übergeben
 * ['wildenroth_ii', 'b-klasse'] explizit, sobald für diese Kategorien
 * Aufstellungsdaten existieren (aktuell 0 Zeilen, siehe Modulkommentar).
 */
export async function computeTeamRoster(supabase: SupabaseClient, teamName: string, category: string | string[] = LEAGUE_STATS_CATEGORY): Promise<TeamRosterEntry[]> {
  const effective = await computeEffectivePlayerSeasonStats(supabase, teamName, category)

  // Per-90-Werte und Startelfquote: nur berechnet, wenn überhaupt Minuten
  // vorliegen (sonst Division durch 0) — auf reinen Detailseiten werden sie
  // trotzdem angezeigt, auch bei kleiner Stichprobe (siehe
  // MIN_MINUTES_FOR_PER90_RANKING, das nur für Rankings gilt, nicht hier).
  const withDerived: TeamRosterEntry[] = effective.map((e) => ({
    playerName: e.playerName,
    appearances: e.games,
    starts: e.starts,
    minutes: e.minutes,
    goals: e.goals,
    assists: e.assists,
    yellowCards: e.yellowCards,
    redCards: e.redCards,
    isUncertain: e.isUncertain,
    position: e.position,
    provenance: e.provenance,
    starterRate: e.games > 0 ? Math.round((e.starts / e.games) * 100) : null,
    goalsPer90: e.minutes > 0 ? Math.round((e.goals / e.minutes) * 90 * 100) / 100 : null,
    assistsPer90: e.minutes > 0 ? Math.round((e.assists / e.minutes) * 90 * 100) / 100 : null,
    scorerPer90: e.minutes > 0 ? Math.round(((e.goals + e.assists) / e.minutes) * 90 * 100) / 100 : null,
  }))

  return withDerived.sort((a, b) => b.minutes - a.minutes || b.appearances - a.appearances || a.playerName.localeCompare(b.playerName, 'de'))
}

/** Höchste Werte eines Teams — für die "Top-Torschütze/Top-Vorlagengeber/
 *  Top-Scorer/Dauerbrenner/Kartenkönig"-Hervorhebung auf der Vereinsseite.
 *  null, wenn niemand im Kader einen Wert > 0 hat (z.B. Kartenkönig bei
 *  einem kartenlosen Team). */
export interface MvpRankedEntry {
  playerName: string
  teamName: string
  value: number
  rank: number
}

/**
 * MVP-Rangliste aus dem FuPa-Season-Snapshot (`player_season_snapshot.mvp_value`)
 * — NICHT aus match_lineups, da wir keine eigene MVP-Erhebung haben. Nutzt dieselbe
 * Gleichstand-Top-`limit`-Regel wie computeLeaguePlayerLeaderboard (Cutoff-Wert bei
 * Rang `limit`, alle Gleichstände am Cutoff bleiben, geteilter Rang 1,2,2,4...).
 * Datenbasis ist ein einmaliger Snapshot (Stand 2026-09-08, nicht laufend gepflegt)
 * und deckt nur die vier zuletzt importierten Vereine ab — daher bewusst als
 * eigenständige, klar beschriftete Zusatz-Rangliste behandelt statt als
 * vollwertiges, prominentes Liga-Ranking neben den match_lineups-Metriken.
 */
export async function computeMvpLeaderboard(supabase: SupabaseClient, limit = 15): Promise<RankedLeaderboardResult<MvpRankedEntry>> {
  const byTeam = await computeEffectiveStatsAllTeams(supabase)
  const all = [...byTeam.values()].flat()

  const list = all
    .filter(e => e.mvpValue != null && e.mvpValue > 0)
    .map(e => ({ playerName: e.playerName, teamName: e.teamName, value: e.mvpValue as number }))
    .sort((a, b) => b.value - a.value || a.playerName.localeCompare(b.playerName, 'de'))

  return buildRankedLeaderboard(list, limit)
}

/** Reihenfolge für die positionsgruppierte Kaderanzeige (Vereinsdetailseite) —
 *  NICHT für die ligaweiten Ranking-Tabs (Torjäger/Vorlagen/Scorer/MVP/
 *  Einsätze/Minuten/Karten), die weiterhin nach ihrem jeweiligen Statistikwert
 *  sortiert bleiben. */
const ROSTER_POSITION_ORDER = ['Torwart', 'Abwehr', 'Mittelfeld', 'Angriff', 'Unbekannt'] as const

export interface RosterPositionGroup {
  position: string
  players: TeamRosterEntry[]
}

/**
 * Gruppiert einen bereits von computeTeamRoster gelieferten Kader nach
 * Position (Torwart → Abwehr → Mittelfeld → Angriff → Unbekannt, siehe
 * ROSTER_POSITION_ORDER) und sortiert innerhalb jeder Gruppe nach Spiele
 * absteigend, dann Minuten absteigend, dann Name alphabetisch als stabilem
 * Tie-Breaker. `position === null` (nie erfasst) landet in "Unbekannt",
 * ebenso ein Positionswert außerhalb der bekannten vier Kategorien. Leere
 * Gruppen werden nicht zurückgegeben.
 */
export function groupRosterByPosition(roster: TeamRosterEntry[]): RosterPositionGroup[] {
  const byPosition = new Map<string, TeamRosterEntry[]>()
  for (const r of roster) {
    const key = r.position && (ROSTER_POSITION_ORDER as readonly string[]).includes(r.position) ? r.position : 'Unbekannt'
    const list = byPosition.get(key) ?? []
    list.push(r)
    byPosition.set(key, list)
  }
  return ROSTER_POSITION_ORDER
    .map((position) => ({
      position,
      players: (byPosition.get(position) ?? []).sort((a, b) =>
        b.appearances - a.appearances || b.minutes - a.minutes || a.playerName.localeCompare(b.playerName, 'de')),
    }))
    .filter((g) => g.players.length > 0)
}

export function teamRosterHighlights(roster: TeamRosterEntry[]) {
  const top = (sel: (r: TeamRosterEntry) => number) => {
    const withValue = roster.filter(r => sel(r) > 0)
    if (withValue.length === 0) return null
    return [...withValue].sort((a, b) => sel(b) - sel(a))[0]
  }
  return {
    topScorerGoals: top(r => r.goals),
    topAssister: top(r => r.assists),
    topScorer: top(r => r.goals + r.assists),
    ironMan: top(r => r.minutes),
    cardKing: top(r => r.yellowCards + r.redCards * 2),
  }
}
