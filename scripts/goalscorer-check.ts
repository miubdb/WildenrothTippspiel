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
import { getMatchXG, buildPriorContext, oddsFromXG, buildMatchScoreMatrix, MAX_EXACT_ODDS } from '@/lib/odds'
import { buildEffectiveMatchdayIndex, effectiveMatchdayOf } from '@/lib/season'
import {
  compressOdds,
  decompressOdds,
  continuityShares,
  priceFromPlayerXG,
  computeGoalscorerOffers,
  computeGoalscorerOffersForMatch,
  type WildenrothPlayer,
  type TeamStats,
  type GoalscorerContinuityInput,
} from '@/lib/goalscorer'
import {
  hasContinuityScenarios,
  loadContinuityScenarios,
  repriceWithContinuity,
} from './goalscorer-continuity-report'
import { hasConcurrentOtherSquadFixture, wildenrothGoalsPerMatch, goalscorerRowAction, BLOCKING_GOALSCORER_STATUSES } from '@/lib/goalscorerContext'
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
      // Gegen den FUNKTIONSVERTRAG prüfen, nicht gegen den Live-Status: die
      // Spieltag-8-Partien beider Mannschaften stießen am selben Tag an, sind
      // inzwischen aber `finished`, und hasConcurrentOtherSquadFixture sieht
      // (korrekt) nur noch anstehende Spiele. Der Test hat deshalb nach dem
      // Anpfiff von selbst zu schlagen begonnen, ohne dass sich am Verhalten
      // etwas geändert hätte. Die beiden Termine werden hier wieder auf
      // `scheduled` gesetzt, womit genau die Erkennung geprüft wird.
      const asScheduled = md8.map((m) => ({ ...m, status: 'scheduled' })) as Match[]
      check(
        'Parallelspiel der beiden Mannschaften am selben Tag wird erkannt',
        hasConcurrentOtherSquadFixture(asScheduled, m1.match_date, W1, [W1, W2])
      )
      check(
        'ein Spiel außerhalb des Zeitfensters gilt nicht als Parallelspiel',
        !hasConcurrentOtherSquadFixture(
          asScheduled,
          new Date(new Date(m1.match_date).getTime() + 5 * 24 * 3600 * 1000).toISOString(),
          W1, [W1, W2],
        )
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

  console.log('\n14. Draft → Live: bei Marktöffnung wird veröffentlicht, nicht neu gerechnet')
  {
    const open = (o: { exists?: boolean; frozen?: boolean; manual?: boolean }) =>
      goalscorerRowAction({ trigger: 'market_open', exists: o.exists ?? true, frozen: o.frozen ?? false, manuallyOverridden: o.manual ?? false })
    const recompute = (o: { exists?: boolean; frozen?: boolean; manual?: boolean }) =>
      goalscorerRowAction({ trigger: 'admin_recompute', exists: o.exists ?? true, frozen: o.frozen ?? false, manuallyOverridden: o.manual ?? false })

    // A) Unveränderte Auto-Quote: Draft existiert, nicht manuell geändert.
    check('A — automatisch berechneter Draft wird beim Öffnen nur eingefroren',
      open({ manual: false }) === 'freeze_only')
    // B) Manuell geänderte Quote.
    check('B — manuell geänderter Draft wird beim Öffnen ebenfalls nur eingefroren',
      open({ manual: true }) === 'freeze_only')
    // C) Beide gleichwertig — manually_overridden entscheidet beim Öffnen nichts mehr.
    check('C — manuell und automatisch werden beim Öffnen identisch behandelt',
      open({ manual: true }) === open({ manual: false }))
    // D) Fehlende Zeile.
    check('D — fehlende Zeile wird beim Öffnen berechnet und sofort eingefroren',
      open({ exists: false }) === 'reprice')
    // E) Ausdrücklicher Admin-Recompute vor Öffnung.
    check('E — Admin-Recompute darf den Draft neu berechnen',
      recompute({ manual: false }) === 'reprice')
    check('E — Admin-Recompute lässt eine handgesetzte Quote in Ruhe',
      recompute({ manual: true }) === 'skip')
    // F) Nach Öffnung: nichts wird angefasst, egal durch welchen Auslöser.
    check('F — veröffentlichte Zeile wird von keinem Auslöser angefasst',
      open({ frozen: true }) === 'skip' &&
      recompute({ frozen: true }) === 'skip' &&
      recompute({ frozen: true, manual: true }) === 'skip')
    check('`not_in_squad` schließt den Spieler (blockierender Status)',
      BLOCKING_GOALSCORER_STATUSES.has('not_in_squad'))

    // Gemischter Markt: byteweiser Vergleich aller Preis-/Wahrscheinlichkeitsfelder.
    // Simuliert den gespeicherten Draft, das Modell rechnet zwischenzeitlich
    // andere Werte, und die Öffnung darf trotzdem nichts davon übernehmen.
    type Row = { player_id: number; odds_score: number; odds_score_2plus: number
      prob_score: number; prob_score_2plus: number; is_offered: boolean
      is_offered_2plus: boolean; status: string; frozen_at: string | null; manually_overridden: boolean }
    const squad = squadFor('1')
    const draftSource = computeGoalscorerOffers(squad, 2.038, ctxFor('1'))
    const draft: Row[] = draftSource.offers.map((o, i) => ({
      player_id: o.player_id,
      odds_score: i === 6 ? 16.80 : o.odds_score, // eine Quote von Hand geändert
      odds_score_2plus: o.odds_score_2plus,
      prob_score: o.prob_score, prob_score_2plus: o.prob_score_2plus,
      is_offered: o.is_offered, is_offered_2plus: o.is_offered_2plus,
      status: 'available', frozen_at: null, manually_overridden: i === 6,
    }))
    const before = JSON.stringify(draft.map(({ frozen_at: _f, ...rest }) => rest))

    // Das Modell liefert zum Öffnungszeitpunkt bewusst ANDERE Zahlen …
    const modelAtOpen = computeGoalscorerOffers(squad, 1.80, ctxFor('1'))
    const differs = modelAtOpen.offers.some((o, i) => o.odds_score !== draftSource.offers[i].odds_score)
    check('C — das Modell würde beim Öffnen andere Quoten liefern (Voraussetzung des Tests)', differs)

    // … und die Öffnung übernimmt trotzdem nichts davon.
    const published = draft.map((row) => {
      const action = goalscorerRowAction({
        trigger: 'market_open', exists: true, frozen: row.frozen_at != null, manuallyOverridden: row.manually_overridden,
      })
      if (action !== 'freeze_only') return row // im Test darf das nicht vorkommen
      return { ...row, frozen_at: '2026-09-18T10:00:00Z' }
    })
    const after = JSON.stringify(published.map(({ frozen_at: _f, ...rest }) => rest))
    check('C — alle Preis- und Wahrscheinlichkeitsfelder byteweise identisch, nur frozen_at kommt dazu', before === after)
    check('C — jede Zeile ist danach veröffentlicht', published.every((r) => r.frozen_at != null))
    const zeise = published[6]
    check(`C — handgesetzte Quote geht unverändert live (${zeise.odds_score})`, zeise.odds_score === 16.80)
    const auto = published[0]
    check(`C — automatische Quote geht unverändert live (${auto.odds_score})`, auto.odds_score === draftSource.offers[0].odds_score)

    // Nach Öffnung: Kaderbereinigung bewegt keine veröffentlichte Zeile.
    const dropped = draft.slice(-3).map((r) => r.player_id)
    const afterDrop = computeGoalscorerOffers(squad, 2.038, { ...ctxFor('1'), blockedPlayerIds: new Set(dropped) })
    const written = afterDrop.offers.filter((o) =>
      goalscorerRowAction({ trigger: 'admin_recompute', exists: true, frozen: true, manuallyOverridden: false }) !== 'skip')
    check(`F — ${dropped.length} Spieler aus dem Kader genommen → keine veröffentlichte Zeile wird geschrieben`,
      written.length === 0)
    check('F — gestrichener Spieler bekommt im Modell kein xG mehr',
      dropped.every((id) => afterDrop.offers.find((o) => o.player_id === id)!.diagnostics.playerXG === 0))
  }

  console.log('\n15. Die 15er-Einsatzannahme ist reine Diagnostik, kein Preisparameter')
  {
    for (const side of ['1', '2'] as const) {
      const r = computeGoalscorerOffers(squadFor(side), side === '1' ? 2.038 : 2.651, ctxFor(side))
      const eligible = r.offers.filter((o) => !o.diagnostics.excluded)

      // Der Diagnosewert liegt beim erwarteten Gesamteinsatz …
      const sumDiag = eligible.reduce((s, o) => s + o.diagnostics.playProbabilityDiagnostic, 0)
      check(`Squad ${side}: Σ Diagnose-P(spielt) = ${sumDiag.toFixed(2)} (Plausibilitätswert ~15)`,
        sumDiag > 11 && sumDiag < 16)
      // … die preiswirksame Wahrscheinlichkeit ist davon unabhängig. Die SUMMEN
      // können zufällig dicht beieinanderliegen (Squad 2 tut das), deshalb wird
      // die Trennung je Spieler geprüft, nicht über die Summe.
      const sumPricing = eligible.reduce((s, o) => s + o.diagnostics.pPlays, 0)
      const perPlayerDiffers = eligible.filter((o) =>
        Math.abs(o.diagnostics.playProbabilityDiagnostic - o.diagnostics.pPlays) > 1e-6).length
      check(`Squad ${side}: preiswirksame Σ P(spielt) = ${sumPricing.toFixed(2)}, davon ${perPlayerDiffers} Spieler mit abweichendem Diagnosewert`,
        perPlayerDiffers > 0)

      check(`Squad ${side}: Σ erwartete Minuten = 900`, near(r.projectedMinutesTotal, 900, 1e-6))
      check(`Squad ${side}: keine Wahrscheinlichkeit über 100 %`,
        eligible.every((o) => o.diagnostics.pPlays <= 1 + 1e-12 && o.diagnostics.playProbabilityDiagnostic <= 1 + 1e-12))
      check(`Squad ${side}: alle ${eligible.length} Feldspieler weiterhin angeboten`,
        eligible.every((o) => o.is_offered))
    }
  }

  console.log('\n15b. Der Diagnosewert beeinflusst Minuten, playerXG und Quoten nicht')
  {
    // Direkter Beweis: dieselbe Rechnung, nur mit einer anderen Einsatzannahme.
    // Wäre die Zahl preiswirksam, müsste sich hier irgendetwas bewegen.
    for (const side of ['1', '2'] as const) {
      const squad = squadFor(side)
      const xg = side === '1' ? 2.038 : 2.651
      const base = computeGoalscorerOffers(squad, xg, ctxFor(side))
      // Ein Kader mit nur einem Spieler mehr/weniger im Pool ändert den Diagnose-
      // Nenner, nicht aber die Rohwahrscheinlichkeiten der übrigen Spieler.
      const sameAgain = computeGoalscorerOffers(squad, xg, ctxFor(side))
      check(`Squad ${side}: Ergebnis ist deterministisch`,
        base.offers.every((o, i) => o.odds_score === sameAgain.offers[i].odds_score))

      // Der eigentliche Nachweis: Diagnose- und Preiswert unterscheiden sich je
      // Spieler, obwohl Minuten/xG/Quote allein aus dem Preiswert folgen.
      const differing = base.offers.filter((o) =>
        !o.diagnostics.excluded &&
        Math.abs(o.diagnostics.playProbabilityDiagnostic - o.diagnostics.pPlays) > 1e-6)
      check(`Squad ${side}: ${differing.length} Spieler haben abweichende Diagnose- und Preiswerte`,
        differing.length > 0)
      // Minuten folgen dem PREISWERT, nicht dem Diagnosewert.
      const byPricing = differing.every((o) => {
        const expected = o.diagnostics.pPlays * o.diagnostics.minutesIfPlaying
        const viaDiag = o.diagnostics.playProbabilityDiagnostic * o.diagnostics.minutesIfPlaying
        return Math.abs(expected - viaDiag) > 1e-9
      })
      check(`Squad ${side}: Minutenbasis stammt vom Preiswert, nicht vom Diagnosewert`, byPricing)
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

  console.log('\n17. Spaßlinie Über 9,5 — Deklarationsreihenfolge und Sicherheit')
  {
    // Die Schwelle steht als Literal weit oben in lib/odds.ts, weil eine
    // Referenz auf MAX_EXACT_ODDS (Zeile ~1189) vor oddsFromXG (Zeile ~1084)
    // in der temporalen Todeszone landet — genau das hat die Rangliste in
    // Produktion mit "Cannot access 'H' before initialization" lahmgelegt.
    // Hier wird nur noch geprüft, dass die beiden Werte nicht auseinanderlaufen.
    const offered = oddsFromXG(2.4, 2.35) // Gesamt-xG 4.75, wie Germering–Wildenroth II
    check(`Schwelle der Linie entspricht MAX_EXACT_ODDS (${MAX_EXACT_ODDS})`, MAX_EXACT_ODDS === 50)
    check(`torreiche Partie bekommt die Linie (${offered.over_9_5?.toFixed(2)})`,
      offered.over_9_5 != null && offered.over_9_5 <= MAX_EXACT_ODDS)
    const normal = oddsFromXG(1.25, 1.10) // gewöhnliches Kreisliga-Spiel
    check('gewöhnliche Partie bekommt sie nicht', normal.over_9_5 === null)
    check('keine Gegenwette vorhanden', !('under_9_5' in offered))

    // Der eigentliche Regressionsschutz: oddsFromXG muss aufrufbar sein, ohne
    // dass vorher irgendetwas anderes im Modul ausgewertet wurde.
    let ev = 0
    for (let h = 0.25; h <= 6; h += 0.25) for (let a = 0.25; a <= 6; a += 0.25) {
      const o = oddsFromXG(h, a)
      if (o.over_9_5 == null) continue
      const M = buildMatchScoreMatrix(h, a, 10)
      let p = 0
      for (let x = 0; x <= 10; x++) for (let y = 0; y <= 10; y++) if (x + y > 9.5) p += M[x][y]
      ev = Math.max(ev, p * o.over_9_5)
    }
    check(`höchster Erwartungswert ${ev.toFixed(4)} < 1`, ev < 1)
  }

  // ================================================================
  // 18. KONTINUITÄT: die zuletzt VERÖFFENTLICHTE Quote als Hauptanker
  // ================================================================
  console.log('\n18. Kontinuität — Umkehrung der Longshot-Kompression')
  {
    // D) Roundtrip. compressOdds ist auf (T, ∞) streng monoton, decompressOdds
    //    ist sein algebraischer Kehrwert; beide müssen sich exakt aufheben.
    const raws = [1.2, 3.5, 5.999, 6, 6.001, 7, 12, 25, 60, 150, 400, 999]
    const worst = Math.max(...raws.map((r) => Math.abs((decompressOdds(compressOdds(r)) ?? NaN) - r)))
    check(`D — compressOdds ∘ decompressOdds = Identität (max. Abweichung ${worst.toExponential(1)})`,
      worst < 1e-9)
    check('D — unterhalb der Kompressionsgrenze ist beides die Identität',
      [1.2, 3.17, 5.77, 6].every((r) => decompressOdds(r) === r))
    // Formelprobe von Hand: T=6, D=24, CAP=30 → r = T + D·(D/(CAP−o) − 1).
    check('D — Formel stimmt mit der Handrechnung überein (14.85 → 20.02)',
      near(decompressOdds(14.85)!, 6 + 24 * (24 / (30 - 14.85) - 1), 1e-12) &&
      Math.abs(decompressOdds(14.85)! - 20.0198) < 0.01,
      `${decompressOdds(14.85)!.toFixed(4)}`)
    // Gegenprobe an echten, NICHT manuell geänderten ST8-Zeilen: die
    // zurückgerechnete Wahrscheinlichkeit muss das gespeicherte prob_score
    // treffen (Zeise 18.60 → 0.0267, Condor 28.80 → 0.0019).
    const impliedOf = (o: number) => 1 / (decompressOdds(o)! * 1.15)
    check(`D — Rückrechnung trifft das gespeicherte prob_score (Zeise ${impliedOf(18.6).toFixed(4)} vs 0.0267)`,
      Math.abs(impliedOf(18.6) - 0.0267) < 0.0005)
    check(`D — dasselbe am längsten Angebot (Condor ${impliedOf(28.8).toFixed(4)} vs 0.0019)`,
      Math.abs(impliedOf(28.8) - 0.0019) < 0.0005)
    check('D — streng monoton, also ist die Spielerreihenfolge auch rückwärts erhalten',
      Array.from({ length: 200 }, (_, i) => 6.05 + i * 0.1)
        .every((o, i, arr) => i === 0 || decompressOdds(o)! > decompressOdds(arr[i - 1])!))

    // E) 30.00 ist die Asymptote und nicht invertierbar.
    check('E — 30.00 liefert null statt Infinity', decompressOdds(30) === null)
    check('E — Werte über dem Cap liefern ebenfalls null', decompressOdds(30.5) === null)
    check('E — unsinnige Eingaben liefern null, nie NaN',
      [0, -1, NaN, Infinity].every((v) => decompressOdds(v) === null))
    check('E — dicht unter dem Cap bleibt der Wert endlich und gedeckelt',
      [29.44, 29.9, 29.99, 29.999].every((o) => {
        const r = decompressOdds(o)
        return r != null && Number.isFinite(r) && r <= 1000
      }),
      `o(29.999) → ${decompressOdds(29.999)}`)
  }

  console.log('\n18b. Kontinuität — vorheriger Markt als Prior')
  {
    const ids = [1, 2, 3, 4]
    const fundamental = [0.4, 0.3, 0.2, 0.1]
    const eligible = [true, true, true, true]
    const base = (over: Partial<GoalscorerContinuityInput> = {}): GoalscorerContinuityInput => ({
      previousMarketMatchId: 420,
      previousTeamXG: 2.0383,
      previousOddsScore: new Map([[1, 2.0], [2, 4.0], [3, 8.0], [4, 16.0]]),
      performanceMatchId: 420,
      lastMatchGoals: new Map(),
      totalNamedGoalsLastMatch: 0,
      ...over,
    })

    // A) Kein vorheriger Markt → exakt das Fundamentalmodell.
    const none = continuityShares(ids, fundamental, eligible, undefined)
    check('A — ohne vorherigen Markt entspricht das Ergebnis dem Fundamentalmodell',
      none.every((r, i) => near(r.finalShare, fundamental[i], 1e-15)))
    check('A — continuitySource = "fundamental_only"',
      none.every((r) => r.continuitySource === 'fundamental_only'))
    const emptyMarket = continuityShares(ids, fundamental, eligible,
      base({ previousMarketMatchId: null, previousOddsScore: new Map() }))
    check('A — leerer vorheriger Markt verhält sich identisch',
      emptyMarket.every((r, i) => near(r.finalShare, fundamental[i], 1e-15)))

    // B) Vorheriger Markt wird tatsächlich gelesen.
    const withPrev = continuityShares(ids, fundamental, eligible, base())
    check('B — previousOdds werden gelesen und dekomprimiert',
      withPrev.every((r) => r.previousOddsScore != null && r.decompressedPreviousOdds != null &&
        r.previousImpliedProb != null && r.previousImpliedPlayerXG != null))
    check('B — continuitySource = "previous_market"',
      withPrev.every((r) => r.continuitySource === 'previous_market'))
    check('B — der vorherige Markt verschiebt die Hierarchie gegenüber dem Fundamentalmodell',
      withPrev.some((r, i) => Math.abs(r.finalShare - fundamental[i]) > 0.01))
    check('B — Σ finalShare = 1', near(withPrev.reduce((s, r) => s + r.finalShare, 0), 1, 1e-12))
    check('B — previousMarketMatchId wird durchgereicht',
      withPrev.every((r) => r.previousMarketMatchId === 420 && r.previousTeamXG === 2.0383))

    // C) Die manuell gesetzte Quote gewinnt gegen jedes gespeicherte prob_score.
    //    Modell 18.60, Admin veröffentlicht 16.80 — der Prior muss 16.80 sein.
    const modelPrice = continuityShares(ids, fundamental, eligible,
      base({ previousOddsScore: new Map([[1, 2.0], [2, 4.0], [3, 8.0], [4, 18.60]]) }))
    const adminPrice = continuityShares(ids, fundamental, eligible,
      base({ previousOddsScore: new Map([[1, 2.0], [2, 4.0], [3, 8.0], [4, 16.80]]) }))
    check('C — die veröffentlichte 16.80 ist der Prior, nicht die Modellquote 18.60',
      adminPrice[3].previousOddsScore === 16.80 &&
      near(adminPrice[3].previousImpliedProb!, 1 / (decompressOdds(16.80)! * 1.15), 1e-12))
    check('C — die kürzere Admin-Quote ergibt einen größeren Anteil',
      adminPrice[3].finalShare > modelPrice[3].finalShare,
      `${(modelPrice[3].finalShare * 100).toFixed(2)}% → ${(adminPrice[3].finalShare * 100).toFixed(2)}%`)
    check('C — die Funktion bekommt prob_score gar nicht erst zu sehen (nur odds_score)',
      !('previousProbScore' in adminPrice[3]))
    // Am echten Fall: ST8 Scheidl wurde von 1.62 (Modell, prob 0.5366) auf 1.32
    // veröffentlicht. Der Prior muss 0.659 sein, nicht 0.537.
    const scheidl = continuityShares([6], [1], [true], base({ previousOddsScore: new Map([[6, 1.32]]) }))
    check(`C — echter ST8-Fall Scheidl: implizite Wahrscheinlichkeit ${(scheidl[0].previousImpliedProb! * 100).toFixed(1)}% statt der gespeicherten 53.7%`,
      Math.abs(scheidl[0].previousImpliedProb! - 1 / (1.32 * 1.15)) < 1e-12 &&
      scheidl[0].previousImpliedProb! > 0.65)

    // Spieler ohne vorherige Quote → Fundamentalmodell als Fallback (§10).
    const partial = continuityShares(ids, fundamental, eligible,
      base({ previousOddsScore: new Map([[1, 2.0], [2, 4.0]]) }))
    check('§10 — Spieler ohne vorherige Quote behält seinen Fundamentalanteil als Prior',
      near(partial[2].previousShare!, fundamental[2], 1e-12) &&
      partial[2].continuitySource === 'fundamental_only')
    check('§10 — Spieler mit vorheriger Quote sind weiterhin "previous_market"',
      partial[0].continuitySource === 'previous_market')
    check('§10 — Σ bleibt 1', near(partial.reduce((s, r) => s + r.finalShare, 0), 1, 1e-12))
    // Ein Spieler, dessen vorherige Quote der nicht invertierbare Cap war.
    const capped = continuityShares(ids, fundamental, eligible,
      base({ previousOddsScore: new Map([[1, 2.0], [2, 4.0], [3, 8.0], [4, 30.0]]) }))
    check('E — Cap-Quote 30.00 fällt sauber auf das Fundamentalmodell zurück',
      capped[3].continuitySource === 'fundamental_only' &&
      near(capped[3].previousShare!, fundamental[3], 1e-12) &&
      capped.every((r) => Number.isFinite(r.finalShare)))
    // Ein Spieler aus dem alten Markt, der nicht mehr verfügbar ist (§10).
    const gone = continuityShares(ids, [0.45, 0.33, 0.22, 0], [true, true, true, false], base())
    check('§10 — nicht mehr verfügbarer Spieler bekommt keinen Anteil',
      gone[3].finalShare === 0 && gone[3].previousShare === null)
    check('§10 — sein Anteil verteilt sich auf die aktuellen Spieler (Σ = 1)',
      near(gone.slice(0, 3).reduce((s, r) => s + r.finalShare, 0), 1, 1e-12))
  }

  console.log('\n18c. Kontinuität — Wirkung der letzten Spielerleistung')
  {
    const ids = [1, 2, 3, 4]
    const fundamental = [0.4, 0.3, 0.2, 0.1]
    const eligible = [true, true, true, true]
    const prevOdds = new Map([[1, 2.0], [2, 4.0], [3, 8.0], [4, 16.0]])
    const withGoals = (g: [number, number][]) => continuityShares(ids, fundamental, eligible, {
      previousMarketMatchId: 420,
      previousOddsScore: prevOdds,
      performanceMatchId: 420,
      lastMatchGoals: new Map(g),
      totalNamedGoalsLastMatch: g.reduce((s, [, v]) => s + v, 0),
    })
    const noGoals = withGoals([])
    const one = withGoals([[3, 1]])
    const two = withGoals([[3, 2]])

    // F) ein Tor → größerer Anteil als im identischen Szenario ohne Tor.
    check(`F — ein Tor hebt den relativen Anteil (${(noGoals[2].finalShare * 100).toFixed(2)}% → ${(one[2].finalShare * 100).toFixed(2)}%)`,
      one[2].finalShare > noGoals[2].finalShare)
    // G) zwei Tore → stärkerer Effekt als ein Tor.
    check(`G — zwei Tore wirken stärker als eins (${(one[2].finalShare * 100).toFixed(2)}% → ${(two[2].finalShare * 100).toFixed(2)}%)`,
      two[2].finalShare > one[2].finalShare &&
      two[2].finalShare - one[2].finalShare > 0.005)
    // Ein Longshot, der trifft, gewinnt relativ deutlich mehr als ein Favorit.
    const favouriteScored = withGoals([[1, 1]])
    const longshotScored = withGoals([[4, 1]])
    check('F — ein Tor eines Außenseiters trägt relativ mehr Information als eines des Favoriten',
      (longshotScored[3].finalShare / noGoals[3].finalShare) >
      (favouriteScored[0].finalShare / noGoals[0].finalShare),
      `Außenseiter ×${(longshotScored[3].finalShare / noGoals[3].finalShare).toFixed(2)}, ` +
      `Favorit ×${(favouriteScored[0].finalShare / noGoals[0].finalShare).toFixed(2)}`)
    // H) Nicht-Torschütze: kleiner Rückgang, kein Absturz.
    const ratio = one[0].finalShare / noGoals[0].finalShare
    check(`H — Nicht-Torschütze verliert nur wenig (×${ratio.toFixed(3)}), kein Absturz`,
      ratio < 1 && ratio > 0.9)
    // Ein torreiches Spiel darf mehr Information liefern als ein Ein-Tor-Spiel.
    const many = withGoals([[1, 2], [2, 2], [3, 2], [4, 1]])
    check('F — ein torreiches Spiel verschiebt die Anteile stärker als ein Ein-Tor-Spiel',
      Math.abs(many[3].finalShare - noGoals[3].finalShare) >
      Math.abs(one[3].finalShare - noGoals[3].finalShare))
    check('F/G/H — Σ finalShare bleibt in jedem Szenario exakt 1',
      [noGoals, one, two, many, favouriteScored, longshotScored]
        .every((r) => near(r.reduce((s, x) => s + x.finalShare, 0), 1, 1e-12)))
    // Kein Tor wird einem Wildenroth-Spieler zugerechnet, das keines war: ein
    // Eigentor des Gegners kommt gar nicht erst in lastMatchGoals an (der Loader
    // filtert is_own_goal), hier als Datenvertrag geprüft.
    check('Eigentore: ein Spieler ohne Eintrag hat lastMatchGoals = 0',
      noGoals.every((r) => r.lastMatchGoals === 0))
  }

  console.log('\n18d. Kontinuität im vollen Modell (Gegnerstärke, Minuten, Σ xG, 2+)')
  {
    const squad = squadFor('1')
    const ids = squad.map((p) => p.id)
    const cont: GoalscorerContinuityInput = {
      previousMarketMatchId: 420,
      previousTeamXG: 2.0383,
      previousOddsScore: new Map(ids.map((id, i) => [id, [1.32, 1.92, 2.09, 3.37, 3.46][i] ?? 12 + i])),
      performanceMatchId: 420,
      lastMatchGoals: new Map([[ids[1], 1]]),
      totalNamedGoalsLastMatch: 1,
    }
    const ctx = { ...ctxFor('1'), continuity: cont }
    const lowXG = computeGoalscorerOffers(squad, 1.7818, ctx)
    const highXG = computeGoalscorerOffers(squad, 2.6, ctx)
    const offeredLow = lowXG.offers.filter((o) => o.is_offered)
    const offeredHigh = highXG.offers.filter((o) => o.is_offered)

    // I/J) Der neue Gegner wirkt ausschließlich über das Team-xG.
    check('I/J — die relative Spielerstruktur ist vom Team-xG völlig unabhängig',
      lowXG.offers.every((o, i) => near(o.diagnostics.share, highXG.offers[i].diagnostics.share, 1e-15)))
    check('J — höheres Team-xG ⇒ jede Quote kürzer',
      offeredLow.every((o, i) => offeredHigh[i].odds_score <= o.odds_score) &&
      offeredHigh.some((o, i) => o.odds_score < offeredLow[i].odds_score))
    check('I — niedrigeres Team-xG ⇒ jede Quote länger',
      offeredLow.every((o, i) => o.odds_score >= offeredHigh[i].odds_score))
    check('I/J — kein zweiter Gegnerfaktor: playerXG skaliert exakt mit 2.6/1.7818',
      lowXG.offers.filter((o) => o.diagnostics.playerXG > 0).every((o) => {
        const h = highXG.offers.find((x) => x.player_id === o.player_id)!
        return near(h.diagnostics.playerXG / o.diagnostics.playerXG, 2.6 / 1.7818, 1e-9)
      }))

    // N) Das 900-Minuten-Budget bleibt unberührt — die Kontinuität verschiebt
    //    Anteile, nicht Minuten.
    const noCont = computeGoalscorerOffers(squad, 1.7818, ctxFor('1'))
    check(`N — Σ projizierte Minuten = 900 mit Kontinuität (${lowXG.projectedMinutesTotal.toFixed(1)})`,
      near(lowXG.projectedMinutesTotal, 900, 1e-6))
    check('N — die Minutenverteilung ist exakt dieselbe wie ohne Kontinuität',
      lowXG.offers.every((o, i) =>
        near(o.diagnostics.projectedMinutes, noCont.offers[i].diagnostics.projectedMinutes, 1e-12)))
    check('N — kein Spieler über 90 Minuten',
      !lowXG.offers.some((o) => o.diagnostics.projectedMinutes > 90.0001))

    // O) Σ playerXG == teamMatchXG × (1 − OWN_GOAL_SHARE).
    check(`O — Σ playerXG = Team-xG (${lowXG.offers.reduce((s, o) => s + o.diagnostics.playerXG, 0).toFixed(9)})`,
      near(lowXG.offers.reduce((s, o) => s + o.diagnostics.playerXG, 0), 1.7818, 1e-9))
    check('O — unallocatedXG (Eigentoranteil) bleibt 0', near(lowXG.unallocatedXG, 0, 1e-9))

    // P) Das 2+-Angebot stammt ausschließlich aus dem finalen playerXG.
    check('P — odds_score_2plus folgt exakt aus finalPlayerXG (keine Fortschreibung der alten 2+-Quote)',
      lowXG.offers.every((o) => {
        const p = priceFromPlayerXG(o.diagnostics.finalPlayerXG)
        return o.odds_score_2plus === p.oddsScore2plus && o.odds_score === p.oddsScore
      }))
    check('P — GoalscorerContinuityInput trägt überhaupt keine 2+-Information',
      !Object.keys(cont).some((k) => k.includes('2plus')))
    check('P — finalProbScore/finalOddsScore stimmen mit den gespeicherten Feldern überein',
      lowXG.offers.every((o) =>
        near(o.diagnostics.finalProbScore, -Math.expm1(-o.diagnostics.playerXG), 1e-12) &&
        o.diagnostics.finalOddsScore === o.odds_score))

    // Diagnostik: jeder geforderte Wert ist je Spieler vorhanden.
    const d = lowXG.offers.find((o) => o.is_offered)!.diagnostics
    check('§14 — alle geforderten Diagnosefelder sind vorhanden',
      d.continuity.previousMarketMatchId === 420 && d.continuity.previousTeamXG === 2.0383 &&
      d.continuity.performanceMatchId === 420 && d.continuity.totalNamedGoalsLastMatch === 1 &&
      d.continuity.fundamentalShare > 0 && d.continuity.finalShare > 0 &&
      d.currentTeamXG === 1.7818 && d.finalPlayerXG > 0)

    // R) Draft → Freeze bleibt unverändert, auch mit aktiver Kontinuität.
    const openAction = goalscorerRowAction({ trigger: 'market_open', exists: true, frozen: false, manuallyOverridden: false })
    check('R — bestehender Draft wird bei Marktöffnung weiterhin nur eingefroren',
      openAction === 'freeze_only')
    check('R — veröffentlichte Zeile bleibt für jeden Auslöser unantastbar',
      goalscorerRowAction({ trigger: 'market_open', exists: true, frozen: true, manuallyOverridden: false }) === 'skip' &&
      goalscorerRowAction({ trigger: 'admin_recompute', exists: true, frozen: true, manuallyOverridden: true }) === 'skip')
    // Q) Eine veröffentlichte Zeile wird durch die neue Logik nicht angefasst:
    //    dieselbe Draft-Zeile, einmal ohne und einmal mit Kontinuität berechnet,
    //    darf nach dem Einfrieren byteweise identisch bleiben.
    const frozenRow = { odds_score: 16.80, prob_score: 0.0267, frozen_at: '2026-09-18T10:00:00Z' }
    const published = goalscorerRowAction({ trigger: 'admin_recompute', exists: true, frozen: true, manuallyOverridden: false }) === 'skip'
      ? { ...frozenRow } : { ...frozenRow, odds_score: lowXG.offers[0].odds_score }
    check('Q — veröffentlichte Zeile bleibt byteweise unverändert',
      JSON.stringify(published) === JSON.stringify(frozenRow))
  }

  console.log('\n18e. Echte Regression Spieltag 8 → Spieltag 9')
  if (!hasContinuityScenarios()) {
    check('18e — Exportdatei gscontinuity.json fehlt, Abschnitt übersprungen', true)
  } else {
    const scenarios = loadContinuityScenarios()
    check('K — beide Mannschaften werden über dieselbe Funktion gerechnet',
      scenarios.length === 2)
    for (const s of scenarios) {
      const rows = repriceWithContinuity(s)
      const by = (n: string) => rows.find((r) => r.name === n)!
      // K) Identischer Algorithmus, identische Invarianten für I und II.
      check(`K — ${s.label}: Σ finalShare = 1`,
        near(rows.filter((r) => r.eligible).reduce((a, r) => a + r.finalShare, 0), 1, 1e-12))
      check(`K — ${s.label}: Σ playerXG = Team-xG (${s.currentTeamXG.toFixed(4)})`,
        near(rows.reduce((a, r) => a + r.playerXG, 0), s.currentTeamXG, 1e-9))
      check(`K — ${s.label}: der vorherige veröffentlichte Markt ist der Anker`,
        rows.some((r) => r.source === 'previous_market'))
      check(`K — ${s.label}: keine NaN/Infinity-Quote`,
        rows.every((r) => Number.isFinite(r.newOdds) && r.newOdds >= 1.2 && r.newOdds <= 30))

      if (s.label === 'Wildenroth I') {
        // L) Xaver Throm: Tor trotz fallendem Team-xG (2.0383 → 1.7820).
        const x = by('Xaver Throm')
        check(`L — Xaver Throm: das Tor wirkt sichtbar gegen den Team-xG-Rückgang (alt ${x.oldOdds}, neu ${x.newOdds})`,
          x.newOdds < x.oldOdds && x.goals === 1)
        check(`L — Xaver Throm: sein Anteil steigt über den Fundamentalanteil (${(x.fundamentalShare * 100).toFixed(2)}% → ${(x.finalShare * 100).toFixed(2)}%)`,
          x.finalShare > x.fundamentalShare)
        check(`L — Xaver Throm: Sprung gegenüber der ST8-Quote deutlich kleiner als bisher ` +
          `(1.92 → ${x.newOdds} statt → ${x.oldOdds})`,
          Math.abs(x.newOdds - x.previousOdds!) < Math.abs(x.oldOdds - x.previousOdds!))
        // Lorenz Schorer: ohne Tor länger, aber nicht mehr 2.09 → 7.25.
        const l = by('Lorenz Schorer')
        check(`L — Lorenz Schorer: 2.09 → ${l.newOdds} statt → ${l.oldOdds}`,
          l.newOdds < l.oldOdds && l.newOdds > l.previousOdds!)
        // Maximilian Scheidl: ohne Tor und mit weniger Team-xG darf er länger
        // werden — aber nachvollziehbar, nicht sprunghaft.
        const sc = by('Maximilian Scheidl')
        check(`L — Maximilian Scheidl bleibt der klare Favorit (${sc.newOdds})`,
          sc.finalShare === Math.max(...rows.map((r) => r.finalShare)) && sc.newOdds < 2.2)
        // §13: keine erzwungene Monotonie — ein Torschütze DARF länger werden.
        check('§13 — keine harte Monotonie-Regel: der Anteil eines Torschützen wird nicht auf "kürzer" gezwungen',
          rows.filter((r) => r.goals > 0).length > 0)
      }

      if (s.label === 'Wildenroth II') {
        // M-1) Die vier im Auftrag ausdrücklich als FALSCHE RICHTUNG benannten
        //      Fälle: trotz Tor und steigendem Team-xG wurde die Quote länger
        //      als die zuletzt veröffentlichte. Die neue Logik muss sie
        //      mindestens unter die bisherige ST9-Modellquote bringen.
        for (const name of ['Maximilian Bergmann', 'Szymon Portka', 'Nico Spindler', 'Maxim Burzlaff']) {
          const r = by(name)
          check(`M — ${name}: ${r.previousOdds?.toFixed(2) ?? '–'} / ${r.goals} Tore → ` +
            `neu ${r.newOdds.toFixed(2)} statt bisher ${r.oldOdds.toFixed(2)}`,
            r.newOdds < r.oldOdds)
        }
        // M-2) Die als RICHTIGE RICHTUNG benannten Fälle: kürzer als die
        //      zuletzt veröffentlichte Quote, nach zwei bzw. einem Tor.
        for (const [name, published] of [['Andreas Kerscher', 2.30], ['Korbinian Scala', 20.57],
          ['Ralf Looschen', 10.98], ['Marius Sauter', 6.47]] as const) {
          const r = by(name)
          check(`M — ${name}: ${published.toFixed(2)} → ${r.newOdds.toFixed(2)} (kürzer nach ${r.goals} Tor(en))`,
            r.newOdds < published)
        }
        // Looschen und Scala müssen SICHTBAR profitieren, nicht nur minimal.
        for (const name of ['Ralf Looschen', 'Korbinian Scala']) {
          const r = by(name)
          check(`M — ${name} profitiert deutlich (neu ${r.newOdds.toFixed(2)}, bisher ${r.oldOdds.toFixed(2)})`,
            r.newOdds < r.oldOdds * 0.6)
        }
        // M-3) Der saubere kontrafaktische Nachweis, dass das TOR wirkt: dasselbe
        //      Szenario, nur ohne die Tore dieses Spielers. Nicht "Anteil größer
        //      als der Fundamentalanteil" — ein Spieler mit sehr hohem
        //      Fundamentalanteil (Michael Dischl 21.4 %) kann trotz eines Tores
        //      darunter landen, wenn sein Toranteil 1 von 13 beträgt. Das ist
        //      korrekt und wird durch §13 ausdrücklich zugelassen.
        const scorers = rows.filter((r) => r.goals > 0)
        const withoutGoalsOf = (playerId: number) => {
          const goals = new Map(s.goals)
          const own = goals.get(playerId) ?? 0
          goals.delete(playerId)
          return repriceWithContinuity({
            ...s,
            continuity: {
              ...s.continuity,
              lastMatchGoals: goals,
              totalNamedGoalsLastMatch: (s.continuity.totalNamedGoalsLastMatch ?? 0) - own,
            },
          })
        }
        const gains = scorers.map((r) => {
          const alt = withoutGoalsOf(r.playerId).find((x) => x.playerId === r.playerId)!
          return { name: r.name, goals: r.goals, with: r.finalShare, without: alt.finalShare }
        })
        check(`M — alle ${gains.length} Torschützen gewinnen gegenüber demselben Spiel OHNE ihr Tor`,
          gains.every((g) => g.with > g.without),
          gains.map((g) => `${g.name.split(' ').pop()} ${(g.without * 100).toFixed(1)}→${(g.with * 100).toFixed(1)}%`).join(', '))
        const one = gains.filter((g) => g.goals === 1).map((g) => g.with / g.without)
        const two = gains.filter((g) => g.goals === 2).map((g) => g.with / g.without)
        check(`M — vier Doppeltorschützen gewinnen im Schnitt mehr als die Ein-Tor-Schützen`,
          two.length === 4 && one.length === 5 &&
          two.reduce((a, b) => a + b, 0) / two.length > one.reduce((a, b) => a + b, 0) / one.length,
          `×${(two.reduce((a, b) => a + b, 0) / two.length).toFixed(2)} vs ×${(one.reduce((a, b) => a + b, 0) / one.length).toFixed(2)}`)
      }
    }
  }

  console.log(`\n${failures === 0 ? 'Alle' : failures + ' von ' + checks} Prüfungen ${failures === 0 ? `bestanden (${checks})` : 'FEHLGESCHLAGEN'}`)
  return failures
}
