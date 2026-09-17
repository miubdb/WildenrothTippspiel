/**
 * Calibration analysis for BTTS and its two building blocks.
 *
 * BTTS is NOT a market of its own in this model — it falls out of the same
 * score matrix as everything else, and under independent Poisson
 * P(BTTS) = P(home ≥ 1) × P(away ≥ 1). So a BTTS miscalibration can only come
 * from one of two places:
 *   (a) the per-team scoring probabilities P(team ≥ 1) = 1 - exp(-xG), or
 *   (b) the independence assumption between the two teams' goal counts.
 * This script measures both separately instead of scoring BTTS as a black box,
 * because the fix for (a) lives in the xG estimate (and would move every other
 * market with it) while (b) would need a different joint distribution.
 *
 * Same walk-forward discipline as scripts/backtest.ts: true chronological order
 * by match_date, and for each fixture only results and lineups from matches
 * that had already finished before that kickoff.
 *
 * Usage: node --experimental-strip-types scripts/run-btts-analysis.mjs [--save out.json]
 */
import type { Match } from '@/types'
import { getMatchXG, buildPriorContext, buildMatchScoreMatrix } from '@/lib/odds'
import { loadData, tierOf, type LoadedData } from './backtest'

const MAX_GOALS = 10

const isLeagueMatch = (m: Match) =>
  m.matchday !== 999 && (m as unknown as { competition_type?: string }).competition_type !== 'cup'

/** Plain observed current-season record for a team, as of `cutoff`. Unweighted
 *  on purpose: this is the number a human reads off the table ("0 goals in 3
 *  games"), not the model's red-card-weighted internal count — the buckets are
 *  meant to be checkable by hand. */
function recordAt(matches: Match[], teamId: number, cutoff: number) {
  let games = 0, goalsFor = 0, goalsAgainst = 0
  let homeGames = 0, awayGames = 0, homeGoalsFor = 0, awayGoalsFor = 0
  for (const m of matches) {
    if (!isLeagueMatch(m) || m.status !== 'finished') continue
    if (new Date(m.match_date).getTime() >= cutoff) continue
    const isHome = m.home_team_id === teamId
    const isAway = m.away_team_id === teamId
    if (!isHome && !isAway) continue
    const gf = (isHome ? m.home_score : m.away_score) ?? 0
    const ga = (isHome ? m.away_score : m.home_score) ?? 0
    games++; goalsFor += gf; goalsAgainst += ga
    if (isHome) { homeGames++; homeGoalsFor += gf } else { awayGames++; awayGoalsFor += gf }
  }
  return { games, goalsFor, goalsAgainst, homeGames, awayGames, homeGoalsFor, awayGoalsFor }
}

/** One observation per TEAM per match — 2× the sample of the match-level view,
 *  which matters a lot at n=70. */
export interface SideObs {
  matchId: number
  date: string
  tier: string
  venue: 'home' | 'away'
  team: string
  opponent: string
  xG: number
  pScore: number          // model P(this team scores ≥ 1)
  scored: 0 | 1           // what actually happened
  goals: number
  /** Observed record BEFORE this kickoff — what the buckets are built on. */
  games: number
  gfPerGame: number | null
  /** Opponent's observed goals-against per game before this kickoff. */
  oppGaPerGame: number | null
}

export interface MatchObs {
  matchId: number
  date: string
  tier: string
  label: string
  homeXG: number
  awayXG: number
  pBttsMatrix: number     // straight off the score matrix
  pBttsProduct: number    // P(h≥1) × P(a≥1) — must equal the matrix value
  pHomeScore: number
  pAwayScore: number
  btts: 0 | 1
  homeScored: 0 | 1
  awayScored: 0 | 1
  totalGoals: number
  pOver25: number
  over25: 0 | 1
  /** Weaker side's observed goals/game before kickoff (null if either side has
   *  no games yet) — the "is there a very weak offence in this match" key. */
  minGfPerGame: number | null
  minGames: number
}

export function collect(data: LoadedData): { sides: SideObs[]; matches: MatchObs[] } {
  const { matches, priorMatches, leaguePlayers, lineups, teamNames } = data

  const evalMatches = matches
    .filter((m) => isLeagueMatch(m) && m.status === 'finished' && m.home_score != null && m.away_score != null)
    .sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime())

  const sides: SideObs[] = []
  const out: MatchObs[] = []

  for (const target of evalMatches) {
    const cutoff = new Date(target.match_date).getTime()

    const visible: Match[] = matches.map((m) => {
      const played = m.status === 'finished' && new Date(m.match_date).getTime() < cutoff
      return played ? m : ({ ...m, status: 'scheduled', home_score: null, away_score: null } as Match)
    })
    const known = new Set(visible.filter((m) => m.status === 'finished').map((m) => m.id))
    const priorCtx = buildPriorContext(priorMatches, teamNames, leaguePlayers, lineups.filter((l) => known.has(l.match_id)))
    const { homeXG, awayXG } = getMatchXG(visible, target.home_team_id, target.away_team_id, priorCtx)

    const matrix = buildMatchScoreMatrix(homeXG, awayXG, MAX_GOALS)
    let pBtts = 0, pOver25 = 0
    for (let h = 0; h <= MAX_GOALS; h++) {
      for (let a = 0; a <= MAX_GOALS; a++) {
        const p = matrix[h][a]
        if (h > 0 && a > 0) pBtts += p
        if (h + a > 2.5) pOver25 += p
      }
    }
    const pHomeScore = 1 - Math.exp(-homeXG)
    const pAwayScore = 1 - Math.exp(-awayXG)

    const hs = target.home_score as number
    const as_ = target.away_score as number
    const homeRec = recordAt(matches, target.home_team_id, cutoff)
    const awayRec = recordAt(matches, target.away_team_id, cutoff)
    const homeGf = homeRec.games > 0 ? homeRec.goalsFor / homeRec.games : null
    const awayGf = awayRec.games > 0 ? awayRec.goalsFor / awayRec.games : null

    const tier = tierOf(target)
    const homeName = target.home_team?.name ?? '?'
    const awayName = target.away_team?.name ?? '?'

    sides.push({
      matchId: target.id, date: target.match_date, tier, venue: 'home',
      team: homeName, opponent: awayName,
      xG: homeXG, pScore: pHomeScore, scored: hs > 0 ? 1 : 0, goals: hs,
      games: homeRec.games, gfPerGame: homeGf,
      oppGaPerGame: awayRec.games > 0 ? awayRec.goalsAgainst / awayRec.games : null,
    })
    sides.push({
      matchId: target.id, date: target.match_date, tier, venue: 'away',
      team: awayName, opponent: homeName,
      xG: awayXG, pScore: pAwayScore, scored: as_ > 0 ? 1 : 0, goals: as_,
      games: awayRec.games, gfPerGame: awayGf,
      oppGaPerGame: homeRec.games > 0 ? homeRec.goalsAgainst / homeRec.games : null,
    })

    out.push({
      matchId: target.id, date: target.match_date, tier,
      label: `${homeName} – ${awayName}`,
      homeXG, awayXG,
      pBttsMatrix: pBtts, pBttsProduct: pHomeScore * pAwayScore,
      pHomeScore, pAwayScore,
      btts: hs > 0 && as_ > 0 ? 1 : 0,
      homeScored: hs > 0 ? 1 : 0, awayScored: as_ > 0 ? 1 : 0,
      totalGoals: hs + as_,
      pOver25, over25: hs + as_ > 2.5 ? 1 : 0,
      minGfPerGame: homeGf != null && awayGf != null ? Math.min(homeGf, awayGf) : null,
      minGames: Math.min(homeRec.games, awayRec.games),
    })
  }

  return { sides, matches: out }
}

// ---------- scoring ----------

const EPS = 1e-12
const clampP = (p: number) => Math.min(1 - EPS, Math.max(EPS, p))

export interface CalStats {
  n: number
  pMean: number
  actual: number
  brier: number
  logLoss: number
  /** actual − predicted, in percentage points. Positive = model UNDERestimates. */
  biasPp: number
  /** Standard error of `actual` under a binomial assumption, in percentage
   *  points — without it a 15-point gap at n=6 reads like a finding. */
  sePp: number
  /** bias / se. |z| < 2 is noise at this sample size. */
  z: number
}

export function calibrate(rows: { p: number; y: number }[]): CalStats {
  const n = rows.length
  if (n === 0) return { n: 0, pMean: NaN, actual: NaN, brier: NaN, logLoss: NaN, biasPp: NaN, sePp: NaN, z: NaN }
  const pMean = rows.reduce((s, r) => s + r.p, 0) / n
  const actual = rows.reduce((s, r) => s + r.y, 0) / n
  const brier = rows.reduce((s, r) => s + (r.p - r.y) ** 2, 0) / n
  const logLoss = rows.reduce((s, r) => s - (r.y ? Math.log(clampP(r.p)) : Math.log(clampP(1 - r.p))), 0) / n
  // SE of the observed rate, using the MODEL's probabilities (Poisson-binomial
  // variance) rather than the observed rate — avoids a degenerate 0 when every
  // observation in a small bucket happened to go the same way.
  const varSum = rows.reduce((s, r) => s + r.p * (1 - r.p), 0)
  const se = Math.sqrt(varSum) / n
  const bias = actual - pMean
  return {
    n, pMean, actual, brier, logLoss,
    biasPp: bias * 100, sePp: se * 100,
    z: se > 0 ? bias / se : 0,
  }
}

export function fmtCal(label: string, c: CalStats): string {
  if (c.n === 0) return `${label.padEnd(30)} n=0`
  return [
    label.padEnd(30),
    `n=${String(c.n).padStart(3)}`,
    `Modell ${(c.pMean * 100).toFixed(1).padStart(5)}%`,
    `real ${(c.actual * 100).toFixed(1).padStart(5)}%`,
    `Δ ${(c.biasPp >= 0 ? '+' : '') + c.biasPp.toFixed(1)}`.padEnd(8),
    `±${c.sePp.toFixed(1)} Pp`.padEnd(9),
    `z=${(c.z >= 0 ? '+' : '') + c.z.toFixed(2)}`.padEnd(8),
    `Brier ${c.brier.toFixed(4)}`,
    `LogLoss ${c.logLoss.toFixed(4)}`,
  ].join('  ')
}
