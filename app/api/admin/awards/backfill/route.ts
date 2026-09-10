import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildEffectiveMatchdayIndex, recapMatchdayOf } from '@/lib/season'
import { computeAndPersistMatchdayAwards } from '@/lib/awards'
import type { Match } from '@/types'

const SEASON_START = '2026-08-01'
const CURRENT_SEASON = '26/27'

/**
 * Admin-only manual trigger: recomputes and persists ALL awards (including
 * the 3 added after go-live — grosser_wurf, torschuetzen_koenig,
 * zocker_des_spieltags) for every past recap-Spieltag of the current season
 * that has at least one settled (won/lost) bet. Safe to re-run —
 * persistAwards deletes-then-reinserts per (season, matchday, award_type),
 * so this can't duplicate or disturb the existing 7 awards' winners.
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
    const written = await computeAndPersistMatchdayAwards(admin, CURRENT_SEASON, matchday, matchIds)
    processedMatchdays.push(matchday)
    totalAwardsWritten += written
  }

  processedMatchdays.sort((a, b) => a - b)

  return NextResponse.json({ processedMatchdays, totalAwardsWritten })
}
