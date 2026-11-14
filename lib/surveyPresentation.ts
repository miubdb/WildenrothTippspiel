import { isRequired, type Answers, type QuestionDef } from './survey'

/**
 * Mobile-first visual budget, not a fixed number of questions per screen.
 * Participants may scroll. The estimate accounts for the visual space used by
 * the actual answer controls (row count, wrapping, hints, rules and scales),
 * so 4 short questions need not be split like 4 complex questions.
 * No DOM measuring/re-layout after taps: this keeps the active page stable.
 */
// Users scroll inside a page: permit several short questions per step.
export const QUESTION_PAGE_BUDGET = 1900
const MAX_QUESTIONS_SAFETY_CAP = 5
const COMPACT_SINGLE_IDS = new Set([
  'q5', 'q10', 'q11', 'q13', 'q15', 'q16',
  'q_payout_normal', 'q_payout_risky',
])
const COLLAPSED_TEXT_IDS = new Set(['q_technical_feedback', 'q26', 'q_features_text', 'q15_zero_text', 'q25_text'])
const estimateLines = (text: string, charsPerLine: number) =>
  Math.max(1, Math.ceil(text.length / charsPerLine))

export function estimateQuestionHeight(question: QuestionDef): number {
  if (COLLAPSED_TEXT_IDS.has(question.id)) return 68

  // Card padding, heading, gaps and optional rule/help text.
  const heading = 60 + estimateLines(question.text, 42) * 23
  const rule = question.infoText ? 43 : 0 // folded, but current value stays visible
  const help = question.helpText && question.type !== 'freetext'
    ? 7 + estimateLines(question.helpText, 55) * 18 : 0
  const outer = heading + rule + help

  if (question.inputMode === 'positive-integer') return outer + 115
  if (question.type === 'freetext') return outer + 128
  if (question.type === 'scale') {
    const count = (question.scaleMax ?? 5) - (question.scaleMin ?? 1) + 1
    // Explicit 1 = ... / 5 = ... labels above the 5-column number grid.
    return outer + 60 + Math.ceil(count / 5) * 50
  }
  const options = question.options ?? []
  if (question.id === 'q_features') {
    // Only one feature category is visible at once, plus its "none" option.
    return outer + 110 + 7 * 57
  }
  if (question.type === 'single' && COMPACT_SINGLE_IDS.has(question.id)) {
    // Compact numeric choices render in two columns.
    let height = 0
    for (let i = 0; i < options.length; i += 2) {
      const lineCount = Math.max(...options.slice(i, i + 2).map((o) => estimateLines(o, 20)))
      height += 56 + (lineCount - 1) * 18
    }
    return outer + height
  }
  // One-column options: count long texts as wrapped lines, not just entries.
  const optionHeight = options.reduce((sum, option) => {
    const lineCount = estimateLines(option, question.type === 'multi' ? 37 : 41)
    return sum + 55 + (lineCount - 1) * 18
  }, 0)
  return outer + optionHeight + (question.type === 'multi' ? 22 : 0)
}

/**
 * Group strongly related questions and then choose page breaks globally.
 *
 * A greedy page-breaker used to put 3 questions on one page and leave a
 * perfectly short fourth question alone. Dynamic programming minimizes
 * the number of pages, then penalizes avoidable single-question leftovers.
 * Long questions still respect a height budget, and never more than five
 * questions appear together.
 */
export function questionPages(questions: QuestionDef[]): QuestionDef[][] {
  if (questions.length === 0) return [[]]

  const KEEP_TOGETHER: Record<string, string> = {
    q11: 'q12', // normal + Risky bet counts
    q27: 'q28', // Wildenroth I + II league coverage
    q_features: 'q_features_text', // feature choices + optional own idea
  }
  const groups: QuestionDef[][] = []
  for (let i = 0; i < questions.length; i++) {
    const nextId = KEEP_TOGETHER[questions[i].id]
    const hasPair = i + 1 < questions.length && questions[i + 1].id === nextId
    groups.push(hasPair ? [questions[i], questions[++i]] : [questions[i]])
  }

  type Candidate = { cost: number; pages: QuestionDef[][] }
  const best: (Candidate | null)[] = Array.from({ length: groups.length + 1 }, () => null)
  best[groups.length] = { cost: 0, pages: [] }

  for (let start = groups.length - 1; start >= 0; start--) {
    let count = 0
    let height = 0
    let current: QuestionDef[] = []
    let choice: Candidate | null = null
    for (let end = start; end < groups.length; end++) {
      const group = groups[end]
      count += group.length
      height += group.reduce((sum, q) => sum + estimateQuestionHeight(q), 0)
      current = [...current, ...group]
      if (count > MAX_QUESTIONS_SAFETY_CAP) break

      const containsFeature = current.some((q) => q.id === 'q_features')
      // The feature selector has tabs and extensive explanatory text; keep it
      // with its optional free text but never append unrelated questions.
      if (containsFeature && !(start === end && group[0].id === 'q_features')) break
      // Exception: a single oversized question may occupy its own page.
      if (height > QUESTION_PAGE_BUDGET && count > 1) break

      const remaining = best[end + 1]
      if (!remaining) continue
      const soloPenalty = count === 1 && height < QUESTION_PAGE_BUDGET * 0.75 ? 120 : 0
      const unused = Math.max(0, QUESTION_PAGE_BUDGET - height) / QUESTION_PAGE_BUDGET
      const imbalancePenalty = unused * unused * 10
      const cost = 1000 + soloPenalty + imbalancePenalty + remaining.cost
      if (!choice || cost < choice.cost) {
        choice = { cost, pages: [current, ...remaining.pages] }
      }
    }
    // Every single question must be displayable, even when taller than the
    // estimate budget. "No valid solution" indicates a regression.
    if (!choice) throw new Error(`Cannot paginate survey question ${groups[start][0].id}`)
    best[start] = choice
  }
  return best[0]!.pages
}

function answered(q: QuestionDef, value: Answers[string]): boolean {
  if (q.type === 'multi') return Array.isArray(value) && value.length > 0
  if (q.type === 'scale') return typeof value === 'number' && Number.isFinite(value)
  return typeof value === 'string' && value.trim().length > 0
}

export function pageComplete(questions: QuestionDef[], answers: Answers): boolean {
  return questions.every((q) => !isRequired(q, answers) || answered(q, answers[q.id]))
}
