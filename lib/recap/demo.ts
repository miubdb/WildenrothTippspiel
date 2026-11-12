import { buildFixtureData, FIXTURE_PLAYERS } from '@/lib/recap/fixtures'
import { simulateSpieltag } from '@/lib/recap/simulation'
import { buildSlips, type Slip } from '@/lib/recap/slips'
import { buildRecapReport, type RecapReport } from '@/lib/recap/report'
import { buildPersonalTips, type PersonalTips } from '@/lib/recap/bestTips'
import { filterSlipsByMatchdays } from '@/lib/recap/tipperIq'
import { computeRangeReadiness } from '@/lib/recap/availability'
import { CUP_MARKET_LABEL, plainSelectionLabel } from '@/lib/betDisplay'

/**
 * Isolierte Recap-Demo OHNE Datenbank (nur wenn `RECAP_FIXTURE_DEMO=1` gesetzt ist – das ist nur im separaten
 * Vercel-Testprojekt der Fall; in Production bleibt die Route unsichtbar, 404). Nutzt dieselben Funktionen wie das
 * echte Recap (buildSlips → buildRecapReport → HinrundeView) auf synthetischen Fixtures; Spieltag 16 wird mit
 * `simulateSpieltag` im Speicher „abgeschlossen".
 */
export const isFixtureDemoEnabled = (): boolean => process.env.RECAP_FIXTURE_DEMO === '1'

const MARKET_LABELS: Record<string, string> = {
  '1x2': 'Spielausgang', double_chance: 'Doppelte Chance', handicap: 'Handicap', btts: 'Beide treffen', exact_score: 'Ergebnis',
  over_under_3_5: 'Über/Unter 3,5', goalscorer: 'Torschütze', ...CUP_MARKET_LABEL,
}

let memo: { report: RecapReport; slips: Slip[]; realReady: boolean; simReady: boolean; simulated: { matches: number; betRows: number }; profiles: { id: string; name: string }[]; labeler: Parameters<typeof buildPersonalTips>[3] } | null = null

function load() {
  if (memo) return memo
  const fx = buildFixtureData()
  const realReady = computeRangeReadiness(fx.matches, fx.bets, 1, 16).ready
  const sim = simulateSpieltag(fx, 16)
  const simReady = computeRangeReadiness(sim.matches, sim.bets, 1, 16).ready
  const { slips } = buildSlips({ bets: sim.bets, combos: sim.combos, matches: sim.matches })
  const byId = new Map(sim.matches.map((m) => [m.id, m]))
  const labeler = {
    matchLabel: (id: number) => { const m = byId.get(id); return m ? `${fx.teams.get(m.home_team_id) ?? '?'} – ${fx.teams.get(m.away_team_id) ?? '?'}${m.competition_type === 'cup' ? ' (Pokal)' : ''}` : `Spiel #${id}` },
    marketLabel: (m: string) => MARKET_LABELS[m] ?? m,
    selectionLabel: (market: string, sel: string) => plainSelectionLabel(market, sel, undefined, FIXTURE_PLAYERS),
  }
  const report = buildRecapReport({ allSlips: slips, matches: sim.matches, range: { from: 1, to: 16 }, profiles: fx.profiles, labeler })
  memo = { report, slips, realReady, simReady, simulated: { matches: sim.simulatedMatchIds.length, betRows: sim.simulatedBetRows }, profiles: fx.profiles.filter((p) => !p.deleted_at).map((p) => ({ id: p.id, name: p.display_name ?? p.username ?? '?' })), labeler }
  return memo
}

export function loadDemoState(meId: string): { report: RecapReport; personal: PersonalTips; meId: string; realReady: boolean; simReady: boolean; simulated: { matches: number; betRows: number }; profiles: { id: string; name: string }[]; slips: Slip[] } {
  const m = load()
  const me = m.profiles.some((p) => p.id === meId) ? meId : m.profiles[0].id
  return { report: m.report, personal: buildPersonalTips(m.slips, filterSlipsByMatchdays(m.slips, 1, 16), me, m.labeler), meId: me, realReady: m.realReady, simReady: m.simReady, simulated: m.simulated, profiles: m.profiles, slips: m.slips }
}
