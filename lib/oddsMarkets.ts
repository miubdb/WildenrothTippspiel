/**
 * Maps a (marketType, selection) pair to its column in the `odds` table.
 * Single source of truth — used both to validate a client-submitted bet's
 * odds against the frozen row (app/api/bets/place/route.ts) and to look up
 * the correct new value when a match's odds are corrected (e.g. the
 * matchday-1 recompute route). Keep these in sync; do not duplicate.
 */
export const ODDS_COLUMN: Record<string, Record<string, string>> = {
  '1x2': { home: 'home_win', draw: 'draw', away: 'away_win' },
  double_chance: { '1x': 'odds_1x', x2: 'odds_x2', '12': 'odds_12' },
  over_under: { 'over_2.5': 'over_2_5', 'under_2.5': 'under_2_5' },
  over_under_3_5: { 'over_3.5': 'over_3_5', 'under_3.5': 'under_3_5' },
  over_under_5_5: { 'over_5.5': 'over_5_5', 'under_5.5': 'under_5_5' },
  over_under_7_5: { 'over_7.5': 'over_7_5', 'under_7.5': 'under_7_5' },
  btts: { yes: 'btts_yes', no: 'btts_no' },
  handicap: {
    home_minus_1_5: 'hdp_home_minus_1_5',
    away_plus_1_5: 'hdp_away_plus_1_5',
    home_minus_2_5: 'hdp_home_minus_2_5',
    away_plus_2_5: 'hdp_away_plus_2_5',
    away_minus_1_5: 'hdp_away_minus_1_5',
    home_plus_1_5: 'hdp_home_plus_1_5',
    away_minus_2_5: 'hdp_away_minus_2_5',
    home_plus_2_5: 'hdp_home_plus_2_5',
  },
}

/**
 * The handicap market has two independent lines (±1.5 and ±2.5), each with a
 * true complementary pair — home_minus_X and away_plus_X (or the mirrored
 * away_minus_X/home_plus_X) are the only genuinely opposite outcomes for the
 * SAME line, since their probabilities sum to 1. A 1.5 and a 2.5 selection on
 * the same favoured side are correlated instead (winning the 2.5 line always
 * wins the 1.5 line too) and are NOT opposites — used to scope the
 * same-match "opposite outcome" hedge check to just these real pairs instead
 * of treating any two different handicap selections as a hedge.
 */
export const HANDICAP_OPPOSITE: Record<string, string> = {
  home_minus_1_5: 'away_plus_1_5',
  away_plus_1_5: 'home_minus_1_5',
  home_minus_2_5: 'away_plus_2_5',
  away_plus_2_5: 'home_minus_2_5',
  away_minus_1_5: 'home_plus_1_5',
  home_plus_1_5: 'away_minus_1_5',
  away_minus_2_5: 'home_plus_2_5',
  home_plus_2_5: 'away_minus_2_5',
}

/**
 * Both handicap directions (home-favoured and away-favoured) are always
 * computed and stored, but only one direction per match is actually offered
 * to bettors — the other one is either a near-certainty or a near-
 * impossibility, not a meaningful bet. Single source of truth for "which
 * direction", derived from the match's own 1X2 odds (lower decimal odds =
 * more likely = favoured) so it can never disagree with the 1X2 market shown
 * on the same card. Used by both the UI (BettingMatchCard) and bet placement
 * validation (app/api/bets/place) — must be called with the exact same odds
 * row in both places.
 */
export function homeHandicapFavored(odds: { home_win: number; away_win: number }): boolean {
  return odds.home_win <= odds.away_win
}

/** The 4 handicap selection keys actually offered for a match (2 lines × 2 sides). */
export function offeredHandicapSelections(odds: { home_win: number; away_win: number }): string[] {
  return homeHandicapFavored(odds)
    ? ['home_minus_1_5', 'away_plus_1_5', 'home_minus_2_5', 'away_plus_2_5']
    : ['away_minus_1_5', 'home_plus_1_5', 'away_minus_2_5', 'home_plus_2_5']
}
