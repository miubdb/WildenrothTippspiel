/**
 * Out-of-sample sanity preview: prices one upcoming Spieltag with the current
 * model and, optionally, with a second copy of lib/odds.ts (--old <path>) for
 * a side-by-side comparison.
 *
 * Deliberately NOT part of any calibration: these fixtures have no results
 * yet, so nothing here can be scored. It exists purely so a human can eyeball
 * whether the numbers are plausible before they are frozen. Model constants
 * are chosen in scripts/backtest.ts against finished matches only.
 *
 * Usage:
 *   node --experimental-strip-types scripts/run-matchday-preview.mjs 8 [--old /tmp/old-odds.ts]
 */
import type { Match } from '@/types'
import { getMatchXG, buildPriorContext, buildMatchScoreMatrix } from '@/lib/odds'
import { buildEffectiveMatchdayIndex, effectiveMatchdayOf } from '@/lib/season'
import { loadData } from './backtest'

const MAX_GOALS = 10

type XGFn = typeof getMatchXG
type CtxFn = typeof buildPriorContext
type MatrixFn = typeof buildMatchScoreMatrix

interface Markets {
  homeXG: number; awayXG: number
  home: number; draw: number; away: number
  bttsYes: number; over25: number
  /** P(team scores ≥ 1) = 1 - exp(-xG). Printed alongside BTTS because BTTS is
   *  exactly their product under this model — if a BTTS price looks wrong, one
   *  of these two is what actually needs explaining. */
  homeScores: number; awayScores: number
}

function markets(matrixFn: MatrixFn, homeXG: number, awayXG: number): Markets {
  const matrix = matrixFn(homeXG, awayXG, MAX_GOALS)
  let home = 0, draw = 0, away = 0, bttsYes = 0, over25 = 0
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = matrix[h][a]
      if (h > a) home += p; else if (h === a) draw += p; else away += p
      if (h > 0 && a > 0) bttsYes += p
      if (h + a > 2.5) over25 += p
    }
  }
  return {
    homeXG, awayXG, home, draw, away, bttsYes, over25,
    homeScores: 1 - Math.exp(-homeXG),
    awayScores: 1 - Math.exp(-awayXG),
  }
}

export interface ModelApi { getMatchXG: XGFn; buildPriorContext: CtxFn; buildMatchScoreMatrix: MatrixFn }

export const currentModel: ModelApi = { getMatchXG, buildPriorContext, buildMatchScoreMatrix }

export function priceMatchday(matchday: number, model: ModelApi) {
  const { matches, priorMatches, leaguePlayers, lineups, teamNames } = loadData()
  const mdIndex = buildEffectiveMatchdayIndex(matches)
  const targets = matches
    .filter((m) => effectiveMatchdayOf(m, mdIndex) === matchday)
    .sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime())

  // Same snapshot rule the freeze uses: only results known before the first
  // kickoff of this Spieltag may inform its odds.
  const cutoff = targets.length > 0 ? new Date(targets[0].match_date).getTime() : Date.now()
  const visible: Match[] = matches.map((m) => {
    const played = m.status === 'finished' && new Date(m.match_date).getTime() < cutoff
    return played ? m : ({ ...m, status: 'scheduled', home_score: null, away_score: null } as Match)
  })
  const known = new Set(visible.filter((m) => m.status === 'finished').map((m) => m.id))
  const priorCtx = model.buildPriorContext(priorMatches, teamNames, leaguePlayers, lineups.filter((l) => known.has(l.match_id)))

  return targets.map((m) => {
    const { homeXG, awayXG, diagnostics } = model.getMatchXG(visible, m.home_team_id, m.away_team_id, priorCtx)
    return {
      id: m.id,
      label: `${m.home_team?.name ?? '?'} – ${m.away_team?.name ?? '?'}`,
      category: m.match_category ?? 'kreisliga',
      diagnostics,
      markets: markets(model.buildMatchScoreMatrix, homeXG, awayXG),
    }
  })
}

export const pct = (p: number) => `${(p * 100).toFixed(1)}%`
export const dec = (p: number) => (p > 0 ? (1 / p).toFixed(2) : '—')
