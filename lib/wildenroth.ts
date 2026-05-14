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

  if (marketType === 'exact_score') {
    const [h, a] = selection.split(':').map(Number)
    if (!Number.isFinite(h) || !Number.isFinite(a)) return false
    return ctx.wildenrothIsHome ? a >= h : h >= a
  }

  if (marketType === 'handicap') {
    // home_minus_* pays out when home wins by N+ goals
    // away_plus_* pays out when away does NOT lose by N+ goals
    const isHomeMinus = selection.startsWith('home_minus')
    const isAwayPlus = selection.startsWith('away_plus')
    if (!isHomeMinus && !isAwayPlus) return false
    return ctx.wildenrothIsHome ? isAwayPlus : isHomeMinus
  }

  return false
}
