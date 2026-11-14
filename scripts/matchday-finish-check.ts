/**
 * Postponed-match settlement gate — pure regression tests.
 *
 * The financial and sporting data must stay untouched when an admin marks
 * a game postponed, but the rest of the matchday should still finalize.
 * Run: node --experimental-strip-types scripts/run-matchday-finish-check.mjs
 */
import {
  areCurrentMatchdayMatchesFinished,
  canFinalizeMatchday,
  isPendingBetBlockingFinalization,
  type CompletionMatch,
  type CompletionPendingBet,
  type CompletionSpecial,
} from '@/lib/matchdayFinishReadiness'
import { buildEffectiveMatchdayIndex, effectiveMatchdayOf } from '@/lib/season'
import { computeMatchdayParticipation } from '@/lib/bettingActivityStats'
import { buildSlips, type RecapBetRow, type RecapComboRow, type RecapMatchRow } from '@/lib/recap/slips'
import type { Match } from '@/types'

let checks = 0
let failures = 0
function test(name: string, result: boolean): void {
  checks += 1
  if (!result) failures += 1
  console.log(`  ${result ? 'OK    ' : 'FEHLER'} ${name}`)
}

const game = (id: number, status: string): CompletionMatch => ({ id, status })
const bet = (match_id: number, status = 'pending', special_id: number | null = null, market_type = '1x2'): CompletionPendingBet =>
  ({ match_id, status, special_id, market_type })

export function run(): number {
  console.log('\n=== Spieltag mit verschobenem Spiel: Abschluss-Gates ===')

  const matchday = [game(413, 'finished'), game(421, 'finished'), game(260, 'postponed')]
  const allMatches = [...matchday, game(800, 'scheduled')]

  test('Alle normalen Spiele beendet, ein Spiel verschoben -> Abschluss möglich',
    areCurrentMatchdayMatchesFinished(matchday))
  test('15 offene Tipps auf das verschobene Match #260 blockieren nicht',
    canFinalizeMatchday(matchday, Array.from({ length: 15 }, () => bet(260)), allMatches))
  test('Normale Kombi mit anderen bereits entschiedenen Legs und nur #260 pending blockiert nicht',
    canFinalizeMatchday(matchday, [bet(260), bet(413, 'won')], allMatches))
  test('PENDING Torschützen-Tipp auf regulär beendetes Spiel blockiert weiterhin',
    !canFinalizeMatchday(matchday, [bet(260), bet(413, 'pending', null, 'goalscorer')], allMatches))
  test('PENDING Einzelwette auf regulär beendetes Spiel blockiert weiterhin',
    !canFinalizeMatchday(matchday, [bet(421)], allMatches))
  test('Noch laufendes reguläres Spiel blockiert auch bei verschobener Partie',
    !canFinalizeMatchday([game(413, 'finished'), game(421, 'scheduled'), game(260, 'postponed')], [bet(260)], allMatches))
  test('Alle Spiele verschoben -> kein vorzeitiger Spieltagabschluss',
    !canFinalizeMatchday([game(260, 'postponed')], [bet(260)], [game(260, 'postponed')]))
  test('Endgültig annullierte Partie blockiert bei offenen Legacy-Legs nicht',
    canFinalizeMatchday([game(413, 'finished'), game(260, 'annulled')], [bet(260)], [game(413, 'finished'), game(260, 'annulled')]))
  test('Nachholspiel wieder angesetzt -> noch nicht erneut abgeschlossen',
    !canFinalizeMatchday([game(413, 'finished'), game(260, 'scheduled')], [bet(260)], [game(413, 'finished'), game(260, 'scheduled')]))
  test('Nachholspiel beendet, aber Tipp noch nicht abgerechnet -> weiterhin warten',
    !canFinalizeMatchday([game(413, 'finished'), game(260, 'finished')], [bet(260)], [game(413, 'finished'), game(260, 'finished')]))
  test('Nachholspiel und alle Wetten abgerechnet -> Abschluss wieder möglich',
    canFinalizeMatchday([game(413, 'finished'), game(260, 'finished')], [], [game(413, 'finished'), game(260, 'finished')]))

  const specialBet = bet(413, 'pending', 77, 'matchday_special')
  const special: CompletionSpecial = { id: 77, included_match_ids: [413, 260] }
  test('Special mit verschobenem tatsächlichem Spiel blockiert nicht',
    canFinalizeMatchday(matchday, [specialBet], allMatches, [special]))
  test('Special mit verschobenem Repräsentations-Match, aber ohne verschobenes INCLUDED-Spiel blockiert',
    !canFinalizeMatchday(matchday, [bet(260, 'pending', 88, 'matchday_special')], allMatches,
      [{ id: 88, included_match_ids: [413, 421] }]))
  test('Special mit ausschließlich fertig gespielten Spielen muss abgerechnet sein',
    !canFinalizeMatchday(matchday, [specialBet], allMatches, [{ id: 77, included_match_ids: [413, 421] }]))
  test('Unbekannte Special-ID wird niemals still ignoriert',
    !canFinalizeMatchday(matchday, [specialBet], allMatches))
  test('Unbekannte Included-Match-ID wird niemals still ignoriert',
    !canFinalizeMatchday(matchday, [specialBet], allMatches, [{ id: 77, included_match_ids: [413, 99999] }]))
  test('Unbekannte direkte Match-ID wird niemals still ignoriert',
    isPendingBetBlockingFinalization(bet(99999), new Map(allMatches.map(m => [m.id, m])), new Map()))
  test('Entschiedene oder stornierte Tipps zählen unabhängig vom Matchstatus nicht als pending',
    canFinalizeMatchday(matchday, [bet(413, 'won'), bet(260, 'void'), bet(421, 'lost')], allMatches))

  console.log('\n=== Eingefrorener Wettspieltag trotz Nachholspiel ===')
  const originalKickoff = '2026-11-15T12:00:00.000Z'
  const makeupKickoff = '2027-03-17T18:00:00.000Z'
  const fixtures = [
    { id: 413, matchday: 16, match_date: '2026-11-13T18:45:00Z', match_category: 'kreisliga', status: 'finished' },
    { id: 421, matchday: 16, match_date: '2026-11-14T12:00:00Z', match_category: 'kreisliga', status: 'finished' },
    { id: 260, matchday: 16, match_date: makeupKickoff, match_category: 'kreisliga', status: 'postponed' },
    { id: 323, matchday: 16, match_date: makeupKickoff, match_category: 'kreisliga', status: 'postponed' },
    { id: 329, matchday: 19, match_date: '2027-03-13T12:00:00Z', match_category: 'kreisliga', status: 'scheduled' },
    { id: 314, matchday: 19, match_date: '2027-03-14T14:00:00Z', match_category: 'kreisliga', status: 'scheduled' },
    { id: 318, matchday: 19, match_date: '2027-03-14T14:00:00Z', match_category: 'kreisliga', status: 'scheduled' },
  ] as unknown as RecapMatchRow[]
  const mdIndex = buildEffectiveMatchdayIndex(fixtures as unknown as Match[])
  test('Denklingen ist für die Spielanzeige am März-Spieltag 19',
    effectiveMatchdayOf(fixtures[3] as unknown as Match, mdIndex) === 19)
  const own = (id: number, matchId: number, comboId: number | null, placedMd: number, kickoff: string): RecapBetRow => ({
    id, user_id: 'alice', match_id: matchId, market_type: '1x2', selection: 'home',
    stake: comboId == null ? 10 : null, odds_value: 2, status: 'pending', payout: null, combo_id: comboId,
    created_at: '2026-11-14T12:00:00Z', is_risky: false, season: '26/27', is_bonus: false,
    void_reason: null, special_id: null, placed_matchday: placedMd, placed_kickoff_at: kickoff,
  })
  const single = own(1, 323, null, 16, originalKickoff)
  const comboLegA = own(2, 323, 77, 16, originalKickoff)
  const comboLegB = own(3, 413, 77, 16, '2026-11-13T18:45:00Z')
  const cb: RecapComboRow = {
    id: 77, user_id: 'alice', stake: 30, total_odds: 4, status: 'pending', payout: null,
    created_at: '2026-11-14T12:00:00Z', season: '26/27',
    void_reason: null, original_total_odds: null, placed_matchday: 16,
  }
  const { slips } = buildSlips({ bets: [single, comboLegA, comboLegB], combos: [cb], matches: fixtures })
  test('Verschobene Einzelwette bleibt ihrem ursprünglichen Spieltag 16 zugeordnet',
    slips.find(x => x.key === 's1')?.ownerMatchday === 16)
  test('Verschobene Kombi gehört unveränderlich zu Spieltag 16',
    slips.find(x => x.key === 'c77')?.ownerMatchday === 16)
  test('Originaler November-Anpfiff bleibt für Einzelwetten erhalten',
    slips.find(x => x.key === 's1')?.firstKickoffMs === Date.parse(originalKickoff))
  test('Originaler frühester November-Anpfiff bleibt für Kombis erhalten',
    slips.find(x => x.key === 'c77')?.firstKickoffMs === Date.parse('2026-11-13T18:45:00Z'))
  const part = computeMatchdayParticipation([
    { id: 1, user_id: 'alice', combo_id: null, created_at: single.created_at,
      match: fixtures[3] as Match, placed_matchday: 16, status: 'pending' },
    { id: 2, user_id: 'alice', combo_id: 77, created_at: single.created_at,
      match: fixtures[3] as Match, placed_matchday: 16, status: 'pending' },
    { id: 3, user_id: 'alice', combo_id: null, created_at: single.created_at,
      match: fixtures[3] as Match, placed_matchday: 19, status: 'pending' },
    { id: 4, user_id: 'alice', combo_id: null, created_at: single.created_at,
      match: fixtures[3] as Match, placed_matchday: 16, status: 'void' },
  ], mdIndex, 19)
  test('Alte November-Wetten sind nur Teilnahme an ST16', part.find(p => p.matchday === 16)?.legs === 2)
  test('Neue März-Wette ist nur Teilnahme an ST19', part.find(p => p.matchday === 19)?.legs === 1)
  test('Nutzerstorno zählt nicht mehr als Teilnahme', part.reduce((sum, p) => sum + p.legs, 0) === 3)

  console.log(`\n${checks} Prüfungen, ${failures} Fehler.`)
  return failures
}
