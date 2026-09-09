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
