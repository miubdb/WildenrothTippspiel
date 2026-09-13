import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildEffectiveMatchdayIndex, effectiveMatchdayOf } from '@/lib/season'
import type { Match } from '@/types'

const SEASON_START = '2026-08-01'

/**
 * Liefert die Spiele eines effektiven Tippspiel-Spieltags (dieselbe
 * Zuordnung wie überall sonst, siehe lib/season.ts) — Grundlage für den
 * Bonus-Tipp-Editor bei "Torreichstes Spiel"/"Höchster Sieg" (Optionsliste =
 * die Spiele dieses Spieltags) und "Tore in einem bestimmten Spiel"
 * (scope_match_id-Auswahl).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  const matchday = parseInt(request.nextUrl.searchParams.get('matchday') ?? '0', 10)
  if (!matchday) return NextResponse.json({ error: 'Spieltag fehlt.' }, { status: 400 })

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
  const matches = seasonMatches
    .filter((m) => effectiveMatchdayOf(m, mdIndex) === matchday)
    .map((m) => ({
      id: m.id,
      home: m.home_team?.name ?? '?',
      away: m.away_team?.name ?? '?',
      match_date: m.match_date,
      status: m.status,
      home_score: m.home_score,
      away_score: m.away_score,
    }))
    .sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime())

  return NextResponse.json({ matches })
}
