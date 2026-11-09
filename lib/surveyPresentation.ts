import { isRequired, type Answers, type QuestionDef } from './survey'

/**
 * Mobile-first visual budget, not a fixed number of questions per screen.
 * Participants may scroll. The estimate accounts for the visual space used by
 * the actual answer controls (row count, wrapping, hints, rules and scales),
 * so 4 short questions need not be split like 4 complex questions.
 * No DOM measuring/re-layout after taps: this keeps the active page stable.
 */
export const QUESTION_PAGE_BUDGET = 1100
const MAX_QUESTIONS_SAFETY_CAP = 5
const COMPACT_SINGLE_IDS = new Set([
  'q5', 'q10', 'q11', 'q13', 'q15', 'q16',
  'q_payout_normal', 'q_payout_risky',
])
const COLLAPSED_TEXT_IDS = new Set(['q_technical_feedback', 'q26', 'q_features_text'])
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

export function questionPages(questions: QuestionDef[]): QuestionDef[][] {
  const pages: QuestionDef[][] = []
  let page: QuestionDef[] = []
  let used = 0
  const flush = () => {
    if (page.length) pages.push(page)
    page = []
    used = 0
  }

  for (const question of questions) {
    const estimated = estimateQuestionHeight(question)
    // Feature selection is an interaction of its own: categories + explanation toggles.
    const ownPage = question.id === 'q_features'
    if (page.length && (ownPage || used + estimated > QUESTION_PAGE_BUDGET
      || page.length >= MAX_QUESTIONS_SAFETY_CAP)) flush()
    page.push(question)
    used += estimated
    if (ownPage) flush()
  }
  flush()
  return pages.length ? pages : [[]]
}

function answered(q: QuestionDef, value: Answers[string]): boolean {
  if (q.type === 'multi') return Array.isArray(value) && value.length > 0
  if (q.type === 'scale') return typeof value === 'number' && Number.isFinite(value)
  return typeof value === 'string' && value.trim().length > 0
}

export function pageComplete(questions: QuestionDef[], answers: Answers): boolean {
  return questions.every((q) => !isRequired(q, answers) || answered(q, answers[q.id]))
}
