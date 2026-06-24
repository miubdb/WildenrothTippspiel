import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })
  }

  let body: { matchId: number; action: 'postpone' | 'reschedule'; newDate?: string; matchday?: number }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const { matchId, action, newDate, matchday } = body

  if (typeof matchId !== 'number') {
    return NextResponse.json({ error: 'matchId erforderlich.' }, { status: 400 })
  }

  const adminSupa = createAdminClient()

  if (action === 'postpone') {
    const { error } = await adminSupa
      .from('matches')
      .update({ status: 'postponed' })
      .eq('id', matchId)

    if (error) return NextResponse.json({ error: 'Fehler beim Aktualisieren.' }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  if (action === 'reschedule') {
    if (!newDate) return NextResponse.json({ error: 'newDate erforderlich.' }, { status: 400 })

    const parsedDate = new Date(newDate)
    if (isNaN(parsedDate.getTime())) {
      return NextResponse.json({ error: 'Ungültiges Datum.' }, { status: 400 })
    }

    const updatePayload: Record<string, unknown> = { status: 'scheduled', match_date: parsedDate.toISOString() }
    if (matchday != null && typeof matchday === 'number' && matchday > 0) {
      updatePayload.matchday = matchday
    }

    const { error } = await adminSupa
      .from('matches')
      .update(updatePayload)
      .eq('id', matchId)

    if (error) return NextResponse.json({ error: 'Fehler beim Aktualisieren.' }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unbekannte Aktion.' }, { status: 400 })
}
