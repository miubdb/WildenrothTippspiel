/**
 * Entry point for the goalscorer preview (scripts/goalscorer-preview.ts).
 *
 *   node --experimental-strip-types scripts/run-goalscorer-preview.mjs 8
 *   node --experimental-strip-types scripts/run-goalscorer-preview.mjs 8 --old /tmp/bt/old-goalscorer.ts
 *
 * Read-only: nothing is written to the database and nothing is frozen.
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
register(pathToFileURL(path.join(ROOT, 'scripts/ts-resolver.mjs')).href, pathToFileURL(ROOT + '/'))

const { buildViews, legacyFor } = await import(pathToFileURL(path.join(ROOT, 'scripts/goalscorer-preview.ts')).href)

const args = process.argv.slice(2)
const matchday = Number.isFinite(Number(args[0])) ? parseInt(args[0], 10) : 8
const oldIdx = args.indexOf('--old')
const oldPath = oldIdx >= 0 ? args[oldIdx + 1] : null
const legacy = oldPath ? await import(pathToFileURL(path.resolve(oldPath)).href) : null
const squadConfirmed = args.includes('--squad-confirmed')

const pct = (p) => `${(p * 100).toFixed(1)}%`
const num = (v, d = 2) => v.toFixed(d)

console.log(`\n=== Torschützen-Vorschau Spieltag ${matchday} ===`)
console.log('Read-only. Nichts wird eingefroren, nichts wird in die DB geschrieben.')
console.log('Diese Spiele haben noch kein Ergebnis und fließen in keine Kalibrierung ein.\n')

for (const v of buildViews(matchday, squadConfirmed)) {
  const legacyRows = legacy ? legacyFor(v, legacy) : null
  console.log('='.repeat(118))
  console.log(`${v.label} — ${v.fixture}`)
  console.log(`  match_category: ${v.category}   →   Liga-Tier im Modell: ${v.tier}   (Liga-Normalspiel pro Team: ${num(v.baselineTeamXG)} Tore)`)
  console.log(`  Team-xG aus dem HAUPTMARKT: ${num(v.teamMatchXG, 3)}  — identisch zu 1X2 / O-U / BTTS / Handicap / Exaktes Ergebnis`)
  console.log(`  Gegnerstärke steckt bereits hier drin. Auf Spielerebene wird KEIN zweiter Gegnerfaktor multipliziert.`)
  console.log(`  Tore/Spiel diese Mannschaft: ${v.teamGoalsPerMatch?.toFixed(2) ?? '–'}   andere Wildenroth-Mannschaft: ${v.otherTeamGoalsPerMatch?.toFixed(2) ?? '–'}`)
  console.log(`    (nur zum Umrechnen einer Historie aus der anderen Mannschaft — KEIN zweiter Torniveau-Faktor)`)
  console.log(`  Kader bestätigt: ${v.squadConfirmed ? 'JA' : 'NEIN → Vorschau aus historischer Einsatzquote, Markt darf nicht eingefroren werden'}`)
  console.log(`  Paralleles Spiel der anderen Mannschaft: ${v.bothSquadConflict ? (v.squadConfirmed ? 'JA (durch bestätigten Kader gegenstandslos)' : 'JA → `both`-Spieler gedämpft') : 'nein'}`)
  console.log()

  const rows = v.result.offers
    .filter((o) => o.is_offered)
    .sort((a, b) => b.diagnostics.playerXG - a.diagnostics.playerXG)

  const head = legacy
    ? 'Spieler                    Sq  akt.Team   Vors.   P(spielt) Min.  Tore/90  Anteil   xG neu  xG alt   Quote neu  Quote alt'
    : 'Spieler                    Sq  akt.Team   Vors.   P(spielt) Min.  Tore/90  Anteil   xG      P(>=1)   Quote Tor  P(>=2)  Quote 2+'
  console.log('  ' + head)
  console.log('  ' + '-'.repeat(head.length))
  for (const o of rows) {
    const d = o.diagnostics
    const p = v.players.get(o.player_id)
    const ts = p?.teamStats
    const teamCol = ts ? `${ts.games}Sp/${ts.minutes}m/${ts.goals}T` : '–'
    const prevCol = `${p?.prev_games ?? 0}/${p?.prev_goals ?? 0}T`
    const base = `  ${o.player_name.padEnd(26).slice(0, 26)} ${(p?.squad ?? '?').padEnd(3)} ` +
      `${teamCol.padStart(10)} ${prevCol.padStart(7)} ` +
      `${pct(d.pPlays).padStart(8)} ${num(d.projectedMinutes, 0).padStart(4)} ` +
      `${num(d.goalsPer90, 3).padStart(7)} ${pct(d.share).padStart(7)} `
    if (legacyRows) {
      const l = legacyRows.get(o.player_id)
      console.log(base +
        `${num(d.playerXG, 3).padStart(7)} ${num(l?.playerXG ?? 0, 3).padStart(7)}  ` +
        `${(o.is_offered ? num(o.odds_score) : '–').padStart(9)}  ${(l?.offered ? num(l.odds) : '–').padStart(9)}`)
    } else {
      console.log(base +
        `${num(d.playerXG, 3).padStart(7)} ${pct(o.prob_score).padStart(8)} ` +
        `${(o.is_offered ? num(o.odds_score) : '–').padStart(9)} ${pct(o.prob_score_2plus).padStart(8)} ` +
        `${(o.is_offered_2plus ? num(o.odds_score_2plus) : '–').padStart(8)}`)
    }
  }

  const r = v.result
  const offeredCount = r.offers.filter((o) => o.is_offered).length
  console.log()
  const outfield = [...v.players.values()].filter((p) => !p.is_goalkeeper).length
  console.log(`  angeboten: ${offeredCount} Feldspieler von ${outfield} im Kader   (Torhüter: ${v.players.size - outfield}, nie angeboten)`)
  console.log(`  Σ projizierte Minuten:        ${num(r.projectedMinutesTotal, 1).padStart(8)}   (10 Feldspieler × 90 = 900)`)
  console.log(`  Σ playerXG (gesamter Kader):  ${num(r.allocatedXG, 3).padStart(8)}`)
  console.log(`  Σ playerXG (nur angebotene):  ${num(r.offeredXG, 3).padStart(8)}   Rest auf Ergänzungsspieler: ${num(r.allocatedXG - r.offeredXG, 3)}`)
  console.log(`  unallocatedXG (Eigentore):    ${num(r.unallocatedXG, 3).padStart(8)}`)
  console.log(`  Team-xG:                      ${num(r.teamMatchXG, 3).padStart(8)}`)
  console.log(`  Differenz Σ Kader − Team-xG:  ${num(r.allocatedXG - r.teamMatchXG, 6).padStart(8)}`)

  if (legacyRows) {
    const oldSumAll = [...legacyRows.values()].reduce((s, l) => s + l.playerXG, 0)
    const oldSumOffered = [...legacyRows.entries()]
      .filter(([, l]) => l.offered).reduce((s, [, l]) => s + l.playerXG, 0)
    console.log()
    console.log(`  ALT — Σ playerXG gesamter Kader: ${num(oldSumAll, 3)}  (${num(oldSumAll / r.teamMatchXG)}× Team-xG)`)
    console.log(`  ALT — Σ playerXG nur angebotene: ${num(oldSumOffered, 3)}  (${num(oldSumOffered / r.teamMatchXG)}× Team-xG)`)
    console.log(`  ALT — angeboten: ${[...legacyRows.values()].filter((l) => l.offered).length} Spieler`)
  }
  console.log()
}
