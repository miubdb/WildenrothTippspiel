/**
 * Prüfungen für die DATENBANK-FREIE Vorschau (Fixtures, verschlüsselter Snapshot, Demo-Route). Läuft nur, solange die Demo existiert;
 * vor dem Merge nach main wird diese Datei samt Runner entfernt (scripts/prepare-production-strip.mjs).
 */
import { simulateSpieltag } from '@/lib/recap/simulation'
import { buildFixtureData } from '@/lib/recap/fixtures'
import { computeRangeReadiness } from '@/lib/recap/availability'
import { loadDemoState, isFixtureDemoEnabled, SnapshotKeyError } from '@/lib/recap/demo'
import { decryptSnapshot } from '@/lib/recap/snapshot'
import { SNAPSHOT_ENC } from '@/lib/recap/snapshot.enc'

let checks = 0, errors = 0
function test(label: string, actual: boolean) { checks++; if (!actual) errors++; console.log(`${actual ? 'OK' : 'FAIL'}  ${label}`) }

{
  const fx = buildFixtureData()
  test('Fixtures sind deterministisch und enthalten Pokalspiel, Pokal-Bonus-Tipps, annulliertes Spiel, gelöschtes Konto, offenen Spieltag 16', JSON.stringify(buildFixtureData().bets) === JSON.stringify(fx.bets) && fx.matches.some((m) => m.competition_type === 'cup') && fx.bets.some((b) => b.is_bonus) && fx.matches.some((m) => m.status === 'annulled') && fx.profiles.some((p) => p.deleted_at) && fx.bets.some((b) => b.status === 'pending'))
  const realFx = computeRangeReadiness(fx.matches, fx.bets, 1, 16)
  const simFx = simulateSpieltag(fx, 16)
  test('Fixtures: Spieltag 16 ist real NICHT bereit, nach Simulation bereit; Eingaben bleiben unverändert', !realFx.ready && computeRangeReadiness(simFx.matches, simFx.bets, 1, 16).ready && fx.bets.some((b) => b.status === 'pending'))
  test('Verschlüsselter Snapshot: ohne/mit falschem Schlüssel nicht lesbar; falscher Schlüssel → Fehler statt Musterdaten, kein Schlüssel → Musterdaten; kein Klartext im Chiffretext', decryptSnapshot(undefined) === null && decryptSnapshot('zz') === null && decryptSnapshot('ab'.repeat(32)) === null && (() => { try { loadDemoState('', 'ab'.repeat(32)); return false } catch (e) { return e instanceof SnapshotKeyError } })() && loadDemoState('', undefined).source === 'fixtures' && !JSON.stringify(SNAPSHOT_ENC).includes('display_name'))
  // Snapshot nie in Umgebungen mit Datenbank-Konfiguration (Production): selbst mit gültigem Schlüssel → null
  test('Snapshot-Sperre: mit Supabase-Konfiguration wird kein Snapshot entschlüsselt', (() => {
    const old = process.env.NEXT_PUBLIC_SUPABASE_URL
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.invalid'
    try { return decryptSnapshot('ab'.repeat(32)) === null } finally { if (old === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = old }
  })())
  const dm = loadDemoState('')
  test('Team-Highlights: 3 meistgewettete Teams mit Namen, Wildenroth I/II, Kombi-Killer-Spiel mit Vereinsnamen für Logos', dm.report.teams.mostBet.length === 3 && dm.report.teams.mostBet.every((t) => t.name && t.slips > 0) && dm.report.teams.wildenroth.length >= 1 && (dm.report.killers.killer == null || !!dm.report.matchTeams[dm.report.killers.killer.matchId]))
  test('Tipps tragen Heim/Gast für Vereinslogos; persönlicher Bereich liefert größten Gewinn, Beinahe-Treffer, Lieblings-Team', !!dm.report.bestTips.single?.legs[0]?.teams && (() => { const pp = loadDemoState(dm.meId).personal; return pp.biggestWin != null && pp.favoriteTeam != null })())
  const demo = loadDemoState('fx-u02')
  test('Demo-Bericht: Awards, IQ-Rangliste, gelöschtes Konto nicht genannt, persönlicher Tipp nur des gewählten Nutzers', demo.report.awards.some((a) => a.public) && demo.report.iq.some((x) => x.eligible) && !('fx-gone' in demo.report.people) && (!demo.personal.best || demo.personal.best.userId === 'fx-u02'))
  {
  const env = process.env as Record<string, string | undefined>
  const keys = ['RECAP_FIXTURE_DEMO', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
  const keep = Object.fromEntries(keys.map((k) => [k, env[k]]))
  const set = (k: string, v: string | undefined) => { if (v === undefined) delete env[k]; else env[k] = v }
  for (const k of keys) set(k, undefined)
  set('NEXT_PUBLIC_SUPABASE_URL', 'https://real.example'); set('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'k'); set('SUPABASE_SERVICE_ROLE_KEY', 'k')
  const prod = !isFixtureDemoEnabled()
  for (const k of keys) set(k, undefined)
  const isolated = isFixtureDemoEnabled()
  set('NEXT_PUBLIC_SUPABASE_URL', 'https://real.example')
  const partial = !isFixtureDemoEnabled()
  for (const k of keys) set(k, keep[k])
  test('Demo-Route: aus, sobald irgendeine Supabase-Konfiguration existiert (Production/Preview); an nur ohne jede Konfiguration', prod && isolated && partial)
}}

console.log(`\n${checks - errors}/${checks} checks passed`)
export function run(): number { return errors }
