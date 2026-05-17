import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser } from '@/lib/push'

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
  await admin.from('match_goalscorers').delete().eq('match_id', matchId)
  if (scorers.length > 0) {
    await admin.from('match_goalscorers').insert(
      scorers.map(s => ({
        match_id: matchId,
        player_id: s.playerId,
        goals: s.goals,
        is_own_goal: !!s.isOwnGoal,
      }))
    )
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
    .select('id, user_id, market_type, selection, stake, odds_value, combo_id')
    .eq('match_id', matchId)
    .in('market_type', ['goalscorer', 'goalscorer_2plus'])
    .eq('status', 'pending')

  const userPayouts = new Map<string, number>()
  const combosToCheck = new Set<number>()
  const loserIds = new Set<string>()

  for (const b of bets ?? []) {
    const playerId = parseInt(b.selection, 10)
    const goals = goalsByPlayer.get(playerId) ?? 0
    const won = b.market_type === 'goalscorer' ? goals >= 1 : goals >= 2
    let payout = 0
    if (won && b.combo_id == null) {
      payout = Math.round(Number(b.stake) * Number(b.odds_value) * 100) / 100
      userPayouts.set(b.user_id, (userPayouts.get(b.user_id) ?? 0) + payout)
    } else if (!won && b.combo_id == null) {
      loserIds.add(b.user_id)
    }
    await admin
      .from('bets')
      .update({ status: won ? 'won' : 'lost', payout: won ? payout : 0 })
      .eq('id', b.id)
    if (b.combo_id != null) combosToCheck.add(b.combo_id)
  }

  // Settle combos: mark lost immediately when any leg is lost; won when all settled and none lost.
  for (const comboId of combosToCheck) {
    const { data: legs } = await admin
      .from('bets').select('status, user_id').eq('combo_id', comboId)
    if (!legs) continue
    const allSettled = legs.every(l => l.status !== 'pending')
    const anyLost = legs.some(l => l.status === 'lost')
    if (!anyLost && !allSettled) continue
    const { data: combo } = await admin
      .from('combo_bets').select('id, user_id, stake, total_odds, status').eq('id', comboId).single()
    if (!combo) continue
    if (combo.status !== 'pending') continue // already settled, skip
    if (anyLost) {
      await admin.from('combo_bets').update({ status: 'lost', payout: 0 }).eq('id', comboId)
    } else {
      const payout = Math.round(Number(combo.stake) * Number(combo.total_odds) * 100) / 100
      await admin.from('combo_bets').update({ status: 'won', payout }).eq('id', comboId)
      userPayouts.set(combo.user_id, (userPayouts.get(combo.user_id) ?? 0) + payout)
    }
  }

  // Apply balance updates + push notifications
  const jobs: Promise<unknown>[] = []
  for (const [userId, amount] of userPayouts) {
    if (amount <= 0) continue
    const { data: p } = await admin.from('profiles').select('balance').eq('id', userId).single()
    if (!p) continue
    await admin.from('profiles').update({ balance: Number(p.balance) + amount }).eq('id', userId)
    jobs.push(sendPushToUser(userId, '🎉 Wette gewonnen!', `+${amount.toFixed(2)} € wurden deinem Konto gutgeschrieben.`, '/profil'))
  }
  for (const uid of loserIds) {
    if (userPayouts.has(uid)) continue
    jobs.push(sendPushToUser(uid, '😬 Wette verloren', 'Deine Torschützenwette wurde leider nicht gewonnen.', '/tipps'))
  }
  await Promise.allSettled(jobs)

  return NextResponse.json({ success: true, settled: bets?.length ?? 0, combosChecked: combosToCheck.size })
}
