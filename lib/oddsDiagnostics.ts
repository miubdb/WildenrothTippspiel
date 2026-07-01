import type { SupabaseClient } from '@supabase/supabase-js'
import type { OddsDiagnostics } from '@/lib/odds'

export type OddsDiagnosticsSource = 'freeze' | 'admin_recalc' | 'admin_preview'

/**
 * Persists one odds_diagnostics row for a single match's odds calculation, so an
 * admin can see why a given odds number came out the way it did (K used, form
 * multiplier, roster factor, raw vs. final xG) without re-deriving it by hand.
 * Best-effort — a logging failure must never block odds freezing/recalculation.
 */
export async function persistOddsDiagnostics(
  supabase: SupabaseClient,
  matchId: number,
  source: OddsDiagnosticsSource,
  diagnostics: OddsDiagnostics
): Promise<void> {
  try {
    await supabase.from('odds_diagnostics').insert({
      match_id: matchId,
      source,
      home_games_played: diagnostics.home.gamesPlayed,
      away_games_played: diagnostics.away.gamesPlayed,
      home_k_effective: diagnostics.home.kEffective,
      away_k_effective: diagnostics.away.kEffective,
      home_form_mult: diagnostics.home.formMult,
      away_form_mult: diagnostics.away.formMult,
      home_roster_factor: diagnostics.home.rosterFactor,
      away_roster_factor: diagnostics.away.rosterFactor,
      home_raw_xg: diagnostics.home.rawXG,
      away_raw_xg: diagnostics.away.rawXG,
      home_final_xg: diagnostics.home.finalXG,
      away_final_xg: diagnostics.away.finalXG,
    })
  } catch (err) {
    console.error('odds_diagnostics insert failed:', err)
  }
}
