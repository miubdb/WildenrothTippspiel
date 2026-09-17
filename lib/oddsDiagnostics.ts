import type { SupabaseClient } from '@supabase/supabase-js'
import type { OddsDiagnostics } from '@/lib/odds'

export type OddsDiagnosticsSource = 'freeze' | 'admin_recalc' | 'admin_preview'

/**
 * Persists one odds_diagnostics row for a single match's odds calculation, so an
 * admin can see why a given odds number came out the way it did without
 * re-deriving it by hand.
 * Best-effort — a logging failure must never block odds freezing/recalculation.
 *
 * The columns below the original block are NULLABLE and were added by the
 * `odds_diagnostics_league_aware_columns` migration. Rows written before it
 * (everything up to and including Spieltag 7) keep exactly the values they had
 * and simply carry NULL for the new fields — the explain view renders whatever
 * is present rather than assuming the new shape. Nothing is backfilled.
 */
export async function persistOddsDiagnostics(
  supabase: SupabaseClient,
  matchId: number,
  source: OddsDiagnosticsSource,
  diagnostics: OddsDiagnostics
): Promise<void> {
  try {
    const { home, away } = diagnostics
    await supabase.from('odds_diagnostics').insert({
      match_id: matchId,
      source,
      home_games_played: home.gamesPlayed,
      away_games_played: away.gamesPlayed,
      home_k_effective: home.kEffective,
      away_k_effective: away.kEffective,
      home_form_mult: home.formMult,
      away_form_mult: away.formMult,
      home_roster_factor: home.rosterFactor,
      away_roster_factor: away.rosterFactor,
      home_raw_xg: home.rawXG,
      away_raw_xg: away.rawXG,
      home_final_xg: home.finalXG,
      away_final_xg: away.finalXG,

      // League environment the fixture was priced in.
      tier: diagnostics.tier,
      baseline_home: diagnostics.baselineHome,
      baseline_away: diagnostics.baselineAway,
      baseline_sample_matches: diagnostics.baselineSampleMatches,

      // Hierarchical overall → venue estimate per side.
      home_games_all: home.gamesAll,
      home_games_venue: home.gamesVenue,
      home_goals_for_pg_all: home.goalsForPerGameAll,
      home_goals_against_pg_all: home.goalsAgainstPerGameAll,
      home_goals_for_pg_venue: home.goalsForPerGameVenue,
      home_goals_against_pg_venue: home.goalsAgainstPerGameVenue,
      home_venue_weight: home.venueWeight,
      home_prior_games: home.priorGames,
      home_league_transition: home.leagueTransition,
      home_estimated_attack: home.estimatedAttack,
      home_estimated_defence: home.estimatedDefence,

      away_games_all: away.gamesAll,
      away_games_venue: away.gamesVenue,
      away_goals_for_pg_all: away.goalsForPerGameAll,
      away_goals_against_pg_all: away.goalsAgainstPerGameAll,
      away_goals_for_pg_venue: away.goalsForPerGameVenue,
      away_goals_against_pg_venue: away.goalsAgainstPerGameVenue,
      away_venue_weight: away.venueWeight,
      away_prior_games: away.priorGames,
      away_league_transition: away.leagueTransition,
      away_estimated_attack: away.estimatedAttack,
      away_estimated_defence: away.estimatedDefence,
    })
  } catch (err) {
    console.error('odds_diagnostics insert failed:', err)
  }
}
