/**
 * Prüft, dass KEINE Snapshot-/Demo-Bestandteile im auszuliefernden Code (und optional im Build) stecken.
 *   node scripts/check-no-demo-artifacts.mjs            → Quellcode prüfen
 *   node scripts/check-no-demo-artifacts.mjs --build    → zusätzlich .next (Server- und Client-Bundles) durchsuchen
 * Exit 1 bei Fund. Vor dem Merge nach main Pflicht; auf integration (Demo vorhanden) schlägt es absichtlich fehl.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const FORBIDDEN_PATHS = ['app/recap-demo', 'lib/recap/demo.ts', 'lib/recap/fixtures.ts', 'lib/recap/snapshot.ts', 'lib/recap/snapshot.enc.ts', 'lib/recap/demoKey.ts', 'scripts/build-recap-snapshot.mjs', 'scripts/recap-demo-check.ts', 'scripts/run-recap-demo-check.mjs']
const TOKENS = ['SNAPSHOT_ENC', 'snapshot.enc', 'decryptSnapshot', 'isFixtureDemoEnabled', 'RECAP_FIXTURE_DEMO', 'recap-demo', 'loadDemoState', 'buildFixtureData', 'RECAP_KEY_OUT']
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'docs', 'supabase'])
const SKIP_FILES = new Set(['scripts/check-no-demo-artifacts.mjs', 'scripts/prepare-production-strip.mjs', 'AGENTS.md', 'CLAUDE.md'])
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|yml|yaml|css|html)$/

const problems = []
for (const p of FORBIDDEN_PATHS) if (fs.existsSync(path.join(ROOT, p))) problems.push(`Datei/Ordner vorhanden: ${p}`)

function scan(dir, rel = '', limitText = true) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) { if (!(limitText && SKIP_DIRS.has(e.name) && !rel)) scan(path.join(dir, e.name), r, limitText); continue }
    if (SKIP_FILES.has(r) || !TEXT.test(e.name)) continue
    const txt = fs.readFileSync(path.join(dir, e.name), 'utf8')
    for (const t of TOKENS) if (txt.includes(t)) problems.push(`${r}: enthält „${t}“`)
  }
}
scan(ROOT)
if (process.argv.includes('--build')) {
  const next = path.join(ROOT, '.next')
  if (!fs.existsSync(next)) problems.push('.next fehlt – erst `npm run build` ausführen')
  else {
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) { if (e.name === 'cache') continue; walk(f) } else if (/\.(js|json|html|rsc|map|txt|nft\.json)$/.test(e.name)) { const t = fs.readFileSync(f, 'utf8'); for (const tok of [...TOKENS, 'aes-256-gcm']) if (t.includes(tok)) problems.push(`.next/${path.relative(next, f)}: enthält „${tok}“`) } } }
    walk(next)
  }
}
if (problems.length) { console.error('GEFUNDEN:\n - ' + problems.slice(0, 40).join('\n - ') + (problems.length > 40 ? `\n … und ${problems.length - 40} weitere` : '')); process.exit(1) }
console.log('OK: keine Snapshot-/Demo-Bestandteile gefunden.')
