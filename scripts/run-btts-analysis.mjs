/**
 * Entry point for the BTTS / P(team scores ≥ 1) calibration analysis.
 * See scripts/btts-analysis.ts for what it measures and why.
 *
 *   node --experimental-strip-types scripts/run-btts-analysis.mjs
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
register(pathToFileURL(path.join(ROOT, 'scripts/ts-resolver.mjs')).href, pathToFileURL(ROOT + '/'))

const { loadData } = await import(pathToFileURL(path.join(ROOT, 'scripts/backtest.ts')).href)
const { collect, calibrate, fmtCal } = await import(pathToFileURL(path.join(ROOT, 'scripts/btts-analysis.ts')).href)

const data = loadData()
const { sides, matches } = collect(data)

const bttsRows = matches.map((m) => ({ p: m.pBttsMatrix, y: m.btts }))
const sideRows = (f = () => true) => sides.filter(f).map((s) => ({ p: s.pScore, y: s.scored }))

const H = (t) => console.log(`\n\n${'='.repeat(100)}\n${t}\n${'='.repeat(100)}`)
const S = (t) => console.log(`\n-- ${t} --`)

H('1. BTTS — Gesamtkalibrierung')
console.log('Δ = real − Modell in Prozentpunkten. ± ist der Standardfehler der realen Quote.')
console.log('|z| < 2 heißt: bei dieser Stichprobe nicht von Zufall unterscheidbar.\n')
console.log(fmtCal('BTTS gesamt', calibrate(bttsRows)))

S('nach Liga')
for (const tier of ['kreisliga', 'b_klasse']) {
  console.log(fmtCal(`BTTS ${tier}`, calibrate(matches.filter((m) => m.tier === tier).map((m) => ({ p: m.pBttsMatrix, y: m.btts })))))
}

S('nach Erfahrung (min. Spiele beider Teams vor Anstoß)')
for (const [label, f] of [
  ['0–3 Spiele', (m) => m.minGames <= 3],
  ['4–7 Spiele', (m) => m.minGames >= 4 && m.minGames <= 7],
  ['8+ Spiele', (m) => m.minGames >= 8],
]) {
  console.log(fmtCal(`BTTS ${label}`, calibrate(matches.filter(f).map((m) => ({ p: m.pBttsMatrix, y: m.btts })))))
}

S('nach Offensivstärke des SCHWÄCHEREN Teams (Tore/Spiel vor Anstoß)')
for (const [label, lo, hi] of [
  ['< 0,75', -Infinity, 0.75],
  ['0,75–1,25', 0.75, 1.25],
  ['1,25–2,0', 1.25, 2.0],
  ['> 2,0', 2.0, Infinity],
]) {
  const f = (m) => m.minGfPerGame != null && m.minGfPerGame >= lo && m.minGfPerGame < hi
  console.log(fmtCal(`BTTS schwächere Off. ${label}`, calibrate(matches.filter(f).map((m) => ({ p: m.pBttsMatrix, y: m.btts })))))
}

H('2. Die Zerlegung — ist es BTTS oder schon P(Team trifft)?')
console.log('Unter unabhängigen Poisson-Verteilungen gilt exakt P(BTTS) = P(Heim≥1) × P(Gast≥1).')
const maxDiff = Math.max(...matches.map((m) => Math.abs(m.pBttsMatrix - m.pBttsProduct)))
console.log(`Kontrolle Matrix vs. Produkt: max. Abweichung ${maxDiff.toExponential(2)} — bestätigt, dass BTTS`)
console.log('keine eigene Formel ist, sondern voll und ganz aus den beiden Einzelwahrscheinlichkeiten folgt.\n')
console.log(fmtCal('P(Team trifft) gesamt', calibrate(sideRows())))
console.log(fmtCal('  davon Heimteams', calibrate(sideRows((s) => s.venue === 'home'))))
console.log(fmtCal('  davon Gastteams', calibrate(sideRows((s) => s.venue === 'away'))))

S('nach Liga')
for (const tier of ['kreisliga', 'b_klasse']) {
  console.log(fmtCal(`P(trifft) ${tier}`, calibrate(sideRows((s) => s.tier === tier))))
}

S('nach eigener Offensivstärke vor Anstoß (Tore/Spiel)')
for (const [label, lo, hi] of [
  ['< 0,75', -Infinity, 0.75],
  ['0,75–1,25', 0.75, 1.25],
  ['1,25–2,0', 1.25, 2.0],
  ['> 2,0', 2.0, Infinity],
]) {
  const f = (s) => s.gfPerGame != null && s.gfPerGame >= lo && s.gfPerGame < hi
  console.log(fmtCal(`P(trifft) eigene GF/Sp. ${label}`, calibrate(sideRows(f))))
}

S('Sondergruppen — genau der geäußerte Verdacht')
for (const [label, f] of [
  ['0 Tore bisher (beliebig viele Sp.)', (s) => s.games > 0 && s.goalsSoFar === 0],
  ['≥3 Spiele und < 1 Tor/Spiel', (s) => s.games >= 3 && s.gfPerGame != null && s.gfPerGame < 1],
  ['≥5 Spiele und < 1 Tor/Spiel', (s) => s.games >= 5 && s.gfPerGame != null && s.gfPerGame < 1],
  ['≥3 Spiele und ≥ 2 Tore/Spiel', (s) => s.games >= 3 && s.gfPerGame != null && s.gfPerGame >= 2],
  ['noch kein Spiel absolviert', (s) => s.games === 0],
]) {
  const rows = sides.filter((s) => f({ ...s, goalsSoFar: s.gfPerGame != null ? s.gfPerGame * s.games : null }))
  console.log(fmtCal(label, calibrate(rows.map((s) => ({ p: s.pScore, y: s.scored })))))
}

S('nach Gegner-Defensive (Gegentore/Spiel des Gegners vor Anstoß)')
for (const [label, lo, hi] of [
  ['Gegner < 1,5 GA/Sp.', -Infinity, 1.5],
  ['Gegner 1,5–2,5', 1.5, 2.5],
  ['Gegner > 2,5 (löchrig)', 2.5, Infinity],
]) {
  const f = (s) => s.oppGaPerGame != null && s.oppGaPerGame >= lo && s.oppGaPerGame < hi
  console.log(fmtCal(`P(trifft) ${label}`, calibrate(sideRows(f))))
}

H('3. Unabhängigkeitsannahme')
console.log('Wenn die beiden Torzahlen in Wahrheit korreliert sind, ist BTTS auch bei perfekten')
console.log('Einzelwahrscheinlichkeiten falsch. Test: reale BTTS-Quote gegen das Produkt der realen')
console.log('Einzelquoten.\n')
const pH = matches.reduce((s, m) => s + m.homeScored, 0) / matches.length
const pA = matches.reduce((s, m) => s + m.awayScored, 0) / matches.length
const pBoth = matches.reduce((s, m) => s + m.btts, 0) / matches.length
console.log(`  real: Heim trifft ${(pH * 100).toFixed(1)}%, Gast trifft ${(pA * 100).toFixed(1)}%`)
console.log(`  Produkt (wenn unabhängig): ${(pH * pA * 100).toFixed(1)}%   real beide: ${(pBoth * 100).toFixed(1)}%`)
console.log(`  Differenz: ${((pBoth - pH * pA) * 100 >= 0 ? '+' : '') + ((pBoth - pH * pA) * 100).toFixed(1)} Pp`)
const phi = (pBoth - pH * pA) / Math.sqrt(pH * (1 - pH) * pA * (1 - pA))
console.log(`  Phi-Korrelation: ${phi.toFixed(3)}  (SE ≈ ${(1 / Math.sqrt(matches.length)).toFixed(3)})`)

H('4. Torreich ≠ beide treffen')
console.log('Kann das Modell die beiden Dinge trennen? Vergleich in Spielen mit hohem Gesamt-xG.\n')
const highTotal = matches.filter((m) => m.homeXG + m.awayXG >= 3.5)
const lopsided = matches.filter((m) => Math.max(m.homeXG, m.awayXG) / Math.min(m.homeXG, m.awayXG) >= 1.5)
console.log(fmtCal('BTTS bei Gesamt-xG ≥ 3,5', calibrate(highTotal.map((m) => ({ p: m.pBttsMatrix, y: m.btts })))))
console.log(fmtCal('Ü2,5 bei Gesamt-xG ≥ 3,5', calibrate(highTotal.map((m) => ({ p: m.pOver25, y: m.over25 })))))
console.log(fmtCal('BTTS bei xG-Verhältnis ≥ 1,5', calibrate(lopsided.map((m) => ({ p: m.pBttsMatrix, y: m.btts })))))
console.log(fmtCal('P(trifft) schwächere Seite dort', calibrate(
  lopsided.map((m) => (m.homeXG < m.awayXG ? { p: m.pHomeScore, y: m.homeScored } : { p: m.pAwayScore, y: m.awayScored }))
)))

H('5. Die auffälligsten Einzelfälle (schwache Offensive, hohe Trefferwahrscheinlichkeit)')
console.log('Nur zur Orientierung — Einzelfälle sind KEIN Kalibrierungsbefund.\n')
const weak = sides
  .filter((s) => s.games >= 2 && s.gfPerGame != null && s.gfPerGame < 0.75)
  .sort((a, b) => b.pScore - a.pScore)
  .slice(0, 12)
for (const s of weak) {
  console.log(`  ${s.date.slice(0, 10)}  ${s.team.padEnd(30).slice(0, 30)} (${s.venue === 'home' ? 'H' : 'A'}) ` +
    `vorher ${s.gfPerGame.toFixed(2)} T/Sp. aus ${s.games} Sp.  →  xG ${s.xG.toFixed(2)}, P(trifft) ${(s.pScore * 100).toFixed(0)}%` +
    `  → tatsächlich ${s.goals} Tore`)
}
const weakAll = sides.filter((s) => s.games >= 2 && s.gfPerGame != null && s.gfPerGame < 0.75)
console.log(`\n  Gruppe insgesamt: ${fmtCal('', calibrate(weakAll.map((s) => ({ p: s.pScore, y: s.scored })))).trim()}`)

if (process.argv.includes('--save')) {
  const out = process.argv[process.argv.indexOf('--save') + 1]
  const { writeFileSync } = await import('node:fs')
  writeFileSync(out, JSON.stringify({ sides, matches }))
  console.log(`\ngespeichert: ${out}`)
}
