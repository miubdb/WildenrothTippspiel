import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser, sendPushToAll } from '@/lib/push'

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
    case 'double_chance': {
      if (selection === '1x' && homeScore >= awayScore) return 'won'
      if (selection === 'x2' && awayScore >= homeScore) return 'won'
      if (selection === '12' && homeScore !== awayScore) return 'won'
      return 'lost'
    }
    case 'over_under': {
      const total = homeScore + awayScore
      if (total > 2.5 && (selection === 'over' || selection === 'over_2.5')) return 'won'
      if (total <= 2.5 && (selection === 'under' || selection === 'under_2.5')) return 'won'
      return 'lost'
    }
    case 'over_under_3_5': {
      const total = homeScore + awayScore
      if (total > 3.5 && selection === 'over_3.5') return 'won'
      if (total <= 3.5 && selection === 'under_3.5') return 'won'
      return 'lost'
    }
    case 'btts': {
      const bothScored = homeScore > 0 && awayScore > 0
      if (bothScored && selection === 'yes') return 'won'
      if (!bothScored && selection === 'no') return 'won'
      return 'lost'
    }
    case 'over_under_5_5': {
      const total = homeScore + awayScore
      if (total > 5.5 && selection === 'over_5.5') return 'won'
      if (total <= 5.5 && selection === 'under_5.5') return 'won'
      return 'lost'
    }
    case 'over_under_7_5': {
      const total = homeScore + awayScore
      if (total > 7.5 && selection === 'over_7.5') return 'won'
      if (total <= 7.5 && selection === 'under_7.5') return 'won'
      return 'lost'
    }
    case 'handicap': {
      const diff = homeScore - awayScore
      if (selection === 'home_minus_1_5') return diff >= 2 ? 'won' : 'lost'
      if (selection === 'away_plus_1_5')  return diff <= 1 ? 'won' : 'lost'
      if (selection === 'home_minus_2_5') return diff >= 3 ? 'won' : 'lost'
      if (selection === 'away_plus_2_5')  return diff <= 2 ? 'won' : 'lost'
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

  // Fetch all pending single bets for this match (skip goalscorer markets — those settle
  // separately once the admin enters who scored, which depends on more than the final score)
  const { data: pendingBets, error: betsError } = await supabase
    .from('bets')
    .select('id, user_id, market_type, selection, stake, odds_value, combo_id')
    .eq('match_id', matchId)
    .eq('status', 'pending')
    .not('market_type', 'in', '("goalscorer","goalscorer_2plus")')

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

    // A combo is lost as soon as one leg is lost — no need to wait for remaining legs.
    if (!anyLost && !allSettled) continue // Still pending, no losses yet

    const { data: comboBet } = await supabase
      .from('combo_bets')
      .select('id, stake, total_odds, user_id, status')
      .eq('id', comboId)
      .single()

    if (!comboBet) continue
    // Skip if already settled to avoid double-processing
    if (comboBet.status !== 'pending') continue

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

  // Apply balance updates + push notifications
  const pushNotifications: Promise<void>[] = []

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

    pushNotifications.push(
      sendPushToUser(userId, '🎉 Wette gewonnen!', `+${amount.toFixed(2)} € wurden deinem Konto gutgeschrieben.`, '/profil')
    )
  }

  // Notify losers (users with settled bets that lost and no balance gain)
  const loserIds = new Set(
    pendingBets
      .filter(b => b.combo_id === null)
      .map(b => b.user_id)
      .filter(uid => !userBalanceUpdates[uid])
  )
  for (const uid of loserIds) {
    pushNotifications.push(
      sendPushToUser(uid, '😬 Wette verloren', 'Deine Wette wurde leider nicht gewonnen. Viel Glück beim nächsten Spieltag!', '/tipps')
    )
  }

  await Promise.allSettled(pushNotifications)

  // Check if the entire matchday is now complete → send recap push (once)
  const { data: matchInfo } = await supabase
    .from('matches')
    .select('matchday')
    .eq('id', matchId)
    .single()

  if (matchInfo) {
    const { matchday } = matchInfo
    const { data: matchdayMatches } = await supabase
      .from('matches')
      .select('status')
      .eq('matchday', matchday)

    const allFinished =
      matchdayMatches &&
      matchdayMatches.length > 0 &&
      matchdayMatches.every((m) => m.status === 'finished')

    if (allFinished) {
      const admin = createAdminClient()
      const { error: dedupError } = await admin
        .from('push_reminders')
        .insert({ type: 'recap', matchday })

      if (!dedupError) {
        // Only send if insert succeeded (prevents duplicate on concurrent requests)
        await sendPushToAll(
          '📊 Spieltags-Recap verfügbar',
          `Der ${matchday}. Spieltag ist abgeschlossen – schau dir die Highlights an!`,
          `/tipps?matchday=${matchday}`
        )
      }
    }
  }

  return NextResponse.json({
    success: true,
    settled: settledBetIds.length,
    combosChecked: combosToCheck.size,
  })
}
