/**
 * Exactly one administrator also operates the Wildenroth Tippspiel.
 * Exclude ONLY that account from community survey reports, not all admins:
 * other admins may participate as ordinary players.
 *
 * Use the stable account username to resolve its user id server-side.
 * No private UUID is committed to the public repository.
 */
export const SURVEY_OPERATOR_USERNAME = 'miubdb'

export interface SurveyAudienceProfile {
  id: string
  username: string | null
  is_admin: boolean | null
}

export function findSurveyOperatorId(profiles: readonly SurveyAudienceProfile[]): string | null {
  const operator = profiles.find((profile) =>
    profile.is_admin === true && profile.username === SURVEY_OPERATOR_USERNAME
  )
  return operator?.id ?? null
}

export function withoutSurveyOperator<T extends { user_id: string }>(
  rows: readonly T[],
  operatorUserId: string,
): T[] {
  return rows.filter((row) => row.user_id !== operatorUserId)
}
