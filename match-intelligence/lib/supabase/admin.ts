import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Service-role client bypassing RLS. Use ONLY for actions that must touch
 * data outside the caller's own authorized scope (e.g. writing audit_logs
 * for an action the same request is performing, or an admin API route that
 * has already re-checked `memberships` itself). Never import this from
 * anything that ships to the client — the `server-only` import above makes
 * that a build error, not just a convention.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not configured — admin-only actions are unavailable in this environment.'
    )
  }

  return createSupabaseClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
