import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const body = await req.json()
  const { field, value, currentPassword } = body as {
    field: 'display_name' | 'password' | 'email'
    value: string
    currentPassword?: string
  }

  if (!field || !value?.trim()) {
    return NextResponse.json({ error: 'Ungültige Eingabe' }, { status: 400 })
  }

  if (field === 'password') {
    if (!currentPassword) {
      return NextResponse.json({ error: 'Aktuelles Passwort erforderlich' }, { status: 400 })
    }
    if (value.length < 6) {
      return NextResponse.json({ error: 'Passwort muss mindestens 6 Zeichen haben' }, { status: 400 })
    }

    // Verify current password by signing in
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password: currentPassword,
    })
    if (signInErr) {
      return NextResponse.json({ error: 'Aktuelles Passwort ist falsch' }, { status: 400 })
    }

    const { error } = await supabase.auth.updateUser({ password: value })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  if (field === 'email') {
    const trimmed = value.trim()
    if (!trimmed.includes('@') || trimmed.length < 5) {
      return NextResponse.json({ error: 'Bitte gib eine gültige E-Mail-Adresse ein.' }, { status: 400 })
    }
    if (!currentPassword) {
      return NextResponse.json({ error: 'Aktuelles Passwort erforderlich' }, { status: 400 })
    }

    // Verify current password by signing in (same pattern as the password change above)
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password: currentPassword,
    })
    if (signInErr) {
      return NextResponse.json({ error: 'Aktuelles Passwort ist falsch' }, { status: 400 })
    }

    if (trimmed.toLowerCase() === (user.email ?? '').toLowerCase()) {
      return NextResponse.json({ error: 'Das ist bereits deine aktuelle E-Mail-Adresse.' }, { status: 400 })
    }

    // Server-side, race-safe availability pre-check — same SECURITY DEFINER
    // function used at registration (app/api/auth/check-email/route.ts).
    // The actual boundary is still profiles_email_trimmed_lower_unique.
    const { data: alreadyExists, error: checkError } = await supabase.rpc('email_exists', { p_email: trimmed })
    if (checkError) {
      return NextResponse.json({ error: 'E-Mail konnte nicht geprüft werden.' }, { status: 500 })
    }
    if (alreadyExists) {
      return NextResponse.json(
        { error: 'Diese E-Mail-Adresse wird bereits verwendet. Bitte melde dich an oder verwende eine andere E-Mail-Adresse.' },
        { status: 400 }
      )
    }

    const { data: updated, error: updateAuthError } = await supabase.auth.updateUser({ email: trimmed })
    if (updateAuthError) {
      const msg = updateAuthError.message?.toLowerCase() ?? ''
      const isEmailConflict = msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already')
      return NextResponse.json(
        { error: isEmailConflict ? 'Diese E-Mail-Adresse wird bereits verwendet. Bitte melde dich an oder verwende eine andere E-Mail-Adresse.' : 'E-Mail konnte nicht geändert werden. Bitte versuche es erneut.' },
        { status: 400 }
      )
    }

    // Depending on project auth settings, Supabase may apply this immediately
    // or only after the user confirms a link sent to the new address (in
    // which case user.email here still reads the OLD address). profiles.email
    // — the actual uniqueness boundary — must only be synced once the change
    // is real; the authenticated role has no direct grant on that column, so
    // this write goes through the service-role client, scoped to this user.
    const appliedImmediately = updated.user?.email?.toLowerCase() === trimmed.toLowerCase()
    if (appliedImmediately) {
      const admin = createAdminClient()
      await admin.from('profiles').update({ email: trimmed }).eq('id', user.id)
      return NextResponse.json({ ok: true, newValue: trimmed })
    }
    return NextResponse.json({ ok: true, pending: true })
  }

  if (field === 'display_name') {
    const trimmed = value.trim()
    if (trimmed.length < 2) {
      return NextResponse.json({ error: 'Anzeigename muss mindestens 2 Zeichen haben' }, { status: 400 })
    }
    if (trimmed.length > 30) {
      return NextResponse.json({ error: 'Anzeigename darf maximal 30 Zeichen haben' }, { status: 400 })
    }
    // Escape LIKE/ILIKE wildcards so a name containing '%'/'_' is matched
    // literally, not as a pattern (see the identical fix in
    // app/(auth)/register/page.tsx for why this matters).
    const escapedName = trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .ilike('display_name', escapedName)
      .neq('id', user.id)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ error: 'Dieser Name ist leider schon vergeben.' }, { status: 400 })
    }
    const { error } = await supabase.from('profiles').update({ display_name: trimmed }).eq('id', user.id)
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Dieser Name ist leider schon vergeben.' }, { status: 400 })
      }
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ ok: true, newValue: trimmed })
  }

  return NextResponse.json({ error: 'Unbekanntes Feld' }, { status: 400 })
}
