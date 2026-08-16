import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Nicht angemeldet.', status: 401 as const }
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: 'Keine Berechtigung.', status: 403 as const }
  return { userId: user.id }
}

/** GET /api/admin/goalscorers/roster?matchId=42 — active squad for a Wildenroth
 *  match, independent of whether goalscorer odds were ever frozen for it.
 *  Used by the Spieltag tab's inline "Ergebnis + Torschützen" entry, which
 *  must work even for a match nobody visited the Quoten tab for. */
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
    .select('id, home_team_id, away_team_id')
    .eq('id', matchId)
    .single()
  if (!match) return NextResponse.json({ error: 'Spiel nicht gefunden.' }, { status: 404 })

  // Same squad-resolution as /api/admin/goalscorers/match — resolve by exact
  // name, not ilike, so a Wildenroth II fixture doesn't resolve to team 1.
  const { data: wildenrothTeams } = await supabase
    .from('teams').select('id, name').in('name', ['SpVgg Wildenroth', 'SpVgg Wildenroth II'])
  const team1Id = wildenrothTeams?.find(t => t.name === 'SpVgg Wildenroth')?.id ?? null
  const team2Id = wildenrothTeams?.find(t => t.name === 'SpVgg Wildenroth II')?.id ?? null
  const involvesTeam1 = team1Id != null && (match.home_team_id === team1Id || match.away_team_id === team1Id)
  const involvesTeam2 = team2Id != null && (match.home_team_id === team2Id || match.away_team_id === team2Id)
  if (!involvesTeam1 && !involvesTeam2) {
    return NextResponse.json({ error: 'Kein Wildenroth-Spiel.' }, { status: 400 })
  }
  const squads = involvesTeam1 ? ['1', 'both'] : ['2', 'both']

  const { data: players } = await supabase
    .from('wildenroth_players')
    .select('id, name')
    .eq('active', true)
    .in('squad', squads)
    .order('name')

  return NextResponse.json({ players: players ?? [] })
}
