import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildEffectiveMatchdayIndex, effectiveMatchdayOf } from '@/lib/season'
import { generateSpecialCandidates, pickDiverseSuggestions, type SpecialTemplateKey } from '@/lib/matchdaySpecials'
import type { Match } from '@/types'

/** Same match_odds_overrides lookup every other odds computation in this app
 *  now uses (see app/(app)/tipps/page.tsx, app/api/admin/odds/route.ts,
 *  app/api/admin/odds/preview/route.ts) — a Spieltag-Special must derive its
 *  probabilities from the SAME final (homeXG, awayXG) as every other market
 *  on an overridden match, never the model's raw, uncorrected output. */
async function loadXgOverrides(supabase: Awaited<ReturnType<typeof createClient>>, matchIds: number[]) {
  const overrides = new Map<number, { homeXG: number; awayXG: number }>()
  if (matchIds.length === 0) return overrides
  const { data } = await supabase
    .from('match_odds_overrides')
    .select('match_id, model_home_xg_override, model_away_xg_override')
    .in('match_id', matchIds)
  for (const row of data ?? []) {
    if (row.model_home_xg_override != null && row.model_away_xg_override != null) {
      overrides.set(row.match_id, {
        homeXG: Number(row.model_home_xg_override),
        awayXG: Number(row.model_away_xg_override),
      })
    }
  }
  return overrides
}

const SEASON_START = '2026-08-01'
const CURRENT_SEASON = '26/27'

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 }) }
  return { user }
}

async function loadMatchdayContext(supabase: Awaited<ReturnType<typeof createClient>>, matchday: number) {
  const { data: seasonMatchesRaw } = await supabase
    .from('matches')
    .select('id, matchday, tippspiel_matchday, match_date, match_category, is_topspiel, home_team_id, away_team_id, status, home_score, away_score, competition_type')
    .or(`match_date.gte.${SEASON_START},matchday.eq.999`)
  const seasonMatches = (seasonMatchesRaw ?? []) as Match[]
  const mdIndex = buildEffectiveMatchdayIndex(seasonMatches)
  const includedMatches = seasonMatches
    .filter((m) => effectiveMatchdayOf(m, mdIndex) === matchday)
    .sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime())
  return { seasonMatches, includedMatches }
}

/** GET ?matchday=N — list existing specials + fresh candidate suggestions for that Spieltag. */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { error } = await requireAdmin(supabase)
  if (error) return error

  const matchday = parseInt(request.nextUrl.searchParams.get('matchday') ?? '0', 10)
  if (!matchday) return NextResponse.json({ error: 'Spieltag fehlt.' }, { status: 400 })

  const { data: existing } = await supabase
    .from('matchday_specials')
    .select('*')
    .eq('season', CURRENT_SEASON)
    .eq('matchday', matchday)
    .order('display_order', { ascending: true })

  const { seasonMatches, includedMatches } = await loadMatchdayContext(supabase, matchday)
  if (includedMatches.length === 0) {
    return NextResponse.json({ specials: existing ?? [], candidates: [], includedMatches: [] })
  }

  const xgOverrides = await loadXgOverrides(supabase, includedMatches.map((m) => m.id))
  const candidates = generateSpecialCandidates(seasonMatches, includedMatches, xgOverrides)
  const suggested = pickDiverseSuggestions(candidates, 3).map((c) => c.templateKey)
  return NextResponse.json({
    specials: existing ?? [],
    candidates,
    suggested,
    includedMatches: includedMatches.map((m) => ({ id: m.id, match_date: m.match_date, status: m.status, home_team_id: m.home_team_id, away_team_id: m.away_team_id })),
  })
}

/** POST — create one Special as a draft from a chosen template's freshly generated candidate. */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { error, user } = await requireAdmin(supabase)
  if (error) return error

  let body: { matchday?: number; templateKey?: SpecialTemplateKey }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }
  const { matchday, templateKey } = body
  if (!matchday || !templateKey) {
    return NextResponse.json({ error: 'matchday und templateKey erforderlich.' }, { status: 400 })
  }

  const { seasonMatches, includedMatches } = await loadMatchdayContext(supabase, matchday)
  if (includedMatches.length === 0) {
    return NextResponse.json({ error: 'Keine Spiele für diesen Spieltag gefunden.' }, { status: 400 })
  }
  const xgOverrides = await loadXgOverrides(supabase, includedMatches.map((m) => m.id))
  const candidates = generateSpecialCandidates(seasonMatches, includedMatches, xgOverrides)
  const candidate = candidates.find((c) => c.templateKey === templateKey)
  if (!candidate) return NextResponse.json({ error: 'Unbekannte Vorlage.' }, { status: 400 })

  const representativeMatch = includedMatches[0] // earliest kickoff — see migration comment on representative_match_id
  const { data: existingCount } = await supabase
    .from('matchday_specials')
    .select('id', { count: 'exact', head: true })
    .eq('season', CURRENT_SEASON)
    .eq('matchday', matchday)

  const { data, error: insertError } = await supabase
    .from('matchday_specials')
    .insert({
      season: CURRENT_SEASON,
      matchday,
      template_key: candidate.templateKey,
      title: candidate.title,
      line: candidate.line,
      options: candidate.options,
      included_match_ids: includedMatches.map((m) => m.id),
      representative_match_id: representativeMatch.id,
      status: 'draft',
      opens_at: new Date().toISOString(),
      closes_at: representativeMatch.match_date,
      display_order: existingCount?.length ?? 0,
      created_by: user!.id,
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('matchday special create error:', insertError)
    return NextResponse.json({ error: 'Fehler beim Erstellen.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, id: data.id })
}
