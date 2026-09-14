import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Voids a Spieltag-Special whose included matches can't all reach a regular
 * final result (postponed/abandoned fixture — SPIELTAG-SPECIALS requirement
 * 11). Refunds every affected bet/leg using the SAME soft-cancel pattern as
 * app/api/admin/goalscorers/cancel-player/route.ts: a single leg voids its
 * whole combo (can't partially settle a combo), single bets are refunded
 * directly. No line/odds are ever changed — only status/void_reason/payout.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const specialId = parseInt(id, 10)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  const admin = createAdminClient()
  const { data: special } = await admin.from('matchday_specials').select('id, status').eq('id', specialId).single()
  if (!special) return NextResponse.json({ error: 'Special nicht gefunden.' }, { status: 404 })
  if (special.status === 'settled' || special.status === 'void') {
    return NextResponse.json({ error: 'Bereits abgerechnet oder storniert.' }, { status: 400 })
  }

  const { data: affectedBets } = await admin
    .from('bets')
    .select('id, user_id, stake, combo_id')
    .eq('special_id', specialId)
    .eq('status', 'pending')

  const refunds: { userId: string; amount: number }[] = []
  const singleIds: number[] = []
  const comboIds = new Set<number>()
  for (const b of affectedBets ?? []) {
    if (b.combo_id == null) {
      singleIds.push(b.id)
      refunds.push({ userId: b.user_id, amount: Number(b.stake ?? 0) })
    } else {
      comboIds.add(b.combo_id)
    }
  }

  if (singleIds.length > 0) {
    await admin.from('bets').update({ status: 'void', void_reason: 'admin_special_voided' }).in('id', singleIds)
  }
  for (const comboId of comboIds) {
    const { data: combo } = await admin.from('combo_bets').select('id, user_id, stake').eq('id', comboId).single()
    if (!combo) continue
    await admin.from('bets').update({ status: 'void', void_reason: 'admin_special_voided' }).eq('combo_id', comboId)
    await admin.from('combo_bets').update({ status: 'void', void_reason: 'admin_special_voided' }).eq('id', comboId)
    refunds.push({ userId: combo.user_id, amount: Number(combo.stake) })
  }

  const perUser = new Map<string, number>()
  for (const r of refunds) perUser.set(r.userId, (perUser.get(r.userId) ?? 0) + r.amount)
  for (const [userId, amount] of perUser) {
    await admin.rpc('increment_balance', { p_user_id: userId, p_amount: amount })
  }

  await admin.from('matchday_specials').update({ status: 'void' }).eq('id', specialId)

  return NextResponse.json({ ok: true, refundedSingles: singleIds.length, refundedCombos: comboIds.size, affectedUsers: perUser.size })
}
