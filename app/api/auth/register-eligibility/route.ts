import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSeasonStarted } from '@/lib/season'

/** Called right after a successful sign-up.
 *  If the season has already started, the freshly created profile is marked
 *  as NOT eligible for the current season (default is eligible=true). */
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const seasonStarted = await isSeasonStarted(supabase)
  if (!seasonStarted) return NextResponse.json({ ok: true, eligible: true })

  const admin = createAdminClient()
  await admin
    .from('profiles')
    .update({ eligible_for_current_season: false })
    .eq('id', user.id)

  return NextResponse.json({ ok: true, eligible: false })
}
