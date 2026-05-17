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

    // Find one leg to determine the matchday deadline
    const { data: legs } = await supabase
      .from('bets')
      .select('match_id')
      .eq('combo_id', comboId)
      .limit(1)

    if (!legs || legs.length === 0) {
      return NextResponse.json({ error: 'Keine Wett-Legs gefunden.' }, { status: 400 })
    }

    // Get matchday of the leg, then find the first match of that matchday
    const { data: legMatch } = await supabase
      .from('matches')
      .select('matchday')
      .eq('id', legs[0].match_id)
      .single()

    if (!legMatch) return NextResponse.json({ error: 'Spiel nicht gefunden.' }, { status: 400 })

    const { data: firstMatch } = await supabase
      .from('matches')
      .select('match_date')
      .eq('matchday', legMatch.matchday)
      .order('match_date', { ascending: true })
      .limit(1)
      .single()

    if (!firstMatch || new Date(firstMatch.match_date) <= new Date()) {
      return NextResponse.json(
        { error: 'Der Spieltag hat begonnen — Stornierung nicht mehr möglich.' },
        { status: 400 }
      )
    }

    // Delete legs first (FK constraint), then combo_bet row
    await supabase.from('bets').delete().eq('combo_id', comboId)
    await supabase.from('combo_bets').delete().eq('id', comboId)

    // Refund stake
    const { data: profile } = await supabase
      .from('profiles').select('balance').eq('id', user.id).single()
    const newBalance = (profile?.balance ?? 0) + combo.stake
    await supabase.from('profiles').update({ balance: newBalance }).eq('id', user.id)

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

    // Find first match of the matchday
    const { data: betMatch } = await supabase
      .from('matches')
      .select('matchday')
      .eq('id', bet.match_id)
      .single()

    if (!betMatch) return NextResponse.json({ error: 'Spiel nicht gefunden.' }, { status: 400 })

    const { data: firstMatch } = await supabase
      .from('matches')
      .select('match_date')
      .eq('matchday', betMatch.matchday)
      .order('match_date', { ascending: true })
      .limit(1)
      .single()

    if (!firstMatch || new Date(firstMatch.match_date) <= new Date()) {
      return NextResponse.json(
        { error: 'Der Spieltag hat begonnen — Stornierung nicht mehr möglich.' },
        { status: 400 }
      )
    }

    await supabase.from('bets').delete().eq('id', bet.id)

    const { data: profile } = await supabase
      .from('profiles').select('balance').eq('id', user.id).single()
    const newBalance = (profile?.balance ?? 0) + (bet.stake ?? 0)
    await supabase.from('profiles').update({ balance: newBalance }).eq('id', user.id)

    return NextResponse.json({ success: true, newBalance })
  }
}
