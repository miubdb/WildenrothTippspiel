import type { SupabaseClient } from '@supabase/supabase-js'
import { cappedPayout } from './payout'

/**
 * Single source of truth for spielerbezogene Wett-Statistiken. Profil,
 * fremdes Spielerprofil, Rangliste und jede künftige Vergleichsansicht
 * müssen hier durchgehen statt die Aggregation lokal neu zu bauen — genau
 * das Auseinanderdriften (Lieblingsmarkt, Kombi-Anteil, Guthaben-Verlauf),
 * das diese Datei behebt, ist vorher entstanden, weil `profil/page.tsx` und
 * `spieler/[id]/page.tsx` dieselbe Rechnung zweimal, leicht unterschiedlich,
 * neu geschrieben haben.
 *
 * Bewusst NICHT hier drin: alles, was mit Quoten-/Odds-Berechnung
 * (lib/odds.ts), Settlement (app/api/admin/settle, .../goalscorers/scorers)
 * oder Risky-Klassifizierung (lib/risky.ts) zu tun hat — diese Datei liest
 * nur bereits abgerechnete/gespeicherte Werte, sie rechnet nichts davon neu.
 */

export const STATS_CURRENT_SEASON = '26/27'
export const STATS_PREV_SEASON = '25/26'
// Test-Spieltag 999 bekommt `season = 'TEST'` auf seinen Wetten. Zählt
// nirgends als echte Statistik, exakt wie Rangliste/Awards es schon immer
// handhaben (siehe lib/awards.ts, leaderboard/page.tsx). `profil/page.tsx`
// hat TEST bisher fälschlich in die aktuelle Saison gemischt — behoben,
// indem computeUserBetStats/computeBalanceHistory nur exakt `season`
// matchen (der Aufrufer übergibt nie 'TEST'), TEST-Zeilen fallen also
// automatisch heraus, ohne einen eigenen Filter-Ast zu brauchen.

export const MARKET_LABELS: Record<string, string> = {
  '1x2': '1X2',
  double_chance: 'Doppelte Chance',
  over_under: 'Ü/U 2,5',
  over_under_3_5: 'Ü/U 3,5',
  over_under_5_5: 'Ü/U 5,5',
  over_under_7_5: 'Ü/U 7,5',
  btts: 'Beide treffen',
  exact_score: 'Genaues Ergebnis',
  handicap: 'Handicap',
  goalscorer: 'Torschütze',
  goalscorer_2plus: 'Torschütze 2+',
  matchday_special: 'Spieltag-Special',
}

export const SELECTION_LABELS: Record<string, string> = {
  home: 'Heimsieg',
  draw: 'Unentschieden',
  away: 'Auswärtssieg',
  '1x': '1X',
  x2: 'X2',
  '12': '12',
  'over_2.5': 'Über 2,5',
  'under_2.5': 'Unter 2,5',
  'over_3.5': 'Über 3,5',
  'under_3.5': 'Unter 3,5',
  'over_5.5': 'Über 5,5',
  'under_5.5': 'Unter 5,5',
  'over_7.5': 'Über 7,5',
  'under_7.5': 'Unter 7,5',
  yes: 'Beide treffen',
  no: 'Nicht beide',
  home_minus_1_5: 'Heim –1,5',
  away_plus_1_5: 'Gast +1,5',
  home_minus_2_5: 'Heim –2,5',
  away_plus_2_5: 'Gast +2,5',
  away_minus_1_5: 'Gast –1,5',
  home_plus_1_5: 'Heim +1,5',
  away_minus_2_5: 'Gast –2,5',
  home_plus_2_5: 'Heim +2,5',
}

/** matchday_special reuses generic keys ('over'/'under'/'yes'/'no') that
 *  ALSO exist as full-market Ü/U-2,5 and BTTS selections above — without
 *  this branch, a Special's plain 'yes'/'no' would silently render as
 *  "Beide treffen"/"Nicht beide" (the BTTS labels) instead of its own
 *  question's answer. The full "🔥 Spieltag N · <Titel> / <Über X,5>" label
 *  (requirement 14) needs the actual Special row joined in — see
 *  components/MyBets.tsx / AllTippsSection.tsx, which do that lookup
 *  themselves; this is only the safe generic fallback used everywhere else. */
export function selLabel(marketType: string, selection: string): string {
  if (marketType === 'exact_score') return selection
  if (marketType === 'matchday_special') {
    return selection === 'over' ? 'Über' : selection === 'under' ? 'Unter' : selection === 'yes' ? 'Ja' : selection === 'no' ? 'Nein' : selection
  }
  return SELECTION_LABELS[selection] ?? selection
}

/** Minimum-Stichprobe, ab der eine Markt-/Vereins-Performance als
 *  "bester/schlechtester" ausgezeichnet wird, statt bei z.B. 1/1 einen
 *  Zufallstreffer als Muster auszugeben. */
export const MIN_SAMPLE_MARKET_PERFORMANCE = 5
export const MIN_SAMPLE_TEAM_PERFORMANCE = 5
/** Ab wie vielen abgerechneten Wettscheinen die "Spieler-Stats"-Kachel
 *  überhaupt erscheint (bestehendes Verhalten aus profil/page.tsx). */
export const MIN_SETTLED_FOR_STATS_CARD = 3

type BetRow = {
  id: number
  market_type: string
  selection: string
  stake: number | null
  odds_value: number
  status: 'pending' | 'won' | 'lost' | 'void'
  payout: number | null
  combo_id: number | null
  is_risky: boolean
  created_at: string
  match_id: number | null
}

type ComboRow = {
  id: number
  stake: number
  total_odds: number
  status: 'pending' | 'won' | 'lost' | 'void'
  payout: number | null
  created_at: string
}

export interface MarketTipStat {
  marketType: string
  label: string
  ticks: number
  won: number
  lost: number
  pending: number
  /** null solange keine abgeschlossenen Tipps in diesem Markt vorliegen. */
  hitRate: number | null
}

export interface StreakInfo {
  length: number
  /** ISO-Datum des letzten Scheins der Serie, falls bekannt. */
  endedAt: string | null
}

export interface UserBetStats {
  /** Alle nicht-stornierten Wettscheine (Einzel + Kombi), jeder Status. */
  totalSlips: number
  won: number
  lost: number
  pending: number

  /** Einsatz über ALLE nicht-stornierten Scheine (auch offene). */
  totalStaked: number
  /** Auszahlung nur gewonnener Scheine (bereits gedeckelter, gespeicherter payout). */
  totalPayout: number

  /** Nur abgeschlossene (gewonnen+verloren) Scheine — Basis für ROI/Netto/Trefferquote. */
  settledCount: number
  settledStaked: number
  /** = totalPayout, hier als eigenes Feld für Klarheit an der Realized-Bilanz. */
  settledPayout: number
  /** Realisierte Netto-Bilanz NUR aus abgeschlossenen Scheinen — zählt offene
   *  Scheine weder als Gewinn noch als Verlust (behebt den Pending-als-Verlust-Bug). */
  realizedNet: number
  /** ROI bezogen auf abgeschlossene Scheine, in Prozent. null ohne Stichprobe. */
  roi: number | null

  /** Aktuell gebundener Einsatz in offenen Scheinen — separat von der
   *  realisierten Bilanz, nicht als Verlust gewertet. */
  pendingStaked: number
  /** Gedeckelte theoretische Auszahlung offener Scheine (lib/payout.ts),
   *  d.h. was diese Scheine MAXIMAL noch bringen können. */
  pendingPossiblePayout: number

  hitRate: number | null

  bestWinAmount: number | null
  bestWinType: 'single' | 'combo' | null
  bestWinDetail: { label: string; odds: number; stake: number } | null

  /** Häufigster Markt nach Tipp-Zahl (jedes Kombi-Leg zählt einzeln). */
  favoriteMarket: MarketTipStat | null
  /** Alle Märkte mit Tipp-Zahl, absteigend sortiert — Basis für "bester/
   *  schlechtester Markt" mit Mindeststichprobe (siehe MIN_SAMPLE_MARKET_PERFORMANCE). */
  marketBreakdown: MarketTipStat[]

  /** Anzahl Kombi-WETTSCHEINE (nicht Legs), jeder Status außer void. */
  comboSlips: number
  /** comboSlips / totalSlips, in Prozent. */
  comboRate: number | null

  riskyWon: number
  riskyLost: number

  avgOdds: number | null
  avgWinningOdds: number | null
  highestWonOdds: number | null

  longestWinStreak: StreakInfo
  longestLossStreak: StreakInfo

  /** Einzelwetten-Performance getrennt von Kombi-Performance. */
  singlePerformance: { settled: number; won: number; staked: number; payout: number; net: number; roi: number | null }
  comboPerformance: { settled: number; won: number; staked: number; payout: number; net: number; roi: number | null }

  /** Form der letzten N abgeschlossenen Scheine, chronologisch aufsteigend
   *  (ältester zuerst, neuester zuletzt) — so liest sich eine Punkte-Reihe
   *  links-nach-rechts mit dem aktuellsten Ergebnis ganz rechts. */
  recentForm: ('won' | 'lost')[]

  /** Ø Quote nur der ABGESCHLOSSENEN Einzelwetten bzw. nur der
   *  Gesamtquoten abgeschlossener Kombis — für die Kombi-Anteil-Detailansicht. */
  avgOddsSingle: number | null
  avgOddsCombo: number | null
  singleHitRate: number | null
  comboHitRate: number | null
}

function marketTipStatsFrom(rows: { market_type: string; status: string }[]): MarketTipStat[] {
  const byMarket = new Map<string, { ticks: number; won: number; lost: number; pending: number }>()
  for (const r of rows) {
    const e = byMarket.get(r.market_type) ?? { ticks: 0, won: 0, lost: 0, pending: 0 }
    e.ticks++
    if (r.status === 'won') e.won++
    else if (r.status === 'lost') e.lost++
    else if (r.status === 'pending') e.pending++
    byMarket.set(r.market_type, e)
  }
  const list: MarketTipStat[] = [...byMarket.entries()].map(([marketType, e]) => ({
    marketType,
    label: MARKET_LABELS[marketType] ?? marketType,
    ticks: e.ticks,
    won: e.won,
    lost: e.lost,
    pending: e.pending,
    hitRate: e.won + e.lost > 0 ? Math.round((e.won / (e.won + e.lost)) * 100) : null,
  }))
  // Tie-Break lt. Vorgabe: 1) Tipp-Zahl, 2) gewonnene Tipps, 3) Trefferquote,
  // 4) stabile alphabetische Reihenfolge (nach Label).
  list.sort((a, b) => {
    if (b.ticks !== a.ticks) return b.ticks - a.ticks
    if (b.won !== a.won) return b.won - a.won
    const hrA = a.hitRate ?? -1
    const hrB = b.hitRate ?? -1
    if (hrB !== hrA) return hrB - hrA
    return a.label.localeCompare(b.label, 'de')
  })
  return list
}

/** Chronologische Serie (nach created_at aufsteigend) von 'won'/'lost' —
 *  liefert die längste Gewinn- bzw. Verlustserie samt Enddatum. */
function computeStreaks(chronological: { status: 'won' | 'lost'; created_at: string }[]): {
  longestWinStreak: StreakInfo
  longestLossStreak: StreakInfo
} {
  let curStatus: 'won' | 'lost' | null = null
  let curLen = 0
  let bestWin = { length: 0, endedAt: null as string | null }
  let bestLoss = { length: 0, endedAt: null as string | null }
  for (const b of chronological) {
    if (b.status === curStatus) {
      curLen++
    } else {
      curStatus = b.status
      curLen = 1
    }
    if (curStatus === 'won' && curLen > bestWin.length) bestWin = { length: curLen, endedAt: b.created_at }
    if (curStatus === 'lost' && curLen > bestLoss.length) bestLoss = { length: curLen, endedAt: b.created_at }
  }
  return { longestWinStreak: bestWin, longestLossStreak: bestLoss }
}

/**
 * Reine Berechnungsfunktion — nimmt bereits gefilterte (richtiger User,
 * richtige Saison, kein 'void') Bets/Combos entgegen und liefert die
 * komplette UserBetStats-Struktur. Extrahiert aus computeUserBetStats, damit
 * computeAllUsersBetStats (Rangliste über ALLE Spieler, für die anklickbaren
 * Spieler-Stats-Detailansichten) dieselbe Rechnung wiederverwenden kann statt
 * sie pro Spieler einzeln neu zu implementieren.
 */
export function aggregateBetStats(bets: BetRow[], combosIn: ComboRow[]): UserBetStats {
  const singleBets = bets.filter(b => b.combo_id == null)
  const comboLegs = bets.filter(b => b.combo_id != null)
  const combos = combosIn
  const comboById = new Map(combos.map(c => [c.id, c]))
  const validComboLegs = comboLegs.filter(l => comboById.has(l.combo_id as number))

  // is_risky einer Kombi: combo_bets hat keine eigene Spalte, jedes Leg
  // spiegelt denselben Wert (siehe lib/risky.ts).
  const comboIsRisky = new Map<number, boolean>()
  for (const l of validComboLegs) {
    if (!comboIsRisky.has(l.combo_id as number)) comboIsRisky.set(l.combo_id as number, l.is_risky)
  }

  // ── Grundzahlen ──────────────────────────────────────────────────────
  const totalSlips = singleBets.length + combos.length
  const won = singleBets.filter(b => b.status === 'won').length + combos.filter(c => c.status === 'won').length
  const lost = singleBets.filter(b => b.status === 'lost').length + combos.filter(c => c.status === 'lost').length
  const pending = singleBets.filter(b => b.status === 'pending').length + combos.filter(c => c.status === 'pending').length

  const totalStaked = singleBets.reduce((a, b) => a + (b.stake ?? 0), 0) + combos.reduce((a, c) => a + c.stake, 0)
  const totalPayout = singleBets.filter(b => b.status === 'won').reduce((a, b) => a + (b.payout ?? 0), 0)
    + combos.filter(c => c.status === 'won').reduce((a, c) => a + (c.payout ?? 0), 0)

  const settledCount = won + lost
  const settledStaked = singleBets.filter(b => b.status !== 'pending').reduce((a, b) => a + (b.stake ?? 0), 0)
    + combos.filter(c => c.status !== 'pending').reduce((a, c) => a + c.stake, 0)
  const settledPayout = totalPayout
  const realizedNet = settledPayout - settledStaked
  const roi = settledStaked > 0 ? Math.round((realizedNet / settledStaked) * 1000) / 10 : null

  const pendingStaked = singleBets.filter(b => b.status === 'pending').reduce((a, b) => a + (b.stake ?? 0), 0)
    + combos.filter(c => c.status === 'pending').reduce((a, c) => a + c.stake, 0)
  const pendingPossiblePayout = singleBets.filter(b => b.status === 'pending')
    .reduce((a, b) => a + cappedPayout(b.stake ?? 0, b.odds_value, b.is_risky), 0)
    + combos.filter(c => c.status === 'pending')
      .reduce((a, c) => a + cappedPayout(c.stake, c.total_odds, comboIsRisky.get(c.id) ?? false), 0)

  const hitRate = settledCount > 0 ? Math.round((won / settledCount) * 100) : null

  // ── Bester Gewinn (echter Netto-Gewinn, nicht Auszahlung) ───────────
  const bestSingleBet = singleBets
    .filter(b => b.status === 'won' && b.payout != null)
    .sort((a, b) => ((b.payout ?? 0) - (b.stake ?? 0)) - ((a.payout ?? 0) - (a.stake ?? 0)))[0]
  const bestComboBet = combos
    .filter(c => c.status === 'won' && c.payout != null)
    .sort((a, b) => ((b.payout ?? 0) - b.stake) - ((a.payout ?? 0) - a.stake))[0]
  const bestSingle = bestSingleBet ? (bestSingleBet.payout ?? 0) - (bestSingleBet.stake ?? 0) : undefined
  const bestCombo = bestComboBet ? (bestComboBet.payout ?? 0) - bestComboBet.stake : undefined
  let bestWinAmount: number | null = null
  let bestWinType: 'single' | 'combo' | null = null
  let bestWinDetail: { label: string; odds: number; stake: number } | null = null
  if (bestSingle != null || bestCombo != null) {
    if ((bestSingle ?? -Infinity) >= (bestCombo ?? -Infinity)) {
      bestWinAmount = bestSingle ?? null
      bestWinType = 'single'
      if (bestSingleBet) bestWinDetail = { label: `${MARKET_LABELS[bestSingleBet.market_type] ?? bestSingleBet.market_type}: ${selLabel(bestSingleBet.market_type, bestSingleBet.selection)}`, odds: bestSingleBet.odds_value, stake: bestSingleBet.stake ?? 0 }
    } else {
      bestWinAmount = bestCombo ?? null
      bestWinType = 'combo'
      if (bestComboBet) bestWinDetail = { label: 'Kombiwette', odds: bestComboBet.total_odds, stake: bestComboBet.stake }
    }
  }
  if (bestWinAmount != null && bestWinAmount <= 0) { bestWinAmount = null; bestWinType = null; bestWinDetail = null }

  // ── Lieblingsmarkt: jede einzelne Auswahl zählt, Einzel + Kombi-Legs,
  //    unabhängig vom Status (offen zählt mit) ─────────────────────────
  const allTipRows = [...singleBets, ...validComboLegs].map(b => ({ market_type: b.market_type, status: b.status }))
  const marketBreakdown = marketTipStatsFrom(allTipRows)
  const favoriteMarket = marketBreakdown[0] ?? null

  // ── Kombi-Anteil: Kombi-WETTSCHEINE / alle Wettscheine ──────────────
  const comboSlips = combos.length
  const comboRate = totalSlips > 0 ? Math.round((comboSlips / totalSlips) * 100) : null

  // ── Risky-Bilanz (liest den gespeicherten, autoritativen is_risky-Flag) ─
  const riskyWon = singleBets.filter(b => b.is_risky && b.status === 'won').length
    + combos.filter(c => c.status === 'won' && comboIsRisky.get(c.id)).length
  const riskyLost = singleBets.filter(b => b.is_risky && b.status === 'lost').length
    + combos.filter(c => c.status === 'lost' && comboIsRisky.get(c.id)).length

  // ── Ø Quote / höchste gewonnene Quote ────────────────────────────────
  const allOddsSettled = [
    ...singleBets.filter(b => b.status !== 'pending').map(b => b.odds_value),
    ...combos.filter(c => c.status !== 'pending').map(c => c.total_odds),
  ]
  const avgOdds = allOddsSettled.length > 0
    ? Math.round((allOddsSettled.reduce((a, o) => a + o, 0) / allOddsSettled.length) * 100) / 100
    : null
  const wonOdds = [
    ...singleBets.filter(b => b.status === 'won').map(b => b.odds_value),
    ...combos.filter(c => c.status === 'won').map(c => c.total_odds),
  ]
  const avgWinningOdds = wonOdds.length > 0
    ? Math.round((wonOdds.reduce((a, o) => a + o, 0) / wonOdds.length) * 100) / 100
    : null
  const highestWonOdds = wonOdds.length > 0 ? Math.max(...wonOdds) : null

  // ── Streaks (chronologisch über Einzel + Kombi zusammen) ────────────
  const chronologicalSettled = [
    ...singleBets.filter(b => b.status === 'won' || b.status === 'lost').map(b => ({ status: b.status as 'won' | 'lost', created_at: b.created_at })),
    ...combos.filter(c => c.status === 'won' || c.status === 'lost').map(c => ({ status: c.status as 'won' | 'lost', created_at: c.created_at })),
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const { longestWinStreak, longestLossStreak } = computeStreaks(chronologicalSettled)
  const recentForm = chronologicalSettled.slice(-10).map(b => b.status)

  // ── Einzel- vs. Kombi-Performance ───────────────────────────────────
  function perfOf(settledStake: number, settledWonPayout: number, settledN: number, wonN: number) {
    const net = settledWonPayout - settledStake
    return {
      settled: settledN,
      won: wonN,
      staked: settledStake,
      payout: settledWonPayout,
      net,
      roi: settledStake > 0 ? Math.round((net / settledStake) * 1000) / 10 : null,
    }
  }
  const singleSettled = singleBets.filter(b => b.status !== 'pending')
  const singlePerformance = perfOf(
    singleSettled.reduce((a, b) => a + (b.stake ?? 0), 0),
    singleBets.filter(b => b.status === 'won').reduce((a, b) => a + (b.payout ?? 0), 0),
    singleSettled.length,
    singleBets.filter(b => b.status === 'won').length,
  )
  const comboSettled = combos.filter(c => c.status !== 'pending')
  const comboPerformance = perfOf(
    comboSettled.reduce((a, c) => a + c.stake, 0),
    combos.filter(c => c.status === 'won').reduce((a, c) => a + (c.payout ?? 0), 0),
    comboSettled.length,
    combos.filter(c => c.status === 'won').length,
  )

  const singleOddsSettled = singleSettled.map(b => b.odds_value)
  const avgOddsSingle = singleOddsSettled.length > 0
    ? Math.round((singleOddsSettled.reduce((a, o) => a + o, 0) / singleOddsSettled.length) * 100) / 100
    : null
  const comboOddsSettled = comboSettled.map(c => c.total_odds)
  const avgOddsCombo = comboOddsSettled.length > 0
    ? Math.round((comboOddsSettled.reduce((a, o) => a + o, 0) / comboOddsSettled.length) * 100) / 100
    : null
  const singleHitRate = singlePerformance.settled > 0 ? Math.round((singlePerformance.won / singlePerformance.settled) * 100) : null
  const comboHitRate = comboPerformance.settled > 0 ? Math.round((comboPerformance.won / comboPerformance.settled) * 100) : null

  return {
    totalSlips, won, lost, pending,
    totalStaked, totalPayout,
    settledCount, settledStaked, settledPayout, realizedNet, roi,
    pendingStaked, pendingPossiblePayout,
    hitRate,
    bestWinAmount, bestWinType, bestWinDetail,
    favoriteMarket, marketBreakdown,
    comboSlips, comboRate,
    riskyWon, riskyLost,
    avgOdds, avgWinningOdds, highestWonOdds,
    longestWinStreak, longestLossStreak,
    singlePerformance, comboPerformance,
    recentForm,
    avgOddsSingle, avgOddsCombo, singleHitRate, comboHitRate,
  }
}

/**
 * Lädt alle nicht-stornierten Wettscheine (Einzel + Kombi) eines Users für
 * eine Saison und berechnet die komplette UserBetStats-Struktur via
 * aggregateBetStats. Ein einziger DB-Roundtrip-Satz, egal ob für das eigene
 * Profil, ein fremdes Profil oder einen künftigen Vergleich aufgerufen.
 */
export async function computeUserBetStats(
  supabase: SupabaseClient,
  userId: string,
  season: string = STATS_CURRENT_SEASON,
): Promise<UserBetStats> {
  const { data: betsRaw } = await supabase
    .from('bets')
    .select('id, market_type, selection, stake, odds_value, status, payout, combo_id, is_risky, created_at, match_id, season')
    .eq('user_id', userId)
    .neq('status', 'void')

  const allBets = (betsRaw ?? []) as (BetRow & { season: string | null })[]
  // TEST (matchday 999) läuft nie in echte Statistiken ein — siehe TEST_SEASON-Kommentar oben.
  const bets = allBets.filter(b => b.season === season)

  const comboIdsForUser = [...new Set(bets.filter(b => b.combo_id != null).map(b => b.combo_id as number))]
  let combos: ComboRow[] = []
  if (comboIdsForUser.length > 0) {
    const { data: comboRaw } = await supabase
      .from('combo_bets')
      .select('id, stake, total_odds, status, payout, created_at, season')
      .in('id', comboIdsForUser)
    combos = ((comboRaw ?? []) as (ComboRow & { season: string | null })[]).filter(c => c.season === season)
  }
  return aggregateBetStats(bets, combos)
}

/**
 * Batched Rangliste über ALLE Nutzer für eine Saison — zwei Queries statt
 * einer pro Spieler, damit die anklickbaren Spieler-Stats-Detailrangliste
 * (Trefferquote, Ø Quote, Serien, …) nicht N Einzel-Roundtrips braucht.
 * Nutzt dieselbe aggregateBetStats-Rechnung wie computeUserBetStats — kein
 * zweiter, potenziell abweichender Rechenweg.
 */
export async function computeAllUsersBetStats(
  supabase: SupabaseClient,
  season: string = STATS_CURRENT_SEASON,
): Promise<Map<string, UserBetStats>> {
  const [{ data: betsRaw }, { data: combosRaw }] = await Promise.all([
    supabase
      .from('bets')
      .select('id, user_id, market_type, selection, stake, odds_value, status, payout, combo_id, is_risky, created_at, match_id, season')
      .neq('status', 'void'),
    supabase
      .from('combo_bets')
      .select('id, user_id, stake, total_odds, status, payout, created_at, season')
      .neq('status', 'void'),
  ])

  const bets = ((betsRaw ?? []) as (BetRow & { user_id: string; season: string | null })[]).filter(b => b.season === season)
  const combos = ((combosRaw ?? []) as (ComboRow & { user_id: string; season: string | null })[]).filter(c => c.season === season)

  const betsByUser = new Map<string, BetRow[]>()
  for (const b of bets) {
    const arr = betsByUser.get(b.user_id) ?? []
    arr.push(b)
    betsByUser.set(b.user_id, arr)
  }
  const combosByUser = new Map<string, ComboRow[]>()
  for (const c of combos) {
    const arr = combosByUser.get(c.user_id) ?? []
    arr.push(c)
    combosByUser.set(c.user_id, arr)
  }

  const userIds = new Set([...betsByUser.keys(), ...combosByUser.keys()])
  const result = new Map<string, UserBetStats>()
  for (const uid of userIds) {
    result.set(uid, aggregateBetStats(betsByUser.get(uid) ?? [], combosByUser.get(uid) ?? []))
  }
  return result
}

type MdSeasonMatchRow = {
  id: number; matchday: number; tippspiel_matchday: number | null; match_date: string
  match_category: string | null; is_topspiel: boolean | null
  home_team_id: number; away_team_id: number; status: string
}

async function buildMatchdayLookup(supabase: SupabaseClient): Promise<(matchId: number | null) => number | null> {
  const { buildEffectiveMatchdayIndex, effectiveMatchdayOf } = await import('./season')
  const { data: seasonMatchesRaw } = await supabase
    .from('matches')
    .select('id, matchday, tippspiel_matchday, match_date, match_category, is_topspiel, home_team_id, away_team_id, status')
    .or('match_date.gte.2026-08-01,matchday.eq.999')
  const seasonMatches = (seasonMatchesRaw ?? []) as unknown as MdSeasonMatchRow[]
  const mdIndex = buildEffectiveMatchdayIndex(seasonMatches as never)
  const matchById = new Map(seasonMatches.map(m => [m.id, m]))
  return (matchId: number | null) => {
    if (matchId == null) return null
    const m = matchById.get(matchId)
    return m ? effectiveMatchdayOf(m as never, mdIndex) : null
  }
}

export interface SlipDetail {
  matchday: number | null
  label: string
  odds: number
  stake: number
  status: 'pending' | 'won' | 'lost'
  /** null solange offen — noch nicht abgerechnet. */
  net: number | null
  isCombo: boolean
  isRisky: boolean
  createdAt: string
}

/**
 * Detaillierte Liste ALLER nicht-stornierten Wettscheine (Einzel + Kombi)
 * eines Users für eine Saison — Basis für die anklickbaren
 * Spieler-Stats-Detailansichten "Risky-Bilanz" und "Form der letzten 10
 * Wetten" (components/AllTippsSection-artige Detailkarten unter
 * app/(app)/spieler/[id]/stats/[metric]/page.tsx), die pro Wettschein statt
 * nur aggregiert Zahlen brauchen.
 */
export async function getUserSlipDetails(
  supabase: SupabaseClient,
  userId: string,
  season: string = STATS_CURRENT_SEASON,
): Promise<SlipDetail[]> {
  const effMdOf = await buildMatchdayLookup(supabase)
  const { data: betsRaw } = await supabase
    .from('bets')
    .select('id, market_type, selection, stake, odds_value, status, payout, combo_id, is_risky, created_at, match_id, season')
    .eq('user_id', userId)
    .neq('status', 'void')
  const allBets = (betsRaw ?? []) as (BetRow & { season: string | null })[]
  const bets = allBets.filter(b => b.season === season)
  const singleBets = bets.filter(b => b.combo_id == null)
  const comboLegs = bets.filter(b => b.combo_id != null)
  const comboIds = [...new Set(comboLegs.map(b => b.combo_id as number))]

  let combos: ComboRow[] = []
  if (comboIds.length > 0) {
    const { data: comboRaw } = await supabase
      .from('combo_bets')
      .select('id, stake, total_odds, status, payout, created_at, season')
      .in('id', comboIds)
    combos = ((comboRaw ?? []) as (ComboRow & { season: string | null })[]).filter(c => c.season === season)
  }
  const comboById = new Map(combos.map(c => [c.id, c]))
  const legsByCombo = new Map<number, typeof comboLegs>()
  for (const l of comboLegs) {
    if (!comboById.has(l.combo_id as number)) continue
    const arr = legsByCombo.get(l.combo_id as number) ?? []
    arr.push(l)
    legsByCombo.set(l.combo_id as number, arr)
  }

  const details: SlipDetail[] = []
  for (const b of singleBets) {
    details.push({
      matchday: effMdOf(b.match_id),
      label: `${MARKET_LABELS[b.market_type] ?? b.market_type}: ${selLabel(b.market_type, b.selection)}`,
      odds: b.odds_value,
      stake: b.stake ?? 0,
      status: b.status as 'pending' | 'won' | 'lost',
      net: b.status === 'pending' ? null : b.status === 'won' ? (b.payout ?? 0) - (b.stake ?? 0) : -(b.stake ?? 0),
      isCombo: false,
      isRisky: b.is_risky,
      createdAt: b.created_at,
    })
  }
  for (const c of combos) {
    const legs = legsByCombo.get(c.id) ?? []
    // Frühester Leg entscheidet den angezeigten Spieltag — für eine reine
    // Anzeigeliste reicht das min() der Legs, ohne den median-basierten
    // Ausreißerschutz von computeBalanceHistory (der ist dort nötig, weil er
    // Beträge einem einzigen Spieltag GUTSCHREIBT; hier wird nur angezeigt).
    const mds = legs.map(l => effMdOf(l.match_id)).filter((m): m is number => m != null)
    const matchday = mds.length > 0 ? Math.min(...mds) : null
    details.push({
      matchday,
      label: `Kombi (${legs.length} Tipps)`,
      odds: c.total_odds,
      stake: c.stake,
      status: c.status as 'pending' | 'won' | 'lost',
      net: c.status === 'pending' ? null : c.status === 'won' ? (c.payout ?? 0) - c.stake : -c.stake,
      isCombo: true,
      isRisky: legs.some(l => l.is_risky),
      createdAt: c.created_at,
    })
  }
  details.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  return details
}

export interface BalancePoint {
  /** Effektiver Tippspiel-Spieltag (lib/season.ts), oder null für den
   *  synthetischen Start-/Sonstiges-Punkt. */
  matchday: number | null
  balance: number
  /** Kurzlabel für Achse/Tooltip, z.B. "ST 4" oder "Taschengeld & Sonstiges". */
  label: string
  /** Netto-Delta dieses Punkts gegenüber dem vorherigen — für den Tooltip
   *  ("+120" / "-45"), null beim Startpunkt. */
  delta: number | null
}

/**
 * Rekonstruiert den Guthaben-Verlauf eines Users, gruppiert nach dem
 * EFFEKTIVEN Tippspiel-Spieltag (nicht nach Kalenderdatum) — siehe
 * lib/season.ts. Startpunkt ist das echte `season_start_balance` (nicht
 * hart 1000). Mehrere an einem Spieltag abgerechnete Scheine werden zu
 * einem Punkt aggregiert.
 *
 * Es gibt in dieser App keine Buchungshistorie mit Zeitstempel für
 * Taschengeld/Strafen (weekly_pocket_money_log verzeichnet nur, OB eine
 * Woche ausgezahlt wurde, nicht an wen/wie viel) — die Summe aus allen
 * Nicht-Wett-Buchungen wird deshalb bewusst NICHT über die Zeitachse
 * verteilt (das wäre Raten), sondern als EIN letzter, klar beschrifteter
 * Schritt angehängt.
 *
 * GARANTIE: `points[points.length - 1].balance === currentBalance`, exakt
 * (kein Runden auf volle Beträge) — der letzte Punkt ist entweder dieser
 * expliziten Differenz-Schritt (`balance: currentBalance` wörtlich
 * übernommen) oder, falls die Differenz nach Rundung auf Cent exakt 0 ist,
 * der letzte Spieltags-Punkt, dessen `running`-Summe dann per Definition
 * ebenfalls exakt `currentBalance` entspricht. `currentBalance` wird dem
 * Aufrufer 1:1 als Zahl übergeben (kein weiterer Fetch, kein zweiter
 * Wert) — dieselbe Zahl, die die Seite auch als "Guthaben" anzeigt, kann
 * hier strukturell nicht auseinanderlaufen.
 */
export async function computeBalanceHistory(
  supabase: SupabaseClient,
  userId: string,
  currentBalance: number,
  seasonStartBalance: number,
  season: string = STATS_CURRENT_SEASON,
): Promise<BalancePoint[]> {
  const { buildEffectiveMatchdayIndex, effectiveMatchdayOf } = await import('./season')
  type SeasonMatchRow = {
    id: number; matchday: number; tippspiel_matchday: number | null; match_date: string
    match_category: string | null; is_topspiel: boolean | null
    home_team_id: number; away_team_id: number; status: string
  }

  const [{ data: betsRaw }, { data: seasonMatchesRaw }] = await Promise.all([
    supabase
      .from('bets')
      .select('id, stake, payout, status, combo_id, match_id, season')
      .eq('user_id', userId)
      .neq('status', 'void')
      .in('status', ['won', 'lost']),
    supabase
      .from('matches')
      .select('id, matchday, tippspiel_matchday, match_date, match_category, is_topspiel, home_team_id, away_team_id, status')
      .or('match_date.gte.2026-08-01,matchday.eq.999'),
  ])

  type Row = { id: number; stake: number | null; payout: number | null; status: string; combo_id: number | null; match_id: number | null; season: string | null }
  const bets = ((betsRaw ?? []) as Row[]).filter(b => b.season === season)
  const seasonMatches = (seasonMatchesRaw ?? []) as unknown as SeasonMatchRow[]
  // buildEffectiveMatchdayIndex/effectiveMatchdayOf only read the fields
  // used here (matchday, tippspiel_matchday, match_date, match_category,
  // is_topspiel, home/away_team_id) — safe to cast without the full Match
  // shape (home_score/away_score aren't needed for this computation).
  const mdIndex = buildEffectiveMatchdayIndex(seasonMatches as never)
  const matchById = new Map(seasonMatches.map(m => [m.id, m]))
  const effMdOf = (matchId: number | null): number | null => {
    if (matchId == null) return null
    const m = matchById.get(matchId)
    return m ? effectiveMatchdayOf(m as never, mdIndex) : null
  }

  const comboIds = [...new Set(bets.filter(b => b.combo_id != null).map(b => b.combo_id as number))]
  const comboLegMatchdays = new Map<number, number[]>()
  const comboById = new Map<number, { stake: number; payout: number | null; status: string }>()
  if (comboIds.length > 0) {
    const [{ data: comboRaw }, { data: allLegsRaw }] = await Promise.all([
      supabase.from('combo_bets').select('id, stake, payout, status, season').in('id', comboIds),
      supabase.from('bets').select('combo_id, match_id').in('combo_id', comboIds),
    ])
    for (const c of (comboRaw ?? []) as { id: number; stake: number; payout: number | null; status: string; season: string | null }[]) {
      if (c.season === season) comboById.set(c.id, c)
    }
    for (const l of (allLegsRaw ?? []) as { combo_id: number | null; match_id: number | null }[]) {
      if (l.combo_id == null) continue
      const md = effMdOf(l.match_id)
      if (md == null) continue
      const arr = comboLegMatchdays.get(l.combo_id) ?? []
      arr.push(md)
      comboLegMatchdays.set(l.combo_id, arr)
    }
  }

  // Eine Kombi wird dem frühesten effektiven Spieltag ihrer Legs zugeordnet
  // (mirrort lib/awards.ts' comboOwnerMatchday-Logik für spieltagübergreifende
  // Kombis) — median-basierte Ankerdaten, robust gegen einzelne Nachholspiele.
  function earliestMatchday(mds: number[]): number | null {
    if (mds.length === 0) return null
    return [...mds].sort((a, b) => (mdIndex.matchdayAnchorDate.get(a) ?? Infinity) - (mdIndex.matchdayAnchorDate.get(b) ?? Infinity))[0]
  }

  const byMatchday = new Map<number, number>()
  const seenCombos = new Set<number>()
  for (const b of bets) {
    if (b.combo_id != null) {
      if (seenCombos.has(b.combo_id)) continue
      seenCombos.add(b.combo_id)
      const cb = comboById.get(b.combo_id)
      if (!cb || cb.status === 'pending') continue
      const md = earliestMatchday(comboLegMatchdays.get(b.combo_id) ?? [])
      if (md == null) continue
      const delta = cb.status === 'won' ? (cb.payout ?? 0) - cb.stake : -cb.stake
      byMatchday.set(md, (byMatchday.get(md) ?? 0) + delta)
    } else {
      const md = effMdOf(b.match_id)
      if (md == null) continue
      const stake = b.stake ?? 0
      const delta = b.status === 'won' ? (b.payout ?? 0) - stake : -stake
      byMatchday.set(md, (byMatchday.get(md) ?? 0) + delta)
    }
  }

  // Chronologische Reihenfolge wie überall sonst im UI (Nachholspiele landen
  // an ihrer tatsächlichen, nicht ihrer nummerischen Position).
  const orderedMatchdays = mdIndex.kreisligaMatchdaysDisplayOrder.filter(md => byMatchday.has(md))

  const points: BalancePoint[] = [{ matchday: null, balance: seasonStartBalance, label: 'Start', delta: null }]
  let running = seasonStartBalance
  for (const md of orderedMatchdays) {
    const delta = byMatchday.get(md)!
    running += delta
    points.push({ matchday: md, balance: running, label: `ST ${md}`, delta })
  }

  // Restdifferenz zum echten, aktuellen Guthaben (Taschengeld, Strafen,
  // Admin-Korrekturen) als EIN letzter Schritt — siehe Funktionskommentar
  // oben. Nur anhängen, wenn wirklich eine Differenz besteht (auf den Cent
  // gerundet), sonst gäbe es einen sinnlosen Nullschritt am Ende.
  const rest = Math.round((currentBalance - running) * 100) / 100
  if (Math.abs(rest) >= 0.01) {
    points.push({ matchday: null, balance: currentBalance, label: 'Taschengeld & Sonstiges', delta: rest })
  }
  return points
}
