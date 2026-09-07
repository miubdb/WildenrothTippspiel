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

export function selLabel(marketType: string, selection: string): string {
  if (marketType === 'exact_score') return selection
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
 * Lädt alle nicht-stornierten Wettscheine (Einzel + Kombi) eines Users für
 * eine Saison und berechnet die komplette UserBetStats-Struktur. Ein
 * einziger DB-Roundtrip-Satz, egal ob für das eigene Profil, ein fremdes
 * Profil oder einen künftigen Vergleich aufgerufen.
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
  // Falls eine Kombi-ID trotz Season-Filter nicht zurückkam (z.B. season NULL
  // in combo_bets historisch), fällt sie aus `combos` raus — die zugehörigen
  // Legs würden dann leerlaufen. Zur Sicherheit nur Legs behalten, deren
  // Combo tatsächlich geladen wurde.
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
  const bestSingle = singleBets
    .filter(b => b.status === 'won' && b.payout != null)
    .map(b => (b.payout ?? 0) - (b.stake ?? 0))
    .sort((a, b) => b - a)[0]
  const bestCombo = combos
    .filter(c => c.status === 'won' && c.payout != null)
    .map(c => (c.payout ?? 0) - c.stake)
    .sort((a, b) => b - a)[0]
  let bestWinAmount: number | null = null
  let bestWinType: 'single' | 'combo' | null = null
  if (bestSingle != null || bestCombo != null) {
    if ((bestSingle ?? -Infinity) >= (bestCombo ?? -Infinity)) { bestWinAmount = bestSingle ?? null; bestWinType = 'single' }
    else { bestWinAmount = bestCombo ?? null; bestWinType = 'combo' }
  }
  if (bestWinAmount != null && bestWinAmount <= 0) { bestWinAmount = null; bestWinType = null }

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

  return {
    totalSlips, won, lost, pending,
    totalStaked, totalPayout,
    settledCount, settledStaked, settledPayout, realizedNet, roi,
    pendingStaked, pendingPossiblePayout,
    hitRate,
    bestWinAmount, bestWinType,
    favoriteMarket, marketBreakdown,
    comboSlips, comboRate,
    riskyWon, riskyLost,
    avgOdds, avgWinningOdds, highestWonOdds,
    longestWinStreak, longestLossStreak,
    singlePerformance, comboPerformance,
    recentForm,
  }
}

export interface BalancePoint {
  /** ISO-Datum des Ereignisses, oder null für den synthetischen Start-/
   *  Sonstiges-Punkt. */
  date: string | null
  balance: number
  /** Kurzlabel für Tooltip/Achse. */
  label: string
}

/**
 * Rekonstruiert den Guthaben-Verlauf eines Users. Startpunkt ist das echte
 * `season_start_balance` (nicht hart 1000). Danach folgt EIN Punkt pro
 * abgerechnetem Wettschein, chronologisch nach dem Datum des frühesten
 * zugehörigen Spiels. Es gibt in dieser App keine Buchungshistorie mit
 * Zeitstempel für Taschengeld/Strafen (weekly_pocket_money_log verzeichnet
 * nur, OB eine Woche ausgezahlt wurde, nicht an wen/wie viel) — die Summe
 * aus allen Nicht-Wett-Buchungen wird deshalb bewusst NICHT über die
 * Zeitachse verteilt (das wäre Raten), sondern als EIN letzter, klar
 * beschrifteter Schritt angehängt. Dadurch trifft der letzte Punkt immer
 * exakt das tatsächlich angezeigte Guthaben, ohne einzelne Ereignisse zu
 * erfinden.
 */
export async function computeBalanceHistory(
  supabase: SupabaseClient,
  userId: string,
  currentBalance: number,
  seasonStartBalance: number,
  season: string = STATS_CURRENT_SEASON,
): Promise<BalancePoint[]> {
  const { data: betsRaw } = await supabase
    .from('bets')
    .select('id, stake, payout, status, combo_id, created_at, season, match:matches(match_date)')
    .eq('user_id', userId)
    .neq('status', 'void')
    .in('status', ['won', 'lost'])

  type Row = { id: number; stake: number | null; payout: number | null; status: string; combo_id: number | null; created_at: string; season: string | null; match: { match_date: string } | { match_date: string }[] | null }
  const bets = ((betsRaw ?? []) as Row[]).filter(b => b.season === season)

  const comboIds = [...new Set(bets.filter(b => b.combo_id != null).map(b => b.combo_id as number))]
  const comboById = new Map<number, { stake: number; payout: number | null; status: string }>()
  if (comboIds.length > 0) {
    const { data: comboRaw } = await supabase
      .from('combo_bets')
      .select('id, stake, payout, status, season')
      .in('id', comboIds)
    for (const c of (comboRaw ?? []) as { id: number; stake: number; payout: number | null; status: string; season: string | null }[]) {
      if (c.season === season) comboById.set(c.id, c)
    }
  }

  type Event = { date: string; delta: number }
  const events: Event[] = []
  const seenCombos = new Set<number>()
  for (const b of bets) {
    const m = Array.isArray(b.match) ? b.match[0] : b.match
    if (!m?.match_date) continue
    if (b.combo_id != null) {
      if (seenCombos.has(b.combo_id)) continue
      seenCombos.add(b.combo_id)
      const cb = comboById.get(b.combo_id)
      if (!cb || cb.status === 'pending') continue
      events.push({ date: m.match_date, delta: cb.status === 'won' ? (cb.payout ?? 0) - cb.stake : -cb.stake })
    } else {
      const stake = b.stake ?? 0
      events.push({ date: m.match_date, delta: b.status === 'won' ? (b.payout ?? 0) - stake : -stake })
    }
  }
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const points: BalancePoint[] = [{ date: null, balance: seasonStartBalance, label: 'Start' }]
  let running = seasonStartBalance
  for (const e of events) {
    running += e.delta
    points.push({ date: e.date, balance: running, label: e.delta >= 0 ? `+${Math.round(e.delta)}` : `${Math.round(e.delta)}` })
  }

  // Restdifferenz zum echten, aktuellen Guthaben (Taschengeld, Strafen,
  // Admin-Korrekturen, gerundete Cent-Reste) als EIN letzter Schritt — siehe
  // Funktionskommentar oben. Nur anhängen, wenn wirklich eine Differenz
  // besteht, sonst gäbe es einen sinnlosen Nullschritt am Ende.
  const rest = Math.round((currentBalance - running) * 100) / 100
  if (Math.abs(rest) >= 0.01) {
    points.push({ date: null, balance: currentBalance, label: 'Taschengeld & Sonstiges' })
  }
  return points
}
