import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calculateOdds, getExactScoreOdds, buildPriorContext } from '@/lib/odds'
import { bettingOpenTime } from '@/lib/season'
import type { Match, PriorMatch, LeaguePlayer, LineupEntry } from '@/types'

const SEASON_START = '2026-08-01'

export async function GET(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  const url = new URL(request.url)
  const requestedMd = url.searchParams.get('matchday')

  const { data: allMatchesRaw } = await supabase
    .from('matches')
    .select(
      `id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status,
       home_team:teams!matches_home_team_id_fkey(id, name, short_name),
       away_team:teams!matches_away_team_id_fkey(id, name, short_name)`,
    )
    .order('match_date', { ascending: true })

  const allMatches: Match[] = (allMatchesRaw ?? []).map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  }))

  const { data: priorMatchesRaw } = await supabase
    .from('prior_season_matches')
    .select('id, season, league_name, league_level, league_number, home_team, away_team, home_score, away_score, match_date')

  const priorMatches: PriorMatch[] = (priorMatchesRaw ?? []) as PriorMatch[]

  const { data: leaguePlayersRaw } = await supabase
    .from('league_players')
    .select('id, team_name, name, goals, matches, status, transfer_to, prior_league_level, prior_team_name')
  const { data: lineupEntriesRaw } = await supabase
    .from('match_lineups')
    .select('id, match_id, team_name, player_name, minutes_played, goals, assists, created_at')

  const leaguePlayers: LeaguePlayer[] = (leaguePlayersRaw ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    team_name: p.team_name,
    goals: p.goals,
    games: p.matches,
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

  const matchdays = [...new Set(allMatches.map((m) => m.matchday))].sort((a, b) => a - b)

  // Default: first matchday that still has at least one scheduled match
  const defaultMd = allMatches
    .filter((m) => m.status === 'scheduled')
    .map((m) => m.matchday)
    .sort((a, b) => a - b)[0]

  const targetMd = requestedMd ? parseInt(requestedMd, 10) : defaultMd
  if (targetMd == null) {
    return NextResponse.json({ matchday: null, matches: [], matchdays: [] })
  }

  const matchdayMatches = allMatches
    .filter((m) => m.matchday === targetMd)
    .sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime())

  const firstMatch = matchdayMatches[0]
  const bettingOpensAt = firstMatch ? bettingOpenTime(new Date(firstMatch.match_date)).toISOString() : null
  const isBettingOpen = bettingOpensAt ? new Date() >= new Date(bettingOpensAt) : false

  // Replicate the snapshot cutoff that the live page uses, so the preview matches
  // exactly what would be frozen at Monday 12:00.
  const seasonMatches = allMatches.filter((m) => m.match_date >= SEASON_START)
  const cutoff = bettingOpensAt ? new Date(bettingOpensAt) : null
  const oddsMatches = cutoff
    ? seasonMatches.filter((m) => m.status !== 'finished' || new Date(m.match_date) < cutoff)
    : seasonMatches

  // Existing frozen rows (if any)
  const matchIds = matchdayMatches.map((m) => m.id)
  const { data: frozenRows } = matchIds.length > 0
    ? await supabase.from('odds').select('match_id, frozen_at').in('match_id', matchIds)
    : { data: [] }
  const frozenMap = new Map((frozenRows ?? []).map((r) => [r.match_id, r.frozen_at]))

  const previews = matchdayMatches.map((m) => {
    const odds = calculateOdds(oddsMatches, m.home_team_id, m.away_team_id, priorCtx)
    const exact = getExactScoreOdds(oddsMatches, m.home_team_id, m.away_team_id, priorCtx).slice(0, 12)
    return {
      match_id: m.id,
      match_number: m.match_number,
      match_date: m.match_date,
      status: m.status,
      home_team: m.home_team?.name ?? '?',
      away_team: m.away_team?.name ?? '?',
      frozen_at: frozenMap.get(m.id) ?? null,
      odds,
      exact_scores: exact,
    }
  })

  return NextResponse.json({
    matchday: targetMd,
    matchdays,
    matches: previews,
    bettingOpensAt,
    isBettingOpen,
  })
}
