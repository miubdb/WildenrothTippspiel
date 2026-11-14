import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { voidSlipWithRefund } from '@/lib/settlement'
import { recomputeRiskyForUserMatchday } from '@/lib/risky'
import { hasStartedCombo } from '@/lib/betStart'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  // Mutations use the service-role client — see app/api/bets/place/route.ts for why
  // (bets/combo_bets writes and the balance RPCs are locked down to service-role).
  // Every write below stays scoped to `user.id` from the verified session below.
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  const userId = user.id

  // Recomputes and persists Risky classification for every Spieltag touched
  // by `matchIds` — cancelling a slip can change which of the user's
  // remaining slips (if any) is now Risky (see lib/risky.ts).
  async function recomputeAffectedMatchdays(matchIds: number[]) {
    // Cancelled legs keep their immutable owner; neither date changes nor
    // technical Special anchors may reassign their Risky classification.
    const { data: affectedLegs, error } = await admin
      .from('bets').select('placed_matchday').eq('user_id', userId).in('match_id', matchIds)
    if (error) { console.error('Unable to determine cancelled slip owner:', error); return }
    const mds = [...new Set((affectedLegs ?? []).map((b) => b.placed_matchday).filter((x): x is number => x != null))]
    for (const md of mds) await recomputeRiskyForUserMatchday(admin, userId, md)
  }

  let body: { betId?: number; comboId?: number }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const { betId, comboId } = body

  if (!betId && !comboId) {
    return NextResponse.json({ error: 'betId oder comboId erforderlich.' }, { status: 400 })
  }

  if (comboId) {
    // Combo cancellation
    // Service-role read, explicitly scoped to this user's own id in the query
    // itself (not just checked afterwards) — this is a security boundary, so
    // it must not depend on the session-scoped RLS policy currently allowing
    // (or, via a future regression, disallowing) the caller to see this row.
    // Scoping by user_id in the query also means a foreign combo id can never
    // resolve to a row here, regardless of RLS state.
    const { data: combo } = await admin
      .from('combo_bets')
      .select('id, user_id, stake, status')
      .eq('id', comboId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!combo) {
      return NextResponse.json({ error: 'Wette nicht gefunden.' }, { status: 404 })
    }
    if (combo.status !== 'pending') {
      return NextResponse.json({ error: 'Nur offene Wetten können storniert werden.' }, { status: 400 })
    }

    // Einheitliche Anpfiff-Definition wie in der Admin-Annullierungsvorschau.
    // Auch ein bereits gewonnenes/verlorenes Leg heißt: Kombi hat begonnen.
    // Nur neutralisierte/void Legs blockieren die Stornierung nicht.
    const { data: allLegs, error: allLegsError } = await admin
      .from('bets')
      .select('match_id, status')
      .eq('combo_id', comboId)

    if (allLegsError || !allLegs || allLegs.length === 0) {
      return NextResponse.json({ error: 'Wett-Legs konnten nicht geladen werden.' }, { status: 500 })
    }

    const allMatchIds = [...new Set(allLegs.map((l) => l.match_id))]
    const { data: comboMatches, error: matchLoadError } = await admin
      .from('matches')
      .select('id, match_date, status')
      .in('id', allMatchIds)

    if (matchLoadError || !comboMatches || comboMatches.length !== allMatchIds.length) {
      return NextResponse.json({ error: 'Spieltermine konnten nicht vollständig geladen werden.' }, { status: 500 })
    }

    if (!allLegs.some(l => l.status === 'pending')) {
      return NextResponse.json({ error: 'Diese Kombi hat keine offenen Tipps mehr und kann nicht erneut storniert werden.' }, { status: 409 })
    }

    if (hasStartedCombo(allLegs, comboMatches)) {
      return NextResponse.json(
        { error: 'Eines der Spiele hat bereits begonnen — Stornierung nicht mehr möglich.' },
        { status: 400 }
      )
    }

    // Void + refund in ONE transaction (void_slip_refund, user-scoped): legs pending/neutralized -> void, parent -> void,
    // stake credited. null = someone else already cancelled/settled it -> nothing refunded. A refund error rolls the void
    // back, so a failed refund can never leave a voided-but-unpaid slip (the old code voided first, then credited).
    let refunded: number | null
    try {
      refunded = await voidSlipWithRefund(admin, 'combo', comboId, 'user_cancelled', { userId: user.id })
    } catch (e) {
      console.error('combo cancel+refund error:', e)
      return NextResponse.json({ error: 'Fehler beim Stornieren.' }, { status: 500 })
    }
    if (refunded == null) {
      return NextResponse.json({ error: 'Wette wurde bereits storniert oder abgerechnet.' }, { status: 409 })
    }
    const { data: balRow } = await admin.from('profiles').select('balance').eq('id', user.id).single()
    const newBalance = balRow?.balance ?? null

    await recomputeAffectedMatchdays(allMatchIds)

    revalidatePath('/tipps')
    revalidatePath('/leaderboard')
    return NextResponse.json({ success: true, newBalance })
  } else {
    // Single bet cancellation
    // Service-role read, explicitly scoped to user_id in the query itself —
    // same rationale as the combo branch above.
    const { data: bet } = await admin
      .from('bets')
      .select('id, user_id, match_id, stake, status, combo_id')
      .eq('id', betId!)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!bet) {
      return NextResponse.json({ error: 'Wette nicht gefunden.' }, { status: 404 })
    }
    if (bet.status !== 'pending') {
      return NextResponse.json({ error: 'Nur offene Wetten können storniert werden.' }, { status: 400 })
    }
    if (bet.combo_id !== null) {
      return NextResponse.json(
        { error: 'Kombiwetten bitte über die gesamte Kombination stornieren.' },
        { status: 400 }
      )
    }

    // Check that this specific match has not yet kicked off
    const { data: betMatch } = await admin
      .from('matches')
      .select('match_date, status')
      .eq('id', bet.match_id)
      .single()

    if (!betMatch) return NextResponse.json({ error: 'Spiel nicht gefunden.' }, { status: 400 })

    // Postponed matches have no actual kickoff yet — cancellation stays open regardless of original date
    if (betMatch.status !== 'postponed' && new Date(betMatch.match_date) <= new Date()) {
      return NextResponse.json(
        { error: 'Das Spiel hat bereits begonnen — Stornierung nicht mehr möglich.' },
        { status: 400 }
      )
    }

    // Soft-cancel + refund atomically (see combo branch above).
    let refundedSingle: number | null
    try {
      refundedSingle = await voidSlipWithRefund(admin, 'single', bet.id, 'user_cancelled', { userId: user.id })
    } catch (e) {
      console.error('single bet cancel+refund error:', e)
      return NextResponse.json({ error: 'Fehler beim Stornieren.' }, { status: 500 })
    }
    if (refundedSingle == null) {
      return NextResponse.json({ error: 'Wette wurde bereits storniert oder abgerechnet.' }, { status: 409 })
    }
    const { data: balRowSingle } = await admin.from('profiles').select('balance').eq('id', user.id).single()
    const newBalance = balRowSingle?.balance ?? null

    await recomputeAffectedMatchdays([bet.match_id])

    revalidatePath('/tipps')
    revalidatePath('/leaderboard')
    return NextResponse.json({ success: true, newBalance })
  }
}
