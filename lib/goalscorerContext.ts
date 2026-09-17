import type { Match } from '@/types'

/**
 * Per-match goalscorer availability, shared by the admin recompute route and
 * the automatic freeze in app/(app)/tipps/page.tsx so the two can never
 * disagree about who is in the allocation pool.
 */

/**
 * `match_goalscorer_odds.status` values that take a player OUT of the pool
 * entirely. `questionable` is deliberately NOT here — a doubtful player still
 * might play, and lib/goalscorer.ts halves his appearance probability instead.
 *
 * Why exclusion matters now: player xG values are shares of the team's xG. A
 * blocked player left in the pool would keep his slice and that slice would
 * simply vanish, leaving the offered players collectively short of the team's
 * actual expected goals. Removing him redistributes it.
 */
export const BLOCKING_GOALSCORER_STATUSES: ReadonlySet<string> = new Set([
  'injured',
  'missing',
  'not_bettable',
])

/** How close two fixtures must be to count as "he cannot play both". A full day
 *  either side: the two Wildenroth sides normally play the same weekend, often
 *  the same afternoon, and a player listed for both squads can only turn out
 *  for one of them. */
const CONCURRENT_FIXTURE_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * True when the OTHER Wildenroth side has a fixture close enough to this one
 * that a `squad='both'` player cannot feature in both.
 *
 * This is NOT the double-fixture lock. That lock (app/(app)/tipps/page.tsx,
 * `GOALSCORER_DOUBLE_FIXTURE_BUFFER_MS`) handles ONE side playing twice in a
 * week by keeping the later match's whole Torschützen tab closed, and it stays
 * the mechanism for that case. This function covers the different situation the
 * lock does not see — team I and team II playing in parallel — and it feeds the
 * minute projection rather than closing a market.
 */
export function hasConcurrentOtherSquadFixture(
  matches: Match[],
  matchDate: string,
  thisWildenrothTeamId: number,
  wildenrothTeamIds: (number | null)[],
): boolean {
  const otherIds = wildenrothTeamIds.filter(
    (id): id is number => id != null && id !== thisWildenrothTeamId
  )
  if (otherIds.length === 0) return false

  const kickoff = new Date(matchDate).getTime()
  return matches.some((m) => {
    if (m.status !== 'scheduled') return false
    if (!otherIds.includes(m.home_team_id) && !otherIds.includes(m.away_team_id)) return false
    return Math.abs(new Date(m.match_date).getTime() - kickoff) <= CONCURRENT_FIXTURE_WINDOW_MS
  })
}
