/**
 * Consistency/invariant checks for the Winter-2026-V2 survey schema
 * (lib/survey.ts) and its validation helpers (lib/surveyValidation.ts). Pure
 * in-memory assertions, no database — same style as
 * scripts/combo-leg-order-check.ts (no test framework in this repo, see
 * CLAUDE.md).
 *
 * Usage: node --experimental-strip-types scripts/run-survey-schema-check.mjs
 */
import {
  SURVEY_SECTIONS, ALL_QUESTIONS, QUESTION_BY_ID, isRequired, isQuestionVisible,
  isSectionComplete, isSurveyComplete, type Answers,
} from '@/lib/survey'
import { toggleMultiOption, isValidMultiSelection, validateIncomingAnswers, stripHiddenAnswers } from '@/lib/surveyValidation'

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = '') {
  checks++
  if (!ok) failures++
  console.log(`  ${ok ? 'OK  ' : 'FEHLER'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

function q(id: string) {
  const def = QUESTION_BY_ID.get(id)
  if (!def) throw new Error(`Unbekannte Frage-ID im Test selbst: ${id}`)
  return def
}

export function run(): number {
  console.log('\n1. Schema-Grundstruktur: 7 Bereiche, 41 Felder, keine doppelten IDs')
  {
    check('genau 7 Bereiche', SURVEY_SECTIONS.length === 7, `${SURVEY_SECTIONS.length}`)
    check('genau 41 Fragefelder insgesamt', ALL_QUESTIONS.length === 41, `${ALL_QUESTIONS.length}`)
    const ids = ALL_QUESTIONS.map((x) => x.id)
    check('keine doppelten Frage-IDs', new Set(ids).size === ids.length)
    const perSection = SURVEY_SECTIONS.map((s) => s.questions.length)
    check('Felder pro Bereich: 6,11,3,5,6,4,6', perSection.join(',') === '6,11,3,5,6,4,6', perSection.join(','))
  }

  console.log('\n2. Maximal 27 Pflichtfelder (bei der Antwortkombination, die am meisten Pflichtfragen freischaltet)')
  {
    // q4 in {2,3,4} schaltet q5/q7/q8 scharf; q12 positiv schaltet q13/Auszahlung-Risky scharf —
    // zusammen die maximal mögliche Pflichtfeldzahl in einem Durchlauf.
    const maxAnswers: Answers = { q4: 'Ich würde ein Startgeld mit Preisen bevorzugen.', q12: '2 Risky-Wetten' }
    const requiredCount = ALL_QUESTIONS.filter((qq) => isQuestionVisible(qq, maxAnswers) && isRequired(qq, maxAnswers)).length
    check('max. 27 Pflichtfelder erreichbar, nie mehr', requiredCount === 27, `${requiredCount}`)

    // Minimal-Pfad (q4=1 abschaffen, q12=0 abschaffen) muss entsprechend WENIGER Pflichtfragen zeigen.
    const minAnswers: Answers = {
      q4: 'Das Wettspiel soll kostenlos bleiben. Mit Startgeld würde ich nicht mehr teilnehmen.',
      q12: '0 – Risky-Wetten vollständig abschaffen',
    }
    const minRequiredCount = ALL_QUESTIONS.filter((qq) => isQuestionVisible(qq, minAnswers) && isRequired(qq, minAnswers)).length
    check('Minimalpfad hat weniger Pflichtfragen als Maximalpfad', minRequiredCount < requiredCount, `${minRequiredCount} < ${requiredCount}`)
  }

  console.log('\n3. Q4-Sprunglogik (alle 5 Optionen)')
  {
    const options = q('q4').options!
    check('Q4 hat 5 Optionen', options.length === 5, `${options.length}`)
    for (const opt of options) {
      const a: Answers = { q4: opt }
      const q5Visible = isQuestionVisible(q('q5'), a)
      const q7Visible = isQuestionVisible(q('q7'), a)
      const q8Visible = isQuestionVisible(q('q8'), a)
      if (opt === options[0]) {
        check(`Q4="${opt}": Q5/Q7/Q8 ausgeblendet`, !q5Visible && !q7Visible && !q8Visible)
      } else if (opt === options[4]) {
        check(`Q4="${opt}" (unentschlossen): Q5 ausgeblendet, Q7/Q8 sichtbar+Pflicht`,
          !q5Visible && q7Visible && q8Visible && isRequired(q('q7'), a) && isRequired(q('q8'), a))
      } else {
        check(`Q4="${opt}": Q5/Q7/Q8 sichtbar und Pflicht`,
          q5Visible && q7Visible && q8Visible && isRequired(q('q5'), a) && isRequired(q('q7'), a) && isRequired(q('q8'), a))
      }
    }
    // Altwerte entfernen beim Wechsel zu "1" (abschaffen)
    const switched = stripHiddenAnswers({ q4: options[0], q5: '10 €', q7: ['Geldpreise'], q8: 'Ist mir egal' })
    check('Wechsel zu Q4=1 entfernt alte Q5/Q7/Q8-Werte', switched.q5 === undefined && switched.q7 === undefined && switched.q8 === undefined)
  }

  console.log('\n4. Q12-Sprunglogik (alle 8 Optionen)')
  {
    const options = q('q12').options!
    check('Q12 hat 8 Optionen', options.length === 8, `${options.length}`)
    for (const opt of options) {
      const a: Answers = { q12: opt }
      const q13Visible = isQuestionVisible(q('q13'), a)
      const payoutRiskyVisible = isQuestionVisible(q('q_payout_risky'), a)
      const payoutNormalRequired = isRequired(q('q_payout_normal'), a)
      check(`Q_payout_normal bleibt Pflicht unabhängig von Q12="${opt}"`, payoutNormalRequired)
      if (opt === options[0]) {
        check(`Q12="${opt}" (abschaffen): Q13/Auszahlung-Risky ausgeblendet`, !q13Visible && !payoutRiskyVisible)
      } else if (opt === 'Ist mir egal' || opt === 'Kann ich nicht beurteilen') {
        check(`Q12="${opt}" (neutral): Q13/Auszahlung-Risky sichtbar, aber freiwillig`,
          q13Visible && payoutRiskyVisible && !isRequired(q('q13'), a) && !isRequired(q('q_payout_risky'), a))
      } else {
        check(`Q12="${opt}" (positiv): Q13/Auszahlung-Risky sichtbar und Pflicht`,
          q13Visible && payoutRiskyVisible && isRequired(q('q13'), a) && isRequired(q('q_payout_risky'), a))
      }
    }
    const switched = stripHiddenAnswers({ q12: options[0], q13: '20 (wie bisher)', q_payout_risky: '15.000 Wildis (wie bisher)' })
    check('Wechsel zu Q12=0 entfernt alte Q13/Auszahlung-Risky-Werte', switched.q13 === undefined && switched.q_payout_risky === undefined)
  }

  console.log('\n5. Bedingte Freitexte (Trigger an/aus)')
  {
    const cases: { id: string; trigger: Answers; noTrigger: Answers }[] = [
      { id: 'q9_text', trigger: { q9: 'Häufig' }, noTrigger: { q9: 'Nie' } },
      { id: 'q19_text', trigger: { q19: 'Ja, beim angezeigten Guthaben oder Guthabenverlauf' }, noTrigger: { q19: 'Nein, mir ist nichts Ungewöhnliches aufgefallen' } },
      { id: 'q20_text', trigger: { q20: 'Ich habe die Einrichtung versucht, aber sie hat nicht funktioniert' }, noTrigger: { q20: 'Ich nutze sie und finde sie hilfreich' } },
      { id: 'q23_text', trigger: { q23: 'Ich wünsche mir zusätzliche Statistiken' }, noTrigger: { q23: 'Die Statistiken sind so, wie sie sind, gut' } },
      { id: 'q25_text', trigger: { q25: ['1X2 / Spielausgang'] }, noTrigger: { q25: ['Auf keinen – ich möchte alle behalten'] } },
      { id: 'q29_text', trigger: { q29: ['Sonstiges'] }, noTrigger: { q29: ['Ich vergesse, rechtzeitig zu wetten'] } },
      { id: 'q_motivation_text', trigger: { q_motivation: ['Etwas anderes'] }, noTrigger: { q_motivation: ['Der Wettbewerb um die Plätze in der Rangliste'] } },
    ]
    for (const c of cases) {
      check(`${c.id} sichtbar bei Trigger`, isQuestionVisible(q(c.id), c.trigger))
      check(`${c.id} ausgeblendet ohne Trigger`, !isQuestionVisible(q(c.id), c.noTrigger))
      check(`${c.id} ist nie Pflicht`, !isRequired(q(c.id), c.trigger))
      // Rücknahme des Triggers muss den Freitext aus dem aktiven Antwortobjekt entfernen.
      const stripped = stripHiddenAnswers({ ...c.noTrigger, [c.id]: 'alte stale Antwort' })
      check(`${c.id}: stale Antwort nach Rücknahme des Triggers entfernt`, stripped[c.id] === undefined)
    }
  }

  console.log('\n6. Multi-Select-Exklusivität und maxSelect (toggleMultiOption)')
  {
    // Q25: 3 konkrete max + 2 exklusive Optionen, die sich auch gegenseitig ausschließen.
    const q25 = q('q25')
    let sel = toggleMultiOption(q25, [], '1X2 / Spielausgang')
    sel = toggleMultiOption(q25, sel, 'Doppelte Chance')
    sel = toggleMultiOption(q25, sel, 'Über/Unter Tore')
    check('Q25: 3 konkrete Optionen wählbar', sel.length === 3, sel.join(','))
    const sel4 = toggleMultiOption(q25, sel, 'Handicap')
    check('Q25: 4. konkrete Option wird blockiert (max. 3)', sel4.length === 3, sel4.join(','))
    const selExclusive = toggleMultiOption(q25, sel, 'Auf keinen – ich möchte alle behalten')
    check('Q25: exklusive Option trotz erreichtem Maximum wählbar, ersetzt alles', selExclusive.length === 1 && selExclusive[0] === 'Auf keinen – ich möchte alle behalten')
    const backToConcrete = toggleMultiOption(q25, selExclusive, '1X2 / Spielausgang')
    check('Q25: konkrete Option nach exklusiver Auswahl wählbar, entfernt die exklusive', backToConcrete.length === 1 && backToConcrete[0] === '1X2 / Spielausgang')
    const bothExclusive = toggleMultiOption(q25, selExclusive, 'Kann ich nicht beurteilen')
    check('Q25: zweite exklusive Option ersetzt die erste (nie beide gleichzeitig)', bothExclusive.length === 1 && bothExclusive[0] === 'Kann ich nicht beurteilen')

    // Nachvollziehbarkeit: 2 exklusive Optionen, max 2 konkrete.
    const qc = q('q_comprehensibility')
    let selC = toggleMultiOption(qc, [], 'Wie sich die Auszahlung aus Einsatz und Quote berechnet')
    selC = toggleMultiOption(qc, selC, 'Wie sich mein aktuelles Wildis-Guthaben zusammensetzt')
    check('Nachvollziehbarkeit: 2 konkrete Optionen wählbar', selC.length === 2)
    const selC3 = toggleMultiOption(qc, selC, 'Warum eine Wette gewonnen, verloren oder storniert wurde')
    check('Nachvollziehbarkeit: 3. konkrete Option blockiert (max. 2)', selC3.length === 2)
    const selCExcl = toggleMultiOption(qc, selC, 'Für mich ist alles ausreichend nachvollziehbar')
    check('Nachvollziehbarkeit: exklusive Option trotz Maximum wählbar', selCExcl.length === 1)

    // Q7: 1 exklusive Option ("Keine Präferenz"), max 2 konkrete.
    const q7 = q('q7')
    let sel7 = toggleMultiOption(q7, [], 'Geldpreise')
    sel7 = toggleMultiOption(q7, sel7, 'Gutscheine (z. B. Bürgi-Getränke)')
    const sel7Excl = toggleMultiOption(q7, sel7, 'Keine Präferenz')
    check('Q7: "Keine Präferenz" trotz 2 bereits gewählter Optionen wählbar', sel7Excl.length === 1 && sel7Excl[0] === 'Keine Präferenz')

    // Q29: "Sonstiges" zählt gegen das Limit von 3, Zufriedenheits-Option ist exklusiv.
    const q29 = q('q29')
    let sel29 = toggleMultiOption(q29, [], 'Ich vergesse, rechtzeitig zu wetten')
    sel29 = toggleMultiOption(q29, sel29, 'Mir fehlt manchmal die Zeit')
    sel29 = toggleMultiOption(q29, sel29, 'Sonstiges')
    check('Q29: "Sonstiges" zählt gegen das Limit von 3', sel29.length === 3)
    const sel29Blocked = toggleMultiOption(q29, sel29, 'Zu wenig Wildis')
    check('Q29: 4. Option (nach "Sonstiges") blockiert', sel29Blocked.length === 3)
    const sel29Excl = toggleMultiOption(q29, sel29, 'Ich bin mit meiner aktuellen Wettaktivität zufrieden und möchte nicht häufiger wetten')
    check('Q29: exklusive Zufriedenheits-Option trotz Maximum wählbar', sel29Excl.length === 1)

    // Feature-Frage: "Keine" jederzeit klickbar, auch bei 3 bereits gewählten Features;
    // Feature-Freitext bleibt unabhängig davon immer sichtbar (separate Frage, kein visible()).
    const qf = q('q_features')
    let selF = toggleMultiOption(qf, [], 'Cashout')
    selF = toggleMultiOption(qf, selF, 'Spieler-Duelle')
    selF = toggleMultiOption(qf, selF, 'Spiele favorisieren')
    check('Features: 3 aus verschiedenen Gruppen wählbar (Gruppierung ist nur visuell)', selF.length === 3)
    const selFNone = toggleMultiOption(qf, selF, 'Keine dieser Funktionen interessiert mich')
    check('Features: "Keine" trotz 3 gewählter Features wählbar, ersetzt alles', selFNone.length === 1)
    check('Feature-Freitext ist immer sichtbar (auch bei "Keine")', isQuestionVisible(q('q_features_text'), { q_features: selFNone }))
  }

  console.log('\n7. API-Adversarial: validateIncomingAnswers lehnt manipulierte Eingaben ab')
  {
    check('unbekannte Frage-ID wird abgelehnt', !validateIncomingAnswers({ does_not_exist: 'x' }).ok)
    check('Skala außerhalb des Bereichs wird abgelehnt', !validateIncomingAnswers({ q1: 11 }).ok)
    check('Skala als Nicht-Ganzzahl wird abgelehnt', !validateIncomingAnswers({ q1: 5.5 }).ok)
    check('Array statt String bei Einfachauswahl wird abgelehnt', !validateIncomingAnswers({ q4: ['x'] }).ok)
    check('unbekannte Option bei Einfachauswahl wird abgelehnt', !validateIncomingAnswers({ q4: 'Frei erfundene Antwort' }).ok)
    check('zu viele Mehrfachauswahl-Optionen werden abgelehnt', !validateIncomingAnswers({ q25: ['1X2 / Spielausgang', 'Doppelte Chance', 'Über/Unter Tore', 'Handicap'] }).ok)
    check('exklusive + konkrete Option kombiniert wird abgelehnt', !validateIncomingAnswers({ q25: ['1X2 / Spielausgang', 'Auf keinen – ich möchte alle behalten'] }).ok)
    check('zwei exklusive Optionen gleichzeitig werden abgelehnt', !validateIncomingAnswers({ q25: ['Auf keinen – ich möchte alle behalten', 'Kann ich nicht beurteilen'] }).ok)
    check('doppelte Option im Array wird abgelehnt', !validateIncomingAnswers({ q25: ['1X2 / Spielausgang', '1X2 / Spielausgang'] }).ok)
    check('unbekannte Option im Mehrfachauswahl-Array wird abgelehnt', !validateIncomingAnswers({ q25: ['Frei erfunden'] }).ok)
    check('mäßig zu langer Freitext wird auf das Limit gekürzt statt abgelehnt', (() => {
      const r = validateIncomingAnswers({ q31: 'x'.repeat(5000) })
      return r.ok && typeof r.answers.q31 === 'string' && (r.answers.q31 as string).length <= 2000
    })())
    check('absurd überlanger Freitext (Missbrauchsversuch) wird abgelehnt', !validateIncomingAnswers({ q31: 'x'.repeat(50000) }).ok)
    check('gültige, vollständige Antworten werden akzeptiert', validateIncomingAnswers({ q1: 8, q4: 'Das kann ich erst entscheiden, wenn Höhe des Startgelds und mögliche Preise feststehen.' }).ok)
    // Server muss eine versteckte Folgefrage aus einer Einreichung entfernen, nicht nur ablehnen.
    const stale = validateIncomingAnswers({ q4: 'Das Wettspiel soll kostenlos bleiben. Mit Startgeld würde ich nicht mehr teilnehmen.', q5: '10 €' })
    check('stale Q5-Antwort hinter inzwischen verstecktem Q4=1 wird beim Speichern entfernt', stale.ok && stale.answers.q5 === undefined)
    // Multi-Select-Validator direkt (nicht nur über das API-Wrapper).
    check('isValidMultiSelection: leeres Array ist gültig (keine Pflichtprüfung hier)', isValidMultiSelection(q('q25'), []))
    check('isValidMultiSelection: Nicht-Array ist ungültig', !isValidMultiSelection(q('q25'), 'x'))
  }

  console.log('\n8. Vollständigkeits-/Einreichungslogik (isSectionComplete/isSurveyComplete)')
  {
    const empty: Answers = {}
    check('leere Antworten sind nicht vollständig', !isSurveyComplete(empty))
    for (const s of SURVEY_SECTIONS) {
      check(`Bereich "${s.title}": leere Antworten sind nicht vollständig (falls Pflichtfragen sichtbar)`,
        s.questions.some((qq) => isRequired(qq, empty) && isQuestionVisible(qq, empty)) ? !isSectionComplete(s, empty) : true)
    }
  }

  console.log(`\n${checks} Prüfungen, ${failures} Fehler.`)
  return failures
}
