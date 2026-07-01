import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const SEASON_START = '2026-08-01'

interface DiagnosticsRow {
  id: number
  match_id: number
  source: string
  computed_at: string
  home_games_played: number
  away_games_played: number
  home_k_effective: number
  away_k_effective: number
  home_form_mult: number
  away_form_mult: number
  home_roster_factor: number
  away_roster_factor: number
  home_raw_xg: number
  away_raw_xg: number
  home_final_xg: number
  away_final_xg: number
}

/**
 * Read-only "Warum diese Quote?" explainability view. Unlike
 * app/api/admin/odds/preview/route.ts (which recomputes odds live and writes
 * a fresh odds_diagnostics row every time it's opened), this route NEVER
 * calculates odds and NEVER writes anything — it only reads the currently
 * stored `odds` row and the latest existing `odds_diagnostics` row per match.
 */
export async function GET(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  const url = new URL(request.url)
  const requestedMd = url.searchParams.get('matchday')

  const { data: allMatchesRaw } = await supabase
    .from('matches')
    .select(
      `id, matchday, match_date, status,
       home_team:teams!matches_home_team_id_fkey(name),
       away_team:teams!matches_away_team_id_fkey(name)`
    )
    .gte('match_date', SEASON_START)
    .order('match_date', { ascending: true })

  const allMatches = (allMatchesRaw ?? []).map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  }))

  const matchdays = [...new Set(allMatches.map((m) => m.matchday))].sort((a, b) => a - b)

  const defaultMd = allMatches.filter((m) => m.status === 'scheduled').map((m) => m.matchday).sort((a, b) => a - b)[0]
  const targetMd = requestedMd ? parseInt(requestedMd, 10) : defaultMd

  if (targetMd == null) {
    return NextResponse.json({ matchday: null, matchdays, matches: [] })
  }

  const matchdayMatches = allMatches.filter((m) => m.matchday === targetMd)
  const matchIds = matchdayMatches.map((m) => m.id)

  const [{ data: oddsRows }, { data: diagRows }] = await Promise.all([
    matchIds.length > 0
      ? supabase.from('odds').select('match_id, home_win, draw, away_win, frozen_at').in('match_id', matchIds)
      : Promise.resolve({ data: [] }),
    matchIds.length > 0
      ? supabase.from('odds_diagnostics').select('*').in('match_id', matchIds).order('computed_at', { ascending: false })
      : Promise.resolve({ data: [] as DiagnosticsRow[] }),
  ])

  const oddsMap = new Map((oddsRows ?? []).map((r) => [r.match_id, r]))

  // Rows are ordered newest-first — keep only the first (latest) per match_id.
  const latestDiagByMatch = new Map<number, DiagnosticsRow>()
  for (const row of (diagRows ?? []) as DiagnosticsRow[]) {
    if (!latestDiagByMatch.has(row.match_id)) latestDiagByMatch.set(row.match_id, row)
  }

  const matches = matchdayMatches.map((m) => ({
    match_id: m.id,
    matchday: m.matchday,
    match_date: m.match_date,
    home_team: m.home_team?.name ?? '?',
    away_team: m.away_team?.name ?? '?',
    odds: oddsMap.get(m.id) ?? null,
    diagnostics: latestDiagByMatch.get(m.id) ?? null,
  }))

  return NextResponse.json({ matchday: targetMd, matchdays, matches })
}
