// Server-side aggregation for the admin "Umfrage" evaluation. Pure functions
// over already-fetched survey_responses rows — no DB access here, no
// hardcoded numbers: every figure is derived from the `answers` JSONB of the
// rows passed in. Kept in its own file (rather than inline in the API route)
// so the per-question / cross-tab math is easy to unit-reason-about and to
// reuse between the aggregate endpoint and the CSV export if needed.
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

function answeredRows(qid: string, rows: SurveyRow[]) {
  return rows.filter((r) => isAnswerPresent(qid, r.answers))
}

/**
 * Rows for which `q` was actually shown given jump logic (evaluated against
 * that row's OWN final answers — e.g. q13 is "visible" for a row exactly
 * when that row's q12 ≠ 'Könnte für mich weg'). This is the denominator every
 * per-question stat must use, NOT "rows with a non-empty answer" — a
 * required-when-visible question (q5, q6, q13, q14_follow, q21_follow) is
 * always answered when visible, so this coincides with answeredRows() for
 * those, but computing it from visibility directly (rather than inferring
 * visibility from "has a value") is correct even if a client ever left a
 * stale answer behind after changing an earlier answer, and it lets optional
 * conditional free-text questions report a real response rate instead of
 * conflating "wasn't shown" with "was shown but skipped".
 */
function visibleRows(q: QuestionDef, rows: SurveyRow[]) {
  return rows.filter((r) => isQuestionVisible(q, r.answers))
}

export interface SingleChoiceStat {
  questionId: string
  text: string
  total: number
  options: { option: string; count: number; pct: number }[]
}

function singleChoiceStats(q: QuestionDef, rows: SurveyRow[]): SingleChoiceStat {
  // total = rows for which this question was actually shown (see
  // visibleRows doc) — e.g. q13's total is "everyone for whom q12 ≠ 'Könnte
  // für mich weg'", never the full submitted-response count, so a
  // conditional question's option percentages are relative to the group it
  // was actually asked of.
  const visible = visibleRows(q, rows)
  const total = visible.length
  const counts = new Map<string, number>()
  for (const opt of q.options ?? []) counts.set(opt, 0)
  for (const r of visible) {
    const v = r.answers[q.id]
    if (typeof v === 'string') counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return {
    questionId: q.id,
    text: q.text,
    total,
    options: [...counts.entries()].map(([option, count]) => ({
      option, count, pct: total > 0 ? (count / total) * 100 : 0,
    })),
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
  // total = rows for which this question was shown (see visibleRows doc),
  // not just rows with a numeric value — same reasoning as singleChoiceStats.
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
  respondents: number
  options: { option: string; count: number; pctOfRespondents: number }[]
}

function multiStats(q: QuestionDef, rows: SurveyRow[]): MultiStat {
  const answered = answeredRows(q.id, rows)
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
  return { questionId: q.id, text: q.text, respondents, options }
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

const Q5_ORDER = ['5 €', '10 €', '15 €', '20 €', 'Mehr als 20 €']
const Q5_THRESHOLDS = [5, 10, 15, 20]

export interface StartgeldCrossTab {
  shareQ4: { option: string; count: number; pct: number }[]
  q5Distribution: { option: string; count: number; pct: number }[]
  cumulativeAtThreshold: { threshold: number; count: number }[]
  avgQ30ByQ4: { group: string; avg: number | null; count: number }[]
  avgQ1ByQ4: { group: string; avg: number | null; count: number }[]
}

function computeStartgeldCrossTab(rows: SurveyRow[]): StartgeldCrossTab {
  const q4 = singleChoiceStats(QUESTION_BY_ID.get('q4')!, rows)
  const q5rows = rows.filter((r) => (r.answers.q4 === 'Ja' || r.answers.q4 === 'Kommt auf die Höhe an') && typeof r.answers.q5 === 'string')
  const q5 = singleChoiceStats(QUESTION_BY_ID.get('q5')!, q5rows)
  const cumulativeAtThreshold = Q5_THRESHOLDS.map((threshold) => {
    const maxIdx = Q5_ORDER.indexOf(`${threshold} €`)
    const count = q5rows.filter((r) => Q5_ORDER.indexOf(r.answers.q5 as string) <= maxIdx && Q5_ORDER.indexOf(r.answers.q5 as string) >= 0).length
    return { threshold, count }
  })
  return {
    shareQ4: q4.options,
    q5Distribution: q5.options,
    cumulativeAtThreshold,
    avgQ30ByQ4: avgByGroup(rows, 'q4', 'q30'),
    avgQ1ByQ4: avgByGroup(rows, 'q4', 'q1'),
  }
}

export interface PreiseCrossTab {
  q7: MultiStat['options']
  q8: SingleChoiceStat['options']
  q4xQ7: { q4Option: string; q7Option: string; count: number }[]
}

function computePreiseCrossTab(rows: SurveyRow[]): PreiseCrossTab {
  const q7 = multiStats(QUESTION_BY_ID.get('q7')!, rows)
  const q8 = singleChoiceStats(QUESTION_BY_ID.get('q8')!, rows)
  const q4xQ7: { q4Option: string; q7Option: string; count: number }[] = []
  const matrix = new Map<string, number>()
  for (const r of rows) {
    const g = r.answers.q4
    const sel = r.answers.q7
    if (typeof g !== 'string' || !Array.isArray(sel)) continue
    for (const opt of sel) {
      const key = `${g}|||${opt}`
      matrix.set(key, (matrix.get(key) ?? 0) + 1)
    }
  }
  for (const [key, count] of matrix) {
    const [q4Option, q7Option] = key.split('|||')
    q4xQ7.push({ q4Option, q7Option, count })
  }
  q4xQ7.sort((a, b) => b.count - a.count)
  return { q7: q7.options, q8: q8.options, q4xQ7 }
}

export interface TeilnahmeCrossTab {
  reasonsRanked: MultiStat['options']
  avgQ30ByReason: { reason: string; avg: number | null; count: number }[]
  q30Distribution: ScaleStat
}

function computeTeilnahmeCrossTab(rows: SurveyRow[]): TeilnahmeCrossTab {
  const q29 = multiStats(QUESTION_BY_ID.get('q29')!, rows)
  const avgQ30ByReason = (QUESTION_BY_ID.get('q29')!.options ?? []).map((reason) => {
    const withReason = rows.filter((r) => Array.isArray(r.answers.q29) && (r.answers.q29 as string[]).includes(reason))
    const nums = withReason.map((r) => r.answers.q30).filter((n): n is number => typeof n === 'number')
    return { reason, avg: avg(nums), count: nums.length }
  })
  return {
    reasonsRanked: q29.options,
    avgQ30ByReason,
    q30Distribution: scaleStats(QUESTION_BY_ID.get('q30')!, rows),
  }
}

export interface MechanikRow {
  questionId: string
  text: string
  total: number
  topOption: string | null
  wantsChangePct: number
  wantsChange: boolean
}

// "Wants a change" per mechanic — anyone NOT answering the status-quo-affirming
// option(s). Kept as an explicit per-question allowlist rather than a generic
// heuristic since "status quo" wording differs per question (see spec §6).
const STATUS_QUO_OPTIONS: Record<string, string[]> = {
  q10: ['Genau richtig', 'Ist mir egal'],
  q11: ['Genau richtig', 'Ich wusste nicht, dass es diese Begrenzung gibt'],
  q12: ['Sehr gut', 'Ganz nett'],
  q13: ['Genau richtig', 'Ist mir egal'],
  q14_follow: ['Passt'],
  q15: ['Passt', 'Ist mir egal'],
  q16: ['Motiviert mich tatsächlich mitzumachen', 'Finde ich fair', 'Ist mir ziemlich egal'],
}

function computeMechanikOverview(rows: SurveyRow[]): MechanikRow[] {
  const ids = ['q10', 'q11', 'q12', 'q13', 'q14_follow', 'q15', 'q16']
  return ids.map((id) => {
    const q = QUESTION_BY_ID.get(id)!
    const stat = singleChoiceStats(q, rows)
    const statusQuo = new Set(STATUS_QUO_OPTIONS[id] ?? [])
    const changeCount = stat.options.filter((o) => !statusQuo.has(o.option)).reduce((a, o) => a + o.count, 0)
    const wantsChangePct = stat.total > 0 ? (changeCount / stat.total) * 100 : 0
    const top = [...stat.options].sort((a, b) => b.count - a.count)[0]
    return {
      questionId: id, text: q.text, total: stat.total,
      topOption: top && top.count > 0 ? top.option : null,
      wantsChangePct, wantsChange: wantsChangePct > 50,
    }
  })
}

export interface KommunikationOverview {
  q20: SingleChoiceStat
  pushProblemPct: number
  q21: SingleChoiceStat
  q22: SingleChoiceStat
}

function computeKommunikationOverview(rows: SurveyRow[]): KommunikationOverview {
  const q20 = singleChoiceStats(QUESTION_BY_ID.get('q20')!, rows)
  const problem = q20.options.find((o) => o.option === 'Hat bei mir nicht funktioniert')
  return {
    q20,
    pushProblemPct: q20.total > 0 && problem ? (problem.count / q20.total) * 100 : 0,
    q21: singleChoiceStats(QUESTION_BY_ID.get('q21')!, rows),
    q22: singleChoiceStats(QUESTION_BY_ID.get('q22')!, rows),
  }
}

export interface StatsMarketsOverview {
  q23: SingleChoiceStat
  q23_text: FreetextStat
  q24: MultiStat
  q25: MultiStat
  q26: FreetextStat
}

function computeStatsMarketsOverview(rows: SurveyRow[], profileMap: Map<string, ProfileLite>): StatsMarketsOverview {
  return {
    q23: singleChoiceStats(QUESTION_BY_ID.get('q23')!, rows),
    q23_text: freetextStats(QUESTION_BY_ID.get('q23_text')!, rows, profileMap),
    q24: multiStats(QUESTION_BY_ID.get('q24')!, rows),
    q25: multiStats(QUESTION_BY_ID.get('q25')!, rows),
    q26: freetextStats(QUESTION_BY_ID.get('q26')!, rows, profileMap),
  }
}

export interface SurveyCrossTabs {
  startgeld: StartgeldCrossTab
  preise: PreiseCrossTab
  teilnahme: TeilnahmeCrossTab
  mechanik: MechanikRow[]
  kommunikation: KommunikationOverview
  statsMarkets: StatsMarketsOverview
}

export function computeCrossTabs(rows: SurveyRow[], profileMap: Map<string, ProfileLite>): SurveyCrossTabs {
  return {
    startgeld: computeStartgeldCrossTab(rows),
    preise: computePreiseCrossTab(rows),
    teilnahme: computeTeilnahmeCrossTab(rows),
    mechanik: computeMechanikOverview(rows),
    kommunikation: computeKommunikationOverview(rows),
    statsMarkets: computeStatsMarketsOverview(rows, profileMap),
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
