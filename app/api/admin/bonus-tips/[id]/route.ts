import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 }) }
  return {}
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { error } = await requireAdmin(supabase)
  if (error) return error

  const { data: existing } = await supabase.from('bonus_tips').select('evaluated_at').eq('id', id).single()
  if (!existing) return NextResponse.json({ error: 'Bonus-Tipp nicht gefunden.' }, { status: 404 })
  if (existing.evaluated_at) {
    return NextResponse.json({ error: 'Bereits ausgewertete Bonus-Tipps können nicht mehr geändert werden.' }, { status: 400 })
  }

  let body: {
    title?: string; description?: string; closes_at?: string; reward_wildis?: number
    options?: unknown[]; correct_option_keys?: string[] | null
    group_key?: string | null; group_max_per_user?: number | null
  }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  for (const key of ['title', 'description', 'closes_at', 'reward_wildis', 'options', 'correct_option_keys', 'group_key', 'group_max_per_user'] as const) {
    if (key in body) updates[key] = body[key]
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Keine Änderungen übergeben.' }, { status: 400 })
  }

  const { error: updateError } = await supabase.from('bonus_tips').update(updates).eq('id', id)
  if (updateError) {
    console.error('bonus tip update error:', updateError)
    return NextResponse.json({ error: 'Fehler beim Speichern.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { error } = await requireAdmin(supabase)
  if (error) return error

  const { error: deleteError } = await supabase.from('bonus_tips').delete().eq('id', id)
  if (deleteError) {
    console.error('bonus tip delete error:', deleteError)
    return NextResponse.json({ error: 'Fehler beim Löschen.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
