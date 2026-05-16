import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/admin/goalscorers/availability
 * Body: { matchId, playerId, status?, is_offered?, is_offered_2plus? }
 *
 * Updates a single player's per-match availability/offers. Does NOT cancel
 * existing bets — use cancel-player for that.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  let body: { matchId: number; playerId: number; status?: string; is_offered?: boolean; is_offered_2plus?: boolean }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const { matchId, playerId } = body
  if (!Number.isFinite(matchId) || !Number.isFinite(playerId)) {
    return NextResponse.json({ error: 'matchId/playerId fehlt.' }, { status: 400 })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.status !== undefined) updates.status = body.status
  if (body.is_offered !== undefined) updates.is_offered = body.is_offered
  if (body.is_offered_2plus !== undefined) updates.is_offered_2plus = body.is_offered_2plus

  const { error } = await supabase
    .from('match_goalscorer_odds')
    .update(updates)
    .eq('match_id', matchId)
    .eq('player_id', playerId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
