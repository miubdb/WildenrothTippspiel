/**
 * Maximum total payout (stake included) a single bet slip can ever credit.
 * Risky-Wettscheine (see lib/risky.ts) get the higher ceiling since they're
 * the deliberately allowed high-odds 3rd slot. This NEVER applies to the
 * underlying odds — those are always computed, stored and shown in full;
 * only the credited/displayed payout amount is ever capped. Server-side
 * settlement (app/api/admin/settle/route.ts,
 * app/api/admin/goalscorers/scorers/route.ts) is the authoritative
 * enforcement point; every other call site here is a preview/display of
 * what that settlement will produce.
 */
export const MAX_PAYOUT_NORMAL = 10000
export const MAX_PAYOUT_RISKY = 15000

export function payoutCap(isRisky: boolean): number {
  return isRisky ? MAX_PAYOUT_RISKY : MAX_PAYOUT_NORMAL
}

/** theoreticalPayout = stake × odds, uncapped — never round before capping,
 *  callers that persist the result should round afterward themselves. */
export function cappedPayout(stake: number, odds: number, isRisky: boolean): number {
  return Math.min(stake * odds, payoutCap(isRisky))
}

export function isPayoutCapped(stake: number, odds: number, isRisky: boolean): boolean {
  return stake * odds > payoutCap(isRisky)
}

/** The exact stake at which stake × odds first reaches the payout cap — any
 *  stake above this is wasted for THIS slip (same capped payout either way).
 *  Used to show the user "ab X Wildis bringt mehr Einsatz nichts mehr" so a
 *  2-Wildi and a 250-Wildi bet at the same huge quote don't silently land on
 *  the identical payout without the user realizing why. */
export function breakevenStake(odds: number, isRisky: boolean): number {
  if (odds <= 0) return 0
  return payoutCap(isRisky) / odds
}

/**
 * Preview-only heuristic for "will this not-yet-placed slip likely be
 * flagged Risky" — mirrors lib/risky.ts's RISKY_ODDS_THRESHOLD, duplicated
 * as a literal here (not imported) because lib/risky.ts pulls in the
 * service-role admin client at module scope, which must never end up in a
 * client bundle. Exceeding the threshold is necessary but not sufficient for
 * the real, authoritative `is_risky` flag — lib/risky.ts's pickRiskySlipId
 * also compares against the user's OTHER pending slips for the same
 * Spieltag, which isn't known at bet-slip-preview time. Settlement always
 * applies the real stored `is_risky` column, never this heuristic.
 */
export const PREVIEW_RISKY_ODDS_THRESHOLD = 20

export function previewComboIsRisky(totalComboOdds: number): boolean {
  return totalComboOdds > PREVIEW_RISKY_ODDS_THRESHOLD
}

export function previewSingleIsRisky(selectionCount: number, oddsValue: number): boolean {
  return selectionCount === 1 && oddsValue > PREVIEW_RISKY_ODDS_THRESHOLD
}
