import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  const matchday = parseInt(request.nextUrl.searchParams.get('matchday') ?? '0', 10)
  if (!matchday) return NextResponse.json({ error: 'Spieltag fehlt.' }, { status: 400 })

  // All match IDs for this matchday
  const { data: matchRows } = await supabase
    .from('matches')
    .select('id, home_team_id, away_team_id, home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name)')
    .eq('matchday', matchday)

  const matchIds = (matchRows ?? []).map(m => m.id)
  if (matchIds.length === 0) return NextResponse.json({ bets: [], profiles: [], matches: [] })

  const matchMap = Object.fromEntries(
    (matchRows ?? []).map(m => [m.id, {
      home: Array.isArray(m.home_team) ? m.home_team[0]?.name : (m.home_team as { name: string } | null)?.name,
      away: Array.isArray(m.away_team) ? m.away_team[0]?.name : (m.away_team as { name: string } | null)?.name,
    }])
  )

  const { data: bets } = await supabase
    .from('bets')
    .select('id, user_id, match_id, market_type, selection, odds_value, status, combo_id, is_risky, stake, created_at')
    .in('match_id', matchIds)
    .order('created_at', { ascending: true })

  const userIds = [...new Set((bets ?? []).map(b => b.user_id))]
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, username')
    .in('id', userIds)

  const { data: roster } = await supabase.from('wildenroth_players').select('id, name')
  const playerNameMap: Record<number, string> = Object.fromEntries((roster ?? []).map(r => [r.id, r.name]))

  return NextResponse.json({ bets: bets ?? [], profiles: profiles ?? [], matchMap, playerNameMap })
}
