import type { Match, OddsData, PriorMatch, LeaguePlayer, LineupEntry } from '@/types'

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
//
// v2: K is stronger during a team's first EARLY_GAMES_THRESHOLD games of the CURRENT
// season (ramping down linearly to the base value), since a 1-3 game sample in amateur
// football is extremely noisy — this is on top of, not instead of, the prior-season
// blending in augmentStat(), which already covers "no current-season data at all".
const XG_PRIOR = 5
const XG_PRIOR_EARLY_BONUS = 6
const EARLY_GAMES_THRESHOLD = 8

// Form multiplier from the last 5 finished games — moderate ±10% adjustment (v2: was ±20%).
// Pure season-long attack/defense averages can't capture momentum, so an
// in-form team gets a meaningful xG boost beyond what their season totals show.
// v2: ramped in linearly between FORM_RAMP_START and FORM_RAMP_FULL current-season
// games played, instead of snapping to full strength the moment 3 games exist — a
// 3-game sample was swinging odds by the full ±20% (now ±10%) with no runway.
const FORM_GAMES = 5
const FORM_MULT_BASE = 0.90
const FORM_MULT_RANGE = 0.20 // result range [0.90, 1.10] at full ramp
const FORM_RAMP_START = 3
const FORM_RAMP_FULL = 8

// Prior-season cross-league normalization.
// Prior games count at half weight vs current-season games; a full prior season
// (~15 home + 15 away games) contributes ~7.5 pseudo-observations each side.
const PRIOR_WEIGHT = 0.5
// League-strength multiplier: how team performance in the prior league translates
// to the target league. Bezirksliga teams are stronger, Kreisklasse teams weaker.
const LEAGUE_STRENGTH: Record<PriorMatch['league_level'], number> = {
  bezirksliga: 1.10,
  kreisliga:   1.00,
  kreisklasse: 0.78,
  b_klasse:    0.68,
}

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
function getTeamPPG(matches: Match[], teamId: number): number {
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

// ---------- Prior-season cross-league normalization ----------

interface LeagueAvg {
  homeAvg: number
  awayAvg: number
  level: PriorMatch['league_level']
}

interface PriorTeamStats {
  homeAtk: number  // expected home goals scored in target-league units
  homeDef: number  // expected home goals conceded in target-league units
  awayAtk: number  // expected away goals scored in target-league units
  awayDef: number  // expected away goals conceded in target-league units
  homeGames: number
  awayGames: number
}

export interface PriorContext {
  priorMatches: PriorMatch[]
  teamNames: Map<number, string>
  leagueAvgs: Map<string, LeagueAvg>
  homeAdvMap: Map<string, number>
  awayAdvMap: Map<string, number>
  leaguePlayers: Map<string, LeaguePlayer[]>
  lineups: Map<string, LineupEntry[]>
}

const HOME_ADV_CAP_LOW = 0.75
const HOME_ADV_CAP_HIGH = 1.40

/**
 * Build per-team home/away advantage factors from prior-season data.
 * Factor = teamAvg / leagueAvg, capped to [0.75, 1.40].
 * Applied as a multiplier to rawHomeXG / rawAwayXG before Bayesian shrinkage.
 */
function buildHomeAdvantageMap(priorMatches: PriorMatch[]): {
  homeAdvMap: Map<string, number>
  awayAdvMap: Map<string, number>
} {
  const homeGoals = new Map<string, number>()
  const homeGames = new Map<string, number>()
  const awayGoals = new Map<string, number>()
  const awayGames = new Map<string, number>()

  let totalHomeGoals = 0
  let totalHomeGames = 0
  let totalAwayGoals = 0
  let totalAwayGames = 0

  for (const m of priorMatches) {
    homeGoals.set(m.home_team, (homeGoals.get(m.home_team) ?? 0) + m.home_score)
    homeGames.set(m.home_team, (homeGames.get(m.home_team) ?? 0) + 1)
    awayGoals.set(m.away_team, (awayGoals.get(m.away_team) ?? 0) + m.away_score)
    awayGames.set(m.away_team, (awayGames.get(m.away_team) ?? 0) + 1)
    totalHomeGoals += m.home_score
    totalHomeGames++
    totalAwayGoals += m.away_score
    totalAwayGames++
  }

  const leagueHomeAvg = totalHomeGames > 0 ? totalHomeGoals / totalHomeGames : LEAGUE_HOME_XG
  const leagueAwayAvg = totalAwayGames > 0 ? totalAwayGoals / totalAwayGames : LEAGUE_AWAY_XG

  const homeAdvMap = new Map<string, number>()
  const awayAdvMap = new Map<string, number>()

  for (const [team, g] of homeGames) {
    const avg = (homeGoals.get(team) ?? 0) / g
    const factor = leagueHomeAvg > 0 ? avg / leagueHomeAvg : 1.0
    homeAdvMap.set(team, Math.min(HOME_ADV_CAP_HIGH, Math.max(HOME_ADV_CAP_LOW, factor)))
  }

  for (const [team, g] of awayGames) {
    const avg = (awayGoals.get(team) ?? 0) / g
    const factor = leagueAwayAvg > 0 ? avg / leagueAwayAvg : 1.0
    awayAdvMap.set(team, Math.min(HOME_ADV_CAP_HIGH, Math.max(HOME_ADV_CAP_LOW, factor)))
  }

  return { homeAdvMap, awayAdvMap }
}

/** Pre-compute per-league goal averages once before the match loop. */
function buildLeagueAvgs(priorMatches: PriorMatch[]): Map<string, LeagueAvg> {
  const acc = new Map<string, { homeGoals: number; awayGoals: number; games: number; level: PriorMatch['league_level'] }>()
  for (const m of priorMatches) {
    const key = m.league_number ?? m.league_name
    if (!acc.has(key)) acc.set(key, { homeGoals: 0, awayGoals: 0, games: 0, level: m.league_level })
    const d = acc.get(key)!
    d.homeGoals += m.home_score
    d.awayGoals += m.away_score
    d.games++
  }
  const result = new Map<string, LeagueAvg>()
  for (const [key, d] of acc) {
    result.set(key, {
      homeAvg: d.homeGoals / d.games,
      awayAvg: d.awayGoals / d.games,
      level: d.level,
    })
  }
  return result
}

/**
 * Normalize a team's prior-season stats to target-league units.
 *
 * For each metric the rate vs. the prior-league average is computed, then scaled
 * by the league-strength factor and projected onto the target-league average:
 *   normalizedGoals = (teamAvg / leagueAvg) × strengthFactor × TARGET_LEAGUE_AVG
 */
function getPriorTeamStats(
  priorMatches: PriorMatch[],
  leagueAvgs: Map<string, LeagueAvg>,
  teamName: string
): PriorTeamStats | null {
  type HomeAcc = { homeScored: number[]; homeConceded: number[]; level: PriorMatch['league_level'] }
  type AwayAcc = { awayScored: number[]; awayConceded: number[]; level: PriorMatch['league_level'] }
  const homeByLeague = new Map<string, HomeAcc>()
  const awayByLeague = new Map<string, AwayAcc>()

  for (const m of priorMatches) {
    const key = m.league_number ?? m.league_name
    if (m.home_team === teamName) {
      if (!homeByLeague.has(key)) homeByLeague.set(key, { homeScored: [], homeConceded: [], level: m.league_level })
      const d = homeByLeague.get(key)!
      d.homeScored.push(m.home_score)
      d.homeConceded.push(m.away_score)
    }
    if (m.away_team === teamName) {
      if (!awayByLeague.has(key)) awayByLeague.set(key, { awayScored: [], awayConceded: [], level: m.league_level })
      const d = awayByLeague.get(key)!
      d.awayScored.push(m.away_score)
      d.awayConceded.push(m.home_score)
    }
  }

  if (homeByLeague.size === 0 && awayByLeague.size === 0) return null

  let homeAtkSum = 0, homeDefSum = 0, homeGamesTotal = 0
  let awayAtkSum = 0, awayDefSum = 0, awayGamesTotal = 0

  for (const [key, data] of homeByLeague) {
    const la = leagueAvgs.get(key)
    if (!la) continue
    const sf = LEAGUE_STRENGTH[la.level]
    const n = data.homeScored.length
    const avgScored    = data.homeScored.reduce((s, v) => s + v, 0) / n
    const avgConceded  = data.homeConceded.reduce((s, v) => s + v, 0) / n
    // home goals scored → rate vs la.homeAvg → scale to LEAGUE_HOME_XG
    homeAtkSum += (la.homeAvg > 0 ? avgScored   / la.homeAvg : 1.0) * sf * LEAGUE_HOME_XG * n
    // home goals conceded = away team's goals → rate vs la.awayAvg → scale to LEAGUE_AWAY_XG
    homeDefSum += (la.awayAvg > 0 ? avgConceded / la.awayAvg : 1.0) * sf * LEAGUE_AWAY_XG * n
    homeGamesTotal += n
  }

  for (const [key, data] of awayByLeague) {
    const la = leagueAvgs.get(key)
    if (!la) continue
    const sf = LEAGUE_STRENGTH[la.level]
    const n = data.awayScored.length
    const avgScored    = data.awayScored.reduce((s, v) => s + v, 0) / n
    const avgConceded  = data.awayConceded.reduce((s, v) => s + v, 0) / n
    // away goals scored → rate vs la.awayAvg → scale to LEAGUE_AWAY_XG
    awayAtkSum += (la.awayAvg > 0 ? avgScored   / la.awayAvg : 1.0) * sf * LEAGUE_AWAY_XG * n
    // away goals conceded = home team's goals → rate vs la.homeAvg → scale to LEAGUE_HOME_XG
    awayDefSum += (la.homeAvg > 0 ? avgConceded / la.homeAvg : 1.0) * sf * LEAGUE_HOME_XG * n
    awayGamesTotal += n
  }

  if (homeGamesTotal === 0 && awayGamesTotal === 0) return null

  return {
    homeAtk: homeGamesTotal > 0 ? homeAtkSum / homeGamesTotal : LEAGUE_HOME_XG,
    homeDef: homeGamesTotal > 0 ? homeDefSum / homeGamesTotal : LEAGUE_AWAY_XG,
    awayAtk: awayGamesTotal > 0 ? awayAtkSum / awayGamesTotal : LEAGUE_AWAY_XG,
    awayDef: awayGamesTotal > 0 ? awayDefSum / awayGamesTotal : LEAGUE_HOME_XG,
    homeGames: homeGamesTotal,
    awayGames: awayGamesTotal,
  }
}

/**
 * Blend prior-season pseudo-observations into current-season stats.
 * If there are no current-season games (n=0), the prior fully determines the estimate.
 * As current data accumulates, its influence grows and the prior fades naturally.
 */
function augmentStat(
  current: { avg: number; n: number },
  priorAvg: number,
  priorN: number
): { avg: number; n: number } {
  if (priorN === 0) return current
  if (current.n === 0) return { avg: priorAvg, n: priorN }
  const totalN = current.n + priorN
  return {
    avg: (current.n * current.avg + priorN * priorAvg) / totalN,
    n: totalN,
  }
}

/**
 * Build a PriorContext from prior-season matches and the team-ID→name mapping.
 * Call this once before the per-match odds loop for efficiency.
 */
export function buildPriorContext(
  priorMatches: PriorMatch[],
  teamNames: Map<number, string>,
  leaguePlayers: LeaguePlayer[] = [],
  lineupEntries: LineupEntry[] = []
): PriorContext {
  const { homeAdvMap, awayAdvMap } = buildHomeAdvantageMap(priorMatches)

  const leaguePlayersMap = new Map<string, LeaguePlayer[]>()
  for (const p of leaguePlayers) {
    const arr = leaguePlayersMap.get(p.team_name) ?? []
    arr.push(p)
    leaguePlayersMap.set(p.team_name, arr)
  }

  const lineupsMap = new Map<string, LineupEntry[]>()
  for (const e of lineupEntries) {
    const arr = lineupsMap.get(e.team_name) ?? []
    arr.push(e)
    lineupsMap.set(e.team_name, arr)
  }

  return {
    priorMatches,
    teamNames,
    leagueAvgs: buildLeagueAvgs(priorMatches),
    homeAdvMap,
    awayAdvMap,
    leaguePlayers: leaguePlayersMap,
    lineups: lineupsMap,
  }
}

// ---------- xG estimation — geometric-mean attack/defense model with Bayesian shrinkage ----------

/**
 * Bayesian shrinkage toward league mean.
 * raw: observed average | leagueAvg: prior | n: observed games | k: prior strength
 */
function bayesianXG(raw: number, leagueAvg: number, n: number, k: number = XG_PRIOR): number {
  return (n * raw + k * leagueAvg) / (n + k)
}

/** Count of finished current-season matches for teamId (home or away). */
function getGamesPlayedThisSeason(matches: Match[], teamId: number): number {
  return matches.filter(
    (m) => m.status === 'finished' && (m.home_team_id === teamId || m.away_team_id === teamId)
  ).length
}

/**
 * Dynamic Bayesian prior strength: stronger during a team's first
 * EARLY_GAMES_THRESHOLD current-season games, ramping down to the base XG_PRIOR.
 */
function getKEffective(gamesPlayed: number): number {
  const rampFactor = Math.max(0, 1 - gamesPlayed / EARLY_GAMES_THRESHOLD)
  return XG_PRIOR + XG_PRIOR_EARLY_BONUS * rampFactor
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
 * Maps the form ratio [0, 1] linearly to [FORM_MULT_BASE, FORM_MULT_BASE+FORM_MULT_RANGE],
 * then ramps that result in linearly between FORM_RAMP_START and FORM_RAMP_FULL total
 * current-season games played — at exactly FORM_RAMP_START games the multiplier is
 * neutral (1.0), reaching full strength only once FORM_RAMP_FULL games exist. Below
 * FORM_RAMP_START games, neutral (1.0) — not enough evidence to react to at all.
 *
 * Season-long attack/defense averages alone don't reflect momentum. A top-of-table
 * team riding a streak (or a struggling team in a slump) shows up in form first,
 * before the season averages catch up. The multiplier injects that signal into
 * the team's own xG so real, current sporting differences come through clearly —
 * but the ramp prevents a 3-game sample from swinging odds at full strength.
 */
function getTeamFormMult(matches: Match[], teamId: number): number {
  const gamesPlayed = getGamesPlayedThisSeason(matches, teamId)
  if (gamesPlayed < FORM_RAMP_START) return 1.0
  const form = getForm(matches, teamId, FORM_GAMES)
  if (form.length < 3) return 1.0
  const pts = form.reduce((acc, r) => acc + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0)
  const fullMult = FORM_MULT_BASE + FORM_MULT_RANGE * (pts / (form.length * 3))
  const rampProgress = Math.min(1, (gamesPlayed - FORM_RAMP_START) / (FORM_RAMP_FULL - FORM_RAMP_START))
  return 1.0 + (fullMult - 1.0) * rampProgress
}

const TRANSFER_FACTOR_FLOOR = 0.65
const TRANSFER_FACTOR_CEILING = 1.15
const LOSS_DAMPING = 0.5   // departures are a certain loss — apply at half strength
const GAIN_DAMPING = 0.4   // signings are an uncertain gain — apply more conservatively
const INCOMING_CONFIDENCE = 0.65 // extra discount: new signings must still prove it at the new club
const MIN_GOALS_SAMPLE = 8

/**
 * Roster factor reflecting whether last season's key scorers are still around,
 * and whether known incoming signings add comparable quality back.
 *
 * Two tiers, depending on what evidence is available:
 * 1. Once enough CURRENT-season lineup data exists (≥3 matches), use it directly —
 *    a player who left (or is injured/benched) simply won't show up in recent
 *    lineups, so this naturally detects both departures and short-term absences.
 *    New signings are excluded here since their real current-season output is
 *    already captured by the normal season-average stats at that point.
 * 2. Before that (pre-season / first couple of matchdays), fall back to the known
 *    prior-season transfer/retirement/signing records: net last season's goals
 *    that departed against goals a known new signing brings in (normalized across
 *    leagues via the same LEAGUE_STRENGTH scale used for team-level prior stats,
 *    then damped for integration uncertainty), and dampen the result into a bounded
 *    multiplier. This lets a team's attack be adjusted from matchday 1 based on
 *    known transfer activity, without waiting for lineup evidence to accumulate.
 */
function getRosterFactor(teamName: string, priorCtx: PriorContext): number {
  const allPlayers = priorCtx.leaguePlayers.get(teamName) ?? []
  const returningPlayers = allPlayers.filter(p => p.status !== 'transferred_in')
  const incomingPlayers = allPlayers.filter(p => p.status === 'transferred_in')

  const totalKeyGoals = returningPlayers.reduce((s, p) => s + p.goals, 0)

  const recentLineups = priorCtx.lineups.get(teamName) ?? []
  const uniqueMatches = new Set(recentLineups.map(e => e.match_id))

  if (uniqueMatches.size >= 3) {
    if (totalKeyGoals === 0) return 1.0
    const last5MatchIds = [...uniqueMatches].slice(-5)
    const recentPlayers = new Set(
      recentLineups.filter(e => last5MatchIds.includes(e.match_id)).map(e => e.player_name)
    )
    const activeGoals = returningPlayers
      .filter(p => recentPlayers.has(p.name))
      .reduce((s, p) => s + p.goals, 0)
    const activeGoalShare = activeGoals / totalKeyGoals
    if (activeGoalShare < 0.5) return 0.90
    if (activeGoalShare < 0.7) return 0.95
    return 1.0
  }

  // Fallback: static prior-season transfer/retirement/signing records.
  if (totalKeyGoals < MIN_GOALS_SAMPLE) return 1.0

  const retainedGoals = returningPlayers
    .filter(p => !p.status || p.status === 'active')
    .reduce((s, p) => s + p.goals, 0)

  const incomingCreditedGoals = incomingPlayers.reduce((s, p) => {
    const level = p.prior_league_level as PriorMatch['league_level'] | null | undefined
    const strength = level ? LEAGUE_STRENGTH[level] : 1.0
    return s + p.goals * strength * INCOMING_CONFIDENCE
  }, 0)

  const ratio = (retainedGoals + incomingCreditedGoals) / totalKeyGoals
  const delta = ratio - 1
  const factor = 1 + delta * (delta < 0 ? LOSS_DAMPING : GAIN_DAMPING)
  return Math.max(TRANSFER_FACTOR_FLOOR, Math.min(TRANSFER_FACTOR_CEILING, factor))
}

export interface OddsDiagnostics {
  home: {
    gamesPlayed: number
    kEffective: number
    formMult: number
    rosterFactor: number
    rawXG: number
    finalXG: number
  }
  away: {
    gamesPlayed: number
    kEffective: number
    formMult: number
    rosterFactor: number
    rawXG: number
    finalXG: number
  }
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
 * Bayesian shrinkage is applied to the combined raw estimate, with a dynamic K that's
 * stronger during a team's first EARLY_GAMES_THRESHOLD current-season games (v2). A
 * ramped team-form multiplier (±10%, v2 — was ±20%) then modulates each team's own xG
 * to reflect recent momentum that the season-long averages haven't fully absorbed yet.
 *
 * Also returns `diagnostics` — the intermediate values behind the final xG, persisted
 * to `odds_diagnostics` by callers for admin explainability. Computing it is free
 * (everything here is already computed for the xG itself), so it's always returned;
 * callers simply choose whether to persist it.
 */
export function getMatchXG(
  matches: Match[],
  homeTeamId: number,
  awayTeamId: number,
  priorCtx?: PriorContext
): { homeXG: number; awayXG: number; diagnostics: OddsDiagnostics } {
  let homeAtk = homeGoalsScored(matches, homeTeamId)    // home team goals scored at home
  let awayDef = awayGoalsConceded(matches, awayTeamId)  // away team goals conceded away
  let awayAtk = awayGoalsScored(matches, awayTeamId)    // away team goals scored away
  let homeDef = homeGoalsConceded(matches, homeTeamId)  // home team goals conceded at home

  const homeName = priorCtx?.teamNames.get(homeTeamId)
  const awayName = priorCtx?.teamNames.get(awayTeamId)

  if (priorCtx) {
    if (homeName) {
      const ps = getPriorTeamStats(priorCtx.priorMatches, priorCtx.leagueAvgs, homeName)
      if (ps) {
        const pw = ps.homeGames * PRIOR_WEIGHT
        homeAtk = augmentStat(homeAtk, ps.homeAtk, pw)
        homeDef = augmentStat(homeDef, ps.homeDef, pw)
      }
    }
    if (awayName) {
      const ps = getPriorTeamStats(priorCtx.priorMatches, priorCtx.leagueAvgs, awayName)
      if (ps) {
        const pw = ps.awayGames * PRIOR_WEIGHT
        awayAtk = augmentStat(awayAtk, ps.awayAtk, pw)
        awayDef = augmentStat(awayDef, ps.awayDef, pw)
      }
    }
  }

  // homeAdvMap/awayAdvMap are NOT applied here: getPriorTeamStats already
  // normalises home/away rates independently per league. Applying the raw
  // scoring-rate factor on top would double-count team quality (a dominant
  // Kreisklasse team looks artificially strong vs a weak Bezirksliga team).
  const rawHomeXG = Math.sqrt(homeAtk.avg * awayDef.avg)
  const rawAwayXG = Math.sqrt(awayAtk.avg * homeDef.avg)
  const homeN = (homeAtk.n + awayDef.n) / 2
  const awayN = (awayAtk.n + homeDef.n) / 2

  const homeGamesPlayed = getGamesPlayedThisSeason(matches, homeTeamId)
  const awayGamesPlayed = getGamesPlayedThisSeason(matches, awayTeamId)
  const homeK = getKEffective(homeGamesPlayed)
  const awayK = getKEffective(awayGamesPlayed)

  const homeFormMult = getTeamFormMult(matches, homeTeamId)
  const awayFormMult = getTeamFormMult(matches, awayTeamId)

  const homeRosterFactor = homeName && priorCtx ? getRosterFactor(homeName, priorCtx) : 1.0
  const awayRosterFactor = awayName && priorCtx ? getRosterFactor(awayName, priorCtx) : 1.0

  const homeXG = Math.max(0.25, bayesianXG(rawHomeXG, LEAGUE_HOME_XG, homeN, homeK) * homeFormMult * homeRosterFactor)
  const awayXG = Math.max(0.25, bayesianXG(rawAwayXG, LEAGUE_AWAY_XG, awayN, awayK) * awayFormMult * awayRosterFactor)

  return {
    homeXG,
    awayXG,
    diagnostics: {
      home: {
        gamesPlayed: homeGamesPlayed,
        kEffective: homeK,
        formMult: homeFormMult,
        rosterFactor: homeRosterFactor,
        rawXG: rawHomeXG,
        finalXG: homeXG,
      },
      away: {
        gamesPlayed: awayGamesPlayed,
        kEffective: awayK,
        formMult: awayFormMult,
        rosterFactor: awayRosterFactor,
        rawXG: rawAwayXG,
        finalXG: awayXG,
      },
    },
  }
}

// ---------- Main calculation (all markets from one unified Poisson model) ----------

/**
 * Derives every market's odds from a given (homeXG, awayXG) pair via the shared
 * score matrix. Split out from calculateOdds() so callers who already have xG
 * (e.g. because they also need the getMatchXG diagnostics) don't compute it twice.
 */
export function oddsFromXG(homeXG: number, awayXG: number): OddsData {
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

export function calculateOdds(
  matches: Match[],
  homeTeamId: number,
  awayTeamId: number,
  priorCtx?: PriorContext
): OddsData {
  const { homeXG, awayXG } = getMatchXG(matches, homeTeamId, awayTeamId, priorCtx)
  return oddsFromXG(homeXG, awayXG)
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
  awayTeamId: number,
  priorCtx?: PriorContext
): { score: string; odds: number }[] {
  const { homeXG, awayXG } = getMatchXG(matches, homeTeamId, awayTeamId, priorCtx)

  const results: { score: string; odds: number; total: number; homeGoals: number }[] = []

  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
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
