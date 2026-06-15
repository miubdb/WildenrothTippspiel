import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, error: NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { supabase, error: NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 }) }
  return { supabase, error: null }
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

  let body: { match_id: number; team_name: string; player_name: string; minutes_played?: number; goals?: number; assists?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const { match_id, team_name, player_name, minutes_played = 90, goals = 0, assists = 0 } = body
  if (!match_id || !team_name || !player_name) {
    return NextResponse.json({ error: 'match_id, team_name und player_name sind erforderlich.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('match_lineups')
    .insert({ match_id, team_name, player_name, minutes_played, goals, assists })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ lineup: data })
}

export async function DELETE(request: NextRequest) {
  const { supabase, error: authError } = await requireAdmin()
  if (authError) return authError

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id fehlt.' }, { status: 400 })

  const { error } = await supabase.from('match_lineups').delete().eq('id', parseInt(id))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
