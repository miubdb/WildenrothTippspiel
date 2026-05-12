import type { Match, OddsData } from '@/types'

// ---------- Constants ----------

const HOUSE_MARGIN = 0.12
const MIN_ODDS = 1.05
const MAX_ODDS = 100.0 // high cap so exact scores spread naturally

// Per-team league baselines (Kreisklasse: ~2.25 goals/game total).
// Small home/away gap keeps away-favorites from being over-penalised by the prior.
const LEAGUE_HOME_XG = 1.20
const LEAGUE_AWAY_XG = 1.05

// Bayesian prior weight: K equivalent games of prior belief.
// With K=4: at 0 games → 100% prior; at 4 games → 50/50; at 8 games → 67% actual data.
const XG_PRIOR = 4

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

// ---------- xG estimation — multiplicative Dixon-Coles model with Bayesian shrinkage ----------

/**
 * Bayesian strength rate relative to the league average.
 * Returns how many times above/below league average this observation is,
 * shrunk toward 1.0 with XG_PRIOR equivalent games of prior belief.
 * With n=0 the result is always 1.0 (pure prior = league average).
 */
function bayesianRate(raw: number, leagueAvg: number, n: number): number {
  return (n * raw + XG_PRIOR * leagueAvg) / ((n + XG_PRIOR) * leagueAvg)
}

/** Goals scored per home game for teamId */
function homeGoalsScored(matches: Match[], teamId: number): { avg: number; n: number } {
  const games = matches.filter((m) => m.status === 'finished' && m.home_team_id === teamId)
  if (games.length === 0) return { avg: LEAGUE_HOME_XG, n: 0 }
  return { avg: games.reduce((s, m) => s + (m.home_score ?? 0), 0) / games.length, n: games.length }
}

/** Goals conceded per away game for teamId (scored by the opposing home team) */
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

/** Goals conceded per home game for teamId (scored by the opposing away team) */
function homeGoalsConceded(matches: Match[], teamId: number): { avg: number; n: number } {
  const games = matches.filter((m) => m.status === 'finished' && m.home_team_id === teamId)
  if (games.length === 0) return { avg: LEAGUE_AWAY_XG, n: 0 }
  return { avg: games.reduce((s, m) => s + (m.away_score ?? 0), 0) / games.length, n: games.length }
}

/**
 * Multiplicative Dixon-Coles xG model with Bayesian shrinkage.
 *
 * Each team's attack and defense is expressed as a rate relative to the
 * league average (1.0 = average), shrunk toward 1.0 with XG_PRIOR games.
 *
 * homeXG = LEAGUE_HOME_XG × homeAtkRate × awayDefRate
 * awayXG = LEAGUE_AWAY_XG × awayAtkRate × homeDefRate
 *
 * Advantages over the additive mean approach:
 * - Quality mismatches compound: a strong attacker vs a weak defense gets
 *   amplified rather than averaged, creating more spread across matchups.
 * - Home advantage is driven by real home/away data, not a hard-coded gap.
 * - BTTS and O/U naturally vary more between structurally different games.
 */
function getMatchXG(
  matches: Match[],
  homeTeamId: number,
  awayTeamId: number
): { homeXG: number; awayXG: number } {
  const homeAtk = homeGoalsScored(matches, homeTeamId)    // home team goals scored at home
  const awayDef = awayGoalsConceded(matches, awayTeamId)  // away team goals conceded away
  const awayAtk = awayGoalsScored(matches, awayTeamId)    // away team goals scored away
  const homeDef = homeGoalsConceded(matches, homeTeamId)  // home team goals conceded at home

  // Rates relative to league baseline; n=0 → rate=1.0 (full prior)
  const homeAtkRate = bayesianRate(homeAtk.avg, LEAGUE_HOME_XG, homeAtk.n)
  const awayDefRate = bayesianRate(awayDef.avg, LEAGUE_HOME_XG, awayDef.n)
  const awayAtkRate = bayesianRate(awayAtk.avg, LEAGUE_AWAY_XG, awayAtk.n)
  const homeDefRate = bayesianRate(homeDef.avg, LEAGUE_AWAY_XG, homeDef.n)

  return {
    homeXG: Math.max(0.20, LEAGUE_HOME_XG * homeAtkRate * awayDefRate),
    awayXG: Math.max(0.20, LEAGUE_AWAY_XG * awayAtkRate * homeDefRate),
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
