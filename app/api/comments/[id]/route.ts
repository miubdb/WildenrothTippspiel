import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const { id } = await params
  const commentId = parseInt(id, 10)
  if (isNaN(commentId)) return NextResponse.json({ error: 'Ungültige ID.' }, { status: 400 })

  // RLS handles auth: only own or admin can delete
  const { error } = await supabase
    .from('bet_comments')
    .delete()
    .eq('id', commentId)

  if (error) return NextResponse.json({ error: 'Kommentar konnte nicht gelöscht werden.' }, { status: 500 })

  return NextResponse.json({ success: true })
}
