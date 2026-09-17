/**
 * Runs the goalscorer pricing candidate study (scripts/goalscorer-pricing-study.ts).
 * Read-only: touches no database row and no frozen odds.
 *
 *   node --experimental-strip-types scripts/run-goalscorer-pricing-study.mjs
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const ROOT = path.resolve(import.meta.dirname, '..')
register(pathToFileURL(path.join(ROOT, 'scripts/ts-resolver.mjs')).href, pathToFileURL(ROOT + '/'))

const study = await import(pathToFileURL(path.join(ROOT, 'scripts/goalscorer-pricing-study.ts')).href)
const { buildViews } = await import(pathToFileURL(path.join(ROOT, 'scripts/goalscorer-preview.ts')).href)

const MARGIN = 0.15
const MIN = 1.2
const CAP = 30
const candidates = study.buildCandidates(MIN, CAP)

// --- Historischer Referenzmarkt ST1-7 (nur zur Orientierung, read-only) ---
const HIST = JSON.parse(readFileSync(path.join(ROOT, 'scripts/data/goalscorer-history-st1-7.json'), 'utf8'))

const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '∞')
const line = (n = 118) => console.log('─'.repeat(n))

console.log('\n=== Pricing-Studie Torschützenmarkt ===')
console.log('Das Wahrscheinlichkeitsmodell wird NICHT angefasst. prob_score und playerXG bleiben,')
console.log('wie sie sind; hier geht es allein um die angebotene Quote.\n')

// ---------- 1. Formeln + Beispielabbildung ----------
console.log('1. KANDIDATEN')
line()
const SAMPLES = [2, 3, 5, 8, 10, 15, 20, 30, 50, 70, 100]
console.log('  roh    ' + candidates.map((c) => c.key.padStart(11)).join(''))
line()
for (const r of SAMPLES) {
  console.log(`  ${String(r).padStart(4)}   ` + candidates.map((c) => f2(c.price(r)).padStart(11)).join(''))
}
line()
for (const c of candidates) {
  console.log(`  ${c.key.padEnd(12)} ${c.name}`)
  console.log(`  ${''.padEnd(12)} ${c.formula}`)
  console.log(`  ${''.padEnd(12)} streng monoton: ${study.isStrictlyIncreasing(c.price) ? 'ja' : 'NEIN'}   ` +
    `o(∞) → ${f2(c.price(1e9))}`)
}

// ---------- 2. Spieltag-8-Rohquoten ----------
const views = buildViews(8, false)
const rawBySide = new Map()
for (const v of views) {
  const rows = v.result.offers
    .filter((o) => o.is_offered)
    .map((o) => ({
      name: o.player_name,
      prob: o.prob_score,
      prob2: o.prob_score_2plus,
      raw: study.fairOdds(o.prob_score, MARGIN),
      raw2: study.fairOdds(o.prob_score_2plus, MARGIN),
      offered2: o.is_offered_2plus,
    }))
    .sort((a, b) => a.raw - b.raw)
  rawBySide.set(v.label, { view: v, rows })
}

console.log('\n\n2. VERTEILUNGSVERGLEICH — "Trifft"-Markt')
line()
const hist = study.describe(HIST.scorer)
const fmtRow = (label, d) =>
  `  ${label.padEnd(34)} n=${String(d.n).padStart(3)}  p10 ${f2(d.p10).padStart(6)}  p25 ${f2(d.p25).padStart(6)}` +
  `  Median ${f2(d.median).padStart(6)}  p75 ${f2(d.p75).padStart(6)}  p90 ${f2(d.p90).padStart(6)}` +
  `  max ${f2(d.max).padStart(6)}  ≥30: ${d.over30}`
console.log(fmtRow('ST1-7 historisch (Referenz)', hist))
line()
for (const [label, { rows }] of rawBySide) {
  const raws = rows.map((r) => r.raw)
  console.log(fmtRow(`${label} — ST8 ROH`, study.describe(raws)))
  for (const c of candidates) {
    console.log(fmtRow(`   ${c.key}`, study.describe(raws.map(c.price))))
  }
  line()
}

// ---------- 2b. Gleiche Marktgröße vergleichen ----------
console.log('\n2b. WICHTIG — gleiche Marktgröße vergleichen')
console.log('  ST1-7 bot pro Spiel nur die ~15 wahrscheinlichsten Spieler an, ST8 bietet ALLE Feldspieler an.')
console.log('  Ein Median-Vergleich über unterschiedlich zusammengesetzte Mengen ist deshalb irreführend.')
console.log('  Hier zusätzlich die jeweils 15 kürzesten ST8-Quoten, also die Menge, die ST1-7 angeboten hätte:')
line()
console.log(fmtRow('ST1-7 historisch', hist))
for (const [label, { rows }] of rawBySide) {
  const top = rows.slice(0, 15).map((r) => r.raw)
  console.log(fmtRow(`${label} — Top 15 ROH`, study.describe(top)))
  for (const key of ['hyb6', 'piecewise6', 'harmonic']) {
    const c = candidates.find((x) => x.key === key)
    console.log(fmtRow(`   Top 15, ${key}`, study.describe(top.map(c.price))))
  }
  line()
}

// ---------- 3. Spielerlisten ----------
console.log('\n3. SPIELTAG 8 — ALLE ANGEBOTENEN SPIELER')
for (const [label, { view, rows }] of rawBySide) {
  console.log(`\n${label} — ${view.fixture}   (Team-xG ${view.teamMatchXG.toFixed(3)})`)
  const head = '  Spieler                      P(Tor)     roh  ' + candidates.map((c) => c.key.padStart(11)).join('')
  console.log(head)
  console.log('  ' + '─'.repeat(head.length - 2))
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(26).slice(0, 26)} ${(r.prob * 100).toFixed(2).padStart(6)}% ${f2(r.raw).padStart(7)}  ` +
      candidates.map((c) => f2(c.price(r.raw)).padStart(11)).join(''))
  }
}

// ---------- 4. 2+-Markt ----------
console.log('\n\n4. MARKT "2+ TORE" — separat betrachtet')
line()
const hist2 = study.describe(HIST.scorer2plus)
console.log(fmtRow('ST1-7 historisch 2+ (Referenz)', hist2))
console.log('  Achtung: die historische 2+-Verteilung ist VORGEFILTERT — das alte Modell bot 2+ nur')
console.log('  ab 5 % Wahrscheinlichkeit an, die langen Preise tauchen dort also gar nicht auf.')
line()
for (const [label, { rows }] of rawBySide) {
  const r2 = rows.filter((r) => r.offered2).map((r) => r.raw2)
  if (r2.length === 0) { console.log(`  ${label}: kein 2+-Angebot (Schwelle 5 %)`); continue }
  console.log(fmtRow(`${label} — 2+ ROH`, study.describe(r2)))
  for (const cap2 of [30, 40, 50]) {
    const c2 = study.buildCandidates(MIN, cap2).find((c) => c.key === 'piecewise6')
    console.log(fmtRow(`   piecewise6, CAP ${cap2}`, study.describe(r2.map(c2.price))))
  }
  line()
}
