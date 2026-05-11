import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface PlaceBetSelection {
  matchId: number
  marketType: string
  selection: string
  oddsValue: number
  stake: number
}

interface PlaceBetBody {
  selections: PlaceBetSelection[]
  mode: 'single' | 'combo'
  comboStake: number
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  }

  let body: PlaceBetBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const { selections, mode, comboStake } = body

  if (!selections || selections.length === 0) {
    return NextResponse.json({ error: 'Keine Auswahlen.' }, { status: 400 })
  }

  // Combo: reject mutually exclusive selections
  if (mode === 'combo') {
    for (let i = 0; i < selections.length; i++) {
      for (let j = i + 1; j < selections.length; j++) {
        const a = selections[i], b = selections[j]
        if (a.matchId !== b.matchId || a.marketType === b.marketType) continue
        const has = (m: string, s: string) =>
          (a.marketType === m && a.selection === s) || (b.marketType === m && b.selection === s)
        let bad = false
        if (has('1x2', 'home') && has('double_chance', 'x2')) bad = true
        if (has('1x2', 'away') && has('double_chance', '1x')) bad = true
        if (has('1x2', 'draw') && has('double_chance', '12')) bad = true
        const exact = a.marketType === 'exact_score' ? a : b.marketType === 'exact_score' ? b : null
        if (exact) {
          const [hg, ag] = exact.selection.split(':').map(Number)
          const t = hg + ag
          if (has('1x2', 'home') && ag > hg) bad = true
          if (has('1x2', 'away') && hg >= ag) bad = true
          if (has('1x2', 'draw') && hg !== ag) bad = true
          if (has('over_under_3_5', 'over_3.5') && t <= 3) bad = true
          if (has('over_under_3_5', 'under_3.5') && t >= 4) bad = true
          if (has('btts', 'yes') && (hg === 0 || ag === 0)) bad = true
          if (has('btts', 'no') && hg > 0 && ag > 0) bad = true
        }
        if (bad) return NextResponse.json(
          { error: 'Ungültige Kombiwette – widersprüchliche Wetten für dasselbe Spiel.' },
          { status: 400 }
        )
      }
    }
  }

  // Fetch matches to validate deadline
  const matchIds = [...new Set(selections.map((s) => s.matchId))]
  const { data: matches } = await supabase
    .from('matches')
    .select('id, match_date, status, matchday')
    .in('id', matchIds)

  if (!matches || matches.length !== matchIds.length) {
    return NextResponse.json({ error: 'Spiel nicht gefunden.' }, { status: 400 })
  }

  // Check that all matches are still scheduled
  for (const match of matches) {
    if (match.status !== 'scheduled') {
      return NextResponse.json(
        { error: `Annahmeschluss für dieses Spiel ist abgelaufen.` },
        { status: 400 }
      )
    }
    const matchDate = new Date(match.match_date)
    if (matchDate <= new Date()) {
      return NextResponse.json(
        { error: `Das Spiel hat bereits begonnen – keine Wetten mehr möglich.` },
        { status: 400 }
      )
    }
  }

  // Enforce max 2 bet actions per matchday
  const matchdayIds = [...new Set(matches.map((m) => m.matchday))]
  for (const matchday of matchdayIds) {
    // Count single bets (combo_id IS NULL) for this matchday
    const { count: singleCount } = await supabase
      .from('bets')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('combo_id', null)
      .in('match_id', matches.filter((m) => m.matchday === matchday).map((m) => m.id))

    // Count distinct combo bets for this matchday via their legs
    const { data: comboLegs } = await supabase
      .from('bets')
      .select('combo_id')
      .eq('user_id', user.id)
      .not('combo_id', 'is', null)
      .in('match_id', matches.filter((m) => m.matchday === matchday).map((m) => m.id))

    const distinctCombos = new Set((comboLegs ?? []).map((b) => b.combo_id)).size
    const existingCount = (singleCount ?? 0) + distinctCombos

    // New bets this submission for this matchday
    const newCount = mode === 'combo' ? 1 : selections.filter((s) => {
      const m = matches.find((match) => match.id === s.matchId)
      return m?.matchday === matchday
    }).length

    if (existingCount + newCount > 2) {
      return NextResponse.json(
        { error: `Maximal 2 Wetten pro Spieltag erlaubt. Du hast bereits ${existingCount} Wette(n) für Spieltag ${matchday} platziert.` },
        { status: 400 }
      )
    }
  }

  // Get user profile and balance
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('balance')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profil nicht gefunden.' }, { status: 400 })
  }

  // Calculate total cost
  let totalCost = 0
  if (mode === 'combo') {
    totalCost = comboStake
  } else {
    totalCost = selections.reduce((acc, s) => acc + (s.stake || 10), 0)
  }

  if (profile.balance < totalCost) {
    return NextResponse.json(
      { error: `Nicht genug Guthaben. Verfügbar: ${profile.balance.toFixed(2)}€, Benötigt: ${totalCost.toFixed(2)}€` },
      { status: 400 }
    )
  }

  // Place bets
  if (mode === 'combo') {
    const totalOdds = selections.reduce((acc, s) => acc * s.oddsValue, 1)

    // Create combo bet
    const { data: comboBet, error: comboError } = await supabase
      .from('combo_bets')
      .insert({
        user_id: user.id,
        stake: comboStake,
        total_odds: Math.round(totalOdds * 100) / 100,
        status: 'pending',
        payout: null,
      })
      .select('id')
      .single()

    if (comboError || !comboBet) {
      console.error('combo_bets insert error:', comboError)
      return NextResponse.json({ error: 'Fehler beim Erstellen der Kombiwette.' }, { status: 500 })
    }

    // Insert individual bet legs (no stake on legs for combo)
    const betRows = selections.map((s) => ({
      user_id: user.id,
      match_id: s.matchId,
      market_type: s.marketType,
      selection: s.selection,
      stake: null,
      odds_value: s.oddsValue,
      status: 'pending',
      payout: null,
      combo_id: comboBet.id,
    }))

    const { error: betsError } = await supabase.from('bets').insert(betRows)
    if (betsError) {
      console.error('bets insert error (combo legs):', betsError)
      return NextResponse.json({ error: 'Fehler beim Speichern der Wetten.' }, { status: 500 })
    }
  } else {
    // Single bets
    const betRows = selections.map((s) => ({
      user_id: user.id,
      match_id: s.matchId,
      market_type: s.marketType,
      selection: s.selection,
      stake: s.stake || 10,
      odds_value: s.oddsValue,
      status: 'pending',
      payout: null,
      combo_id: null,
    }))

    const { error: betsError } = await supabase.from('bets').insert(betRows)
    if (betsError) {
      console.error('bets insert error (single):', betsError)
      return NextResponse.json({ error: 'Fehler beim Speichern der Wetten.' }, { status: 500 })
    }
  }

  // Deduct balance
  const newBalance = profile.balance - totalCost
  const { error: balanceError } = await supabase
    .from('profiles')
    .update({ balance: newBalance })
    .eq('id', user.id)

  if (balanceError) {
    console.error('balance update error:', balanceError)
    return NextResponse.json({ error: 'Fehler beim Aktualisieren des Guthabens.' }, { status: 500 })
  }

  return NextResponse.json({ success: true, newBalance })
}
