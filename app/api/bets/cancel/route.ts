import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

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
    const { data: combo } = await supabase
      .from('combo_bets')
      .select('id, user_id, stake, status')
      .eq('id', comboId)
      .single()

    if (!combo || combo.user_id !== user.id) {
      return NextResponse.json({ error: 'Wette nicht gefunden.' }, { status: 404 })
    }
    if (combo.status !== 'pending') {
      return NextResponse.json({ error: 'Nur offene Wetten können storniert werden.' }, { status: 400 })
    }

    // Find all legs to determine if any match has actually started
    const { data: allLegs } = await supabase
      .from('bets')
      .select('match_id')
      .eq('combo_id', comboId)

    if (!allLegs || allLegs.length === 0) {
      return NextResponse.json({ error: 'Keine Wett-Legs gefunden.' }, { status: 400 })
    }

    const allMatchIds = allLegs.map((l) => l.match_id)
    const { data: comboMatches } = await supabase
      .from('matches')
      .select('match_date, status')
      .in('id', allMatchIds)

    // Block if any match has actually started (not just postponed — postponed means no kickoff yet)
    const startedMatch = (comboMatches ?? []).find(
      (m) => m.status !== 'postponed' && new Date(m.match_date) <= new Date()
    )
    if (startedMatch) {
      return NextResponse.json(
        { error: 'Eines der Spiele hat bereits begonnen — Stornierung nicht mehr möglich.' },
        { status: 400 }
      )
    }

    // Delete legs first (FK constraint), then combo_bet row
    await supabase.from('bets').delete().eq('combo_id', comboId)
    await supabase.from('combo_bets').delete().eq('id', comboId)

    // Refund stake atomically (avoids the stale-read-then-write race a plain
    // select+update would have if two cancellations/settlements overlap)
    const { data: newBalance, error: refundError } = await supabase.rpc('increment_balance', {
      p_user_id: user.id,
      p_amount: combo.stake,
    })
    if (refundError) {
      console.error('combo refund error:', refundError)
      return NextResponse.json({ error: 'Fehler bei der Rückerstattung.' }, { status: 500 })
    }

    return NextResponse.json({ success: true, newBalance })
  } else {
    // Single bet cancellation
    const { data: bet } = await supabase
      .from('bets')
      .select('id, user_id, match_id, stake, status, combo_id')
      .eq('id', betId!)
      .single()

    if (!bet || bet.user_id !== user.id) {
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
    const { data: betMatch } = await supabase
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

    await supabase.from('bets').delete().eq('id', bet.id)

    const { data: newBalance, error: refundError } = await supabase.rpc('increment_balance', {
      p_user_id: user.id,
      p_amount: bet.stake ?? 0,
    })
    if (refundError) {
      console.error('single bet refund error:', refundError)
      return NextResponse.json({ error: 'Fehler bei der Rückerstattung.' }, { status: 500 })
    }

    return NextResponse.json({ success: true, newBalance })
  }
}
