import type { Match } from '@/types'
import { getMatchXG, LEAGUE_AVG_TEAM_XG, type PriorContext } from '@/lib/odds'

/**
 * Goalscorer odds for Wildenroth players.
 *
 * Independent of the existing 1X2/O.U./BTTS/etc. logic — uses Wildenroth's
 * computed match xG as the only signal coming from the main odds model
 * (read-only). All player-specific math is local to this file.
 */

// Raising this lowers every offered goalscorer odds by the SAME proportional
// factor (toOdds = 1/(p*(1+margin))) — ratios between players are completely
// unaffected, only the overall price level. Was 0.12 (same as the main
// odds model); bumped slightly on request to bring the whole market down a
// bit without touching the underlying scoring-probability estimate itself.
const HOUSE_MARGIN = 0.15
const MIN_ODDS = 1.20
const MAX_ODDS = 30.0

// Bayesian shrinkage of per-90 goal rate toward a position-based prior.
const PRIOR_GAMES = 5

// How much weight last season's sample keeps once current-season data exists,
// as a fraction of last season's own game count — mirrors lib/odds.ts's team-level
// PRIOR_WEIGHT/augmentStat pattern. Was previously a hard cutover (sampleOf picked
// EITHER this season OR last season, never both), which meant a single quiet
// substitute appearance could wipe out a strong prior season overnight (e.g. a
// proven 29-goal striker cameo'ing for 19 scoreless minutes would crash straight
// to the position-prior floor), while a player with zero current-season minutes
// kept 100% of last season's credibility with no discount at all for currently
// not featuring. Blending avoids both: a small current sample only nudges the
// season-long rate, and an unplayed player's prior season counts at half weight.
const PRIOR_SEASON_WEIGHT = 0.5

// Baseline xG per match used to scale player rates by fixture difficulty.
// Tracks the main model's league baselines instead of being hand-set, so a
// recalibration there can't silently inflate every player's goal expectation.
const WILDENROTH_BASELINE_XG = LEAGUE_AVG_TEAM_XG

// Filtering thresholds.
const MIN_PROJ_MINUTES = 25     // player must avg >= 25 min/game to be offered
const MIN_PROB_SCORE = 0.06     // 6% probability minimum
const MIN_PROB_SCORE_2PLUS = 0.05

// Set-piece additive bumps to player xG (small).
const PENALTY_TAKER_BUMP = 0.06
const FREEKICK_TAKER_BUMP = 0.03

// Preseason ("Vorbereitung") friendly-match goals — a minor secondary signal,
// hand-entered from match reports (wildenroth_players.friendly_goals). Applied
// as a small additive bump, same pattern as the set-piece bumps above, and
// capped so a hot preseason can only nudge the odds, never override the real
// prior-season sample that dominates bayesianGoalsPer90. There is no way to
// tell from match reports which players played a friendly and did NOT score,
// so this only ever adds — it cannot penalize a player for a quiet preseason.
const FRIENDLY_GOAL_BUMP = 0.02
const FRIENDLY_BUMP_CAP = 0.15

export type WildenrothPlayer = {
  id: number
  name: string
  position: 'Torwart' | 'Abwehr' | 'Mittelfeld' | 'Angriff' | null
  games: number
  minutes: number
  goals: number
  assists: number
  is_goalkeeper: boolean
  is_penalty_taker: boolean
  is_freekick_taker: boolean
  active: boolean
  /** Last completed season. Used as the sample while the current season has no
   *  data — without this the market is dead by construction on matchday 1 of
   *  every season, since `games`/`minutes` are reset to 0 at the season roll. */
  prev_games?: number | null
  prev_minutes?: number | null
  prev_goals?: number | null
  friendly_goals?: number | null
}

/** Weighted average of a current-season stat with a down-weighted prior-season
 *  stat — same shape as lib/odds.ts's augmentStat, kept local here since neither
 *  file imports internals from the other. `priorN` should already have
 *  PRIOR_SEASON_WEIGHT applied by the caller. */
function blendWithPrior(
  current: { avg: number; n: number },
  priorAvg: number,
  priorN: number
): { avg: number; n: number } {
  if (priorN === 0) return current
  if (current.n === 0) return { avg: priorAvg, n: priorN }
  const totalN = current.n + priorN
  return { avg: (current.n * current.avg + priorN * priorAvg) / totalN, n: totalN }
}

export type GoalscorerOffer = {
  player_id: number
  player_name: string
  position: string | null
  prob_score: number
  prob_score_2plus: number
  odds_score: number
  odds_score_2plus: number
  is_offered: boolean
  is_offered_2plus: boolean
}

function clamp(odds: number): number {
  return Math.max(MIN_ODDS, Math.min(MAX_ODDS, odds))
}

function toOdds(prob: number): number {
  if (prob <= 0) return MAX_ODDS
  return Math.round((1 / (prob * (1 + HOUSE_MARGIN))) * 100) / 100
}

function positionPrior(position: string | null): number {
  switch (position) {
    case 'Angriff':    return 0.35
    case 'Mittelfeld': return 0.15
    case 'Abwehr':     return 0.05
    default:           return 0.08
  }
}

function bayesianGoalsPer90(player: WildenrothPlayer): number {
  const positionPriorRate = positionPrior(player.position)

  const currentMinutes = player.minutes ?? 0
  const currentN = currentMinutes / 90
  const currentPer90 = currentMinutes > 0 ? (player.goals / currentMinutes) * 90 : 0

  const prevMinutes = player.prev_minutes ?? 0
  const prevN = (prevMinutes / 90) * PRIOR_SEASON_WEIGHT
  const prevPer90 = prevMinutes > 0 ? ((player.prev_goals ?? 0) / prevMinutes) * 90 : 0

  const blended = blendWithPrior({ avg: currentPer90, n: currentN }, prevPer90, prevN)
  if (blended.n === 0) return positionPriorRate

  return (blended.n * blended.avg + PRIOR_GAMES * positionPriorRate) / (blended.n + PRIOR_GAMES)
}

function projectedMinutes(player: WildenrothPlayer): number {
  const currentGames = player.games ?? 0
  const currentAvg = currentGames > 0 ? (player.minutes ?? 0) / currentGames : 0

  const prevGames = player.prev_games ?? 0
  const prevAvg = prevGames > 0 ? (player.prev_minutes ?? 0) / prevGames : 0
  const prevN = prevGames * PRIOR_SEASON_WEIGHT

  const blended = blendWithPrior({ avg: currentAvg, n: currentGames }, prevAvg, prevN)
  if (blended.n === 0) return 0
  return Math.min(90, blended.avg)
}

/**
 * Compute goalscorer probabilities and odds for one player in one match.
 * `wildenrothMatchXG` is the team's expected goals in this match (from the
 * main 1X2/Poisson model, used here read-only).
 */
export function computePlayerOdds(
  player: WildenrothPlayer,
  wildenrothMatchXG: number,
): GoalscorerOffer {
  // Goalkeepers and deactivated players never get offered.
  if (player.is_goalkeeper || !player.active) {
    return {
      player_id: player.id,
      player_name: player.name,
      position: player.position,
      prob_score: 0, prob_score_2plus: 0,
      odds_score: MAX_ODDS, odds_score_2plus: MAX_ODDS,
      is_offered: false, is_offered_2plus: false,
    }
  }

  const per90 = bayesianGoalsPer90(player)
  const projMin = projectedMinutes(player)

  // Team match factor: how attacking is this fixture for Wildenroth (vs baseline).
  const teamFactor = wildenrothMatchXG / WILDENROTH_BASELINE_XG

  // Player expected goals in this match.
  let playerXG = per90 * (projMin / 90) * teamFactor

  // Set-piece bumps (additive, small).
  if (player.is_penalty_taker) playerXG += PENALTY_TAKER_BUMP
  if (player.is_freekick_taker) playerXG += FREEKICK_TAKER_BUMP

  // Preseason form bump (additive, small, capped — see FRIENDLY_GOAL_BUMP above).
  playerXG += Math.min(FRIENDLY_BUMP_CAP, (player.friendly_goals ?? 0) * FRIENDLY_GOAL_BUMP)

  // Poisson: P(0 goals) = e^-λ; P(≥1) = 1 - e^-λ; P(≥2) = 1 - e^-λ(1+λ).
  const probScore = 1 - Math.exp(-playerXG)
  const probScore2plus = 1 - Math.exp(-playerXG) * (1 + playerXG)

  const isOffered = projMin >= MIN_PROJ_MINUTES && probScore >= MIN_PROB_SCORE
  const isOffered2plus = isOffered && probScore2plus >= MIN_PROB_SCORE_2PLUS

  return {
    player_id: player.id,
    player_name: player.name,
    position: player.position,
    prob_score: Math.round(probScore * 10000) / 10000,
    prob_score_2plus: Math.round(probScore2plus * 10000) / 10000,
    odds_score: clamp(toOdds(probScore)),
    odds_score_2plus: clamp(toOdds(probScore2plus)),
    is_offered: isOffered,
    is_offered_2plus: isOffered2plus,
  }
}

/**
 * Convenience: compute Wildenroth's match xG from the season fixtures and
 * then derive goalscorer offers for every player.
 */
export function computeGoalscorerOffersForMatch(
  matches: Match[],
  homeTeamId: number,
  awayTeamId: number,
  wildenrothTeamId: number,
  players: WildenrothPlayer[],
  priorCtx?: PriorContext,
): GoalscorerOffer[] {
  // priorCtx must be passed: without it this xG skips prior-season blending and
  // the roster factor, so the goalscorer market would be derived from a
  // different team-strength estimate than the 1X2/O-U markets on the same card.
  const { homeXG, awayXG } = getMatchXG(matches, homeTeamId, awayTeamId, priorCtx)
  const wildenrothMatchXG = homeTeamId === wildenrothTeamId ? homeXG : awayXG
  return players.map(p => computePlayerOdds(p, wildenrothMatchXG))
}
