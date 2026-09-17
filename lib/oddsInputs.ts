import type { createClient } from '@/lib/supabase/server'
import { buildPriorContext, type PriorContext } from '@/lib/odds'
import { fetchAllRows } from '@/lib/supabase/paginatedSelect'
import { SEASON_START } from '@/lib/season'
import type { Match, PriorMatch, LeaguePlayer, LineupEntry } from '@/types'

/**
 * Single source of truth for the INPUTS of the odds model.
 *
 * The model itself (lib/odds.ts) was always shared, but every caller assembled
 * its own inputs — and they drifted: the freeze/recalc route
 * (app/api/admin/odds/route.ts) selected matches WITHOUT `match_category`,
 * while the preview route and tipps/page.tsx selected it. With the league-aware
 * model that is not cosmetic: a B-Klasse fixture whose category is missing gets
 * inferred as Kreisliga and priced against the wrong goal baseline, so the
 * admin preview and the eventual freeze would disagree for exactly those
 * matches. lib/matchdaySpecials.ts went further and passed no PriorContext at
 * all, i.e. its per-match probabilities skipped prior-season blending and the
 * roster factor entirely.
 *
 * Every odds computation now loads its inputs through here, so "identical
 * inputs for freeze, preview, recalc and Specials" is structural rather than a
 * convention four files have to remember.
 */

/** Season cut-off — re-exported so an odds call site needs one import. */
export { SEASON_START } from '@/lib/season'

/**
 * Columns the model needs. `match_category` drives the league tier (Kreisliga
 * vs. B-Klasse baselines), `competition_type` the cup exclusion, and the team
 * joins the NAMES that prior-season stats, league_players and match_lineups are
 * keyed by. Dropping any of them silently degrades the model rather than
 * failing, which is why this list lives in one place.
 */
export const ODDS_MATCH_COLUMNS =
  'id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status, match_category, is_topspiel, tippspiel_matchday, competition_type, goalscorer_squad_confirmed_at'

export const ODDS_MATCH_JOINS = `home_team:teams!matches_home_team_id_fkey(id, name, short_name),
       away_team:teams!matches_away_team_id_fkey(id, name, short_name)`

export const ODDS_MATCH_SELECT = `${ODDS_MATCH_COLUMNS},
       ${ODDS_MATCH_JOINS}`

/** Works with the session-scoped server client; the admin client is never
 *  needed here since all four tables are world-readable to authenticated users. */
type Client = Awaited<ReturnType<typeof createClient>>

interface RawJoinedMatch {
  home_team_id: number
  away_team_id: number
  home_team: { id: number; name: string; short_name: string | null }[] | { id: number; name: string; short_name: string | null } | null
  away_team: { id: number; name: string; short_name: string | null }[] | { id: number; name: string; short_name: string | null } | null
}

/** PostgREST returns an embedded to-one relation as an array in some client
 *  type paths — every call site used to unwrap this by hand. */
export function normalizeJoinedMatches(rows: unknown[]): Match[] {
  return (rows as RawJoinedMatch[]).map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  })) as Match[]
}

/** `league_players.matches` → `LeaguePlayer.games`, then buildPriorContext.
 *  Exported because app/(app)/tipps/page.tsx fetches these rows in its own
 *  Promise.all (it needs extra match columns) — it must still end up with a
 *  byte-identical PriorContext, so the mapping lives here, not in both files. */
export function priorContextFromRows(
  priorMatchesRaw: unknown[] | null,
  teamNames: Map<number, string>,
  leaguePlayersRaw: unknown[] | null,
  lineupEntriesRaw: unknown[] | null,
): PriorContext {
  const leaguePlayers: LeaguePlayer[] = (leaguePlayersRaw ?? []).map((p) => {
    const row = p as { id: number; name: string; team_name: string; goals: number; matches: number; minutes: number; status: string | null; transfer_to: string | null; prior_league_level: string | null; prior_team_name: string | null }
    return {
      id: row.id,
      name: row.name,
      team_name: row.team_name,
      goals: row.goals,
      games: row.matches,
      minutes: row.minutes,
      status: row.status,
      transfer_to: row.transfer_to,
      prior_league_level: row.prior_league_level,
      prior_team_name: row.prior_team_name,
    } as LeaguePlayer
  })
  return buildPriorContext(
    (priorMatchesRaw ?? []) as unknown as PriorMatch[],
    teamNames,
    leaguePlayers,
    (lineupEntriesRaw ?? []) as unknown as LineupEntry[],
  )
}

export interface OddsModelInputs {
  /** Every current-season match (+ the test matchday 999), teams joined. */
  seasonMatches: Match[]
  /** seasonMatches minus cup fixtures — the pool handed to getMatchXG. A cup
   *  result must never feed a team's league strength (see CLAUDE.md). */
  modelMatches: Match[]
  priorCtx: PriorContext
  teamNames: Map<number, string>
}

/**
 * Loads matches, prior-season matches, league players and lineups and builds
 * the PriorContext. Every large table is paged via fetchAllRows with a stable
 * `.order('id')` — `match_lineups` and `prior_season_matches` are both past
 * PostgREST's silent 1000-row cap (see CLAUDE.md).
 */
export async function loadOddsModelInputs(supabase: Client): Promise<OddsModelInputs> {
  const [matchesRaw, priorMatchesRaw, leaguePlayersRaw, lineupEntriesRaw] = await Promise.all([
    fetchAllRows((from, to) => supabase
      .from('matches')
      .select(ODDS_MATCH_SELECT)
      .or(`match_date.gte.${SEASON_START},matchday.eq.999`)
      .order('id')
      .range(from, to)
    ),
    fetchAllRows((from, to) => supabase
      .from('prior_season_matches')
      .select('id, season, league_name, league_level, league_number, home_team, away_team, home_score, away_score, match_date')
      .order('id')
      .range(from, to)
    ),
    fetchAllRows((from, to) => supabase
      .from('league_players')
      .select('id, team_name, name, goals, matches, minutes, status, transfer_to, prior_league_level, prior_team_name')
      .order('id')
      .range(from, to)
    ),
    fetchAllRows((from, to) => supabase
      .from('match_lineups')
      .select('id, match_id, team_name, player_name, minutes_played, goals, assists, red_card_minute, created_at')
      .order('id')
      .range(from, to)
    ),
  ])

  const seasonMatches = normalizeJoinedMatches(matchesRaw ?? [])
    .sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime())

  const teamNames = new Map<number, string>()
  for (const m of seasonMatches) {
    if (m.home_team) teamNames.set(m.home_team_id, m.home_team.name)
    if (m.away_team) teamNames.set(m.away_team_id, m.away_team.name)
  }

  const priorCtx = priorContextFromRows(priorMatchesRaw, teamNames, leaguePlayersRaw, lineupEntriesRaw)

  return {
    seasonMatches,
    modelMatches: seasonMatches.filter((m) => m.competition_type !== 'cup'),
    priorCtx,
    teamNames,
  }
}

/**
 * The odds SNAPSHOT pool for a match card: matches finished before the betting
 * window opened. Odds are frozen at that moment, so everything computed for
 * that Spieltag — 1X2/O-U, exact score, goalscorers, Spieltag-Specials — must
 * see the same "as of" view of the season, whether it is computed live on the
 * tipps page, in the admin preview or by the recalc button.
 */
export function snapshotMatches(modelMatches: Match[], cutoff: Date | null): Match[] {
  if (!cutoff) return modelMatches
  return modelMatches.filter((m) => m.status !== 'finished' || new Date(m.match_date) < cutoff)
}
