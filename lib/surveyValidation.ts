// Shared answer-value validation for the survey — used by the client (the
// multi-select toggle handler, so the UI can never even construct an invalid
// selection) AND by the server (app/api/survey/route.ts), which must not
// trust the client at all. Every rule here is derived purely from the
// QuestionDef in lib/survey.ts, never duplicated as a second copy.
import {
  ALL_QUESTIONS, QUESTION_BY_ID, isQuestionVisible, isRequired, isSurveyComplete,
  type Answers, type QuestionDef,
} from './survey'

/** Hard cap on any free-text answer's length — the server enforces this
 *  even though the UI never lets a respondent type past it either. */
export const FREETEXT_MAX_LENGTH = 2000
/** Hard abuse-guard ceiling — see isValidAnswerValue's freetext case. */
const FREETEXT_HARD_REJECT_LENGTH = FREETEXT_MAX_LENGTH * 10

/**
 * Given a multi-select question's CURRENT selection and a newly toggled
 * option, returns the next selection. Centralizes the two rules the old
 * per-component toggle() handler got wrong for a question with an exclusive
 * option: (1) an exclusive option (e.g. "Keine dieser Funktionen") must
 * always be toggleable, even once maxSelect concrete picks are already
 * selected — it doesn't count against that limit and isn't blocked by it;
 * (2) picking it clears every other selection, and picking anything else
 * drops it first, so the two states can never coexist.
 */
export function toggleMultiOption(q: QuestionDef, current: string[], opt: string): string[] {
  const exclusive = new Set(q.exclusiveOptions ?? [])
  if (current.includes(opt)) {
    return current.filter((o) => o !== opt)
  }
  if (exclusive.has(opt)) {
    return [opt]
  }
  const withoutExclusive = current.filter((o) => !exclusive.has(o))
  if (q.maxSelect != null && withoutExclusive.length >= q.maxSelect) return withoutExclusive
  return [...withoutExclusive, opt]
}

/** Structural validity of a multi-select answer value against `q` — NOT
 *  whether it was reachable via toggleMultiOption, so this also rejects
 *  anything a manipulated direct API request could try to smuggle in:
 *  unknown options, duplicates, more than one exclusive option, an
 *  exclusive option combined with a concrete one, or more concrete options
 *  than maxSelect allows. */
export function isValidMultiSelection(q: QuestionDef, value: unknown): value is string[] {
  if (!Array.isArray(value)) return false
  if (value.length === 0) return true
  if (!value.every((v): v is string => typeof v === 'string')) return false
  if (new Set(value).size !== value.length) return false
  const allowed = new Set(q.options ?? [])
  if (!value.every((v) => allowed.has(v))) return false
  const exclusive = new Set(q.exclusiveOptions ?? [])
  const exclusiveCount = value.filter((v) => exclusive.has(v)).length
  if (exclusiveCount > 0 && value.length > 1) return false
  if (q.maxSelect != null && exclusiveCount === 0 && value.length > q.maxSelect) return false
  return true
}

/** Structural validity of any single answer value against its question's
 *  type/options/scale bounds. `undefined` (no answer yet) is always valid —
 *  completeness is a SEPARATE check (isSectionComplete/isSurveyComplete in
 *  lib/survey.ts), not this function's job. */
export function isValidAnswerValue(q: QuestionDef, value: unknown): boolean {
  if (value === undefined) return true
  switch (q.type) {
    case 'scale': {
      if (typeof value !== 'number' || !Number.isInteger(value)) return false
      const min = q.scaleMin ?? 1
      const max = q.scaleMax ?? 5
      return value >= min && value <= max
    }
    case 'single':
      return typeof value === 'string' && (q.options ?? []).includes(value)
    case 'multi':
      return isValidMultiSelection(q, value)
    case 'freetext':
      // Deliberately more lenient than FREETEXT_MAX_LENGTH here — a moderate
      // overage (e.g. a careless paste) is truncated below in
      // validateIncomingAnswers rather than losing the whole answer; only a
      // wildly oversized payload (an abuse attempt, not a real answer) is
      // rejected outright.
      return typeof value === 'string' && value.length <= FREETEXT_HARD_REJECT_LENGTH
  }
}

/** Removes any answer for a question that is not currently visible given
 *  the FINAL answer set — a changed trigger answer (e.g. q4, q12, q25, q29,
 *  q_motivation) must not leave a stale answer for a now-hidden follow-up
 *  behind, neither in the active in-memory state nor, more importantly, in
 *  what gets persisted. Every question's `visible` only ever reads a
 *  non-conditional question's answer (see the contract documented on
 *  QuestionDef.visible), so one pass over ALL_QUESTIONS is always enough —
 *  no fixed-point iteration needed. */
export function stripHiddenAnswers(answers: Answers): Answers {
  const result: Answers = {}
  for (const q of ALL_QUESTIONS) {
    if (!isQuestionVisible(q, answers)) continue
    const v = answers[q.id]
    if (v !== undefined) result[q.id] = v
  }
  return result
}

export type AnswersValidationResult =
  | { ok: true; answers: Answers }
  | { ok: false; error: string }

/**
 * Full adversarial validation + normalization of an incoming `answers`
 * object, for the server (app/api/survey/route.ts). Rejects outright rather
 * than silently repairing: an unknown question id, a value of the wrong
 * shape/type, an out-of-range scale value, an unknown multi-select option,
 * more selections than maxSelect, or an exclusive option combined with
 * anything else — none of these should ever reach a stored row, complete or
 * not. On success, returns a freshly built Answers object with every
 * free-text value trimmed/length-capped and every answer for a currently-
 * hidden question removed (stripHiddenAnswers) — so a save can never persist
 * more than what the respondent could actually have produced through the
 * real UI right now.
 */
export function validateIncomingAnswers(raw: unknown): AnswersValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Antworten fehlen oder sind ungültig.' }
  }
  const input = raw as Record<string, unknown>
  const draft: Answers = {}
  for (const [id, value] of Object.entries(input)) {
    const q = QUESTION_BY_ID.get(id)
    if (!q) return { ok: false, error: `Unbekannte Frage: ${id}` }
    if (value === undefined || value === null) continue
    if (!isValidAnswerValue(q, value)) return { ok: false, error: `Ungültige Antwort für Frage ${id}.` }
    draft[id] = (q.type === 'freetext' && typeof value === 'string'
      ? value.trim().slice(0, FREETEXT_MAX_LENGTH)
      : value) as Answers[string]
  }
  return { ok: true, answers: stripHiddenAnswers(draft) }
}

/** Re-validates completeness against the SANITIZED answers (post
 *  stripHiddenAnswers) — `submit` must never succeed off answers that still
 *  contained stale/invalid data before cleanup. */
export function isCompleteForSubmission(answers: Answers): boolean {
  return isSurveyComplete(answers)
}

/** True if `q` is required for the given answers — re-exported here only so
 *  callers that already import from this module don't need a second import
 *  from lib/survey.ts just for this one helper. */
export { isRequired }
