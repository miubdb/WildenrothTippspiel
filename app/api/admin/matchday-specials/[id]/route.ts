import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 }) }
  return {}
}

/** PATCH — admin overrides (line/options/status/display_order) on a draft or
 *  active Special. Once 'settled'/'void', locked (payouts already made). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { error } = await requireAdmin(supabase)
  if (error) return error

  const { data: existing } = await supabase.from('matchday_specials').select('status').eq('id', id).single()
  if (!existing) return NextResponse.json({ error: 'Special nicht gefunden.' }, { status: 404 })
  if (existing.status === 'settled' || existing.status === 'void') {
    return NextResponse.json({ error: 'Bereits abgerechnete/stornierte Specials können nicht mehr geändert werden.' }, { status: 400 })
  }

  let body: {
    title?: string; line?: number | null; options?: unknown[]
    status?: 'draft' | 'active' | 'void'; display_order?: number
  }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  // Any options edit is treated as an admin override — mark every option
  // `overridden: true` so it stays visible where the odds actually came from
  // (see SPIELTAG-SPECIALS requirement 8: "bleibt nachvollziehbar, woher die
  // Quote kam").
  if (body.options) {
    updates.options = (body.options as { key: string; label: string; probability: number; generated_odds: number; final_odds: number }[]).map((o) => ({ ...o, overridden: true }))
  }
  for (const key of ['title', 'line', 'status', 'display_order'] as const) {
    if (key in body) updates[key] = body[key]
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Keine Änderungen übergeben.' }, { status: 400 })
  }
  if (updates.status === 'void') {
    // Voiding a published market must refund every bet/leg that already
    // rests on it — see the dedicated void route below instead, which does
    // that atomically; a bare status flip here would silently orphan stakes.
    return NextResponse.json({ error: 'Zum Stornieren die /void-Route verwenden.' }, { status: 400 })
  }

  const { error: updateError } = await supabase.from('matchday_specials').update(updates).eq('id', id)
  if (updateError) {
    console.error('matchday special update error:', updateError)
    return NextResponse.json({ error: 'Fehler beim Speichern.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { error } = await requireAdmin(supabase)
  if (error) return error

  const { data: existing } = await supabase.from('matchday_specials').select('status').eq('id', id).single()
  if (!existing) return NextResponse.json({ error: 'Special nicht gefunden.' }, { status: 404 })
  if (existing.status !== 'draft') {
    return NextResponse.json({ error: 'Nur Entwürfe können gelöscht werden — ein aktives Special bitte stornieren.' }, { status: 400 })
  }

  const { error: deleteError } = await supabase.from('matchday_specials').delete().eq('id', id)
  if (deleteError) {
    console.error('matchday special delete error:', deleteError)
    return NextResponse.json({ error: 'Fehler beim Löschen.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
