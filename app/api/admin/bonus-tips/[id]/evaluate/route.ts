import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeCorrectOptionKeys, loadRelevantMatches, isAutoEvaluable, type BonusTip } from '@/lib/bonusTips'

/**
 * Wertet einen Bonus-Tipp aus und schreibt Gutschriften. Idempotent: erneuter
 * Aufruf wiederholt die Berechnung (harmlos) und ruft für jeden Nutzer erneut
 * die evaluate_bonus_tip_payout-RPC auf — die schreibt dank ihres unique
 * constraints (bonus_tip_id, user_id) beim zweiten Mal nichts mehr und erhöht
 * die Balance nicht nochmal (siehe Migration add_bonus_tips_system).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tipId = parseInt(id, 10)
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  const admin = createAdminClient()
  const { data: tipRaw } = await admin.from('bonus_tips').select('*').eq('id', tipId).single()
  if (!tipRaw) return NextResponse.json({ error: 'Bonus-Tipp nicht gefunden.' }, { status: 404 })
  const tip = tipRaw as BonusTip

  if (new Date(tip.closes_at) > new Date()) {
    return NextResponse.json({ error: 'Der Tippschluss ist noch nicht erreicht.' }, { status: 400 })
  }

  let correctKeys: string[] | null
  if (isAutoEvaluable(tip.type)) {
    const matches = await loadRelevantMatches(supabase, tip)
    correctKeys = computeCorrectOptionKeys(tip, matches)
    if (correctKeys == null) {
      return NextResponse.json({ error: 'Die zugrunde liegenden Spiele sind noch nicht (alle) beendet — Auswertung noch nicht möglich.' }, { status: 400 })
    }
  } else {
    // long_term: Admin muss das Ergebnis vorher per PATCH gesetzt haben.
    if (!tip.correct_option_keys || tip.correct_option_keys.length === 0) {
      return NextResponse.json({ error: 'Für Langzeit-Tipps muss zuerst per Bearbeiten das korrekte Ergebnis gesetzt werden.' }, { status: 400 })
    }
    correctKeys = tip.correct_option_keys
  }

  const { data: answers } = await admin
    .from('bonus_tip_answers')
    .select('user_id, answer_key')
    .eq('bonus_tip_id', tipId)

  let paidCount = 0
  let correctCount = 0
  for (const a of answers ?? []) {
    if (!correctKeys.includes(a.answer_key)) continue
    correctCount++
    const { data: wasNew } = await admin.rpc('evaluate_bonus_tip_payout', {
      p_bonus_tip_id: tipId,
      p_user_id: a.user_id,
      p_amount: tip.reward_wildis,
    })
    if (wasNew) paidCount++
  }

  await admin
    .from('bonus_tips')
    .update({ correct_option_keys: correctKeys, evaluated_at: new Date().toISOString() })
    .eq('id', tipId)

  return NextResponse.json({ ok: true, correctKeys, correctCount, paidCount, totalAnswers: (answers ?? []).length })
}
