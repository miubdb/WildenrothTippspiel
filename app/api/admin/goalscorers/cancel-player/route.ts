import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { voidSlipWithRefund } from '@/lib/settlement'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser } from '@/lib/push'

/**
 * POST /api/admin/goalscorers/cancel-player
 * Body: { matchId, playerId }
 *
 * Marks a player as not offered for the match, then:
 *  - finds all pending goalscorer bets on that (match, player)
 *  - for single bets: soft-cancels them (status='void') and refunds stake
 *  - for combo bets that contain such a leg: soft-cancels the entire combo (all
 *    legs) and refunds the combo stake (user-friendly: full refund)
 *  - sends a push notification to each affected user
 *
 * Soft-cancelling (not deleting) keeps the row around for later "what would
 * have happened" recap analysis, same as the user-initiated cancel flow in
 * app/api/bets/cancel/route.ts — every read site that must not see cancelled
 * bets already filters status <> 'void'. 'void' (not 'cancelled') is what the
 * bets_status_check / combo_bets_status_check CHECK constraints allow.
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
    .update({ is_offered: false, is_offered_2plus: false, status: 'not_bettable', manually_overridden: true, updated_at: new Date().toISOString() })
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

  // Void + refund per slip in ONE transaction (void_slip_refund) — no double refund against a user's own cancel or a repeated
  // admin click, and a failing refund rolls the void back so the slip can be retried.
  const cancelledSingles: number[] = []
  const cancelledCombos: number[] = []
  const perUser = new Map<string, number>()
  const add = (u: string, a: number) => perUser.set(u, (perUser.get(u) ?? 0) + a)
  let failures = 0
  const comboIds = new Set<number>()
  for (const bet of affectedBets ?? []) {
    if (bet.combo_id == null) {
      try {
        const amt = await voidSlipWithRefund(admin, 'single', bet.id, 'admin_goalscorer_unavailable')
        if (amt != null) { cancelledSingles.push(bet.id); add(bet.user_id, amt) }
      } catch (e) { failures++; console.error('cancel-player single failed', { id: bet.id, e }) }
    } else comboIds.add(bet.combo_id)
  }
  for (const comboId of comboIds) {
    const { data: combo } = await admin.from('combo_bets').select('user_id').eq('id', comboId).single()
    try {
      const amt = await voidSlipWithRefund(admin, 'combo', comboId, 'admin_goalscorer_unavailable', { allLegs: true })
      if (amt != null && combo) { cancelledCombos.push(comboId); add(combo.user_id, amt) }
    } catch (e) { failures++; console.error('cancel-player combo failed', { comboId, e }) }
  }
  if (failures > 0) {
    return NextResponse.json({ error: `${failures} Stornierung(en) fehlgeschlagen und zurückgerollt – bitte erneut ausführen (idempotent).`, cancelledSingles: cancelledSingles.length, cancelledCombos: cancelledCombos.length }, { status: 500 })
  }

  const pushJobs: Promise<unknown>[] = []
  for (const [userId, refundAmount] of perUser) {
    // Atomic increment — see scorers/route.ts for why a select-then-update here
    // would silently lose a concurrent bet placement/cancellation/settlement.
    // refund already booked atomically with the void
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
