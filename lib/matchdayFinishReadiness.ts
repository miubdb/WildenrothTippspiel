/**
 * Readiness of a Tippspiel-Spieltag for recap, awards, inactivity fee and pocket money.
 *
 * A BFV postponement is not a played result: all bets touching that match
 * remain PENDING and must stay valid for the makeup date. They nevertheless
 * must not prevent the ORIGINAL Spieltag from completing once every other
 * relevant match and bet has settled.
 *
 * Matchday Specials are a special case: their representative_match_id is
 * merely a technical FK. Their real dependency is included_match_ids.
 * A pending Special is deferred only when one of its ACTUAL constituent
 * matches is postponed/annulled, not merely because its anchor was moved.
 */
export interface CompletionMatch {
  id: number
  status: string
}

export interface CompletionPendingBet {
  match_id: number
  special_id: number | null
  market_type: string
  status: string
}

export interface CompletionSpecial {
  id: number
  included_match_ids: number[]
}

export function isPostponedOrAnnulled(status: string): boolean {
  return status === 'postponed' || status === 'annulled'
}

/** True only when the rest of the Spieltag really finished. */
export function areCurrentMatchdayMatchesFinished(matches: CompletionMatch[]): boolean {
  const relevant = matches.filter((m) => !isPostponedOrAnnulled(m.status))
  return relevant.length > 0 && relevant.every((m) => m.status === 'finished')
}

/**
 * Decide whether a still-pending bet is genuinely blocking the Spieltag.
 * Unknown/missing references are treated as BLOCKING (fail closed).
 *
 * The caller must supply statuses for all active-season matches, not just
 * the original Spieltag: Specials can span multiple matchdays.
 */
export function isPendingBetBlockingFinalization(
  bet: CompletionPendingBet,
  allMatches: Map<number, CompletionMatch>,
  specials: Map<number, CompletionSpecial>,
): boolean {
  if (bet.status !== 'pending') return false

  if (bet.market_type === 'matchday_special') {
    if (bet.special_id == null) return true
    const special = specials.get(bet.special_id)
    if (!special || !Array.isArray(special.included_match_ids) || special.included_match_ids.length === 0) return true
    if (special.included_match_ids.some((id) => !allMatches.has(id))) return true
    // A pending Special that depends on a postponed constituent game is still
    // unresolved, but the current Spieltag must not wait for the makeup date.
    return !special.included_match_ids.some((id) => isPostponedOrAnnulled(allMatches.get(id)!.status))
  }

  const match = allMatches.get(bet.match_id)
  if (!match) return true
  return !isPostponedOrAnnulled(match.status)
}

/** Pure gate, easy to regress-test without any production writes. */
export function canFinalizeMatchday(
  matchdayMatches: CompletionMatch[],
  pendingBets: CompletionPendingBet[],
  allMatches: CompletionMatch[],
  specials: CompletionSpecial[] = [],
): boolean {
  if (!areCurrentMatchdayMatchesFinished(matchdayMatches)) return false
  const byId = new Map(allMatches.map((m) => [m.id, m]))
  const specialsById = new Map(specials.map((s) => [s.id, s]))
  return !pendingBets.some((bet) => isPendingBetBlockingFinalization(bet, byId, specialsById))
}
