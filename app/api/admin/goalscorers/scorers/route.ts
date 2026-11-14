import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser } from '@/lib/push'
import { fmtWildi, wildiLabel } from '@/components/WildiIcon'
import { finalizeMatchdayIfDone } from '@/lib/matchdayFinalize'
import { settleSingle, settleCombo, findStuckComboIds } from '@/lib/settlement'
import { cappedPayout } from '@/lib/payout'

/**
 * POST /api/admin/goalscorers/scorers
 * Body: { matchId, scorers: [{ playerId, goals, isOwnGoal? }] }
 *
 * Replaces the scorer list for a match, then settles all pending goalscorer
 * bets for that match.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  let body: { matchId: number; scorers: { playerId: number; goals: number; isOwnGoal?: boolean }[] }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }
  const { matchId, scorers } = body
  if (!Number.isFinite(matchId) || !Array.isArray(scorers)) {
    return NextResponse.json({ error: 'matchId/scorers fehlt.' }, { status: 400 })
  }

  for (const s of scorers) {
    if (!Number.isFinite(s.playerId) || !Number.isFinite(s.goals) || s.goals < 1) {
      return NextResponse.json({ error: 'Ungültiger Torschütze.' }, { status: 400 })
    }
  }

  const admin = createAdminClient()

  // Replace scorers for the match.
  const { error: delScorersError } = await admin.from('match_goalscorers').delete().eq('match_id', matchId)
  if (delScorersError) return NextResponse.json({ error: 'Torschützen konnten nicht gespeichert werden.' }, { status: 500 })
  if (scorers.length > 0) {
    const { error: insScorersError } = await admin.from('match_goalscorers').insert(
      scorers.map(s => ({
        match_id: matchId,
        player_id: s.playerId,
        goals: s.goals,
        is_own_goal: !!s.isOwnGoal,
      }))
    )
    if (insScorersError) return NextResponse.json({ error: 'Torschützen konnten nicht gespeichert werden – bitte erneut absenden.' }, { status: 500 })
  }

  // Aggregate goals per player (own goals don't count for player goalscorer bets).
  const goalsByPlayer = new Map<number, number>()
  for (const s of scorers) {
    if (s.isOwnGoal) continue
    goalsByPlayer.set(s.playerId, (goalsByPlayer.get(s.playerId) ?? 0) + s.goals)
  }

  // Pending goalscorer bets for this match.
  const { data: bets } = await admin
    .from('bets')
    .select('id, user_id, market_type, selection, stake, odds_value, combo_id, is_risky')
    .eq('match_id', matchId)
    .in('market_type', ['goalscorer', 'goalscorer_2plus'])
    .eq('status', 'pending')

  const userPayouts = new Map<string, number>()
  const combosToCheck = new Set<number>()
  const loserIds = new Set<string>()

  let settleErrors = 0
  for (const b of bets ?? []) {
    const playerId = parseInt(b.selection, 10)
    const goals = goalsByPlayer.get(playerId) ?? 0
    const won = b.market_type === 'goalscorer' ? goals >= 1 : goals >= 2
    let payout = 0
    if (won && b.combo_id == null) {
      payout = Math.round(cappedPayout(Number(b.stake), Number(b.odds_value), b.is_risky) * 100) / 100
    }
    // Atomic status flip + credit (settle_bet): double submits / concurrent settlements can never pay twice,
    // a failed credit rolls the status back so the bet stays pending and a re-submit pays it.
    const outcome = await settleSingle(admin, b.id, won ? 'won' : 'lost', payout)
    if (outcome === 'error') { settleErrors++; continue }
    if (outcome === 'skipped') continue
    if (won && b.combo_id == null) userPayouts.set(b.user_id, (userPayouts.get(b.user_id) ?? 0) + payout)
    else if (!won && b.combo_id == null) loserIds.add(b.user_id)
    if (b.combo_id != null) combosToCheck.add(b.combo_id)
  }
  // Self-healing: combos whose goalscorer legs were settled by an earlier crashed run but never evaluated.
  for (const id of await findStuckComboIds(admin, { matchId, markets: ['goalscorer', 'goalscorer_2plus'] })) combosToCheck.add(id)

  // Settle combos: mark lost immediately when any leg is lost; won when all settled and none lost.
  for (const comboId of combosToCheck) {
    const { data: legs } = await admin
      .from('bets').select('status, user_id, is_risky').eq('combo_id', comboId)
    if (!legs) continue
    const allSettled = legs.every(l => l.status !== 'pending')
    const anyLost = legs.some(l => l.status === 'lost')
    if (!anyLost && !allSettled) continue
    const { data: combo } = await admin
      .from('combo_bets').select('id, user_id, stake, total_odds, status').eq('id', comboId).single()
    if (!combo) continue
    if (combo.status !== 'pending') continue // already settled, skip
    if (anyLost) {
      const o = await settleCombo(admin, comboId, 'lost', 0)
      if (o === 'error') settleErrors++
    } else {
      // combo_bets has no is_risky column of its own — every leg carries the
      // same value, so any one leg reflects the combo's classification.
      const comboIsRisky = legs[0]?.is_risky ?? false
      const payout = Math.round(cappedPayout(Number(combo.stake), Number(combo.total_odds), comboIsRisky) * 100) / 100
      const o = await settleCombo(admin, comboId, 'won', payout)
      if (o === 'error') settleErrors++
      else if (o === 'applied') userPayouts.set(combo.user_id, (userPayouts.get(combo.user_id) ?? 0) + payout)
    }
  }

  // Apply balance updates + push notifications
  const jobs: Promise<unknown>[] = []
  for (const [userId, amount] of userPayouts) {
    if (amount <= 0) continue
    // Payout already credited atomically inside settle_bet/settle_combo; this loop only notifies.
    jobs.push(sendPushToUser(userId, '🎉 Wette gewonnen!', `+${fmtWildi(amount)} ${wildiLabel(amount)} wurden deinem Konto gutgeschrieben.`, '/profil'))
  }
  for (const uid of loserIds) {
    if (userPayouts.has(uid)) continue
    jobs.push(sendPushToUser(uid, '😬 Wette verloren', 'Deine Torschützenwette wurde leider nicht gewonnen.', '/tipps'))
  }
  await Promise.allSettled(jobs)

  // Goalscorer bets can be the LAST thing to settle for a Spieltag (the match
  // score settles first via /api/admin/settle, which skips awards/recap/
  // penalty while these are still pending). finalizeMatchdayIfDone checks
  // whether this Spieltag is now fully settled and, if so, runs the full
  // completion sequence (awards, recap push, inactivity penalty) — not just
  // awards, which this route used to compute on its own while silently
  // skipping the other two.
  try {
    await finalizeMatchdayIfDone(admin, matchId)
  } catch (e) { console.error('Matchday finalization failed (goalscorer settlement):', e) }

  // Same ISR-staleness fix as /api/admin/settle — see the comment there.
  // Wrapped for the same reason: payouts are already booked at this point.
  try {
    revalidatePath('/leaderboard')
    revalidatePath('/tipps')
    revalidatePath('/spieler/[id]', 'page')
  } catch (e) { console.error('revalidatePath after goalscorer settlement failed:', e) }

  return NextResponse.json({ success: true, settled: bets?.length ?? 0, combosChecked: combosToCheck.size, ...(settleErrors > 0 ? { warning: `${settleErrors} Abrechnung(en) fehlgeschlagen und zurückgerollt – bitte erneut absenden (idempotent).`, settleErrors } : {}) })
}
