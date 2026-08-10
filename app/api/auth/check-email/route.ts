import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/auth/check-email
 * Body: { email: string }
 *
 * Server-side availability check for registration — a client-only check
 * can't be trusted (racy, and Supabase's signUp() deliberately doesn't
 * return a clear "already exists" error for an already-registered,
 * already-confirmed email, to avoid leaking account existence). The actual
 * boundary is the trimmed/lowercased UNIQUE index on profiles.email
 * (profiles_email_trimmed_lower_unique, enforced transactionally via the
 * handle_new_user() signup trigger) — this endpoint just gives a fast,
 * friendly answer before the client attempts signUp(). Uses a SECURITY
 * DEFINER function (public.email_exists) so it never has to expose the auth
 * user list or any row data — only a boolean.
 */
export async function POST(request: NextRequest) {
  let body: { email?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const trimmed = (body.email ?? '').trim()
  if (!trimmed || !trimmed.includes('@')) {
    return NextResponse.json({ error: 'Bitte gib eine gültige E-Mail-Adresse ein.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('email_exists', { p_email: trimmed })

  if (error) {
    return NextResponse.json({ error: 'E-Mail konnte nicht geprüft werden.' }, { status: 500 })
  }

  return NextResponse.json({ available: !data })
}
