import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { computeGoalscorerOffersForMatch, type WildenrothPlayer } from '@/lib/goalscorer'
import type { Match } from '@/types'

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Nicht angemeldet.', status: 401 as const }
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: 'Keine Berechtigung.', status: 403 as const }
  return { userId: user.id }
}

/** GET /api/admin/goalscorers/match?matchId=42 — read current state for a Wildenroth match */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const auth = await requireAdmin(supabase)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const matchId = Number(request.nextUrl.searchParams.get('matchId'))
  if (!Number.isFinite(matchId)) {
    return NextResponse.json({ error: 'matchId fehlt.' }, { status: 400 })
  }

  const { data: match } = await supabase
    .from('matches')
    .select(`id, matchday, home_team_id, away_team_id, status,
      home_team:teams!matches_home_team_id_fkey(id, name),
      away_team:teams!matches_away_team_id_fkey(id, name)`)
    .eq('id', matchId)
    .single()
  if (!match) return NextResponse.json({ error: 'Spiel nicht gefunden.' }, { status: 404 })

  const { data: gsRows } = await supabase
    .from('match_goalscorer_odds')
    .select(`*, player:wildenroth_players(*)`)
    .eq('match_id', matchId)
    .order('player_id')

  const { data: scorers } = await supabase
    .from('match_goalscorers')
    .select('id, player_id, goals, is_own_goal')
    .eq('match_id', matchId)

  return NextResponse.json({ match, rows: gsRows ?? [], scorers: scorers ?? [] })
}

/** POST /api/admin/goalscorers/match — (re)compute and freeze odds for a match. */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const auth = await requireAdmin(supabase)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { matchId: number; force?: boolean }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const { matchId, force } = body
  if (!Number.isFinite(matchId)) return NextResponse.json({ error: 'matchId fehlt.' }, { status: 400 })

  const { data: match } = await supabase
    .from('matches')
    .select('id, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status')
    .eq('id', matchId)
    .single()
  if (!match) return NextResponse.json({ error: 'Spiel nicht gefunden.' }, { status: 404 })

  // Resolve which Wildenroth side (if either) is playing, by exact name — an
  // `ilike('%Wildenroth%')` match with no ORDER BY always resolved to
  // SpVgg Wildenroth (id 14) regardless of which team actually played,
  // rejecting every genuine Wildenroth II fixture with "Kein Wildenroth-Spiel."
  const { data: wildenrothTeams } = await supabase
    .from('teams').select('id, name').in('name', ['SpVgg Wildenroth', 'SpVgg Wildenroth II'])
  const team1Id = wildenrothTeams?.find(t => t.name === 'SpVgg Wildenroth')?.id ?? null
  const team2Id = wildenrothTeams?.find(t => t.name === 'SpVgg Wildenroth II')?.id ?? null

  const involvesTeam1 = team1Id != null && (match.home_team_id === team1Id || match.away_team_id === team1Id)
  const involvesTeam2 = team2Id != null && (match.home_team_id === team2Id || match.away_team_id === team2Id)
  if (!involvesTeam1 && !involvesTeam2) {
    return NextResponse.json({ error: 'Kein Wildenroth-Spiel.' }, { status: 400 })
  }
  const wildenrothId = involvesTeam1 ? team1Id! : team2Id!
  const squads = involvesTeam1 ? ['1', 'both'] : ['2', 'both']

  // Skip if already frozen and not forced
  if (!force) {
    const { count } = await supabase
      .from('match_goalscorer_odds').select('id', { count: 'exact', head: true })
      .eq('match_id', matchId).not('frozen_at', 'is', null)
    if ((count ?? 0) > 0) {
      return NextResponse.json({ skipped: true, reason: 'already_frozen' })
    }
  }

  // Players from the squad that's actually playing this match
  const { data: playersRaw } = await supabase.from('wildenroth_players').select('*').eq('active', true).in('squad', squads)
  const players = (playersRaw ?? []) as WildenrothPlayer[]

  // Season fixtures (same window as main odds logic)
  const SEASON_START = '2026-08-01'
  const { data: matchesRaw } = await supabase
    .from('matches')
    .select('id, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status')
    .gte('match_date', SEASON_START)
  const seasonMatches = (matchesRaw ?? []) as Match[]

  const offers = computeGoalscorerOffersForMatch(
    seasonMatches, match.home_team_id, match.away_team_id, wildenrothId, players,
  )

  const now = new Date().toISOString()
  for (const o of offers) {
    await supabase.from('match_goalscorer_odds').upsert({
      match_id: matchId,
      player_id: o.player_id,
      status: 'available',
      is_offered: o.is_offered,
      is_offered_2plus: o.is_offered_2plus,
      prob_score: o.prob_score,
      prob_score_2plus: o.prob_score_2plus,
      odds_score: o.odds_score,
      odds_score_2plus: o.odds_score_2plus,
      frozen_at: now,
      updated_at: now,
    }, { onConflict: 'match_id,player_id' })
  }

  return NextResponse.json({ success: true, offers: offers.length })
}
