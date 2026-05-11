import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function settleBet(
  marketType: string,
  selection: string,
  homeScore: number,
  awayScore: number
): 'won' | 'lost' {
  switch (marketType) {
    case '1x2': {
      if (homeScore > awayScore && selection === 'home') return 'won'
      if (homeScore === awayScore && selection === 'draw') return 'won'
      if (homeScore < awayScore && selection === 'away') return 'won'
      return 'lost'
    }
    case 'over_under': {
      const total = homeScore + awayScore
      if (total > 2.5 && selection === 'over') return 'won'
      if (total <= 2.5 && selection === 'under') return 'won'
      return 'lost'
    }
    case 'btts': {
      const bothScored = homeScore > 0 && awayScore > 0
      if (bothScored && selection === 'yes') return 'won'
      if (!bothScored && selection === 'no') return 'won'
      return 'lost'
    }
    case 'exact_score': {
      // selection format: "2:1"
      const parts = selection.split(':')
      if (parts.length !== 2) return 'lost'
      const selHome = parseInt(parts[0])
      const selAway = parseInt(parts[1])
      if (selHome === homeScore && selAway === awayScore) return 'won'
      return 'lost'
    }
    default:
      return 'lost'
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  }

  // Check admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })
  }

  let body: { matchId: number; homeScore: number; awayScore: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const { matchId, homeScore, awayScore } = body

  if (typeof matchId !== 'number' || typeof homeScore !== 'number' || typeof awayScore !== 'number') {
    return NextResponse.json({ error: 'Ungültige Parameter.' }, { status: 400 })
  }

  // Update match
  const { error: matchError } = await supabase
    .from('matches')
    .update({
      home_score: homeScore,
      away_score: awayScore,
      status: 'finished',
    })
    .eq('id', matchId)

  if (matchError) {
    return NextResponse.json({ error: 'Fehler beim Aktualisieren des Spiels.' }, { status: 500 })
  }

  // Fetch all pending single bets for this match
  const { data: pendingBets, error: betsError } = await supabase
    .from('bets')
    .select('id, user_id, market_type, selection, stake, odds_value, combo_id')
    .eq('match_id', matchId)
    .eq('status', 'pending')

  if (betsError) {
    return NextResponse.json({ error: 'Fehler beim Abrufen der Wetten.' }, { status: 500 })
  }

  if (!pendingBets || pendingBets.length === 0) {
    return NextResponse.json({ success: true, settled: 0 })
  }

  // Settle each bet
  const userBalanceUpdates: Record<string, number> = {}
  const settledBetIds: number[] = []
  const combosToCheck = new Set<number>()

  for (const bet of pendingBets) {
    const result = settleBet(bet.market_type, bet.selection, homeScore, awayScore)
    let payout = 0

    if (result === 'won' && bet.combo_id === null) {
      // Single bet win: payout = stake * odds
      payout = Math.round(bet.stake * bet.odds_value * 100) / 100
      userBalanceUpdates[bet.user_id] = (userBalanceUpdates[bet.user_id] ?? 0) + payout
    }

    // Update the bet
    await supabase
      .from('bets')
      .update({ status: result, payout: result === 'won' ? payout : 0 })
      .eq('id', bet.id)

    settledBetIds.push(bet.id)

    if (bet.combo_id !== null) {
      combosToCheck.add(bet.combo_id)
    }
  }

  // Handle combo bets
  for (const comboId of combosToCheck) {
    // Fetch all legs of this combo
    const { data: comboLegs } = await supabase
      .from('bets')
      .select('id, status, odds_value, user_id')
      .eq('combo_id', comboId)

    if (!comboLegs) continue

    const allSettled = comboLegs.every((leg) => leg.status !== 'pending')
    const anyLost = comboLegs.some((leg) => leg.status === 'lost')

    if (!allSettled) continue // Still waiting for other matches

    const { data: comboBet } = await supabase
      .from('combo_bets')
      .select('id, stake, total_odds, user_id')
      .eq('id', comboId)
      .single()

    if (!comboBet) continue

    if (anyLost) {
      await supabase
        .from('combo_bets')
        .update({ status: 'lost', payout: 0 })
        .eq('id', comboId)
    } else {
      // All legs won
      const payout = Math.round(comboBet.stake * comboBet.total_odds * 100) / 100
      await supabase
        .from('combo_bets')
        .update({ status: 'won', payout })
        .eq('id', comboId)

      userBalanceUpdates[comboBet.user_id] = (userBalanceUpdates[comboBet.user_id] ?? 0) + payout
    }
  }

  // Apply balance updates
  for (const [userId, amount] of Object.entries(userBalanceUpdates)) {
    if (amount <= 0) continue
    const { data: currentProfile } = await supabase
      .from('profiles')
      .select('balance')
      .eq('id', userId)
      .single()

    if (!currentProfile) continue

    await supabase
      .from('profiles')
      .update({ balance: currentProfile.balance + amount })
      .eq('id', userId)
  }

  return NextResponse.json({
    success: true,
    settled: settledBetIds.length,
    combosChecked: combosToCheck.size,
  })
}
