import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildEffectiveMatchdayIndex, recapMatchdayOf } from '@/lib/season'
import { computeAndPersistMatchdayAwards, type AwardType } from '@/lib/awards'
import type { Match } from '@/types'

const SEASON_START = '2026-08-01'
const CURRENT_SEASON = '26/27'

// The 3 categories added after go-live — deliberately scoped so this route
// only ever backfills THESE, never the original 7. computeAndPersistMatchdayAwards
// still computes every category internally (cheap), but onlyTypes restricts
// what actually gets persisted — persistAwards' delete-then-reinsert step
// only touches (season, matchday, award_type) rows for types present in what
// it's given, so the original 7 awards' already-persisted rows are never
// deleted or recomputed by this route.
const BACKFILL_ONLY_TYPES: AwardType[] = ['grosser_wurf', 'torschuetzen_koenig', 'last_minute_tipper']

/**
 * Admin-only manual trigger: persists the 3 new award categories (added
 * after go-live) for every past recap-Spieltag of the current season that
 * has at least one settled (won/lost) bet. Never touches the original 7
 * awards — see BACKFILL_ONLY_TYPES above. Safe to re-run for these 3 —
 * persistAwards deletes-then-reinserts per (season, matchday, award_type),
 * so re-running can't duplicate a winner, only correct it if underlying
 * data changed.
 */
export async function POST() {
  const supabase = await createClient()
  const admin = createAdminClient()

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

  // Same season-match set + effective-matchday grouping as
  // app/(app)/recap/[matchday]/page.tsx, so this backfill targets exactly
  // the same recap-Spieltage the live pages/awards already agree on.
  const { data: seasonMatchesRaw } = await admin
    .from('matches')
    .select('id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status, match_category, is_topspiel, tippspiel_matchday')
    .or(`match_date.gte.${SEASON_START},matchday.eq.999`)

  const seasonMatches = (seasonMatchesRaw ?? []) as Match[]
  const mdIndex = buildEffectiveMatchdayIndex(seasonMatches)

  const matchIdsByRecapMd = new Map<number, number[]>()
  for (const m of seasonMatches) {
    const recapMd = recapMatchdayOf(m, mdIndex)
    if (recapMd == null || recapMd === 999) continue
    const arr = matchIdsByRecapMd.get(recapMd)
    if (arr) arr.push(m.id)
    else matchIdsByRecapMd.set(recapMd, [m.id])
  }

  // Only process recap-Spieltage that actually have at least one settled bet.
  const { data: settledBets } = await admin
    .from('bets')
    .select('match_id')
    .eq('season', CURRENT_SEASON)
    .in('status', ['won', 'lost'])
  const settledMatchIds = new Set((settledBets ?? []).map((b) => b.match_id as number))

  const processedMatchdays: number[] = []
  let totalAwardsWritten = 0

  for (const [matchday, matchIds] of matchIdsByRecapMd) {
    if (!matchIds.some((id) => settledMatchIds.has(id))) continue
    const written = await computeAndPersistMatchdayAwards(admin, CURRENT_SEASON, matchday, matchIds, BACKFILL_ONLY_TYPES)
    processedMatchdays.push(matchday)
    totalAwardsWritten += written
  }

  processedMatchdays.sort((a, b) => a - b)

  return NextResponse.json({ processedMatchdays, totalAwardsWritten })
}
