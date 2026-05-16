import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser } from '@/lib/push'

/**
 * POST /api/admin/goalscorers/cancel-player
 * Body: { matchId, playerId }
 *
 * Marks a player as not offered for the match, then:
 *  - finds all pending goalscorer bets on that (match, player)
 *  - for single bets: deletes them and refunds stake
 *  - for combo bets that contain such a leg: deletes the entire combo (all legs)
 *    and refunds the combo stake (user-friendly: full refund)
 *  - sends a push notification to each affected user
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  const { data: prof } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!prof?.is_admin) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  let body: { matchId: number; playerId: number }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }
  const { matchId, playerId } = body
  if (!Number.isFinite(matchId) || !Number.isFinite(playerId)) {
    return NextResponse.json({ error: 'matchId/playerId fehlt.' }, { status: 400 })
  }

  // Use admin client so we can modify other users' bets and balances.
  const admin = createAdminClient()

  // Mark offers off + status not_bettable
  await admin
    .from('match_goalscorer_odds')
    .update({ is_offered: false, is_offered_2plus: false, status: 'not_bettable', updated_at: new Date().toISOString() })
    .eq('match_id', matchId)
    .eq('player_id', playerId)

  // Player display name for the push body
  const { data: player } = await admin
    .from('wildenroth_players').select('name').eq('id', playerId).single()
  const playerName = player?.name ?? 'Spieler'

  // Find all pending goalscorer bets on this (match, player)
  const { data: affectedBets } = await admin
    .from('bets')
    .select('id, user_id, stake, combo_id')
    .eq('match_id', matchId)
    .eq('selection', String(playerId))
    .in('market_type', ['goalscorer', 'goalscorer_2plus'])
    .eq('status', 'pending')

  const refunds: { userId: string; amount: number }[] = []
  const cancelledSingles: number[] = []
  const cancelledCombos: number[] = []

  for (const bet of affectedBets ?? []) {
    if (bet.combo_id == null) {
      cancelledSingles.push(bet.id)
      refunds.push({ userId: bet.user_id, amount: Number(bet.stake ?? 0) })
    } else {
      // Mark whole combo for cancellation
      if (!cancelledCombos.includes(bet.combo_id)) {
        cancelledCombos.push(bet.combo_id)
      }
    }
  }

  // Cancel single bets
  if (cancelledSingles.length > 0) {
    await admin.from('bets').delete().in('id', cancelledSingles)
  }

  // Cancel combos (refund the full combo stake to the user)
  for (const comboId of cancelledCombos) {
    const { data: combo } = await admin
      .from('combo_bets').select('id, user_id, stake').eq('id', comboId).single()
    if (!combo) continue
    await admin.from('bets').delete().eq('combo_id', comboId)
    await admin.from('combo_bets').delete().eq('id', comboId)
    refunds.push({ userId: combo.user_id, amount: Number(combo.stake) })
  }

  // Apply refunds (aggregate per user)
  const perUser = new Map<string, number>()
  for (const r of refunds) {
    perUser.set(r.userId, (perUser.get(r.userId) ?? 0) + r.amount)
  }

  const pushJobs: Promise<void>[] = []
  for (const [userId, refundAmount] of perUser) {
    const { data: p } = await admin.from('profiles').select('balance').eq('id', userId).single()
    if (!p) continue
    await admin
      .from('profiles')
      .update({ balance: Number(p.balance) + refundAmount })
      .eq('id', userId)

    pushJobs.push(
      sendPushToUser(
        userId,
        '⚠️ Torschützenwette storniert',
        `Deine Torschützenwette auf ${playerName} wurde storniert, weil der Spieler nicht im Kader ist. Dein Einsatz wurde zurückgebucht.`,
        '/profil',
      )
    )
  }
  await Promise.allSettled(pushJobs)

  return NextResponse.json({
    success: true,
    cancelledSingles: cancelledSingles.length,
    cancelledCombos: cancelledCombos.length,
    affectedUsers: perUser.size,
  })
}
