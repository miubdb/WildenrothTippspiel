/**
 * Entry point for the walk-forward backtest (see scripts/backtest.ts).
 *
 *   node --experimental-strip-types scripts/run-backtest.mjs
 *   node --experimental-strip-types scripts/run-backtest.mjs --save /tmp/bt/baseline.json
 *   node --experimental-strip-types scripts/run-backtest.mjs --compare /tmp/bt/baseline.json
 *
 * Registers the resolver first so the script can import the app's real
 * TypeScript modules — the model logic under test is the production one.
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
register(pathToFileURL(path.join(ROOT, 'scripts/ts-resolver.mjs')).href, pathToFileURL(ROOT + '/'))

const { loadData, runBacktest, fmtBucket } = await import(pathToFileURL(path.join(ROOT, 'scripts/backtest.ts')).href)

const args = process.argv.slice(2)
const argOf = (flag) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
}

const data = loadData()
const res = runBacktest(data)

console.log('\n=== Walk-forward-Backtest (Wahrscheinlichkeiten VOR House Margin) ===')
console.log(fmtBucket('GESAMT', res.overall))
console.log('\n-- nach Liga --')
for (const [k, b] of Object.entries(res.byTier)) console.log(fmtBucket(k, b))
console.log('\n-- nach absolvierten Spielen (min. beider Teams) --')
for (const [k, b] of Object.entries(res.byExperience)) console.log(fmtBucket(k, b))

const sums = res.perMatch.map((m) => m.probs.matrixSum)
console.log(`\nScore-Matrix-Summe: min ${Math.min(...sums).toFixed(5)}  max ${Math.max(...sums).toFixed(5)} (muss ~1 sein)`)

const savePath = argOf('--save')
if (savePath) {
  writeFileSync(savePath, JSON.stringify(res, null, 0))
  console.log(`\ngespeichert: ${savePath}`)
}

const cmpPath = argOf('--compare')
if (cmpPath) {
  const base = JSON.parse(readFileSync(cmpPath, 'utf8'))
  const metrics = [
    ['1X2 LogLoss', 'logLoss1x2'], ['1X2 Brier', 'brier1x2'],
    ['BTTS LogLoss', 'logLossBtts'], ['BTTS Brier', 'brierBtts'],
    ['O2.5 LogLoss', 'logLossO25'], ['O2.5 Brier', 'brierO25'],
    ['Score NLL', 'nllScore'], ['Tor-MAE', 'maeGoals'],
  ]
  const row = (label, a, b) => {
    if (!a || a.n === 0) return
    console.log(`\n${label} (n=${a.n})`)
    for (const [name, key] of metrics) {
      const alt = b[key] / b.n, neu = a[key] / a.n
      const d = neu - alt
      const pct = alt !== 0 ? (d / alt) * 100 : 0
      const mark = d < -1e-9 ? 'BESSER' : d > 1e-9 ? 'schlechter' : 'gleich'
      console.log(`  ${name.padEnd(14)} alt ${alt.toFixed(4)}  neu ${neu.toFixed(4)}  ${d >= 0 ? '+' : ''}${d.toFixed(4)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)  ${mark}`)
    }
  }
  console.log('\n\n=== VERGLEICH alt (--compare) vs neu (aktueller Code) ===')
  console.log('niedriger ist besser bei allen Metriken')
  row('GESAMT', res.overall, base.overall)
  for (const k of Object.keys(res.byTier)) row(k, res.byTier[k], base.byTier[k])
  for (const k of Object.keys(res.byExperience)) row(`Spiele ${k}`, res.byExperience[k], base.byExperience[k])
}
