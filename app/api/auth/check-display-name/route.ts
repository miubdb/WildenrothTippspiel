import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Escape LIKE/ILIKE wildcards so a name containing '%'/'_' is matched
// literally, not as a pattern (see the identical helper in register/page.tsx).
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * POST /api/auth/check-display-name
 * Body: { displayName: string }
 *
 * Server-side, service-role availability check for registration — used
 * instead of trusting a client-side SELECT against `profiles` (anon-readable,
 * but only a UX pre-check, not a security boundary, and racy: two
 * simultaneous registrations could both see "available"). The DB itself
 * still enforces uniqueness via a trimmed/lowercased UNIQUE index
 * (profiles_display_name_trimmed_lower_unique) — this endpoint just gives a
 * fast, friendly answer before the client attempts signUp().
 */
export async function POST(request: NextRequest) {
  let body: { displayName?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const trimmed = (body.displayName ?? '').trim()
  if (trimmed.length < 2) {
    return NextResponse.json({ error: 'Name muss mindestens 2 Zeichen haben.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('profiles')
    .select('id')
    .ilike('display_name', escapeLike(trimmed))
    .limit(1)

  if (error) {
    return NextResponse.json({ error: 'Name konnte nicht geprüft werden.' }, { status: 500 })
  }

  return NextResponse.json({ available: (data ?? []).length === 0 })
}
