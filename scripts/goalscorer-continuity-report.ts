/**
 * READ-ONLY Spieltag 8 → Spieltag 9 before/after report for the continuity
 * layer, and the shared loader the consistency checks use for the same data.
 *
 * Nothing here writes to the database, freezes a market, or touches a published
 * row. It re-prices the Spieltag-9 draft with the new logic purely to show what
 * the model WOULD now produce.
 *
 * Where the numbers come from (`$BACKTEST_DATA_DIR/gscontinuity.json`, exported
 * from Supabase):
 *
 *   previousRows   — the Spieltag-8 rows AS PUBLISHED (`frozen_at IS NOT NULL`),
 *                    i.e. including every price an admin retyped by hand.
 *   performanceGoals — `match_goalscorers` of that same fixture, own goals
 *                    excluded (Germering III's own goal in the 1:14 is not
 *                    credited to any Wildenroth player).
 *   currentRows    — the Spieltag-9 rows the CURRENT model produced. Their
 *                    `prob_score` is the fundamental model's own output, so the
 *                    fundamental share is recovered exactly as
 *                    −ln(1 − p) / Σ −ln(1 − p) = playerXG / teamMatchXG.
 *
 * That last point matters: the fundamental half of the blend is not recomputed
 * here from stale export files, it is read back from what the production model
 * actually computed for these two fixtures.
 *
 * Usage: node --experimental-strip-types scripts/run-goalscorer-continuity-report.mjs
 */
import { readFileSync } from 'node:fs'
import {
  continuityShares,
  priceFromPlayerXG,
  type GoalscorerContinuityInput,
} from '@/lib/goalscorer'

const DATA_DIR = process.env.BACKTEST_DATA_DIR ?? '/tmp/bt'

type PreviousRow = [number, string, number, boolean, boolean]
type CurrentRow = [number, string, number, number, boolean]
interface RawScenario {
  label: string
  previousMarketMatchId: number
  performanceMatchId: number
  currentMatchId: number
  previousTeamXG: number
  previousRows: PreviousRow[]
  performanceGoals: [number, number][]
  currentRows: CurrentRow[]
}

export interface ContinuityScenario {
  label: string
  currentMatchId: number
  currentTeamXG: number
  previousTeamXG: number
  playerIds: number[]
  names: Map<number, string>
  /** −ln(1 − prob_score) / teamXG of the Spieltag-9 rows. */
  fundamentalShares: number[]
  eligible: boolean[]
  /** What the current model offered for Spieltag 9 before this change. */
  oldOdds: Map<number, number>
  /** What was published for Spieltag 8. */
  previousOdds: Map<number, number>
  goals: Map<number, number>
  continuity: GoalscorerContinuityInput
}

/** True when the export file is present — the checks skip rather than fail
 *  without it, so the harness still runs on a fresh machine. */
export function hasContinuityScenarios(): boolean {
  try { readFileSync(`${DATA_DIR}/gscontinuity.json`); return true } catch { return false }
}

export function loadContinuityScenarios(): ContinuityScenario[] {
  const raw = JSON.parse(readFileSync(`${DATA_DIR}/gscontinuity.json`, 'utf8')) as RawScenario[]
  return raw.map((s) => {
    const playerIds = s.currentRows.map((r) => r[0])
    const names = new Map(s.currentRows.map((r) => [r[0], r[1]] as const))
    // prob_score → playerXG → share. A goalkeeper row is prob 0 → xG 0 and
    // is_offered false: not eligible, exactly as in the model itself.
    const xg = s.currentRows.map((r) => (r[2] > 0 && r[2] < 1 ? -Math.log(1 - r[2]) : 0))
    const teamXG = xg.reduce((a, b) => a + b, 0)
    const eligible = s.currentRows.map((r) => r[4])
    const previousOdds = new Map<number, number>()
    for (const [id, , odds, isOffered] of s.previousRows) {
      // Same rule the production loader applies: a row nobody could bet on is
      // not a published price.
      if (!isOffered) continue
      if (Number.isFinite(odds) && odds > 0) previousOdds.set(id, odds)
    }
    const goals = new Map<number, number>(s.performanceGoals)
    return {
      label: s.label,
      currentMatchId: s.currentMatchId,
      currentTeamXG: teamXG,
      previousTeamXG: s.previousTeamXG,
      playerIds,
      names,
      fundamentalShares: xg.map((v) => (teamXG > 0 ? v / teamXG : 0)),
      eligible,
      oldOdds: new Map(s.currentRows.map((r) => [r[0], r[3]] as const)),
      previousOdds,
      goals,
      continuity: {
        previousMarketMatchId: s.previousMarketMatchId,
        previousTeamXG: s.previousTeamXG,
        previousOddsScore: previousOdds,
        performanceMatchId: s.performanceMatchId,
        lastMatchGoals: goals,
        totalNamedGoalsLastMatch: s.performanceGoals.reduce((a, [, g]) => a + g, 0),
      },
    }
  })
}

export interface ContinuityRow {
  playerId: number
  name: string
  previousOdds: number | null
  goals: number
  oldOdds: number
  newOdds: number
  fundamentalShare: number
  previousShare: number | null
  performanceShare: number | null
  finalShare: number
  playerXG: number
  source: string
  eligible: boolean
}

/** Applies the REAL production functions — no re-implementation. */
export function repriceWithContinuity(s: ContinuityScenario): ContinuityRow[] {
  const breakdown = continuityShares(s.playerIds, s.fundamentalShares, s.eligible, s.continuity)
  return s.playerIds.map((id, i) => {
    const playerXG = s.currentTeamXG * breakdown[i].finalShare
    const priced = priceFromPlayerXG(playerXG)
    return {
      playerId: id,
      name: s.names.get(id) ?? String(id),
      previousOdds: breakdown[i].previousOddsScore,
      goals: breakdown[i].lastMatchGoals,
      oldOdds: s.oldOdds.get(id) ?? 0,
      newOdds: priced.oddsScore,
      fundamentalShare: breakdown[i].fundamentalShare,
      previousShare: breakdown[i].previousShare,
      performanceShare: breakdown[i].performanceShare,
      finalShare: breakdown[i].finalShare,
      playerXG,
      source: breakdown[i].continuitySource,
      eligible: s.eligible[i],
    }
  })
}

const FOCUS: Record<string, string[]> = {
  'Wildenroth I': ['Maximilian Scheidl', 'Xaver Throm', 'Lorenz Schorer', 'Timo Ritter',
    'Ender Dag', 'Tristan Umkehrer', 'Markus Zeise'],
  'Wildenroth II': ['Maximilian Bergmann', 'Michael Dischl', 'Andreas Kerscher',
    'Alexander Dotterweich', 'Szymon Portka', 'Nico Spindler', 'Maxim Burzlaff',
    'Ralf Looschen', 'Korbinian Scala', 'Marius Sauter'],
}

export function run(): number {
  const n = (v: number | null, d = 2) => (v == null ? '–' : v.toFixed(d))
  const pct = (v: number | null) => (v == null ? '–' : `${(v * 100).toFixed(2)}%`)

  console.log('\n=== Torschützen-Kontinuität: Spieltag 8 → Spieltag 9 ===')
  console.log('READ-ONLY. Es wird nichts in die Datenbank geschrieben und nichts eingefroren.')
  console.log('ST8-Quoten sind die TATSÄCHLICH VERÖFFENTLICHTEN Werte (inkl. manueller Admin-Korrekturen).\n')

  for (const s of loadContinuityScenarios()) {
    const rows = repriceWithContinuity(s)
    const byName = new Map(rows.map((r) => [r.name, r]))
    console.log('='.repeat(112))
    console.log(`${s.label}   ST8-Markt #${s.continuity.previousMarketMatchId} → ST9-Markt #${s.currentMatchId}`)
    console.log(`  Team-xG:  ST8 ${s.previousTeamXG.toFixed(4)}  →  ST9 ${s.currentTeamXG.toFixed(4)}` +
      `   (${((s.currentTeamXG / s.previousTeamXG - 1) * 100).toFixed(1)}%)`)
    console.log(`  Tore im Performance-Spiel #${s.continuity.performanceMatchId}: ` +
      `${s.continuity.totalNamedGoalsLastMatch} (benannte Wildenroth-Spieler, ohne Eigentore)\n`)
    const head = 'Spieler                     ST8 Quote  ST8 Tore   ST9 alt   ST9 neu    Δ     ' +
      'Anteil vorh.  Anteil Perf.  Anteil fund.  Anteil final'
    console.log('  ' + head)
    console.log('  ' + '-'.repeat(head.length))
    const focus = FOCUS[s.label] ?? []
    const ordered = [
      ...focus.map((f) => byName.get(f)).filter((r): r is ContinuityRow => r != null),
      ...rows.filter((r) => r.eligible && !focus.includes(r.name))
        .sort((a, b) => b.finalShare - a.finalShare),
    ]
    for (const r of ordered) {
      const marker = focus.includes(r.name) ? '*' : ' '
      const delta = r.oldOdds > 0 ? `${((r.newOdds / r.oldOdds - 1) * 100).toFixed(0)}%` : '–'
      console.log(`  ${marker}${r.name.padEnd(26).slice(0, 26)}` +
        `${n(r.previousOdds).padStart(9)}${String(r.goals).padStart(10)}` +
        `${n(r.oldOdds).padStart(10)}${n(r.newOdds).padStart(10)}${delta.padStart(7)}   ` +
        `${pct(r.previousShare).padStart(11)} ${pct(r.performanceShare).padStart(13)} ` +
        `${pct(r.fundamentalShare).padStart(13)} ${pct(r.finalShare).padStart(13)}`)
    }
    const sumXG = rows.reduce((a, r) => a + r.playerXG, 0)
    console.log(`\n  Σ playerXG = ${sumXG.toFixed(6)}  (Team-xG ${s.currentTeamXG.toFixed(6)}) ` +
      `— Differenz ${(sumXG - s.currentTeamXG).toExponential(2)}`)
    console.log(`  * = im Auftrag ausdrücklich genannte Spieler\n`)
  }
  return 0
}
