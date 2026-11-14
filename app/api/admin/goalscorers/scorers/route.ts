import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser } from '@/lib/push'
import { fmtWildi, wildiLabel } from '@/components/WildiIcon'
import { finalizeMatchdayIfDone } from '@/lib/matchdayFinalize'
import { resolveWildenrothGoals, settleGoalscorerMarket, validateScorerReport } from '@/lib/goalscorerSettlement'

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

  // Validate the list against Wildenroth's REAL goal count before anything is written: an incomplete
  // list must never be stored as the match's scorers, and never be read as "nobody scored".
  const ctx = await resolveWildenrothGoals(admin, matchId)
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const report = validateScorerReport(ctx.teamGoals, scorers)
  if (!report.ok) return NextResponse.json({ error: report.error }, { status: 400 })

  // Replace scorers for the match.
  const { error: delScorersError } = await admin.from('match_goalscorers').delete().eq('match_id', matchId)
  if (delScorersError) return NextResponse.json({ error: 'Torschützen konnten nicht gespeichert werden.' }, { status: 500 })
  if (scorers.length > 0) {
    const { error: insScorersError } = await admin.from('match_goalscorers').insert(
      scorers.map(s => ({ match_id: matchId, player_id: s.playerId, goals: s.goals, is_own_goal: !!s.isOwnGoal }))
    )
    if (insScorersError) return NextResponse.json({ error: 'Torschützen konnten nicht gespeichert werden – bitte erneut absenden.' }, { status: 500 })
  }

  // Atomic, idempotent settlement (settle_bet / settle_combo). A repeated call only touches still-pending bets.
  const result = await settleGoalscorerMarket(admin, matchId, scorers)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  const { payouts: userPayouts, losers: loserIds, settleErrors } = result

  // Push notifications (payouts were already credited inside the settlement transaction)
  const jobs: Promise<unknown>[] = []
  for (const [userId, amount] of userPayouts) {
    if (amount <= 0) continue
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

  return NextResponse.json({ success: true, settled: result.settled, combosChecked: result.combosChecked, ...(settleErrors > 0 ? { warning: `${settleErrors} Abrechnung(en) fehlgeschlagen und zurückgerollt – bitte erneut absenden (idempotent).`, settleErrors } : {}) })
}
