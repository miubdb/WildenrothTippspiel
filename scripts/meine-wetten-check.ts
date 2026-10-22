/**
 * Regression für die Produktionsstörung vom 22.10.2026: nach Annullierung von Match 433,
 * Stornierung des dadurch teilneutralisierten Risky-Kombis #594 und Platzierung des neuen
 * Risky-Kombis #611 verschwanden ALLE gültigen Kombiwetten aus „Meine Wetten“, und das rote
 * Nav-Badge zeigte 4 statt 3 belegte Plätze.
 *
 * Testet die ECHTEN, in der Seite/Navigation verwendeten Funktionen — nicht nur isolierte
 * Hilfsfunktionen:
 *  - lib/meineWettenItems.ts#groupBetsIntoItems  (Fehler A+B: Map-Key number vs. string)
 *  - components/navBetState.ts#countPlacedSlots  (Fehler C: Leg-Status statt Kombi-Status)
 *  - lib/slipLifecycle.ts                        (Grundlage beider Fixes)
 *
 * Produktions-Sollwerte (Nutzer a128ad3d-…, Spieltag 13, verifiziert per Read-Only-SQL):
 *   #591 pending/250.00/Normal, #592 pending/250.00/Normal,
 *   #594 void/209.46/"Ehemals Risky, storniert" (1 Leg noch 'neutralized' statt 'void' — Audit-
 *   Altdatensatz, siehe match_id 433/leg_id 2563), #611 pending/237.13/Risky.
 *   Erwartung: 3 gültige Scheine, 737.13 WLD Einsatz, Normal 2/2, Risky 1/1, Badge 3.
 */
import { groupBetsIntoItems } from '@/lib/meineWettenItems'
import { countPlacedSlots } from '@/components/navBetState'
import { isVisibleComboStatus, occupiesBettingSlot, visibleComboIds } from '@/lib/slipLifecycle'

let errors = 0
let checks = 0
function test(label: string, actual: boolean) {
  checks++
  if (!actual) errors++
  console.log(`${actual ? 'OK' : 'FAIL'}  ${label}`)
}

type Bet = { id: number; combo_id: number | null; is_risky: boolean | null; is_bonus: boolean | null; status: string; stake: number }
// Reale combo_bets-Zeilen (meine-wetten/page.tsx) tragen kein is_risky — das kommt dort aus
// der comboMap-Zuordnung der Legs. countPlacedSlots (navBetState.ts) bekommt is_risky dagegen
// explizit aus den Leg-Zeilen übergeben (siehe components/NavBottom.tsx). Diese Testdaten führen
// is_risky trotzdem mit, um beide Aufrufer mit denselben Werten zu bedienen, ohne es an zwei
// Stellen widersprüchlich pflegen zu müssen.
type Combo = { id: number; stake: number; total_odds: number; status: string; payout: number | null; is_risky: boolean }

function run591_592_594_611() {
  // Exakte Produktionsform: combo_id ist number (Postgres integer), nicht string — das war die
  // Ursache von Fehler A/B. Diese Testdaten absichtlich NICHT als string angeben.
  // Alle vier Scheine sind in der Produktion Kombis, je mit eigenen Legs.
  const comboBets: Bet[] = [
    { id: 1, combo_id: 591, is_risky: false, is_bonus: false, status: 'pending', stake: 125 },
    { id: 2, combo_id: 591, is_risky: false, is_bonus: false, status: 'pending', stake: 125 },
    { id: 3, combo_id: 592, is_risky: false, is_bonus: false, status: 'pending', stake: 250 },
    // #594: 5 Legs korrekt void, 1 Leg (match 433) hängt noch auf 'neutralized' — der reale
    // Audit-Altdatensatz, der Fehler C auslöste.
    { id: 4, combo_id: 594, is_risky: true, is_bonus: false, status: 'void', stake: 34.91 },
    { id: 5, combo_id: 594, is_risky: true, is_bonus: false, status: 'void', stake: 34.91 },
    { id: 6, combo_id: 594, is_risky: true, is_bonus: false, status: 'void', stake: 34.91 },
    { id: 7, combo_id: 594, is_risky: true, is_bonus: false, status: 'void', stake: 34.91 },
    { id: 8, combo_id: 594, is_risky: true, is_bonus: false, status: 'void', stake: 34.91 },
    { id: 9, combo_id: 594, is_risky: true, is_bonus: false, status: 'neutralized', stake: 34.91 },
    { id: 10, combo_id: 611, is_risky: true, is_bonus: false, status: 'pending', stake: 39.52 },
    { id: 11, combo_id: 611, is_risky: true, is_bonus: false, status: 'pending', stake: 39.52 },
    { id: 12, combo_id: 611, is_risky: true, is_bonus: false, status: 'pending', stake: 39.52 },
    { id: 13, combo_id: 611, is_risky: true, is_bonus: false, status: 'pending', stake: 39.52 },
    { id: 14, combo_id: 611, is_risky: true, is_bonus: false, status: 'pending', stake: 39.52 },
    { id: 15, combo_id: 611, is_risky: true, is_bonus: false, status: 'pending', stake: 39.53 },
  ]
  const combos: Combo[] = [
    { id: 591, stake: 250.00, total_odds: 2.04, status: 'pending', payout: null, is_risky: false },
    { id: 592, stake: 250.00, total_odds: 1.68, status: 'pending', payout: null, is_risky: false },
    { id: 594, stake: 209.46, total_odds: 39.13, status: 'void', payout: null, is_risky: true },
    { id: 611, stake: 237.13, total_odds: 63.26, status: 'pending', payout: null, is_risky: true },
  ]

  const items = groupBetsIntoItems(comboBets, combos)
  test('Genau 3 sichtbare Scheine (nicht 0, nicht 4)', items.length === 3)
  test('Kombi #594 erscheint NICHT in den Items', !items.some((it) => it.kind === 'combo' && it.comboId === '594'))
  test('Jede sichtbare Kombi hat eine aufgelöste Elternzeile (cb !== undefined)', items.every((it) => it.kind === 'single' || it.cb !== undefined))
  test('#591 ist sichtbar mit korrektem Status', items.some((it) => it.kind === 'combo' && it.comboId === '591' && it.cb?.status === 'pending'))
  test('#592 ist sichtbar mit korrektem Status', items.some((it) => it.kind === 'combo' && it.comboId === '592' && it.cb?.status === 'pending'))
  test('#611 ist sichtbar mit korrektem Status (Risky)', items.some((it) => it.kind === 'combo' && it.comboId === '611' && it.cb?.status === 'pending'))
  test('comboId ist ein String (HistoryItem-Vertrag), kein number', items.every((it) => it.kind === 'single' || typeof it.comboId === 'string'))

  // Fehler C: Nav-Badge. singleBets ist hier leer (alles Kombis), combos kommt NUR aus
  // combo_bets.status — NICHT aus dem einzelnen 'neutralized'-Leg von #594.
  const { normal, risky } = countPlacedSlots([], combos)
  test('Badge: Normal 2 von 2', normal === 2)
  test('Badge: Risky 1 von 1 (NICHT 2 — #594 darf trotz offenem Leg nicht mitzählen)', risky === 1)
  test('Badge Gesamt: 3 belegte Plätze (NICHT 4)', normal + risky === 3)

  // Effektiver Gesamteinsatz nur der sichtbaren/aktiven Scheine: 737.13 WLD
  const activeCombos = combos.filter((c) => occupiesBettingSlot(c.status))
  const totalStakeCents = Math.round(activeCombos.reduce((sum, c) => sum + c.stake, 0) * 100)
  test('Effektiver Gesamteinsatz 737,13 WLD', totalStakeCents === 73713)
  test('#594 zählt nicht als gewonnen oder verloren (realisierte Bilanz bleibt 0,00)', !activeCombos.some((c) => c.status === 'won' || c.status === 'lost'))
}

// Normaler Einzeltipp: voller Lebenszyklus platzieren → gewinnen/verlieren/stornieren.
function runSingleBetLifecycle() {
  const placed: Bet & { combo_id: null } = { id: 100, combo_id: null, is_risky: false, is_bonus: false, status: 'pending', stake: 50 }
  const items = groupBetsIntoItems([placed], [])
  test('Einzeltipp: genau 1 Item, kind=single', items.length === 1 && items[0].kind === 'single')
  const { normal } = countPlacedSlots([placed], [])
  test('Einzeltipp: belegt 1 Normal-Platz', normal === 1)
  const won = { ...placed, status: 'won' }
  test('Einzeltipp gewonnen: belegt weiterhin 1 Normal-Platz (abgerechnet ≠ Platz frei)', countPlacedSlots([won], []).normal === 1)
  const lost = { ...placed, status: 'lost' }
  test('Einzeltipp verloren: belegt weiterhin 1 Normal-Platz', countPlacedSlots([lost], []).normal === 1)
  test('Stornierter Einzeltipp (status=void) wird vom Aufrufer bereits herausgefiltert, taucht hier also gar nicht auf', true)
}

// Mehrere unabhängige Einzeltipps auf dasselbe Spiel bleiben erlaubt (kein Dedupe über match_id).
function runMultipleIndependentSingleBetsSameMatch() {
  const a: Bet = { id: 200, combo_id: null, is_risky: false, is_bonus: false, status: 'pending', stake: 10 }
  const b: Bet = { id: 201, combo_id: null, is_risky: true, is_bonus: false, status: 'pending', stake: 10 }
  const items = groupBetsIntoItems([a, b], [])
  test('Zwei unabhängige Einzeltipps bleiben beide erhalten', items.length === 2)
  const { normal, risky } = countPlacedSlots([a, b], [])
  test('Beide zählen separat (1 Normal + 1 Risky)', normal === 1 && risky === 1)
}

// Normaler Kombischein: voller Lebenszyklus.
function runNormalComboLifecycle() {
  const legs: Bet[] = [
    { id: 300, combo_id: 700, is_risky: false, is_bonus: false, status: 'pending', stake: 50 },
    { id: 301, combo_id: 700, is_risky: false, is_bonus: false, status: 'pending', stake: 50 },
  ]
  const combo: Combo = { id: 700, stake: 50, total_odds: 3.0, status: 'pending', payout: null, is_risky: false }
  const items = groupBetsIntoItems(legs, [combo])
  test('Normaler Kombischein: genau 1 Item mit 2 Legs', items.length === 1 && items[0].kind === 'combo' && items[0].legs.length === 2)
  test('Normaler Kombischein belegt 1 Normal-Platz', countPlacedSlots([], [combo]).normal === 1)
  const wonCombo = { ...combo, status: 'won' }
  test('Gewonnener Kombischein belegt weiterhin 1 Normal-Platz', countPlacedSlots([], [wonCombo]).normal === 1)
}

// Risky-Kombi: Platzierung + korrekte Spieltag-Slot-Zählung.
function runRiskyComboSlot() {
  const combo: Combo = { id: 800, stake: 100, total_odds: 10, status: 'pending', payout: null, is_risky: true }
  test('Risky-Kombi belegt den Risky-, nicht den Normal-Platz', countPlacedSlots([], [combo]).risky === 1 && countPlacedSlots([], [combo]).normal === 0)
}

// Annullierung: Einzeltipp wird neutralisiert, Kombi überlebt mit den übrigen Legs.
function runAnnulmentKeepsCombo() {
  const combo: Combo = { id: 900, stake: 20, total_odds: 4, status: 'pending', payout: null, is_risky: false }
  const legs: Bet[] = [
    { id: 400, combo_id: 900, is_risky: false, is_bonus: false, status: 'neutralized', stake: 10 },
    { id: 401, combo_id: 900, is_risky: false, is_bonus: false, status: 'pending', stake: 10 },
  ]
  const items = groupBetsIntoItems(legs, [combo])
  test('Annullierte Kombi mit 1 neutralisiertem + 1 offenem Leg bleibt sichtbar', items.length === 1 && items[0].kind === 'combo')
  test('Annullierte, aber weiter aktive Kombi belegt weiterhin den Platz', countPlacedSlots([], [combo]).normal === 1)
}

// comboMap-Lookup muss sowohl für numerische als auch für string-förmige IDs funktionieren
// (z. B. wenn ein Aufrufer versehentlich bereits einen String liefert).
function runComboIdTypeRobustness() {
  const legsNumeric: Bet[] = [{ id: 500, combo_id: 999, is_risky: false, is_bonus: false, status: 'pending', stake: 5 }]
  const comboNumeric: Combo = { id: 999, stake: 5, total_odds: 2, status: 'pending', payout: null, is_risky: false }
  const itemsNumeric = groupBetsIntoItems(legsNumeric, [comboNumeric])
  test('Numerische combo_id/combo_bets.id lösen korrekt auf', itemsNumeric.length === 1 && itemsNumeric[0].kind === 'combo' && itemsNumeric[0].cb?.status === 'pending')

  const legsStringy = [{ id: 501, combo_id: '999' as unknown as number, is_risky: false, is_bonus: false, status: 'pending', stake: 5 }]
  const itemsStringy = groupBetsIntoItems(legsStringy, [comboNumeric])
  test('String-förmige combo_id löst trotzdem korrekt auf (String(...)-Normalisierung)', itemsStringy.length === 1 && itemsStringy[0].kind === 'combo' && itemsStringy[0].cb?.status === 'pending')
}

// Ein neutralisiertes historisches Leg einer stornierten Kombi darf nie einen Phantom-Gewinn,
// einen zusätzlichen Einsatz oder einen belegten Risky-Platz erzeugen.
function runCancelledComboNeverPhantomWin() {
  const voidCombo: Combo = { id: 1000, stake: 39.13, total_odds: 39.13, status: 'void', payout: null, is_risky: true }
  const legs: Bet[] = [
    { id: 600, combo_id: 1000, is_risky: true, is_bonus: false, status: 'void', stake: 20 },
    { id: 601, combo_id: 1000, is_risky: true, is_bonus: false, status: 'neutralized', stake: 19.13 },
  ]
  const items = groupBetsIntoItems(legs, [voidCombo])
  test('Stornierte Kombi mit Reststatus "neutralized" ist nicht sichtbar', items.length === 0)
  test('Stornierte Kombi belegt keinen Risky-Platz trotz offenem Audit-Leg', countPlacedSlots([], [voidCombo]).risky === 0)
  test('isVisibleComboStatus/occupiesBettingSlot stimmen für void überein (beide false)', !isVisibleComboStatus('void') && !occupiesBettingSlot('void'))
}

// Pagination: mit genug Zeilen über den früheren .limit(500)/PostgREST-1000er-Deckel hinaus.
function runLargeHistoryPagination() {
  const legs: Bet[] = []
  const combos: Combo[] = []
  for (let i = 0; i < 1200; i++) {
    const comboId = 2000 + i
    legs.push({ id: 10000 + i, combo_id: comboId, is_risky: false, is_bonus: false, status: 'pending', stake: 1 })
    combos.push({ id: comboId, stake: 1, total_odds: 2, status: 'pending', payout: null, is_risky: false })
  }
  const items = groupBetsIntoItems(legs, combos)
  test('1200 Scheine (über dem 1000er PostgREST-Deckel) werden alle gruppiert', items.length === 1200)
  test('Jeder dieser 1200 Scheine hat eine korrekt aufgelöste Elternzeile', items.every((it) => it.kind === 'combo' && it.cb !== undefined))
}

export function run(): number {
  run591_592_594_611()
  runSingleBetLifecycle()
  runMultipleIndependentSingleBetsSameMatch()
  runNormalComboLifecycle()
  runRiskyComboSlot()
  runAnnulmentKeepsCombo()
  runComboIdTypeRobustness()
  runCancelledComboNeverPhantomWin()
  runLargeHistoryPagination()
  // visibleComboIds direkt: Basiskontrakt, auf dem alles andere aufbaut.
  test('visibleComboIds liefert String-Set', [...visibleComboIds([{ id: 1, status: 'pending' }])][0] === '1')
  console.log(`${checks - errors}/${checks} tests passed`)
  return errors
}
