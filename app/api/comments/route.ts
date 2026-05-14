import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendPushToUser } from '@/lib/push'

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

  // Notify the bet owner (unless commenting on own bet)
  try {
    let ownerId: string | null = null
    let matchId: number | null = null

    if (targetType === 'bet') {
      const { data: bet } = await supabase
        .from('bets')
        .select('user_id, match_id')
        .eq('id', targetId)
        .single()
      ownerId = bet?.user_id ?? null
      matchId = bet?.match_id ?? null
    } else {
      const { data: combo } = await supabase
        .from('combo_bets')
        .select('user_id')
        .eq('id', targetId)
        .single()
      ownerId = combo?.user_id ?? null
      const { data: firstLeg } = await supabase
        .from('bets')
        .select('match_id')
        .eq('combo_id', targetId)
        .limit(1)
        .single()
      matchId = firstLeg?.match_id ?? null
    }

    if (ownerId && ownerId !== user.id) {
      let matchday: number | null = null
      if (matchId) {
        const { data: match } = await supabase
          .from('matches')
          .select('matchday')
          .eq('id', matchId)
          .single()
        matchday = match?.matchday ?? null
      }

      const { data: commenterProfile } = await supabase
        .from('profiles')
        .select('display_name, username')
        .eq('id', user.id)
        .single()
      const commenterName = commenterProfile?.display_name || commenterProfile?.username || 'Jemand'

      const preview = trimmed.length > 80 ? trimmed.slice(0, 77) + '…' : trimmed
      const url = matchday ? `/leaderboard?spieltag=${matchday}` : '/leaderboard'

      await sendPushToUser(
        ownerId,
        `💬 ${commenterName} hat deine Wette kommentiert`,
        preview,
        url
      )
    }
  } catch {
    // Push notification failures shouldn't break the comment creation
  }

  return NextResponse.json({ comment: data })
}
