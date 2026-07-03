import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasFirstMatchdayKickedOff } from '@/lib/season'

/** Called right after a successful sign-up.
 *  Sets is_wildenroth flag and, if the real season has already started
 *  (matchday 1 has kicked off), marks the new user as ineligible until an
 *  admin explicitly approves them. Registrations before kickoff are
 *  auto-eligible — deliberately NOT gated on the admin-togglable
 *  app_settings.season_started display flag, which can be set early. */
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let isWildenroth = false
  try {
    const body = await req.json()
    isWildenroth = body.isWildenroth === true
  } catch { /* body is optional */ }

  const seasonStarted = await hasFirstMatchdayKickedOff(supabase)
  const admin = createAdminClient()

  const updates: Record<string, unknown> = {}
  if (isWildenroth) updates.is_wildenroth = true
  if (seasonStarted) updates.eligible_for_current_season = false

  if (Object.keys(updates).length > 0) {
    await admin.from('profiles').update(updates).eq('id', user.id)
  }

  return NextResponse.json({ ok: true, eligible: !seasonStarted })
}
