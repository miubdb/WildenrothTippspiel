import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const MARKET_COLS = [
  'home_win', 'draw', 'away_win',
  'odds_1x', 'odds_x2', 'odds_12',
  'over_2_5', 'under_2_5', 'over_3_5', 'under_3_5',
  'over_5_5', 'under_5_5', 'over_7_5', 'under_7_5',
  'btts_yes', 'btts_no',
  'hdp_home_minus_1_5', 'hdp_away_plus_1_5', 'hdp_home_minus_2_5', 'hdp_away_plus_2_5',
] as const

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  return data?.is_admin ? user : null
}

// GET /api/admin/odds/overrides?matchday=X  — fetch overrides for all matches in matchday
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  if (!await requireAdmin(supabase)) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })
  }

  const matchday = parseInt(request.nextUrl.searchParams.get('matchday') ?? '0', 10)
  if (!matchday) return NextResponse.json({ overrides: [] })

  const { data: matchIds } = await supabase
    .from('matches').select('id').eq('matchday', matchday)
  const ids = (matchIds ?? []).map(m => m.id)
  if (ids.length === 0) return NextResponse.json({ overrides: [] })

  const { data: overrides } = await supabase
    .from('match_odds_overrides')
    .select('*')
    .in('match_id', ids)

  return NextResponse.json({ overrides: overrides ?? [] })
}

// POST /api/admin/odds/overrides — upsert or delete overrides for a match
// Body: { matchId, values: Record<string, number | null> }
// Sending null for a value clears that override. Sending an empty values object clears the whole row.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const user = await requireAdmin(supabase)
  if (!user) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  const body = await request.json()
  const { matchId, values, reset } = body as {
    matchId: number
    values?: Record<string, number | null>
    reset?: boolean
  }

  if (!matchId) return NextResponse.json({ error: 'matchId fehlt.' }, { status: 400 })

  if (reset) {
    await supabase.from('match_odds_overrides').delete().eq('match_id', matchId)
    return NextResponse.json({ success: true, action: 'reset' })
  }

  if (!values || Object.keys(values).length === 0) {
    return NextResponse.json({ error: 'values fehlt.' }, { status: 400 })
  }

  // Validate keys
  const safeValues: Record<string, number | null> = {}
  for (const col of MARKET_COLS) {
    if (col in values) {
      const v = values[col]
      if (v !== null && (typeof v !== 'number' || v <= 1.0 || v > 999)) {
        return NextResponse.json({ error: `Ungültiger Wert für ${col}.` }, { status: 400 })
      }
      safeValues[col] = v
    }
  }

  const { error } = await supabase.from('match_odds_overrides').upsert({
    match_id: matchId,
    ...safeValues,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'match_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, action: 'upsert' })
}
