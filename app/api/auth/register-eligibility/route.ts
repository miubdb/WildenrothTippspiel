import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasFirstMatchdayKickedOff } from '@/lib/season'

type PlayerRole = 'team1' | 'team2' | 'both' | 'fan'
const VALID_ROLES: PlayerRole[] = ['team1', 'team2', 'both', 'fan']

/** Called right after a successful sign-up.
 *  Sets is_wildenroth/is_wildenroth_ii from the registration's single-choice
 *  role selection (validated server-side — an unrecognized or missing value
 *  safely falls back to 'fan', never trusted as-is from the client) and, if
 *  the real season has already started (matchday 1 has kicked off), marks
 *  the new user as ineligible until an admin explicitly approves them.
 *  Registrations before kickoff are auto-eligible — deliberately NOT gated
 *  on the admin-togglable app_settings.season_started display flag, which
 *  can be set early. */
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let role: PlayerRole = 'fan'
  try {
    const body = await req.json()
    if (VALID_ROLES.includes(body.role)) role = body.role
  } catch { /* body is optional, defaults to 'fan' */ }

  const isWildenroth = role === 'team1' || role === 'both'
  const isWildenrothII = role === 'team2' || role === 'both'

  const seasonStarted = await hasFirstMatchdayKickedOff(supabase)
  const admin = createAdminClient()

  // Both flags are always written explicitly (not just the true case) so a
  // registration can never leave a stale/default flag from a previous state.
  const updates: Record<string, unknown> = {
    is_wildenroth: isWildenroth,
    is_wildenroth_ii: isWildenrothII,
  }
  if (seasonStarted) updates.eligible_for_current_season = false

  await admin.from('profiles').update(updates).eq('id', user.id)

  return NextResponse.json({ ok: true, eligible: !seasonStarted })
}
