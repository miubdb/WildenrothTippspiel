import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calculateOdds, buildPriorContext } from '@/lib/odds'
import type { Match, PriorMatch } from '@/types'

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
      `id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status,
       home_team:teams!matches_home_team_id_fkey(id, name, short_name),
       away_team:teams!matches_away_team_id_fkey(id, name, short_name)`
    )
    .order('match_date', { ascending: true })

  const allMatches: Match[] = (allMatchesRaw ?? []).map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  }))

  const { data: priorMatchesRaw } = await supabase
    .from('prior_season_matches')
    .select('id, season, league_name, league_level, league_number, home_team, away_team, home_score, away_score, match_date')

  const priorMatches: PriorMatch[] = (priorMatchesRaw ?? []) as PriorMatch[]

  const teamNames = new Map<number, string>()
  for (const m of allMatches) {
    if (m.home_team) teamNames.set(m.home_team_id, m.home_team.name)
    if (m.away_team) teamNames.set(m.away_team_id, m.away_team.name)
  }
  const priorCtx = buildPriorContext(priorMatches, teamNames)

  // Find scheduled matches to update odds for
  const scheduledMatches = allMatches.filter((m) => m.status === 'scheduled')

  let upsertCount = 0
  const errors: string[] = []

  for (const match of scheduledMatches) {
    try {
      const oddsData = calculateOdds(allMatches, match.home_team_id, match.away_team_id, priorCtx)

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
