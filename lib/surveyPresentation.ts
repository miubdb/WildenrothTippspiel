import { isRequired, type Answers, type QuestionDef } from './survey'

// The participant UI uses small, focused blocks instead of rendering all 7–11
// questions in a section at once. The underlying section/answer IDs, API,
// validation rules and stored responses are unchanged.
const MAX_QUESTIONS_PER_PAGE = 3
export function questionPages(questions: QuestionDef[]): QuestionDef[][] {
  const pages: QuestionDef[][] = []
  let page: QuestionDef[] = []
  const flush = () => { if (page.length) { pages.push(page); page = [] } }
  for (const question of questions) {
    // Long multi-option choices and the feature catalogue need their own
    // screen, so users never see two huge answer lists at once.
    const large = (question.options?.length ?? 0) >= 7 || question.id === 'q_features'
    if (large) flush()
    page.push(question)
    if (large || page.length >= MAX_QUESTIONS_PER_PAGE) flush()
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

