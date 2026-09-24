import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

/**
 * Session-scoped Supabase client for Server Components and most API routes.
 * RLS applies — this is the client every read/write should go through unless
 * an action must cross a boundary the caller's own session cannot (see
 * admin.ts).
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Called from a Server Component without write access to
            // cookies — safe to ignore as long as proxy.ts refreshes the
            // session on every request.
          }
        },
      },
    }
  )
}
