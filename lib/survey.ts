// Survey ("Umfrage") schema — single source of truth for the question set,
// section layout, jump/skip logic, dynamic required-ness and multi-select
// exclusivity. Used by the user-facing wizard (app/(app)/umfrage), the
// server-side validation (app/api/survey/route.ts, via lib/surveyValidation.ts)
// and the admin evaluation (app/api/admin/survey/*, lib/surveyAggregate.ts) so
// question text, options and visibility/required rules never drift between
// them — every one of those consumers must go through the helpers below
// rather than re-implementing a rule locally.
//
// Answers are stored as a single JSONB blob keyed by question id (see the
// `survey_responses` table — answers jsonb) rather than one typed column per
// question, so a new survey version can carry a completely different
// question set without a schema migration. The (user_id, survey_version)
// key lets versions coexist without touching older rows.
//
// V2 ("winter_2026_v2") replaces V1 ("winter_2026_v1") entirely — see the
// Winter-2026-V2-Auftrag Abschlussbericht for the full decision record. V1's
// rows are NEVER deleted by anything in this file or its consumers; they are
// simply no longer queried once SURVEY_VERSION points at v2 (every query in
// this codebase filters by `survey_version = SURVEY_VERSION`, so old rows
// stay in the table, just out of scope for new reads/writes).

export const SURVEY_VERSION = 'winter_2026_v2'

/** The version this schema replaces — kept only as a documented pointer for
 *  anyone who needs to query historical V1 rows directly; nothing in this
 *  module reads or writes it. */
export const SURVEY_VERSION_V1 = 'winter_2026_v1'

/**
 * app_settings key gating V2's visibility — deliberately a NEW, SEPARATE key
 * from V1's `survey_mode` (which the product already set to 'help_only' in
 * the shared database that both `main` and `integration` read from). Reusing
 * that key would make V2 instantly reachable the moment this code reaches
 * ANY deployed environment, including an `integration` preview — exactly the
 * "Aktivierung/Veröffentlichung der Umfrage" this task explicitly forbids
 * without a later, explicit release instruction. This key has no row yet, so
 * every reader's `?? 'hidden'` fallback applies until someone deliberately
 * sets it — do not pre-set it as part of this implementation. Same 3-value
 * model as V1 ('hidden' | 'help_only' | 'prominent').
 */
export const SURVEY_MODE_SETTING_KEY = 'survey_mode_v2'

export type Answers = Record<string, number | string | string[] | undefined>

export type QuestionType = 'scale' | 'single' | 'multi' | 'freetext'

/** Visual-only grouping of a subset of a multi-select question's options
 *  (the Feature-Frage's three groups) — never affects validation, maxSelect
 *  or exclusivity, which still apply across ALL of the question's options. */
export interface OptionGroup {
  label: string
  options: string[]
}

export interface QuestionDef {
  id: string
  type: QuestionType
  text: string
  /** Static required flag, OR a function of the CURRENT answers for
   *  dynamically-required questions (q13/q_payout_risky depend on q12;
   *  q5/q7/q8 depend on q4). Always evaluate through `isRequired()` below,
   *  never read this field directly — it also forces freetext questions to
   *  always be optional regardless of what's stored here. */
  required: boolean | ((a: Answers) => boolean)
  options?: string[]
  /** Multi-select: maximum number of options that may be selected at once.
   *  An exclusive option never counts against this (it's always alone). */
  maxSelect?: number
  /** Multi-select options that are mutually exclusive with every OTHER
   *  option on this question — with each other too, so more than one
   *  exclusive option is fully supported (q25, Nachvollziehbarkeit each use
   *  two). Selecting one clears every other current selection; selecting
   *  any non-exclusive option drops a currently-selected exclusive one.
   *  Replaces the old single `exclusiveOption?: string`. */
  exclusiveOptions?: string[]
  scaleMin?: number
  scaleMax?: number
  scaleMinLabel?: string
  scaleMaxLabel?: string
  /** Short helper/explanation text — for a freetext field, a placeholder-ish
   *  hint; for any other type, a one- or two-line clarification shown under
   *  the question text (e.g. "Wähle maximal zwei..."). */
  helpText?: string
  /** Sachlicher Infotext mit den AKTUELLEN Regelwerten, gerendert OBERHALB
   *  der Frage (z. B. "Aktuell liegt der maximale Einsatz bei 250 Wildis…").
   *  Deliberately separate from `helpText`, which is Ausfüllhilfe, not
   *  Ist-Zustand. */
  infoText?: string
  /** Purely presentational subheading rendered above this question (used
   *  once, for "Risky-Wetten" ahead of q12) — not a new top-level section. */
  dividerBefore?: string
  /** Presentational grouping of this question's options (Feature-Frage) —
   *  see OptionGroup. */
  optionGroups?: OptionGroup[]
  /** Short helper text rendered under an individual option's label
   *  (Feature-Frage: what each proposed feature would actually do). */
  optionHelp?: Record<string, string>
  /** Whether this question renders at all, given the answers so far.
   *  Defaults to always visible. Must only read OTHER questions' answers —
   *  no question's visibility may depend on a question that is itself
   *  conditionally visible, so a single evaluation pass is always enough
   *  (see stripHiddenAnswers in lib/surveyValidation.ts). */
  visible?: (a: Answers) => boolean
}

export interface SectionDef {
  id: number
  title: string
  questions: QuestionDef[]
}

// ---------------------------------------------------------------------------
// Shared option/value constants referenced both in an `options` array and in
// a `required`/`visible` predicate elsewhere — defined once so the two can
// never drift apart (a typo in one copy silently breaking the jump logic).
// ---------------------------------------------------------------------------

const Q9_FOLLOWUP_TRIGGERS = ['Selten', 'Gelegentlich', 'Häufig', 'Sehr häufig']

const Q12_ABOLISH = '0 – Risky-Wetten vollständig abschaffen'
const Q12_NEUTRAL = ['Ist mir egal', 'Kann ich nicht beurteilen']
// Every other Q12 option (1 Risky-Wette … Keine Begrenzung) is a "positive
// count" that makes Q13/die Risky-Auszahlung verpflichtend.

const Q19_FOLLOWUP_TRIGGERS = [
  'Ja, beim angezeigten Guthaben oder Guthabenverlauf',
  'Ja, bei der Abrechnung oder Stornierung von Wetten',
  'Ja, sowohl beim Guthaben als auch bei der Wettabrechnung',
  'Ich war mir manchmal unsicher, ob alles richtig berechnet wurde',
]

const Q20_FOLLOWUP_TRIGGERS = [
  'Ich nutze sie, bekomme aber zu viele Benachrichtigungen',
  'Ich habe sie aktiviert, aber sie kommen nicht zuverlässig an',
  'Ich nutze sie, finde sie aber kaum hilfreich',
  'Ich habe sie bewusst deaktiviert bzw. möchte keine',
  'Ich habe die Einrichtung versucht, aber sie hat nicht funktioniert',
]

const Q23_FOLLOWUP_TRIGGERS = [
  'Ich wünsche mir zusätzliche Statistiken',
  'Die vorhandenen Statistiken sollten verständlicher dargestellt werden',
  'Ich wünsche mir weniger Statistiken',
]

const Q25_MARKET_OPTIONS = [
  '1X2 / Spielausgang', 'Doppelte Chance', 'Über/Unter Tore', 'Handicap',
  'Genaues Ergebnis', 'Beide Teams treffen', 'Torschützen',
  'Spezialwetten (z. B. Gesamtzahl der Tore eines Spieltags)',
]
const Q25_NONE = 'Auf keinen – ich möchte alle behalten'
const Q25_CANT_JUDGE = 'Kann ich nicht beurteilen'

const Q29_SATISFIED = 'Ich bin mit meiner aktuellen Wettaktivität zufrieden und möchte nicht häufiger wetten'
const Q29_OTHER = 'Sonstiges'

const Q4_WOULD_LEAVE = 'Das Wettspiel soll kostenlos bleiben. Mit Startgeld würde ich nicht mehr teilnehmen.'
const Q4_UNDECIDED = 'Das kann ich erst entscheiden, wenn Höhe des Startgelds und mögliche Preise feststehen.'
// Q4 options for which Q5/Q7/Q8 are shown at all (everything except "would leave").
const Q4_SHOWS_FOLLOWUPS = (a: Answers) => typeof a.q4 === 'string' && a.q4 !== Q4_WOULD_LEAVE
// Q5 additionally excludes the "undecided" option — never ask for a max.
// amount from someone who says they can't judge it without knowing the prizes.
const Q5_VISIBLE = (a: Answers) => Q4_SHOWS_FOLLOWUPS(a) && a.q4 !== Q4_UNDECIDED

const Q7_NO_PREFERENCE = 'Keine Präferenz'

const FEATURES_NONE = 'Keine dieser Funktionen interessiert mich'

/** Q12 → is Q13 / die Risky-Auszahlungsfrage sichtbar überhaupt. */
function q12Visible(a: Answers): boolean {
  return a.q12 !== Q12_ABOLISH
}
/** Q12 → sind Q13 / die Risky-Auszahlungsfrage verpflichtend (nur bei einer
 *  "positiven" Anzahl — bei "Ist mir egal"/"Kann ich nicht beurteilen"
 *  bleiben sie sichtbar, aber freiwillig; bei "0 abschaffen" sind sie gar
 *  nicht sichtbar, siehe q12Visible). */
function q12RequiresFollowups(a: Answers): boolean {
  return q12Visible(a) && typeof a.q12 === 'string' && !Q12_NEUTRAL.includes(a.q12)
}

export const SURVEY_SECTIONS: SectionDef[] = [
  // ───────────────────────────── 1. Allgemeiner Eindruck & Bedienung ─────
  {
    id: 1,
    title: 'Allgemeiner Eindruck & Bedienung',
    questions: [
      {
        id: 'q1', type: 'scale', required: true,
        text: 'Wie zufrieden bist du insgesamt mit dem Wildenroth-Wettspiel in dieser Saison?',
        scaleMin: 1, scaleMax: 10, scaleMinLabel: 'überhaupt nicht zufrieden', scaleMaxLabel: 'sehr zufrieden',
      },
      {
        id: 'q2', type: 'scale', required: true,
        text: 'Wie einfach ist es für dich, im Wildenroth-Wettspiel eine Wette abzugeben?',
        scaleMin: 1, scaleMax: 5, scaleMinLabel: 'sehr umständlich', scaleMaxLabel: 'sehr einfach',
      },
      {
        id: 'q_comprehensibility', type: 'multi', required: true, maxSelect: 2,
        text: 'Welche Informationen im Wildenroth-Wettspiel sind für dich aktuell schwer nachzuvollziehen?',
        helpText: 'Wähle maximal zwei Bereiche aus, bei denen du dir mehr Klarheit wünschen würdest.',
        options: [
          'Ob ein Wettschein noch offen, gewonnen, verloren oder storniert ist',
          'Warum eine Wette gewonnen, verloren oder storniert wurde',
          'Wie sich die Auszahlung aus Einsatz und Quote berechnet',
          'Wie sich mein aktuelles Wildis-Guthaben zusammensetzt',
          'Warum mir Wildis gutgeschrieben oder abgezogen wurden (z. B. Taschengeld oder Strafen)',
          'Für mich ist alles ausreichend nachvollziehbar',
          'Ich beschäftige mich damit zu wenig, um es beurteilen zu können',
        ],
        exclusiveOptions: ['Für mich ist alles ausreichend nachvollziehbar', 'Ich beschäftige mich damit zu wenig, um es beurteilen zu können'],
      },
      {
        id: 'q_technical_feedback', type: 'freetext', required: false,
        text: 'Sind dir bei der Nutzung des Wildenroth-Wettspiels technische Probleme aufgefallen? Wenn ja, welche?',
        helpText: 'Zum Beispiel lange Ladezeiten, Probleme bei der Anmeldung, Fehlermeldungen, Abstürze oder Darstellungsfehler auf dem Handy. Hilfreich wäre auch, wenn du angibst, wo das Problem aufgetreten ist und welches Gerät du verwendest.',
      },
      {
        id: 'q_motivation', type: 'multi', required: false, maxSelect: 2,
        text: 'Was macht dir am Wildenroth-Wettspiel aktuell am meisten Spaß?',
        options: [
          'Der Wettbewerb um die Plätze in der Rangliste',
          'Fußballspiele analysieren und möglichst richtig tippen',
          'Die Spannung durch Kombi- und Risky-Wetten sowie hohe Wildis-Gewinne',
          'Mit Freunden und Vereinskollegen über Wetten und Ergebnisse sprechen',
          'Die Spiele von Wildenroth I und II dadurch intensiver verfolgen',
          'Die Spieltags-Recaps, Statistiken und Auszeichnungen',
          'Einfach bei einer gemeinsamen Aktion dabei sein',
          'Etwas anderes',
        ],
      },
      {
        id: 'q_motivation_text', type: 'freetext', required: false,
        text: 'Was macht dir sonst noch besonders Spaß?',
        visible: (a) => Array.isArray(a.q_motivation) && (a.q_motivation as string[]).includes('Etwas anderes'),
      },
    ],
  },

  // ───────────────────────────── 2. Quoten & Wettregeln ──────────────────
  {
    id: 2,
    title: 'Quoten & Wettregeln',
    questions: [
      {
        id: 'q3', type: 'single', required: true,
        infoText: 'Aktuell werden neue reguläre Spieltage montags vor 12 Uhr zum Wetten freigeschaltet.',
        text: 'Wann sollten reguläre Spieltage deiner Meinung nach zum Wetten freigeschaltet werden?',
        options: ['Sonntagabend', 'Montagvormittag (wie bisher)', 'Montagabend', 'Dienstag', 'Mittwoch oder später', 'Der Zeitpunkt ist mir egal'],
      },
      {
        id: 'q9', type: 'single', required: true,
        infoText: 'Zum Beispiel, wenn eine Mannschaft deiner Meinung nach viel zu stark oder zu schwach eingeschätzt wird.',
        text: 'Wie häufig fallen dir im Wildenroth-Wettspiel Quoten auf, die du für unrealistisch hältst?',
        options: ['Nie', 'Selten', 'Gelegentlich', 'Häufig', 'Sehr häufig', 'Kann ich nicht beurteilen'],
      },
      {
        id: 'q9_text', type: 'freetext', required: false,
        text: 'Kannst du ein Beispiel für eine Quote nennen, die du unrealistisch fandest?',
        helpText: 'Nenne wenn möglich das konkrete Spiel, den Wettmarkt oder die Mannschaft.',
        visible: (a) => typeof a.q9 === 'string' && Q9_FOLLOWUP_TRIGGERS.includes(a.q9),
      },
      {
        id: 'q10', type: 'single', required: true,
        infoText: 'Aktuell liegt der maximale Einsatz bei 250 Wildis pro Wettschein. Die Begrenzung soll verhindern, dass durch besonders hohe Einsätze unverhältnismäßig große Gewinne entstehen und der Wettbewerb zu stark beeinflusst wird. Zusätzlich gibt es eine maximale Auszahlung von 10.000 Wildis bei normalen und 15.000 Wildis bei Risky-Wetten.',
        text: 'Wie hoch sollte der maximale Einsatz pro Wettschein deiner Meinung nach sein?',
        options: ['100 Wildis', '200 Wildis', '250 Wildis (wie bisher)', '300 Wildis', '500 Wildis', 'Kein Einsatzlimit', 'Ist mir egal'],
      },
      {
        id: 'q11', type: 'single', required: true,
        infoText: 'Aktuell sind pro Spieltag maximal 2 normale Wettscheine und 1 Risky-Wette erlaubt.',
        text: 'Wie viele normale Wettscheine sollten pro Spieltag maximal erlaubt sein?',
        options: ['1', '2 (wie bisher)', '3', '4', '5 oder mehr', 'Keine Begrenzung', 'Ist mir egal'],
      },
      {
        id: 'q12', type: 'single', required: true,
        dividerBefore: 'Risky-Wetten',
        infoText: 'Aktuell darf jeder Teilnehmer pro Spieltag eine Risky-Wette mit einer Mindest-Gesamtquote von 20 abgeben. Zusätzlich sind zwei normale Wettscheine erlaubt.',
        text: 'Wie viele Risky-Wetten sollten deiner Meinung nach pro Spieltag erlaubt sein?',
        options: [
          Q12_ABOLISH, '1 Risky-Wette (wie bisher)', '2 Risky-Wetten', '3 Risky-Wetten', '4 oder mehr Risky-Wetten',
          'Keine Begrenzung', 'Ist mir egal', 'Kann ich nicht beurteilen',
        ],
      },
      {
        id: 'q13', type: 'single',
        required: q12RequiresFollowups,
        visible: q12Visible,
        infoText: 'Aktuell beträgt die Mindest-Gesamtquote für eine Risky-Wette 20. Höhere Mindestquoten machen Gewinne tendenziell schwerer, können dafür bei gleichem Einsatz größere Auszahlungen ermöglichen, soweit das Auszahlungslimit nicht greift.',
        text: 'Welche Mindest-Gesamtquote sollte eine Risky-Wette deiner Meinung nach haben?',
        options: ['Keine Mindestquote', '10', '15', '20 (wie bisher)', '30', '50', 'Ist mir egal'],
      },
      {
        id: 'q_payout_normal', type: 'single', required: true,
        infoText: 'Aktuell beträgt die maximale Auszahlung pro normalem Wettschein 10.000 Wildis (unabhängig von rechnerisch höherem Gewinn aus Einsatz und Quote).',
        text: 'Wie hoch sollte die maximale Auszahlung bei einem normalen Wettschein sein?',
        options: ['5.000 Wildis', '10.000 Wildis (wie bisher)', '15.000 Wildis', '20.000 Wildis', 'Mehr als 20.000 Wildis', 'Keine Begrenzung', 'Ist mir egal', 'Kann ich nicht beurteilen'],
      },
      {
        id: 'q_payout_risky', type: 'single',
        required: q12RequiresFollowups,
        visible: q12Visible,
        infoText: 'Aktuell beträgt die maximale Auszahlung bei einer Risky-Wette 15.000 Wildis.',
        text: 'Wie hoch sollte die maximale Auszahlung bei einer Risky-Wette sein?',
        options: ['10.000 Wildis', '15.000 Wildis (wie bisher)', '20.000 Wildis', '25.000 Wildis', 'Mehr als 25.000 Wildis', 'Keine Begrenzung', 'Ist mir egal', 'Kann ich nicht beurteilen'],
      },
      {
        id: 'q15', type: 'single', required: true,
        infoText: 'Aktuell erhält jeder berechtigte Teilnehmer nach jedem abgerechneten Spieltag automatisch 10 Wildis Taschengeld. Dies soll insbesondere Teilnehmern mit geringem oder leerem Guthaben die weitere Teilnahme ermöglichen.',
        text: 'Wie hoch sollte das automatische Taschengeld pro abgerechnetem Spieltag deiner Meinung nach sein?',
        options: ['0 Wildis (abschaffen)', '5 Wildis', '10 Wildis (wie bisher)', '20 Wildis', '30 Wildis', 'Mehr als 30 Wildis', 'Ist mir egal'],
      },
      {
        id: 'q16', type: 'single', required: true,
        infoText: 'Aktuell werden 50 Wildis abgezogen, wenn du an einem Spieltag keine Wette abgibst. Die Regel soll die regelmäßige Teilnahme fördern und verhindern, dass dauerhaft inaktive Spieler allein mit ihrem unveränderten Startguthaben von 1.000 Wildis vor aktiven Teilnehmern in der Rangliste landen.',
        text: 'Wie hoch sollte der Wildis-Abzug bei einem Spieltag ohne abgegebene Wette deiner Meinung nach sein?',
        options: ['0 Wildis (abschaffen)', '10 Wildis', '25 Wildis', '50 Wildis (wie bisher)', '75 Wildis', '100 Wildis', 'Ist mir egal', 'Kann ich nicht beurteilen'],
      },
    ],
  },

  // ───────────────────────────── 3. Fairness & Abrechnung ────────────────
  {
    id: 3,
    title: 'Fairness & Abrechnung',
    questions: [
      {
        id: 'q17', type: 'single', required: true,
        infoText: 'Aktuell dürfen Spieler und Trainer nicht gegen ihre eigene Mannschaft wetten. Die Regel soll Interessenkonflikte und mögliche Spielmanipulationen verhindern.',
        text: 'Welche Wettbeschränkungen sollte es für Wildenroth-Spieler und Trainer bei Spielen der eigenen Mannschaft geben?',
        options: [
          'Die bisherige Regel beibehalten – keine Wetten gegen die eigene Mannschaft',
          'Die Regel erweitern – zusätzlich Wetten auf selbst beeinflussbare Ereignisse verbieten (z. B. eigener Treffer)',
          'Alle Wetten auf Spiele der eigenen Mannschaft verbieten – auch auf Siege',
          'Die bisherige Einschränkung abschaffen – auch Wetten gegen die eigene Mannschaft erlauben',
          'Ist mir egal',
          'Kann ich nicht beurteilen',
        ],
      },
      {
        id: 'q19', type: 'single', required: true,
        text: 'Sind dir in dieser Saison Unstimmigkeiten bei der Abrechnung deiner Wetten oder deinem Wildis-Guthaben aufgefallen?',
        options: [
          'Nein, mir ist nichts Ungewöhnliches aufgefallen',
          'Ja, beim angezeigten Guthaben oder Guthabenverlauf',
          'Ja, bei der Abrechnung oder Stornierung von Wetten',
          'Ja, sowohl beim Guthaben als auch bei der Wettabrechnung',
          'Ich war mir manchmal unsicher, ob alles richtig berechnet wurde',
          'Ich kontrolliere das nicht oder kann es nicht beurteilen',
        ],
      },
      {
        id: 'q19_text', type: 'freetext', required: false,
        text: 'Was genau ist dir bei deinem Guthaben oder der Abrechnung deiner Wetten aufgefallen?',
        helpText: 'Nenne möglichst den Spieltag, die betroffene Wette und den vermuteten Betrag oder Fehler.',
        visible: (a) => typeof a.q19 === 'string' && Q19_FOLLOWUP_TRIGGERS.includes(a.q19),
      },
    ],
  },

  // ───────────────────────────── 4. Wettmärkte & Spielauswahl ────────────
  {
    id: 4,
    title: 'Wettmärkte & Spielauswahl',
    questions: [
      {
        id: 'q25', type: 'multi', required: true, maxSelect: 3,
        text: 'Auf welche der aktuell angebotenen Wettmärkte könntest du am ehesten verzichten?',
        options: [...Q25_MARKET_OPTIONS, Q25_NONE, Q25_CANT_JUDGE],
        exclusiveOptions: [Q25_NONE, Q25_CANT_JUDGE],
      },
      {
        id: 'q25_text', type: 'freetext', required: false,
        text: 'Warum könntest du auf die ausgewählten Wettmärkte verzichten?',
        helpText: 'Zum Beispiel selten genutzt, schlecht verständlich, Quoten oder andere Gründe.',
        visible: (a) => Array.isArray(a.q25) && (a.q25 as string[]).some((o) => Q25_MARKET_OPTIONS.includes(o)),
      },
      {
        id: 'q26', type: 'freetext', required: false,
        text: 'Welche zusätzlichen Wettmärkte oder Spezialwetten würdest du dir im Wildenroth-Wettspiel wünschen?',
        helpText: 'Zum Beispiel Halbzeit-Tipps, Halbzeit/Endstand, Tore einer bestimmten Mannschaft oder eigene Ideen.',
      },
      {
        id: 'q27', type: 'single', required: true,
        infoText: 'Aktuell werden alle Spiele der Kreisliga 2 zum Wetten angeboten.',
        text: 'Wie viele Spiele aus der Kreisliga 2 sollten künftig pro regulärem Spieltag zum Wetten angeboten werden?',
        options: [
          'Alle Kreisliga-Spiele (wie bisher)', 'Wildenroth I + 3–4 weitere Spiele', 'Wildenroth I + 1–2 weitere Spiele',
          'Nur Wildenroth I', 'Ist mir egal', 'Ich verfolge die Kreisliga zu wenig, um das beurteilen zu können',
        ],
      },
      {
        id: 'q28', type: 'single', required: true,
        infoText: 'Aktuell werden pro regulärem Spieltag Wildenroth II und ein ausgewähltes Topspiel aus der B-Klasse 2 angeboten.',
        text: 'Wie viele Spiele der B-Klasse 2 sollten künftig pro regulärem Spieltag zum Wetten angeboten werden?',
        options: [
          'Keine B-Klasse-Spiele', 'Nur Wildenroth II', 'Wildenroth II + 1 Topspiel (wie bisher)', 'Wildenroth II + 2–3 weitere Spiele',
          'Alle Spiele der B-Klasse 2', 'Ist mir egal', 'Ich verfolge die B-Klasse zu wenig, um das beurteilen zu können',
        ],
      },
    ],
  },

  // ───────────────────────────── 5. Kommunikation & Statistiken ──────────
  {
    id: 5,
    title: 'Kommunikation & Statistiken',
    questions: [
      {
        id: 'q20', type: 'single', required: true,
        text: 'Was trifft auf deine Nutzung der Push-Benachrichtigungen im Wildenroth-Wettspiel am ehesten zu?',
        options: [
          'Ich nutze sie und finde sie hilfreich',
          'Ich nutze sie, bekomme aber zu viele Benachrichtigungen',
          'Ich habe sie aktiviert, aber sie kommen nicht zuverlässig an',
          'Ich nutze sie, finde sie aber kaum hilfreich',
          'Ich habe sie bewusst deaktiviert bzw. möchte keine',
          'Ich kenne die Funktion, habe sie aber noch nicht eingerichtet',
          'Ich habe die Einrichtung versucht, aber sie hat nicht funktioniert',
          'Ich wusste nicht, dass es Push-Benachrichtigungen gibt',
        ],
      },
      {
        id: 'q20_text', type: 'freetext', required: false,
        text: 'Was genau stört dich an den Push-Benachrichtigungen oder hat nicht funktioniert?',
        helpText: 'Gib wenn möglich Gerät/Browser und das Problem an.',
        visible: (a) => typeof a.q20 === 'string' && Q20_FOLLOWUP_TRIGGERS.includes(a.q20),
      },
      {
        id: 'q21_recap_channel', type: 'single', required: false,
        text: 'Welche Aussage trifft am ehesten auf dich und die Spieltags-Recaps zu?',
        options: [
          'Ich lese sie hauptsächlich über WhatsApp und kenne auch die App-Version',
          'Ich lese sie hauptsächlich über WhatsApp und wusste nicht, dass es sie auch in der App gibt',
          'Ich lese sie hauptsächlich in der App',
          'Ich lese sie über WhatsApp und in der App ungefähr gleich häufig',
          'Ich lese die Recaps nur selten',
          'Ich lese die Recaps gar nicht, kenne sie aber',
          'Ich wusste bisher nicht, dass es Spieltags-Recaps gibt',
        ],
      },
      {
        id: 'q22', type: 'single', required: true,
        infoText: 'Zum Beispiel neue Spieltage, Deadlines, Recaps oder Änderungen.',
        text: 'Wie möchtest du künftig über wichtige Neuigkeiten zum Wildenroth-Wettspiel informiert werden?',
        options: [
          'WhatsApp und App-Push', 'Nur WhatsApp', 'Nur App-Push',
          'Nur Informationen innerhalb der App, ohne zusätzliche Benachrichtigungen', 'Ich möchte keine Benachrichtigungen', 'Ist mir egal',
        ],
      },
      {
        id: 'q23', type: 'single', required: false,
        infoText: 'Gemeint sind die persönlichen Wettstatistiken im Profil, z. B. Gewinnserien, Lieblingsmarkt oder durchschnittliche Quote — nicht externe BFV-/FuPa-Statistiken.',
        text: 'Was würdest du dir für die persönlichen Wettstatistiken in deinem Profil wünschen?',
        options: [
          'Ich wünsche mir zusätzliche Statistiken',
          'Die vorhandenen Statistiken sollten verständlicher dargestellt werden',
          'Die Statistiken sind so, wie sie sind, gut',
          'Ich wünsche mir weniger Statistiken',
          'Ich brauche keine persönlichen Wettstatistiken',
          'Ich habe sie mir noch nicht angesehen oder kann sie nicht beurteilen',
        ],
      },
      {
        id: 'q23_text', type: 'freetext', required: false,
        text: 'Was würdest du an den persönlichen Wettstatistiken konkret ergänzen, verbessern oder entfernen?',
        visible: (a) => typeof a.q23 === 'string' && Q23_FOLLOWUP_TRIGGERS.includes(a.q23),
      },
    ],
  },

  // ───────────────────────────── 6. Startgeld & Preise ───────────────────
  {
    id: 6,
    title: 'Startgeld & Preise',
    questions: [
      {
        id: 'q4', type: 'single', required: true,
        infoText: 'Das Wildenroth-Wettspiel ist aktuell kostenlos. Für die Saison 2027/28 überlegen wir, ein verpflichtendes Startgeld einzuführen, mit dem Preise am Saisonende finanziert werden könnten.',
        text: 'Welche Aussage beschreibt deine Einstellung zu einem möglichen Startgeld am besten?',
        options: [
          Q4_WOULD_LEAVE,
          'Ich bevorzuge ein kostenloses Wettspiel, würde bei einem passenden Startgeld aber weiterhin teilnehmen.',
          'Ich würde ein Startgeld mit Preisen bevorzugen.',
          'Beide Modelle sind für mich in Ordnung, solange das Startgeld passt.',
          Q4_UNDECIDED,
        ],
      },
      {
        id: 'q5', type: 'single',
        required: Q5_VISIBLE, visible: Q5_VISIBLE,
        text: 'Welchen Betrag wärst du maximal bereit, als Startgeld für eine Saison zu bezahlen?',
        options: ['Weniger als 5 €', '5 €', '10 €', '15 €', '20 €', 'Mehr als 20 €', 'Kann ich noch nicht beurteilen'],
      },
      {
        id: 'q7', type: 'multi', maxSelect: 2,
        required: Q4_SHOWS_FOLLOWUPS, visible: Q4_SHOWS_FOLLOWUPS,
        text: 'Welche Arten von Preisen würdest du beim Wildenroth-Wettspiel am liebsten gewinnen?',
        options: ['Geldpreise', 'Gutscheine (z. B. Bürgi-Getränke)', 'Wanderpokale', 'Wildenroth-Merchandise', 'Andere Sachpreise', 'Erlebnispreise (z. B. Fußballtickets, Veranstaltungen)', Q7_NO_PREFERENCE],
        exclusiveOptions: [Q7_NO_PREFERENCE],
      },
      {
        id: 'q8', type: 'single',
        required: Q4_SHOWS_FOLLOWUPS, visible: Q4_SHOWS_FOLLOWUPS,
        text: 'Wie sollte das Preisbudget am Saisonende deiner Meinung nach verteilt werden?',
        options: [
          'Wenige, dafür größere Preise für die Bestplatzierten',
          'Größere Hauptpreise und zusätzlich kleinere Preise, z. B. für besondere Leistungen',
          'Möglichst viele Teilnehmer sollen einen kleineren Preis erhalten können',
          'Ist mir egal',
          'Kann ich ohne konkretes Preisbudget noch nicht beurteilen',
        ],
      },
    ],
  },

  // ───────────────────────────── 7. Zukunft & Verbesserungen ─────────────
  {
    id: 7,
    title: 'Zukunft & Verbesserungen',
    questions: [
      {
        id: 'q29', type: 'multi', required: true, maxSelect: 3,
        text: 'Welche Gründe führen dazu, dass du manchmal weniger wettest oder einen Spieltag auslässt?',
        options: [
          'Ich vergesse, rechtzeitig zu wetten',
          'Mir fehlt manchmal die Zeit',
          'Der Zeitpunkt der Wettöffnung oder des Wettschlusses passt nicht',
          'Die Auswahl an Spielen ist mir zu unübersichtlich',
          'Es gibt keine Spiele, auf die ich wetten möchte',
          'Es fehlen interessante Wettmärkte',
          'Die angebotenen Quoten sind für mich nicht attraktiv',
          'Ich habe zu wenig Wildis',
          'Ich möchte mein vorhandenes Guthaben nicht riskieren',
          'Die Wettabgabe ist mir zu umständlich',
          'Ich wette bewusst nur, wenn ich eine gute Gelegenheit sehe',
          Q29_SATISFIED,
          Q29_OTHER,
        ],
        exclusiveOptions: [Q29_SATISFIED],
      },
      {
        id: 'q29_text', type: 'freetext', required: false,
        text: 'Welcher weitere Grund führt dazu, dass du manchmal weniger wettest oder einen Spieltag auslässt?',
        visible: (a) => Array.isArray(a.q29) && (a.q29 as string[]).includes(Q29_OTHER),
      },
      {
        id: 'q30', type: 'single', required: true,
        text: 'Planst du, auch in der Saison 2027/28 wieder am Wildenroth-Wettspiel teilzunehmen?',
        options: ['Ja, auf jeden Fall', 'Eher ja', 'Ich bin noch unentschlossen', 'Eher nein', 'Nein, voraussichtlich nicht'],
      },
      {
        id: 'q_features', type: 'multi', required: true, maxSelect: 3,
        text: 'Welche neuen Funktionen würdest du dir für das Wildenroth-Wettspiel am meisten wünschen?',
        helpText: 'Wähle insgesamt maximal drei Funktionen aus. Die Vorschläge sind Ideen und noch keine zugesagten Funktionen.',
        options: [
          'Cashout', 'Quotenänderungen & Quotenverlauf', 'Same-Game-Kombis', 'Systemwetten', 'Wildi-Boost', 'Wettscheine als Entwurf speichern',
          'Spieler-Duelle', 'Zusätzliche Achievements', 'Wochen-Challenges', 'Zusätzliche Ranglisten',
          'Individuelle Push-Einstellungen', 'Spiele favorisieren', 'Wettscheine teilen',
          FEATURES_NONE,
        ],
        exclusiveOptions: [FEATURES_NONE],
        optionGroups: [
          { label: 'Wetten & Quoten', options: ['Cashout', 'Quotenänderungen & Quotenverlauf', 'Same-Game-Kombis', 'Systemwetten', 'Wildi-Boost', 'Wettscheine als Entwurf speichern'] },
          { label: 'Community & Wettbewerb', options: ['Spieler-Duelle', 'Zusätzliche Achievements', 'Wochen-Challenges', 'Zusätzliche Ranglisten'] },
          { label: 'Bedienung & Kommunikation', options: ['Individuelle Push-Einstellungen', 'Spiele favorisieren', 'Wettscheine teilen'] },
        ],
        optionHelp: {
          'Cashout': 'Laufende Wetten vorzeitig gegen eine angebotene Auszahlung beenden.',
          'Quotenänderungen & Quotenverlauf': 'Quoten können sich während der Wettphase ändern. Du kannst nachvollziehen, wie sie sich entwickelt haben. Bereits abgegebene Wetten behalten ihre ursprüngliche Quote.',
          'Same-Game-Kombis': 'Mehrere Tipps zum selben Spiel kombinieren, z. B. Wildenroth-Sieg und über 2,5 Tore.',
          'Systemwetten': 'Beispielsweise bei einer 2-aus-3-Wette auch mit einem falschen Tipp noch eine Auszahlung erhalten.',
          'Wildi-Boost': 'Freiwillig auf Siege von Wildenroth I und II tippen und bei Erfolg einen zusätzlichen Bonus erhalten.',
          'Wettscheine als Entwurf speichern': 'Tipps zusammenstellen, für später merken und erst dann verbindlich abgeben.',
          'Spieler-Duelle': 'Gegen andere Teilnehmer in einem direkten Tippvergleich antreten.',
          'Zusätzliche Achievements': 'Neue sammelbare Erfolge und Abzeichen als Erweiterung des bestehenden Pokalschranks.',
          'Wochen-Challenges': 'Freiwillige Aufgaben und Herausforderungen zusätzlich zu den bestehenden Bonus-Tipps.',
          'Zusätzliche Ranglisten': 'Beispielsweise Monatswertungen oder eine Risky-Rangliste.',
          'Individuelle Push-Einstellungen': 'Selbst entscheiden, welche Arten von Benachrichtigungen man erhält.',
          'Spiele favorisieren': 'Interessante Spiele markieren und schneller wiederfinden.',
          'Wettscheine teilen': 'Eigene Wetten oder Gewinne als Bild oder Link mit Freunden teilen.',
        },
      },
      {
        id: 'q_features_text', type: 'freetext', required: false,
        text: 'Hast du noch eine eigene Feature-Idee?',
        helpText: 'Welche weiteren Funktionen fehlen dir?',
      },
      {
        id: 'q31', type: 'freetext', required: false,
        text: 'Wenn du genau EINE Sache am Wildenroth-Wettspiel ändern oder verbessern könntest – welche wäre das?',
        helpText: 'Zum Beispiel Regeln, Märkte, Bedienung oder eine neue Funktion.',
      },
    ],
  },
]

export const ALL_QUESTIONS: QuestionDef[] = SURVEY_SECTIONS.flatMap((s) => s.questions)
export const QUESTION_BY_ID: Map<string, QuestionDef> = new Map(ALL_QUESTIONS.map((q) => [q.id, q]))

/** Resolves a question's required-ness for the CURRENT answers — the one
 *  place every consumer (UI, API validation, admin) must go through instead
 *  of reading `q.required` directly. Free-text is always optional. */
export function isRequired(q: QuestionDef, answers: Answers): boolean {
  if (q.type === 'freetext') return false
  return typeof q.required === 'function' ? q.required(answers) : q.required
}

export function isQuestionVisible(q: QuestionDef, answers: Answers): boolean {
  return q.visible ? q.visible(answers) : true
}

/** Questions that actually render for a section given current answers — hidden/skipped questions are excluded entirely, not just hidden in the UI. */
export function visibleQuestionsForSection(section: SectionDef, answers: Answers): QuestionDef[] {
  return section.questions.filter((q) => isQuestionVisible(q, answers))
}

function isAnswered(q: QuestionDef, answers: Answers): boolean {
  const v = answers[q.id]
  if (q.type === 'multi') return Array.isArray(v) && v.length > 0
  if (q.type === 'scale') return typeof v === 'number' && !Number.isNaN(v)
  return typeof v === 'string' && v.trim().length > 0
}

/** A section is "complete" when every VISIBLE, currently-required question
 *  is answered. Hidden questions are never checked. */
export function isSectionComplete(section: SectionDef, answers: Answers): boolean {
  return visibleQuestionsForSection(section, answers).every((q) => {
    if (!isRequired(q, answers)) return true
    return isAnswered(q, answers)
  })
}

export function isSurveyComplete(answers: Answers): boolean {
  return SURVEY_SECTIONS.every((s) => isSectionComplete(s, answers))
}

/** All questions that are visible anywhere given the final answer set — used by admin views to render only the Q&A that actually applied to this respondent (jump logic respected, not shown as "not answered"). */
export function visibleQuestionsForAnswers(answers: Answers): QuestionDef[] {
  return ALL_QUESTIONS.filter((q) => isQuestionVisible(q, answers))
}
