import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendPushToUser } from '@/lib/push'

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
      await supabase.from('reactions').delete().eq('id', existing.id)
      return NextResponse.json({ action: 'removed' })
    } else {
      await supabase.from('reactions').update({ emoji }).eq('id', existing.id)
      return NextResponse.json({ action: 'replaced' })
    }
  }

  // New reaction
  await supabase.from('reactions').insert({ target_type: targetType, target_id: targetId, user_id: user.id, emoji })

  // Notify bet owner (best-effort, non-blocking)
  try {
    let ownerId: string | null = null
    let matchId: number | null = null

    if (targetType === 'bet') {
      const { data: bet } = await supabase.from('bets').select('user_id, match_id').eq('id', targetId).single()
      ownerId = bet?.user_id ?? null
      matchId = bet?.match_id ?? null
    } else if (targetType === 'combo') {
      const { data: combo } = await supabase.from('combo_bets').select('user_id').eq('id', targetId).single()
      ownerId = combo?.user_id ?? null
      const { data: firstLeg } = await supabase.from('bets').select('match_id').eq('combo_id', targetId).limit(1).single()
      matchId = firstLeg?.match_id ?? null
    }

    if (ownerId && ownerId !== user.id) {
      let matchday: number | null = null
      if (matchId) {
        const { data: match } = await supabase.from('matches').select('matchday').eq('id', matchId).single()
        matchday = match?.matchday ?? null
      }
      const { data: reactorProfile } = await supabase.from('profiles').select('display_name, username').eq('id', user.id).single()
      const reactorName = reactorProfile?.display_name || reactorProfile?.username || 'Jemand'
      const url = matchday ? `/leaderboard?spieltag=${matchday}` : '/leaderboard'
      const dedupeKey = `reaction-${user.id}-${targetType}-${targetId}-${emoji}`
      await sendPushToUser(ownerId, `${emoji} ${reactorName} hat auf deine Wette reagiert`, '', url, 'reaction', dedupeKey)
    }
  } catch {
    // Push failures don't break the reaction
  }

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
