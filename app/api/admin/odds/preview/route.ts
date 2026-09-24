import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMatchXG, oddsFromXG, getFullExactScoreMatrix } from '@/lib/odds'
import { wildenrothHandicapForceHomeSide } from '@/lib/oddsMarkets'
import { persistOddsDiagnostics } from '@/lib/oddsDiagnostics'
import { bettingOpenTime, buildEffectiveMatchdayIndex, effectiveMatchdayOf } from '@/lib/season'
import { loadOddsModelInputs, snapshotMatches } from '@/lib/oddsInputs'
import type { Match } from '@/types'

export async function GET(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  const url = new URL(request.url)
  const requestedMd = url.searchParams.get('matchday')

  // `matchday` here (both the query param and the response's `matchdays`
  // list) means the effective TIPPSPIEL-Spieltag, exactly as tipps/page.tsx
  // shows it — not the raw matches.matchday column. See lib/season.ts.
  // Shared model inputs — identical to what app/api/admin/odds/route.ts
  // freezes and what tipps/page.tsx computes live (see lib/oddsInputs.ts).
  // Matchday numbers repeat across seasons, so the SEASON_START filter in the
  // loader also keeps a prior season's finished matches from showing up in this
  // preview and getting bogus "admin_preview" odds_diagnostics rows persisted.
  const { seasonMatches: allMatches, modelMatches, priorCtx } = await loadOddsModelInputs(supabase)

  // Same effective-Spieltag index as tipps/page.tsx. effectiveMatchdayOf()
  // already returns null for a plain (non-Topspiel) B-Klasse match — exactly
  // the "not part of any bettable Tippspiel-Spieltag" rule the user-facing
  // page applies — so filtering on a non-null result below reproduces the
  // real bettable match set with no separate category filter needed.
  const mdIndex = buildEffectiveMatchdayIndex(allMatches)
  const effMd = (m: Match) => effectiveMatchdayOf(m, mdIndex)
  const hasTestMatchday = allMatches.some((m) => m.matchday === 999)
  const matchdays = [
    ...(hasTestMatchday ? [999] : []),
    ...mdIndex.kreisligaMatchdaysDisplayOrder,
  ]

  const bettableMatches = allMatches.filter((m) => effMd(m) != null)

  // Default: chronologically-first Tippspiel-Spieltag that still has at
  // least one scheduled bettable match.
  const defaultMd = matchdays.find((md) =>
    bettableMatches.some((m) => effMd(m) === md && m.status === 'scheduled')
  ) ?? matchdays[0] ?? null

  const targetMd = requestedMd ? parseInt(requestedMd, 10) : defaultMd
  if (targetMd == null) {
    return NextResponse.json({ matchday: null, matches: [], matchdays: [] })
  }

  const matchdayMatches = bettableMatches
    .filter((m) => effMd(m) === targetMd)
    .sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime())

  // Final, hand-set opening time for this Tippspiel-Spieltag (app_settings
  // key betting_open_md_<N>) — the single source of truth tipps/page.tsx
  // uses. Falls back to the Monday-noon formula only for a Spieltag with no
  // explicit entry (e.g. the test matchday), never for a real one.
  const { data: settingRow } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', `betting_open_md_${targetMd}`)
    .maybeSingle()
  const firstMatch = matchdayMatches[0]
  const bettingOpensAt = settingRow?.value
    ? settingRow.value
    : firstMatch
      ? bettingOpenTime(new Date(firstMatch.match_date)).toISOString()
      : null
  const isBettingOpen = bettingOpensAt ? new Date() >= new Date(bettingOpensAt) : false

  // Replicate the snapshot cutoff that the live page uses, so the preview matches
  // exactly what would be frozen at the Spieltag's opening time.
  const cutoff = bettingOpensAt ? new Date(bettingOpensAt) : null
  const oddsMatches = snapshotMatches(modelMatches, cutoff)

  // Existing frozen rows (if any) — exact_score_odds is the persisted auto grid;
  // once a match is frozen this is the binding source of truth and must NOT be
  // recomputed live here (that would let the admin view drift from what was
  // actually frozen and shown to bettors). Only a not-yet-frozen match computes
  // live, matching what tipps/page.tsx will freeze soon.
  const matchIds = matchdayMatches.map((m) => m.id)
  const { data: frozenRows } = matchIds.length > 0
    ? await supabase.from('odds').select('match_id, frozen_at, exact_score_odds').in('match_id', matchIds)
    : { data: [] }
  const frozenMap = new Map((frozenRows ?? []).map((r) => [r.match_id, r.frozen_at]))
  const exactAutoMap = new Map((frozenRows ?? []).map((r) => [r.match_id, r.exact_score_odds as Record<string, number> | null]))

  // Wildenroth handicap-perspective override (see lib/oddsMarkets.ts) — same
  // stable team-id lookup app/api/bets/place/route.ts uses, so the admin
  // preview's "Handicap ... angeboten" label can never disagree with what a
  // bettor actually gets offered.
  const { data: wtRows } = await supabase
    .from('teams')
    .select('id, name')
    .in('name', ['SpVgg Wildenroth', 'SpVgg Wildenroth II'])
  const wildenrothTeamIds = {
    team1Id: wtRows?.find((t) => t.name === 'SpVgg Wildenroth')?.id ?? null,
    team2Id: wtRows?.find((t) => t.name === 'SpVgg Wildenroth II')?.id ?? null,
  }

  // Match-specific model xG override — same mechanism tipps/page.tsx's freeze
  // pipeline uses (see there for the full rationale). Only affects the
  // exact-score grid for a not-yet-frozen match's preview; standard markets
  // (oddsFromXG below) always use the model's own getMatchXG output.
  const exactScoreXgOverrideMap = new Map<number, { homeXG: number; awayXG: number }>()
  if (matchIds.length > 0) {
    const { data: xgOverrideRows } = await createAdminClient()
      .from('match_odds_overrides')
      .select('match_id, model_home_xg_override, model_away_xg_override')
      .in('match_id', matchIds)
    for (const row of xgOverrideRows ?? []) {
      if (row.model_home_xg_override != null && row.model_away_xg_override != null) {
        exactScoreXgOverrideMap.set(row.match_id, {
          homeXG: Number(row.model_home_xg_override),
          awayXG: Number(row.model_away_xg_override),
        })
      }
    }
  }

  const previews = []
  for (const m of matchdayMatches) {
    const { homeXG: rawHomeXG, awayXG: rawAwayXG, diagnostics } = getMatchXG(oddsMatches, m.home_team_id, m.away_team_id, priorCtx)
    // Match-specific model xG override — MUST apply to the standard markets
    // (odds, below) too, not just the exact-score grid further down, so the
    // preview an admin reviews can never disagree with what freezing this
    // match will actually produce (see app/api/admin/odds/route.ts).
    const modelXg = exactScoreXgOverrideMap.get(m.id)
    const homeXG = modelXg?.homeXG ?? rawHomeXG
    const awayXG = modelXg?.awayXG ?? rawAwayXG
    const odds = oddsFromXG(homeXG, awayXG)
    await persistOddsDiagnostics(supabase, m.id, 'admin_preview', diagnostics)

    // Full 0-6 per side grid of AUTO odds (unfiltered by MAX_EXACT_ODDS) — the
    // admin editor needs to be able to override any "relevant" score, including
    // ones currently > MAX_EXACT_ODDS and thus not offered to bettors.
    const persistedGrid = exactAutoMap.get(m.id)
    const fullGrid: Record<string, number> = persistedGrid
      ?? Object.fromEntries(getFullExactScoreMatrix(modelXg?.homeXG ?? homeXG, modelXg?.awayXG ?? awayXG).map((r) => [r.score, r.odds]))
    const exact: { score: string; odds: number }[] = []
    for (let h = 0; h <= 6; h++) {
      for (let a = 0; a <= 6; a++) {
        const score = `${h}:${a}`
        if (fullGrid[score] != null) exact.push({ score, odds: fullGrid[score] })
      }
    }
    previews.push({
      match_id: m.id,
      match_number: m.match_number,
      match_date: m.match_date,
      status: m.status,
      home_team: m.home_team?.name ?? '?',
      away_team: m.away_team?.name ?? '?',
      frozen_at: frozenMap.get(m.id) ?? null,
      odds,
      diagnostics,
      exact_scores: exact,
      handicapForceHomeSide: wildenrothHandicapForceHomeSide(m, targetMd, wildenrothTeamIds) ?? null,
    })
  }

  return NextResponse.json({
    matchday: targetMd,
    matchdays,
    matches: previews,
    bettingOpensAt,
    isBettingOpen,
  })
}
