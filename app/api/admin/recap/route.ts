import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { HINRUNDE } from '@/lib/recap/availability'
import { loadHinrundeState, loadReadinessOnly } from '@/lib/recap/loadRecap'
import { evaluatePublishGate } from '@/lib/recap/publishGate'
import { extractWinterAwards } from '@/lib/recap/winterAwards'
import { replaceWinterAwards, type WinterAwardsClient } from '@/lib/recap/winterAwardsStore'
import { RECAP_SEASON } from '@/lib/recap/slips'

/**
 * Admin-Freigabe der Recaps. „Bereit" entscheidet allein die Datenlage (lib/recap/availability.ts),
 * „sichtbar" nur diese Freigabe. Veröffentlichen ist nur möglich, wenn der Zeitraum wirklich
 * abgeschlossen ist (serverseitig geprüft, nicht dem Client vertraut); Zurückziehen geht immer.
 * Schreibt app_settings.recap_published_hinrunde und – beim Veröffentlichen – die Winter-Pokale (Tabelle winter_awards, siehe supabase/winter_awards.sql).
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

  let awardRows = 0
  if (body.published) {
    // Alle Freigabe-Bedingungen werden hier serverseitig neu geprüft (nie dem Client vertraut) und der Bericht frisch aus den
    // Produktivdaten berechnet – nie simuliert, nie aus einem Snapshot. Die Entscheidung trifft `evaluatePublishGate`.
    const readiness = await loadReadinessOnly()
    const probe = createAdminClient()
    const { count, error: probeErr } = await probe.from('user_awards').select('id', { count: 'exact', head: true }).eq('season', RECAP_SEASON).eq('matchday', HINRUNDE.to)
    const state = await loadHinrundeState({ adminPreview: true, viewerId: actor.id, simulate: false })
    const gate = evaluatePublishGate({
      readiness, finalMatchday: HINRUNDE.to, finalMatchdayAwardCount: probeErr ? null : (count ?? 0),
      report: state.report ? { simulated: !!state.simulation, rangeTo: state.report.range.to } : null,
    })
    if (!gate.ok || !state.report) return NextResponse.json({ error: gate.blockers[0] ?? 'Veröffentlichen derzeit nicht möglich.', blockers: gate.blockers }, { status: 409 })
    // Winter-Pokale aus derselben finalen Berechnung speichern (atomar ersetzt: kein Duplikat bei erneutem Veröffentlichen).
    // Sie bleiben für Mitglieder unsichtbar, bis die Freigabe unten gesetzt ist; fehlt die Tabelle/Funktion (Migration nicht
    // ausgeführt), wird NICHT veröffentlicht.
    const rows = extractWinterAwards(state.report)
    const stored = await replaceWinterAwards(probe as unknown as WinterAwardsClient, rows)
    if (!stored.ok) return NextResponse.json({ error: 'Die Winter-Pokale konnten nicht gespeichert werden (Migration supabase/winter_awards.sql ausgeführt?). Es wurde nichts veröffentlicht.', detail: stored.error }, { status: 500 })
    awardRows = rows.length
  }
  const admin = createAdminClient()
  const { data: before } = await admin.from('app_settings').select('value').eq('key', key).maybeSingle()
  const { error } = body.published
    ? await admin.from('app_settings').upsert({ key, value: 'true', updated_at: new Date().toISOString() })
    : await admin.from('app_settings').delete().eq('key', key)
  await logAdminAction({ actorId: actor.id, actorName: actor.name, action: 'recap_publish', objectType: 'app_settings', objectId: key, oldValue: before?.value ?? null, newValue: body.published ? `true (${awardRows} Winter-Pokale)` : null, success: !error, errorMessage: error?.message ?? null })
  if (error) return NextResponse.json({ error: 'Speichern fehlgeschlagen.' }, { status: 500 })
  return NextResponse.json({ ok: true, published: body.published })
}
