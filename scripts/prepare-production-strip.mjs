/**
 * Entfernt Snapshot und Demo aus dem auszuliefernden Code (vor dem Merge nach main). Standard = Trockenlauf.
 *   node scripts/prepare-production-strip.mjs           → zeigt nur, was passieren würde
 *   node scripts/prepare-production-strip.mjs --apply   → führt es aus und prüft anschließend mit check-no-demo-artifacts.mjs
 * Die produktive Recap-Funktionalität (lib/recap/*, Seiten /recap/*, Admin-Freigabe, Winter-Pokale, Simulation nur für Preview-Admins)
 * bleibt vollständig erhalten. Es werden NUR Demo-/Snapshot-Dateien, der Demo-Proxy-Bypass und der Demo-CI-Schritt entfernt.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const apply = process.argv.includes('--apply')
const ROOT = process.cwd()
const REMOVE = ['app/recap-demo', 'lib/recap/demo.ts', 'lib/recap/fixtures.ts', 'lib/recap/snapshot.ts', 'lib/recap/snapshot.enc.ts', 'lib/recap/demoKey.ts', 'scripts/build-recap-snapshot.mjs', 'scripts/recap-demo-check.ts', 'scripts/run-recap-demo-check.mjs']
const log = (m) => console.log((apply ? '' : '[Trockenlauf] ') + m)

for (const p of REMOVE) {
  const f = path.join(ROOT, p)
  if (!fs.existsSync(f)) { log(`schon weg: ${p}`); continue }
  log(`entferne ${p}`)
  if (apply) fs.rmSync(f, { recursive: true, force: true })
}

// proxy.ts: Demo-Bypass (Kommentar + Zeile) entfernen
const proxy = path.join(ROOT, 'proxy.ts')
let ptxt = fs.readFileSync(proxy, 'utf8')
const lines = ptxt.split('\n')
const i = lines.findIndex((l) => l.includes('recap-demo|crests'))
if (i >= 0) {
  let start = i
  while (start > 0 && lines[start - 1].trim().startsWith('//')) start--
  log(`proxy.ts: entferne Demo-Bypass (Zeilen ${start + 1}–${i + 1})`)
  lines.splice(start, i - start + 1)
  if (lines[start] === '') lines.splice(start, 1)
  ptxt = lines.join('\n')
  if (apply) fs.writeFileSync(proxy, ptxt)
} else log('proxy.ts: kein Demo-Bypass mehr')

// CI: Demo-Prüfung entfernen
const wf = path.join(ROOT, '.github/workflows/security-and-betting-regressions.yml')
let w = fs.readFileSync(wf, 'utf8')
if (w.includes('run-recap-demo-check.mjs')) {
  log('CI-Workflow: entferne Schritt run-recap-demo-check.mjs')
  w = w.split('\n').filter((l) => !l.includes('run-recap-demo-check.mjs')).join('\n')
  if (apply) fs.writeFileSync(wf, w)
}

if (apply) {
  const r = spawnSync(process.execPath, ['scripts/check-no-demo-artifacts.mjs'], { stdio: 'inherit', cwd: ROOT })
  process.exit(r.status ?? 1)
} else console.log('\nNichts geändert (Trockenlauf). Mit --apply ausführen.')
