import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { sendPushToUser } from '@/lib/push'
import { wildiLabel } from '@/components/WildiIcon'
import { finalizeMatchdayIfDone } from '@/lib/matchdayFinalize'
import { cappedPayout } from '@/lib/payout'
import { settleBet } from '@/lib/settleBet'
import { settleSingle, settleCombo, findStuckComboIds } from '@/lib/settlement'
import { GOALSCORER_MARKETS, resolveWildenrothGoals, settleGoalscorerMarket } from '@/lib/goalscorerSettlement'

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

  let body: {
    matchId: number; homeScore: number; awayScore: number
    /** Cup-only manual settlement inputs (see settleBet doc above) — ignored
     *  for a normal league match. */
    cupShootoutWinner?: 'home' | 'away' | null
    cupFirstGoalTeam?: 'home' | 'away' | 'none' | null
    cupHalftimeHomeGoals?: number | null
    cupHalftimeAwayGoals?: number | null
    cupAwayTeamLed?: boolean | null
    /** Round-6: minute of the match's first goal, required when at least one
     *  goal was scored (see 'cup_early_goal' settlement + admin UI field). */
    cupFirstGoalMinute?: number | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const { matchId, homeScore, awayScore } = body
  // eslint-disable-next-line prefer-const -- reassigned from the stored match row in a recovery run (see below)
  let { cupShootoutWinner, cupFirstGoalTeam, cupHalftimeHomeGoals, cupHalftimeAwayGoals, cupAwayTeamLed, cupFirstGoalMinute } = body

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
    .select('status, competition_type, home_score, away_score, cup_shootout_winner, cup_first_goal_team, cup_halftime_home_goals, cup_halftime_away_goals, cup_away_team_led, cup_first_goal_minute')
    .eq('id', matchId)
    .single()

  // Recovery: a match that is already 'finished' with EXACTLY the submitted score may have lost its settlement half-way
  // (e.g. the bet query failed after the status flip). Settlement is idempotent now (settle_bet/settle_combo only act on
  // still-pending rows and credit atomically), so re-running it is safe and finishes the job. A DIFFERENT score is still
  // refused — it would silently desync from already-paid bets.
  const isRecoveryRun = existingMatch?.status === 'finished' && existingMatch.home_score === homeScore && existingMatch.away_score === awayScore
  if (isRecoveryRun && existingMatch?.competition_type === 'cup') {
    // The stored values are authoritative for a re-run (the admin may not have the original inputs at hand).
    cupShootoutWinner = existingMatch.cup_shootout_winner
    cupFirstGoalTeam = existingMatch.cup_first_goal_team
    cupHalftimeHomeGoals = existingMatch.cup_halftime_home_goals
    cupHalftimeAwayGoals = existingMatch.cup_halftime_away_goals
    cupAwayTeamLed = existingMatch.cup_away_team_led
    cupFirstGoalMinute = existingMatch.cup_first_goal_minute
  }
  if (existingMatch?.status === 'finished' && !isRecoveryRun) {
    return NextResponse.json(
      { error: 'Dieses Spiel wurde bereits mit einem anderen Ergebnis abgerechnet. Eine Korrektur ist über diese Funktion nicht möglich.' },
      { status: 409 }
    )
  }

  // Ein final annulliertes Spiel (Nichtantritt o.ä., siehe app/api/admin/matches/[id]/annul/
  // route.ts) wird NIEMALS normal abgerechnet — kein Forfeit-Ergebnis (z.B. 2:0) darf je als
  // echtes Ergebnis für die Settlement-Logik gelten (lib/settleBet.ts hätte dafür ohnehin keinen
  // eigenen Fall und würde jede noch offene Wette blind nach Score graden). Final, nicht umkehrbar
  // über diese Route.
  if (existingMatch?.status === 'annulled') {
    return NextResponse.json(
      { error: 'Dieses Spiel wurde annulliert (Nichtantritt/Annullierung) und kann nicht mehr normal abgerechnet werden.' },
      { status: 409 }
    )
  }

  // Cup match: "Wer kommt weiter?" needs the shootout winner recorded on a
  // 90-minute draw — refuse to settle rather than silently grading every
  // cup_advance bet 'lost' (see settleBet's fail-safe above).
  if (existingMatch?.competition_type === 'cup' && homeScore === awayScore && !cupShootoutWinner) {
    return NextResponse.json(
      { error: 'Unentschieden nach 90 Minuten — bitte zuerst den Elfmeterschießen-Sieger angeben.' },
      { status: 400 }
    )
  }

  // cup_halftime_lead_advance needs the half-time score and cup_comeback_advance
  // needs the manual "Geiselbullach led at some point" boolean — both must be
  // settled unambiguously (see user spec: never settle a special market that
  // could later only be interpreted subjectively). Refuse rather than
  // silently defaulting to "no" for every bet on either market.
  if (
    existingMatch?.competition_type === 'cup' &&
    (cupHalftimeHomeGoals == null || cupHalftimeAwayGoals == null)
  ) {
    return NextResponse.json(
      { error: 'Bitte zuerst den Halbzeitstand angeben (für den Markt „Wildenroth führt zur Halbzeit & kommt weiter“).' },
      { status: 400 }
    )
  }
  if (existingMatch?.competition_type === 'cup' && cupAwayTeamLed == null) {
    return NextResponse.json(
      { error: 'Bitte zuerst angeben, ob Geiselbullach im Spielverlauf in Führung war (für den Markt „Geiselbullach führt – Wildenroth kommt trotzdem weiter“).' },
      { status: 400 }
    )
  }
  // First-goal market: at 0:0 the only consistent answer is "none" — accept
  // that automatically rather than force a redundant admin click, but for
  // any other scoreline the admin must say who actually scored first.
  const effectiveCupFirstGoalTeam =
    existingMatch?.competition_type === 'cup' && homeScore === 0 && awayScore === 0
      ? 'none'
      : cupFirstGoalTeam
  if (existingMatch?.competition_type === 'cup' && !effectiveCupFirstGoalTeam) {
    return NextResponse.json(
      { error: 'Bitte zuerst angeben, wer das erste Tor erzielt hat (für den Markt „Wer erzielt das erste Tor?“).' },
      { status: 400 }
    )
  }
  // Round-6 "Frühes Tor" market: required only when at least one goal was
  // scored (0:0 -> no goal -> null is the correct, complete value; anything
  // else without a minute would silently settle every 'yes' bet as 'lost'
  // without the admin ever having entered real data).
  if (
    existingMatch?.competition_type === 'cup' &&
    (homeScore > 0 || awayScore > 0) &&
    (cupFirstGoalMinute == null || !Number.isInteger(cupFirstGoalMinute) || cupFirstGoalMinute < 1 || cupFirstGoalMinute > 120)
  ) {
    return NextResponse.json(
      { error: 'Bitte zuerst die Minute des ersten Tores angeben (für den Markt „Frühes Tor Min. 1-15“).' },
      { status: 400 }
    )
  }
  // Half-time score must be a real subset of the full-time score — an admin
  // typo here (e.g. swapped fields) would otherwise silently mis-settle the
  // "Wildenroth führt zur Halbzeit & kommt weiter" market.
  if (
    existingMatch?.competition_type === 'cup' &&
    cupHalftimeHomeGoals != null && cupHalftimeAwayGoals != null &&
    (cupHalftimeHomeGoals > homeScore || cupHalftimeAwayGoals > awayScore || cupHalftimeHomeGoals < 0 || cupHalftimeAwayGoals < 0)
  ) {
    return NextResponse.json(
      { error: 'Der Halbzeitstand ist mit dem Endstand nicht vereinbar (Halbzeittore dürfen die Endstand-Tore je Team nicht übersteigen).' },
      { status: 400 }
    )
  }

  // Update match — gated on status NOT IN ('finished','annulled') so this single
  // UPDATE statement is itself the race guard against a CONCURRENT
  // app/api/admin/matches/[id]/annul/route.ts call for the same match: Postgres
  // row-locking means only one of the two can actually win the row, and the
  // loser's WHERE clause is re-evaluated against the winner's already-committed
  // result, so it updates zero rows rather than silently overwriting a just-
  // annulled match with a real score (or vice versa — neutralize_match's own
  // FOR UPDATE lock + early status check closes that direction). The earlier
  // `existingMatch?.status` reads above are only a fast, non-authoritative
  // pre-check for a nicer error message; THIS is the actual guard.
  if (!isRecoveryRun) {
  const { data: updatedMatchRows, error: matchError } = await supabase
    .from('matches')
    .update({
      home_score: homeScore,
      away_score: awayScore,
      status: 'finished',
      ...(existingMatch?.competition_type === 'cup' ? {
        cup_shootout_winner: homeScore === awayScore ? (cupShootoutWinner ?? null) : null,
        cup_first_goal_team: effectiveCupFirstGoalTeam ?? null,
        cup_halftime_home_goals: cupHalftimeHomeGoals,
        cup_halftime_away_goals: cupHalftimeAwayGoals,
        cup_away_team_led: cupAwayTeamLed,
        cup_first_goal_minute: homeScore === 0 && awayScore === 0 ? null : cupFirstGoalMinute,
      } : {}),
    })
    .eq('id', matchId)
    .not('status', 'in', '("finished","annulled")')
    .select('id')

  if (matchError) {
    return NextResponse.json({ error: 'Fehler beim Aktualisieren des Spiels.' }, { status: 500 })
  }
  if (!updatedMatchRows || updatedMatchRows.length === 0) {
    return NextResponse.json(
      { error: 'Dieses Spiel wurde zwischenzeitlich bereits abgerechnet oder annulliert — bitte Seite neu laden.' },
      { status: 409 }
    )
  }
  }

  // Fetch all pending single bets for this match (skip goalscorer markets — those settle
  // separately once the admin enters who scored, which depends on more than the final score).
  // Also skip matchday_special bets/legs: their match_id is only the Spieltag's
  // representative_match_id (technical FK anchor, see lib/matchdaySpecials.ts) — settleBet()
  // has no case for 'matchday_special' and would fall through to its `default: return 'lost'`,
  // wrongly and irreversibly grading every pending Special bet anchored to this match as lost
  // regardless of the real outcome. Specials settle separately via settleActiveMatchdaySpecials
  // (called below through finalizeMatchdayIfDone) once ALL of their own included_match_ids are final.
  const { data: pendingBets, error: betsError } = await supabase
    .from('bets')
    .select('id, user_id, market_type, selection, stake, odds_value, combo_id, is_risky')
    .eq('match_id', matchId)
    .eq('status', 'pending')
    .not('market_type', 'in', '("goalscorer","goalscorer_2plus","matchday_special")')

  if (betsError) {
    return NextResponse.json({ error: 'Fehler beim Abrufen der Wetten. Das Spiel ist bereits gespeichert – bitte dieselbe Abrechnung erneut absenden (sicher wiederholbar).' }, { status: 500 })
  }

  // NOTE: no early return when there is nothing to settle — the Spieltag may still need finalizing (awards, recap, inactivity
  // fee, pocket money) precisely because THIS match was the last one to finish, even if nobody bet on it.

  // Settle each bet
  const userBalanceUpdates: Record<string, number> = {}
  const settledBetIds: number[] = []
  const combosToCheck = new Set<number>()
  let settleErrors = 0

  for (const bet of pendingBets ?? []) {
    const result = settleBet(bet.market_type, bet.selection, homeScore, awayScore, cupShootoutWinner, cupFirstGoalTeam, cupHalftimeHomeGoals, cupHalftimeAwayGoals, cupAwayTeamLed, homeScore === 0 && awayScore === 0 ? null : cupFirstGoalMinute)
    let payout = 0

    if (result === 'won' && bet.combo_id === null) {
      // Single bet win: payout = stake * odds, capped at the max payout for
      // this slip's Risky status (see lib/payout.ts) — never applied to
      // odds_value itself, only to the credited amount.
      payout = Math.round(cappedPayout(bet.stake, bet.odds_value, bet.is_risky) * 100) / 100
    }

    // Status flip + payout credit in ONE transaction (settle_bet). 'skipped' = already decided elsewhere (never credited twice),
    // 'error' = rolled back, row stays pending, a re-run of this endpoint pays it.
    const outcome = await settleSingle(admin, bet.id, result, payout)
    if (outcome === 'error') { settleErrors++; continue }
    if (outcome === 'skipped') continue
    if (result === 'won' && bet.combo_id === null) {
      userBalanceUpdates[bet.user_id] = (userBalanceUpdates[bet.user_id] ?? 0) + payout
    }

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
  // Self-healing: legs of this match that an earlier (crashed) run already settled, whose combo was never evaluated.
  for (const id of await findStuckComboIds(admin, { matchId })) combosToCheck.add(id)
  const newlyResolvedCombos = new Map<number, { user_id: string; status: 'won' | 'lost' }>()
  for (const comboId of combosToCheck) {
    // Fetch all legs of this combo
    const { data: comboLegs } = await supabase
      .from('bets')
      .select('id, status, odds_value, user_id, is_risky')
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
      const lostOutcome = await settleCombo(admin, comboId, 'lost', 0)
      if (lostOutcome === 'error') { settleErrors++; continue }
      if (lostOutcome === 'skipped') continue   // someone else resolved it first
      newlyResolvedCombos.set(comboId, { user_id: comboBet.user_id, status: 'lost' })
    } else {
      // All legs won. combo_bets has no is_risky column of its own — every
      // leg carries the same value (set at placement, kept in sync by
      // lib/risky.ts), so any one leg reflects the combo's classification.
      const comboIsRisky = comboLegs[0]?.is_risky ?? false
      const payout = Math.round(cappedPayout(comboBet.stake, comboBet.total_odds, comboIsRisky) * 100) / 100
      // settle_combo flips pending -> won AND credits the payout atomically; only the call that really flips it pays.
      const wonOutcome = await settleCombo(admin, comboId, 'won', payout)
      if (wonOutcome === 'error') { settleErrors++; continue }
      if (wonOutcome === 'skipped') continue

      userBalanceUpdates[comboBet.user_id] = (userBalanceUpdates[comboBet.user_id] ?? 0) + payout
      newlyResolvedCombos.set(comboId, { user_id: comboBet.user_id, status: 'won' })
    }
  }

  // Collect per-user win/loss summary for bundled push
  const userWonCount: Record<string, number> = {}
  const userLostCount: Record<string, number> = {}
  for (const bet of pendingBets) {
    if (bet.combo_id !== null) continue // combos handled separately below
    const result = settleBet(bet.market_type, bet.selection, homeScore, awayScore, cupShootoutWinner, cupFirstGoalTeam, cupHalftimeHomeGoals, cupHalftimeAwayGoals, cupAwayTeamLed, homeScore === 0 && awayScore === 0 ? null : cupFirstGoalMinute)
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
    // The payout itself was already credited atomically by settle_bet/settle_combo; `amount` is only used for the push text.

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
  // Goalscorer market, server-side and independent of the admin UI: if Wildenroth (I or II, home or away) scored
  // NOTHING, every pending goalscorer bet on this match is lost — no scorer list needed. The old UI only called the
  // scorers endpoint for a non-empty list, so a 0:5 left all goalscorer bets open (Match 413). If Wildenroth DID score,
  // nothing is assumed: the bets stay open until the admin submits a complete list, and the response says so.
  let goalscorerAutoSettled = 0
  let goalscorerPending = 0
  {
    const { count: gsPendingCount } = await admin.from('bets').select('id', { count: 'exact', head: true })
      .eq('match_id', matchId).in('market_type', [...GOALSCORER_MARKETS]).eq('status', 'pending')
    if ((gsPendingCount ?? 0) > 0) {
      const ctx = await resolveWildenrothGoals(admin, matchId)
      if (ctx.ok && ctx.teamGoals === 0) {
        const gs = await settleGoalscorerMarket(admin, matchId, null)
        if (gs.ok) {
          goalscorerAutoSettled = gs.settled
          settleErrors += gs.settleErrors
          await Promise.allSettled([...gs.losers].map((uid) => sendPushToUser(uid, '😬 Wette verloren', 'Deine Torschützenwette wurde leider nicht gewonnen.', '/tipps')))
        } else {
          console.error('Automatic zero-goal goalscorer settlement failed', { matchId, error: gs.error })
          settleErrors++
        }
      }
      const { count: stillPending } = await admin.from('bets').select('id', { count: 'exact', head: true })
        .eq('match_id', matchId).in('market_type', [...GOALSCORER_MARKETS]).eq('status', 'pending')
      goalscorerPending = stillPending ?? 0
    }
  }

  try {
    await finalizeMatchdayIfDone(admin, matchId)
  } catch (e) {
    console.error('Matchday finalization failed after settlement (re-submit the same settlement to retry):', e)
    settleErrors++
  }

  // These pages cache their result (ISR) — without an explicit revalidate
  // here, a bet that just flipped to won/lost (e.g. a combo losing the moment
  // one leg's match is settled, well before every leg's match has kicked off)
  // wouldn't show up until that window happened to lapse on its own.
  // Wrapped: the balances and bet rows are already written at this point, so a
  // cache-API hiccup must never surface as a failed settlement to the admin.
  try {
    revalidatePath('/leaderboard')
    revalidatePath('/tipps')
    revalidatePath('/spieler/[id]', 'page')
  } catch (e) { console.error('revalidatePath after settlement failed:', e) }

  // Admin 3.0, Punkt 9: Protokoll-Eintrag NACH der eigentlichen Abrechnung — die Wetten/
  // Guthaben sind an dieser Stelle bereits final geschrieben, siehe Kommentar oben.
  const { data: actorProfile } = await supabase.from('profiles').select('username, display_name').eq('id', user.id).single()
  await logAdminAction({
    actorId: user.id, actorName: actorProfile?.display_name || actorProfile?.username || user.id,
    action: 'settlement', objectType: 'matches', objectId: body.matchId,
    newValue: { homeScore: body.homeScore, awayScore: body.awayScore, settled: settledBetIds.length },
  })

  return NextResponse.json({
    success: true,
    settled: settledBetIds.length,
    combosChecked: combosToCheck.size,
    ...(settleErrors > 0 ? { warning: `${settleErrors} Abrechnung(en) fehlgeschlagen und zurückgerollt – bitte erneut abrechnen (idempotent).`, settleErrors } : {}),
    ...(isRecoveryRun ? { recovered: true } : {}),
    goalscorerAutoSettled,
    goalscorerPending,
  })
}
