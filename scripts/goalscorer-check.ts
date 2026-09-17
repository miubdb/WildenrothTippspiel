/**
 * Consistency checks for the goalscorer model.
 *
 * There is no test framework in this repo (see CLAUDE.md), so these are
 * assertions over the real production functions and the real exported data.
 * They check the properties the two-level design is supposed to guarantee —
 * things that were silently false before and would be easy to break again:
 *
 *   1. the goalscorer market's team xG IS the main market's team xG
 *   2. a Wildenroth II fixture is priced in the B-Klasse, not the Kreisliga
 *   3. Σ playerXG over the eligible pool == teamMatchXG (minus own-goal reserve)
 *   4. a stronger/weaker opponent moves player odds, purely through team xG,
 *      and leaves the relative shares untouched
 *   5. a blocked player gets no xG, and his share goes to his team-mates
 *   6. projected minutes sum to the real 900-minute outfield budget
 *   7. squad 1 and squad 2 resolve to different, correct player pools
 *   8. a `both` player is damped when the other side plays at the same time
 *
 * Usage: node --experimental-strip-types scripts/run-goalscorer-check.mjs
 */
import { readFileSync } from 'node:fs'
import type { Match } from '@/types'
import { getMatchXG, buildPriorContext } from '@/lib/odds'
import { buildEffectiveMatchdayIndex, effectiveMatchdayOf } from '@/lib/season'
import {
  computeGoalscorerOffers,
  computeGoalscorerOffersForMatch,
  type WildenrothPlayer,
} from '@/lib/goalscorer'
import { hasConcurrentOtherSquadFixture } from '@/lib/goalscorerContext'
import { loadData } from './backtest'

const DATA_DIR = process.env.BACKTEST_DATA_DIR ?? '/tmp/bt'

export function loadWildenrothPlayers(): WildenrothPlayer[] {
  const rows = JSON.parse(readFileSync(`${DATA_DIR}/wplayers.json`, 'utf8')) as unknown[][]
  return rows.map((r) => ({
    id: r[0] as number,
    name: r[1] as string,
    position: r[2] as WildenrothPlayer['position'],
    squad: r[3] as string,
    games: r[4] as number,
    minutes: r[5] as number,
    goals: r[6] as number,
    assists: r[7] as number,
    prev_games: r[8] as number,
    prev_minutes: r[9] as number,
    prev_goals: r[10] as number,
    friendly_goals: r[11] as number,
    is_goalkeeper: r[12] as boolean,
    is_penalty_taker: r[13] as boolean,
    is_freekick_taker: r[14] as boolean,
    active: r[15] as boolean,
  }))
}

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = '') {
  checks++
  if (!ok) failures++
  console.log(`  ${ok ? 'OK  ' : 'FEHLER'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps

export function run(): number {
  const data = loadData()
  const players = loadWildenrothPlayers()
  const priorCtx = buildPriorContext(data.priorMatches, data.teamNames, data.leaguePlayers, data.lineups)
  const modelMatches = data.matches.filter(
    (m) => (m as unknown as { competition_type?: string }).competition_type !== 'cup'
  )
  const idByName = (n: string) =>
    [...data.teamNames.entries()].find(([, v]) => v === n)?.[0] ?? null
  const W1 = idByName('SpVgg Wildenroth')
  const W2 = idByName('SpVgg Wildenroth II')
  const idx = buildEffectiveMatchdayIndex(data.matches)
  const md8 = data.matches.filter((m) => effectiveMatchdayOf(m, idx) === 8)
  const findFixture = (teamId: number | null) =>
    teamId == null ? null : md8.find((m) => m.home_team_id === teamId || m.away_team_id === teamId) ?? null

  const m1 = findFixture(W1)
  const m2 = findFixture(W2)

  const squadFor = (side: '1' | '2') =>
    players.filter((p) => p.active && (p.squad === side || p.squad === 'both'))

  console.log('\n1. Torschützen-Team-xG == Hauptmarkt-Team-xG')
  for (const [label, m, wId, side] of [
    ['Wildenroth I', m1, W1, '1'],
    ['Wildenroth II', m2, W2, '2'],
  ] as const) {
    if (!m || wId == null) { check(label, false, 'kein Spiel gefunden'); continue }
    const main = getMatchXG(modelMatches, m.home_team_id, m.away_team_id, priorCtx)
    const mainTeamXG = m.home_team_id === wId ? main.homeXG : main.awayXG
    const gs = computeGoalscorerOffersForMatch(
      modelMatches, m.home_team_id, m.away_team_id, wId, squadFor(side), priorCtx
    )
    check(`${label}: ${gs.teamMatchXG.toFixed(6)} == ${mainTeamXG.toFixed(6)}`, near(gs.teamMatchXG, mainTeamXG))
  }

  console.log('\n2. Wildenroth II wird als B-Klasse gepreist')
  if (m2 && W2 != null) {
    const d = getMatchXG(modelMatches, m2.home_team_id, m2.away_team_id, priorCtx).diagnostics
    check(`Liga-Tier = ${d.tier}`, d.tier === 'b_klasse')
    // Genau der Bug im Admin-Recompute: ohne match_category greift die Kreisliga-Baseline.
    const stripped = modelMatches.map((m) => ({ ...m, match_category: undefined })) as Match[]
    const bugged = getMatchXG(stripped, m2.home_team_id, m2.away_team_id, priorCtx)
    const correct = getMatchXG(modelMatches, m2.home_team_id, m2.away_team_id, priorCtx)
    const pick = (r: { homeXG: number; awayXG: number }) => (m2.home_team_id === W2 ? r.homeXG : r.awayXG)
    check(
      'ohne match_category weicht die xG messbar ab (Regressionsschutz)',
      bugged.diagnostics.tier === 'kreisliga' && !near(pick(bugged), pick(correct), 1e-3),
      `${pick(bugged).toFixed(3)} statt ${pick(correct).toFixed(3)}`
    )
  }

  console.log('\n3. Σ playerXG == teamMatchXG')
  for (const [label, m, wId, side] of [
    ['Wildenroth I', m1, W1, '1'],
    ['Wildenroth II', m2, W2, '2'],
  ] as const) {
    if (!m || wId == null) continue
    const gs = computeGoalscorerOffersForMatch(
      modelMatches, m.home_team_id, m.away_team_id, wId, squadFor(side), priorCtx
    )
    const sum = gs.offers.reduce((s, o) => s + o.diagnostics.playerXG, 0)
    check(`${label}: Σ ${sum.toFixed(6)} == ${gs.teamMatchXG.toFixed(6)}`, near(sum, gs.teamMatchXG, 1e-9))
    check(`${label}: unallocatedXG = ${gs.unallocatedXG.toFixed(6)}`, near(gs.unallocatedXG, 0, 1e-9))
  }

  console.log('\n4. Gegnerstärke wirkt — ausschließlich über das Team-xG')
  {
    const squad = squadFor('1')
    const weak = computeGoalscorerOffers(squad, 2.6)
    const strong = computeGoalscorerOffers(squad, 1.2)
    const sharesEqual = weak.offers.every((o, i) => near(o.diagnostics.share, strong.offers[i].diagnostics.share, 1e-12))
    check('relative Anteile bleiben identisch', sharesEqual)
    check('Σ playerXG folgt dem Team-xG (2,6)', near(weak.offers.reduce((s, o) => s + o.diagnostics.playerXG, 0), 2.6, 1e-9))
    check('Σ playerXG folgt dem Team-xG (1,2)', near(strong.offers.reduce((s, o) => s + o.diagnostics.playerXG, 0), 1.2, 1e-9))
    const ratios = weak.offers
      .filter((o) => o.diagnostics.playerXG > 0)
      .map((o, i) => o.diagnostics.playerXG / strong.offers.filter((x) => x.diagnostics.playerXG > 0)[i].diagnostics.playerXG)
    check('jedes playerXG skaliert mit exakt 2,6/1,2', ratios.every((r) => near(r, 2.6 / 1.2, 1e-9)))
    const anyOffered = weak.offers.find((o) => o.is_offered)
    const sameStrong = strong.offers.find((o) => o.player_id === anyOffered?.player_id)
    check(
      'Quote steigt gegen den stärkeren Gegner',
      !!anyOffered && !!sameStrong && sameStrong.odds_score > anyOffered.odds_score,
      anyOffered && sameStrong ? `${anyOffered.odds_score} → ${sameStrong.odds_score}` : ''
    )
  }

  console.log('\n5. Gesperrter Spieler bekommt kein xG, sein Anteil geht an die anderen')
  {
    const squad = squadFor('1')
    const base = computeGoalscorerOffers(squad, 2.0)
    const top = [...base.offers].sort((a, b) => b.diagnostics.playerXG - a.diagnostics.playerXG)[0]
    const blocked = computeGoalscorerOffers(squad, 2.0, { blockedPlayerIds: new Set([top.player_id]) })
    const blockedRow = blocked.offers.find((o) => o.player_id === top.player_id)!
    check(`${top.player_name} gesperrt → playerXG 0`, blockedRow.diagnostics.playerXG === 0)
    check(`${top.player_name} gesperrt → nicht angeboten`, !blockedRow.is_offered && !blockedRow.is_offered_2plus)
    check(
      'Σ playerXG bleibt beim Team-xG (Anteil umverteilt, nicht verloren)',
      near(blocked.offers.reduce((s, o) => s + o.diagnostics.playerXG, 0), 2.0, 1e-9)
    )
    const other = base.offers.find((o) => o.player_id !== top.player_id && o.diagnostics.playerXG > 0)!
    const otherAfter = blocked.offers.find((o) => o.player_id === other.player_id)!
    check('ein Mitspieler bekommt mehr xG als vorher', otherAfter.diagnostics.playerXG > other.diagnostics.playerXG)
  }

  console.log('\n6. Projizierte Minuten = 900 (10 Feldspieler × 90)')
  for (const side of ['1', '2'] as const) {
    const gs = computeGoalscorerOffers(squadFor(side), 2.0)
    check(`Squad ${side}: Σ ${gs.projectedMinutesTotal.toFixed(1)} Minuten`, near(gs.projectedMinutesTotal, 900, 1e-6))
    const anyOver90 = gs.offers.some((o) => o.diagnostics.projectedMinutes > 90.0001)
    check(`Squad ${side}: kein Spieler über 90 Minuten`, !anyOver90)
  }

  console.log('\n7. Squad-Trennung')
  {
    const s1 = squadFor('1').map((p) => p.id)
    const s2 = squadFor('2').map((p) => p.id)
    const both = players.filter((p) => p.active && p.squad === 'both').map((p) => p.id)
    const only1 = players.filter((p) => p.active && p.squad === '1').map((p) => p.id)
    const only2 = players.filter((p) => p.active && p.squad === '2').map((p) => p.id)
    check('Squad 1 = nur-1 + both', s1.length === only1.length + both.length)
    check('Squad 2 = nur-2 + both', s2.length === only2.length + both.length)
    check('kein nur-2-Spieler in Squad 1', !only2.some((id) => s1.includes(id)))
    check('kein nur-1-Spieler in Squad 2', !only1.some((id) => s2.includes(id)))
    check('both-Spieler in beiden Pools', both.every((id) => s1.includes(id) && s2.includes(id)))
  }

  console.log('\n8. `both` bei parallelem Spiel der anderen Mannschaft')
  {
    const squad = squadFor('1')
    const bothPlayer = squad.find((p) => p.squad === 'both' && !p.is_goalkeeper && (p.prev_games ?? 0) > 0)
    const noConflict = computeGoalscorerOffers(squad, 2.0, { bothSquadConflict: false })
    const conflict = computeGoalscorerOffers(squad, 2.0, { bothSquadConflict: true })
    const a = noConflict.offers.find((o) => o.player_id === bothPlayer?.id)!
    const b = conflict.offers.find((o) => o.player_id === bothPlayer?.id)!
    check(
      `${bothPlayer?.name}: Einsatzwahrscheinlichkeit halbiert`,
      near(b.diagnostics.pPlays, a.diagnostics.pPlays / 2, 1e-9),
      `${(a.diagnostics.pPlays * 100).toFixed(1)}% → ${(b.diagnostics.pPlays * 100).toFixed(1)}%`
    )
    check(`${bothPlayer?.name}: Anteil sinkt`, b.diagnostics.share < a.diagnostics.share)
    // Auf Gruppenebene prüfen, nicht je Spieler: ein Stammspieler kann bereits
    // an der 90-Minuten-Grenze liegen, dann gehen die frei werdenden Minuten an
    // die noch nicht gedeckelten Mitspieler und sein Anteil steigt nicht.
    const exclusiveIds = new Set(squad.filter((p) => p.squad === '1').map((p) => p.id))
    const shareOf = (r: typeof noConflict) =>
      r.offers.filter((o) => exclusiveIds.has(o.player_id)).reduce((s, o) => s + o.diagnostics.share, 0)
    check(
      'Squad-1-exklusive Spieler bekommen zusammen mehr Anteil',
      shareOf(conflict) > shareOf(noConflict),
      `${(shareOf(noConflict) * 100).toFixed(1)}% → ${(shareOf(conflict) * 100).toFixed(1)}%`
    )
    check('Σ playerXG unverändert beim Team-xG', near(conflict.offers.reduce((s, o) => s + o.diagnostics.playerXG, 0), 2.0, 1e-9))

    if (m1 && W1 != null && W2 != null) {
      check(
        'Spieltag 8: Parallelspiel der beiden Mannschaften wird erkannt',
        hasConcurrentOtherSquadFixture(modelMatches, m1.match_date, W1, [W1, W2])
      )
    }
  }

  console.log(`\n${failures === 0 ? 'Alle' : failures + ' von ' + checks} Prüfungen ${failures === 0 ? `bestanden (${checks})` : 'FEHLGESCHLAGEN'}`)
  return failures
}
