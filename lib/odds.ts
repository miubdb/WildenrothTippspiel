import type { Match, OddsData } from '@/types'

// ---------- Constants ----------

const HOUSE_MARGIN = 0.12
const MIN_ODDS = 1.05
const MAX_ODDS = 100.0 // high cap so exact scores spread naturally

// Per-team league baselines (Kreisklasse: ~2.6 goals/game total, more clean sheets than pro leagues)
const LEAGUE_HOME_XG = 1.50
const LEAGUE_AWAY_XG = 1.10

// Bayesian prior weight: K equivalent games of prior belief.
// With K=5 and 0 real games → 100% league avg; with 5 games → 50/50; with 10 → 33% prior
const XG_PRIOR = 5

// ---------- Math helpers ----------

function clamp(odds: number): number {
  return Math.max(MIN_ODDS, Math.min(MAX_ODDS, odds))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Convert a raw probability to bookmaker odds.
 * Formula: Q = 1 / (p × (1 + margin))
 * Implied-prob sum = Σ p×(1+m) = 1×(1+m) > 1 → no arbitrage possible.
 */
function toOdds(prob: number): number {
  if (prob <= 0) return MAX_ODDS
  return clamp(round2(1 / (prob * (1 + HOUSE_MARGIN))))
}

/** Poisson probability mass function (log-space for numerical stability) */
function poisson(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0
  let logP = k * Math.log(lambda) - lambda
  for (let i = 1; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

/**
 * Build a home×away score probability matrix using independent Poisson for each team.
 * All downstream markets are derived from this single matrix for full consistency.
 */
function buildScoreMatrix(homeXG: number, awayXG: number, maxGoals = 8): number[][] {
  const matrix: number[][] = []
  for (let h = 0; h <= maxGoals; h++) {
    matrix[h] = []
    for (let a = 0; a <= maxGoals; a++) {
      matrix[h][a] = poisson(homeXG, h) * poisson(awayXG, a)
    }
  }
  return matrix
}

// ---------- Team statistics (used in standings / form display) ----------

/** Points per game at HOME only */
function getTeamHomePPG(matches: Match[], teamId: number): number {
  const games = matches.filter(
    (m) => m.status === 'finished' && m.home_team_id === teamId
  )
  if (games.length < 3) return getTeamPPG(matches, teamId)
  const pts = games.reduce((acc, m) => {
    const hs = m.home_score ?? 0; const as_ = m.away_score ?? 0
    return acc + (hs > as_ ? 3 : hs === as_ ? 1 : 0)
  }, 0)
  return pts / games.length
}

/** Points per game AWAY only */
function getTeamAwayPPG(matches: Match[], teamId: number): number {
  const games = matches.filter(
    (m) => m.status === 'finished' && m.away_team_id === teamId
  )
  if (games.length < 3) return getTeamPPG(matches, teamId)
  const pts = games.reduce((acc, m) => {
    const hs = m.home_score ?? 0; const as_ = m.away_score ?? 0
    return acc + (as_ > hs ? 3 : hs === as_ ? 1 : 0)
  }, 0)
  return pts / games.length
}

/** Overall points per game (all games) */
export function getTeamPPG(matches: Match[], teamId: number): number {
  const games = matches.filter(
    (m) =>
      m.status === 'finished' &&
      (m.home_team_id === teamId || m.away_team_id === teamId)
  )
  if (games.length === 0) return 1.0
  const pts = games.reduce((acc, m) => {
    const hs = m.home_score ?? 0; const as_ = m.away_score ?? 0
    const isHome = m.home_team_id === teamId
    return acc + ((isHome ? hs > as_ : as_ > hs) ? 3 : hs === as_ ? 1 : 0)
  }, 0)
  return pts / games.length
}

/** Last N results as W/D/L (oldest first) */
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
    const hs = m.home_score ?? 0; const as_ = m.away_score ?? 0
    const isHome = m.home_team_id === teamId
    if ((isHome && hs > as_) || (!isHome && as_ > hs)) return 'W'
    if (hs === as_) return 'D'
    return 'L'
  }).reverse()
}

/** Team record for display in match card */
export function getTeamRecord(matches: Match[], teamId: number) {
  const games = matches.filter(
    (m) =>
      m.status === 'finished' &&
      (m.home_team_id === teamId || m.away_team_id === teamId)
  )
  let w = 0, d = 0, l = 0, gf = 0, ga = 0
  for (const m of games) {
    const hs = m.home_score ?? 0; const as_ = m.away_score ?? 0
    const isHome = m.home_team_id === teamId
    if ((isHome && hs > as_) || (!isHome && as_ > hs)) w++
    else if (hs === as_) d++
    else l++
    gf += isHome ? hs : as_
    ga += isHome ? as_ : hs
  }
  return { played: games.length, w, d, l, gf, ga, gd: gf - ga, pts: w * 3 + d }
}

// ---------- xG estimation with Bayesian shrinkage ----------

/**
 * Bayesian shrinkage toward league mean.
 * raw: observed average | leagueAvg: prior | n: observed games
 */
function bayesianXG(raw: number, leagueAvg: number, n: number): number {
  return (n * raw + XG_PRIOR * leagueAvg) / (n + XG_PRIOR)
}

/** Goals scored per home game for teamId */
function homeGoalsScored(matches: Match[], teamId: number): { avg: number; n: number } {
  const games = matches.filter((m) => m.status === 'finished' && m.home_team_id === teamId)
  if (games.length === 0) return { avg: LEAGUE_HOME_XG, n: 0 }
  return { avg: games.reduce((s, m) => s + (m.home_score ?? 0), 0) / games.length, n: games.length }
}

/** Goals conceded per away game for teamId (= how many the home team scored against them) */
function awayGoalsConceded(matches: Match[], teamId: number): { avg: number; n: number } {
  const games = matches.filter((m) => m.status === 'finished' && m.away_team_id === teamId)
  if (games.length === 0) return { avg: LEAGUE_HOME_XG, n: 0 }
  return { avg: games.reduce((s, m) => s + (m.home_score ?? 0), 0) / games.length, n: games.length }
}

/** Goals scored per away game for teamId */
function awayGoalsScored(matches: Match[], teamId: number): { avg: number; n: number } {
  const games = matches.filter((m) => m.status === 'finished' && m.away_team_id === teamId)
  if (games.length === 0) return { avg: LEAGUE_AWAY_XG, n: 0 }
  return { avg: games.reduce((s, m) => s + (m.away_score ?? 0), 0) / games.length, n: games.length }
}

/** Goals conceded per home game for teamId (= how many the away team scored against them) */
function homeGoalsConceded(matches: Match[], teamId: number): { avg: number; n: number } {
  const games = matches.filter((m) => m.status === 'finished' && m.home_team_id === teamId)
  if (games.length === 0) return { avg: LEAGUE_AWAY_XG, n: 0 }
  return { avg: games.reduce((s, m) => s + (m.away_score ?? 0), 0) / games.length, n: games.length }
}

/**
 * Compute match-specific expected goals from a combined attack/defense model.
 *
 * rawHomeXG = mean of (home team's avg goals scored at home, away team's avg goals conceded away)
 * rawAwayXG = mean of (away team's avg goals scored away, home team's avg goals conceded at home)
 *
 * Both are then shrunk toward the league average with Bayesian weight XG_PRIOR.
 */
function getMatchXG(
  matches: Match[],
  homeTeamId: number,
  awayTeamId: number
): { homeXG: number; awayXG: number } {
  const homeAtk = homeGoalsScored(matches, homeTeamId)
  const awayDef = awayGoalsConceded(matches, awayTeamId)
  const awayAtk = awayGoalsScored(matches, awayTeamId)
  const homeDef = homeGoalsConceded(matches, homeTeamId)

  // Combine attack/defense evidence and average games for shrinkage weight
  const rawHomeXG = (homeAtk.avg + awayDef.avg) / 2
  const rawAwayXG = (awayAtk.avg + homeDef.avg) / 2
  const homeN = (homeAtk.n + awayDef.n) / 2
  const awayN = (awayAtk.n + homeDef.n) / 2

  return {
    homeXG: Math.max(0.3, bayesianXG(rawHomeXG, LEAGUE_HOME_XG, homeN)),
    awayXG: Math.max(0.3, bayesianXG(rawAwayXG, LEAGUE_AWAY_XG, awayN)),
  }
}

// ---------- Main calculation (all markets from one unified Poisson model) ----------

export function calculateOdds(
  matches: Match[],
  homeTeamId: number,
  awayTeamId: number
): OddsData {
  const { homeXG, awayXG } = getMatchXG(matches, homeTeamId, awayTeamId)
  const matrix = buildScoreMatrix(homeXG, awayXG)

  // Aggregate raw probabilities from the joint score distribution
  let pHome = 0, pDraw = 0, pAway = 0
  let pOver25 = 0, pOver35 = 0
  let pBtts = 0

  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      const p = matrix[h][a]
      if (h > a) pHome += p
      else if (h === a) pDraw += p
      else pAway += p
      if (h + a > 2) pOver25 += p
      if (h + a > 3) pOver35 += p
      if (h > 0 && a > 0) pBtts += p
    }
  }

  // Double chance: derived consistently from the same 1X2 probabilities
  const p1x = pHome + pDraw
  const px2 = pDraw + pAway
  const p12 = pHome + pAway

  // Apply consistent bookmaker margin to every market via toOdds()
  return {
    home_win:  toOdds(pHome),
    draw:      toOdds(pDraw),
    away_win:  toOdds(pAway),
    odds_1x:   toOdds(p1x),
    odds_x2:   toOdds(px2),
    odds_12:   toOdds(p12),
    over_2_5:  toOdds(pOver25),
    under_2_5: toOdds(1 - pOver25),
    over_3_5:  toOdds(pOver35),
    under_3_5: toOdds(1 - pOver35),
    btts_yes:  toOdds(pBtts),
    btts_no:   toOdds(1 - pBtts),
  }
}

/** Exact-score odds grid derived from the same Poisson model as calculateOdds */
export function getExactScoreOdds(
  matches: Match[],
  homeTeamId: number,
  awayTeamId: number
): { score: string; odds: number }[] {
  const { homeXG, awayXG } = getMatchXG(matches, homeTeamId, awayTeamId)

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

  return scores.map(([h, a]) => ({
    score: `${h}:${a}`,
    odds: toOdds(poisson(homeXG, h) * poisson(awayXG, a)),
  }))
}
