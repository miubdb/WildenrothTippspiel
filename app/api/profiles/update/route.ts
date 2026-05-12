import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const body = await req.json()
  const { field, value, currentPassword } = body as {
    field: 'display_name' | 'username' | 'password'
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

  if (field === 'username') {
    const trimmed = value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (trimmed.length < 3) {
      return NextResponse.json({ error: 'Benutzername muss mindestens 3 Zeichen haben' }, { status: 400 })
    }
    // Check uniqueness
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', trimmed)
      .neq('id', user.id)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ error: 'Benutzername ist bereits vergeben' }, { status: 400 })
    }
    const { error } = await supabase.from('profiles').update({ username: trimmed }).eq('id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, newValue: trimmed })
  }

  if (field === 'display_name') {
    const trimmed = value.trim()
    if (trimmed.length < 2) {
      return NextResponse.json({ error: 'Anzeigename muss mindestens 2 Zeichen haben' }, { status: 400 })
    }
    const { error } = await supabase.from('profiles').update({ display_name: trimmed }).eq('id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, newValue: trimmed })
  }

  return NextResponse.json({ error: 'Unbekanntes Feld' }, { status: 400 })
}
