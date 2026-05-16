import type { Match } from '@/types'
import { getMatchXG } from '@/lib/odds'

/**
 * Goalscorer odds for Wildenroth players.
 *
 * Independent of the existing 1X2/O.U./BTTS/etc. logic — uses Wildenroth's
 * computed match xG as the only signal coming from the main odds model
 * (read-only). All player-specific math is local to this file.
 */

const HOUSE_MARGIN = 0.12
const MIN_ODDS = 1.20
const MAX_ODDS = 30.0

// Bayesian shrinkage of per-90 goal rate toward a position-based prior.
const PRIOR_GAMES = 5

// Wildenroth season-baseline xG per match (used to scale player rates by match difficulty).
const WILDENROTH_BASELINE_XG = 1.6

// Filtering thresholds.
const MIN_PROJ_MINUTES = 25     // player must avg >= 25 min/game to be offered
const MIN_PROB_SCORE = 0.06     // 6% probability minimum
const MIN_PROB_SCORE_2PLUS = 0.05

// Set-piece additive bumps to player xG (small).
const PENALTY_TAKER_BUMP = 0.06
const FREEKICK_TAKER_BUMP = 0.03

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
  const prior = positionPrior(player.position)
  if (player.minutes <= 0) return prior
  const observedPer90 = (player.goals / player.minutes) * 90
  const observedGames = player.minutes / 90
  return (observedGames * observedPer90 + PRIOR_GAMES * prior) / (observedGames + PRIOR_GAMES)
}

function projectedMinutes(player: WildenrothPlayer): number {
  if (player.games <= 0 || player.minutes <= 0) return 0
  const avg = player.minutes / player.games
  return Math.min(90, avg)
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
): GoalscorerOffer[] {
  const { homeXG, awayXG } = getMatchXG(matches, homeTeamId, awayTeamId)
  const wildenrothMatchXG = homeTeamId === wildenrothTeamId ? homeXG : awayXG
  return players.map(p => computePlayerOdds(p, wildenrothMatchXG))
}
