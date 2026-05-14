import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const MAX_LEN = 120

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  let body: { targetType: string; targetId: number; content: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const { targetType, targetId, content } = body

  if (!['bet', 'combo'].includes(targetType)) {
    return NextResponse.json({ error: 'Ungültiger Zieltyp.' }, { status: 400 })
  }
  if (typeof targetId !== 'number') {
    return NextResponse.json({ error: 'Ungültige ID.' }, { status: 400 })
  }
  const trimmed = (content ?? '').trim()
  if (!trimmed || trimmed.length > MAX_LEN) {
    return NextResponse.json({ error: `Kommentar muss zwischen 1 und ${MAX_LEN} Zeichen lang sein.` }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('bet_comments')
    .insert({ target_type: targetType, target_id: targetId, user_id: user.id, content: trimmed })
    .select('id, target_type, target_id, user_id, content, created_at')
    .single()

  if (error) return NextResponse.json({ error: 'Kommentar konnte nicht gespeichert werden.' }, { status: 500 })

  return NextResponse.json({ comment: data })
}
