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
  // Einseitig: es gibt bewusst keine 'under_9.5'-Auswahl (siehe lib/odds.ts).
  over_9_5: { 'over_9.5': 'over_9_5' },
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
  // Cup-only markets (see lib/odds.ts#cupMarketOddsFromXG) — only ever
  // populated on the one-off cup fixture's own `odds` row, null everywhere
  // else, so these columns are simply never matched for a normal match.
  cup_advance: { home: 'cup_advance_home', away: 'cup_advance_away' },
  cup_first_goal: { home: 'cup_first_goal_home', away: 'cup_first_goal_away', none: 'cup_first_goal_none' },
  // The 3 Monte-Carlo-derived cup specials + decision-method market (see
  // lib/odds.ts#cupSpecialMarketOddsFromXG / lib/cupSimulation.ts) — same
  // "only ever populated on the one cup fixture's odds row" story as above.
  cup_decision: { regulation: 'cup_decision_regulation', shootout: 'cup_decision_shootout' },
  cup_halftime_lead_advance: { yes: 'cup_halftime_lead_advance_yes', no: 'cup_halftime_lead_advance_no' },
  cup_comeback_advance: { yes: 'cup_comeback_advance_yes', no: 'cup_comeback_advance_no' },
  cup_shootout_advance: { yes: 'cup_shootout_advance_yes', no: 'cup_shootout_advance_no' },
  // Round-6 additions (lib/odds.ts#cupRound6MarketOddsFromSim) — same
  // cup-fixture-only story as above.
  cup_early_goal: { yes: 'cup_early_goal_yes', no: 'cup_early_goal_no' },
  cup_ht_more_goals: { h1: 'cup_ht_more_goals_h1', h2: 'cup_ht_more_goals_h2', equal: 'cup_ht_more_goals_equal' },
  cup_both_halves_btts: { yes: 'cup_both_halves_btts_yes' },
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
 *
 * `forceHomeSide`, when not null/undefined, overrides the favourite-based
 * pick outright — true forces the home side offered, false the away side.
 * See `wildenrothHandicapForceHomeSide` below: a Wildenroth match's handicap
 * is offered from WILDENROTH's own side regardless of which team the model
 * favours, so a Wildenroth underdog still offers a backable (longer) minus
 * line on Wildenroth rather than silently switching to the opponent.
 */
export function homeHandicapFavored(odds: { home_win: number; away_win: number }, forceHomeSide?: boolean | null): boolean {
  if (forceHomeSide != null) return forceHomeSide
  return odds.home_win <= odds.away_win
}

/** The 4 handicap selection keys actually offered for a match (2 lines × 2 sides). */
export function offeredHandicapSelections(odds: { home_win: number; away_win: number }, forceHomeSide?: boolean | null): string[] {
  return homeHandicapFavored(odds, forceHomeSide)
    ? ['home_minus_1_5', 'away_plus_1_5', 'home_minus_2_5', 'away_plus_2_5']
    : ['away_minus_1_5', 'home_plus_1_5', 'away_minus_2_5', 'home_plus_2_5']
}

/**
 * First effective (Tippspiel-)Spieltag from which each Wildenroth team's
 * handicap market is forced onto Wildenroth's own side (see
 * `wildenrothHandicapForceHomeSide`) instead of the model's favourite.
 *
 * Team II starts one Spieltag later than Team I: at the moment this rule was
 * introduced, Spieltag 9 already had two live handicap bets placed on Team
 * II's own match (both on `home_minus_2_5`, i.e. already on Wildenroth II's
 * side) under the old favourite-based rule — changing which side an
 * already-live market offers mid-Spieltag would retroactively reinterpret an
 * already-placed bet's own selection, so Spieltag 9 stays on the old rule for
 * Team II specifically. Team I's Spieltag-9 match had zero handicap bets at
 * that point and switches immediately. From Spieltag 10 on both constants
 * agree and this split stops mattering — kept as two named constants rather
 * than collapsed into one, so a future reader doesn't have to rediscover why
 * they were ever different.
 */
export const WILDENROTH_HANDICAP_FROM_MATCHDAY = { team1: 9, team2: 10 } as const

/**
 * Resolves whether a match's handicap market should be forced onto
 * Wildenroth's side rather than the model's favourite — true forces the home
 * side, false the away side, undefined leaves the normal favourite-based
 * logic in `homeHandicapFavored`/`offeredHandicapSelections` untouched
 * (either team doesn't play Wildenroth, or its effective Spieltag is before
 * that team's cutover above).
 *
 * `wildenrothTeamIds` must come from the app's one stable team-id lookup
 * (`teams.name IN ('SpVgg Wildenroth', 'SpVgg Wildenroth II')`, the same
 * resolution app/api/bets/place/route.ts's conflict-of-interest check already
 * does) — never a display-name string comparison on the match itself.
 * `effectiveMatchday` must be the Tippspiel-Spieltag from
 * `lib/season.ts#effectiveMatchdayOf`, not the raw `matches.matchday` column
 * (a Wildenroth-II/Topspiel match runs its own independent BFV numbering).
 */
export function wildenrothHandicapForceHomeSide(
  match: { home_team_id: number | null; away_team_id: number | null },
  effectiveMatchday: number | null | undefined,
  wildenrothTeamIds: { team1Id?: number | null; team2Id?: number | null },
): boolean | undefined {
  if (effectiveMatchday == null) return undefined
  const cutovers: [number | null | undefined, number][] = [
    [wildenrothTeamIds.team1Id, WILDENROTH_HANDICAP_FROM_MATCHDAY.team1],
    [wildenrothTeamIds.team2Id, WILDENROTH_HANDICAP_FROM_MATCHDAY.team2],
  ]
  for (const [teamId, fromMatchday] of cutovers) {
    if (teamId == null || effectiveMatchday < fromMatchday) continue
    if (match.home_team_id === teamId) return true
    if (match.away_team_id === teamId) return false
  }
  return undefined
}
