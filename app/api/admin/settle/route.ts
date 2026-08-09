import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser, sendPushToAll } from '@/lib/push'
import { wildiLabel } from '@/components/WildiIcon'
import { buildEffectiveMatchdayIndex, effectiveMatchdayOf, recapMatchdayOf } from '@/lib/season'
import type { Match } from '@/types'

const SEASON_START = '2026-08-01'

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
      await admin
        .from('combo_bets')
        .update({ status: 'lost', payout: 0 })
        .eq('id', comboId)
    } else {
      // All legs won
      const payout = Math.round(comboBet.stake * comboBet.total_odds * 100) / 100
      await admin
        .from('combo_bets')
        .update({ status: 'won', payout })
        .eq('id', comboId)

      userBalanceUpdates[comboBet.user_id] = (userBalanceUpdates[comboBet.user_id] ?? 0) + payout
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
  // Include settled combos
  for (const comboId of combosToCheck) {
    const { data: cb } = await supabase.from('combo_bets').select('user_id, status').eq('id', comboId).single()
    if (!cb || cb.status === 'pending') continue
    if (cb.status === 'won') userWonCount[cb.user_id] = (userWonCount[cb.user_id] ?? 0) + 1
    else userLostCount[cb.user_id] = (userLostCount[cb.user_id] ?? 0) + 1
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

  // Check if the entire Spieltag's STORY is now complete → send recap push
  // (once). Two different groupings are in play here, deliberately:
  //  - effectiveMatchdayOf: the DISPLAY grouping — a Kreisliga match always
  //    keeps its own official BFV number, exactly what tipps/page.tsx shows
  //    and what a bet was placed under. Used below only for the inactivity
  //    fairness check ("did this user bet on anything shown under this tab").
  //  - recapMatchdayOf: the RECAP grouping — a Kreisliga match that's been
  //    rescheduled far outside its own Spieltag's normal window gets folded
  //    into whichever Spieltag is actually being played around its real date,
  //    so THAT Spieltag's recap/awards don't wait weeks/months for one
  //    outlier game. See lib/season.ts for the full reasoning — this does not
  //    delay any individual payout or the per-match win/lost push above, only
  //    the supplementary awards/recap layer.
  const { data: matchInfo } = await supabase
    .from('matches')
    .select('id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status, match_category, is_topspiel')
    .eq('id', matchId)
    .single()

  if (matchInfo) {
    const { data: seasonMatchesRaw } = await admin
      .from('matches')
      .select('id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status, match_category, is_topspiel')
      .or(`match_date.gte.${SEASON_START},matchday.eq.999`)
    const seasonMatchesForMd = (seasonMatchesRaw ?? []) as Match[]
    const mdIndex = buildEffectiveMatchdayIndex(seasonMatchesForMd)
    const matchday = recapMatchdayOf(matchInfo as Match, mdIndex)

    const matchdayMatches = matchday == null
      ? []
      : seasonMatchesForMd.filter((m) => recapMatchdayOf(m, mdIndex) === matchday)
    const displayMatchdayMatches = matchday == null
      ? []
      : seasonMatchesForMd.filter((m) => effectiveMatchdayOf(m, mdIndex) === matchday)

    const nonPostponedInMatchday = matchdayMatches.filter(m => m.status !== 'postponed')
    const allFinished =
      matchday != null &&
      nonPostponedInMatchday.length > 0 &&
      nonPostponedInMatchday.every((m) => m.status === 'finished')

    if (allFinished) {
      // Test matchday 999: skip recap push, awards and inactivity penalty
      if (matchday >= 900) {
        return NextResponse.json({ success: true, settled: settledBetIds.length, combosChecked: combosToCheck.size, testMode: true })
      }

      const mIds = matchdayMatches.map((m) => m.id)
      // "All non-postponed matches finished" is not the same as "this Spieltag
      // is truly done" — a postponed match keeps its OWN Spieltag label (the
      // official BFV number never changes) but can resolve weeks or months
      // later, with its bets staying 'pending' the whole time. Gate the recap
      // push AND awards on the bets, not just the matches, so we never
      // announce "Spieltag X abgeschlossen" while one of its games — and
      // everyone's stake on it — is still open. When that game finally
      // settles, this same code path runs again and fires both, correctly,
      // for the first time (computeAndPersistMatchdayAwards's dedup-before-
      // insert means a delayed award set replaces nothing spurious).
      const { count: stillPendingCount } = mIds.length > 0
        ? await admin.from('bets').select('id', { count: 'exact', head: true }).in('match_id', mIds).eq('status', 'pending')
        : { count: 0 }
      const spieltagTrulyDone = !stillPendingCount

      // Persist awards after settlement — also waits on goalscorer bets, which
      // resolve on a separate timeline once the admin submits the scorer list
      // (see app/api/admin/goalscorers/scorers/route.ts, which calls the same
      // computeAndPersistMatchdayAwards() once it becomes the "last" event to
      // settle this Spieltag).
      if (spieltagTrulyDone && mIds.length > 0) {
        try {
          const { computeAndPersistMatchdayAwards } = await import('@/lib/awards')
          await computeAndPersistMatchdayAwards(admin, '26/27', matchday, mIds)
        } catch (e) { console.error('Award persistence failed:', e) }
      }

      // Deactivate early betting override once any matchday is settled
      await admin.from('app_settings').update({ value: 'false', updated_at: new Date().toISOString() }).eq('key', 'early_betting_open')

      if (spieltagTrulyDone) {
        const { error: dedupError } = await admin
          .from('push_reminders')
          .insert({ type: 'recap', matchday })

        if (!dedupError) {
          // Only send if insert succeeded (prevents duplicate on concurrent requests)
          await sendPushToAll(
            '📊 Spieltags-Recap verfügbar',
            `Der ${matchday}. Spieltag ist abgeschlossen – schau dir die Highlights an!`,
            `/recap/${matchday}`,
            'matchday_recap',
            `recap-${matchday}`
          )
        }
      }

      // Apply 50 Wildis inactivity penalty per user who placed no bets this matchday.
      // Dedup via push_reminders so this only runs once even if multiple matches settle simultaneously.
      const { error: penaltyDedupError } = await admin
        .from('push_reminders')
        .insert({ type: 'inactivity_fee', matchday })

      if (!penaltyDedupError) {
        // Fairness check uses the DISPLAY grouping, not the recap grouping —
        // a user who bet on a match shown under this Spieltag's tab must
        // count as active for it even if that specific match later turned
        // out to be a recap-outlier reassigned elsewhere for award purposes.
        const mdMatchIds = displayMatchdayMatches.map((m) => m.id)

        if (mdMatchIds.length > 0) {
          const { data: activeBetRows } = await admin
            .from('bets')
            .select('user_id')
            .in('match_id', mdMatchIds)
          const activeUserIds = new Set((activeBetRows ?? []).map(b => b.user_id as string))

          // Only users actually allowed to bet this season can be "inactive" —
          // ineligible users are hard-blocked from placing any bet at all
          // (see app/api/bets/place/route.ts NOT_ELIGIBLE), so penalizing them
          // here would charge people for a season they were never allowed to play.
          const { data: allProfiles } = await admin
            .from('profiles')
            .select('id')
            .or('eligible_for_current_season.eq.true,is_admin.eq.true')

          // 50, not 100 (10% of the 1000 Wildi starting balance) — 100 was judged
          // too harsh a per-Spieltag penalty for an internal club Tippspiel.
          const INACTIVITY_PENALTY = 50
          await Promise.allSettled(
            (allProfiles ?? [])
              .filter(p => !activeUserIds.has(p.id))
              .map(p => admin.rpc('apply_penalty', { p_user_id: p.id, p_amount: INACTIVITY_PENALTY }))
          )
        }
      }

    }
  }

  return NextResponse.json({
    success: true,
    settled: settledBetIds.length,
    combosChecked: combosToCheck.size,
  })
}
