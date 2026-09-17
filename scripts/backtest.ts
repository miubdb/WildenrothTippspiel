/**
 * Walk-forward backtest for the odds model.
 *
 * Runs against the REAL production model (imports lib/odds.ts through
 * scripts/ts-resolver.mjs) rather than re-implementing it — the old
 * scripts/check-odds.js had copied constants and model logic that silently
 * drifted out of sync with lib/odds.ts, which is exactly what this replaces.
 *
 * No future leakage: matches are replayed in true chronological order by
 * match_date (not matchday — Nachholspiele are played out of numeric order,
 * see CLAUDE.md), and for each fixture the model only ever sees results and
 * lineups from matches that had already finished BEFORE that kickoff. Prior
 * season data is always available. Cup fixtures never feed league strength.
 *
 * Scores probabilities BEFORE the house margin, straight off the shared score
 * matrix, so the comparison measures the model and not the pricing layer.
 *
 * Usage:
 *   node --experimental-strip-types scripts/run-backtest.mjs [--save out.json] [--compare base.json]
 */
import { readFileSync } from 'node:fs'
import type { Match, PriorMatch, LeaguePlayer, LineupEntry } from '@/types'
import { getMatchXG, buildPriorContext, buildMatchScoreMatrix } from '@/lib/odds'

const DATA_DIR = process.env.BACKTEST_DATA_DIR ?? '/tmp/bt'
const MAX_GOALS = 10

// ---------- data loading ----------

type Row = unknown[]
const load = (f: string): Row[] => JSON.parse(readFileSync(`${DATA_DIR}/${f}`, 'utf8'))

export interface LoadedData {
  matches: Match[]
  priorMatches: PriorMatch[]
  leaguePlayers: LeaguePlayer[]
  lineups: LineupEntry[]
  teamNames: Map<number, string>
}

export function loadData(): LoadedData {
  const teamNames = new Map<number, string>()
  const matches = load('matches.json').map((r) => {
    const [id, matchday, match_date, home_team_id, away_team_id, home_score, away_score,
      status, match_category, is_topspiel, tippspiel_matchday, competition_type, hName, aName] = r as [
      number, number, string, number, number, number | null, number | null,
      string, string | null, boolean, number | null, string | null, string | null, string | null]
    if (home_team_id && hName) teamNames.set(home_team_id, hName)
    if (away_team_id && aName) teamNames.set(away_team_id, aName)
    return {
      id, matchday, match_date, home_team_id, away_team_id, home_score, away_score,
      status, match_category, is_topspiel, tippspiel_matchday, competition_type,
      home_team: hName ? { name: hName } : null,
      away_team: aName ? { name: aName } : null,
    } as unknown as Match
  })

  const priorMatches = load('prior.json').map((r) => {
    const [league_name, league_level, league_number, home_team, away_team, home_score, away_score] =
      r as [string, string, string | null, string, string, number, number]
    return { league_name, league_level, league_number, home_team, away_team, home_score, away_score } as unknown as PriorMatch
  })

  const leaguePlayers = load('players.json').map((r) => {
    const [id, team_name, name, goals, playedMatches, minutes, status, transfer_to, prior_league_level, prior_team_name] =
      r as [number, string, string, number, number, number, string | null, string | null, string | null, string | null]
    return { id, team_name, name, goals, games: playedMatches, minutes, status, transfer_to, prior_league_level, prior_team_name } as unknown as LeaguePlayer
  })

  const lineups = load('lineups.json').map((r) => {
    const [id, match_id, team_name, player_name, minutes_played, goals, assists, red_card_minute, created_at] =
      r as [number, number, string, string, number | null, number | null, number | null, number | null, string]
    return { id, match_id, team_name, player_name, minutes_played, goals, assists, red_card_minute, created_at } as unknown as LineupEntry
  })

  return { matches, priorMatches, leaguePlayers, lineups, teamNames }
}

// ---------- evaluation helpers ----------

/** B-Klasse vs Kreisliga — reported separately because the model anchors and
 *  the amount of available history differ sharply between them. */
export function tierOf(m: Match): 'kreisliga' | 'b_klasse' {
  return !m.match_category || m.match_category === 'kreisliga' ? 'kreisliga' : 'b_klasse'
}

const isLeagueMatch = (m: Match) =>
  m.matchday !== 999 && (m as unknown as { competition_type?: string }).competition_type !== 'cup'

interface Probs {
  home: number; draw: number; away: number
  bttsYes: number; over25: number
  exact: number       // probability mass on the actual scoreline
  expHome: number; expAway: number
  matrixSum: number
}

function probsFromXG(homeXG: number, awayXG: number, hs: number, as_: number): Probs {
  const matrix = buildMatchScoreMatrix(homeXG, awayXG, MAX_GOALS)
  let home = 0, draw = 0, away = 0, bttsYes = 0, over25 = 0, sum = 0
  let expHome = 0, expAway = 0
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = matrix[h][a]
      sum += p
      expHome += h * p
      expAway += a * p
      if (h > a) home += p; else if (h === a) draw += p; else away += p
      if (h > 0 && a > 0) bttsYes += p
      if (h + a > 2.5) over25 += p
    }
  }
  const exact = (hs <= MAX_GOALS && as_ <= MAX_GOALS) ? matrix[hs][as_] : 0
  return { home, draw, away, bttsYes, over25, exact, expHome, expAway, matrixSum: sum }
}

const EPS = 1e-12
const clampP = (p: number) => Math.min(1 - EPS, Math.max(EPS, p))

export interface Bucket {
  n: number
  logLoss1x2: number; brier1x2: number
  logLossBtts: number; brierBtts: number
  logLossO25: number; brierO25: number
  nllScore: number
  maeGoals: number
  homeProbSum: number; homeActual: number
  drawProbSum: number; drawActual: number
  matrixSumMin: number; matrixSumMax: number
  minOdds: number
}

const newBucket = (): Bucket => ({
  n: 0, logLoss1x2: 0, brier1x2: 0, logLossBtts: 0, brierBtts: 0,
  logLossO25: 0, brierO25: 0, nllScore: 0, maeGoals: 0,
  homeProbSum: 0, homeActual: 0, drawProbSum: 0, drawActual: 0,
  matrixSumMin: 1, matrixSumMax: 1, minOdds: Infinity,
})

function addToBucket(b: Bucket, p: Probs, hs: number, as_: number) {
  const outHome = hs > as_ ? 1 : 0
  const outDraw = hs === as_ ? 1 : 0
  const outAway = hs < as_ ? 1 : 0
  const btts = hs > 0 && as_ > 0 ? 1 : 0
  const o25 = hs + as_ > 2.5 ? 1 : 0

  b.n++
  b.logLoss1x2 += -Math.log(clampP(outHome ? p.home : outDraw ? p.draw : p.away))
  b.brier1x2 += (p.home - outHome) ** 2 + (p.draw - outDraw) ** 2 + (p.away - outAway) ** 2
  b.logLossBtts += -(btts ? Math.log(clampP(p.bttsYes)) : Math.log(clampP(1 - p.bttsYes)))
  b.brierBtts += (p.bttsYes - btts) ** 2
  b.logLossO25 += -(o25 ? Math.log(clampP(p.over25)) : Math.log(clampP(1 - p.over25)))
  b.brierO25 += (p.over25 - o25) ** 2
  b.nllScore += -Math.log(clampP(p.exact))
  b.maeGoals += Math.abs(p.expHome - hs) + Math.abs(p.expAway - as_)
  b.homeProbSum += p.home; b.homeActual += outHome
  b.drawProbSum += p.draw; b.drawActual += outDraw
  b.matrixSumMin = Math.min(b.matrixSumMin, p.matrixSum)
  b.matrixSumMax = Math.max(b.matrixSumMax, p.matrixSum)
}

export interface PerMatchResult {
  matchId: number; date: string; tier: string; label: string
  homeXG: number; awayXG: number
  homeGames: number; awayGames: number
  hs: number; as_: number
  probs: Probs
}

// ---------- walk-forward ----------

export function runBacktest(data: LoadedData) {
  const { matches, priorMatches, leaguePlayers, lineups, teamNames } = data

  const evalMatches = matches
    .filter((m) => isLeagueMatch(m) && m.status === 'finished' && m.home_score != null && m.away_score != null)
    .sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime())

  const overall = newBucket()
  const byTier: Record<string, Bucket> = { kreisliga: newBucket(), b_klasse: newBucket() }
  const byExperience: Record<string, Bucket> = { '0-3': newBucket(), '4-7': newBucket(), '8+': newBucket() }
  const perMatch: PerMatchResult[] = []

  for (const target of evalMatches) {
    const cutoff = new Date(target.match_date).getTime()

    // Only what was knowable before this kickoff. Later matches stay in the
    // array (team ids/names are needed) but are masked to "not yet played",
    // which is exactly how getMatchXG treats an unfinished fixture.
    const visible: Match[] = matches.map((m) => {
      const played = m.status === 'finished' && new Date(m.match_date).getTime() < cutoff
      if (played) return m
      return { ...m, status: 'scheduled', home_score: null, away_score: null } as Match
    })
    const knownMatchIds = new Set(visible.filter((m) => m.status === 'finished').map((m) => m.id))
    const visibleLineups = lineups.filter((l) => knownMatchIds.has(l.match_id))

    const priorCtx = buildPriorContext(priorMatches, teamNames, leaguePlayers, visibleLineups)
    const { homeXG, awayXG, diagnostics } = getMatchXG(visible, target.home_team_id, target.away_team_id, priorCtx)

    const hs = target.home_score as number
    const as_ = target.away_score as number
    const p = probsFromXG(homeXG, awayXG, hs, as_)

    const tier = tierOf(target)
    const games = Math.min(diagnostics.home.gamesPlayed, diagnostics.away.gamesPlayed)
    const expKey = games <= 3 ? '0-3' : games <= 7 ? '4-7' : '8+'

    addToBucket(overall, p, hs, as_)
    addToBucket(byTier[tier], p, hs, as_)
    addToBucket(byExperience[expKey], p, hs, as_)

    perMatch.push({
      matchId: target.id, date: target.match_date, tier,
      label: `${target.home_team?.name ?? '?'} – ${target.away_team?.name ?? '?'}`,
      homeXG, awayXG,
      homeGames: diagnostics.home.gamesPlayed, awayGames: diagnostics.away.gamesPlayed,
      hs, as_, probs: p,
    })
  }

  return { overall, byTier, byExperience, perMatch }
}

// ---------- reporting ----------

export function fmtBucket(name: string, b: Bucket): string {
  if (b.n === 0) return `${name.padEnd(14)} n=0`
  const per = (v: number) => (v / b.n).toFixed(4)
  return [
    name.padEnd(14),
    `n=${String(b.n).padStart(3)}`,
    `1X2 LL ${per(b.logLoss1x2)}`,
    `Brier ${per(b.brier1x2)}`,
    `BTTS LL ${per(b.logLossBtts)}`,
    `${per(b.brierBtts)}`,
    `O2.5 LL ${per(b.logLossO25)}`,
    `${per(b.brierO25)}`,
    `ScoreNLL ${per(b.nllScore)}`,
    `MAE ${per(b.maeGoals)}`,
    `Heim p̄ ${(b.homeProbSum / b.n).toFixed(3)} vs ${(b.homeActual / b.n).toFixed(3)}`,
    `X p̄ ${(b.drawProbSum / b.n).toFixed(3)} vs ${(b.drawActual / b.n).toFixed(3)}`,
  ].join('  ')
}
