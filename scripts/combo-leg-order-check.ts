/**
 * Consistency checks for `sortComboLegsChronologically` (lib/betDisplay.ts) —
 * the shared DISPLAY-ONLY ordering used by "Meine Wetten" (components/MyBets.tsx),
 * Wetthistorie (components/BetHistoryWithCancel.tsx) and "Alle Tipps"
 * (app/(app)/leaderboard/LeaderboardClient.tsx) to show a combo's legs by real
 * kickoff time instead of the order they were selected/stored in.
 *
 * Pure function, no database — these are plain in-memory assertions, same
 * style as scripts/goalscorer-check.ts (no test framework in this repo, see
 * CLAUDE.md).
 *
 * Usage: node --experimental-strip-types scripts/run-combo-leg-order-check.mjs
 */
import { sortComboLegsChronologically, type ComboLegSortKey } from '@/lib/betDisplay'

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = '') {
  checks++
  if (!ok) failures++
  console.log(`  ${ok ? 'OK  ' : 'FEHLER'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

type Leg = { id: number; matchId: number; marketType: string; kickoff: string | null; label: string }

function leg(id: number, matchId: number, kickoff: string | null, label: string, marketType = '1x2'): Leg {
  return { id, matchId, marketType, kickoff, label }
}

const keyOf = (l: Leg): ComboLegSortKey => ({
  kickoff: l.marketType === 'matchday_special' ? null : l.kickoff,
  matchId: l.matchId,
  legId: l.id,
})

export function run(): number {
  console.log('\n1. Legs in falscher Auswahlreihenfolge werden chronologisch sortiert')
  {
    // Sonntag zuerst angeklickt, dann Mittwoch, dann Samstag — genau das
    // Beispiel aus der Spezifikation.
    const sunday = leg(1, 101, '2026-10-25T13:00:00Z', 'Sonntag')
    const wednesday = leg(2, 102, '2026-10-21T18:00:00Z', 'Mittwoch')
    const saturday = leg(3, 103, '2026-10-24T13:00:00Z', 'Samstag')
    const selectionOrder = [sunday, wednesday, saturday]
    const sorted = sortComboLegsChronologically(selectionOrder, keyOf)
    check('Ergebnis ist Mittwoch, Samstag, Sonntag',
      sorted.map((l) => l.label).join(', ') === 'Mittwoch, Samstag, Sonntag',
      sorted.map((l) => l.label).join(', '))
  }

  console.log('\n2. Gleiche Anstoßzeit → stabile, deterministische Sortierung')
  {
    const a = leg(5, 200, '2026-10-24T13:00:00Z', 'A (match 200)')
    const b = leg(6, 100, '2026-10-24T13:00:00Z', 'B (match 100, leg-id 6)')
    const c = leg(7, 100, '2026-10-24T13:00:00Z', 'C (match 100, leg-id 7)')
    // Absichtlich in zufälliger Reihenfolge übergeben.
    const run1 = sortComboLegsChronologically([a, b, c], keyOf)
    const run2 = sortComboLegsChronologically([c, a, b], keyOf)
    check('bei identischer Anstoßzeit entscheidet zuerst match_id, dann leg-id',
      run1[0].label.startsWith('B') && run1[1].label.startsWith('C') && run1[2].label.startsWith('A'))
    check('die Reihenfolge ist unabhängig von der Eingabereihenfolge identisch (deterministisch)',
      JSON.stringify(run1.map((l) => l.id)) === JSON.stringify(run2.map((l) => l.id)))
  }

  console.log('\n3. Fehlende Kickoff-Zeit: kein Crash, bekannte Spiele zuerst')
  {
    const known1 = leg(10, 300, '2026-10-21T18:00:00Z', 'bekannt früh')
    const known2 = leg(11, 301, '2026-10-24T13:00:00Z', 'bekannt spät')
    const unknownA = leg(12, 302, null, 'unbekannt A')
    const unknownB = leg(13, 303, null, 'unbekannt B')
    let sorted: Leg[] = []
    let threw = false
    try {
      sorted = sortComboLegsChronologically([unknownB, known2, unknownA, known1], keyOf)
    } catch {
      threw = true
    }
    check('wirft keinen Fehler', !threw)
    check('bekannte Kickoff-Zeiten stehen vorne, chronologisch',
      sorted[0]?.label === 'bekannt früh' && sorted[1]?.label === 'bekannt spät')
    check('unbekannte Zeiten stehen danach, deterministisch über match_id',
      sorted[2]?.label === 'unbekannt A' && sorted[3]?.label === 'unbekannt B')
  }

  console.log('\n4. Eingabe-Array wird nicht mutiert')
  {
    const original = [
      leg(21, 400, '2026-10-25T13:00:00Z', 'Sonntag'),
      leg(22, 401, '2026-10-21T18:00:00Z', 'Mittwoch'),
    ]
    const snapshotIds = original.map((l) => l.id)
    const snapshotRefs = [...original]
    const sorted = sortComboLegsChronologically(original, keyOf)
    check('combo.legs behält seine ursprüngliche Reihenfolge',
      original.map((l) => l.id).join(',') === snapshotIds.join(','))
    check('combo.legs ist nicht dasselbe Array-Objekt wie das Ergebnis', sorted !== original)
    check('die Original-Objekte selbst wurden nicht verändert',
      original.every((l, i) => l === snapshotRefs[i]))
  }

  console.log('\n5. Spieltag-Special: technischer Anchor (representative_match_id) verfälscht die Reihenfolge nicht')
  {
    // Die Special-Zeile trägt zwar früh am Montag einen match_id-Anchor, ist
    // aber inhaltlich kein echtes Spiel mit eigener Anstoßzeit — sie darf
    // echten Spielen mit bekannter Zeit nicht vorgezogen werden, und die
    // echten Spiel-Legs müssen trotzdem eindeutig chronologisch bleiben.
    const special = leg(30, 500, '2026-10-19T10:00:00Z', 'Spieltag-Special', 'matchday_special')
    const wednesday = leg(31, 501, '2026-10-21T18:00:00Z', 'Mittwoch')
    const saturday = leg(32, 502, '2026-10-24T13:00:00Z', 'Samstag')
    const sorted = sortComboLegsChronologically([saturday, special, wednesday], keyOf)
    check('echte Spiele bleiben chronologisch: Mittwoch vor Samstag',
      sorted.findIndex((l) => l.label === 'Mittwoch') < sorted.findIndex((l) => l.label === 'Samstag'))
    check('das Special landet nicht vor den echten Spielen (sein Anchor-Datum zählt nicht)',
      sorted[sorted.length - 1].label === 'Spieltag-Special')
  }


  console.log('\n6. Alle Tipps: Nachholspiel zuerst auch bei späterer Tippabgabe')
  {
    // George-Screenshot: Auswahl-/DB-Reihenfolge Oberalting, Landsberg,
    // Adelshofen, Wildenroth–Igling. Der reale Anpfiff entscheidet!
    const clicked = [
      leg(401, 433, '2026-10-22T17:00:00Z', 'Oberalting–Schöngeising (annulliert)'),
      leg(402, 422, '2026-10-23T17:00:00Z', 'Landsberg–Altenstadt'),
      leg(403, 999, '2026-10-24T12:00:00Z', 'weiteres Samstagsspiel'),
      leg(404, 307, '2026-10-21T17:30:00Z', 'Wildenroth–Igling (Nachholspiel)'),
    ]
    const sorted = sortComboLegsChronologically(clicked, keyOf)
    check('Nachholspiel vom Mittwoch steht vor annulliertem Donnerstagsspiel und späteren Spielen',
      sorted.map(l => l.matchId).join(',') === '307,433,422,999')
    check('keine Daten-/Tipp-Reihenfolge verändert',
      clicked.map(l => l.matchId).join(',') === '433,422,999,307')
  }

  console.log(`\n${failures === 0 ? 'Alle' : failures + ' von ' + checks} Prüfungen ${failures === 0 ? `bestanden (${checks})` : 'FEHLGESCHLAGEN'}`)
  return failures
}
