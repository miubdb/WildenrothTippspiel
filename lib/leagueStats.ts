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
    .select('team_name, player_name, minutes_played, goals, assists, is_starter, yellow_cards, red_card_minute, match_id, position, matches!inner(match_date, matchday, match_category)')
    .gte('matches.match_date', LEAGUE_STATS_SEASON_START)
    .neq('matches.matchday', 999)
  query = Array.isArray(category) ? query.in('matches.match_category', category) : query.eq('matches.match_category', category)
  const { data } = await query
  return (data ?? []) as LineupRow[]
}

/**
 * Ligaweite Top-Liste für eine Kennzahl. `scorer` = Tore + Vorlagen aus den
 * tatsächlich vorhandenen Daten summiert (kein separates Feld in der DB).
 *
 * Strikte Top-`limit`-mit-Gleichstand-Regel: es wird der Wert an Rang
 * `limit` (1-indiziert) ermittelt, und JEDER Spieler mit einem Wert ≥ diesem
 * Cutoff-Wert bleibt in der Liste (alle Gleichstände am Cutoff werden
 * mitgenommen, keine willkürliche Kappung mittendrin). Wer strikt darunter
 * liegt, fällt raus. Gibt es insgesamt weniger als `limit` Spieler mit
 * Wert > 0, werden einfach alle zurückgegeben. Gleichstände teilen sich
 * einen Rang (1,2,2,4 — "competition ranking"), nicht den Array-Index.
 */
export async function computeLeaguePlayerLeaderboard(
  supabase: SupabaseClient,
  metric: LeaguePlayerMetric,
  limit = 15,
): Promise<LeaguePlayerRankedEntry[]> {
  const [rows, aliasMap] = await Promise.all([fetchKreisligaLineups(supabase), getAliasMap(supabase)])

  type Agg = { value: number; matches: Set<number> }
  const byPlayer = new Map<string, Agg>()

  for (const r of rows) {
    const name = resolveName(aliasMap, r.team_name, r.player_name)
    const key = `${r.team_name}::${name}`
    const entry = byPlayer.get(key) ?? { value: 0, matches: new Set() }
    switch (metric) {
      case 'goals': entry.value += r.goals ?? 0; break
      case 'assists': entry.value += r.assists ?? 0; break
      case 'scorer': entry.value += (r.goals ?? 0) + (r.assists ?? 0); break
      case 'appearances': if ((r.minutes_played ?? 0) > 0 || r.is_starter) entry.value += 1; break
      case 'starts': if (r.is_starter) entry.value += 1; break
      case 'minutes': entry.value += r.minutes_played ?? 0; break
      case 'yellow_cards': entry.value += r.yellow_cards ?? 0; break
      case 'red_cards': if (r.red_card_minute != null) entry.value += 1; break
    }
    entry.matches.add(r.match_id)
    byPlayer.set(key, entry)
  }

  const list: LeaguePlayerEntry[] = [...byPlayer.entries()]
    .map(([key, agg]) => {
      const sep = key.indexOf('::')
      const teamName = key.slice(0, sep)
      const playerName = key.slice(sep + 2)
      return { playerName, teamName, value: agg.value, matches: agg.matches.size, isUncertain: looksAbbreviated(playerName) }
    })
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value || a.playerName.localeCompare(b.playerName, 'de'))

  const cutoffValue = list.length <= limit ? -Infinity : list[limit - 1].value
  const included = list.filter(e => e.value >= cutoffValue)

  let rank = 0
  let lastValue: number | null = null
  return included.map((e, idx) => {
    if (e.value !== lastValue) {
      rank = idx + 1
      lastValue = e.value
    }
    return { ...e, rank }
  })
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
  const [allRows, aliasMap] = await Promise.all([fetchKreisligaLineups(supabase, category), getAliasMap(supabase)])
  const rows = allRows.filter(r => r.team_name === teamName)

  type Accum = Omit<TeamRosterEntry, 'starterRate' | 'goalsPer90' | 'assistsPer90' | 'scorerPer90'>
  const byPlayer = new Map<string, Accum>()
  for (const r of rows) {
    const name = resolveName(aliasMap, teamName, r.player_name)
    const e = byPlayer.get(name) ?? {
      playerName: name, appearances: 0, starts: 0, minutes: 0, goals: 0, assists: 0,
      yellowCards: 0, redCards: 0, isUncertain: looksAbbreviated(name), position: null,
    }
    if ((r.minutes_played ?? 0) > 0 || r.is_starter) e.appearances += 1
    if (r.is_starter) e.starts += 1
    e.minutes += r.minutes_played ?? 0
    e.goals += r.goals ?? 0
    e.assists += r.assists ?? 0
    e.yellowCards += r.yellow_cards ?? 0
    if (r.position != null) e.position = r.position
    if (r.red_card_minute != null) e.redCards += 1
    byPlayer.set(name, e)
  }

  // Per-90-Werte und Startelfquote: nur berechnet, wenn überhaupt Minuten
  // vorliegen (sonst Division durch 0) — auf reinen Detailseiten werden sie
  // trotzdem angezeigt, auch bei kleiner Stichprobe (siehe
  // MIN_MINUTES_FOR_PER90_RANKING, das nur für Rankings gilt, nicht hier).
  const withDerived: TeamRosterEntry[] = [...byPlayer.values()].map((e) => ({
    ...e,
    starterRate: e.appearances > 0 ? Math.round((e.starts / e.appearances) * 100) : null,
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
