/**
 * Survey reading time, not "first opened" -> "submitted" elapsed time.
 * Only visible, recently interacted-with foreground time counts.
 * Per-tab cumulative values are stored idempotently by session UUID so
 * resuming on another day adds a new session instead of re-counting idle days.
 */
export const SURVEY_IDLE_AFTER_MS = 60_000
export const SURVEY_HEARTBEAT_MS = 10_000
export const SURVEY_MAX_SESSION_MS = 24 * 60 * 60 * 1_000

export interface ActivityClock {
  activeMs: number
  lastTickAt: number
  lastInteractionAt: number
}
export function freshActivityClock(now: number): ActivityClock {
  return { activeMs: 0, lastTickAt: now, lastInteractionAt: now }
}
export function advanceSurveyActivity(clock: ActivityClock, now: number, visible: boolean): ActivityClock {
  const next = Math.max(clock.lastTickAt, now)
  const activeUntil = Math.min(next, clock.lastInteractionAt + SURVEY_IDLE_AFTER_MS)
  const countedMs = visible ? Math.max(0, activeUntil - clock.lastTickAt) : 0
  return {
    ...clock,
    activeMs: Math.min(SURVEY_MAX_SESSION_MS, clock.activeMs + countedMs),
    lastTickAt: next,
  }
}
export function noteSurveyInteraction(clock: ActivityClock, now: number, visible: boolean): ActivityClock {
  const updated = advanceSurveyActivity(clock, now, visible)
  return visible ? { ...updated, lastInteractionAt: updated.lastTickAt } : updated
}
/** Foreground return starts a new active interval; background time is excluded. */
export function resumeSurveyActivity(clock: ActivityClock, now: number): ActivityClock {
  return { ...clock, lastTickAt: Math.max(now, clock.lastTickAt), lastInteractionAt: Math.max(now, clock.lastTickAt) }
}

export interface SurveyActivityRow { user_id: string; active_ms: number | string }
export function totalSurveyActivityByUser(rows: SurveyActivityRow[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const row of rows) {
    const duration = Number(row.active_ms)
    if (!Number.isSafeInteger(duration) || duration < 0 || duration > SURVEY_MAX_SESSION_MS) continue
    totals.set(row.user_id, (totals.get(row.user_id) ?? 0) + duration)
  }
  return totals
}

export interface SurveyTimeStats {
  meanMs: number | null
  medianMs: number | null
  tracked: number
  submitted: number
}
/** Statistics only for completed respondents with tracked sessions.
 * Older responses without measurement must NOT be counted as 0 minutes.
 */
export function surveyTimeStats(submittedIds: string[], activityMsByUser: Map<string, number>): SurveyTimeStats {
  const measured = [...new Set(submittedIds)]
    .map((id) => activityMsByUser.get(id) ?? 0)
    .filter((duration) => duration > 0)
    .sort((a, b) => a - b)
  if (!measured.length) return { meanMs: null, medianMs: null, tracked: 0, submitted: new Set(submittedIds).size }
  const middle = Math.floor(measured.length / 2)
  return {
    meanMs: Math.round(measured.reduce((a, b) => a + b, 0) / measured.length),
    medianMs: measured.length % 2 ? measured[middle] : Math.round((measured[middle - 1] + measured[middle]) / 2),
    tracked: measured.length,
    submitted: new Set(submittedIds).size,
  }
}
export function surveyTimeLabel(ms: number | null | undefined): string {
  if (ms == null || ms < 1) return '—'
  const totalSeconds = Math.round(ms / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')} Min.`
}
