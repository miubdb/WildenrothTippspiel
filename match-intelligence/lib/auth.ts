import { createClient } from '@/lib/supabase/server'
import type { MemberRole } from '@/types/database'

export interface CurrentMembership {
  orgId: string
  squadIds: string[] // squads this user is explicitly scoped to; empty + isOrgAdmin means "all squads"
  isOrgAdmin: boolean
  roles: MemberRole[]
  profile: { id: string; displayName: string }
}

/**
 * Resolves the signed-in user's memberships (server-side, RLS-scoped — a
 * user only ever sees their own membership rows anyway). Returns null if not
 * signed in. This is the single place page/API code should ask "who is this
 * and what can they see", rather than re-querying `memberships` ad hoc.
 */
export async function getCurrentMembership(): Promise<CurrentMembership | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile } = await supabase.from('profiles').select('id, display_name').eq('id', user.id).single()
  const { data: memberships } = await supabase.from('memberships').select('org_id, squad_id, role').eq('profile_id', user.id)

  if (!profile || !memberships || memberships.length === 0) return null

  // V1 assumption: a user belongs to exactly one organization (documented in
  // spec section 2 as the initial scope — one club). Multi-org support would
  // mean picking an "active org" here instead of memberships[0].
  const orgId = memberships[0].org_id
  const orgRows = memberships.filter((m) => m.org_id === orgId)

  return {
    orgId,
    isOrgAdmin: orgRows.some((m) => m.role === 'admin' && m.squad_id === null),
    roles: orgRows.map((m) => m.role),
    squadIds: orgRows.filter((m) => m.squad_id !== null).map((m) => m.squad_id as string),
    profile: { id: profile.id, displayName: profile.display_name },
  }
}
