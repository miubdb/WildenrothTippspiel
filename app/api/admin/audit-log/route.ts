import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Admin 3.0, Punkt 9: liest `public.audit_log` (siehe supabase/admin3_audit_log.sql) — nur
 * lesend, nie schreibend (Schreiben läuft ausschließlich über lib/auditLog.ts). Filter nach
 * Aktion/Admin/Objekt sind serverseitig, damit die Liste nicht erst komplett geladen werden muss.
 *
 * Solange die Migration noch nicht angewendet ist, antwortet die Tabellenabfrage mit einem
 * "relation does not exist"-Fehler — wird hier explizit erkannt und als leere Liste mit Hinweis
 * zurückgegeben statt als harter 500er, damit die Admin-Oberfläche in der Zwischenzeit nicht
 * kaputt aussieht.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  const url = request.nextUrl
  const action = url.searchParams.get('action')
  const actorId = url.searchParams.get('actorId')
  const objectType = url.searchParams.get('objectType')
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200)

  const admin = createAdminClient()
  let query = admin.from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit)
  if (action) query = query.eq('action', action)
  if (actorId) query = query.eq('actor_id', actorId)
  if (objectType) query = query.eq('object_type', objectType)

  const { data, error } = await query
  if (error) {
    if (error.message.includes('does not exist')) {
      return NextResponse.json({ entries: [], migrationPending: true })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ entries: data ?? [], migrationPending: false })
}
