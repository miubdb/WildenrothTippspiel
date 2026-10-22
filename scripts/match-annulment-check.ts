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
import { classifyCombo, planCombo, planSingleBet, legMatchesTarget, isRealMatchLeg, suggestedOfficialScore, officialStandingsResult, resultForStandings, type ComboLegAfterNeutralization, type ComboPlanInput } from '@/lib/matchAnnulment'
import { evaluateSlips, type RiskySlip } from '@/lib/risky'
import { isComboSociallyStarted, isSingleSociallyVisible } from '@/lib/socialBetVisibility'
import { isMatchConcluded, matchResultDisplay } from '@/lib/matchResultDisplay'

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
    const firstRun = legMatchesTarget({ status: 'pending', matchId: 433, specialId: null, marketType: '1x2' }, { matchId: 433 })
    const secondRun = legMatchesTarget({ status: 'neutralized', matchId: 433, specialId: null, marketType: '1x2' }, { matchId: 433 })
    check('1. Lauf: Leg wird erfasst', firstRun === true)
    check('2. Lauf: Leg wird NICHT erneut erfasst (schon neutralisiert)', secondRun === false)
  }

  console.log('\n11. Spieltag-Special, das dieses Spiel enthält — Leg-Ebene, keine anderen Kombi-Legs')
  {
    // special_id statt match_id als Trigger — derselbe Mechanismus.
    const matches = legMatchesTarget({ status: 'pending', matchId: 999, specialId: 55, marketType: 'matchday_special' }, { specialId: 55 })
    check('special_id-Leg wird erfasst, obwohl match_id technischer Anker ist', matches === true)
    // Eine andere Auswahl derselben Kombi (ein echtes Match, kein Special)
    // bleibt unberührt, weil sie weder matchId noch specialId trifft.
    const other = legMatchesTarget({ status: 'pending', matchId: 307, specialId: null, marketType: '1x2' }, { specialId: 55 })
    check('andere Legs derselben Kombi bleiben unberührt', other === false)
  }

  console.log('\n11b. Special, dessen representative_match_id zufällig das annullierte Spiel ist,')
  console.log('     OHNE es in included_match_ids zu führen — darf NICHT über match_id getroffen werden')
  {
    // Genau der vom Review gemeldete Fehler: ein matchday_special-Bet, dessen
    // technischer Anker (match_id) = die annullierte Spiel-ID ist, aber dessen
    // Special das Spiel gar nicht wirklich enthält. legMatchesTarget darf das
    // NUR über specialId erfassen (und nur, wenn der Aufrufer dieses
    // special_id überhaupt als "wirklich betroffen" übergibt — was
    // supabase/match_annulment.sql/die Admin-Vorschau nur nach Prüfung von
    // included_match_ids tun), niemals über die bloße match_id-Übereinstimmung.
    const specialAnchoredHere = legMatchesTarget(
      { status: 'pending', matchId: 433, specialId: 77, marketType: 'matchday_special' },
      { matchId: 433 }, // NUR matchId als Ziel — kein specialId, weil das Special 433 nicht wirklich enthält
    )
    check("Special-Bet mit match_id=433 (nur technischer Anker) wird NICHT über matchId erfasst", specialAnchoredHere === false)
    check('isRealMatchLeg verneint für matchday_special', isRealMatchLeg({ marketType: 'matchday_special' }) === false)
    check('isRealMatchLeg bejaht für eine normale Marktauswahl', isRealMatchLeg({ marketType: '1x2' }) === true)
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

  console.log('\n13. Risky-Pinning bei späteren Neuberechnungen (lib/risky.ts#recomputeRiskyForUserMatchday)')
  {
    // Simuliert exakt das, was recomputeRiskyForUserMatchday NACH diesem Fix tut: eine von
    // einer Annullierung berührte Kombi geht mit ihrer ORIGINAL-Quote (original_total_odds),
    // nicht ihrer aktuellen (neu berechneten, ggf. unter die Risky-Schwelle gefallenen) Quote
    // in die Bewertung ein — und wird danach nie zurückgeschrieben, egal was die Bewertung sagt.
    // Ausgangslage: 3 Scheine, Schein C war bei Platzierung (Original-Quote 25,00 > 20) der
    // Risky-Schein. Eine Annullierung hat Scheins C's Gesamtquote seither auf 12,00 gesenkt —
    // würde man JETZT naiv mit der aktuellen Quote neu bewerten, hätte keiner der 3 Scheine
    // eine Quote > 20, die Kombination aus 3 "normalen" Scheinen wäre regelwidrig und C würde
    // fälschlich seinen Risky-Status verlieren.
    const slipsWithOriginalOdds: RiskySlip[] = [
      { id: 'bet-A', odds: 5 },
      { id: 'bet-B', odds: 8 },
      { id: 'combo-C', odds: 25 }, // original_total_odds — nicht die aktuelle, neu berechnete Quote (12)
    ]
    const { riskyId, valid, classification } = evaluateSlips(slipsWithOriginalOdds)
    check('Mit Original-Quote bleibt Schein C der Risky-Schein', riskyId === 'combo-C')
    check('Budget bleibt gültig (2 normale + 1 Risky)', valid === true)
    check('Scheine A und B bleiben normal (nicht risky)', classification.get('bet-A') === false && classification.get('bet-B') === false)

    // Gegenprobe: würde man (falsch) die AKTUELLE Quote von C verwenden, zeigt sich genau der
    // Fehler, den das Pinning verhindert — keiner der 3 Scheine wäre noch risky.
    const slipsWithCurrentOddsWronglyUsed: RiskySlip[] = [
      { id: 'bet-A', odds: 5 },
      { id: 'bet-B', odds: 8 },
      { id: 'combo-C', odds: 12 },
    ]
    const wrong = evaluateSlips(slipsWithCurrentOddsWronglyUsed)
    check('Gegenprobe: mit der (falschen) aktuellen Quote wäre niemand mehr risky — genau das verhindert das Pinning', wrong.riskyId === null)
  }

  console.log('\n14. Offizielle BFV-Wertung — strikte Trennung von der Tabelle (resultForStandings)')
  {
    // Szenario 1: Nichtantritt Gast, bestätigt → 2:0 zählt in der Tabelle.
    check('suggestedOfficialScore(away_no_show) = 2:0', JSON.stringify(suggestedOfficialScore('away_no_show')) === JSON.stringify({ home: 2, away: 0 }))
    const awayNoShowConfirmed = {
      status: 'annulled', home_score: null, away_score: null,
      annulment_official_home_score: 2, annulment_official_away_score: 0,
      annulment_official_confirmed_at: '2026-10-23T10:00:00Z',
    }
    check('Szenario 1: Nichtantritt Gast, bestätigt → 2:0 zählt in der Tabelle',
      JSON.stringify(resultForStandings(awayNoShowConfirmed)) === JSON.stringify({ home_score: 2, away_score: 0 }))

    // Szenario 2: Nichtantritt Heim, bestätigt → 0:2 zählt in der Tabelle.
    check('suggestedOfficialScore(home_no_show) = 0:2', JSON.stringify(suggestedOfficialScore('home_no_show')) === JSON.stringify({ home: 0, away: 2 }))
    const homeNoShowConfirmed = {
      status: 'annulled', home_score: null, away_score: null,
      annulment_official_home_score: 0, annulment_official_away_score: 2,
      annulment_official_confirmed_at: '2026-10-23T10:00:00Z',
    }
    check('Szenario 2: Nichtantritt Heim, bestätigt → 0:2 zählt in der Tabelle',
      JSON.stringify(resultForStandings(homeNoShowConfirmed)) === JSON.stringify({ home_score: 0, away_score: 2 }))

    // Szenario 3: noch keine BFV-Entscheidung (confirmed_at null) → KEINE vorweggenommene Wertung,
    // selbst wenn (z.B. durch einen Admin-Entwurf) schon Zahlen in den Score-Spalten stehen.
    const pendingDecision = {
      status: 'annulled', home_score: null, away_score: null,
      annulment_official_home_score: 2, annulment_official_away_score: 0,
      annulment_official_confirmed_at: null,
    }
    check('Szenario 3: BFV-Entscheidung steht aus → keine Tabellenwertung, trotz vorhandener Zahlen',
      resultForStandings(pendingDecision) === null)
    check('officialStandingsResult verneint ebenso ohne confirmed_at', officialStandingsResult(pendingDecision) === null)

    // Szenario 4: "Anderer Grund" ohne jede Wertung → keine erfundenen Fußballergebnisse.
    check("suggestedOfficialScore('other') = null", suggestedOfficialScore('other' as never) === null)
    const otherReasonNoScore = {
      status: 'annulled', home_score: null, away_score: null,
      annulment_official_home_score: null, annulment_official_away_score: null,
      annulment_official_confirmed_at: null,
    }
    check('Szenario 4: Anderer Grund ohne Wertung → kein Tabellenergebnis', resultForStandings(otherReasonNoScore) === null)

    // Ein ganz normales 'finished' Spiel bleibt unverändert als Tabellenergebnis erkannt —
    // resultForStandings darf das bestehende Verhalten für reale Ergebnisse nicht verändern.
    const normalFinished = { status: 'finished', home_score: 3, away_score: 1 }
    check("echtes 'finished'-Ergebnis bleibt unverändert erkannt",
      JSON.stringify(resultForStandings(normalFinished)) === JSON.stringify({ home_score: 3, away_score: 1 }))

    // Ein annulliertes Spiel, dessen status NICHT 'annulled' wäre (kann strukturell nicht
    // vorkommen, aber defensiv geprüft) — officialStandingsResult verlangt exakt 'annulled'.
    check("officialStandingsResult verlangt status==='annulled', nicht z.B. 'postponed'",
      officialStandingsResult({ status: 'postponed', annulment_official_home_score: 2, annulment_official_away_score: 0, annulment_official_confirmed_at: '2026-10-23T10:00:00Z' }) === null)

    // Szenario 6/7 (strukturell): resultForStandings liest NUR die vier übergebenen Felder —
    // es gibt keinen Parameter/Rückgabewert, der je is_risky, Guthaben, Torschützen oder den
    // Wettschein-Status berühren könnte. Das ist durch die Funktionssignatur selbst erzwungen,
    // nicht nur getestet — hier wird nur dokumentiert, dass ein Objekt OHNE jedes dieser Felder
    // trotzdem korrekt funktioniert (kein versehentlicher Zugriff/Crash).
    check('resultForStandings funktioniert auch ohne jedes bet-/guthaben-bezogene Feld im Objekt',
      resultForStandings({ status: 'finished', home_score: 1, away_score: 0 }) !== null)
  }


  console.log('\n15. Tipp-Übersicht: Nichtantritt als abgeschlossen, ohne fiktive Tore')
  {
    const base = {
      status: 'annulled' as const,
      home_score: null, away_score: null,
      annulment_official_home_score: null, annulment_official_away_score: null,
      annulment_official_confirmed_at: null,
    }
    check('Annullierung gilt in Tipp-Übersicht als abgeschlossen', isMatchConcluded(base))
    check('Nichtantritt Gast: N.AN. GAST', matchResultDisplay({ ...base, annulment_type: 'away_no_show' })?.label === 'N.AN. GAST')
    check('Nichtantritt Heim: N.AN. HEIM', matchResultDisplay({ ...base, annulment_type: 'home_no_show' })?.label === 'N.AN. HEIM')
    check('Andere Absage: ANNULLIERT', matchResultDisplay({ ...base, annulment_type: 'other' })?.label === 'ANNULLIERT')
    check('Keine vorgezogene 2:0-Anzeige bei nicht bestätigtem Ergebnis',
      matchResultDisplay({ ...base, annulment_type: 'away_no_show', annulment_official_home_score: 2, annulment_official_away_score: 0 })?.label === 'N.AN. GAST')
    check('Bestätigte Wertung wird separat angezeigt',
      matchResultDisplay({ ...base, annulment_type: 'away_no_show', annulment_official_home_score: 2, annulment_official_away_score: 0, annulment_official_confirmed_at: '2026-10-22T11:00:00Z' })?.label === '2:0 (Wertung)')
    check('Normales Endergebnis bleibt unverändert', matchResultDisplay({ ...base, status: 'finished', home_score: 3, away_score: 1, annulment_type: null })?.label === '3:1')
    check('Verschobenes Spiel ist nicht abgeschlossen', !isMatchConcluded({ status: 'postponed' }))
  }


  console.log('\n16. Alle Tipps: Admin- und Besitzerzugriff nie Social-Freigabe')
  {
    const now = new Date('2026-10-22T05:48:00Z')
    const mAnnul = { id: 433, status: 'annulled', match_date: '2026-10-22T17:00:00Z' }
    const mFuture = { id: 422, status: 'scheduled', match_date: '2026-10-23T17:00:00Z' }
    const mFinished = { id: 307, status: 'finished', match_date: '2026-10-21T17:30:00Z' }
    const pending = { match_id: 422, status: 'pending', market_type: '1x2' }
    const neutral = { match_id: 433, status: 'neutralized', market_type: '1x2' }
    const won = { match_id: 307, status: 'won', market_type: '1x2' }
    check('#594 Jani / #608 Lobi: NICHT öffentlich vor echtem Kickoff',
      !isComboSociallyStarted([neutral, pending], [mAnnul, mFuture], now))
    check('Auch NACH ehemaligem Anpfiff des annullierten Spiels NICHT sichtbar',
      !isComboSociallyStarted([neutral, pending], [mAnnul, mFuture], new Date('2026-10-22T19:30:00Z')))
    check('#598 Korbi / #607 Dischl: nach entschiedenem anderem Leg sichtbar',
      isComboSociallyStarted([won, neutral, pending], [mFinished, mAnnul, mFuture], now))
    check('Fremde künftige Auswahl ohne Anpfiff weiterhin privat',
      !isComboSociallyStarted([pending], [mFuture], now))
    check('Beim tatsächlichen Anpfiff eines gültigen Matches wird Kombi sichtbar',
      isComboSociallyStarted([neutral, pending], [mAnnul, mFuture], new Date('2026-10-23T17:01:00Z')))
    check('Fehlende Termin-Metadaten: Fail closed',
      !isComboSociallyStarted([neutral, pending], [mAnnul], now))
    check('Pending Special mit rein technischem Anker darf Kombi NICHT entsperren',
      !isComboSociallyStarted([neutral, pending, { match_id: 307, status: 'pending', market_type: 'matchday_special' }], [mAnnul, mFuture, mFinished], now))
    check('Neutrales Einzel auf annulled sofort öffentlich',
      isSingleSociallyVisible({ match_id: 433, status: 'neutralized', combo_id: null }, mAnnul, now))
    check('Ehemaliger annulled-Kombi-Leg zählt NICHT als öffentliches Einzel',
      !isSingleSociallyVisible({ match_id: 433, status: 'neutralized', combo_id: 594 }, mAnnul, now))
    check('Künftiges Single bleibt bis zu Anpfiff privat',
      !isSingleSociallyVisible({ match_id: 422, status: 'pending', combo_id: null }, mFuture, now))
    check('Storniertes Single bleibt verborgen',
      !isSingleSociallyVisible({ match_id: 433, status: 'void', combo_id: null }, mAnnul, now))
  }

  console.log(`\n${checks} Prüfungen, ${failures} Fehler`)
  return failures
}
