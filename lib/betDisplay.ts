// Plain (non-'use client') helpers shared between server and client bet-display
// code. Kept out of components/WetteCard.tsx (a 'use client' file) specifically
// so Server Components (app/(app)/tipps/page.tsx, app/(app)/ergebnis/[matchId]/page.tsx)
// can import them without crossing a client-component boundary for a plain
// function — that boundary is for components, not utility functions.

export type BetOutcomeStatus = 'pending' | 'won' | 'lost'

/** Shared odds-value color convention, used everywhere an odds value is
 *  rendered: dark/neutral while still open, green once won, red once lost.
 *  Odds used to default to red everywhere regardless of outcome, which read
 *  as "already lost" even for a bet that hadn't been decided yet. */
export function oddsColorClass(status: BetOutcomeStatus | string | null | undefined): string {
  if (status === 'won') return 'text-green-600 dark:text-green-400'
  if (status === 'lost') return 'text-red-500 dark:text-red-400'
  return 'text-gray-900 dark:text-gray-100'
}

/**
 * Display labels for the one-off Pokal-Spezial cup fixture's markets (see
 * components/CupMatchCard.tsx). Internal `cup_*` market_type/selection codes
 * must never reach the user, and must never fall through to a generic
 * league-market label map (e.g. a `cup_comeback_advance` selection of 'yes'
 * previously rendered as btts's "Beide treffen" — wrong and confusing).
 * Single source of truth for BetSlip (components/CupMatchCard.tsx), offene
 * Wetten (components/MyBets.tsx), Wetthistorie
 * (components/BetHistoryWithCancel.tsx) and the admin bets overview
 * (app/admin/page.tsx) — all four must render identically.
 *
 * Hardcodes the literal team names "Wildenroth"/"Geiselbullach" rather than
 * deriving them from match.home_team/away_team, since this whole market set
 * exists for exactly one hardcoded fixture (see CUP_BONUS_MATCH_ID in
 * app/api/bets/place/route.ts) — same hardcoding pattern used there.
 */
export const CUP_MARKET_LABEL: Record<string, string> = {
  cup_advance: 'Wer kommt weiter?',
  cup_decision: 'Wann fällt die Entscheidung?',
  cup_halftime_lead_advance: 'HZ-Führung & Weiter',
  cup_comeback_advance: 'Comeback & Weiter',
  cup_shootout_advance: 'Elfmeterschießen & Weiter',
  cup_first_goal: 'Erstes Tor',
  cup_early_goal: 'Frühes Tor – Min. 1–15',
  cup_ht_more_goals: 'Mehr Tore in welcher Halbzeit?',
  // Retired from new bets (see CUP_ONLY_MARKETS in app/api/bets/place/route.ts)
  // but kept here so any pre-existing bet on it still renders a proper label
  // instead of the raw market_type.
  cup_both_halves_btts: 'Beide Teams treffen in beiden Halbzeiten',
}

const CUP_SELECTION_LABEL: Record<string, Record<string, string>> = {
  cup_advance: { home: 'Wildenroth', away: 'Geiselbullach' },
  cup_decision: { regulation: 'Nach 90 Min.', shootout: 'Elfmeterschießen' },
  cup_halftime_lead_advance: { yes: 'Wildenroth', no: 'Nein' },
  cup_comeback_advance: { yes: 'Wildenroth nach Geiselbullach-Führung', no: 'Nein' },
  cup_shootout_advance: { yes: 'Wildenroth', no: 'Nein' },
  cup_first_goal: { home: 'Wildenroth', away: 'Geiselbullach', none: 'Kein Tor in 90 Min.' },
  cup_early_goal: { yes: 'Ja', no: 'Nein' },
  cup_ht_more_goals: { h1: '1. Halbzeit', h2: '2. Halbzeit', equal: 'Gleich viele' },
  cup_both_halves_btts: { yes: 'Ja', no: 'Nein' },
}

/** True for any internal `cup_*` market_type that has a dedicated display
 *  label — i.e. every cup-only market except the shared `btts`/`goalscorer`
 *  markets, which already render correctly via the normal league maps. */
export function isCupMarket(marketType: string): boolean {
  return marketType in CUP_MARKET_LABEL
}

export function cupSelectionLabel(marketType: string, selection: string): string | undefined {
  return CUP_SELECTION_LABEL[marketType]?.[selection]
}

/** Compact market prefixes for the single-line "Alle Tipps" social view
 *  (app/(app)/tipps/page.tsx) — there's no room there for CUP_MARKET_LABEL's
 *  full titles next to the selection, but a bare selection like "Nein"/"Ja"/
 *  "Wildenroth" is ambiguous across the several yes/no and team-name cup
 *  markets (e.g. "Nein" alone doesn't say whether it's HZ-Führung, Comeback,
 *  Elfmeterschießen or Frühes Tor). Short, and placed FIRST so it survives
 *  CSS text-truncate (which cuts from the right) even when the full label
 *  doesn't fit. */
const CUP_MARKET_LABEL_SHORT: Record<string, string> = {
  cup_advance: 'Weiter',
  cup_decision: 'Entsch.',
  cup_halftime_lead_advance: 'HZ-Führung',
  cup_comeback_advance: 'Comeback',
  cup_shootout_advance: '11m & Weiter',
  cup_first_goal: '1. Tor',
  cup_early_goal: 'Frühes Tor',
  cup_ht_more_goals: 'Mehr Tore',
  cup_both_halves_btts: 'Beide HZ',
}

/** "{kurzer Markt}: {Auswahl}" for cup markets, e.g. "HZ-Führung: Nein" —
 *  undefined for non-cup markets (callers fall back to their own generic
 *  label map, which is unambiguous on its own for league markets). */
export function cupSocialLabel(marketType: string, selection: string): string | undefined {
  const prefix = CUP_MARKET_LABEL_SHORT[marketType]
  const sel = cupSelectionLabel(marketType, selection)
  if (!prefix || !sel) return undefined
  return `${prefix}: ${sel}`
}

/** Selection labels for the "Alle Tipps" social view and its extraction,
 *  components/AllTippsSection.tsx — moved here (from being local to
 *  app/(app)/tipps/page.tsx) so a 'use client' component can share it too. */
export const SELECTION_DISPLAY: Record<string, Record<string, string>> = {
  '1x2': { home: 'Heimsieg', draw: 'Unentschieden', away: 'Auswärtssieg' },
  double_chance: { '1x': '1X', x2: 'X2', '12': '12' },
  over_under: { 'over_2.5': 'Über 2,5', 'under_2.5': 'Unter 2,5' },
  over_under_3_5: { 'over_3.5': 'Über 3,5', 'under_3.5': 'Unter 3,5' },
  over_under_5_5: { 'over_5.5': 'Über 5,5', 'under_5.5': 'Unter 5,5' },
  over_under_7_5: { 'over_7.5': 'Über 7,5', 'under_7.5': 'Unter 7,5' },
  over_9_5: { 'over_9.5': 'Über 9,5' },
  btts: { yes: 'Beide treffen', no: 'Nicht beide' },
  matchday_special: { over: 'Über', under: 'Unter', yes: 'Ja', no: 'Nein' },
  handicap: {
    home_minus_1_5: 'Heim –1,5', away_plus_1_5: 'Gast +1,5', home_minus_2_5: 'Heim –2,5', away_plus_2_5: 'Gast +2,5',
    away_minus_1_5: 'Gast –1,5', home_plus_1_5: 'Heim +1,5', away_minus_2_5: 'Gast –2,5', home_plus_2_5: 'Heim +2,5',
  },
}

/** "Alle Tipps"/AllTippsSection's compact one-line selection label — same
 *  precedence as the Wetthistorie helpers above: cup markets first (a bare
 *  selection code like 'yes' is ambiguous across several cup markets), then
 *  goalscorer (needs a player-name lookup), then the plain league map. */
export function socialSelLabel(marketType: string, selection: string, players?: Record<number, string>): string {
  if (marketType === 'exact_score') return selection
  if (marketType === 'goalscorer' || marketType === 'goalscorer_2plus') {
    const id = parseInt(selection, 10)
    const name = players?.[id] ?? `Spieler #${id}`
    return marketType === 'goalscorer_2plus' ? `${name} (2+)` : name
  }
  return cupSocialLabel(marketType, selection) ?? SELECTION_DISPLAY[marketType]?.[selection] ?? selection
}

// ---------- Spieltag-Specials display (single source of truth) ----------
//
// A Special bet's `match_id` is only `representative_match_id` — a technical
// FK anchor (see lib/matchdaySpecials.ts) — so displaying it via the normal
// "home team – away team: selection" shape would misrepresent what was
// actually bet on. Every surface that lists a user's (or another user's)
// placed bets — MyBets, AllTippsSection, WetteCard/Kombi-Legs, Spielerprofil,
// Recap — must render a `matchday_special` bet through these helpers
// instead, using the joined `matchday_specials` row (by `bets.special_id`),
// never `market_type`/`selection` alone.

/** Minimal shape callers need to join in (from `matchday_specials`) to
 *  render a Special bet properly — a plain subset, not the full DB row. */
export interface SpecialDisplayInfo {
  matchday: number
  template_key: string
  options: { key: string; label: string }[]
  settlement_result?: { finalStat: number; winningKey: string } | null
}

/** Short, stable market name per template — used after "🔥 Spieltag N · ",
 *  never the full internal question text (too long for a bet-line label). */
const SPECIAL_SHORT_TITLE: Record<string, string> = {
  total_goals: 'Gesamttore',
  draws: 'Unentschieden',
  home_wins: 'Heimsiege',
  away_wins: 'Auswärtssiege',
  over25_games: 'Ü2,5-Spiele',
  btts_games: 'BTTS-Spiele',
  clean_sheet_games: 'Spiele mit torlosem Team',
  teams_3plus_goals: 'Teams mit 3+ Toren',
  teams_no_goal: 'Teams ohne Tor',
  biggest_win_margin: 'Kantersieg 4+',
  biggest_win_margin_6plus: 'Kantersieg 6+',
  any_00: 'Ein 0:0',
  team_5plus_goals: 'Team mit 5+ Toren',
}

/** True whenever a bet leg needs the Special display path instead of the
 *  normal match-based one. */
export function isSpecialMarket(marketType: string): boolean {
  return marketType === 'matchday_special'
}

/** Short, stable market name per template, e.g. "Gesamttore" — exported on
 *  its own (not just via specialMarketLabel) for callers that render
 *  "matchName · market: selection" as separate fields (e.g. the Recap). */
export function specialShortTitle(templateKey: string): string {
  return SPECIAL_SHORT_TITLE[templateKey] ?? templateKey
}

/** "Spieltag 2 · Gesamttore" — replaces the normal "Heim – Gast" match
 *  line for a Special bet everywhere it's shown. */
export function specialMarketLabel(special: Pick<SpecialDisplayInfo, 'matchday' | 'template_key'>): string {
  return `Spieltag ${special.matchday} · ${specialShortTitle(special.template_key)}`
}

/** The natural-language answer text ("27 oder mehr", "Ja", ...) for the
 *  selection actually bet on — pulled from the Special's own persisted
 *  `options`, never the raw internal 'over'/'under'/'yes'/'no' key. */
export function specialSelectionLabel(special: Pick<SpecialDisplayInfo, 'options'>, selection: string): string {
  return special.options.find((o) => o.key === selection)?.label ?? selection
}

const SPECIAL_RESULT_UNIT: Record<string, (n: number) => string> = {
  total_goals: (n) => `${n} Tore`,
  draws: (n) => `${n} Unentschieden`,
  home_wins: (n) => `${n} Heimsiege`,
  away_wins: (n) => `${n} Auswärtssiege`,
  over25_games: (n) => `${n} Spiele`,
  btts_games: (n) => `${n} Spiele`,
  clean_sheet_games: (n) => `${n} Spiele`,
  teams_3plus_goals: (n) => `${n} Teams`,
  teams_no_goal: (n) => `${n} Teams`,
}

const SPECIAL_YESNO_TEMPLATES = new Set(['biggest_win_margin', 'biggest_win_margin_6plus', 'any_00', 'team_5plus_goals'])

/** "Ergebnis: 29 Tore" / "Ergebnis: Ja" once a Special is settled — derived
 *  purely from `settlement_result` (`{finalStat, winningKey}`, see
 *  lib/matchdaySpecials.ts#settleActiveMatchdaySpecials), never a second,
 *  separately-tracked copy of the outcome. `null` while still pending. */
export function specialResultText(special: Pick<SpecialDisplayInfo, 'template_key' | 'settlement_result'>): string | null {
  const sr = special.settlement_result
  if (!sr) return null
  if (SPECIAL_YESNO_TEMPLATES.has(special.template_key)) {
    return `Ergebnis: ${sr.winningKey === 'yes' ? 'Ja' : 'Nein'}`
  }
  const fmt = SPECIAL_RESULT_UNIT[special.template_key]
  return `Ergebnis: ${fmt ? fmt(sr.finalStat) : sr.finalStat}`
}
