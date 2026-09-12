import { type EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Server-side token_hash exchange for Supabase Auth email links (password
// recovery, signup confirmation, etc). Required because this app's Supabase
// clients use @supabase/ssr, i.e. PKCE flow: the client-side "?code=" +
// detectSessionInUrl auto-exchange only works if the link is opened in the
// exact same browser/device that requested it (it needs a locally-stored
// code verifier). This route instead verifies the token_hash directly
// against Supabase Auth server-side, so the link works from any device —
// this is Supabase's own documented pattern for SSR apps.
//
// Only reached once the "Reset Password" / "Confirm signup" email templates
// in the Supabase Dashboard are updated to link here (see CLAUDE.md / the
// password-reset report) — until then, the default templates still point
// straight at the target page with "?code=", which keeps working via the
// existing client-side exchange (same-device only).

// Mirrors the safeRedirect() guard in app/(auth)/login/page.tsx — `next`
// is attacker-controllable (plain query param), so only relative,
// same-origin paths are honored.
function safeNext(raw: string | null): string {
  if (!raw) return '/reset-password'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/reset-password'
  return raw
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = safeNext(searchParams.get('next'))

  if (token_hash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url))
    }
  }

  const errorUrl = new URL('/reset-password', request.url)
  errorUrl.searchParams.set('error', 'invalid_link')
  return NextResponse.redirect(errorUrl)
}
