import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { voidSlipWithRefund } from '@/lib/settlement'
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

  // Every slip is voided + refunded in ONE transaction (void_slip_refund): a concurrent user cancel or a second admin click can
  // never refund the same stake twice, and a failing refund rolls the void back instead of leaving a voided slip unpaid.
  const singleIds: number[] = []
  const comboIds = new Set<number>()
  for (const b of affectedBets ?? []) {
    if (b.combo_id == null) singleIds.push(b.id)
    else comboIds.add(b.combo_id)
  }
  const perUser = new Map<string, number>()
  const userOf = new Map<number, string>((affectedBets ?? []).map((b) => [b.id, b.user_id as string]))
  let refundedSingles = 0, refundedCombos = 0, failures = 0
  for (const id of singleIds) {
    try {
      const amt = await voidSlipWithRefund(admin, 'single', id, 'admin_special_voided')
      if (amt != null) { refundedSingles++; const u = userOf.get(id)!; perUser.set(u, (perUser.get(u) ?? 0) + amt) }
    } catch (e) { failures++; console.error('special void single failed', { id, e }) }
  }
  for (const comboId of comboIds) {
    const { data: combo } = await admin.from('combo_bets').select('user_id').eq('id', comboId).single()
    try {
      const amt = await voidSlipWithRefund(admin, 'combo', comboId, 'admin_special_voided', { allLegs: true })
      if (amt != null && combo) { refundedCombos++; perUser.set(combo.user_id, (perUser.get(combo.user_id) ?? 0) + amt) }
    } catch (e) { failures++; console.error('special void combo failed', { comboId, e }) }
  }
  if (failures > 0) {
    // Do NOT mark the special void: re-running the void is idempotent and finishes the remaining slips.
    return NextResponse.json({ error: `${failures} Stornierung(en) fehlgeschlagen und zurückgerollt – bitte erneut ausführen (idempotent).`, refundedSingles, refundedCombos }, { status: 500 })
  }

  await admin.from('matchday_specials').update({ status: 'void' }).eq('id', specialId)

  return NextResponse.json({ ok: true, refundedSingles, refundedCombos, affectedUsers: perUser.size })
}
