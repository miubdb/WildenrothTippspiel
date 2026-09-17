/**
 * Old-vs-new goalscorer preview for a Wildenroth fixture.
 *
 * Prices the upcoming Spieltag with the current model and, with `--old <path>`,
 * with a second copy of lib/goalscorer.ts (e.g. `git show HEAD:lib/goalscorer.ts`)
 * for a side-by-side comparison. Writes nothing and freezes nothing.
 *
 * Deliberately NOT a calibration tool: these fixtures have no result yet.
 *
 * Usage: node --experimental-strip-types scripts/run-goalscorer-preview.mjs [8] [--old /tmp/old-goalscorer.ts]
 */
import type { Match } from '@/types'
import { getMatchXG, buildPriorContext } from '@/lib/odds'
import { buildEffectiveMatchdayIndex, effectiveMatchdayOf } from '@/lib/season'
import { computeGoalscorerOffers, type WildenrothPlayer, type GoalscorerSquadResult } from '@/lib/goalscorer'
import { hasConcurrentOtherSquadFixture } from '@/lib/goalscorerContext'
import { loadData } from './backtest'
import { loadWildenrothPlayers } from './goalscorer-check'

export interface SideView {
  label: string
  fixture: string
  category: string
  tier: string
  baselineTeamXG: number
  teamMatchXG: number
  bothSquadConflict: boolean
  result: GoalscorerSquadResult
  players: Map<number, WildenrothPlayer>
}

/** The OLD model's shape, so an old copy of lib/goalscorer.ts can be called. */
export interface LegacyModule {
  computeGoalscorerOffers?: unknown
  computePlayerOdds: (p: WildenrothPlayer, teamXG: number, baseline?: number) => {
    player_id: number; prob_score: number; odds_score: number
    prob_score_2plus: number; odds_score_2plus: number; is_offered: boolean; is_offered_2plus: boolean
  }
}

export function buildViews(matchday: number): SideView[] {
  const data = loadData()
  const players = loadWildenrothPlayers()
  const priorCtx = buildPriorContext(data.priorMatches, data.teamNames, data.leaguePlayers, data.lineups)
  const modelMatches = data.matches.filter(
    (m) => (m as unknown as { competition_type?: string }).competition_type !== 'cup'
  ) as Match[]
  const idByName = (n: string) => [...data.teamNames.entries()].find(([, v]) => v === n)?.[0] ?? null
  const W1 = idByName('SpVgg Wildenroth')
  const W2 = idByName('SpVgg Wildenroth II')
  const idx = buildEffectiveMatchdayIndex(data.matches)
  const md = data.matches.filter((m) => effectiveMatchdayOf(m, idx) === matchday)

  const views: SideView[] = []
  for (const [label, wId, side] of [
    ['SpVgg Wildenroth', W1, '1'],
    ['SpVgg Wildenroth II', W2, '2'],
  ] as const) {
    if (wId == null) continue
    const m = md.find((x) => x.home_team_id === wId || x.away_team_id === wId)
    if (!m) continue
    const squad = players.filter((p) => p.active && (p.squad === side || p.squad === 'both'))
    const { homeXG, awayXG, diagnostics } = getMatchXG(modelMatches, m.home_team_id, m.away_team_id, priorCtx)
    const teamMatchXG = m.home_team_id === wId ? homeXG : awayXG
    const bothSquadConflict = hasConcurrentOtherSquadFixture(modelMatches, m.match_date, wId, [W1, W2])
    views.push({
      label,
      fixture: `${data.teamNames.get(m.home_team_id)} – ${data.teamNames.get(m.away_team_id)}`,
      category: m.match_category ?? 'kreisliga',
      tier: diagnostics.tier,
      baselineTeamXG: (diagnostics.baselineHome + diagnostics.baselineAway) / 2,
      teamMatchXG,
      bothSquadConflict,
      result: computeGoalscorerOffers(squad, teamMatchXG, { bothSquadConflict }),
      players: new Map(squad.map((p) => [p.id, p])),
    })
  }
  return views
}

/** Re-price one side with an older copy of the model, for the comparison column. */
export function legacyFor(view: SideView, legacy: LegacyModule) {
  const out = new Map<number, { playerXG: number; odds: number; offered: boolean; odds2: number }>()
  for (const p of view.players.values()) {
    const o = legacy.computePlayerOdds(p, view.teamMatchXG, view.baselineTeamXG)
    out.set(p.id, {
      playerXG: o.prob_score > 0 && o.prob_score < 1 ? -Math.log(1 - o.prob_score) : 0,
      odds: o.odds_score,
      odds2: o.odds_score_2plus,
      offered: o.is_offered,
    })
  }
  return out
}
