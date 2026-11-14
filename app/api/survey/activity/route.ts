import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { currentSurveyModeKey, currentSurveyVersion, resolveSurveyMode, surveyModeAllowsAccess } from '@/lib/surveyMode'
import { SURVEY_MAX_SESSION_MS } from '@/lib/surveyActivity'

// Only report ACTIVE time for the authenticated user's CURRENT survey.
// The browser never sends a user_id or survey_version, and the private
// table/RPC cannot be reached by anon/authenticated Supabase clients.
const SESSION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const { data: modeSetting, error: modeError } = await supabase
    .from('app_settings').select('value').eq('key', currentSurveyModeKey()).maybeSingle()
  if (modeError || !surveyModeAllowsAccess(resolveSurveyMode(modeSetting?.value))) {
    return NextResponse.json({ error: 'Umfrage ist nicht verfügbar.' }, { status: 403 })
  }

  const payload = await req.json().catch(() => null)
  const sessionId = payload?.sessionId
  const activeMs = payload?.activeMs
  if (!payload || typeof payload !== 'object' ||
      typeof sessionId !== 'string' || !SESSION_UUID_RE.test(sessionId) ||
      typeof activeMs !== 'number' || !Number.isSafeInteger(activeMs) ||
      activeMs < 0 || activeMs > SURVEY_MAX_SESSION_MS) {
    return NextResponse.json({ error: 'Ungültige Zeitmessung.' }, { status: 400 })
  }

  // A heartbeat cannot create a participant. The response is created through
  // the existing validated answer route; deleting that response cascades all
  // associated session measurements.
  const { data: response, error: responseError } = await supabase
    .from('survey_responses').select('user_id').eq('user_id', user.id)
    .eq('survey_version', currentSurveyVersion()).maybeSingle()
  if (responseError || !response) {
    return NextResponse.json({ error: 'Umfrage noch nicht gestartet.' }, { status: 409 })
  }

  const admin = createAdminClient()
  const { error } = await admin.rpc('record_survey_activity', {
    p_user_id: user.id,
    p_survey_version: currentSurveyVersion(),
    p_session_id: sessionId,
    p_active_ms: activeMs,
  })
  if (error) {
    console.error('Failed to record active survey time:', error)
    return NextResponse.json({ error: 'Zeitmessung konnte nicht gespeichert werden.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
