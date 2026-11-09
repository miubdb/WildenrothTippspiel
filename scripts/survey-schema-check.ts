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
  SURVEY_SECTIONS, ALL_QUESTIONS, QUESTION_BY_ID, isRequired, isQuestionVisible, visibleQuestionsForSection,
  isSectionComplete, isSurveyComplete, type Answers,
} from '@/lib/survey'
import {
  toggleMultiOption, isValidMultiSelection, validateIncomingAnswers, stripHiddenAnswers, nextSubmittedAt,
} from '@/lib/surveyValidation'
import { isActuallySubmitted, computeOverview, computeCrossTabs, type SurveyRow } from '@/lib/surveyAggregate'
import { computeSurveyDecisionInsights, inSurveySegment } from '@/lib/surveyInsights'
import { questionPages, pageComplete } from '@/lib/surveyPresentation'
import { findSurveyOperatorId, withoutSurveyOperator } from '@/lib/surveyAudience'
import {
  currentSurveyModeKey, resolveSurveyMode, surveyModeAllowsAccess, surveyModeShowsHelpLink, SURVEY_MODE_KEY_PRODUCTION, SURVEY_MODE_KEY_PREVIEW,
  currentSurveyVersion, SURVEY_VERSION_PRODUCTION, SURVEY_VERSION_PREVIEW,
} from '@/lib/surveyMode'

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
  console.log('\n1. Schema-Grundstruktur: 7 Bereiche, 42 Felder, keine doppelten IDs')
  {
    check('genau 7 Bereiche', SURVEY_SECTIONS.length === 7, `${SURVEY_SECTIONS.length}`)
    check('genau 42 Fragefelder insgesamt', ALL_QUESTIONS.length === 42, `${ALL_QUESTIONS.length}`)
    const ids = ALL_QUESTIONS.map((x) => x.id)
    check('keine doppelten Frage-IDs', new Set(ids).size === ids.length)
    const perSection = SURVEY_SECTIONS.map((s) => s.questions.length)
    check('Felder pro Bereich: 6,11,3,5,7,4,6', perSection.join(',') === '6,11,3,5,7,4,6', perSection.join(','))
  }

  console.log('\n2. Maximal 27 Pflichtfelder (bei der Antwortkombination, die am meisten Pflichtfragen freischaltet)')
  {
    // q4 in {2,3,4} schaltet q5/q7/q8 scharf; q12 positiv schaltet q13/Auszahlung-Risky scharf —
    // zusammen die maximal mögliche Pflichtfeldzahl in einem Durchlauf.
    const maxAnswers: Answers = { q4: 'Ich würde ein Startgeld mit Preisen ausdrücklich begrüßen.', q12: '2 Risky-Wetten' }
    const requiredCount = ALL_QUESTIONS.filter((qq) => isQuestionVisible(qq, maxAnswers) && isRequired(qq, maxAnswers)).length
    check('max. 27 Pflichtfelder erreichbar, nie mehr', requiredCount === 27, `${requiredCount}`)

    // Minimal-Pfad (q4=1 abschaffen, q12=0 abschaffen) muss entsprechend WENIGER Pflichtfragen zeigen.
    const minAnswers: Answers = {
      q4: 'Ich möchte kein Startgeld. Falls es verpflichtend wird, würde ich nicht mehr teilnehmen.',
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
      { id: 'q23_text', trigger: { q23: 'Ich wünsche mir zusätzliche Auswertungen.' }, noTrigger: { q23: 'Die Statistiken passen für mich so, wie sie sind.' } },
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

  check('Q20: bewusst deaktivierte Pushs sind kein Problem-Trigger',
    !isQuestionVisible(q('q20_text'), { q20: 'Ich habe sie bewusst deaktiviert bzw. möchte keine' }))
  check('Q23: sieben trennscharfe Antworten', q('q23').options!.length === 7)
  check('Q23: Nichtkenntnis und fehlende Beurteilbarkeit getrennt', q('q23').options!.some(x => x.includes('bisher nicht angesehen')) && q('q23').options!.some(x => x.includes('kann sie aber nicht beurteilen')))
  check('Q4 hat fünf Optionen', q('q4').options!.length === 5)
  check('Q7 hat sieben Preisarten', q('q7').options!.length === 7)
  check('Q8 hat fünf Antwortoptionen', q('q8').options!.length === 5)
  check('Q29 hat 13 Antworten', q('q29').options!.length === 13)
  check('Feature-Auswahl behält 13 Ideen und eine exklusive Nein-Option', q('q_features').options!.length === 14)
  check('Q30 benennt den kostenlosen Fall', q('q30').text.includes('kostenlos'))
  check('Die drei einklappbaren Freitexte bleiben freiwillig und sichtbar',
    ['q_technical_feedback', 'q26', 'q_features_text'].every((id) => !isRequired(q(id), {}) && isQuestionVisible(q(id), {})))
  check('Q31 bleibt sichtbar', isQuestionVisible(q('q31'), {}))
  console.log('\n5b. Recap-Leserhäufigkeit und Kanal: Sprunglogik + Antwortvalidierung')
  {
    const frequency = q('q21_recap_frequency')
    const channel = q('q21_recap_channel')
    check('Recap-Häufigkeit bleibt freiwillig', !isRequired(frequency, {}))
    check('Recap-Kanal bleibt freiwillig', !isRequired(channel, { q21_recap_frequency: 'Ich lese eigentlich jeden Recap.' }))
    const readers = [
      'Ich lese eigentlich jeden Recap.',
      'Ich lese die meisten Recaps, aber nicht alle.',
      'Ich schaue nur gelegentlich rein.',
    ]
    for (const value of readers) {
      check(`Recap-Kanal bei Leser "${value}" sichtbar`, isQuestionVisible(channel, { q21_recap_frequency: value }))
    }
    for (const value of [
      undefined,
      'Ich kenne die Recaps, lese sie aber nicht.',
      'Ich wusste bisher nicht, dass es Spieltags-Recaps gibt.',
    ]) {
      const answers: Answers = value ? { q21_recap_frequency: value } : {}
      check(`Recap-Kanal ohne regelmäßige/gelegentliche Nutzung ausgeblendet (${value ?? 'keine Antwort'})`, !isQuestionVisible(channel, answers))
      const stripped = stripHiddenAnswers({ ...answers, q21_recap_channel: channel.options![0] })
      check('Ausgeblendete Recap-Kanalantwort wird entfernt', stripped.q21_recap_channel === undefined)
    }
    const readerAnswers = { q21_recap_frequency: readers[1], q21_recap_channel: channel.options![1] }
    const valid = validateIncomingAnswers(readerAnswers)
    check('Recap-Kanal samt App-Bekanntheit wird validiert', valid.ok && valid.answers.q21_recap_channel === channel.options![1])
    const nonreader = validateIncomingAnswers({ q21_recap_frequency: 'Ich kenne die Recaps, lese sie aber nicht.', q21_recap_channel: channel.options![0] })
    check('Server entfernt Kanalantwort beim Wechsel auf Nichtleser', nonreader.ok && nonreader.answers.q21_recap_channel === undefined)
    const invalid = validateIncomingAnswers({ q21_recap_frequency: readers[0], q21_recap_channel: 'Alte Antwortoption' })
    check('Nicht mehr gültige Recap-Antwort wird abgewiesen', !invalid.ok)

    const t = '2026-11-08T11:00:00.000Z'
    const row = (id: string, answers: Answers): SurveyRow => ({
      user_id: id, answers, started_at: t, submitted_at: t, updated_at: t,
    })
    const data = computeCrossTabs([
      row('r1', { q21_recap_frequency: readers[0], q21_recap_channel: channel.options![0] }),
      row('r2', { q21_recap_frequency: readers[1] }),
      row('r3', { q21_recap_frequency: readers[2], q21_recap_channel: channel.options![1] }),
      row('r4', { q21_recap_frequency: 'Ich kenne die Recaps, lese sie aber nicht.' }),
      row('r5', { q21_recap_frequency: 'Ich wusste bisher nicht, dass es Spieltags-Recaps gibt.' }),
      row('r6', {}),
    ], new Map()).kommunikation
    check('Admin-Auswertung Q21a: alle 6 Teilnehmer, 5 Antworten', data.recapFrequency.total === 6 && data.recapFrequency.shownButUnanswered === 1)
    check('Admin-Auswertung Q21b: nur 3 Leser sehen die Frage, davon 2 Antworten', data.recapChannel.total === 3 && data.recapChannel.shownButUnanswered === 1)
    check('Admin-Auswertung Q21b: WhatsApp-Bekanntheit bleibt differenziert', data.recapChannel.options[0].count === 1 && data.recapChannel.options[1].count === 1)
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

    // Q7: 1 exklusive Option ("Mir ist die Art der Preise egal"), max 2 konkrete.
    const q7 = q('q7')
    let sel7 = toggleMultiOption(q7, [], 'Geldpreise')
    sel7 = toggleMultiOption(q7, sel7, 'Gutscheine (z. B. für Getränke oder Essen)')
    const sel7Excl = toggleMultiOption(q7, sel7, 'Mir ist die Art der Preise egal')
    check('Q7: "Mir ist die Art der Preise egal" trotz 2 bereits gewählter Optionen wählbar', sel7Excl.length === 1 && sel7Excl[0] === 'Mir ist die Art der Preise egal')

    // Q29: "Sonstiges" zählt gegen das Limit von 3, Zufriedenheits-Option ist exklusiv.
    const q29 = q('q29')
    let sel29 = toggleMultiOption(q29, [], 'Ich vergesse, rechtzeitig zu wetten')
    sel29 = toggleMultiOption(q29, sel29, 'Mir fehlt manchmal die Zeit')
    sel29 = toggleMultiOption(q29, sel29, 'Sonstiges')
    check('Q29: "Sonstiges" zählt gegen das Limit von 3', sel29.length === 3)
    const sel29Blocked = toggleMultiOption(q29, sel29, 'Zu wenig Wildis')
    check('Q29: 4. Option (nach "Sonstiges") blockiert', sel29Blocked.length === 3)
    const sel29Excl = toggleMultiOption(q29, sel29, 'Ich wette bereits so häufig, wie ich möchte.')
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
    check('gültige, vollständige Antworten werden akzeptiert', validateIncomingAnswers({ q1: 8, q4: 'Das kann ich erst entscheiden, wenn die Höhe des Startgelds und die möglichen Preise feststehen.' }).ok)
    // Server muss eine versteckte Folgefrage aus einer Einreichung entfernen, nicht nur ablehnen.
    const stale = validateIncomingAnswers({ q4: 'Ich möchte kein Startgeld. Falls es verpflichtend wird, würde ich nicht mehr teilnehmen.', q5: '10 €' })
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

  console.log('\n9. submitted_at darf eine unvollständig gewordene Abgabe nie als abgegeben weiterführen')
  {
    const now = '2026-11-10T12:00:00.000Z'
    const earlier = '2026-11-01T09:00:00.000Z'

    // Vollständige Antworten (Minimalpfad, der ohne Q13/Zahlungsdetails auskommt).
    const complete: Answers = {
      q1: 8, q2: 4, q_comprehensibility: ['Für mich ist alles ausreichend nachvollziehbar'],
      q3: 'Montagvormittag (wie bisher)', q9: 'Nie', q10: '250 Wildis (wie bisher)', q11: '2 (wie bisher)',
      q12: '0 – Risky-Wetten vollständig abschaffen', q_payout_normal: '10.000 Wildis (wie bisher)',
      q15: '10 Wildis (wie bisher)', q16: '50 Wildis (wie bisher)',
      q17: 'Bisherige Regel beibehalten – keine Wetten gegen die eigene Mannschaft.',
      q19: 'Nein, mir ist nichts Ungewöhnliches aufgefallen',
      q25: ['Auf keinen – ich möchte alle behalten'],
      q27: 'Alle Kreisliga-Spiele (wie bisher)', q28: 'Wildenroth II + 1 weiteres ausgewähltes Spiel (wie bisher)',
      q20: 'Ich nutze sie und finde sie hilfreich', q22: 'WhatsApp und App-Push',
      q4: 'Ich möchte kein Startgeld. Falls es verpflichtend wird, würde ich nicht mehr teilnehmen.',
      q29: ['Ich wette bereits so häufig, wie ich möchte.'],
      q30: 'Ja, auf jeden Fall', q_features: ['Keine dieser Funktionen interessiert mich'],
    }
    check('Testvorlage "complete" ist tatsächlich vollständig', isSurveyComplete(complete), 'Testdaten-Fehler, nicht Produktionscode')

    check('submit: stempelt immer `now`, unabhängig vom vorherigen Wert', nextSubmittedAt('submit', null, complete, now) === now)
    check('submit: überschreibt auch einen vorherigen Zeitstempel mit `now`', nextSubmittedAt('submit', earlier, complete, now) === now)

    check('save: nie zuvor abgegeben + jetzt vollständig → bleibt null (ein save allein "submitted" nie implizit setzen)',
      nextSubmittedAt('save', null, complete, now) === null)
    check('save: bereits abgegeben + weiterhin vollständig → behält den ALTEN Zeitstempel (kein stilles Bump)',
      nextSubmittedAt('save', earlier, complete, now) === earlier)

    // Der eigentliche gemeldete Bug: Q4 auf einen Wert geändert, der Q5 Pflicht macht, Q5 aber
    // noch nicht beantwortet — ein vorher abgegebener Stand darf dadurch NICHT "abgegeben" bleiben.
    const incompleteAfterEdit: Answers = { ...complete, q4: 'Ich würde ein Startgeld mit Preisen ausdrücklich begrüßen.' }
    check('Testvorlage wird durch den Q4-Wechsel tatsächlich unvollständig (Q5/Q7/Q8 jetzt Pflicht, fehlen)',
      !isSurveyComplete(incompleteAfterEdit), 'Testdaten-Fehler, nicht Produktionscode')
    check('save: bereits abgegeben, aber nach Bearbeitung unvollständig → wird auf null zurückgesetzt (der gemeldete Bug)',
      nextSubmittedAt('save', earlier, incompleteAfterEdit, now) === null)

    // isActuallySubmitted: zweite, unabhängige Absicherung in der Admin-Auswertung.
    const rowOk: SurveyRow = { user_id: 'u1', answers: complete, started_at: earlier, submitted_at: earlier, updated_at: now }
    const rowStaleFlag: SurveyRow = { user_id: 'u2', answers: incompleteAfterEdit, started_at: earlier, submitted_at: earlier, updated_at: now }
    const rowNotSubmitted: SurveyRow = { user_id: 'u3', answers: complete, started_at: earlier, submitted_at: null, updated_at: now }
    const rowNotReturning: SurveyRow = {
      ...rowOk, user_id: 'u4', answers: { ...complete, q30: 'Eher nein' },
    }
    const renewedOverview = computeOverview([rowOk, rowNotReturning], new Set(['u1', 'u4']))
    check('Q30-Teilnahmeabsicht zählt Textoptionen statt einen ungültigen Durchschnitt',
      renewedOverview.returningPct === 50)
    check('isActuallySubmitted: vollständige Antworten + Zeitstempel → true', isActuallySubmitted(rowOk))
    check('isActuallySubmitted: Zeitstempel gesetzt, aber Antworten unvollständig → false (Verteidigungslinie 2)', !isActuallySubmitted(rowStaleFlag))
    check('isActuallySubmitted: kein Zeitstempel → false', !isActuallySubmitted(rowNotSubmitted))
  }

  console.log('\n10. Freigabe-Gate: getrennte Schlüssel je Umgebung (survey_mode_v2 / survey_mode_v2_preview)')
  {
    const originalVercelEnv = process.env.VERCEL_ENV
    // Simuliert, welche Zeile für welchen Schlüssel in der (gemeinsamen) DB
    // stünde — pro Szenario unten gesetzt; resolveSurveyMode(lookup(currentSurveyModeKey()))
    // ist exakt das, was GET/POST/Startseite/Hilfe/Admin tatsächlich tun.
    function lookupFor(stored: Partial<Record<string, string>>) {
      return (key: string) => stored[key]
    }

    try {
      console.log('  — resolveSurveyMode: reine Normalisierung —')
      check('kein Eintrag (undefined) → hidden', resolveSurveyMode(undefined) === 'hidden')
      check('null → hidden', resolveSurveyMode(null) === 'hidden')
      check('"hidden" → hidden', resolveSurveyMode('hidden') === 'hidden')
      check('"direct_only" → direct_only', resolveSurveyMode('direct_only') === 'direct_only')
      check('direct_only: Zugriff möglich', surveyModeAllowsAccess('direct_only'))
      check('direct_only: kein Hilfe-Link', !surveyModeShowsHelpLink('direct_only'))
      check('hidden: kein Zugriff', !surveyModeAllowsAccess('hidden'))
      check('hidden: kein Hilfe-Link', !surveyModeShowsHelpLink('hidden'))
      check('help_only: Hilfe-Link', surveyModeShowsHelpLink('help_only'))
      check('prominent: Hilfe-Link', surveyModeShowsHelpLink('prominent'))
      check('"help_only" → help_only', resolveSurveyMode('help_only') === 'help_only')
      check('"prominent" → prominent', resolveSurveyMode('prominent') === 'prominent')
      check('unbekannter/kaputter Wert → hidden (fail closed)', resolveSurveyMode('irgendwas') === 'hidden')

      console.log('  — currentSurveyModeKey: wählt immer den Schlüssel der LAUFENDEN Umgebung —')
      delete process.env.VERCEL_ENV
      check('kein VERCEL_ENV (z.B. lokal) → Preview-Schlüssel', currentSurveyModeKey() === SURVEY_MODE_KEY_PREVIEW)
      process.env.VERCEL_ENV = 'preview'
      check('VERCEL_ENV=preview → Preview-Schlüssel', currentSurveyModeKey() === SURVEY_MODE_KEY_PREVIEW)
      process.env.VERCEL_ENV = 'production'
      check('VERCEL_ENV=production → Production-Schlüssel', currentSurveyModeKey() === SURVEY_MODE_KEY_PRODUCTION)
      check('Production- und Preview-Schlüssel sind zwei unterschiedliche Strings', (SURVEY_MODE_KEY_PRODUCTION as string) !== (SURVEY_MODE_KEY_PREVIEW as string))

      console.log('  — Szenariomatrix (simulierte DB-Zeilen je Schlüssel) —')
      // Szenario: Preview freigegeben, Production versteckt.
      {
        const lookup = lookupFor({ [SURVEY_MODE_KEY_PREVIEW]: 'help_only' }) // Production-Schlüssel hat keinen Eintrag
        process.env.VERCEL_ENV = 'production'
        check('Preview freigegeben/Production versteckt: auf Production gilt trotzdem hidden',
          resolveSurveyMode(lookup(currentSurveyModeKey())) === 'hidden')
        process.env.VERCEL_ENV = undefined
        check('Preview freigegeben/Production versteckt: auf Preview gilt help_only',
          resolveSurveyMode(lookup(currentSurveyModeKey())) === 'help_only')
      }
      // Szenario: Production nur direkt erreichbar, Preview versteckt.
      {
        const lookup = lookupFor({ [SURVEY_MODE_KEY_PRODUCTION]: 'direct_only' })
        process.env.VERCEL_ENV = 'production'
        const mode = resolveSurveyMode(lookup(currentSurveyModeKey()))
        check('Production direct_only: direkten Zugriff erlauben, ohne Menü-Link', surveyModeAllowsAccess(mode) && !surveyModeShowsHelpLink(mode))
        process.env.VERCEL_ENV = 'preview'
        check('Production direct_only: Preview bleibt hidden', resolveSurveyMode(lookup(currentSurveyModeKey())) === 'hidden')
      }
      // Szenario: Production freigegeben, Preview versteckt.
      {
        const lookup = lookupFor({ [SURVEY_MODE_KEY_PRODUCTION]: 'prominent' }) // Preview-Schlüssel hat keinen Eintrag
        process.env.VERCEL_ENV = 'production'
        check('Production freigegeben/Preview versteckt: auf Production gilt prominent',
          resolveSurveyMode(lookup(currentSurveyModeKey())) === 'prominent')
        process.env.VERCEL_ENV = undefined
        check('Production freigegeben/Preview versteckt: auf Preview gilt trotzdem hidden',
          resolveSurveyMode(lookup(currentSurveyModeKey())) === 'hidden')
      }
      // Szenario: beide versteckt (Ausgangszustand — kein Eintrag für irgendeinen Schlüssel).
      {
        const lookup = lookupFor({})
        process.env.VERCEL_ENV = 'production'
        check('Beide versteckt: Production liest hidden', resolveSurveyMode(lookup(currentSurveyModeKey())) === 'hidden')
        process.env.VERCEL_ENV = undefined
        check('Beide versteckt: Preview liest hidden', resolveSurveyMode(lookup(currentSurveyModeKey())) === 'hidden')
      }
      // Beide gleichzeitig freigegeben, aber unterschiedlich — stellt sicher, dass niemals der
      // Wert der JEWEILS ANDEREN Umgebung gelesen wird, auch wenn beide gesetzt sind.
      {
        const lookup = lookupFor({ [SURVEY_MODE_KEY_PRODUCTION]: 'help_only', [SURVEY_MODE_KEY_PREVIEW]: 'prominent' })
        process.env.VERCEL_ENV = 'production'
        check('Beide gesetzt, unterschiedlich: Production liest NUR seinen eigenen Wert (help_only, nicht prominent)',
          resolveSurveyMode(lookup(currentSurveyModeKey())) === 'help_only')
        process.env.VERCEL_ENV = undefined
        check('Beide gesetzt, unterschiedlich: Preview liest NUR seinen eigenen Wert (prominent, nicht help_only)',
          resolveSurveyMode(lookup(currentSurveyModeKey())) === 'prominent')
      }
    } finally {
      if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV
      else process.env.VERCEL_ENV = originalVercelEnv
    }
  }

  console.log('\n11. survey_version-Trennung: Preview und Production dürfen sich niemals gegenseitig berühren')
  {
    const originalVercelEnv = process.env.VERCEL_ENV
    try {
      check('Production- und Preview-Version sind zwei unterschiedliche Strings', (SURVEY_VERSION_PRODUCTION as string) !== (SURVEY_VERSION_PREVIEW as string))

      process.env.VERCEL_ENV = 'production'
      check('VERCEL_ENV=production → Production-Version', currentSurveyVersion() === SURVEY_VERSION_PRODUCTION)
      process.env.VERCEL_ENV = 'preview'
      check('VERCEL_ENV=preview → Preview-Version', currentSurveyVersion() === SURVEY_VERSION_PREVIEW)
      process.env.VERCEL_ENV = undefined
      check('kein VERCEL_ENV (z.B. lokal) → Preview-Version', currentSurveyVersion() === SURVEY_VERSION_PREVIEW)

      // Simulierte survey_responses-Tabelle: je eine Zeile pro Version. Steht
      // hier für GET (Teilnehmer-API + Admin-Auswertung/Teilnehmerliste),
      // CSV-Export, Einzel-Löschung und Komplettreset — alle filtern exakt
      // über `.eq('survey_version', currentSurveyVersion())` (siehe
      // app/api/survey/route.ts, app/api/admin/survey/route.ts,
      // app/api/admin/survey/export/route.ts). Der Test beweist direkt, dass
      // dieselbe Funktion für jede Umgebung nur die eigenen Zeilen trifft und
      // ein Komplettreset in der einen Umgebung die andere nicht verändert.
      type FakeRow = { survey_version: string; marker: string }
      const fakeDb: FakeRow[] = [
        { survey_version: SURVEY_VERSION_PRODUCTION, marker: 'ECHTE-PRODUKTIONSANTWORT' },
        { survey_version: SURVEY_VERSION_PREVIEW, marker: 'PREVIEW-TESTANTWORT' },
      ]
      const selectForCurrentEnv = () => fakeDb.filter((r) => r.survey_version === currentSurveyVersion())
      const deleteForCurrentEnv = () => {
        const version = currentSurveyVersion()
        const before = fakeDb.length
        for (let i = fakeDb.length - 1; i >= 0; i--) if (fakeDb[i].survey_version === version) fakeDb.splice(i, 1)
        return before - fakeDb.length
      }

      process.env.VERCEL_ENV = 'preview'
      const previewSelected = selectForCurrentEnv()
      check('Preview-GET/Export sieht NUR die Preview-Antwort', previewSelected.length === 1 && previewSelected[0].marker === 'PREVIEW-TESTANTWORT')
      check('Preview-GET/Export sieht NIE die Produktionsantwort', !previewSelected.some((r) => r.marker === 'ECHTE-PRODUKTIONSANTWORT'))

      const previewDeletedCount = deleteForCurrentEnv() // simuliert den Preview-Komplettreset
      check('Preview-Komplettreset löscht genau 1 Zeile (nur seine eigene)', previewDeletedCount === 1)
      check('Produktionsantwort überlebt den Preview-Komplettreset unverändert', fakeDb.some((r) => r.marker === 'ECHTE-PRODUKTIONSANTWORT'))
      check('Preview-Antwort ist nach dem Preview-Komplettreset tatsächlich weg', !fakeDb.some((r) => r.marker === 'PREVIEW-TESTANTWORT'))

      process.env.VERCEL_ENV = 'production'
      const productionSelected = selectForCurrentEnv()
      check('Production-GET/Export sieht nach wie vor NUR die (unveränderte) Produktionsantwort',
        productionSelected.length === 1 && productionSelected[0].marker === 'ECHTE-PRODUKTIONSANTWORT')
    } finally {
      if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV
      else process.env.VERCEL_ENV = originalVercelEnv
    }
  }

  console.log('\n14. Interaktive Auswertung: Filter, Basisgrößen und Szenario-Rechnung')
  {
    const date = '2026-11-08T12:00:00Z'
    const make = (id: string, answers: Answers): SurveyRow =>
      ({ user_id: id, answers, started_at: date, updated_at: date, submitted_at: date })
    // Intentionally partial, as the pure insight function receives only already-validated rows.
    const rows: SurveyRow[] = [
      make('r1', { q1: 8, q30: 'Ja, auf jeden Fall', q4: 'Ich möchte kein Startgeld. Falls es verpflichtend wird, würde ich nicht mehr teilnehmen.', q9: 'Häufig', q20: 'Ich nutze sie, bekomme aber zu viele Benachrichtigungen', q21_recap_frequency: 'Ich lese eigentlich jeden Recap.', q_features: ['Cashout'], q29: ['Ich vergesse, rechtzeitig zu wetten'] }),
      make('r2', { q1: 8, q30: 'Eher ja', q4: 'Ich würde lieber kostenlos weiterspielen, wäre bei einem angemessenen Startgeld aber trotzdem dabei.', q5: '20 €', q9: 'Nie', q20: 'Ich habe sie bewusst deaktiviert bzw. möchte keine', q21_recap_frequency: 'Ich wusste bisher nicht, dass es Spieltags-Recaps gibt.', q_features: ['Cashout'], q29: ['Ich wette bewusst nur, wenn ich eine gute Gelegenheit sehe'] }),
      make('r3', { q1: 8, q30: 'Eher nein', q4: 'Ich würde ein Startgeld mit Preisen ausdrücklich begrüßen.', q5: '10 €', q9: 'Sehr häufig', q20: 'Ich habe sie aktiviert, aber sie kommen nicht zuverlässig an', q21_recap_frequency: 'Ich lese die meisten Recaps, aber nicht alle.', q_features: ['Individuelle Push-Einstellungen'], q29: ['Ich habe zu wenig Wildis'] }),
      make('r4', { q1: 8, q30: 'Ich bin noch unentschlossen', q4: 'Ich möchte kein Startgeld. Falls es verpflichtend wird, würde ich nicht mehr teilnehmen.', q9: 'Nie', q20: 'Ich nutze sie und finde sie hilfreich', q21_recap_frequency: 'Ich kenne die Recaps, lese sie aber nicht.', q_features: ['Keine dieser Funktionen interessiert mich'], q29: ['Ich wette bereits so häufig, wie ich möchte.'] }),
      make('r5', { q1: 8, q30: 'Ja, auf jeden Fall', q4: 'Ich würde ein Startgeld mit Preisen ausdrücklich begrüßen.', q5: '15 €', q9: 'Nie', q20: 'Ich nutze sie und finde sie hilfreich', q_features: ['Cashout'], q29: ['Ich vergesse, rechtzeitig zu wetten'] }),
      make('r6', { q1: 8, q30: 'Ja, auf jeden Fall', q4: 'Ich würde ein Startgeld mit Preisen ausdrücklich begrüßen.', q5: 'Kann ich noch nicht beurteilen', q9: 'Nie', q20: 'Ich nutze sie und finde sie hilfreich', q_features: ['Spiele favorisieren'], q29: ['Ich vergesse, rechtzeitig zu wetten'] }),
    ]
    const summary = computeSurveyDecisionInsights(rows)
    check('Q30: 4 von 6 wollen bei kostenloser Teilnahme wieder dabei sein', summary.returning.count === 4 && summary.returning.base === 6)
    check('Q4: 2 von 6 würden bei Startgeld aussteigen', summary.feeExit.count === 2 && summary.feeExit.base === 6)
    check('Q20: bewusst deaktivierte Pushs zählen nicht als technisches Problem', summary.pushProblems.count === 2 && summary.pushProblems.base === 6)
    check('Q21: 2 von 4 Antwortenden lesen die meisten Recaps', summary.recapReaders.count === 2 && summary.recapReaders.base === 4)
    check('Q5: Zahlbereitschaft 5/10/15/20-Euro-Szenarien', [3, 3, 2, 1].every((n, i) => summary.prices[i].willing === n))
    check('Q5: rechnerisches Budget niemals als reale Einnahme ausgegeben', summary.prices[2].hypotheticalBudget === 30)
    check('Feature-Ranking: „Keine“ nicht als Feature gezählt', summary.topFeatures[0].label === 'Cashout' && summary.topFeatures[0].count === 3)
    check('Q29: bewusst selektives Wetten ist kein Hindernis', !summary.topObstacles.some((r) => r.label.includes('bewusst nur')))
    check('Q29: konkretes häufigstes Hindernis hat 3 Stimmen', summary.topObstacles[0].count === 3)
    check('Segmente filtern Q4-Ausstiegsrisiko korrekt', rows.filter((r) => inSurveySegment(r.answers, 'fee_exit')).length === 2)
    check('Segmente filtern Q30-Rückkehrer korrekt', rows.filter((r) => inSurveySegment(r.answers, 'return_yes')).length === 4)
    check('Kleine Stichproben erzeugen keine automatischen Handlungsimpulse', computeSurveyDecisionInsights(rows.slice(0, 4)).suggestions.length === 0)
    check('Leere Stichprobe erzeugt keine irreführenden 0-Prozentwerte', computeSurveyDecisionInsights([]).returning.pct === null)
  }

  console.log('\n15. Betreiberfilter – Community ohne Betreiber vs. alle')
  {
    const profiles = [
      { id: 'operator', username: 'miubdb', is_admin: true },
      { id: 'another-admin', username: 'other-admin', is_admin: true },
      { id: 'player', username: 'player1', is_admin: false },
    ]
    const operatorId = findSurveyOperatorId(profiles)
    check('Nur das konkret benannte Betreiberkonto wird erkannt', operatorId === 'operator')
    check('Unpassende Konten werden nie als Betreiber angenommen',
      findSurveyOperatorId([{ id: 'fake', username: 'miubdb', is_admin: false }]) === null)
    const rows = [
      { user_id: 'operator', answers: { q30: 'Eher nein' } },
      { user_id: 'another-admin', answers: { q30: 'Eher ja' } },
      { user_id: 'player', answers: { q30: 'Ja, auf jeden Fall' } },
    ]
    const community = withoutSurveyOperator(rows, operatorId!)
    check('Community entfernt genau die Antwort des Betreibers',
      community.length === 2 && community.every((r) => r.user_id !== 'operator'))
    check('Andere Admins zählen weiterhin als Mitspieler zur Community',
      community.some((r) => r.user_id === 'another-admin'))
    check('Originalantworten bleiben für Gesamtauswertung erhalten', rows.length === 3)
    check('Community- und Gesamtquote unterscheiden sich korrekt',
      computeSurveyDecisionInsights(community.map((r) => ({
        ...r, started_at: '2026-11-08', submitted_at: '2026-11-08', updated_at: '2026-11-08',
      }))).returning.pct === 100 &&
      computeSurveyDecisionInsights(rows.map((r) => ({
        ...r, started_at: '2026-11-08', submitted_at: '2026-11-08', updated_at: '2026-11-08',
      }))).returning.count === 2)
  }

  console.log('\n16. Teilnehmer-UX – Frageblöcke ohne verlorene Fragen')
  {
    for (const section of SURVEY_SECTIONS) {
      const scenarios: Answers[] = [
        {},
        { q4: 'Ich möchte kein Startgeld. Falls es verpflichtend wird, würde ich nicht mehr teilnehmen.',
          q12: '0 – Risky-Wetten vollständig abschaffen' },
        { q4: 'Ich würde ein Startgeld mit Preisen ausdrücklich begrüßen.',
          q12: '2 Risky-Wetten', q9: 'Häufig', q25: ['1X2 / Spielausgang'],
          q20: 'Ich nutze sie, bekomme aber zu viele Benachrichtigungen' },
      ]
      for (const scenario of scenarios) {
        const visible = section.questions.filter((question) => isQuestionVisible(question, scenario))
        const pages = questionPages(visible)
        const flattened = pages.flat().map((question) => question.id)
        check(`Bereich ${section.id}: UX-Blöcke verlieren/verdoppeln keine Fragen`,
          flattened.length === visible.length && flattened.every((id, idx) => id === visible[idx].id))
        check(`Bereich ${section.id}: maximal drei Fragen je Block`,
          pages.every((page) => page.length <= 3))
        check(`Bereich ${section.id}: große Auswahllisten stehen alleine`,
          pages.every((page) => page.length <= 1 ||
            page.every((question) => (question.options?.length ?? 0) < 7 && question.id !== 'q_features')))
      }
    }
    const q4 = q('q4')
    const q5 = q('q5')
    check('Unbeantwortete Pflichtfrage blockiert den nächsten UX-Schritt',
      !pageComplete([q4], {}))
    check('Beantwortete Pflichtfrage gibt nächsten UX-Schritt frei',
      pageComplete([q4], { q4: q4.options![0] }))
    check('Bedingte Pflichtfrage wird wie bisher geprüft',
      !pageComplete([q5], { q4: 'Ich würde ein Startgeld mit Preisen ausdrücklich begrüßen.' }))
    check('Freiwilliger Freitext blockiert den UX-Schritt nicht',
      pageComplete([q('q31')], {}))
    check('Die große Feature-Frage steht in einem eigenen UX-Block',
      questionPages(visibleQuestionsForSection(SURVEY_SECTIONS[6], {})).some(
        (page) => page.length === 1 && page[0].id === 'q_features'))
  }

  console.log(`\n${checks} Prüfungen, ${failures} Fehler.`)
  return failures
}
