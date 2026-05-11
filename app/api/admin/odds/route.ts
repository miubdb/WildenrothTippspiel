import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calculateOdds } from '@/lib/odds'
import type { Match } from '@/types'

export async function POST() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })
  }

  // Fetch all matches with team data for context
  const { data: allMatchesRaw } = await supabase
    .from('matches')
    .select(
      `id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status`
    )
    .order('match_date', { ascending: true })

  const allMatches: Match[] = (allMatchesRaw ?? []).map((m) => ({
    ...m,
    home_team: undefined,
    away_team: undefined,
  }))

  // Find scheduled matches to update odds for
  const scheduledMatches = allMatches.filter((m) => m.status === 'scheduled')

  let upsertCount = 0
  const errors: string[] = []

  for (const match of scheduledMatches) {
    try {
      const oddsData = calculateOdds(allMatches, match.home_team_id, match.away_team_id)

      const { error } = await supabase.from('odds').upsert(
        {
          match_id: match.id,
          home_win: oddsData.home_win,
          draw: oddsData.draw,
          away_win: oddsData.away_win,
          over_2_5: oddsData.over_2_5,
          under_2_5: oddsData.under_2_5,
          btts_yes: oddsData.btts_yes,
          btts_no: oddsData.btts_no,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'match_id' }
      )

      if (error) {
        errors.push(`Match ${match.id}: ${error.message}`)
      } else {
        upsertCount++
      }
    } catch (err) {
      errors.push(`Match ${match.id}: ${String(err)}`)
    }
  }

  return NextResponse.json({
    success: true,
    updated: upsertCount,
    total: scheduledMatches.length,
    errors: errors.length > 0 ? errors : undefined,
  })
}
