/**
 * Entry point for the out-of-sample Spieltag preview (see scripts/matchday-preview.ts).
 *
 *   node --experimental-strip-types scripts/run-matchday-preview.mjs 8
 *   node --experimental-strip-types scripts/run-matchday-preview.mjs 8 --old /tmp/bt/old/lib/odds.ts
 *
 * `--old` points at a second copy of lib/odds.ts (e.g. `git show HEAD:lib/odds.ts`)
 * and prints an old-vs-new column pair per fixture.
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
register(pathToFileURL(path.join(ROOT, 'scripts/ts-resolver.mjs')).href, pathToFileURL(ROOT + '/'))

const { priceMatchday, currentModel, pct, dec } =
  await import(pathToFileURL(path.join(ROOT, 'scripts/matchday-preview.ts')).href)

const args = process.argv.slice(2)
const matchday = parseInt(args[0] ?? '8', 10)
const oldIdx = args.indexOf('--old')
const oldPath = oldIdx >= 0 ? args[oldIdx + 1] : null

const neu = priceMatchday(matchday, currentModel)
const alt = oldPath ? priceMatchday(matchday, await import(pathToFileURL(path.resolve(oldPath)).href)) : null
const altById = new Map((alt ?? []).map((m) => [m.id, m]))

console.log(`\n=== Spieltag ${matchday} — Vorschau (Wahrscheinlichkeiten VOR House Margin) ===`)
console.log('Reine Plausibilitätsprüfung: diese Spiele haben noch kein Ergebnis und')
console.log('fließen in KEINE Kalibrierung ein.\n')

for (const m of neu) {
  const a = altById.get(m.id)
  const d = m.diagnostics
  console.log(`${m.label}  [${m.category}]`)
  const row = (name, x) =>
    `  ${name}  xG ${x.markets.homeXG.toFixed(2)}:${x.markets.awayXG.toFixed(2)}` +
    `  1 ${dec(x.markets.home)} X ${dec(x.markets.draw)} 2 ${dec(x.markets.away)}` +
    `  BTTS-Ja ${dec(x.markets.bttsYes)}  Ü2,5 ${dec(x.markets.over25)}`
  if (a) console.log(row('alt', a))
  console.log(row(a ? 'neu' : '   ', m))
  console.log(
    `       Liga-Normalspiel ${d.baselineHome.toFixed(2)}:${d.baselineAway.toFixed(2)} (${d.tier}, n=${d.baselineSampleMatches})` +
    `  Heim ${d.home.gamesAll}/${d.home.gamesVenue} Sp., Gast ${d.away.gamesAll}/${d.away.gamesVenue} Sp.` +
    `  Form ${d.home.formMult.toFixed(2)}/${d.away.formMult.toFixed(2)}  Kader ${d.home.rosterFactor.toFixed(2)}/${d.away.rosterFactor.toFixed(2)}`
  )
  if (a) {
    const dHome = m.markets.home - a.markets.home
    const dBtts = m.markets.bttsYes - a.markets.bttsYes
    const dOver = m.markets.over25 - a.markets.over25
    console.log(`       Δ Heimsieg ${(dHome * 100 >= 0 ? '+' : '')}${(dHome * 100).toFixed(1)} Pp  ·  Δ BTTS ${(dBtts * 100 >= 0 ? '+' : '')}${(dBtts * 100).toFixed(1)} Pp  ·  Δ Ü2,5 ${(dOver * 100 >= 0 ? '+' : '')}${(dOver * 100).toFixed(1)} Pp`)
  }
  console.log()
}

// Book sanity: every paired market must sum to > 1 after margin, i.e. the raw
// probabilities must sum to ~1 before it.
for (const m of neu) {
  const s = m.markets.home + m.markets.draw + m.markets.away
  if (Math.abs(s - 1) > 1e-6) console.log(`WARNUNG: 1X2-Summe ${s} bei ${m.label}`)
}
console.log(`Ø Heimsieg-Wahrscheinlichkeit: ${pct(neu.reduce((s, m) => s + m.markets.home, 0) / neu.length)}`)
