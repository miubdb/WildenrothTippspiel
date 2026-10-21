import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { SURVEY_VERSION } from '@/lib/survey'
import { computeOverview, computePerQuestionStats, computeCrossTabs, isActuallySubmitted, type SurveyRow, type ProfileLite } from '@/lib/surveyAggregate'
import { currentSurveyModeKey, resolveSurveyMode } from '@/lib/surveyMode'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 }) } as const
  const { data: profile } = await supabase.from('profiles').select('is_admin, username, display_name').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 }) } as const
  return { error: null, actorId: user.id, actorName: profile.display_name || profile.username } as const
}

// Aggregate evaluation for the admin "Umfrage" tab: fetches all rows for
// SURVEY_VERSION plus the active-user pool via the service-role client (RLS
// on survey_responses only lets a session client see its own row — aggregate
// reads MUST go through here, never a permissive policy), then aggregates in
// TS at request time so numbers are always fresh after a delete/reset.
export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const admin = createAdminClient()

  const [{ data: rowsRaw }, { data: activeProfiles }, { data: allProfilesRaw }, { data: settingsRaw }] = await Promise.all([
    admin.from('survey_responses').select('user_id, answers, started_at, submitted_at, updated_at').eq('survey_version', SURVEY_VERSION),
    admin.from('profiles').select('id').eq('eligible_for_current_season', true).is('deleted_at', null),
    admin.from('profiles').select('id, username, display_name'),
    admin.from('app_settings').select('key, value').in('key', [currentSurveyModeKey(), 'survey_admin_allow_reset']),
  ])

  const rows = (rowsRaw ?? []) as SurveyRow[]
  const activeUserIds = new Set((activeProfiles ?? []).map((p) => p.id as string))
  const profileMap = new Map<string, ProfileLite>((allProfilesRaw ?? []).map((p) => [p.id as string, p as ProfileLite]))
  const settings = new Map((settingsRaw ?? []).map((s) => [s.key, s.value]))

  // isActuallySubmitted (not raw r.submitted_at) — never count an
  // incomplete-but-stamped row as a completed participation, see
  // lib/surveyAggregate.ts#isActuallySubmitted.
  const submittedRows = rows.filter(isActuallySubmitted)

  const overview = computeOverview(rows, activeUserIds)
  const perQuestion = computePerQuestionStats(submittedRows, profileMap)
  const crossTabs = computeCrossTabs(submittedRows, profileMap)

  const participants = rows
    .map((r) => {
      const p = profileMap.get(r.user_id)
      return {
        userId: r.user_id,
        username: p?.display_name || p?.username || 'Unbekannt',
        status: isActuallySubmitted(r) ? 'abgegeben' as const : 'angefangen' as const,
        startedAt: r.started_at,
        submittedAt: r.submitted_at,
        updatedAt: r.updated_at,
        answers: r.answers,
      }
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  return NextResponse.json({
    settings: {
      // resolveSurveyMode (not the raw stored string) — the admin panel must
      // show the ACTUALLY applicable status (e.g. an invalid/stale leftover
      // value correctly reads as "hidden", never as whatever garbage string
      // happens to be stored).
      surveyMode: resolveSurveyMode(settings.get(currentSurveyModeKey())),
      // Which key this environment's toggle below actually reads/writes —
      // production and preview/integration each have their own (see
      // lib/surveyMode.ts) — so the UI can say so explicitly instead of the
      // admin having to guess which one they're changing.
      surveyModeKey: currentSurveyModeKey(),
      allowReset: settings.get('survey_admin_allow_reset') === 'true',
      // UI-only signal so the button can be disabled/explained proactively —
      // the POST /reset_all handler enforces this itself server-side
      // regardless of what the client shows or sends.
      isProduction: process.env.VERCEL_ENV === 'production',
    },
    overview,
    perQuestion,
    crossTabs,
    participants,
  })
}

export async function POST(req: Request) {
  const { error, actorId, actorName } = await requireAdmin()
  if (error) return error

  const admin = createAdminClient()
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  const { action } = body as { action?: string }

  if (action === 'set_mode') {
    const mode = (body as { mode?: string }).mode
    if (!['hidden', 'help_only', 'prominent'].includes(mode ?? '')) {
      return NextResponse.json({ error: 'Unbekannter Modus.' }, { status: 400 })
    }
    // currentSurveyModeKey() — this writes EXCLUSIVELY to the key belonging
    // to the environment this admin request is actually running in; it can
    // never touch the other environment's key, so a preview test can never
    // flip production's gate (or vice versa) through this route.
    await admin.from('app_settings').upsert({ key: currentSurveyModeKey(), value: mode, updated_at: new Date().toISOString() })
    return NextResponse.json({ ok: true })
  }

  if (action === 'set_allow_reset') {
    const value = (body as { value?: boolean }).value
    await admin.from('app_settings').upsert({ key: 'survey_admin_allow_reset', value: value ? 'true' : 'false', updated_at: new Date().toISOString() })
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete_response') {
    const userId = (body as { userId?: string }).userId
    if (!userId) return NextResponse.json({ error: 'userId fehlt.' }, { status: 400 })
    const { error: delError } = await admin.from('survey_responses').delete().eq('user_id', userId).eq('survey_version', SURVEY_VERSION)
    await logAdminAction({ actorId, actorName, action: 'survey_response_delete', objectType: 'survey_responses', objectId: userId, success: !delError, errorMessage: delError?.message })
    if (delError) return NextResponse.json({ error: delError.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'reset_all') {
    // Two independent server-side gates, both required — this can never be
    // bypassed by hiding/disabling the button client-side alone:
    // 1) survey_admin_allow_reset must be explicitly 'true' (admin toggle,
    //    per-environment via app_settings — same DB row on every
    //    environment, so this alone doesn't distinguish integration/main).
    // 2) VERCEL_ENV must NOT be 'production' — main's Vercel Production
    //    Deployment is the only surface where this matters (see CLAUDE.md
    //    "Branch- und Deployment-Strategie": main → Production, integration
    //    → Preview). Undefined VERCEL_ENV (e.g. local dev) is treated as
    //    non-production, matching how this repo is normally run.
    if (process.env.VERCEL_ENV === 'production') {
      return NextResponse.json(
        { error: 'Bulk-Reset ist in der Produktionsumgebung deaktiviert.' },
        { status: 403 }
      )
    }
    const { data: allowSetting } = await admin.from('app_settings').select('value').eq('key', 'survey_admin_allow_reset').maybeSingle()
    if (allowSetting?.value !== 'true') {
      return NextResponse.json({ error: 'Bulk-Reset ist deaktiviert (survey_admin_allow_reset = false).' }, { status: 403 })
    }
    const { error: resetError } = await admin.from('survey_responses').delete().eq('survey_version', SURVEY_VERSION)
    await logAdminAction({ actorId, actorName, action: 'survey_reset', objectType: 'survey_responses', objectId: SURVEY_VERSION, success: !resetError, errorMessage: resetError?.message })
    if (resetError) return NextResponse.json({ error: resetError.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unbekannte Aktion.' }, { status: 400 })
}
