import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { HINRUNDE } from '@/lib/recap/availability'
import { loadReadinessOnly } from '@/lib/recap/loadRecap'

/**
 * Admin-Freigabe der Recaps. „Bereit" entscheidet allein die Datenlage (lib/recap/availability.ts),
 * „sichtbar" nur diese Freigabe. Veröffentlichen ist nur möglich, wenn der Zeitraum wirklich
 * abgeschlossen ist (serverseitig geprüft, nicht dem Client vertraut); Zurückziehen geht immer.
 * Schreibt ausschließlich app_settings.recap_published_hinrunde – keine Schema-Änderung.
 */
const KEYS: Record<string, string> = { hinrunde: HINRUNDE.settingKey }

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('is_admin, username, display_name').eq('id', user.id).single()
  if (!profile?.is_admin) return null
  return { id: user.id, name: profile.display_name || profile.username || 'Admin' }
}

export async function POST(request: NextRequest) {
  const actor = await requireAdmin()
  if (!actor) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })
  const body = await request.json().catch(() => null) as { recap?: string; published?: boolean } | null
  const key = body?.recap ? KEYS[body.recap] : undefined
  if (!key || typeof body?.published !== 'boolean') return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })

  if (body.published) {
    const readiness = await loadReadinessOnly()
    if (!readiness.ready) return NextResponse.json({ error: 'Der Zeitraum ist noch nicht vollständig abgeschlossen.', blockers: readiness.blockers }, { status: 409 })
  }
  const admin = createAdminClient()
  const { data: before } = await admin.from('app_settings').select('value').eq('key', key).maybeSingle()
  const { error } = body.published
    ? await admin.from('app_settings').upsert({ key, value: 'true', updated_at: new Date().toISOString() })
    : await admin.from('app_settings').delete().eq('key', key)
  await logAdminAction({ actorId: actor.id, actorName: actor.name, action: 'recap_publish', objectType: 'app_settings', objectId: key, oldValue: before?.value ?? null, newValue: body.published ? 'true' : null, success: !error, errorMessage: error?.message ?? null })
  if (error) return NextResponse.json({ error: 'Speichern fehlgeschlagen.' }, { status: 500 })
  return NextResponse.json({ ok: true, published: body.published })
}
