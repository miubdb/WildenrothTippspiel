import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { SURVEY_VERSION, SURVEY_MODE_SETTING_KEY } from '@/lib/survey'
import { validateIncomingAnswers, isCompleteForSubmission } from '@/lib/surveyValidation'

// Own-survey endpoint: reads/writes the caller's own survey_responses row for
// SURVEY_VERSION only. RLS (survey_responses_select_own/insert_own/update_own)
// already scopes every query to auth.uid() = user_id — this route additionally
// never accepts a userId from the client, so there's no way to target another
// user's row even if RLS were bypassed by a bug here.
//
// V2 reads its own, SEPARATE `survey_mode_v2` app_settings key (defaults to
// 'hidden' when absent, i.e. right now) rather than the legacy `survey_mode`
// key V1 used — V1's key is left exactly as the product already set it
// (currently 'help_only' in the shared database, which both `main` and
// `integration` read from) and must not be reinterpreted as "V2 is live" the
// moment V2's code ships to a branch. See the Winter-2026-V2 Abschlussbericht
// for why this separate gate exists and why it must stay 'hidden' until an
// explicit, later release decision.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const [{ data: response }, { data: modeSetting }] = await Promise.all([
    supabase
      .from('survey_responses')
      .select('answers, started_at, submitted_at, updated_at')
      .eq('user_id', user.id)
      .eq('survey_version', SURVEY_VERSION)
      .maybeSingle(),
    supabase.from('app_settings').select('value').eq('key', SURVEY_MODE_SETTING_KEY).maybeSingle(),
  ])

  return NextResponse.json({
    surveyMode: modeSetting?.value ?? 'hidden',
    response: response ?? null,
  })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

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

  // Fetch existing row first so we keep the original started_at and never
  // clear submitted_at on a plain "save" of an already-submitted response
  // (editing after submission stays possible, per spec).
  const { data: existing } = await supabase
    .from('survey_responses')
    .select('started_at, submitted_at')
    .eq('user_id', user.id)
    .eq('survey_version', SURVEY_VERSION)
    .maybeSingle()

  const { error } = await supabase
    .from('survey_responses')
    .upsert({
      user_id: user.id,
      survey_version: SURVEY_VERSION,
      started_at: existing?.started_at ?? now,
      submitted_at: action === 'submit' ? now : (existing?.submitted_at ?? null),
      updated_at: now,
      answers,
    }, { onConflict: 'user_id,survey_version' })

  if (error) {
    console.error('Failed to save survey response:', error)
    return NextResponse.json({ error: 'Speichern fehlgeschlagen.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, submitted: action === 'submit' })
}
