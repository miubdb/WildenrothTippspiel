import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser } from '@/lib/push'
import { wildiLabel } from '@/components/WildiIcon'
import { finalizeMatchdayIfDone } from '@/lib/matchdayFinalize'

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
      // Mirrored (away-favoured) direction.
      if (selection === 'away_minus_1_5') return diff <= -2 ? 'won' : 'lost'
      if (selection === 'home_plus_1_5')  return diff >= -1 ? 'won' : 'lost'
      if (selection === 'away_minus_2_5') return diff <= -3 ? 'won' : 'lost'
      if (selection === 'home_plus_2_5')  return diff >= -2 ? 'won' : 'lost'
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
  // bets/combo_bets UPDATE and the balance RPCs are service-role-only (see
  // app/api/bets/place/route.ts) — this route already re-checks is_admin below,
  // so every write via `admin` here stays gated by that same check.
  const admin = createAdminClient()

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

  if (
    typeof matchId !== 'number' ||
    typeof homeScore !== 'number' || !Number.isInteger(homeScore) || homeScore < 0 ||
    typeof awayScore !== 'number' || !Number.isInteger(awayScore) || awayScore < 0
  ) {
    return NextResponse.json({ error: 'Ungültige Parameter.' }, { status: 400 })
  }

  // Refuse to re-settle an already-finished match: overwriting the score here would
  // silently desync it from already-paid-out bets (settlement below only ever touches
  // bets with status='pending', so a second call can't correct prior payouts) — fail
  // loudly instead of corrupting balances quietly.
  const { data: existingMatch } = await supabase
    .from('matches')
    .select('status')
    .eq('id', matchId)
    .single()

  if (existingMatch?.status === 'finished') {
    return NextResponse.json(
      { error: 'Dieses Spiel wurde bereits abgerechnet. Eine Korrektur ist über diese Funktion nicht möglich.' },
      { status: 409 }
    )
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
    await admin
      .from('bets')
      .update({ status: result, payout: result === 'won' ? payout : 0 })
      .eq('id', bet.id)

    settledBetIds.push(bet.id)

    if (bet.combo_id !== null) {
      combosToCheck.add(bet.combo_id)
    }
  }

  // Handle combo bets. A combo can span several matches settled on different
  // days — once it's decided (lost via one bad leg, or won once the last leg
  // settles), its OTHER legs still get settled individually as their own
  // matches finish, which re-adds the same comboId to combosToCheck every
  // time. Track exactly which combos this call itself newly resolved
  // (pending -> lost/won) so the push-notification summary below counts each
  // combo's outcome exactly once — otherwise a lost combo re-fires "verloren"
  // on every subsequent (already-moot) leg's match settlement.
  const newlyResolvedCombos = new Map<number, { user_id: string; status: 'won' | 'lost' }>()
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
    // Skip if already settled to avoid double-processing (and double-notifying).
    if (comboBet.status !== 'pending') continue

    if (anyLost) {
      await admin
        .from('combo_bets')
        .update({ status: 'lost', payout: 0 })
        .eq('id', comboId)
      newlyResolvedCombos.set(comboId, { user_id: comboBet.user_id, status: 'lost' })
    } else {
      // All legs won
      const payout = Math.round(comboBet.stake * comboBet.total_odds * 100) / 100
      await admin
        .from('combo_bets')
        .update({ status: 'won', payout })
        .eq('id', comboId)

      userBalanceUpdates[comboBet.user_id] = (userBalanceUpdates[comboBet.user_id] ?? 0) + payout
      newlyResolvedCombos.set(comboId, { user_id: comboBet.user_id, status: 'won' })
    }
  }

  // Collect per-user win/loss summary for bundled push
  const userWonCount: Record<string, number> = {}
  const userLostCount: Record<string, number> = {}
  for (const bet of pendingBets) {
    if (bet.combo_id !== null) continue // combos handled separately below
    const result = settleBet(bet.market_type, bet.selection, homeScore, awayScore)
    if (result === 'won') userWonCount[bet.user_id] = (userWonCount[bet.user_id] ?? 0) + 1
    else userLostCount[bet.user_id] = (userLostCount[bet.user_id] ?? 0) + 1
  }
  // Include only combos THIS call actually resolved (see newlyResolvedCombos
  // comment above) — an already-decided combo's other legs settling later
  // must not re-count/re-notify.
  for (const { user_id, status } of newlyResolvedCombos.values()) {
    if (status === 'won') userWonCount[user_id] = (userWonCount[user_id] ?? 0) + 1
    else userLostCount[user_id] = (userLostCount[user_id] ?? 0) + 1
  }

  // Apply balance updates + send one bundled push per user
  const allAffectedUsers = new Set([...Object.keys(userBalanceUpdates), ...Object.keys(userWonCount), ...Object.keys(userLostCount)])
  const pushNotifications: Promise<unknown>[] = []
  for (const userId of allAffectedUsers) {
    const amount = userBalanceUpdates[userId] ?? 0
    if (amount > 0) {
      // Atomic increment — avoids losing a payout if this races a concurrent
      // bet placement/cancellation or another settle call for the same user.
      await admin.rpc('increment_balance', { p_user_id: userId, p_amount: amount })
    }

    const won = userWonCount[userId] ?? 0
    const lost = userLostCount[userId] ?? 0
    const dedupeKey = `settlement-${userId}-${matchId}`

    let title: string
    let body: string
    if (won > 0 && lost === 0) {
      title = won === 1 ? '🎉 Wette gewonnen!' : `🎉 ${won} Wetten gewonnen!`
      body = `+${amount.toFixed(2)} ${wildiLabel(amount)} wurden deinem Konto gutgeschrieben.`
    } else if (won === 0 && lost > 0) {
      title = lost === 1 ? '😬 Wette verloren' : `😬 ${lost} Wetten verloren`
      body = 'Viel Glück beim nächsten Spieltag!'
    } else if (won > 0 && lost > 0) {
      title = `📊 ${won + lost} Wetten ausgewertet`
      body = `${won} gewonnen, ${lost} verloren · Saldo: ${amount >= 0 ? '+' : ''}${amount.toFixed(2)} ${wildiLabel(amount)}`
    } else {
      continue
    }

    pushNotifications.push(
      sendPushToUser(userId, title, body, `/ergebnis/${matchId}`, 'settlement', dedupeKey)
    )
  }

  await Promise.allSettled(pushNotifications)

  // Awards + recap push + inactivity penalty for the Spieltag this match
  // belongs to, if settling it just completed that Spieltag's whole story.
  // Shared with app/api/admin/goalscorers/scorers/route.ts, which used to
  // duplicate only the awards half of this and silently skip the recap push
  // and inactivity penalty whenever a goalscorer bet was the last thing to
  // settle for a Spieltag — see lib/matchdayFinalize.ts for the full logic.
  await finalizeMatchdayIfDone(admin, matchId)

  return NextResponse.json({
    success: true,
    settled: settledBetIds.length,
    combosChecked: combosToCheck.size,
  })
}
