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
  compressOdds,
  computeGoalscorerOffers,
  computeGoalscorerOffersForMatch,
  type WildenrothPlayer,
  type TeamStats,
} from '@/lib/goalscorer'
import { hasConcurrentOtherSquadFixture, wildenrothGoalsPerMatch, shouldRecomputeGoalscorerRow, BLOCKING_GOALSCORER_STATUSES } from '@/lib/goalscorerContext'
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

/** Per-team current-season stats, exported from wildenroth_player_team_stats. */
export function loadTeamStats(): Map<string, TeamStats> {
  const rows = JSON.parse(readFileSync(`${DATA_DIR}/wteamstats.json`, 'utf8')) as unknown[][]
  const out = new Map<string, TeamStats>()
  for (const r of rows) {
    out.set(`${r[0]}:${r[1]}`, {
      games: r[2] as number,
      minutes: r[3] as number,
      goals: r[4] as number,
      asOfMatches: r[5] as number,
      minutesReliable: r[6] as boolean,
    })
  }
  return out
}

/** Attach this fixture's team stats + the other side's, exactly as
 *  lib/goalscorerContext.ts#attachTeamStats does against the database. */
export function withTeamStats(
  players: WildenrothPlayer[],
  side: '1' | '2',
  stats: Map<string, TeamStats>,
): WildenrothPlayer[] {
  const other = side === '1' ? '2' : '1'
  return players.map((p) => ({
    ...p,
    teamStats: stats.get(`${p.id}:${side}`) ?? null,
    otherTeamStats: stats.get(`${p.id}:${other}`) ?? null,
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

  const teamStats = loadTeamStats()
  const squadFor = (side: '1' | '2') =>
    withTeamStats(players.filter((p) => p.active && (p.squad === side || p.squad === 'both')), side, teamStats)
  const ctxFor = (side: '1' | '2') => ({
    teamGoalsPerMatch: wildenrothGoalsPerMatch(modelMatches, side === '1' ? W1 : W2),
    otherTeamGoalsPerMatch: wildenrothGoalsPerMatch(modelMatches, side === '1' ? W2 : W1),
  })

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

  console.log('\n9. Angebotsregel: jeder Feldspieler im Kader wird angeboten')
  {
    const squad = squadFor('1')
    const r = computeGoalscorerOffers(squad, 2.0, ctxFor('1'))
    const outfield = squad.filter((p) => !p.is_goalkeeper)
    const keepers = squad.filter((p) => p.is_goalkeeper)
    const offered = r.offers.filter((o) => o.is_offered)
    check(
      `alle ${outfield.length} Feldspieler angeboten`,
      offered.length === outfield.length,
      `angeboten: ${offered.length}`
    )
    check('kein Torwart angeboten', !keepers.some((k) => r.offers.find((o) => o.player_id === k.id)?.is_offered))
    check(
      'sehr kleine Wahrscheinlichkeiten werden angeboten, nicht ausgefiltert',
      offered.some((o) => o.prob_score < 0.03),
      `kleinste angebotene Wahrscheinlichkeit ${(Math.min(...offered.map((o) => o.prob_score)) * 100).toFixed(2)}%`
    )
    // Kader gesetzt: wer nicht drin steht, wird nicht angeboten.
    const dropped = outfield.slice(0, 5).map((p) => p.id)
    const withSquad = computeGoalscorerOffers(squad, 2.0, { ...ctxFor('1'), blockedPlayerIds: new Set(dropped) })
    check(
      'Spieler außerhalb des Kaders werden nicht angeboten',
      dropped.every((id) => !withSquad.offers.find((o) => o.player_id === id)?.is_offered)
    )
    check(
      'Zahl der Angebote = Zahl der Feldspieler im Kader',
      withSquad.offers.filter((o) => o.is_offered).length === outfield.length - dropped.length
    )
  }

  console.log('\n9b. Bestätigter Kader hat Vorrang vor der statistischen Einsatzquote')
  {
    const squad = squadFor('1')
    const never = squad.find((p) => !p.is_goalkeeper && (p.teamStats?.games ?? 0) === 0 && (p.prev_games ?? 0) === 0)
    const preview = computeGoalscorerOffers(squad, 2.0, { ...ctxFor('1'), squadConfirmed: false })
    const confirmed = computeGoalscorerOffers(squad, 2.0, { ...ctxFor('1'), squadConfirmed: true })
    if (never) {
      const a = preview.offers.find((o) => o.player_id === never.id)!
      const b = confirmed.offers.find((o) => o.player_id === never.id)!
      check(
        `${never.name} (ohne jeden Einsatz): Vorschau ${(a.diagnostics.pPlays * 100).toFixed(0)}% → im Kader ${(b.diagnostics.pPlays * 100).toFixed(0)}%`,
        b.diagnostics.pPlays > a.diagnostics.pPlays && b.diagnostics.playerXG > 0
      )
    }
    const bothP = squad.find((p) => p.squad === 'both' && !p.is_goalkeeper)!
    const withConflict = computeGoalscorerOffers(squad, 2.0, { ...ctxFor('1'), bothSquadConflict: true, squadConfirmed: false })
    const confirmedConflict = computeGoalscorerOffers(squad, 2.0, { ...ctxFor('1'), bothSquadConflict: true, squadConfirmed: true })
    const c1 = withConflict.offers.find((o) => o.player_id === bothP.id)!
    const c2 = confirmedConflict.offers.find((o) => o.player_id === bothP.id)!
    check(
      `${bothP.name}: bestätigter Kader hebt die Parallelspiel-Dämpfung auf`,
      c2.diagnostics.pPlays > c1.diagnostics.pPlays,
      `${(c1.diagnostics.pPlays * 100).toFixed(0)}% → ${(c2.diagnostics.pPlays * 100).toFixed(0)}%`
    )
    check('alle Angebote behalten Σ playerXG = Team-xG',
      near(confirmed.offers.reduce((s, o) => s + o.diagnostics.playerXG, 0), 2.0, 1e-9))
  }

  console.log('\n10. Quotencap und Marge — kein positiver Erwartungswert')
  {
    for (const side of ['1', '2'] as const) {
      // Im bestätigten Kader — das ist der Zustand, in dem Quoten real live gehen.
      const r = computeGoalscorerOffers(squadFor(side), side === '1' ? 2.04 : 2.65, { ...ctxFor(side), squadConfirmed: true })
      const offered = r.offers.filter((o) => o.is_offered)
      const worst = Math.max(...offered.map((o) => o.prob_score * o.odds_score))
      check(
        `Squad ${side}: höchster Erwartungswert ${worst.toFixed(3)} < 1`,
        worst < 1,
        `${offered.length} Angebote, Quoten ${Math.min(...offered.map((o) => o.odds_score))}–${Math.max(...offered.map((o) => o.odds_score))}`
      )
      // Der Cap darf den Markt nicht dominieren. Ein paar Spieler mit echter
      // Restwahrscheinlichkeit unter ~0,9 % landen zwangsläufig dort — bei
      // MAX_ODDS = 30 wären es rund drei Viertel des Kaders gewesen.
      const atCap = offered.filter((o) => o.odds_score >= 100).length
      check(
        `Squad ${side}: ${atCap} von ${offered.length} Angeboten am Cap (< ein Viertel)`,
        atCap * 4 < offered.length
      )
    }
  }

  console.log('\n11. Team-spezifische Statistik statt globaler Summe')
  {
    const both = players.filter((p) => p.active && p.squad === 'both' && !p.is_goalkeeper)
    const s1 = squadFor('1'), s2 = squadFor('2')
    const withSplit = both.filter((p) => {
      const a = s1.find((x) => x.id === p.id)?.teamStats
      const b = s2.find((x) => x.id === p.id)?.teamStats
      return a && b && (a.games !== b.games || a.minutes !== b.minutes)
    })
    check(
      `${withSplit.length} von ${both.length} both-Spielern haben pro Mannschaft unterschiedliche Werte`,
      withSplit.length > 0
    )
    const ex = withSplit[0]
    if (ex) {
      const a = s1.find((x) => x.id === ex.id)!
      const b = s2.find((x) => x.id === ex.id)!
      check(
        `${ex.name}: I ${a.teamStats!.games} Sp./${a.teamStats!.minutes} Min. vs II ${b.teamStats!.games} Sp./${b.teamStats!.minutes} Min.`,
        a.teamStats!.minutes !== b.teamStats!.minutes
      )
      check(
        `${ex.name}: die jeweils andere Mannschaft ist nur Prior, nicht addiert`,
        a.otherTeamStats?.minutes === b.teamStats!.minutes
      )
    }
    // Team II hat unzuverlässige Minuten -> Flag muss durchkommen.
    check(
      'Wildenroth II ist als minutes_reliable = false markiert',
      s2.some((p) => p.teamStats && !p.teamStats.minutesReliable)
    )
    check(
      'Wildenroth I ist als minutes_reliable = true markiert',
      s1.some((p) => p.teamStats && p.teamStats.minutesReliable)
    )
  }

  console.log('\n12. Liga-Kontext der Spielerhistorie wird nicht doppelt gezählt')
  {
    // Gleiche Spieler, gleiche Team-xG, nur unterschiedliche Liga-Torniveaus:
    // die Anteile dürfen sich ändern (Umrechnung der Fremdteam-Historie), die
    // SUMME muss exakt das Team-xG bleiben.
    const squad = squadFor('2')
    const a = computeGoalscorerOffers(squad, 2.65, { teamGoalsPerMatch: 2.0 })
    const b = computeGoalscorerOffers(squad, 2.65, { teamGoalsPerMatch: 2.0, otherTeamGoalsPerMatch: 2.33 })
    check('Σ playerXG bleibt Team-xG, unabhängig vom Liga-Kontext',
      near(a.offers.reduce((s, o) => s + o.diagnostics.playerXG, 0), 2.65, 1e-9) &&
      near(b.offers.reduce((s, o) => s + o.diagnostics.playerXG, 0), 2.65, 1e-9))
    // Kein realer `both`-Spieler hat bislang für die jeweils andere Mannschaft
    // getroffen, deshalb hier ein konstruierter Fall: derselbe Spieler, dieselbe
    // Historie, nur unterschiedliches Torniveau der ANDEREN Mannschaft.
    const base = squad.filter((p) => !p.is_goalkeeper).slice(0, 8)
    const synthetic: WildenrothPlayer[] = base.map((p, i) => i === 0
      ? { ...p, squad: 'both', teamStats: null,
          otherTeamStats: { games: 5, minutes: 450, goals: 5, asOfMatches: 5, minutesReliable: true } }
      : p)
    const lowOther = computeGoalscorerOffers(synthetic, 2.0, { teamGoalsPerMatch: 2.0, otherTeamGoalsPerMatch: 1.0 })
    const highOther = computeGoalscorerOffers(synthetic, 2.0, { teamGoalsPerMatch: 2.0, otherTeamGoalsPerMatch: 4.0 })
    const lx = lowOther.offers[0].diagnostics.share
    const hx = highOther.offers[0].diagnostics.share
    check(
      'Tore in einer torreicheren Liga zählen relativ weniger',
      hx < lx,
      `andere Mannschaft 1,0 Tore/Spiel → ${(lx * 100).toFixed(2)}% Anteil, 4,0 Tore/Spiel → ${(hx * 100).toFixed(2)}%`
    )
    check('Σ playerXG bleibt in beiden Fällen exakt das Team-xG',
      near(lowOther.offers.reduce((s, o) => s + o.diagnostics.playerXG, 0), 2.0, 1e-9) &&
      near(highOther.offers.reduce((s, o) => s + o.diagnostics.playerXG, 0), 2.0, 1e-9))
  }

  console.log('\n13. Pricing-Layer — Longshot-Kompression')
  {
    // Monotonie auf dichtem Gitter: die Reihenfolge der Spieler darf sich nie drehen.
    let prev = -Infinity, mono = true
    for (let r = 1.01; r <= 600; r += 0.01) { const v = compressOdds(r); if (!(v > prev)) { mono = false; break } prev = v }
    check('streng monoton steigend über den gesamten Bereich', mono)

    check('identisch bis zur Kompressionsgrenze (r ≤ 6)',
      [1.2, 1.62, 3.17, 3.46, 5.77, 5.999].every((r) => near(compressOdds(r), r, 1e-12)))

    // C¹: Wert UND Steigung stimmen an der Nahtstelle überein, also kein Knick.
    const eps = 1e-6
    const slopeL = (compressOdds(6) - compressOdds(6 - eps)) / eps
    const slopeR = (compressOdds(6 + eps) - compressOdds(6)) / eps
    check(`stetig differenzierbar bei r = 6 (Steigung ${slopeL.toFixed(4)} → ${slopeR.toFixed(4)})`,
      near(compressOdds(6), 6, 1e-12) && Math.abs(slopeL - slopeR) < 1e-3)

    check('nähert sich 30 von unten, erreicht es nie',
      [100, 500, 5000, 1e9].every((r) => compressOdds(r) < 30) && compressOdds(1e9) > 29.8,
      `o(1e9) = ${compressOdds(1e9).toFixed(4)}`)

    check('komprimiert nur nach unten — kann keinen positiven Erwartungswert erzeugen',
      Array.from({ length: 2000 }, (_, i) => 1.2 + i * 0.3).every((r) => compressOdds(r) <= r + 1e-12))

    // Keine künstlichen Stufen: unterschiedliche Wahrscheinlichkeiten → unterschiedliche Quoten.
    const probes = [0.0019, 0.0028, 0.0039, 0.0049, 0.0058, 0.0088, 0.0115, 0.0137, 0.0168, 0.0434]
    const priced = probes.map((pr) => Math.round(compressOdds(1 / (pr * 1.15)) * 100) / 100)
    check(`keine doppelten Quoten bei benachbarten Wahrscheinlichkeiten (${priced.slice(0, 4).join(' / ')} …)`,
      new Set(priced).size === priced.length)

    // Am realen Spieltag-8-Kader.
    for (const side of ['1', '2'] as const) {
      const r = computeGoalscorerOffers(squadFor(side), side === '1' ? 2.038 : 2.651, ctxFor(side))
      const offered = r.offers.filter((o) => o.is_offered)
      const odds = offered.map((o) => o.odds_score)
      check(`Squad ${side}: jede angebotene Quote ≤ 30`, odds.every((o) => o <= 30), `max ${Math.max(...odds).toFixed(2)}`)
      check(`Squad ${side}: kein Spieler exakt am Cap`, odds.filter((o) => o >= 29.995).length === 0)
      check(`Squad ${side}: ${new Set(odds).size} verschiedene Quoten bei ${odds.length} Angeboten`,
        new Set(odds).size >= odds.length - 1)
      const worst = Math.max(...offered.map((o) => o.prob_score * o.odds_score))
      check(`Squad ${side}: höchster Erwartungswert ${worst.toFixed(3)} < 1`, worst < 1)
      // Reihenfolge: nach Wahrscheinlichkeit sortiert muss die Quote monoton fallen.
      const byProb = [...offered].sort((a, b) => b.prob_score - a.prob_score)
      check(`Squad ${side}: Reihenfolge durch die Kompression unverändert`,
        byProb.every((o, i) => i === 0 || byProb[i - 1].odds_score <= o.odds_score))
      // Das Wahrscheinlichkeitsmodell bleibt unberührt.
      check(`Squad ${side}: Σ playerXG weiterhin exakt das Team-xG`,
        near(r.offers.reduce((s, o) => s + o.diagnostics.playerXG, 0), side === '1' ? 2.038 : 2.651, 1e-9))
      // Toleranz = halber Cent: odds_score ist auf zwei Nachkommastellen gerundet
      // und darf dadurch minimal über der ungerundeten fairen Quote liegen.
      check(`Squad ${side}: angebotene Quote nie länger als die faire Quote`,
        offered.every((o) => o.odds_score <= o.diagnostics.fairOddsScore + 0.005))
      const compressed = offered.filter((o) => o.diagnostics.fairOddsScore > 6)
      check(`Squad ${side}: ${compressed.length} Quoten tatsächlich komprimiert, ${offered.length - compressed.length} unverändert`,
        compressed.every((o) => o.odds_score < o.diagnostics.fairOddsScore))
    }
  }

  console.log('\n14. Marktöffnung — Quoten sind danach ein Snapshot')
  {
    // A) Nach Marktöffnung: eine veröffentlichte Zeile wird nie neu gepreist.
    check('veröffentlichte (frozen) Zeile wird nicht neu berechnet',
      !shouldRecomputeGoalscorerRow({ frozen: true, manuallyOverridden: false }))
    check('veröffentlichte Zeile auch mit manuellem Override nicht',
      !shouldRecomputeGoalscorerRow({ frozen: true, manuallyOverridden: true }))
    check('manuell gesetzte Quote wird nicht überschrieben',
      !shouldRecomputeGoalscorerRow({ frozen: false, manuallyOverridden: true }))
    check('unveröffentlichte Zeile darf neu berechnet werden',
      shouldRecomputeGoalscorerRow({ frozen: false, manuallyOverridden: false }))
    check('`not_in_squad` schließt den Spieler (blockierender Status)',
      BLOCKING_GOALSCORER_STATUSES.has('not_in_squad'))

    // Der vollständige Ablauf: Markt öffnen, dann einen Spieler aus dem Kader
    // nehmen. Die gespeicherten Quoten der übrigen Spieler dürfen sich nicht
    // bewegen, weil ihre Zeilen nicht neu berechnet werden.
    const squad = squadFor('1')
    const atOpen = computeGoalscorerOffers(squad, 2.038, ctxFor('1'))
    const published = new Map(atOpen.offers.map((o) => [o.player_id, o]))
    const dropped = atOpen.offers.filter((o) => o.is_offered).slice(-3).map((o) => o.player_id)

    // So rechnet die Route nach Marktöffnung: Modell läuft, aber nur Zeilen ohne
    // frozen_at werden geschrieben.
    const afterDrop = computeGoalscorerOffers(squad, 2.038, {
      ...ctxFor('1'), blockedPlayerIds: new Set(dropped),
    })
    const written = afterDrop.offers.filter((o) =>
      shouldRecomputeGoalscorerRow({ frozen: published.has(o.player_id), manuallyOverridden: false }))
    check(`${dropped.length} Spieler aus dem Kader genommen → keine einzige veröffentlichte Zeile wird geschrieben`,
      written.length === 0)

    // Genau das ist der Punkt: das Modell WÜRDE umverteilen, die Route lässt es nicht zu.
    const keeper = atOpen.offers.find((o) => o.is_offered && !dropped.includes(o.player_id))!
    const wouldBe = afterDrop.offers.find((o) => o.player_id === keeper.player_id)!
    check(`${keeper.player_name}: Modell würde auf ${wouldBe.odds_score} umpreisen, gespeichert bleibt ${keeper.odds_score}`,
      wouldBe.odds_score !== keeper.odds_score)
    check('gestrichener Spieler bekommt kein xG mehr',
      dropped.every((id) => afterDrop.offers.find((o) => o.player_id === id)!.diagnostics.playerXG === 0))

    // B) Vor Marktöffnung darf sich die Verteilung sehr wohl ändern.
    const preOpen = afterDrop.offers.filter((o) =>
      shouldRecomputeGoalscorerRow({ frozen: false, manuallyOverridden: false }))
    check('vor Marktöffnung werden alle Zeilen neu berechnet', preOpen.length === afterDrop.offers.length)
    check('vor Marktöffnung bleibt Σ playerXG das volle Team-xG (Umverteilung findet statt)',
      near(afterDrop.offers.reduce((s, o) => s + o.diagnostics.playerXG, 0), 2.038, 1e-9))
    // Richtung offen lassen: ein Spieler am 90-Minuten-Cap kann keine Minuten
    // dazugewinnen, während andere es tun — sein ANTEIL sinkt dann sogar.
    check(`vor Marktöffnung ändert sich die Verteilung (${keeper.player_name}: ${keeper.diagnostics.playerXG.toFixed(4)} → ${wouldBe.diagnostics.playerXG.toFixed(4)})`,
      !near(wouldBe.diagnostics.playerXG, published.get(keeper.player_id)!.diagnostics.playerXG, 1e-9))
  }

  console.log('\n15. Einsatz-Prior: rund 15 eingesetzte Feldspieler')
  {
    for (const side of ['1', '2'] as const) {
      const r = computeGoalscorerOffers(squadFor(side), side === '1' ? 2.038 : 2.651, ctxFor(side))
      const eligible = r.offers.filter((o) => !o.diagnostics.excluded)
      const sumPlays = eligible.reduce((s, o) => s + o.diagnostics.pPlays, 0)
      // Kein exaktes Ziel: bei einem Parallelspiel der anderen Mannschaft werden
      // `both`-Spieler gedämpft, dann sind real weniger als 15 zu erwarten.
      check(`Squad ${side}: Σ P(spielt) = ${sumPlays.toFixed(2)} (Prior 15, Spanne 11-16 plausibel)`,
        sumPlays > 11 && sumPlays < 16)
      check(`Squad ${side}: Σ erwartete Minuten = 900`, near(r.projectedMinutesTotal, 900, 1e-6))
      check(`Squad ${side}: keine Einsatzwahrscheinlichkeit über 100 %`,
        eligible.every((o) => o.diagnostics.pPlays <= 1 + 1e-12))
      check(`Squad ${side}: alle ${eligible.length} Feldspieler weiterhin angeboten`,
        eligible.every((o) => o.is_offered))
    }
  }

  console.log('\n16. Team-spezifische Saisonstatistik (Quelle der UI)')
  {
    const stats = loadTeamStats()
    const byName = new Map(players.map((p) => [p.name, p.id]))
    const expected: [string, number, number, number][] = [
      ['Maximilian Scheidl', 5, 379, 5],
      ['Xaver Throm', 6, 540, 3],
      ['Timo Ritter', 6, 422, 1],
      ['Ender Dag', 6, 540, 2],
      ['Lorenz Schorer', 6, 500, 3],
    ]
    for (const [name, g, min, goals] of expected) {
      const st = stats.get(`${byName.get(name)}:1`)
      check(`${name} (Mannschaft I): ${st?.games ?? '–'} Sp / ${st?.minutes ?? '–'} Min / ${st?.goals ?? '–'} T`,
        st?.games === g && st?.minutes === min && st?.goals === goals)
    }
    // `both`-Spieler: die beiden Mannschaften müssen getrennt bleiben.
    const both = players.filter((p) => p.active && p.squad === 'both' && !p.is_goalkeeper)
    const split = both.filter((p) => {
      const a = stats.get(`${p.id}:1`), b = stats.get(`${p.id}:2`)
      return a && b && (a.games !== b.games || a.minutes !== b.minutes || a.goals !== b.goals)
    })
    check(`${split.length} von ${both.length} both-Spielern haben je Mannschaft eigene Werte`, split.length > 0)
    const u = both.find((p) => p.name === 'Tristan Umkehrer')
    if (u) {
      const a = stats.get(`${u.id}:1`)!, b = stats.get(`${u.id}:2`)!
      check(`Tristan Umkehrer: I ${a.games}/${a.minutes} ≠ II ${b.games}/${b.minutes}`,
        a.minutes !== b.minutes)
      const globalMinutes = (u.minutes ?? 0)
      check(`Tristan Umkehrer: globaler Wert (${globalMinutes}) ist keine der beiden Mannschaftszahlen`,
        globalMinutes !== a.minutes || globalMinutes !== b.minutes)
    }
  }

  console.log(`\n${failures === 0 ? 'Alle' : failures + ' von ' + checks} Prüfungen ${failures === 0 ? `bestanden (${checks})` : 'FEHLGESCHLAGEN'}`)
  return failures
}
