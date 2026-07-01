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
  },
}
