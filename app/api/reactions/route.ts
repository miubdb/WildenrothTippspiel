import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Toggle a reaction (add if not exists, remove if same emoji, replace if different emoji)
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const { targetType, targetId, emoji } = await request.json()
  if (!targetType || !targetId || !emoji) return NextResponse.json({ error: 'Ungültig.' }, { status: 400 })

  // Check existing reaction
  const { data: existing } = await supabase
    .from('reactions')
    .select('id, emoji')
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .eq('user_id', user.id)
    .single()

  if (existing) {
    if (existing.emoji === emoji) {
      // Same emoji → remove (toggle off)
      await supabase.from('reactions').delete().eq('id', existing.id)
      return NextResponse.json({ action: 'removed' })
    } else {
      // Different emoji → replace
      await supabase.from('reactions').update({ emoji }).eq('id', existing.id)
      return NextResponse.json({ action: 'replaced' })
    }
  }

  // New reaction
  await supabase.from('reactions').insert({ target_type: targetType, target_id: targetId, user_id: user.id, emoji })
  return NextResponse.json({ action: 'added' })
}

// Get reactions for a list of targets
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const url = new URL(request.url)
  const targetType = url.searchParams.get('targetType')
  const ids = url.searchParams.get('ids')?.split(',').map(Number).filter(Boolean) ?? []

  if (!targetType || ids.length === 0) return NextResponse.json({ reactions: [] })

  const { data } = await supabase
    .from('reactions')
    .select('target_id, emoji, user_id')
    .eq('target_type', targetType)
    .in('target_id', ids)

  return NextResponse.json({ reactions: data ?? [] })
}
