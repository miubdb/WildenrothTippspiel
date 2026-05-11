import type { Match, OddsData } from '@/types'

const HOUSE_MARGIN = 0.10
const MIN_ODDS = 1.05
const MAX_ODDS = 20.0

function clamp(odds: number): number {
  return Math.max(MIN_ODDS, Math.min(MAX_ODDS, odds))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Poisson probability mass function */
function poisson(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0
  let logP = k * Math.log(lambda) - lambda
  for (let i = 1; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

/** Team strength: points per game from all finished matches */
export function getTeamPPG(matches: Match[], teamId: number): number {
  const games = matches.filter(
    (m) =>
      m.status === 'finished' &&
      (m.home_team_id === teamId || m.away_team_id === teamId)
  )
  if (games.length === 0) return 1.0

  let pts = 0
  for (const m of games) {
    const hs = m.home_score ?? 0
    const as_ = m.away_score ?? 0
    const isHome = m.home_team_id === teamId
    if ((isHome && hs > as_) || (!isHome && as_ > hs)) pts += 3
    else if (hs === as_) pts += 1
  }
  return pts / games.length
}

/** Average goals scored per game */
function avgGoalsScored(matches: Match[], teamId: number): number {
  const games = matches.filter(
    (m) =>
      m.status === 'finished' &&
      (m.home_team_id === teamId || m.away_team_id === teamId)
  )
  if (games.length === 0) return 1.5
  const total = games.reduce((acc, m) => {
    const isHome = m.home_team_id === teamId
    return acc + (isHome ? (m.home_score ?? 0) : (m.away_score ?? 0))
  }, 0)
  return total / games.length
}

/** Average goals conceded per game */
function avgGoalsConceded(matches: Match[], teamId: number): number {
  const games = matches.filter(
    (m) =>
      m.status === 'finished' &&
      (m.home_team_id === teamId || m.away_team_id === teamId)
  )
  if (games.length === 0) return 1.5
  const total = games.reduce((acc, m) => {
    const isHome = m.home_team_id === teamId
    return acc + (isHome ? (m.away_score ?? 0) : (m.home_score ?? 0))
  }, 0)
  return total / games.length
}

/** Get last N results for a team as 'W'|'D'|'L' */
export function getForm(matches: Match[], teamId: number, n = 5): ('W' | 'D' | 'L')[] {
  const games = matches
    .filter(
      (m) =>
        m.status === 'finished' &&
        (m.home_team_id === teamId || m.away_team_id === teamId)
    )
    .sort((a, b) => new Date(b.match_date).getTime() - new Date(a.match_date).getTime())
    .slice(0, n)

  return games.map((m) => {
    const hs = m.home_score ?? 0
    const as_ = m.away_score ?? 0
    const isHome = m.home_team_id === teamId
    if ((isHome && hs > as_) || (!isHome && as_ > hs)) return 'W'
    if (hs === as_) return 'D'
    return 'L'
  }).reverse()
}

/**
 * Main odds calculation.
 * Uses points-per-game as strength, Poisson for goal markets.
 */
export function calculateOdds(
  matches: Match[],
  homeTeamId: number,
  awayTeamId: number
): OddsData {
  // --- 1X2 via strength model ---
  const homePPG = getTeamPPG(matches, homeTeamId)
  const awayPPG = getTeamPPG(matches, awayTeamId)

  // Home advantage: +0.5 bonus ppg
  const homeStr = homePPG + 0.5
  const awayStr = awayPPG
  const total = homeStr + awayStr

  const pHomeRaw = homeStr / total
  const pAwayRaw = awayStr / total

  // Draw probability: highest when teams are equal, falls off as mismatch grows
  const mismatch = Math.abs(pHomeRaw - pAwayRaw)
  const pDraw = Math.max(0.08, 0.28 - 0.45 * mismatch)
  const pHome = pHomeRaw * (1 - pDraw)
  const pAway = pAwayRaw * (1 - pDraw)

  // Normalize + apply house margin
  const sumProb = (pHome + pDraw + pAway) * (1 + HOUSE_MARGIN)
  const homeWinOdds = clamp(round2(sumProb / pHome))
  const drawOdds = clamp(round2(sumProb / pDraw))
  const awayWinOdds = clamp(round2(sumProb / pAway))

  // --- Goal markets via Poisson xG ---
  const homeXG = (avgGoalsScored(matches, homeTeamId) + avgGoalsConceded(matches, awayTeamId)) / 2
  const awayXG = (avgGoalsScored(matches, awayTeamId) + avgGoalsConceded(matches, homeTeamId)) / 2

  // Over/Under 2.5
  let pOver = 0
  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      if (h + a > 2) pOver += poisson(homeXG, h) * poisson(awayXG, a)
    }
  }
  pOver = Math.max(0.05, Math.min(0.97, pOver))
  const pUnder = 1 - pOver
  const over25Odds = clamp(round2(1 / (pOver / (1 + HOUSE_MARGIN))))
  const under25Odds = clamp(round2(1 / (pUnder / (1 + HOUSE_MARGIN))))

  // BTTS
  const pHomeScoredAtLeast1 = 1 - poisson(homeXG, 0)
  const pAwayScoredAtLeast1 = 1 - poisson(awayXG, 0)
  const pBttsYes = Math.max(0.05, Math.min(0.97, pHomeScoredAtLeast1 * pAwayScoredAtLeast1))
  const pBttsNo = 1 - pBttsYes
  const bttsYesOdds = clamp(round2(1 / (pBttsYes / (1 + HOUSE_MARGIN))))
  const bttsNoOdds = clamp(round2(1 / (pBttsNo / (1 + HOUSE_MARGIN))))

  return {
    home_win: homeWinOdds,
    draw: drawOdds,
    away_win: awayWinOdds,
    over_2_5: over25Odds,
    under_2_5: under25Odds,
    btts_yes: bttsYesOdds,
    btts_no: bttsNoOdds,
  }
}

/**
 * Returns a grid of exact score odds for display.
 * Covers the most common scores in amateur football.
 */
export function getExactScoreOdds(
  matches: Match[],
  homeTeamId: number,
  awayTeamId: number
): { score: string; home: number; away: number; odds: number }[] {
  const homeXG = (avgGoalsScored(matches, homeTeamId) + avgGoalsConceded(matches, awayTeamId)) / 2
  const awayXG = (avgGoalsScored(matches, awayTeamId) + avgGoalsConceded(matches, homeTeamId)) / 2

  const scores: [number, number][] = [
    [0, 0], [1, 0], [0, 1],
    [1, 1], [2, 0], [0, 2],
    [2, 1], [1, 2], [2, 2],
    [3, 0], [0, 3], [3, 1],
    [1, 3], [3, 2], [2, 3],
    [4, 0], [0, 4], [4, 1],
    [1, 4], [4, 2], [2, 4],
    [5, 0], [0, 5],
  ]

  return scores.map(([h, a]) => {
    const prob = poisson(homeXG, h) * poisson(awayXG, a)
    const rawOdds = prob > 0 ? (1 / prob) * (1 + HOUSE_MARGIN) : MAX_ODDS
    return {
      score: `${h}:${a}`,
      home: h,
      away: a,
      odds: clamp(round2(rawOdds)),
    }
  })
}

/** Team record summary for display */
export function getTeamRecord(matches: Match[], teamId: number) {
  const games = matches.filter(
    (m) =>
      m.status === 'finished' &&
      (m.home_team_id === teamId || m.away_team_id === teamId)
  )

  let w = 0, d = 0, l = 0, gf = 0, ga = 0
  for (const m of games) {
    const hs = m.home_score ?? 0
    const as_ = m.away_score ?? 0
    const isHome = m.home_team_id === teamId
    if ((isHome && hs > as_) || (!isHome && as_ > hs)) w++
    else if (hs === as_) d++
    else l++
    gf += isHome ? hs : as_
    ga += isHome ? as_ : hs
  }

  return { played: games.length, w, d, l, gf, ga, gd: gf - ga, pts: w * 3 + d }
}
