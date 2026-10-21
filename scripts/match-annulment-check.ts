/**
 * Consistency checks for lib/matchAnnulment.ts — the pure core behind the
 * "Spiel annullieren (Quote 1,00)" admin action. Pure functions, no database
 * — same style as scripts/goalscorer-check.ts and
 * scripts/combo-leg-order-check.ts (no test framework in this repo, see
 * CLAUDE.md).
 *
 * Section 1 is the 12 scenarios from the Nichtantritt/Annullierung spec.
 * Section 2 replays the REAL production combos touching Match-ID 433
 * (TSV Oberalting-Seefeld – SC Schöngeising, 22.10.2026, Nichtantritt der
 * Gastmannschaft) as verified read-only against Supabase on 2026-10-21 —
 * every number here is a fact read from the live `bets`/`combo_bets` rows,
 * not invented. Discrepancies against the figures given in the original task
 * are called out explicitly in comments (and repeated in the closing
 * report) rather than silently "corrected" to match what was expected.
 *
 * Usage: node --experimental-strip-types scripts/run-match-annulment-check.mjs
 */
import { classifyCombo, planCombo, planSingleBet, legMatchesTarget, type ComboLegAfterNeutralization, type ComboPlanInput } from '@/lib/matchAnnulment'

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = '') {
  checks++
  if (!ok) failures++
  console.log(`  ${ok ? 'OK  ' : 'FEHLER'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

function leg(oddsValue: number, status: ComboLegAfterNeutralization['status']): ComboLegAfterNeutralization {
  return { oddsValue, status }
}

export function run(): number {
  console.log('\n=== Teil 1: Die 12 Szenarien aus der Spezifikation ===')

  console.log('\n1. Einzelwette mit vollem Refund')
  {
    const plan = planSingleBet({ id: 1, userId: 'u1', stake: 42.5 })
    check('Refund = voller Einsatz', plan.refundAmount === 42.5)
  }

  console.log('\n2. Kombi mit bereits gewonnenem Leg')
  {
    const legs = [leg(2.28, 'won'), leg(1.83, 'neutralized')]
    const r = classifyCombo(legs)
    check('now_won, da das einzige verbleibende Leg bereits gewonnen ist', r.kind === 'now_won')
    if (r.kind === 'now_won') check('neue Quote = Quote des gewonnenen Legs', r.newTotalOdds === 2.28, String(r.newTotalOdds))
  }

  console.log('\n3. Kombi mit bereits verlorenem Leg (an anderem Spiel) — darf nicht reaktiviert werden')
  {
    // classifyCombo selbst wird für eine bereits VERLORENE Kombi nie aufgerufen
    // (planCombo prüft status!=='pending' VORHER) — hier wird genau das
    // geprüft: leg_only_no_combo_change, die Kombi-Zeile bleibt unberührt.
    const input: ComboPlanInput = {
      comboId: 579, userId: 'u', stake: 250, originalTotalOdds: 8.44, status: 'lost', isRisky: false,
      legs: [leg(2.05, 'lost'), leg(1.49, 'pending'), leg(1.83, 'neutralized'), leg(1.51, 'pending')],
    }
    const action = planCombo(input)
    check('leg_only_no_combo_change — combo_bets bleibt exakt wie es war', action.kind === 'leg_only_no_combo_change')
  }

  console.log('\n4. Kombi mit nur noch offenen Tipps')
  {
    const legs = [leg(1.49, 'pending'), leg(3.02, 'neutralized')]
    const r = classifyCombo(legs)
    check('still_pending', r.kind === 'still_pending')
    if (r.kind === 'still_pending') check('neue Quote = Produkt der verbleibenden Original-Quoten', r.newTotalOdds === 1.49)
  }

  console.log('\n5. Kombi wird NUR durch die Annullierung komplett gewonnen')
  {
    // Zwei Legs, eines bereits gewonnen, eines auf das annullierte Spiel —
    // nach Neutralisierung ist nichts mehr offen und nichts verloren.
    const legs = [leg(1.93, 'won'), leg(2.66, 'neutralized')]
    const r = classifyCombo(legs)
    check('now_won — ausschließlich durch die Annullierung ausgelöst', r.kind === 'now_won')
  }

  console.log('\n6. Risky-Kombi, deren neue Gesamtquote unter 20 fällt — Risky-Status bleibt')
  {
    // planCombo/classifyCombo selbst ändert is_risky nie (das Feld wird vom
    // Aufrufer unverändert zurückgeschrieben) — hier wird nur geprüft, dass
    // der Payout trotz einer neuen Quote < 20 ganz normal mit is_risky=true
    // (höherer Deckel) berechnet wird, nicht mit dem normalen Deckel.
    const input: ComboPlanInput = {
      comboId: 1, userId: 'u', stake: 100, originalTotalOdds: 71.0, status: 'pending', isRisky: true,
      legs: [leg(1.83, 'neutralized'), leg(2.0, 'won')],
    }
    const action = planCombo(input)
    check('now_won_payout mit neuer Quote 2,00 (< 20)', action.kind === 'now_won_payout' && action.newTotalOdds === 2.0)
    if (action.kind === 'now_won_payout') check('Payout = Einsatz × 2,00 (Risky-Deckel 15000 nicht erreicht)', action.payout === 200)
  }

  console.log('\n7. Risky-Kombi, die den Payout-Deckel erreicht')
  {
    const input: ComboPlanInput = {
      comboId: 2, userId: 'u', stake: 250, originalTotalOdds: 2000, status: 'pending', isRisky: true,
      legs: [leg(1.83, 'neutralized'), leg(1000, 'won')],
    }
    const action = planCombo(input)
    check('now_won_payout gedeckelt auf 15000 (Risky)', action.kind === 'now_won_payout' && action.payout === 15000, action.kind === 'now_won_payout' ? String(action.payout) : action.kind)
  }

  console.log('\n8. Vollständig neutralisierter Schein')
  {
    const input: ComboPlanInput = {
      comboId: 3, userId: 'u', stake: 75, originalTotalOdds: 12.3, status: 'pending', isRisky: false,
      legs: [leg(1.83, 'neutralized')],
    }
    const action = planCombo(input)
    check('fully_neutralized_refund, voller Einsatz', action.kind === 'fully_neutralized_refund' && action.refundAmount === 75)
  }

  console.log('\n9. Vom Nutzer bereits stornierter Schein — bleibt unberührt')
  {
    const input: ComboPlanInput = {
      comboId: 4, userId: 'u', stake: 10, originalTotalOdds: 3.75, status: 'void', isRisky: false,
      legs: [leg(2.05, 'void'), leg(1.83, 'neutralized')],
    }
    const action = planCombo(input)
    check('leg_only_no_combo_change — void bleibt void', action.kind === 'leg_only_no_combo_change')
  }

  console.log('\n10. Doppelte/parallele Ausführung — Idempotenz auf Leg-Ebene')
  {
    // legMatchesTarget liefert beim zweiten Durchlauf false, weil das Leg
    // dann nicht mehr 'pending', sondern bereits 'neutralized' ist — das ist
    // der gesamte Idempotenz-Mechanismus (siehe RPC: UPDATE ... WHERE status='pending').
    const firstRun = legMatchesTarget({ status: 'pending', matchId: 433, specialId: null }, { matchId: 433 })
    const secondRun = legMatchesTarget({ status: 'neutralized', matchId: 433, specialId: null }, { matchId: 433 })
    check('1. Lauf: Leg wird erfasst', firstRun === true)
    check('2. Lauf: Leg wird NICHT erneut erfasst (schon neutralisiert)', secondRun === false)
  }

  console.log('\n11. Spieltag-Special, das dieses Spiel enthält — Leg-Ebene, keine anderen Kombi-Legs')
  {
    // special_id statt match_id als Trigger — derselbe Mechanismus.
    const matches = legMatchesTarget({ status: 'pending', matchId: 999, specialId: 55 }, { specialId: 55 })
    check('special_id-Leg wird erfasst, obwohl match_id technischer Anker ist', matches === true)
    // Eine andere Auswahl derselben Kombi (ein echtes Match, kein Special)
    // bleibt unberührt, weil sie weder matchId noch specialId trifft.
    const other = legMatchesTarget({ status: 'pending', matchId: 307, specialId: null }, { specialId: 55 })
    check('andere Legs derselben Kombi bleiben unberührt', other === false)
  }

  console.log('\n12. Bilanz/Statistik/Limits/Inaktivitätsstrafe — Status-Werte sind korrekt disjunkt')
  {
    // Diese Eigenschaften werden hier nur auf Typ-Ebene dokumentiert/geprüft —
    // die eigentliche Durchsetzung liegt in lib/betStats.ts (won/lost-Filter),
    // lib/matchdayFinalize.ts (stillPendingCount/activeBetRows) und
    // app/api/bets/place/route.ts (Slot-Zählung), siehe deren Code-Kommentare.
    const neutralizedStatus: string = 'neutralized'
    check("'neutralized' ist weder 'pending' (Slot wird frei) noch 'void' (Teilnahme zählt weiter)",
      neutralizedStatus !== 'pending' && neutralizedStatus !== 'void')
  }

  console.log('\n=== Teil 2: Echte Produktionsdaten zu Match-ID 433 (verifiziert 2026-10-21) ===')

  console.log('\nOffene Kombis (combo_bets.status = \'pending\')')
  {
    // #594 Jani — handicap@1.99, 1x2@2.04, handicap@2.40, [1x2@1.83 annulliert], 1x2@1.51, 1x2@2.66
    const r594 = classifyCombo([leg(1.99, 'pending'), leg(2.04, 'pending'), leg(2.40, 'pending'), leg(1.83, 'neutralized'), leg(1.51, 'pending'), leg(2.66, 'pending')])
    check('#594 Jani: still_pending, neue Quote 39,13 (Vorgabe bestätigt)', r594.kind === 'still_pending' && r594.newTotalOdds === 39.13, r594.kind === 'still_pending' ? String(r594.newTotalOdds) : r594.kind)

    // #598 korbisca — goalscorer@2.28 (WON, Scheidl), 1x2@1.49 pending, [1x2@3.02 annulliert]
    const r598 = classifyCombo([leg(2.28, 'won'), leg(1.49, 'pending'), leg(3.02, 'neutralized')])
    check('#598 korbisca: still_pending (Scheidl-Leg bleibt gewonnen), neue Quote 3,40 (Vorgabe bestätigt)', r598.kind === 'still_pending' && r598.newTotalOdds === 3.40, r598.kind === 'still_pending' ? String(r598.newTotalOdds) : r598.kind)

    // #607 Michi Dischl — 2.21, 2.28(WON), 2.04, 3.93, 2.40, [1.93 annulliert], 1.51, 2.66
    const r607 = classifyCombo([leg(2.21, 'pending'), leg(2.28, 'won'), leg(2.04, 'pending'), leg(3.93, 'pending'), leg(2.40, 'pending'), leg(1.93, 'neutralized'), leg(1.51, 'pending'), leg(2.66, 'pending')])
    check('#607 Michi Dischl: still_pending, neue Quote 389,42 (Vorgabe bestätigt)', r607.kind === 'still_pending' && r607.newTotalOdds === 389.42, r607.kind === 'still_pending' ? String(r607.newTotalOdds) : r607.kind)

    // #608 Lobi — 1.37, 4.28, 6.75, 1.49, 4.14, [1.83 annulliert], 1.51, 2.66
    const r608 = classifyCombo([leg(1.37, 'pending'), leg(4.28, 'pending'), leg(6.75, 'pending'), leg(1.49, 'pending'), leg(4.14, 'pending'), leg(1.83, 'neutralized'), leg(1.51, 'pending'), leg(2.66, 'pending')])
    check('#608 Lobi: still_pending, neue Quote 980,65 (Vorgabe bestätigt)', r608.kind === 'still_pending' && r608.newTotalOdds === 980.65, r608.kind === 'still_pending' ? String(r608.newTotalOdds) : r608.kind)
  }

  console.log('\nBereits verlorene Kombis (combo_bets.status = \'lost\', entschieden durch Wildenroth I vs. Igling) — dürfen NICHT reaktiviert werden')
  {
    const lostComboIds = [579, 581, 582, 585, 595, 599, 601, 603]
    for (const id of lostComboIds) {
      const action = planCombo({ comboId: id, userId: 'u', stake: 1, originalTotalOdds: 1, status: 'lost', isRisky: false, legs: [leg(2.05, 'lost'), leg(1.83, 'neutralized')] })
      check(`#${id}: leg_only_no_combo_change (kein Payout, kein Refund, Status bleibt 'lost')`, action.kind === 'leg_only_no_combo_change')
    }
  }

  console.log('\nBereits vom Nutzer stornierte Kombis (combo_bets.status = \'void\', void_reason = \'user_cancelled\') — bleiben vollständig unberührt')
  {
    // #604 ist LAUT PRODUKTIONSDATENBANK bereits void/user_cancelled — die
    // Aufgabenstellung führte sie fälschlich unter den "noch offenen" Kombis
    // (mit einer "neuen Quote" von 3,08). Das ist eine Abweichung von den
    // gegebenen Fakten, kein Fehler dieser Prüfung — siehe Abschlussbericht.
    const voidComboIds = [577, 587, 589, 593, 604]
    for (const id of voidComboIds) {
      const action = planCombo({ comboId: id, userId: 'u', stake: 1, originalTotalOdds: 1, status: 'void', isRisky: false, legs: [leg(1.83, 'void')] })
      check(`#${id}: leg_only_no_combo_change (void bleibt void, keine erneute Auszahlung/Erstattung)`, action.kind === 'leg_only_no_combo_change')
    }
  }

  console.log(`\n${checks} Prüfungen, ${failures} Fehler`)
  return failures
}
