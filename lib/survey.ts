// Survey ("Umfrage") schema — single source of truth for the question set,
// section layout, and jump/skip logic. Used by both the user-facing wizard
// (app/(app)/umfrage) and the admin evaluation (app/api/admin/survey/*) so
// question text, options, and visibility rules never drift between the two.
//
// Answers are stored as a single JSONB blob keyed by question id (see the
// `survey_responses` migration) rather than one typed column per question —
// with 32 heterogeneous questions (scale/single/multi/free-text) and future
// survey versions carrying a different question set entirely, per-column
// storage would mean a schema migration for every future survey. The
// (user_id, survey_version) key lets new versions coexist without touching
// old rows.

export const SURVEY_VERSION = 'winter_2026_v1'

export type Answers = Record<string, number | string | string[] | undefined>

export type QuestionType = 'scale' | 'single' | 'multi' | 'freetext'

export interface QuestionDef {
  id: string
  type: QuestionType
  text: string
  /** Free-text questions are ALWAYS optional — this flag only applies to non-freetext questions. */
  required: boolean
  options?: string[]
  maxSelect?: number
  scaleMin?: number
  scaleMax?: number
  scaleMinLabel?: string
  scaleMaxLabel?: string
  /** Placeholder / helper text shown under a freetext field. */
  freetextLabel?: string
  /** Whether this question renders at all, given answers so far. Defaults to always visible. */
  visible?: (a: Answers) => boolean
}

export interface SectionDef {
  id: number
  title: string
  questions: QuestionDef[]
}

const MARKET_OPTIONS = [
  '1X2 / Sieger', 'Doppelte Chance', 'Über / Unter', 'Handicap',
  'Genaues Ergebnis', 'Beide Teams treffen', 'Torschützen', 'Kombiwetten', 'Spezialwetten',
]

export const SURVEY_SECTIONS: SectionDef[] = [
  {
    id: 1,
    title: 'Allgemeiner Eindruck',
    questions: [
      {
        id: 'q1', type: 'scale', required: true,
        text: 'Wie zufrieden bist du aktuell insgesamt mit dem Wildenroth-Wettspiel?',
        scaleMin: 1, scaleMax: 10, scaleMinLabel: 'überhaupt nicht zufrieden', scaleMaxLabel: 'sehr zufrieden',
      },
      {
        id: 'q2', type: 'scale', required: true,
        text: 'Wie einfach findest du es aktuell, eine Wette abzugeben und danach nachzuvollziehen, ob sie offen, gewonnen, verloren oder storniert wurde?',
        scaleMin: 1, scaleMax: 5, scaleMinLabel: 'sehr umständlich', scaleMaxLabel: 'sehr einfach',
      },
      {
        id: 'q3', type: 'single', required: true,
        text: 'Werden die Spieltage für dich früh genug zum Wetten geöffnet?',
        options: ['Ja, passt genau', 'Meistens schon', 'Eher zu spät', 'Viel zu spät', 'Teilweise sogar zu früh', 'Ist mir egal'],
      },
    ],
  },
  {
    id: 2,
    title: 'Startgeld & Preise',
    questions: [
      {
        id: 'q4', type: 'single', required: true,
        text: 'Wärst du grundsätzlich bereit, wie beim anderen Wildenroth-Tippspiel, ein kleines Startgeld zu zahlen, wenn dafür am Saisonende richtige Preise ausgeschüttet werden?',
        options: ['Ja', 'Nein', 'Kommt auf die Höhe an'],
      },
      {
        id: 'q5', type: 'single', required: true,
        text: 'Welches Startgeld wäre für dich noch vollkommen in Ordnung?',
        options: ['5 €', '10 €', '15 €', '20 €', 'Mehr als 20 €'],
        visible: (a) => a.q4 === 'Ja' || a.q4 === 'Kommt auf die Höhe an',
      },
      {
        id: 'q6', type: 'single', required: true,
        text: 'Würde ein Startgeld verändern, wie du spielst?',
        options: [
          'Nein, ich würde genauso mitmachen wie bisher',
          'Ich würde etwas vorsichtiger wetten',
          'Ich würde vermutlich seltener mitmachen',
          'Bei echtem Startgeld würde ich wahrscheinlich nicht mehr teilnehmen',
        ],
        visible: (a) => a.q4 === 'Ja' || a.q4 === 'Kommt auf die Höhe an',
      },
      {
        id: 'q7', type: 'multi', required: true, maxSelect: 2,
        text: 'Welche Preise fändest du am attraktivsten?',
        options: ['Bargeld', 'Gutschein', 'Wildenroth-Merchandise / witziges Vereins-Merch', 'Pokal / Trophäe', 'Sachpreise', 'Ist mir eigentlich egal'],
      },
      {
        id: 'q8', type: 'single', required: true,
        text: 'Wie sollten die Preise deiner Meinung nach verteilt werden?',
        options: [
          'Lieber wenige richtig gute Preise für die Besten',
          'Mischung aus größeren und kleineren Preisen',
          'Lieber möglichst viele Teilnehmer bekommen etwas',
          'Ist mir egal',
        ],
      },
    ],
  },
  {
    id: 3,
    title: 'Spielmechanik',
    questions: [
      {
        id: 'q9', type: 'single', required: true,
        text: 'Wie empfindest du die Quoten im Wettspiel insgesamt?',
        options: ['Sehr fair', 'Eher fair', 'Teilweise komisch / schwer nachvollziehbar', 'Häufig unfair', 'Damit beschäftige ich mich nicht wirklich'],
      },
      {
        id: 'q9_text', type: 'freetext', required: false,
        text: 'Falls dir bei den Quoten etwas besonders aufgefallen ist, kannst du es hier dazuschreiben.',
      },
      {
        id: 'q10', type: 'single', required: true,
        text: 'Aktuell dürfen maximal 250 Wildis auf eine einzelne Wette gesetzt werden. Wie findest du dieses Limit?',
        options: ['Zu niedrig', 'Genau richtig', 'Zu hoch', 'Ist mir egal'],
      },
      {
        id: 'q11', type: 'single', required: true,
        text: 'Wie findest du die aktuelle Begrenzung auf 2 normale Wettscheine + 1 Risky-Wette pro Spieltag?',
        options: ['Zu wenig', 'Genau richtig', 'Zu viele', 'Ich wusste nicht, dass es diese Begrenzung gibt'],
      },
      {
        id: 'q12', type: 'single', required: true,
        text: 'Wie findest du die Risky-Wette grundsätzlich?',
        options: ['Sehr gut', 'Ganz nett', 'Nutze ich kaum', 'Könnte für mich weg'],
      },
      {
        id: 'q13', type: 'single', required: true,
        text: 'Die Risky-Wette benötigt aktuell eine Gesamtquote von mindestens 20. Wie findest du diese Grenze?',
        options: ['Zu niedrig', 'Genau richtig', 'Zu hoch', 'Ist mir egal'],
        visible: (a) => a.q12 !== 'Könnte für mich weg',
      },
      {
        id: 'q14', type: 'single', required: true,
        text: 'War dir bewusst, dass es pro Wettschein eine maximale Auszahlung gibt (aktuell 10.000 Wildis, bei einer Risky-Wette 15.000 Wildis)?',
        options: ['Ja', 'Nein'],
      },
      {
        id: 'q14_follow', type: 'single', required: true,
        text: 'Wie findest du diesen Auszahlungsdeckel grundsätzlich?',
        options: ['Sollte niedriger sein', 'Passt', 'Sollte höher sein', 'Sollte es gar nicht geben'],
        visible: (a) => a.q14 === 'Ja',
      },
      {
        id: 'q15', type: 'single', required: true,
        text: 'Nach jedem Spieltag gibt es jeden Montag automatisch 10 Wildis Taschengeld – auch damit Spieler ohne Guthaben weiterspielen können. Wie findest du die Höhe?',
        options: ['Zu wenig', 'Passt', 'Zu viel', 'Ist mir egal'],
      },
      {
        id: 'q16', type: 'single', required: true,
        text: 'Wenn an einem Spieltag gar keine Wette abgegeben wird, werden 50 Wildis abgezogen. Wie wirkt diese Regel auf dich?',
        options: [
          'Motiviert mich tatsächlich mitzumachen', 'Finde ich fair', 'Ist mir ziemlich egal',
          'Nervt mich eher', 'Sollte abgeschafft werden', 'Ich wusste nichts von der Regel',
        ],
      },
    ],
  },
  {
    id: 4,
    title: 'Fairness',
    questions: [
      {
        id: 'q17', type: 'single', required: true,
        text: 'Wildenroth-Spieler und Trainer dürfen nicht gegen das eigene Team wetten. Wie findest du diese Regel?',
        options: ['Genau richtig', 'Eher sinnvoll', 'Zu streng', 'Ist mir egal'],
      },
      {
        id: 'q18', type: 'single', required: true,
        text: 'Wie stehst du dazu, wenn Spieler auf Märkte wetten könnten, die sie theoretisch selbst beeinflussen können – z. B. eigenes Tor oder bestimmte Über-/Unter-Märkte?',
        options: [
          'Sehe ich kein Problem', 'Manche Märkte sollte man für beteiligte Spieler sperren',
          'Solche Märkte sollten für beteiligte Spieler grundsätzlich gesperrt sein', 'Ist mir egal',
        ],
      },
      {
        id: 'q19', type: 'scale', required: true,
        text: 'Wie sehr vertraust du darauf, dass Auswertungen, Stornos, Quoten und Abrechnungen im Wettspiel fair und nachvollziehbar durchgeführt werden?',
        scaleMin: 1, scaleMax: 5, scaleMinLabel: 'wenig Vertrauen', scaleMaxLabel: 'volles Vertrauen',
      },
      {
        id: 'q19_text', type: 'freetext', required: false,
        text: 'Falls dir bei Fairness oder Abrechnung schon einmal etwas negativ aufgefallen ist, kannst du es hier dazuschreiben.',
      },
    ],
  },
  {
    id: 5,
    title: 'Kommunikation',
    questions: [
      {
        id: 'q20', type: 'single', required: true,
        text: 'Wie sieht es bei dir mit Push-Benachrichtigungen aus?',
        options: [
          'Nutze ich und finde ich hilfreich', 'Nutze ich, bekomme aber teilweise zu viele',
          'Habe ich bewusst deaktiviert', 'Habe ich nicht eingerichtet',
          'Hat bei mir nicht funktioniert', 'Wusste nicht, dass es Push-Benachrichtigungen gibt',
        ],
      },
      {
        id: 'q20_text', type: 'freetext', required: false,
        text: 'Was genau hat nicht funktioniert?',
        visible: (a) => a.q20 === 'Hat bei mir nicht funktioniert',
      },
      {
        id: 'q21', type: 'single', required: true,
        text: 'Wie oft liest du die Spieltags-Recaps in der WhatsApp-Gruppe?',
        options: ['Fast immer', 'Häufig', 'Manchmal', 'Selten', 'Nie'],
      },
      {
        id: 'q21_follow', type: 'single', required: true,
        text: 'Wie findest du die Recaps grundsätzlich?',
        options: ['Gehören für mich dazu', 'Ganz interessant', 'Könnten kürzer sein', 'Könnten ausführlicher sein', 'Sind mir eigentlich egal'],
        visible: (a) => a.q21 !== undefined && a.q21 !== 'Nie',
      },
      {
        id: 'q22', type: 'single', required: true,
        text: 'Wie möchtest du über das Wettspiel informiert werden?',
        options: [
          'App + WhatsApp wie bisher', 'Die App alleine würde mir reichen',
          'WhatsApp ist für mich wichtiger als App-Benachrichtigungen', 'Ich brauche eigentlich kaum Benachrichtigungen',
        ],
      },
    ],
  },
  {
    id: 6,
    title: 'Statistiken',
    questions: [
      {
        id: 'q23', type: 'single', required: true,
        text: 'Wie findest du die persönlichen Statistiken im Profil, z. B. Gewinnserie, Lieblingsmarkt oder durchschnittliche Quote?',
        options: ['Finde ich sehr interessant', 'Ganz nett', 'Schaue ich kaum an', 'Brauche ich nicht', 'Ich hätte gerne noch mehr Statistiken'],
      },
      {
        id: 'q23_text', type: 'freetext', required: false,
        text: 'Welche Statistik würdest du gerne noch sehen?',
        visible: (a) => a.q23 === 'Ich hätte gerne noch mehr Statistiken',
      },
    ],
  },
  {
    id: 7,
    title: 'Wettmärkte & Spielumfang',
    questions: [
      {
        id: 'q24', type: 'multi', required: true,
        text: 'Welche Wettarten nutzt du gerne?',
        options: MARKET_OPTIONS,
      },
      {
        id: 'q25', type: 'multi', required: false,
        text: 'Gibt es einen Wettmarkt, auf den du problemlos verzichten könntest?',
        options: [...MARKET_OPTIONS, 'Keiner'],
      },
      {
        id: 'q25_text', type: 'freetext', required: false,
        text: 'Magst du das noch genauer beschreiben?',
      },
      {
        id: 'q26', type: 'freetext', required: false,
        text: 'Gibt es eine Wettart oder Spezialwette, die dir bisher fehlt?',
      },
      {
        id: 'q27', type: 'single', required: true,
        text: 'Wie viele Spiele sollten an einem normalen Spieltag ungefähr tippbar sein?',
        options: [
          'Möglichst alle Ligaspiele wie bisher', 'Wildenroth I + II und einige interessante Topspiele',
          'Hauptsächlich Spiele mit Wildenroth-Beteiligung', 'Lieber nur wenige ausgewählte Spiele', 'Ist mir egal',
        ],
      },
      {
        id: 'q28', type: 'single', required: true,
        text: 'Wie findest du die aktuelle Einbindung der B-Klasse mit Wildenroth II und ausgewählten weiteren Spielen?',
        options: ['Genau richtig', 'Ich hätte gerne mehr B-Klasse', 'Ich hätte gerne weniger B-Klasse', 'Interessiert mich kaum', 'Ist mir egal'],
      },
    ],
  },
  {
    id: 8,
    title: 'Zukunft',
    questions: [
      {
        id: 'q29', type: 'multi', required: true,
        text: 'Was sind Gründe dafür, dass du an einem Spieltag manchmal gar nicht oder nur wenig wettest?',
        options: [
          'Ich vergesse es', 'Keine Zeit', 'Wettöffnung / Deadline passt für mich nicht', 'Zu viele Spiele',
          'Keine interessanten Spiele', 'Keine interessanten Wettmärkte', 'Zu wenig Wildis',
          'App ist teilweise zu umständlich', 'Ich will mein Guthaben nicht riskieren',
          'Ich mache eigentlich fast immer mit', 'Sonstiges',
        ],
      },
      {
        id: 'q29_text', type: 'freetext', required: false,
        text: 'Magst du das noch genauer beschreiben?',
        visible: (a) => Array.isArray(a.q29) && (a.q29 as string[]).includes('Sonstiges'),
      },
      {
        id: 'q30', type: 'scale', required: true,
        text: 'Wie wahrscheinlich ist es aktuell, dass du auch nächste Saison wieder beim Wildenroth-Wettspiel mitmachst?',
        scaleMin: 1, scaleMax: 10, scaleMinLabel: 'sehr unwahrscheinlich', scaleMaxLabel: 'auf jeden Fall',
      },
      {
        id: 'q31', type: 'freetext', required: false,
        text: 'Wenn du für die nächste Saison genau EINE Sache am Wettspiel ändern, verbessern oder ergänzen könntest – was wäre es?',
      },
      {
        id: 'q32', type: 'freetext', required: false,
        text: 'Gibt es sonst noch etwas, das du loswerden möchtest?',
      },
    ],
  },
]

export const ALL_QUESTIONS: QuestionDef[] = SURVEY_SECTIONS.flatMap((s) => s.questions)
export const QUESTION_BY_ID: Map<string, QuestionDef> = new Map(ALL_QUESTIONS.map((q) => [q.id, q]))

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

/** A section is "complete" when every VISIBLE required question is answered. Free-text questions never block completion, and hidden questions are never checked. */
export function isSectionComplete(section: SectionDef, answers: Answers): boolean {
  return visibleQuestionsForSection(section, answers).every((q) => {
    if (q.type === 'freetext' || !q.required) return true
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
