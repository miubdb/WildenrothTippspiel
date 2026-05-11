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

function toOdds(prob: number): number {
  return clamp(round2(1 / (prob / (1 + HOUSE_MARGIN))))
}

/** Poisson probability mass function */
function poisson(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0
  let logP = k * Math.log(lambda) - lambda
  for (let i = 1; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

// ---------- Team statistics ----------

/** Points per game at HOME only */
function getTeamHomePPG(matches: Match[], teamId: number): number {
  const games = matches.filter(
    (m) => m.status === 'finished' && m.home_team_id === teamId
  )
  if (games.length < 3) return getTeamPPG(matches, teamId) // fallback
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
  if (games.length < 3) return getTeamPPG(matches, teamId) // fallback
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

/** Last N results as W/D/L */
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

/** Points from last N games */
function getFormPts(matches: Match[], teamId: number, n: number): number {
  const form = getForm(matches, teamId, n)
  return form.reduce((acc, r) => acc + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0)
}

/** Average goals scored per game */
function avgScored(matches: Match[], teamId: number): number {
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
function avgConceded(matches: Match[], teamId: number): number {
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

/** Team record for display */
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

// ---------- Main calculation ----------

export function calculateOdds(
  matches: Match[],
  homeTeamId: number,
  awayTeamId: number
): OddsData {
  // --- Strength: home/away specific PPG + recent form ---
  const homeHomePPG = getTeamHomePPG(matches, homeTeamId)
  const awayAwayPPG = getTeamAwayPPG(matches, awayTeamId)

  // Form factor: L5 points / 15 (max) → multiplier 0.65..1.35
  const homeFormFactor = getFormPts(matches, homeTeamId, 5) / 15  // 0..1
  const awayFormFactor = getFormPts(matches, awayTeamId, 5) / 15
  const homeFormMult = 0.65 + 0.70 * homeFormFactor  // 0.65 (terrible form) – 1.35 (perfect form)
  const awayFormMult = 0.65 + 0.70 * awayFormFactor

  // Multiplicative model: PPG dominates, form adjusts ±35%
  const homeStr = homeHomePPG * homeFormMult
  const awayStr = awayAwayPPG * awayFormMult

  const total = homeStr + awayStr || 2.0 // avoid div by zero
  const pHomeRaw = homeStr / total
  const pAwayRaw = awayStr / total

  // Draw prob: realistic floor for amateur football (~13%), drops off for mismatches
  const mismatch = Math.abs(pHomeRaw - pAwayRaw)
  const pDraw = Math.max(0.13, 0.28 - 0.30 * mismatch)
  const pHome = pHomeRaw * (1 - pDraw)
  const pAway = pAwayRaw * (1 - pDraw)

  // Normalize implied probabilities + house margin
  const overround = pHome + pDraw + pAway
  const homeWinOdds = toOdds(pHome / overround)
  const drawOdds    = toOdds(pDraw / overround)
  const awayWinOdds = toOdds(pAway / overround)

  // --- xG: team attack vs opponent defence, shrunk towards ~1.6 ---
  const LEAGUE_XG = 1.6  // representative league average per team
  const SHRINK     = 0.25
  const rawHomeXG = (avgScored(matches, homeTeamId) + avgConceded(matches, awayTeamId)) / 2
  const rawAwayXG = (avgScored(matches, awayTeamId) + avgConceded(matches, homeTeamId)) / 2
  const homeXG = (1 - SHRINK) * rawHomeXG + SHRINK * LEAGUE_XG
  const awayXG = (1 - SHRINK) * rawAwayXG + SHRINK * LEAGUE_XG

  // --- Over/Under 2.5 ---
  let pOver25 = 0
  for (let h = 0; h <= 9; h++) {
    for (let a = 0; a <= 9; a++) {
      if (h + a > 2) pOver25 += poisson(homeXG, h) * poisson(awayXG, a)
    }
  }
  pOver25 = Math.max(0.05, Math.min(0.97, pOver25))
  const over25Odds  = toOdds(pOver25)
  const under25Odds = toOdds(1 - pOver25)

  // --- Over/Under 3.5 ---
  let pOver35 = 0
  for (let h = 0; h <= 9; h++) {
    for (let a = 0; a <= 9; a++) {
      if (h + a > 3) pOver35 += poisson(homeXG, h) * poisson(awayXG, a)
    }
  }
  pOver35 = Math.max(0.05, Math.min(0.97, pOver35))
  const over35Odds  = toOdds(pOver35)
  const under35Odds = toOdds(1 - pOver35)

  // --- BTTS ---
  const pBttsYes = Math.max(0.05, Math.min(0.97,
    (1 - poisson(homeXG, 0)) * (1 - poisson(awayXG, 0))
  ))
  const bttsYesOdds = toOdds(pBttsYes)
  const bttsNoOdds  = toOdds(1 - pBttsYes)

  // --- Double Chance ---
  const odds_1x = toOdds((pHome + pDraw) / overround)
  const odds_x2 = toOdds((pDraw + pAway) / overround)
  const odds_12 = toOdds((pHome + pAway) / overround)

  return {
    home_win:  homeWinOdds,
    draw:      drawOdds,
    away_win:  awayWinOdds,
    odds_1x,
    odds_x2,
    odds_12,
    over_2_5:  over25Odds,
    under_2_5: under25Odds,
    over_3_5:  over35Odds,
    under_3_5: under35Odds,
    btts_yes:  bttsYesOdds,
    btts_no:   bttsNoOdds,
  }
}

/** Exact-score odds grid (Poisson, 23 common scores) */
export function getExactScoreOdds(
  matches: Match[],
  homeTeamId: number,
  awayTeamId: number
): { score: string; odds: number }[] {
  const LEAGUE_XG = 1.8
  const SHRINK    = 0.15
  const rawHomeXG = (avgScored(matches, homeTeamId) + avgConceded(matches, awayTeamId)) / 2
  const rawAwayXG = (avgScored(matches, awayTeamId) + avgConceded(matches, homeTeamId)) / 2
  const homeXG = (1 - SHRINK) * rawHomeXG + SHRINK * LEAGUE_XG
  const awayXG = (1 - SHRINK) * rawAwayXG + SHRINK * LEAGUE_XG

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
    return {
      score: `${h}:${a}`,
      odds: clamp(round2(prob > 0 ? (1 / prob) * (1 + HOUSE_MARGIN) : MAX_ODDS)),
    }
  })
}
