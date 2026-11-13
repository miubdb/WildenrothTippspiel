import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { HINRUNDE } from '@/lib/recap/availability'
import { buildFinalWinterRecapCandidate } from '@/lib/recap/loadRecap'
import { evaluatePublishGate } from '@/lib/recap/publishGate'
import { loadFrozenWinterRecap, publishFrozenWinterRecap } from '@/lib/recap/frozenSnapshot'
import { RECAP_SEASON } from '@/lib/recap/slips'

/**
 * Admin-Freigabe der Recaps. „Bereit" entscheidet allein die Datenlage (lib/recap/availability.ts),
 * „sichtbar" nur diese Freigabe. Veröffentlichen ist nur möglich, wenn der Zeitraum wirklich
 * abgeschlossen ist (serverseitig geprüft, nicht dem Client vertraut); Zurückziehen geht immer.
 * Friert die Daten beim ersten Veröffentlichen atomar ein (recap_snapshots),
 * speichert die Winter-Pokale und setzt die Freigabe in derselben Transaktion.
 * Zurückziehen behält den Stand für eine spätere unveränderte Veröffentlichung.
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

  const admin = createAdminClient()
  const { data: before } = await admin.from('app_settings').select('value').eq('key', key).maybeSingle()
  let awardRows = 0

  if (body.published) {
    try {
      const frozen = await loadFrozenWinterRecap(admin)
      if (frozen) {
        // A previously published-then-withdrawn recap is re-published from
        // the SAME historical snapshot, even after the makeup match settles.
        // SQL also derives the trophy rows from the existing snapshot.
        awardRows = await publishFrozenWinterRecap(admin, null)
      } else {
        // First publication only: require true finality and use one consistent
        // source dataset for public AND personal reports. No simulated values.
        const candidate = await buildFinalWinterRecapCandidate()
        const { count, error: awardCheckError } = await admin.from('user_awards')
          .select('id', { count: 'exact', head: true })
          .eq('season', RECAP_SEASON).eq('matchday', HINRUNDE.to)
        const gate = evaluatePublishGate({
          readiness: candidate.readiness,
          finalMatchday: HINRUNDE.to,
          finalMatchdayAwardCount: awardCheckError ? null : count ?? 0,
          report: { simulated: false, rangeTo: candidate.report.range.to },
        })
        if (!gate.ok) {
          return NextResponse.json({ error: gate.blockers[0] ?? 'Veröffentlichen derzeit nicht möglich.', blockers: gate.blockers }, { status: 409 })
        }

        // One DB transaction: snapshot insert-once, awards, visibility.
        // Any error rolls back all three; no prematurely public statistics.
        awardRows = await publishFrozenWinterRecap(admin, candidate)
      }
    } catch (error) {
      console.error('Winter recap freeze/publish failed:', error)
      return NextResponse.json({ error: 'Winter-Recap konnte nicht sicher eingefroren und veröffentlicht werden. Es wurde nichts neu freigegeben.' }, { status: 500 })
    }
  } else {
    // Unpublishing only removes the visibility bit. The snapshot and winter
    // awards remain intact for a later identical re-publication.
    const { error } = await admin.from('app_settings').delete().eq('key', key)
    await logAdminAction({ actorId: actor.id, actorName: actor.name, action: 'recap_publish',
      objectType: 'app_settings', objectId: key, oldValue: before?.value ?? null,
      newValue: null, success: !error, errorMessage: error?.message ?? null })
    if (error) return NextResponse.json({ error: 'Speichern fehlgeschlagen.' }, { status: 500 })
    return NextResponse.json({ ok: true, published: false })
  }

  await logAdminAction({ actorId: actor.id, actorName: actor.name, action: 'recap_publish',
    objectType: 'app_settings', objectId: key, oldValue: before?.value ?? null,
    newValue: `true (${awardRows} Winter-Pokale, eingefrorene Daten)`, success: true, errorMessage: null })
  return NextResponse.json({ ok: true, published: true, frozen: true })
}
