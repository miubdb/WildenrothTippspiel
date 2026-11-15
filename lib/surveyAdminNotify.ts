import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPushToUser } from '@/lib/push'
import { SURVEY_OPERATOR_USERNAME } from '@/lib/surveyAudience'
import { SURVEY_VERSION_PRODUCTION } from '@/lib/surveyMode'

/**
 * Push an den Betreiber (Admin), wenn jemand die Umfrage startet bzw. abschließt (server-only).
 * Nur in Production (Preview teilt sich die Datenbank, darf aber nie echte Pushes auslösen),
 * nie für die eigenen Aktionen des Betreibers, und je Spieler + Ereignis höchstens einmal
 * (dedupe über notification_log). Ein Klick öffnet direkt den Umfrage-Tab im Admin.
 */
export type SurveyAdminEvent = 'started' | 'submitted'

export const SURVEY_ADMIN_URL = '/admin?tab=umfrage'

/** Pure: welches Ereignis ergibt sich aus dem vorherigen Datensatz und dem neuen submitted_at? */
export function surveyAdminEvent(previous: { submitted_at: string | null } | null, submittedAt: string | null): SurveyAdminEvent | null {
  if (previous && !previous.submitted_at && submittedAt) return 'submitted'
  if (!previous) return submittedAt ? 'submitted' : 'started'
  return null
}

export async function notifySurveyOperator(
  admin: SupabaseClient,
  event: SurveyAdminEvent,
  actorUserId: string,
  surveyVersion: string,
): Promise<void> {
  if (surveyVersion !== SURVEY_VERSION_PRODUCTION) return
  try {
    const [{ data: operator }, { data: actor }] = await Promise.all([
      admin.from('profiles').select('id').eq('username', SURVEY_OPERATOR_USERNAME).eq('is_admin', true).maybeSingle(),
      admin.from('profiles').select('display_name, username').eq('id', actorUserId).maybeSingle(),
    ])
    if (!operator || operator.id === actorUserId) return
    const name = actor?.display_name || actor?.username || 'Jemand'
    const [title, body] = event === 'started'
      ? ['📝 Umfrage gestartet', `${name} hat die Umfrage gestartet.`]
      : ['✅ Umfrage abgeschlossen', `${name} hat die Umfrage abgeschlossen.`]
    await sendPushToUser(operator.id, title, body, SURVEY_ADMIN_URL, 'survey_admin', `survey-admin-${event}-${surveyVersion}-${actorUserId}`)
  } catch (e) {
    console.error('Survey admin push failed (survey save itself succeeded):', e)
  }
}
