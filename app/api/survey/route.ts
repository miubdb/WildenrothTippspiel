import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { SURVEY_VERSION, SURVEY_SECTIONS, isSectionComplete, isSurveyComplete, type Answers } from '@/lib/survey'

// Own-survey endpoint: reads/writes the caller's own survey_responses row for
// SURVEY_VERSION only. RLS (survey_responses_select_own/insert_own/update_own)
// already scopes every query to auth.uid() = user_id — this route additionally
// never accepts a userId from the client, so there's no way to target another
// user's row even if RLS were bypassed by a bug here.
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
    supabase.from('app_settings').select('value').eq('key', 'survey_mode').maybeSingle(),
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
  const { action, answers } = body as { action?: string; answers?: Answers }
  if (action !== 'save' && action !== 'submit') {
    return NextResponse.json({ error: 'Unbekannte Aktion.' }, { status: 400 })
  }
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return NextResponse.json({ error: 'Antworten fehlen.' }, { status: 400 })
  }

  if (action === 'submit') {
    // Server-side re-validation — the wizard already blocks "Weiter" on an
    // incomplete section client-side, but submission must not trust that.
    // Only VISIBLE required questions count (jump logic respected), matching
    // lib/survey.ts's isSectionComplete used by the UI.
    const incomplete = SURVEY_SECTIONS.find((s) => !isSectionComplete(s, answers))
    if (incomplete || !isSurveyComplete(answers)) {
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
