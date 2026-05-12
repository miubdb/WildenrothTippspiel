import type { Match, OddsData } from '@/types'

// ---------- Constants ----------

const HOUSE_MARGIN = 0.12
const MIN_ODDS = 1.05
const MAX_ODDS = 100.0 // high cap so exact scores spread naturally

// Per-team league baselines (Kreisklasse: ~2.35 goals/game total).
// Moderate home/away gap; baselines kept conservative so BTTS and O/U
// don't floor even for genuinely high-scoring matchups.
const LEAGUE_HOME_XG = 1.25
const LEAGUE_AWAY_XG = 1.10

// Bayesian prior weight: K equivalent games of prior belief.
// With K=5: at 0 games → 100% prior; at 5 games → 50/50; at 10 games → 67% actual data.
// Kept moderate so real team data shines through without the geometric product exploding.
const XG_PRIOR = 5

// Form multiplier from the last 5 finished games — moderate ±20% adjustment.
// Pure season-long attack/defense averages can't capture momentum, so an
// in-form team gets a meaningful xG boost beyond what their season totals show.
const FORM_GAMES = 5
const FORM_MULT_BASE = 0.80
const FORM_MULT_RANGE = 0.40 // result range [0.80, 1.20]

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

// ---------- xG estimation — geometric-mean attack/defense model with Bayesian shrinkage ----------

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
 * Form multiplier from the last FORM_GAMES finished matches (W=3, D=1, L=0).
 * Maps the form ratio [0, 1] linearly to [FORM_MULT_BASE, FORM_MULT_BASE+FORM_MULT_RANGE].
 * Needs at least 3 games of history to apply — otherwise neutral (1.0).
 *
 * Season-long attack/defense averages alone don't reflect momentum. A top-of-table
 * team riding a streak (or a struggling team in a slump) shows up in form first,
 * before the season averages catch up. The multiplier injects that signal into
 * the team's own xG so real, current sporting differences come through clearly.
 */
function getTeamFormMult(matches: Match[], teamId: number): number {
  const form = getForm(matches, teamId, FORM_GAMES)
  if (form.length < 3) return 1.0
  const pts = form.reduce((acc, r) => acc + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0)
  return FORM_MULT_BASE + FORM_MULT_RANGE * (pts / (form.length * 3))
}

/**
 * Geometric-mean xG model with Bayesian shrinkage and form adjustment.
 *
 * Why geometric mean (not arithmetic, not full product):
 * - Arithmetic mean `(atk + def) / 2` underestimates compounding quality mismatches.
 * - Full product `L × atkRate × defRate` overestimates them — two rates of 1.8×
 *   combine to 3.24×, producing absurdly short O/U and BTTS odds.
 * - Geometric mean `sqrt(atk × def)` threads the needle: identical to the
 *   arithmetic mean for equal values, lower for unequal values (AM–GM inequality),
 *   so a strong attacker vs a strong defence still yields moderate xG (correct).
 *
 * Bayesian shrinkage (K=5) is applied to the combined raw estimate. A team-form
 * multiplier (±20%) then modulates each team's own xG to reflect recent momentum
 * that the season-long averages haven't fully absorbed yet.
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

  const rawHomeXG = Math.sqrt(homeAtk.avg * awayDef.avg)
  const rawAwayXG = Math.sqrt(awayAtk.avg * homeDef.avg)
  const homeN = (homeAtk.n + awayDef.n) / 2
  const awayN = (awayAtk.n + homeDef.n) / 2

  const homeFormMult = getTeamFormMult(matches, homeTeamId)
  const awayFormMult = getTeamFormMult(matches, awayTeamId)

  return {
    homeXG: Math.max(0.25, bayesianXG(rawHomeXG, LEAGUE_HOME_XG, homeN) * homeFormMult),
    awayXG: Math.max(0.25, bayesianXG(rawAwayXG, LEAGUE_AWAY_XG, awayN) * awayFormMult),
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
  let pOver25 = 0, pOver35 = 0, pOver55 = 0, pOver75 = 0
  let pBtts = 0
  let pHomeMinus15 = 0, pHomeMinus25 = 0

  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      const p = matrix[h][a]
      if (h > a) pHome += p
      else if (h === a) pDraw += p
      else pAway += p
      if (h + a > 2) pOver25 += p
      if (h + a > 3) pOver35 += p
      if (h + a > 5) pOver55 += p
      if (h + a > 7) pOver75 += p
      if (h > 0 && a > 0) pBtts += p
      if (h - a >= 2) pHomeMinus15 += p
      if (h - a >= 3) pHomeMinus25 += p
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
    over_5_5:  toOdds(pOver55),
    under_5_5: toOdds(1 - pOver55),
    over_7_5:  toOdds(pOver75),
    under_7_5: toOdds(1 - pOver75),
    btts_yes:  toOdds(pBtts),
    btts_no:   toOdds(1 - pBtts),
    hdp_home_minus_1_5: toOdds(pHomeMinus15),
    hdp_away_plus_1_5:  toOdds(1 - pHomeMinus15),
    hdp_home_minus_2_5: toOdds(pHomeMinus25),
    hdp_away_plus_2_5:  toOdds(1 - pHomeMinus25),
  }
}

/**
 * Exact-score odds derived from the same Poisson model as calculateOdds.
 * Only scores with odds ≤ MAX_EXACT_ODDS are offered — scores above that
 * threshold are so unlikely (P < ~1.8%) they add noise without meaningful value.
 * Consistent with 1X2: the house margin factor is identical for every score,
 * so the sum of exact-score implied probabilities for any subset is always ≤
 * the corresponding 1X2 implied probability. No arbitrage across markets is possible.
 */
const MAX_EXACT_ODDS = 60

export function getExactScoreOdds(
  matches: Match[],
  homeTeamId: number,
  awayTeamId: number
): { score: string; odds: number }[] {
  const { homeXG, awayXG } = getMatchXG(matches, homeTeamId, awayTeamId)

  const results: { score: string; odds: number; total: number; homeGoals: number }[] = []

  for (let h = 0; h <= 7; h++) {
    for (let a = 0; a <= 7; a++) {
      const o = toOdds(poisson(homeXG, h) * poisson(awayXG, a))
      if (o <= MAX_EXACT_ODDS) {
        results.push({ score: `${h}:${a}`, odds: o, total: h + a, homeGoals: h })
      }
    }
  }

  // Sort: fewest total goals first; within same total, more home goals first
  results.sort((a, b) => a.total - b.total || b.homeGoals - a.homeGoals)

  return results.map(({ score, odds }) => ({ score, odds }))
}
