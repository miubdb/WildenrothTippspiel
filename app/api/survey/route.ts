import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateIncomingAnswers, isCompleteForSubmission, nextSubmittedAt } from '@/lib/surveyValidation'
import { currentSurveyModeKey, resolveSurveyMode, currentSurveyVersion, surveyModeAllowsAccess } from '@/lib/surveyMode'

// Own-survey endpoint: reads/writes the caller's own survey_responses row for
// THIS ENVIRONMENT's own survey_version (lib/surveyMode.ts#currentSurveyVersion
// — production and preview/integration each write entirely separate rows,
// never each other's, even though both share the same database/table). RLS
// (survey_responses_select_own/insert_own/update_own) already scopes every
// query to auth.uid() = user_id — this route additionally never accepts a
// userId from the client, so there's no way to target another user's row
// even if RLS were bypassed by a bug here.
//
// V2 reads its own, SEPARATE, per-environment app_settings key (see
// lib/surveyMode.ts#currentSurveyModeKey — production and preview/integration
// each have their OWN key, never the legacy `survey_mode` V1 used, and never
// shared with each other) and defaults to 'hidden' when absent, i.e. right
// now on both. See the Winter-2026-V2 Abschlussbericht for why this gate
// exists and why it must stay 'hidden' until an explicit, later release
// decision for the specific environment being released.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const [{ data: response }, { data: modeSetting }] = await Promise.all([
    supabase
      .from('survey_responses')
      .select('answers, started_at, submitted_at, updated_at')
      .eq('user_id', user.id)
      .eq('survey_version', currentSurveyVersion())
      .maybeSingle(),
    supabase.from('app_settings').select('value').eq('key', currentSurveyModeKey()).maybeSingle(),
  ])

  return NextResponse.json({
    surveyMode: resolveSurveyMode(modeSetting?.value),
    response: response ?? null,
  })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  // Freigabe-Gate serverseitig durchsetzen — unabhängig von der UI (die nur
  // GET's surveyMode respektiert). Kein Admin-Ausnahmefall: ein solcher wurde
  // nicht ausdrücklich angefordert und wäre nicht ohne Weiteres sicher zu
  // begründen, also gilt dieselbe Regel für jeden angemeldeten Nutzer,
  // Admins eingeschlossen. currentSurveyModeKey() wählt automatisch den zur
  // laufenden Umgebung gehörenden Schlüssel (Production vs. Preview/
  // integration) — niemals den der jeweils ANDEREN Umgebung.
  const { data: modeSetting } = await supabase.from('app_settings').select('value').eq('key', currentSurveyModeKey()).maybeSingle()
  if (!surveyModeAllowsAccess(resolveSurveyMode(modeSetting?.value))) {
    return NextResponse.json({ error: 'Die Umfrage ist aktuell nicht verfügbar.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }
  const { action, answers: rawAnswers } = body as { action?: string; answers?: unknown }
  if (action !== 'save' && action !== 'submit') {
    return NextResponse.json({ error: 'Unbekannte Aktion.' }, { status: 400 })
  }

  // Full adversarial validation — never trust the client beyond "looks like
  // an object". Rejects unknown question ids, wrong value types/shapes,
  // out-of-range scale values, unknown/duplicate/too-many/exclusive-
  // violating multi-select options, etc. (see lib/surveyValidation.ts for
  // the exact rules). On success also strips any answer for a question that
  // is not currently visible given the final answer set, so a stale
  // follow-up answer left over from a since-changed trigger (q4, q12, q25,
  // q29, q_motivation, …) can never be persisted — a `save` is allowed to be
  // incomplete, but never allowed to be internally inconsistent.
  const validated = validateIncomingAnswers(rawAnswers)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }
  const answers = validated.answers

  if (action === 'submit') {
    // Server-side re-validation — the wizard already blocks "Weiter" on an
    // incomplete section client-side, but submission must not trust that.
    // Only VISIBLE, currently-required questions count (jump logic
    // respected), evaluated against the SANITIZED answers above.
    if (!isCompleteForSubmission(answers)) {
      return NextResponse.json({ error: 'Noch nicht alle Pflichtfragen beantwortet.' }, { status: 400 })
    }
  }

  const now = new Date().toISOString()

  // Fetch existing row first so we keep the original started_at and decide
  // submitted_at (nextSubmittedAt below) from its PREVIOUS value — never
  // just echo the client's intended action.
  const { data: existing } = await supabase
    .from('survey_responses')
    .select('started_at, submitted_at')
    .eq('user_id', user.id)
    .eq('survey_version', currentSurveyVersion())
    .maybeSingle()

  // A `save` must NEVER leave (or silently keep) a response marked as
  // "submitted" when its CURRENT answers no longer satisfy every visible
  // required question — e.g. editing Q4 into a value that makes Q5
  // required, without yet answering Q5, must drop a previously-submitted
  // response back to "not submitted" rather than keeping the old
  // submitted_at. `submit` always (re-)stamps `now` (isCompleteForSubmission
  // was already re-checked above, so this is only reached when complete).
  // See lib/surveyValidation.ts#nextSubmittedAt for the single, unit-tested
  // decision both this route and scripts/survey-schema-check.ts rely on.
  const submittedAt = nextSubmittedAt(action, existing?.submitted_at ?? null, answers, now)

  const { error } = await supabase
    .from('survey_responses')
    .upsert({
      user_id: user.id,
      survey_version: currentSurveyVersion(),
      started_at: existing?.started_at ?? now,
      submitted_at: submittedAt,
      updated_at: now,
      answers,
    }, { onConflict: 'user_id,survey_version' })

  if (error) {
    console.error('Failed to save survey response:', error)
    return NextResponse.json({ error: 'Speichern fehlgeschlagen.' }, { status: 500 })
  }

  // `submitted`/`submittedAt` reflect the ACTUAL resulting row, not just the
  // requested action — the client needs this to correctly fall back its own
  // "already submitted" UI state when a save just un-submitted the response.
  return NextResponse.json({ ok: true, submitted: submittedAt != null, submittedAt })
}
