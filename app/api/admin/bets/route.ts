import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildEffectiveMatchdayIndex, effectiveMatchdayOf } from '@/lib/season'
import type { Match } from '@/types'

const SEASON_START = '2026-08-01'

export async function GET(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  const matchday = parseInt(request.nextUrl.searchParams.get('matchday') ?? '0', 10)
  if (!matchday) return NextResponse.json({ error: 'Spieltag fehlt.' }, { status: 400 })

  // Must resolve via the EFFECTIVE Tippspiel-Spieltag (lib/season.ts), not the
  // raw `matches.matchday` column — exactly like every member-facing page
  // (tipps, leaderboard). A Kreisliga Nachholspiel reassigned to a different
  // Spieltag (e.g. raw matchday=1, actually played and bet under Spieltag 7 —
  // see the "matchday scheduling quirk" note in CLAUDE.md) still carries its
  // OLD raw matchday number, and a Wildenroth-II/Topspiel match's raw number
  // is independent/meaningless. Filtering by raw matchday here used to
  // fragment a single combo across several ST-tabs whenever one of its legs
  // was such a match: each tab saw only a PARTIAL subset of the combo's legs,
  // showed a wrong partial-product "Gesamtquote", and duplicated its
  // 🎲 RISKY tag onto every fragment — reported live as "two Risky slips at
  // once" for a user who really only had one.
  const { data: allMatchesRaw } = await supabase
    .from('matches')
    .select('id, matchday, tippspiel_matchday, match_date, match_category, is_topspiel, home_team_id, away_team_id, status, home_score, away_score, home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name)')
    .or(`match_date.gte.${SEASON_START},matchday.eq.999`)

  const seasonMatches = (allMatchesRaw ?? []).map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  })) as unknown as Match[]

  const mdIndex = buildEffectiveMatchdayIndex(seasonMatches)
  const matchRows = seasonMatches.filter((m) => effectiveMatchdayOf(m, mdIndex) === matchday)

  const matchIds = matchRows.map(m => m.id)
  if (matchIds.length === 0) return NextResponse.json({ bets: [], profiles: [], matches: [] })

  const matchMap = Object.fromEntries(
    (matchRows ?? []).map(m => [m.id, {
      home: Array.isArray(m.home_team) ? m.home_team[0]?.name : (m.home_team as { name: string } | null)?.name,
      away: Array.isArray(m.away_team) ? m.away_team[0]?.name : (m.away_team as { name: string } | null)?.name,
    }])
  )

  const { data: bets } = await supabase
    .from('bets')
    .select('id, user_id, match_id, market_type, selection, odds_value, status, combo_id, is_risky, stake, created_at')
    .in('match_id', matchIds)
    .order('created_at', { ascending: true })

  const comboIds = [...new Set((bets ?? []).filter(b => b.combo_id).map(b => b.combo_id as number))]
  const { data: comboBets } = comboIds.length > 0
    ? await supabase.from('combo_bets').select('id, stake, total_odds, status, payout').in('id', comboIds)
    : { data: [] }
  const comboMap: Record<number, { stake: number; total_odds: number; status: string; payout: number | null }> =
    Object.fromEntries((comboBets ?? []).map(c => [c.id, c]))

  const userIds = [...new Set((bets ?? []).map(b => b.user_id))]
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, username')
    .in('id', userIds)

  const { data: roster } = await supabase.from('wildenroth_players').select('id, name')
  const playerNameMap: Record<number, string> = Object.fromEntries((roster ?? []).map(r => [r.id, r.name]))

  return NextResponse.json({ bets: bets ?? [], profiles: profiles ?? [], matchMap, playerNameMap, comboMap })
}
