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
import {
  toggleMultiOption, isValidMultiSelection, validateIncomingAnswers, stripHiddenAnswers, nextSubmittedAt,
} from '@/lib/surveyValidation'
import { isActuallySubmitted, type SurveyRow } from '@/lib/surveyAggregate'
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
      q17: 'Die bisherige Regel beibehalten – keine Wetten gegen die eigene Mannschaft',
      q19: 'Nein, mir ist nichts Ungewöhnliches aufgefallen',
      q25: ['Auf keinen – ich möchte alle behalten'],
      q27: 'Alle Kreisliga-Spiele (wie bisher)', q28: 'Wildenroth II + 1 Topspiel (wie bisher)',
      q20: 'Ich nutze sie und finde sie hilfreich', q22: 'WhatsApp und App-Push',
      q4: 'Das Wettspiel soll kostenlos bleiben. Mit Startgeld würde ich nicht mehr teilnehmen.',
      q29: ['Ich bin mit meiner aktuellen Wettaktivität zufrieden und möchte nicht häufiger wetten'],
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
    const incompleteAfterEdit: Answers = { ...complete, q4: 'Ich würde ein Startgeld mit Preisen bevorzugen.' }
    check('Testvorlage wird durch den Q4-Wechsel tatsächlich unvollständig (Q5/Q7/Q8 jetzt Pflicht, fehlen)',
      !isSurveyComplete(incompleteAfterEdit), 'Testdaten-Fehler, nicht Produktionscode')
    check('save: bereits abgegeben, aber nach Bearbeitung unvollständig → wird auf null zurückgesetzt (der gemeldete Bug)',
      nextSubmittedAt('save', earlier, incompleteAfterEdit, now) === null)

    // isActuallySubmitted: zweite, unabhängige Absicherung in der Admin-Auswertung.
    const rowOk: SurveyRow = { user_id: 'u1', answers: complete, started_at: earlier, submitted_at: earlier, updated_at: now }
    const rowStaleFlag: SurveyRow = { user_id: 'u2', answers: incompleteAfterEdit, started_at: earlier, submitted_at: earlier, updated_at: now }
    const rowNotSubmitted: SurveyRow = { user_id: 'u3', answers: complete, started_at: earlier, submitted_at: null, updated_at: now }
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

  console.log(`\n${checks} Prüfungen, ${failures} Fehler.`)
  return failures
}
