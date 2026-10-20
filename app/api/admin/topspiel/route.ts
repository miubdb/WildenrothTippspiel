import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logAdminAction } from '@/lib/auditLog'

/**
 * Admin 3.0, Punkt 9: Topspiel-Auswahl soll protokolliert werden. Der bisherige Schreibpfad lief
 * rein clientseitig über den Session-Client (app/admin/page.tsx#toggleTopspiel,
 * `supabase.from('matches').update({ is_topspiel }).eq('id', matchId)`) — ein zuverlässiges
 * Audit-Log braucht aber einen serverseitigen Schreibpunkt (clientseitiges Logging ließe sich
 * trivial umgehen). Dieselbe Mutation, dieselbe RLS-Policy (Session-Client, kein Service-Role),
 * nur hierher verschoben plus Protokollierung — keine neue Fachlogik.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin, username, display_name').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  const body = await request.json().catch(() => null) as { matchId?: number; value?: boolean } | null
  if (!body?.matchId || typeof body.value !== 'boolean') {
    return NextResponse.json({ error: 'matchId und value (boolean) erforderlich.' }, { status: 400 })
  }

  const { error } = await supabase.from('matches').update({ is_topspiel: body.value }).eq('id', body.matchId)

  await logAdminAction({
    actorId: user.id, actorName: profile.display_name || profile.username,
    action: 'topspiel_toggle', objectType: 'matches', objectId: body.matchId,
    newValue: { is_topspiel: body.value }, success: !error, errorMessage: error?.message,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
