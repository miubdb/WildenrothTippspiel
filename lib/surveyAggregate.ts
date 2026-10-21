// Server-side aggregation for the admin "Umfrage" evaluation (V2). Pure
// functions over already-fetched survey_responses rows — no DB access here,
// no hardcoded numbers beyond option-text constants that mirror lib/survey.ts
// 1:1: every figure is derived from the `answers` JSONB of the rows passed
// in. Kept in its own file so the per-question / cross-tab math is easy to
// unit-reason-about and to reuse between the aggregate endpoint and (if ever
// needed) the CSV export.
import { ALL_QUESTIONS, QUESTION_BY_ID, isQuestionVisible, type Answers, type QuestionDef } from './survey'

export interface SurveyRow {
  user_id: string
  answers: Answers
  started_at: string
  submitted_at: string | null
  updated_at: string
}

export interface ProfileLite {
  id: string
  username: string
  display_name: string | null
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function isAnswerPresent(qid: string, answers: Answers): boolean {
  const v = answers[qid]
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'number') return !Number.isNaN(v)
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * Rows for which `q` was actually shown given jump logic (evaluated against
 * that row's OWN final answers). This is the denominator every per-question
 * stat must use, NOT "rows with a non-empty answer" — a conditionally
 * visible-but-optional question (q21_recap_channel, q23, q5/q7/q8, q13,
 * q_payout_risky, …) can be shown to someone who then leaves it blank, and
 * that is a real, reportable "freiwillig nicht beantwortet" case, distinct
 * from "Frage nicht gezeigt" (not in this denominator at all). A required-
 * when-visible question's visible count and answered count coincide among
 * SUBMITTED rows (submission blocks otherwise) — computing from visibility
 * directly rather than inferring it from "has a value" stays correct either
 * way, and surfaces a would-be data bug (a stale answer behind a since-
 * hidden question) instead of masking it.
 */
function visibleRows(q: QuestionDef, rows: SurveyRow[]) {
  return rows.filter((r) => isQuestionVisible(q, r.answers))
}

export interface SingleChoiceStat {
  questionId: string
  text: string
  /** Rows the question was shown to (see visibleRows doc) — NOT the full
   *  submitted-response count for a conditional question. */
  total: number
  options: { option: string; count: number; pct: number }[]
  /** total − Σ option counts: visible but left blank — always 0 for an
   *  unconditionally-required question (submission blocks otherwise); a
   *  non-zero value here for q5/q7/q8/q13/q_payout_risky/q21_recap_channel/
   *  q23 is the real "freiwillig nicht beantwortet" count, distinct from
   *  "nicht gezeigt" (never in `total` to begin with). */
  shownButUnanswered: number
}

function singleChoiceStats(q: QuestionDef, rows: SurveyRow[]): SingleChoiceStat {
  const visible = visibleRows(q, rows)
  const total = visible.length
  const counts = new Map<string, number>()
  for (const opt of q.options ?? []) counts.set(opt, 0)
  let answeredCount = 0
  for (const r of visible) {
    const v = r.answers[q.id]
    if (typeof v === 'string') { counts.set(v, (counts.get(v) ?? 0) + 1); answeredCount++ }
  }
  return {
    questionId: q.id,
    text: q.text,
    total,
    options: [...counts.entries()].map(([option, count]) => ({
      option, count, pct: total > 0 ? (count / total) * 100 : 0,
    })),
    shownButUnanswered: total - answeredCount,
  }
}

export interface ScaleStat {
  questionId: string
  text: string
  total: number
  avg: number | null
  median: number | null
  distribution: { value: number; count: number }[]
  buckets?: { label: string; count: number; pct: number }[]
}

function scaleStats(q: QuestionDef, rows: SurveyRow[]): ScaleStat {
  const visible = visibleRows(q, rows)
  const nums = visible.map((r) => r.answers[q.id]).filter((n): n is number => typeof n === 'number')
  const total = visible.length
  const min = q.scaleMin ?? 1
  const max = q.scaleMax ?? 5
  const distMap = new Map<number, number>()
  for (let v = min; v <= max; v++) distMap.set(v, 0)
  for (const n of nums) distMap.set(n, (distMap.get(n) ?? 0) + 1)
  const distribution = [...distMap.entries()].map(([value, count]) => ({ value, count }))

  let buckets: ScaleStat['buckets']
  if (max === 10 && min === 1) {
    const ranges: [string, number, number][] = [['1–3', 1, 3], ['4–6', 4, 6], ['7–8', 7, 8], ['9–10', 9, 10]]
    buckets = ranges.map(([label, lo, hi]) => {
      const count = nums.filter((n) => n >= lo && n <= hi).length
      return { label, count, pct: total > 0 ? (count / total) * 100 : 0 }
    })
  }

  return {
    questionId: q.id, text: q.text, total,
    avg: avg(nums), median: median(nums), distribution, buckets,
  }
}

export interface MultiStat {
  questionId: string
  text: string
  /** Rows the question was shown to — see visibleRows doc; for q25/q29/
   *  q_comprehensibility/q_features (all required-when-visible) this equals
   *  `respondents` among submitted rows; for the optional q_motivation it
   *  can be larger. */
  visibleCount: number
  /** Rows that actually picked at least one option — the base every
   *  option's `pctOfRespondents` below is relative to (per spec: percentages
   *  are "bezogen auf Antwortende dieser Frage", not on all who saw it, and
   *  must never be read as summing to 100% across options). */
  respondents: number
  options: { option: string; count: number; pctOfRespondents: number }[]
}

function multiStats(q: QuestionDef, rows: SurveyRow[]): MultiStat {
  const visible = visibleRows(q, rows)
  const answered = visible.filter((r) => isAnswerPresent(q.id, r.answers))
  const respondents = answered.length
  const counts = new Map<string, number>()
  for (const opt of q.options ?? []) counts.set(opt, 0)
  for (const r of answered) {
    const v = r.answers[q.id]
    if (Array.isArray(v)) for (const opt of v) counts.set(opt, (counts.get(opt) ?? 0) + 1)
  }
  const options = [...counts.entries()]
    .map(([option, count]) => ({ option, count, pctOfRespondents: respondents > 0 ? (count / respondents) * 100 : 0 }))
    .sort((a, b) => b.count - a.count)
  return { questionId: q.id, text: q.text, visibleCount: visible.length, respondents, options }
}

export interface FreetextEntry { userId: string; user: string; answer: string; date: string }
export interface FreetextStat {
  questionId: string
  text: string
  entries: FreetextEntry[]
  /** Rows this (always-optional) question was actually shown to — lets the
   *  admin see a real response rate (entries.length / visibleCount) instead
   *  of conflating "question wasn't shown" with "shown but left blank". For
   *  an unconditionally-visible free-text question this equals the total
   *  submitted-response count. */
  visibleCount: number
}

function freetextStats(q: QuestionDef, rows: SurveyRow[], profileMap: Map<string, ProfileLite>): FreetextStat {
  const visible = visibleRows(q, rows)
  const entries: FreetextEntry[] = []
  for (const r of visible) {
    const v = r.answers[q.id]
    if (typeof v === 'string' && v.trim().length > 0) {
      const p = profileMap.get(r.user_id)
      entries.push({
        userId: r.user_id,
        user: p?.display_name || p?.username || 'Unbekannt',
        answer: v.trim(),
        date: r.updated_at,
      })
    }
  }
  entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return { questionId: q.id, text: q.text, entries, visibleCount: visible.length }
}

export type QuestionStat =
  | { type: 'single'; stat: SingleChoiceStat }
  | { type: 'scale'; stat: ScaleStat }
  | { type: 'multi'; stat: MultiStat }
  | { type: 'freetext'; stat: FreetextStat }

/** Per-question evaluation for every question in the schema, computed only from `rows` (submitted responses). */
export function computePerQuestionStats(rows: SurveyRow[], profileMap: Map<string, ProfileLite>): QuestionStat[] {
  return ALL_QUESTIONS.map((q) => {
    if (q.type === 'single') return { type: 'single' as const, stat: singleChoiceStats(q, rows) }
    if (q.type === 'scale') return { type: 'scale' as const, stat: scaleStats(q, rows) }
    if (q.type === 'multi') return { type: 'multi' as const, stat: multiStats(q, rows) }
    return { type: 'freetext' as const, stat: freetextStats(q, rows, profileMap) }
  })
}

function avgByGroup(rows: SurveyRow[], groupQid: string, valueQid: string): { group: string; avg: number | null; count: number }[] {
  const groups = new Map<string, number[]>()
  for (const r of rows) {
    const g = r.answers[groupQid]
    const v = r.answers[valueQid]
    if (typeof g !== 'string' || typeof v !== 'number') continue
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(v)
  }
  return [...groups.entries()].map(([group, nums]) => ({ group, avg: avg(nums), count: nums.length }))
}

// ── Startgeld & Preise (Q4/Q5/Q7/Q8) ───────────────────────────────────────

const Q4_WOULD_LEAVE = 'Das Wettspiel soll kostenlos bleiben. Mit Startgeld würde ich nicht mehr teilnehmen.'
const Q5_AMOUNT: Record<string, number> = {
  'Weniger als 5 €': 0, '5 €': 5, '10 €': 10, '15 €': 15, '20 €': 20, 'Mehr als 20 €': Infinity,
}
const Q5_THRESHOLDS = [5, 10, 15, 20]

export interface StartgeldPreiseCrossTab {
  q4: SingleChoiceStat
  q5: SingleChoiceStat
  /** Zahlungsbereitschaft "kumulativ nach oben": Anzahl Befragter, deren
   *  maximaler Betrag MINDESTENS dem Schwellenwert entspricht — wer bis zu
   *  20 € zahlen würde, zählt also auch bei 5/10/15 € mit. "Kann ich noch
   *  nicht beurteilen" zählt bei KEINEM Schwellenwert, "Weniger als 5 €" nur
   *  unterhalb des kleinsten gelisteten Schwellenwerts (5 €) und damit bei
   *  keinem der vier Werte. Basis sind nur Zeilen, denen Q5 gezeigt wurde
   *  (Q4 ∈ {2,3,4}) und die geantwortet haben. */
  cumulativeWillingness: { threshold: number; count: number; pctOfQ5Respondents: number }[]
  q5RespondentsCount: number
  q7: MultiStat
  q8: SingleChoiceStat
  avgQ1ByQ4: { group: string; avg: number | null; count: number }[]
}

function computeStartgeldPreiseCrossTab(rows: SurveyRow[]): StartgeldPreiseCrossTab {
  const q5 = singleChoiceStats(QUESTION_BY_ID.get('q5')!, rows)
  const q5Rows = visibleRows(QUESTION_BY_ID.get('q5')!, rows).filter((r) => typeof r.answers.q5 === 'string')
  const q5RespondentsCount = q5Rows.length
  const cumulativeWillingness = Q5_THRESHOLDS.map((threshold) => {
    const count = q5Rows.filter((r) => (Q5_AMOUNT[r.answers.q5 as string] ?? -1) >= threshold).length
    return { threshold, count, pctOfQ5Respondents: q5RespondentsCount > 0 ? (count / q5RespondentsCount) * 100 : 0 }
  })
  return {
    q4: singleChoiceStats(QUESTION_BY_ID.get('q4')!, rows),
    q5,
    cumulativeWillingness,
    q5RespondentsCount,
    q7: multiStats(QUESTION_BY_ID.get('q7')!, rows),
    q8: singleChoiceStats(QUESTION_BY_ID.get('q8')!, rows),
    avgQ1ByQ4: avgByGroup(rows, 'q4', 'q1'),
  }
}

/** Separately confirms the "would leave" group (Q4 option 1) is never
 *  folded into the Q5-willing group — exposed mainly for the admin UI's
 *  explanatory text, not for any further computation. */
export function q4WouldLeaveCount(rows: SurveyRow[]): number {
  return rows.filter((r) => r.answers.q4 === Q4_WOULD_LEAVE).length
}

// ── Quoten & Risky-Wetten (Q12/Q13/Auszahlung) ─────────────────────────────

const Q12_ABOLISH = '0 – Risky-Wetten vollständig abschaffen'
const Q12_NEUTRAL = new Set(['Ist mir egal', 'Kann ich nicht beurteilen'])

export interface RiskyCrossTab {
  q12: SingleChoiceStat
  /** Q12 grouped into the three behaviourally distinct buckets the jump
   *  logic itself uses: abolish (Q13/Auszahlung hidden), positive count
   *  (Q13/Auszahlung required), neutral (Q13/Auszahlung shown but optional). */
  q12Groups: { abolishPct: number; positivePct: number; neutralPct: number; total: number }
  q13: SingleChoiceStat
  payoutNormal: SingleChoiceStat
  payoutRisky: SingleChoiceStat
}

function computeRiskyCrossTab(rows: SurveyRow[]): RiskyCrossTab {
  const q12 = singleChoiceStats(QUESTION_BY_ID.get('q12')!, rows)
  const abolishCount = q12.options.find((o) => o.option === Q12_ABOLISH)?.count ?? 0
  const neutralCount = q12.options.filter((o) => Q12_NEUTRAL.has(o.option)).reduce((a, o) => a + o.count, 0)
  const positiveCount = q12.total - abolishCount - neutralCount
  return {
    q12,
    q12Groups: {
      abolishPct: q12.total > 0 ? (abolishCount / q12.total) * 100 : 0,
      positivePct: q12.total > 0 ? (positiveCount / q12.total) * 100 : 0,
      neutralPct: q12.total > 0 ? (neutralCount / q12.total) * 100 : 0,
      total: q12.total,
    },
    q13: singleChoiceStats(QUESTION_BY_ID.get('q13')!, rows),
    payoutNormal: singleChoiceStats(QUESTION_BY_ID.get('q_payout_normal')!, rows),
    payoutRisky: singleChoiceStats(QUESTION_BY_ID.get('q_payout_risky')!, rows),
  }
}

// ── Wettmärkte & Spielauswahl (Q25/Q27/Q28) ────────────────────────────────

const Q25_NONE = 'Auf keinen – ich möchte alle behalten'
const Q25_CANT_JUDGE = 'Kann ich nicht beurteilen'

export interface WettmaerkteCrossTab {
  q25: MultiStat
  /** Anteil, der auf MINDESTENS einen konkreten Markt verzichten könnte, vs.
   *  "alle behalten" vs. "kann ich nicht beurteilen" — dieselbe Grundgesamtheit
   *  (Antwortende von Q25), nicht die Gesamtzahl aller Teilnehmer. */
  wouldDropAtLeastOnePct: number
  keepAllPct: number
  cantJudgePct: number
  q27: SingleChoiceStat
  q28: SingleChoiceStat
}

function computeWettmaerkteCrossTab(rows: SurveyRow[]): WettmaerkteCrossTab {
  const q25 = multiStats(QUESTION_BY_ID.get('q25')!, rows)
  const base = q25.respondents
  const noneCount = q25.options.find((o) => o.option === Q25_NONE)?.count ?? 0
  const cantJudgeCount = q25.options.find((o) => o.option === Q25_CANT_JUDGE)?.count ?? 0
  return {
    q25,
    wouldDropAtLeastOnePct: base > 0 ? ((base - noneCount - cantJudgeCount) / base) * 100 : 0,
    keepAllPct: base > 0 ? (noneCount / base) * 100 : 0,
    cantJudgePct: base > 0 ? (cantJudgeCount / base) * 100 : 0,
    q27: singleChoiceStats(QUESTION_BY_ID.get('q27')!, rows),
    q28: singleChoiceStats(QUESTION_BY_ID.get('q28')!, rows),
  }
}

// ── Kommunikation & Statistiken (Q20/Q21/Q22/Q23) ──────────────────────────

const Q20_PROBLEM_OPTIONS = new Set([
  'Ich nutze sie, bekomme aber zu viele Benachrichtigungen',
  'Ich habe sie aktiviert, aber sie kommen nicht zuverlässig an',
  'Ich nutze sie, finde sie aber kaum hilfreich',
  'Ich habe die Einrichtung versucht, aber sie hat nicht funktioniert',
])

export interface KommunikationCrossTab {
  q20: SingleChoiceStat
  pushProblemPct: number
  /** Freiwillig (siehe lib/survey.ts) — `total` ist deshalb schon die
   *  korrekte, kleinere Grundgesamtheit für "freiwillig nicht beantwortet". */
  recapChannel: SingleChoiceStat
  q22: SingleChoiceStat
  q23: SingleChoiceStat
  q23_text: FreetextStat
}

function computeKommunikationCrossTab(rows: SurveyRow[], profileMap: Map<string, ProfileLite>): KommunikationCrossTab {
  const q20 = singleChoiceStats(QUESTION_BY_ID.get('q20')!, rows)
  const problemCount = q20.options.filter((o) => Q20_PROBLEM_OPTIONS.has(o.option)).reduce((a, o) => a + o.count, 0)
  return {
    q20,
    pushProblemPct: q20.total > 0 ? (problemCount / q20.total) * 100 : 0,
    recapChannel: singleChoiceStats(QUESTION_BY_ID.get('q21_recap_channel')!, rows),
    q22: singleChoiceStats(QUESTION_BY_ID.get('q22')!, rows),
    q23: singleChoiceStats(QUESTION_BY_ID.get('q23')!, rows),
    q23_text: freetextStats(QUESTION_BY_ID.get('q23_text')!, rows, profileMap),
  }
}

// ── Zukunft & Verbesserungen (Q29/Q30/Features) ────────────────────────────

const Q29_SATISFIED = 'Ich bin mit meiner aktuellen Wettaktivität zufrieden und möchte nicht häufiger wetten'
const FEATURES_NONE = 'Keine dieser Funktionen interessiert mich'

export interface ZukunftCrossTab {
  q29: MultiStat
  satisfiedPct: number
  /** Q30 ist in V2 bewusst keine Skala mehr, sondern eine 5-stufige
   *  Einfachauswahl (siehe lib/survey.ts) — ein numerischer Mittelwert
   *  "nach Grund" ergibt dafür keinen Sinn mehr; stattdessen je Grund die
   *  Verteilung über die 5 Q30-Optionen. */
  q30ByReason: { reason: string; distribution: SingleChoiceStat['options']; count: number }[]
  q30: SingleChoiceStat
  features: MultiStat
  featuresNonePct: number
}

function computeZukunftCrossTab(rows: SurveyRow[]): ZukunftCrossTab {
  const q29 = multiStats(QUESTION_BY_ID.get('q29')!, rows)
  const satisfiedCount = q29.options.find((o) => o.option === Q29_SATISFIED)?.count ?? 0
  const q30ByReason = (QUESTION_BY_ID.get('q29')!.options ?? [])
    .filter((reason) => reason !== Q29_SATISFIED)
    .map((reason) => {
      const withReason = rows.filter((r) => Array.isArray(r.answers.q29) && (r.answers.q29 as string[]).includes(reason))
      const distribution = singleChoiceStats(QUESTION_BY_ID.get('q30')!, withReason).options
      return { reason, distribution, count: withReason.length }
    })
  const features = multiStats(QUESTION_BY_ID.get('q_features')!, rows)
  const noneCount = features.options.find((o) => o.option === FEATURES_NONE)?.count ?? 0
  return {
    q29,
    satisfiedPct: q29.respondents > 0 ? (satisfiedCount / q29.respondents) * 100 : 0,
    q30ByReason,
    q30: singleChoiceStats(QUESTION_BY_ID.get('q30')!, rows),
    features,
    featuresNonePct: features.respondents > 0 ? (noneCount / features.respondents) * 100 : 0,
  }
}

// ── Allgemeiner Eindruck & Bedienung (Nachvollziehbarkeit/Motivation) ──────

export interface AllgemeinCrossTab {
  comprehensibility: MultiStat
  motivation: MultiStat
}

function computeAllgemeinCrossTab(rows: SurveyRow[]): AllgemeinCrossTab {
  return {
    comprehensibility: multiStats(QUESTION_BY_ID.get('q_comprehensibility')!, rows),
    motivation: multiStats(QUESTION_BY_ID.get('q_motivation')!, rows),
  }
}

// ── Fairness & Abrechnung (Q17/Q19) ────────────────────────────────────────

export interface FairnessCrossTab {
  q17: SingleChoiceStat
  q19: SingleChoiceStat
}

function computeFairnessCrossTab(rows: SurveyRow[]): FairnessCrossTab {
  return {
    q17: singleChoiceStats(QUESTION_BY_ID.get('q17')!, rows),
    q19: singleChoiceStats(QUESTION_BY_ID.get('q19')!, rows),
  }
}

export interface SurveyCrossTabs {
  allgemein: AllgemeinCrossTab
  risky: RiskyCrossTab
  fairness: FairnessCrossTab
  wettmaerkte: WettmaerkteCrossTab
  kommunikation: KommunikationCrossTab
  startgeldPreise: StartgeldPreiseCrossTab
  zukunft: ZukunftCrossTab
}

export function computeCrossTabs(rows: SurveyRow[], profileMap: Map<string, ProfileLite>): SurveyCrossTabs {
  return {
    allgemein: computeAllgemeinCrossTab(rows),
    risky: computeRiskyCrossTab(rows),
    fairness: computeFairnessCrossTab(rows),
    wettmaerkte: computeWettmaerkteCrossTab(rows),
    kommunikation: computeKommunikationCrossTab(rows, profileMap),
    startgeldPreise: computeStartgeldPreiseCrossTab(rows),
    zukunft: computeZukunftCrossTab(rows),
  }
}

export interface SurveyOverview {
  activeUsers: number
  started: number
  submitted: number
  startedNotSubmitted: number
  notStarted: number
  participationRatePct: number
  avgQ1: number | null
  avgQ30: number | null
}

export function computeOverview(allRows: SurveyRow[], activeUserIds: Set<string>): SurveyOverview {
  const activeRows = allRows.filter((r) => activeUserIds.has(r.user_id))
  const started = activeRows.length
  const submittedRows = activeRows.filter((r) => r.submitted_at)
  const submitted = submittedRows.length
  const activeUsers = activeUserIds.size
  const q1nums = submittedRows.map((r) => r.answers.q1).filter((n): n is number => typeof n === 'number')
  const q30nums = submittedRows.map((r) => r.answers.q30).filter((n): n is number => typeof n === 'number')
  return {
    activeUsers,
    started,
    submitted,
    startedNotSubmitted: started - submitted,
    notStarted: Math.max(0, activeUsers - started),
    participationRatePct: activeUsers > 0 ? (submitted / activeUsers) * 100 : 0,
    avgQ1: avg(q1nums),
    avgQ30: avg(q30nums),
  }
}
