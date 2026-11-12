/**
 * Gegenprobe des Recaps gegen echte Daten (nur lesend, offline): liest Exporte aus $RECAP_DATA_DIR
 * (matches.json, bets.json, combos.json, profiles.json — je ein Array von Zeilen-Objekten, per
 * json_agg/Supabase exportiert, Spalten wie in lib/recap/slips.ts) und gibt Aufschlüsselung,
 * Tipper-IQ-Rangliste, Sensitivitätsanalyse und Awards aus. Läuft nicht in CI (keine Daten dort).
 *   RECAP_DATA_DIR=/tmp/recap node --experimental-strip-types scripts/run-recap-v2-realdata.mjs [von] [bis]
 */
import fs from 'node:fs'
import path from 'node:path'
import { buildSlips } from '@/lib/recap/slips'
import { buildRecapReport } from '@/lib/recap/report'
import { computeIqSensitivity, filterSlipsByMatchdays } from '@/lib/recap/tipperIq'

export function run(): number {
  const dir = process.env.RECAP_DATA_DIR ?? '/tmp/recap'
  const J = (n: string) => JSON.parse(fs.readFileSync(path.join(dir, n + '.json'), 'utf8'))
  const [from, to] = [Number(process.argv[2] ?? 1), Number(process.argv[3] ?? 15)]
  const matches = J('matches'), bets = J('bets'), combos = J('combos'), profiles = J('profiles')
  const { slips } = buildSlips({ bets, combos, matches })
  const rep = buildRecapReport({ allSlips: slips, matches, range: { from, to }, profiles })
  const nm = (id: string) => rep.people[id]?.name ?? id.slice(0, 6)
  console.log('Aufschlüsselung', JSON.stringify(rep.breakdown))
  console.table(rep.iq.filter((r) => r.eligible).map((r) => ({ platz: r.rank, name: nm(r.userId), iq: +r.iq.toFixed(1), treffer: r.components.hit | 0, konstanz: r.components.consistency | 0, schwer: r.components.difficult | 0, robust: r.components.robust | 0, scheine: r.slipsConsidered, gewonnen: r.wonSlips, erwartet: +r.expectedHits.toFixed(2) })))
  const rs = filterSlipsByMatchdays(slips, from, to)
  const sens = computeIqSensitivity(rs, Array.from({ length: to - from + 1 }, (_, i) => from + i))
  const base = sens[0].ranking.filter((r) => r.eligible).map((r) => r.userId)
  for (const v of sens) {
    const ids = v.ranking.filter((r) => r.eligible).map((r) => r.userId)
    const common = base.filter((x) => ids.includes(x))
    const A = common.map((x) => base.indexOf(x)), B = common.map((x) => ids.indexOf(x))
    const rk = (a: number[]) => a.map((x) => [...a].sort((p, q) => p - q).indexOf(x))
    const ra = rk(A), rb = rk(B), n = ra.length
    const rho = 1 - (6 * ra.reduce((s, x, i) => s + (x - rb[i]) ** 2, 0)) / (n * (n * n - 1))
    console.log(v.name.padEnd(46), 'Top 6:', ids.slice(0, 6).map(nm).join(', '), '| Spearman', rho.toFixed(3))
  }
  console.log('--- ÖFFENTLICH ---')
  for (const a of rep.awards.filter((x) => x.public)) { console.log(`${a.icon} ${a.title}: ${a.entries.map((e) => `${nm(e.userId)} (${e.value})`).join(' | ')}`); if (a.second) console.log(`   ↳ ${a.second.title}: ${a.second.entries.map((e) => `${nm(e.userId)} (${e.value}; ${e.detail})`).join(' | ')}`); if (a.bitterest) console.log(`   ↳ bitterster Schein: ${nm(a.bitterest.userId)} ${a.bitterest.legs}er @${a.bitterest.odds} verpasst ${a.bitterest.missedNet.toFixed(0)}`) }
  const bt = rep.bestTips
  for (const [l, c] of [['Beste Einzelwette', bt.single], ['Beste Kombi', bt.combo], ['Mutigster Treffer', bt.bold]] as const) if (c) console.log(`🏅 ${l}: ${nm(c.userId)} ST${c.matchday} Q${c.odds} Einsatz ${c.stake} Auszahlung ${c.payout.toFixed(0)} Netto ${c.net.toFixed(0)} | ${c.legs.map((x) => `${x.match}: ${x.selection}`).join(' + ')} | ${c.why}`)
  console.log('FAKTEN', JSON.stringify({ killers: rep.facts.comboKillers.singleBlockerCombos, killersW: rep.facts.comboKillers.wildenrothCombos, top: rep.facts.comboKillers.topMatch?.combos, oneGoal: rep.facts.oneGoalShort.total, of: rep.facts.oneGoalShort.ofSingleBlockerCombos, lm: rep.facts.lastMinute && `${nm(rep.facts.lastMinute.card.userId)} ${rep.facts.lastMinute.leadSeconds.toFixed(0)}s Q${rep.facts.lastMinute.card.odds}` }))
  console.log('--- INTERN (alle) ---')
  for (const a of rep.awards) console.log(`${a.icon} ${a.title}: ${a.entries.map((e) => `${nm(e.userId)} (${e.value}${process.env.RECAP_DETAIL && e.detail ? '; ' + e.detail : ''})`).join(' | ')}`)
  return 0
}
