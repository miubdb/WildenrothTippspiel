/**
 * Wildenroth conflict-of-interest helper.
 *
 * A user flagged as Wildenroth player/coach may only place bets where the
 * outcome of the wager actively supports Wildenroth winning. Bets that pay
 * out when Wildenroth draws, loses, or fails to win clearly are blocked.
 */

export interface WildenrothContext {
  /** Whether the current user is flagged as a Wildenroth player/coach. */
  isWildenrothPlayer: boolean
  /** Whether the match involves the Wildenroth team. */
  matchInvolvesWildenroth: boolean
  /** True iff Wildenroth is the home team of the match. */
  wildenrothIsHome: boolean
}

export function isAgainstWildenroth(
  marketType: string,
  selection: string,
  ctx: WildenrothContext,
): boolean {
  if (!ctx.isWildenrothPlayer || !ctx.matchInvolvesWildenroth) return false

  if (marketType === '1x2') {
    return ctx.wildenrothIsHome ? selection !== 'home' : selection !== 'away'
  }

  if (marketType === 'double_chance') {
    return true
  }

  // Cup-only "Wer kommt weiter?" — pays out exactly when one named side
  // advances (win in 90 min OR win on penalties), so it mirrors 1x2's own
  // win-requirement logic: blocked exactly when the selection names the
  // OTHER side advancing (never blocked for backing Wildenroth's own side).
  if (marketType === 'cup_advance') {
    return ctx.wildenrothIsHome ? selection !== 'home' : selection !== 'away'
  }

  // Cup-only "Wer erzielt das erste Tor?" and the reused 'btts' market
  // (Beide Teams treffen) are deliberately NOT blocked here (falls through
  // to `return false` below) — neither strictly requires Wildenroth to not
  // win: Wildenroth can concede the first goal, or the opponent can score at
  // all, and still go on to win the match/advance.

  // Cup-only "Wie fällt die Entscheidung?" — names no side (regulation vs.
  // shootout is a spectacle detail, not a result), so it's never blocked,
  // same reasoning as cup_first_goal/btts above.
  if (marketType === 'cup_decision') {
    return false
  }

  // The 3 correlated cup specials (see lib/cupSimulation.ts /
  // lib/odds.ts#cupSpecialMarketOddsFromXG) are all phrased "home/Wildenroth
  // advances AND <condition>" for 'yes'. 'yes' strictly requires a Wildenroth
  // win/advance — never blocked, same as cup_advance's own home-side
  // selection. 'no' is the general complement: true whenever Wildenroth
  // fails to advance under that specific path (e.g. a plain non-comeback
  // win, a regulation loss, a shootout loss) but ALSO true in some scenarios
  // where Wildenroth wins another way — it does not strictly require a
  // Wildenroth win, matching the away_plus_*/home_plus_* handicap reasoning
  // above, so it's blocked unconditionally whenever the match involves
  // Wildenroth (regardless of home/away side).
  if (
    marketType === 'cup_halftime_lead_advance' ||
    marketType === 'cup_comeback_advance' ||
    marketType === 'cup_shootout_advance'
  ) {
    return selection === 'no'
  }

  if (marketType === 'exact_score') {
    const [h, a] = selection.split(':').map(Number)
    if (!Number.isFinite(h) || !Number.isFinite(a)) return false
    return ctx.wildenrothIsHome ? a >= h : h >= a
  }

  if (marketType === 'handicap') {
    // home_minus_* pays out ONLY when home wins by N+ goals — i.e. it strictly
    // requires a win, so it's blocked exactly when Wildenroth is NOT the home
    // team (home winning big then means Wildenroth losing big). away_minus_*
    // mirrors this for the away side.
    //
    // away_plus_*/home_plus_* pay out whenever that side does NOT lose by N+
    // goals — that includes a draw and a narrow loss, not just a win. Neither
    // ever strictly requires a Wildenroth win, so both are blocked
    // unconditionally whenever the match involves Wildenroth, regardless of
    // which side Wildenroth is on.
    const isHomeMinus = selection.startsWith('home_minus')
    const isAwayMinus = selection.startsWith('away_minus')
    const isAwayPlus = selection.startsWith('away_plus')
    const isHomePlus = selection.startsWith('home_plus')
    if (!isHomeMinus && !isAwayMinus && !isAwayPlus && !isHomePlus) return false
    if (isAwayPlus || isHomePlus) return true
    if (isHomeMinus) return !ctx.wildenrothIsHome
    // isAwayMinus: strictly requires the away team to win big, so it's
    // blocked exactly when Wildenroth IS the home team.
    return ctx.wildenrothIsHome
  }

  return false
}
