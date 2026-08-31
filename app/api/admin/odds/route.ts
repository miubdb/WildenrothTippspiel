import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMatchXG, oddsFromXG, buildPriorContext } from '@/lib/odds'
import { persistOddsDiagnostics } from '@/lib/oddsDiagnostics'
import { fetchAllRows } from '@/lib/supabase/paginatedSelect'
import type { Match, PriorMatch, LeaguePlayer, LineupEntry } from '@/types'

const SEASON_START = '2026-08-01'

export async function POST() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })
  }

  // Fetch all matches with team data for context
  const { data: allMatchesRaw } = await supabase
    .from('matches')
    .select(
      `id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status,
       home_team:teams!matches_home_team_id_fkey(id, name, short_name),
       away_team:teams!matches_away_team_id_fkey(id, name, short_name)`
    )
    .order('match_date', { ascending: true })

  const allMatches: Match[] = (allMatchesRaw ?? []).map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  }))

  // Only current-season matches (+ the always-included test matchday 999) may
  // feed the odds model — prior-season finished matches must never be averaged
  // into a team's current-season form (see tipps/page.tsx and
  // admin/odds/preview/route.ts, which already filter this way).
  const seasonMatches = allMatches.filter((m) => m.matchday === 999 || m.match_date >= SEASON_START)

  const priorMatchesRaw = await fetchAllRows((from, to) => supabase
    .from('prior_season_matches')
    .select('id, season, league_name, league_level, league_number, home_team, away_team, home_score, away_score, match_date')
    .order('id')
    .range(from, to)
  )

  const priorMatches: PriorMatch[] = priorMatchesRaw as PriorMatch[]

  const leaguePlayersRaw = await fetchAllRows((from, to) => supabase
    .from('league_players')
    .select('id, team_name, name, goals, matches, minutes, status, transfer_to, prior_league_level, prior_team_name')
    .order('id')
    .range(from, to)
  )
  const lineupEntriesRaw = await fetchAllRows((from, to) => supabase
    .from('match_lineups')
    .select('id, match_id, team_name, player_name, minutes_played, goals, assists, red_card_minute, created_at')
    .order('id')
    .range(from, to)
  )

  const leaguePlayers: LeaguePlayer[] = (leaguePlayersRaw ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    team_name: p.team_name,
    goals: p.goals,
    games: p.matches,
    minutes: p.minutes,
    status: p.status,
    transfer_to: p.transfer_to,
    prior_league_level: p.prior_league_level,
    prior_team_name: p.prior_team_name,
  }))
  const lineupEntries: LineupEntry[] = (lineupEntriesRaw ?? []) as LineupEntry[]

  const teamNames = new Map<number, string>()
  for (const m of allMatches) {
    if (m.home_team) teamNames.set(m.home_team_id, m.home_team.name)
    if (m.away_team) teamNames.set(m.away_team_id, m.away_team.name)
  }
  const priorCtx = buildPriorContext(priorMatches, teamNames, leaguePlayers, lineupEntries)

  // Find scheduled matches to update odds for — never touch already-frozen rows:
  // once betting has opened and odds are frozen, they must never change under
  // bettors, even if this recalculation button is pressed again.
  const scheduledMatchIds = seasonMatches.filter((m) => m.status === 'scheduled').map((m) => m.id)
  const { data: frozenRows } = scheduledMatchIds.length > 0
    ? await supabase.from('odds').select('match_id').in('match_id', scheduledMatchIds).not('frozen_at', 'is', null)
    : { data: [] }
  const frozenIds = new Set((frozenRows ?? []).map((r) => r.match_id))
  const scheduledMatches = seasonMatches.filter((m) => m.status === 'scheduled' && !frozenIds.has(m.id))
  const skippedFrozen = scheduledMatchIds.length - scheduledMatches.length

  let upsertCount = 0
  const errors: string[] = []

  for (const match of scheduledMatches) {
    try {
      const { homeXG, awayXG, diagnostics } = getMatchXG(seasonMatches, match.home_team_id, match.away_team_id, priorCtx)
      const oddsData = oddsFromXG(homeXG, awayXG)

      const { error } = await supabase.from('odds').upsert(
        {
          match_id: match.id,
          matchday: match.matchday,
          home_win: oddsData.home_win,
          draw: oddsData.draw,
          away_win: oddsData.away_win,
          odds_1x: oddsData.odds_1x,
          odds_x2: oddsData.odds_x2,
          odds_12: oddsData.odds_12,
          over_2_5: oddsData.over_2_5,
          under_2_5: oddsData.under_2_5,
          over_3_5: oddsData.over_3_5,
          under_3_5: oddsData.under_3_5,
          over_5_5: oddsData.over_5_5,
          under_5_5: oddsData.under_5_5,
          over_7_5: oddsData.over_7_5,
          under_7_5: oddsData.under_7_5,
          btts_yes: oddsData.btts_yes,
          btts_no: oddsData.btts_no,
          hdp_home_minus_1_5: oddsData.hdp_home_minus_1_5,
          hdp_away_plus_1_5: oddsData.hdp_away_plus_1_5,
          hdp_home_minus_2_5: oddsData.hdp_home_minus_2_5,
          hdp_away_plus_2_5: oddsData.hdp_away_plus_2_5,
          hdp_away_minus_1_5: oddsData.hdp_away_minus_1_5,
          hdp_home_plus_1_5: oddsData.hdp_home_plus_1_5,
          hdp_away_minus_2_5: oddsData.hdp_away_minus_2_5,
          hdp_home_plus_2_5: oddsData.hdp_home_plus_2_5,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'match_id' }
      )

      if (error) {
        errors.push(`Match ${match.id}: ${error.message}`)
      } else {
        upsertCount++
        await persistOddsDiagnostics(supabase, match.id, 'admin_recalc', diagnostics)
      }
    } catch (err) {
      errors.push(`Match ${match.id}: ${String(err)}`)
    }
  }

  return NextResponse.json({
    success: true,
    updated: upsertCount,
    total: scheduledMatches.length,
    skippedFrozen,
    errors: errors.length > 0 ? errors : undefined,
  })
}
