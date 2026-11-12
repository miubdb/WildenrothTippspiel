import { buildFixtureData, FIXTURE_PLAYERS } from '@/lib/recap/fixtures'
import { decryptSnapshot } from '@/lib/recap/snapshot'
import { simulateSpieltag } from '@/lib/recap/simulation'
import { buildSlips, type Slip } from '@/lib/recap/slips'
import { buildRecapReport, type RecapReport } from '@/lib/recap/report'
import { buildPersonalTips, type PersonalTips } from '@/lib/recap/bestTips'
import { filterSlipsByMatchdays } from '@/lib/recap/tipperIq'
import { computeRangeReadiness } from '@/lib/recap/availability'
import { CUP_MARKET_LABEL, plainSelectionLabel } from '@/lib/betDisplay'

/**
 * Isolierte Recap-Demo OHNE Datenbank (nur wenn `RECAP_FIXTURE_DEMO=1` gesetzt ist oder gar keine Supabase-Konfiguration
 * existiert – also nur im separaten Test-Deployment; in Production bleibt die Route unsichtbar, 404). Nutzt dieselben Funktionen wie das
 * echte Recap (buildSlips → buildRecapReport → HinrundeView) auf synthetischen Fixtures; Spieltag 16 wird mit
 * `simulateSpieltag` im Speicher „abgeschlossen".
 */
export const isFixtureDemoEnabled = (): boolean =>
  process.env.RECAP_FIXTURE_DEMO === '1'
  // Oder: ein Deployment OHNE jede Supabase-Konfiguration kann technisch keine echte Datenbank erreichen – das ist das
  // separate Test-Deployment. Jede echte Umgebung (Production, Preview des Hauptprojekts) hat die Supabase-Variablen.
  || (!process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY)

const MARKET_LABELS: Record<string, string> = {
  '1x2': 'Spielausgang', double_chance: 'Doppelte Chance', handicap: 'Handicap', btts: 'Beide treffen', exact_score: 'Ergebnis',
  over_under_3_5: 'Über/Unter 3,5', goalscorer: 'Torschütze', ...CUP_MARKET_LABEL,
}

type Memo = { report: RecapReport; slips: Slip[]; realReady: boolean; simReady: boolean; simulated: { matches: number; betRows: number }; profiles: { id: string; name: string }[]; labeler: Parameters<typeof buildPersonalTips>[3]; source: 'fixtures' | 'snapshot'; builtAt: string | null }
const memos = new Map<string, Memo>()

function load(keyHex?: string): Memo {
  const snap = decryptSnapshot(keyHex)
  const mk = snap ? 'snap:' + snap.builtAt : 'fx'
  const hit = memos.get(mk)
  if (hit) return hit
  const fx = snap
    ? { matches: snap.matches, bets: snap.bets, combos: snap.combos, profiles: snap.profiles.map((p) => ({ ...p, is_admin: null })), teams: new Map(snap.teams.map((t) => [t.id, t.name] as [number, string])), players: Object.fromEntries(snap.players.map((p) => [p.id, p.name])) as Record<number, string> }
    : buildFixtureData()
  const realReady = computeRangeReadiness(fx.matches, fx.bets, 1, 16).ready
  const sim = simulateSpieltag(fx, 16)
  const simReady = computeRangeReadiness(sim.matches, sim.bets, 1, 16).ready
  const { slips } = buildSlips({ bets: sim.bets, combos: sim.combos, matches: sim.matches })
  const byId = new Map(sim.matches.map((m) => [m.id, m]))
  const labeler = {
    matchLabel: (id: number) => { const m = byId.get(id); return m ? `${fx.teams.get(m.home_team_id) ?? '?'} – ${fx.teams.get(m.away_team_id) ?? '?'}${m.competition_type === 'cup' ? ' (Pokal)' : ''}` : `Spiel #${id}` },
    marketLabel: (m: string) => MARKET_LABELS[m] ?? m,
    selectionLabel: (market: string, sel: string) => plainSelectionLabel(market, sel, undefined, snap ? fx.players : FIXTURE_PLAYERS),
  }
  const report = buildRecapReport({ allSlips: slips, matches: sim.matches, range: { from: 1, to: 16 }, profiles: fx.profiles, labeler })
  const memo: Memo = { report, slips, realReady, simReady, simulated: { matches: sim.simulatedMatchIds.length, betRows: sim.simulatedBetRows }, profiles: fx.profiles.filter((p) => !p.deleted_at).map((p) => ({ id: p.id, name: p.display_name ?? p.username ?? '?' })), labeler, source: snap ? 'snapshot' : 'fixtures', builtAt: snap?.builtAt ?? null }
  memos.set(mk, memo)
  return memo
}

export function loadDemoState(meId: string, keyHex?: string): { report: RecapReport; personal: PersonalTips; meId: string; realReady: boolean; simReady: boolean; simulated: { matches: number; betRows: number }; profiles: { id: string; name: string }[]; slips: Slip[]; source: 'fixtures' | 'snapshot'; builtAt: string | null } {
  const m = load(keyHex)
  const me = m.profiles.some((p) => p.id === meId) ? meId : m.profiles[0].id
  return { report: m.report, personal: buildPersonalTips(m.slips, filterSlipsByMatchdays(m.slips, 1, 16), me, m.labeler), meId: me, realReady: m.realReady, simReady: m.simReady, simulated: m.simulated, profiles: m.profiles, slips: m.slips, source: m.source, builtAt: m.builtAt }
}
