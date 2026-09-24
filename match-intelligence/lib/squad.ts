import { createClient } from '@/lib/supabase/server'
import type { CurrentMembership } from '@/lib/auth'

/**
 * Resolves which squad a page should show data for. V1 ships one squad (1.
 * Mannschaft) so "the first squad this membership can view" is unambiguous;
 * once a second squad exists this is the seam where a squad switcher would
 * plug in (query param / cookie), not a rewrite of every page below it.
 */
export async function resolveCurrentSquad(membership: CurrentMembership) {
  const supabase = await createClient()

  let query = supabase.from('squads').select('id, name, slug, level').eq('org_id', membership.orgId).eq('is_active', true)
  if (!membership.isOrgAdmin && membership.squadIds.length > 0) {
    query = query.in('id', membership.squadIds)
  }

  const { data } = await query.order('name').limit(1)
  return data?.[0] ?? null
}
