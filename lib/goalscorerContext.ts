import type { createClient } from '@/lib/supabase/server'
import type { Match } from '@/types'
import type { TeamStats, WildenrothPlayer, GoalscorerMatchContext } from '@/lib/goalscorer'

/**
 * Per-match goalscorer inputs — availability, the matchday squad, and the
 * per-TEAM player stats — shared by the admin recompute route and the automatic
 * freeze in app/(app)/tipps/page.tsx so the two can never disagree.
 */

export const CURRENT_SEASON = '26/27'

export const WILDENROTH_TEAM_NAMES = ['SpVgg Wildenroth', 'SpVgg Wildenroth II'] as const

/**
 * `match_goalscorer_odds.status` values that take a player OUT of the pool
 * entirely. `questionable` is deliberately NOT here — a doubtful player still
 * might play, and lib/goalscorer.ts halves his appearance probability instead.
 *
 * Why exclusion matters: player xG values are shares of the team's xG. A blocked
 * player left in the pool would keep his slice and that slice would simply
 * vanish, leaving the offered players collectively short of the team's actual
 * expected goals. Removing him redistributes it.
 */
export const BLOCKING_GOALSCORER_STATUSES: ReadonlySet<string> = new Set([
  'injured',
  'missing',
  'not_bettable',
  // Set by the admin when the real matchday squad is entered and this player is
  // not in it. The squad beats any statistical appearance probability.
  'not_in_squad',
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
 *
 * It is a statistical fallback only. Once the real matchday squad is entered,
 * a `both` player is either in it or not, and that decides the matter — see
 * BLOCKING_GOALSCORER_STATUSES.
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

type Client = Awaited<ReturnType<typeof createClient>>

interface TeamStatRow {
  player_id: number
  team: string
  games: number
  minutes: number
  goals: number
  as_of_matches: number
  minutes_reliable: boolean
}

/**
 * Attaches per-team current-season stats to a squad.
 *
 * `side` is the team actually playing ('1' or '2'); the other side's row is
 * carried along separately as a converted prior rather than pooled into it —
 * see lib/goalscorer.ts#crossTeamScale for why they must not simply be added up.
 */
export async function attachTeamStats(
  supabase: Client,
  players: WildenrothPlayer[],
  side: '1' | '2',
): Promise<WildenrothPlayer[]> {
  if (players.length === 0) return players
  const { data } = await supabase
    .from('wildenroth_player_team_stats')
    .select('player_id, team, games, minutes, goals, as_of_matches, minutes_reliable')
    .eq('season', CURRENT_SEASON)
    .in('player_id', players.map((p) => p.id))

  const toStats = (r: TeamStatRow): TeamStats => ({
    games: r.games,
    minutes: r.minutes,
    goals: r.goals,
    asOfMatches: r.as_of_matches,
    minutesReliable: r.minutes_reliable,
  })

  const own = new Map<number, TeamStats>()
  const other = new Map<number, TeamStats>()
  for (const r of (data ?? []) as TeamStatRow[]) {
    ;(r.team === side ? own : other).set(r.player_id, toStats(r))
  }

  return players.map((p) => ({
    ...p,
    teamStats: own.get(p.id) ?? null,
    otherTeamStats: other.get(p.id) ?? null,
  }))
}

/**
 * Goals per match each Wildenroth side has scored in its own league this
 * season. Only used to make a cross-team scoring rate comparable before it is
 * blended in — never to adjust the fixture's goal level, which belongs to
 * teamMatchXG alone.
 */
export function wildenrothGoalsPerMatch(
  matches: Match[],
  teamId: number | null,
): number | undefined {
  if (teamId == null) return undefined
  let goals = 0, played = 0
  for (const m of matches) {
    if (m.status !== 'finished' || m.home_score == null || m.away_score == null) continue
    if ((m as unknown as { competition_type?: string }).competition_type === 'cup') continue
    if (m.matchday === 999) continue
    if (m.home_team_id === teamId) { goals += m.home_score; played++ }
    else if (m.away_team_id === teamId) { goals += m.away_score; played++ }
  }
  return played > 0 ? goals / played : undefined
}

/**
 * Builds the full per-match context: availability, the parallel-fixture flag,
 * and the two teams' goal levels.
 */
export async function buildGoalscorerContext(
  supabase: Client,
  opts: {
    matchId: number
    matchDate: string
    modelMatches: Match[]
    thisTeamId: number
    otherTeamId: number | null
  },
): Promise<GoalscorerMatchContext> {
  const { data: availability } = await supabase
    .from('match_goalscorer_odds')
    .select('player_id, status')
    .eq('match_id', opts.matchId)

  const rows = (availability ?? []) as { player_id: number; status: string }[]
  return {
    blockedPlayerIds: new Set(rows.filter((r) => BLOCKING_GOALSCORER_STATUSES.has(r.status)).map((r) => r.player_id)),
    questionablePlayerIds: new Set(rows.filter((r) => r.status === 'questionable').map((r) => r.player_id)),
    bothSquadConflict: hasConcurrentOtherSquadFixture(
      opts.modelMatches, opts.matchDate, opts.thisTeamId, [opts.thisTeamId, opts.otherTeamId],
    ),
    teamGoalsPerMatch: wildenrothGoalsPerMatch(opts.modelMatches, opts.thisTeamId),
    otherTeamGoalsPerMatch: wildenrothGoalsPerMatch(opts.modelMatches, opts.otherTeamId),
  }
}
