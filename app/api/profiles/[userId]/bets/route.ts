import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  // RLS allows reading settled bets (match_date <= now)
  const { data: betsRaw } = await supabase
    .from('bets')
    .select(
      `id, market_type, selection, stake, odds_value, status, payout, combo_id, created_at,
       match:matches(id, matchday, home_score, away_score, status,
         home_team:teams!matches_home_team_id_fkey(name, short_name),
         away_team:teams!matches_away_team_id_fkey(name, short_name)
       )`
    )
    .eq('user_id', userId)
    .neq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(80)

  const bets = (betsRaw ?? []).map(b => ({
    ...b,
    match: (() => {
      const m = Array.isArray(b.match) ? b.match[0] : b.match
      if (!m) return null
      return { ...m, home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team, away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team }
    })(),
  }))

  const comboIds = [...new Set(bets.filter(b => b.combo_id).map(b => b.combo_id as number))]
  let combos: { id: number; stake: number; total_odds: number; status: string; payout: number | null }[] = []
  if (comboIds.length > 0) {
    const { data } = await supabase.from('combo_bets').select('id, stake, total_odds, status, payout').in('id', comboIds)
    combos = data ?? []
  }

  return NextResponse.json({ bets, combos })
}
