import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { currentSurveyVersion } from '@/lib/surveyMode'
import { fetchAllRows } from '@/lib/supabase/paginatedSelect'
import { grantSurveyRewardIfEligible, isEligibleForSurveyReward, isRewardableSurveyVersion, SURVEY_REWARD_AMOUNT, SURVEY_REWARD_KIND } from '@/lib/surveyReward'
import type { Answers } from '@/lib/survey'

/**
 * Rückwirkende 100-Wildis-Dankeschöns (Admin).
 *  GET  → Kontrollübersicht: vollständig abgeschlossene Teilnahmen, bereits gebuchte, noch offene, Summe. Bucht nichts.
 *  POST → bucht alle noch offenen (grant_survey_reward, idempotent): beliebig oft wiederholbar, zahlt nie doppelt.
 * Nur in Production (dort ist die Version 'winter_2026_v2'); in Preview gibt es keine belohnungsfähige Version.
 */
async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 }) } as const
  const { data: profile } = await supabase.from('profiles').select('is_admin, username, display_name').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 }) } as const
  return { error: null, actorId: user.id, actorName: (profile.display_name || profile.username) as string } as const
}

type Row = { user_id: string; submitted_at: string | null; answers: Answers }

async function overview() {
  const admin = createAdminClient()
  const version = currentSurveyVersion()
  if (!isRewardableSurveyVersion(version)) return { error: NextResponse.json({ error: 'Belohnungen gibt es nur in Production.' }, { status: 409 }) } as const
  const [rows, bookings] = await Promise.all([
    fetchAllRows<Row>((f, t) => admin.from('survey_responses').select('user_id, submitted_at, answers').eq('survey_version', version).order('user_id').range(f, t)),
    fetchAllRows<{ user_id: string }>((f, t) => admin.from('balance_transactions').select('user_id').eq('kind', SURVEY_REWARD_KIND).eq('ref', version).order('id').range(f, t)),
  ])
  const booked = new Set(bookings.map((b) => b.user_id))
  const eligible = rows.filter((r) => isEligibleForSurveyReward(version, r.submitted_at, r.answers))
  const open = eligible.filter((r) => !booked.has(r.user_id))
  return {
    error: null, admin, version, open,
    summary: {
      version,
      responses: rows.length,
      completeSubmissions: eligible.length,
      alreadyRewarded: eligible.filter((r) => booked.has(r.user_id)).length,
      pending: open.length,
      pendingAmount: open.length * SURVEY_REWARD_AMOUNT,
    },
  } as const
}

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const o = await overview()
  if (o.error) return o.error
  return NextResponse.json(o.summary)
}

export async function POST() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const o = await overview()
  if (o.error) return o.error
  let granted = 0, already = 0, failed = 0
  for (const r of o.open) {
    const res = await grantSurveyRewardIfEligible(o.admin, r.user_id, o.version, r.submitted_at, r.answers)
    if (res.status === 'granted') granted++
    else if (res.status === 'already_granted') already++
    else failed++
  }
  await logAdminAction({
    actorId: auth.actorId, actorName: auth.actorName, action: 'survey_reward_backfill', objectType: 'balance_transactions', objectId: o.version,
    newValue: { granted, already, failed, amount: granted * SURVEY_REWARD_AMOUNT },
  })
  return NextResponse.json({ ...o.summary, granted, already, failed, grantedAmount: granted * SURVEY_REWARD_AMOUNT })
}
