import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/auth/check-email
 * Body: { email: string }
 *
 * Deliberately does NOT reveal whether the address is already registered —
 * this used to call a SECURITY DEFINER `email_exists` RPC and return its
 * result, which made the endpoint a user-enumeration oracle (any anonymous
 * caller could probe arbitrary addresses and learn who has an account).
 * Only format validation happens here now; the real "is this email already
 * taken" answer comes from the trimmed/lowercased UNIQUE index on
 * profiles.email (profiles_email_trimmed_lower_unique, enforced
 * transactionally via the handle_new_user() signup trigger) surfacing as a
 * signUp() error, which the registration form already handles (see
 * app/(auth)/register/page.tsx's duplicate-email detection in
 * handleSubmit()) — so a genuine duplicate is still caught cleanly, just at
 * submit time instead of via a separate pre-check that could be probed.
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

  return NextResponse.json({ available: true })
}
