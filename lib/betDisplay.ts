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
