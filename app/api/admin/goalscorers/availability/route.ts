import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/admin/goalscorers/availability
 * Body: { matchId, playerId, status?, is_offered?, is_offered_2plus?, odds_score?, odds_score_2plus? }
 *
 * Updates a single player's per-match availability/offers, and optionally a
 * manual odds override. Unlike the main markets (match_odds_overrides),
 * match_goalscorer_odds has no separate auto-vs-override pair of columns —
 * odds_score/odds_score_2plus are already the single frozen value everything
 * else reads (bet placement, the tipps page). A manual edit here overwrites
 * that value directly, exactly like "Quoten neu berechnen" already does when
 * it recomputes it from the model — clicking that button is the "reset to
 * auto" path for a manually-edited row. Does NOT cancel existing bets — use
 * cancel-player for that.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  let body: {
    matchId: number; playerId: number; status?: string
    is_offered?: boolean; is_offered_2plus?: boolean
    odds_score?: number; odds_score_2plus?: number
  }
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
  for (const col of ['odds_score', 'odds_score_2plus'] as const) {
    const v = body[col]
    if (v === undefined) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 1.0 || v > 999) {
      return NextResponse.json({ error: `Ungültiger Wert für ${col}.` }, { status: 400 })
    }
    updates[col] = v
  }

  // .select() + row-count check so a target row that doesn't exist (e.g. odds
  // were never computed for this match/player, or got deleted/reset in
  // between) surfaces as an error instead of a silent no-op "success" — an
  // admin editing odds has no other way to notice their change didn't apply.
  const { data, error } = await supabase
    .from('match_goalscorer_odds')
    .update(updates)
    .eq('match_id', matchId)
    .eq('player_id', playerId)
    .select('player_id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Zeile nicht gefunden — wurden die Quoten für dieses Spiel schon berechnet?' }, { status: 404 })
  }
  return NextResponse.json({ success: true })
}
