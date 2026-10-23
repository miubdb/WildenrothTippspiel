/**
 * Admin-Statistik "Beteiligung & Wettzeiten" (app/admin → Mehr → Statistik,
 * components/admin/StatsTab.tsx, app/api/admin/stats/route.ts) — reine Aggregationslogik aus
 * lib/bettingActivityStats.ts gegen die echte Spieltag-Zuordnung (lib/season.ts), nicht gegen
 * eine Nachbildung.
 */
import { buildEffectiveMatchdayIndex } from '@/lib/season'
import {
  computeMatchdayParticipation, averageRecentParticipation, placementEvents,
  computeHourBuckets, computeWeekdayBuckets, topBucket, type ActivityLeg,
} from '@/lib/bettingActivityStats'
import type { Match } from '@/types'

let errors = 0
let checks = 0
function test(label: string, actual: boolean) {
  checks++
  if (!actual) errors++
  console.log(`${actual ? 'OK' : 'FAIL'}  ${label}`)
}

function m(id: number, matchday: number, dateIso: string, extra: Partial<Match> = {}): Match {
  return {
    id, matchday, match_date: dateIso, status: 'finished', match_category: 'kreisliga',
    is_topspiel: false, tippspiel_matchday: null, competition_type: 'league', home_team_id: 1, away_team_id: 2,
    ...extra,
  } as unknown as Match
}

function runMatchdayParticipation() {
  const matches: Match[] = [
    m(1, 10, '2026-10-02T17:00:00Z'), m(2, 10, '2026-10-03T13:00:00Z'),
    m(3, 11, '2026-10-09T17:00:00Z'),
    // Spieltag 12 läuft noch: ein Spiel beendet, der Rest nicht.
    m(4, 12, '2026-10-16T17:00:00Z'), m(5, 12, '2026-10-23T17:00:00Z', { status: 'scheduled' }),
    // Testspieltag darf nie mitgezählt werden.
    m(6, 999, '2026-09-01T10:00:00Z'),
  ]
  const mdIndex = buildEffectiveMatchdayIndex(matches)
  const matchById = new Map(matches.map((mm) => [mm.id, mm]))
  const legFor = (id: number, matchId: number, userId: string, comboId: number | null, createdAt: string): ActivityLeg =>
    ({ id, user_id: userId, combo_id: comboId, created_at: createdAt, match: matchById.get(matchId) ?? null })

  const legs: ActivityLeg[] = [
    legFor(1, 1, 'u1', null, '2026-10-01T10:00:00Z'),
    legFor(2, 2, 'u1', null, '2026-10-01T10:05:00Z'), // gleicher Nutzer, anderes Spiel, selber Spieltag 10
    legFor(3, 1, 'u2', null, '2026-10-01T11:00:00Z'),
    legFor(4, 3, 'u1', null, '2026-10-08T10:00:00Z'), // Spieltag 11
    legFor(5, 3, 'u3', null, '2026-10-08T10:00:00Z'),
    legFor(6, 4, 'u1', null, '2026-10-15T10:00:00Z'), // Spieltag 12 (laufend)
    legFor(7, 6, 'u1', null, '2026-08-20T10:00:00Z'), // Testspieltag — muss ignoriert werden
  ]

  const participation = computeMatchdayParticipation(legs, mdIndex, 12)
  const byMd = new Map(participation.map((p) => [p.matchday, p]))

  test('Spieltag 10: 2 eindeutige Nutzer (u1 zählt trotz 2 Legs nur einmal)', byMd.get(10)?.users === 2)
  test('Spieltag 10: 3 Tipp-Legs insgesamt', byMd.get(10)?.legs === 3)
  test('Spieltag 11: 2 eindeutige Nutzer', byMd.get(11)?.users === 2)
  test('Spieltag 12 ist als "aktuell/laufend" markiert', byMd.get(12)?.isCurrent === true)
  test('Spieltag 10/11 sind NICHT als laufend markiert', byMd.get(10)?.isCurrent === false && byMd.get(11)?.isCurrent === false)
  test('Testspieltag 999 taucht nicht in der Beteiligungsliste auf', !byMd.has(999))
  test('Ergebnis ist in Anzeige-Reihenfolge sortiert (10, 11, 12)', participation.map((p) => p.matchday).join(',') === '10,11,12')

  const avg = averageRecentParticipation(participation, 6)
  test('Ø ohne den laufenden Spieltag 12: (2+2)/2 = 2', avg === 2)
  test('Ø bei lastN=0 abgeschlossenen Spieltagen ist null, nicht NaN/0', averageRecentParticipation([participation[2]], 6) === null)
}

function runPlacementEventsAndTimeBuckets() {
  const legs: Pick<ActivityLeg, 'id' | 'combo_id' | 'created_at'>[] = [
    // Eine 3er-Kombi: muss als EIN Ereignis zählen (frühester Zeitstempel), nicht drei.
    { id: 1, combo_id: 500, created_at: '2026-10-05T10:00:05.000Z' },
    { id: 2, combo_id: 500, created_at: '2026-10-05T10:00:00.000Z' },
    { id: 3, combo_id: 500, created_at: '2026-10-05T10:00:02.000Z' },
    // Zwei unabhängige Einzeltipps.
    { id: 4, combo_id: null, created_at: '2026-10-06T11:00:00.000Z' },
    { id: 5, combo_id: null, created_at: '2026-10-06T11:30:00.000Z' },
  ]
  const events = placementEvents(legs)
  test('3er-Kombi zählt als genau EIN Platzierungs-Ereignis', events.length === 3)
  test('Kombi-Ereignis nimmt den frühesten Zeitstempel ihrer Legs', events.some((e) => e.created_at === '2026-10-05T10:00:00.000Z'))

  // Europe/Berlin im Oktober = Sommerzeit (UTC+2) bis Ende Oktober, dann UTC+1.
  // 10:00 UTC am 5.10.2026 (vor der Umstellung) → 12:00 Berlin.
  const hours = computeHourBuckets(events)
  const hour12 = hours.find((h) => h.hour === 12)
  test('10:00 UTC (Sommerzeit) wird als 12 Uhr Berlin gezählt, nicht als 10 Uhr UTC', hour12?.count === 1)
  test('Stundenverteilung hat genau 24 Einträge, 0..23', hours.length === 24 && hours[0].hour === 0 && hours[23].hour === 23)

  const weekdays = computeWeekdayBuckets(events)
  test('Wochentag-Verteilung hat genau 7 Einträge, Montag=0..Sonntag=6', weekdays.length === 7 && weekdays[0].weekday === 0 && weekdays[6].weekday === 6)
  // 5.10.2026 ist ein Montag.
  test('5.10.2026 (Kombi-Event) wird als Montag (Index 0) gezählt', weekdays[0].count === 1)
  // 6.10.2026 ist ein Dienstag, 2 Einzeltipps.
  test('6.10.2026 (2 Einzeltipps) wird als Dienstag (Index 1) gezählt', weekdays[1].count === 2)

  // 11:00/11:30 UTC am 6.10.2026 (noch Sommerzeit, UTC+2) → 13:00/13:30 Berlin → Stunde 13, 2 Treffer.
  const topHourBucket = topBucket(hours)
  test('topBucket findet die Stunde mit den meisten Platzierungen (13 Uhr, 2 Treffer)', topHourBucket?.hour === 13 && topHourBucket.count === 2)
  test('topBucket auf leerem Array liefert null, nicht undefined/Fehler', topBucket([]) === null)
}

export function run(): number {
  runMatchdayParticipation()
  runPlacementEventsAndTimeBuckets()
  console.log(`${checks - errors}/${checks} tests passed`)
  return errors
}
