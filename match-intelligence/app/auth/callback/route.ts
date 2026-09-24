import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Handles Supabase auth redirects (email invite / magic link / password
 * recovery) that hand back a `code` to exchange for a session. Admin-created
 * users (see app/api/admin/users) land here after clicking their invite link.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=Anmeldelink%20ungültig%20oder%20abgelaufen`)
}
