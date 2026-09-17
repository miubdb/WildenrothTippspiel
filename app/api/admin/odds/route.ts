import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMatchXG, oddsFromXG } from '@/lib/odds'
import { persistOddsDiagnostics } from '@/lib/oddsDiagnostics'
import { loadOddsModelInputs } from '@/lib/oddsInputs'

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

  // Model inputs come from the shared loader so this route, the admin preview
  // and the live tipps page cannot disagree about what the model sees (see
  // lib/oddsInputs.ts — this route used to select matches WITHOUT
  // `match_category`, which mis-tiers every B-Klasse fixture).
  const { seasonMatches, modelMatches, priorCtx } = await loadOddsModelInputs(supabase)

  // Find scheduled matches to update odds for — never touch already-frozen rows:
  // once betting has opened and odds are frozen, they must never change under
  // bettors, even if this recalculation button is pressed again.
  const scheduledMatchIds = seasonMatches.filter((m) => m.status === 'scheduled').map((m) => m.id)
  const { data: frozenRows } = scheduledMatchIds.length > 0
    ? await supabase.from('odds').select('match_id').in('match_id', scheduledMatchIds).not('frozen_at', 'is', null)
    : { data: [] }
  const frozenIds = new Set((frozenRows ?? []).map((r) => r.match_id))
  const scheduledMatches = seasonMatches.filter((m) => m.status === 'scheduled' && !frozenIds.has(m.id))
  const skippedFrozen = scheduledMatchIds.length - scheduledMatches.length

  // Match-specific model xG override (match_odds_overrides.model_home/away_xg_override)
  // — a rare, explicit correction to the model's own team-strength estimate. MUST be
  // applied here too (not just to exact-score/goalscorer in tipps/page.tsx and the
  // preview route) so this button can never freeze a 1X2/O-U/BTTS/Handicap card that
  // disagrees with the corrected exact-score/goalscorer markets on the same fixture.
  const xgOverrideMap = new Map<number, { homeXG: number; awayXG: number }>()
  if (scheduledMatches.length > 0) {
    const { data: xgOverrideRows } = await createAdminClient()
      .from('match_odds_overrides')
      .select('match_id, model_home_xg_override, model_away_xg_override')
      .in('match_id', scheduledMatches.map((m) => m.id))
    for (const row of xgOverrideRows ?? []) {
      if (row.model_home_xg_override != null && row.model_away_xg_override != null) {
        xgOverrideMap.set(row.match_id, {
          homeXG: Number(row.model_home_xg_override),
          awayXG: Number(row.model_away_xg_override),
        })
      }
    }
  }

  let upsertCount = 0
  const errors: string[] = []

  for (const match of scheduledMatches) {
    try {
      const { homeXG: rawHomeXG, awayXG: rawAwayXG, diagnostics } = getMatchXG(modelMatches, match.home_team_id, match.away_team_id, priorCtx)
      const override = xgOverrideMap.get(match.id)
      const homeXG = override?.homeXG ?? rawHomeXG
      const awayXG = override?.awayXG ?? rawAwayXG
      const oddsData = oddsFromXG(homeXG, awayXG)

      const { error } = await supabase.from('odds').upsert(
        {
          match_id: match.id,
          matchday: match.matchday,
          home_win: oddsData.home_win,
          draw: oddsData.draw,
          away_win: oddsData.away_win,
          odds_1x: oddsData.odds_1x,
          odds_x2: oddsData.odds_x2,
          odds_12: oddsData.odds_12,
          over_2_5: oddsData.over_2_5,
          under_2_5: oddsData.under_2_5,
          over_3_5: oddsData.over_3_5,
          under_3_5: oddsData.under_3_5,
          over_5_5: oddsData.over_5_5,
          under_5_5: oddsData.under_5_5,
          over_7_5: oddsData.over_7_5,
          under_7_5: oddsData.under_7_5,
          over_9_5: oddsData.over_9_5,
          btts_yes: oddsData.btts_yes,
          btts_no: oddsData.btts_no,
          hdp_home_minus_1_5: oddsData.hdp_home_minus_1_5,
          hdp_away_plus_1_5: oddsData.hdp_away_plus_1_5,
          hdp_home_minus_2_5: oddsData.hdp_home_minus_2_5,
          hdp_away_plus_2_5: oddsData.hdp_away_plus_2_5,
          hdp_away_minus_1_5: oddsData.hdp_away_minus_1_5,
          hdp_home_plus_1_5: oddsData.hdp_home_plus_1_5,
          hdp_away_minus_2_5: oddsData.hdp_away_minus_2_5,
          hdp_home_plus_2_5: oddsData.hdp_home_plus_2_5,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'match_id' }
      )

      if (error) {
        errors.push(`Match ${match.id}: ${error.message}`)
      } else {
        upsertCount++
        await persistOddsDiagnostics(supabase, match.id, 'admin_recalc', diagnostics)
      }
    } catch (err) {
      errors.push(`Match ${match.id}: ${String(err)}`)
    }
  }

  return NextResponse.json({
    success: true,
    updated: upsertCount,
    total: scheduledMatches.length,
    skippedFrozen,
    errors: errors.length > 0 ? errors : undefined,
  })
}
