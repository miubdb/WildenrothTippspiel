import type { Match, OddsData } from '@/types'

const HOME_ADVANTAGE = 1.15
const HOUSE_MARGIN = 0.10
const MIN_ODDS = 1.10
const MAX_ODDS = 15.0

function clampOdds(odds: number): number {
  return Math.max(MIN_ODDS, Math.min(MAX_ODDS, odds))
}

function applyMargin(prob: number, totalProb: number): number {
  // Scale probability by total probability (overround), then convert to odds
  const scaledProb = prob / totalProb
  return 1 / scaledProb
}

function normalizeProbs(probs: number[]): number[] {
  const total = probs.reduce((a, b) => a + b, 0)
  if (total === 0) return probs.map(() => 1 / probs.length)
  return probs.map((p) => p / total)
}

/** Poisson PMF */
function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0
  let logP = k * Math.log(lambda) - lambda
  for (let i = 1; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

export function calculateOdds(
  matches: Match[],
  homeTeamId: number,
  awayTeamId: number
): OddsData {
  // -------------------------------------------------------
  // 1. Head-to-head results
  // -------------------------------------------------------
  const h2h = matches.filter(
    (m) =>
      m.status === 'finished' &&
      ((m.home_team_id === homeTeamId && m.away_team_id === awayTeamId) ||
        (m.home_team_id === awayTeamId && m.away_team_id === homeTeamId))
  )

  let h2hHomeWins = 0
  let h2hDraws = 0
  let h2hAwayWins = 0

  for (const m of h2h) {
    const hs = m.home_score ?? 0
    const as_ = m.away_score ?? 0
    if (m.home_team_id === homeTeamId) {
      if (hs > as_) h2hHomeWins++
      else if (hs < as_) h2hAwayWins++
      else h2hDraws++
    } else {
      // Reversed fixture
      if (hs > as_) h2hAwayWins++
      else if (hs < as_) h2hHomeWins++
      else h2hDraws++
    }
  }

  // -------------------------------------------------------
  // 2. Season form: home team at home, away team away
  // -------------------------------------------------------
  const homeAtHome = matches.filter(
    (m) => m.status === 'finished' && m.home_team_id === homeTeamId
  )
  const awayAtAway = matches.filter(
    (m) => m.status === 'finished' && m.away_team_id === awayTeamId
  )

  let homeWinRate = 0.45
  let drawRate = 0.27
  let awayWinRate = 0.28

  if (homeAtHome.length >= 3 || awayAtAway.length >= 3) {
    let hw = 0, d = 0, aw = 0, total = 0

    for (const m of homeAtHome) {
      const hs = m.home_score ?? 0
      const as_ = m.away_score ?? 0
      if (hs > as_) hw++
      else if (hs === as_) d++
      else aw++
      total++
    }
    for (const m of awayAtAway) {
      const hs = m.home_score ?? 0
      const as_ = m.away_score ?? 0
      if (as_ > hs) aw++
      else if (hs === as_) d++
      else hw++
      total++
    }

    if (total > 0) {
      homeWinRate = hw / total
      drawRate = d / total
      awayWinRate = aw / total
    }
  }

  // Blend h2h (if any) with season form
  const h2hTotal = h2hHomeWins + h2hDraws + h2hAwayWins
  if (h2hTotal >= 2) {
    const weight = Math.min(0.4, h2hTotal * 0.1)
    homeWinRate = homeWinRate * (1 - weight) + (h2hHomeWins / h2hTotal) * weight
    drawRate = drawRate * (1 - weight) + (h2hDraws / h2hTotal) * weight
    awayWinRate = awayWinRate * (1 - weight) + (h2hAwayWins / h2hTotal) * weight
  }

  // Apply home advantage factor
  homeWinRate *= HOME_ADVANTAGE
  const [normHome, normDraw, normAway] = normalizeProbs([homeWinRate, drawRate, awayWinRate])

  // Apply house margin (overround = 1 + margin)
  const overround = 1 + HOUSE_MARGIN
  const totalProb = overround // target sum of implied probs

  const homeWinOdds = clampOdds(applyMargin(normHome, totalProb))
  const drawOdds = clampOdds(applyMargin(normDraw, totalProb))
  const awayWinOdds = clampOdds(applyMargin(normAway, totalProb))

  // -------------------------------------------------------
  // 3. Over/Under 2.5 goals
  // -------------------------------------------------------
  const allFinished = matches.filter((m) => m.status === 'finished')
  let overCount = 0
  let underCount = 0

  const relevantForGoals = [
    ...homeAtHome,
    ...awayAtAway,
  ]

  const goalsMatches = relevantForGoals.length >= 4 ? relevantForGoals : allFinished

  for (const m of goalsMatches) {
    const total = (m.home_score ?? 0) + (m.away_score ?? 0)
    if (total > 2.5) overCount++
    else underCount++
  }

  const totalGoalGames = overCount + underCount
  let overProb = totalGoalGames > 0 ? overCount / totalGoalGames : 0.52
  let underProb = 1 - overProb
  ;[overProb, underProb] = normalizeProbs([overProb, underProb])

  const over25Odds = clampOdds(applyMargin(overProb, totalProb))
  const under25Odds = clampOdds(applyMargin(underProb, totalProb))

  // -------------------------------------------------------
  // 4. Both Teams to Score (BTTS)
  // -------------------------------------------------------
  let bttsYesCount = 0
  let bttsNoCount = 0

  for (const m of goalsMatches) {
    const hs = m.home_score ?? 0
    const as_ = m.away_score ?? 0
    if (hs > 0 && as_ > 0) bttsYesCount++
    else bttsNoCount++
  }

  const totalBtts = bttsYesCount + bttsNoCount
  let bttsYesProb = totalBtts > 0 ? bttsYesCount / totalBtts : 0.48
  let bttsNoProb = 1 - bttsYesProb
  ;[bttsYesProb, bttsNoProb] = normalizeProbs([bttsYesProb, bttsNoProb])

  const bttsYesOdds = clampOdds(applyMargin(bttsYesProb, totalProb))
  const bttsNoOdds = clampOdds(applyMargin(bttsNoProb, totalProb))

  return {
    home_win: Math.round(homeWinOdds * 100) / 100,
    draw: Math.round(drawOdds * 100) / 100,
    away_win: Math.round(awayWinOdds * 100) / 100,
    over_2_5: Math.round(over25Odds * 100) / 100,
    under_2_5: Math.round(under25Odds * 100) / 100,
    btts_yes: Math.round(bttsYesOdds * 100) / 100,
    btts_no: Math.round(bttsNoOdds * 100) / 100,
  }
}

/** Calculate exact score odds using Poisson distribution */
export function calculateExactScoreOdds(
  homeAvgGoals: number,
  awayAvgGoals: number,
  homeScore: number,
  awayScore: number
): number {
  const prob =
    poissonPmf(homeAvgGoals, homeScore) * poissonPmf(awayAvgGoals, awayScore)
  if (prob <= 0) return MAX_ODDS
  const rawOdds = (1 / prob) * (1 + HOUSE_MARGIN)
  return clampOdds(Math.round(rawOdds * 100) / 100)
}

export function getTeamAvgGoals(
  matches: Match[],
  teamId: number,
  asHome: boolean
): number {
  const relevant = matches.filter(
    (m) =>
      m.status === 'finished' &&
      (asHome ? m.home_team_id === teamId : m.away_team_id === teamId)
  )
  if (relevant.length === 0) return 1.3
  const total = relevant.reduce(
    (acc, m) => acc + (asHome ? (m.home_score ?? 0) : (m.away_score ?? 0)),
    0
  )
  return total / relevant.length
}
