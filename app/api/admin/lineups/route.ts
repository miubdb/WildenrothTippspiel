import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const SEASON_START = '2026-08-01'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, error: NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { supabase, error: NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 }) }
  return { supabase, error: null }
}

/** Recomputes wildenroth_players.games/minutes/goals for one player from the
 *  full set of their current-season match_lineups entries — a fresh
 *  aggregate, not an incremental +=, so repeated edits/deletes of a lineup
 *  entry can never double-count or drift. This is what makes the goalscorer
 *  odds model (lib/goalscorer.ts#sampleOf, keyed off exactly these three
 *  columns) actually reflect entered lineups instead of needing separate,
 *  disconnected manual upkeep. */
async function recomputePlayerStats(supabase: Awaited<ReturnType<typeof createClient>>, playerId: number) {
  const { data: entries } = await supabase
    .from('match_lineups')
    .select('minutes_played, goals, match_id, matches!inner(match_date, matchday)')
    .eq('player_id', playerId)
    .gte('matches.match_date', SEASON_START)
    .neq('matches.matchday', 999)

  const rows = entries ?? []
  const games = rows.length
  const minutes = rows.reduce((s, r) => s + (r.minutes_played ?? 0), 0)
  const goals = rows.reduce((s, r) => s + (r.goals ?? 0), 0)

  await supabase.from('wildenroth_players').update({ games, minutes, goals }).eq('id', playerId)
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const matchId = request.nextUrl.searchParams.get('match_id')
  if (!matchId) return NextResponse.json({ error: 'match_id fehlt.' }, { status: 400 })

  const { data, error } = await supabase
    .from('match_lineups')
    .select('*')
    .eq('match_id', parseInt(matchId))
    .order('team_name')
    .order('player_name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ lineups: data ?? [] })
}

export async function POST(request: NextRequest) {
  const { supabase, error: authError } = await requireAdmin()
  if (authError) return authError

  let body: {
    match_id: number
    team_name: string
    player_name: string
    player_id?: number | null
    minutes_played?: number
    goals?: number
    assists?: number
    is_starter?: boolean | null
    penalty_missed?: boolean
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const {
    match_id, team_name, player_name, player_id = null,
    minutes_played = 90, goals = 0, assists = 0,
    is_starter = null, penalty_missed = false,
  } = body
  if (!match_id || !team_name || !player_name) {
    return NextResponse.json({ error: 'match_id, team_name und player_name sind erforderlich.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('match_lineups')
    .insert({ match_id, team_name, player_name, player_id, minutes_played, goals, assists, is_starter, penalty_missed })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Only a Wildenroth-roster pick carries player_id — an opponent's free-text
  // entry has none and there's no wildenroth_players row to recompute.
  if (player_id != null) await recomputePlayerStats(supabase, player_id)

  return NextResponse.json({ lineup: data })
}

export async function DELETE(request: NextRequest) {
  const { supabase, error: authError } = await requireAdmin()
  if (authError) return authError

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id fehlt.' }, { status: 400 })

  // Need the row's player_id BEFORE deleting, to recompute that player's
  // aggregate afterward (removing an entry must lower games/minutes/goals
  // too, not just adding one raise them).
  const { data: existing } = await supabase
    .from('match_lineups')
    .select('player_id')
    .eq('id', parseInt(id))
    .single()

  const { error } = await supabase.from('match_lineups').delete().eq('id', parseInt(id))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (existing?.player_id != null) await recomputePlayerStats(supabase, existing.player_id)

  return NextResponse.json({ success: true })
}
