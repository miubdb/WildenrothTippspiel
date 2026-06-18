import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSeasonStarted } from '@/lib/season'

/** Called right after a successful sign-up.
 *  Sets is_wildenroth flag and, if season already started,
 *  marks the new user as ineligible for the current season. */
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let isWildenroth = false
  try {
    const body = await req.json()
    isWildenroth = body.isWildenroth === true
  } catch { /* body is optional */ }

  const seasonStarted = await isSeasonStarted(supabase)
  const admin = createAdminClient()

  const updates: Record<string, unknown> = {}
  if (isWildenroth) updates.is_wildenroth = true
  if (seasonStarted) updates.eligible_for_current_season = false

  if (Object.keys(updates).length > 0) {
    await admin.from('profiles').update(updates).eq('id', user.id)
  }

  return NextResponse.json({ ok: true, eligible: !seasonStarted })
}
