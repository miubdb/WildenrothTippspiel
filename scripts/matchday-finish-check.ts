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

  console.log(`\n${checks} Prüfungen, ${failures} Fehler.`)
  return failures
}
