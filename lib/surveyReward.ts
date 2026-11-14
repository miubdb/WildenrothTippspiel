import type { SupabaseClient } from '@supabase/supabase-js'
import { isCompleteForSubmission } from '@/lib/surveyValidation'
import { SURVEY_VERSION_PRODUCTION } from '@/lib/surveyMode'
import type { Answers } from '@/lib/survey'

/**
 * 100-Wildis-Dankeschön für die vollständig abgeschlossene Winterumfrage 2026 (server-only).
 *
 * The booking itself is the database function grant_survey_reward (supabase/survey_reward_2026.sql):
 * journal row (UNIQUE user/kind/version) + balance increment in ONE transaction. This module only
 * decides WHETHER to ask for it — with the same completeness rule the submit endpoint uses — and maps
 * the result. Calling it again (resubmit, edit, parallel request, retry after an error) can never pay twice.
 */
export const SURVEY_REWARD_AMOUNT = 100
export const SURVEY_REWARD_KIND = 'survey_reward'

export type SurveyRewardStatus = 'granted' | 'already_granted' | 'not_eligible' | 'pending'
export interface SurveyRewardState { status: SurveyRewardStatus; amount: number }

/** Only the production survey version ever pays out — never the preview/test version or V1. */
export function isRewardableSurveyVersion(version: string): boolean {
  return version === SURVEY_VERSION_PRODUCTION
}

/** Pure eligibility rule: rewardable version, an actually stamped submission AND complete answers. */
export function isEligibleForSurveyReward(version: string, submittedAt: string | null | undefined, answers: Answers | null | undefined): boolean {
  return isRewardableSurveyVersion(version) && !!submittedAt && !!answers && isCompleteForSubmission(answers)
}

export function rewardStateFromRpc(data: unknown, error: unknown): SurveyRewardState {
  if (error) return { status: 'pending', amount: SURVEY_REWARD_AMOUNT }
  const r = (data ?? {}) as { granted?: boolean; reason?: string }
  if (r.granted === true) return { status: 'granted', amount: SURVEY_REWARD_AMOUNT }
  if (r.reason === 'ALREADY_GRANTED') return { status: 'already_granted', amount: SURVEY_REWARD_AMOUNT }
  return { status: 'not_eligible', amount: 0 }
}

/** Idempotent: grants at most once per user and version. `admin` must be the service-role client. */
export async function grantSurveyRewardIfEligible(
  admin: SupabaseClient,
  userId: string,
  version: string,
  submittedAt: string | null | undefined,
  answers: Answers | null | undefined,
): Promise<SurveyRewardState> {
  if (!isEligibleForSurveyReward(version, submittedAt, answers)) return { status: 'not_eligible', amount: 0 }
  const { data, error } = await admin.rpc('grant_survey_reward', { p_user_id: userId, p_survey_version: version })
  if (error) console.error('grant_survey_reward failed (nothing booked, safe to retry)', { version, error })
  return rewardStateFromRpc(data, error)
}
