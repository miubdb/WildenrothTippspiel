/**
 * cupShootoutWinner: 'home'|'away'|null — who won the penalty shootout on a
 * cup match's 90-minute draw (irrelevant/null otherwise). Consulted for
 * 'cup_advance' and the 3 correlated specials below.
 * cupFirstGoalTeam: 'home'|'away'|'none'|null — which side scored first in
 * regular time + stoppage on a cup match (match_goalscorers has no minute
 * column, so this can't be derived automatically). Only consulted for
 * market 'cup_first_goal'.
 * cupHalftimeHomeGoals/cupHalftimeAwayGoals: manual admin half-time score
 * input. Only consulted for 'cup_halftime_lead_advance'.
 * cupAwayTeamLed: manual admin boolean — did the away side lead by goals at
 * any point in regulation? Only consulted for 'cup_comeback_advance'. See
 * types/index.ts#cup_away_team_led for why this is a plain manual boolean
 * rather than derived from match_goalscorers.
 *
 * advances(): shared "who actually went through" resolver — the SAME
 * 90-minute-result-then-shootout logic 'cup_advance' already uses, reused by
 * every correlated special below so they can never disagree with
 * 'cup_advance' about who won.
 */
export function cupAdvanceWinner(
  homeScore: number,
  awayScore: number,
  cupShootoutWinner?: 'home' | 'away' | null,
): 'home' | 'away' | null {
  if (homeScore > awayScore) return 'home'
  if (awayScore > homeScore) return 'away'
  return cupShootoutWinner ?? null
}

export function settleBet(
  marketType: string,
  selection: string,
  homeScore: number,
  awayScore: number,
  cupShootoutWinner?: 'home' | 'away' | null,
  cupFirstGoalTeam?: 'home' | 'away' | 'none' | null,
  cupHalftimeHomeGoals?: number | null,
  cupHalftimeAwayGoals?: number | null,
  cupAwayTeamLed?: boolean | null,
  /** Round-6: minute of the match's first goal (regular time + stoppage),
   *  null when there was no goal at all (0:0). Only consulted for
   *  'cup_early_goal' — see matches.cup_first_goal_minute. */
  cupFirstGoalMinute?: number | null,
): 'won' | 'lost' {
  switch (marketType) {
    case 'cup_early_goal': {
      // "Ja": the match's first goal (either team, regular time + stoppage)
      // fell in minute 1-15 inclusive. No goal at all (minute null) -> lost.
      const yes = cupFirstGoalMinute != null && cupFirstGoalMinute >= 1 && cupFirstGoalMinute <= 15
      const won = selection === 'yes' ? yes : !yes
      return won ? 'won' : 'lost'
    }
    case 'cup_ht_more_goals': {
      // Fully automatic from half-time + full-time score alone — no extra
      // manual admin field. Fail-safe: missing half-time score can't happen
      // here since settle's POST handler already refuses to settle a cup
      // match without it (same guard cup_halftime_lead_advance relies on).
      const ht1 = (cupHalftimeHomeGoals ?? 0) + (cupHalftimeAwayGoals ?? 0)
      const ht2 = (homeScore - (cupHalftimeHomeGoals ?? 0)) + (awayScore - (cupHalftimeAwayGoals ?? 0))
      const outcome = ht1 > ht2 ? 'h1' : ht2 > ht1 ? 'h2' : 'equal'
      return selection === outcome ? 'won' : 'lost'
    }
    case 'cup_both_halves_btts': {
      // "Ja": both teams score >=1 in HZ1 AND both teams score >=1 in HZ2
      // (fulltime minus halftime per team). Fully automatic, same inputs.
      const htHome = cupHalftimeHomeGoals ?? 0
      const htAway = cupHalftimeAwayGoals ?? 0
      const h2Home = homeScore - htHome
      const h2Away = awayScore - htAway
      const yes = htHome > 0 && htAway > 0 && h2Home > 0 && h2Away > 0
      const won = selection === 'yes' ? yes : !yes
      return won ? 'won' : 'lost'
    }
    case 'cup_advance': {
      // 90-minute result decides it outright unless it's a draw, in which
      // case (no extra time — straight to penalties) the admin-recorded
      // shootout winner decides. A draw with no shootout winner recorded yet
      // can't be settled correctly — fail safe as 'lost' rather than
      // guessing; the admin must enter the shootout winner before settling.
      const winner = cupAdvanceWinner(homeScore, awayScore, cupShootoutWinner)
      return selection === winner ? 'won' : 'lost'
    }
    case 'cup_first_goal': {
      return cupFirstGoalTeam != null && selection === cupFirstGoalTeam ? 'won' : 'lost'
    }
    case 'cup_decision': {
      // Unentschieden nach 90 -> Elfmeterschießen entscheidet; sonst 90 Minuten.
      const decidedInShootout = homeScore === awayScore
      const won = decidedInShootout ? selection === 'shootout' : selection === 'regulation'
      return won ? 'won' : 'lost'
    }
    case 'cup_halftime_lead_advance': {
      // "Ja" nur wenn (1) Wildenroth (home) führt zur Halbzeit UND (2)
      // Wildenroth erreicht anschließend die nächste Runde. Fail-safe: no
      // half-time score recorded yet -> can't be 'yes', still gradeable as
      // 'lost' for a 'yes' selection (never silently wins on missing data);
      // 'no' still settles correctly off the final winner alone in that case
      // since a missing HT score can never make the "yes" condition true.
      const winner = cupAdvanceWinner(homeScore, awayScore, cupShootoutWinner)
      const homeLedAtHt = cupHalftimeHomeGoals != null && cupHalftimeAwayGoals != null &&
        cupHalftimeHomeGoals > cupHalftimeAwayGoals
      const yes = homeLedAtHt && winner === 'home'
      const won = selection === 'yes' ? yes : !yes
      return won ? 'won' : 'lost'
    }
    case 'cup_comeback_advance': {
      // "Ja": Geiselbullach (away) führte während der regulären Spielzeit
      // mindestens einmal nach Toren UND Wildenroth (home) kommt trotzdem weiter.
      const winner = cupAdvanceWinner(homeScore, awayScore, cupShootoutWinner)
      const yes = (cupAwayTeamLed ?? false) && winner === 'home'
      const won = selection === 'yes' ? yes : !yes
      return won ? 'won' : 'lost'
    }
    case 'cup_shootout_advance': {
      // "Ja": Remis nach 90 Minuten UND Wildenroth (home) gewinnt das Elfmeterschießen.
      const decidedInShootout = homeScore === awayScore
      const yes = decidedInShootout && cupShootoutWinner === 'home'
      const won = selection === 'yes' ? yes : !yes
      return won ? 'won' : 'lost'
    }
    case '1x2': {
      if (homeScore > awayScore && selection === 'home') return 'won'
      if (homeScore === awayScore && selection === 'draw') return 'won'
      if (homeScore < awayScore && selection === 'away') return 'won'
      return 'lost'
    }
    case 'double_chance': {
      if (selection === '1x' && homeScore >= awayScore) return 'won'
      if (selection === 'x2' && awayScore >= homeScore) return 'won'
      if (selection === '12' && homeScore !== awayScore) return 'won'
      return 'lost'
    }
    case 'over_under': {
      const total = homeScore + awayScore
      if (total > 2.5 && (selection === 'over' || selection === 'over_2.5')) return 'won'
      if (total <= 2.5 && (selection === 'under' || selection === 'under_2.5')) return 'won'
      return 'lost'
    }
    case 'over_under_3_5': {
      const total = homeScore + awayScore
      if (total > 3.5 && selection === 'over_3.5') return 'won'
      if (total <= 3.5 && selection === 'under_3.5') return 'won'
      return 'lost'
    }
    case 'btts': {
      const bothScored = homeScore > 0 && awayScore > 0
      if (bothScored && selection === 'yes') return 'won'
      if (!bothScored && selection === 'no') return 'won'
      return 'lost'
    }
    case 'over_under_5_5': {
      const total = homeScore + awayScore
      if (total > 5.5 && selection === 'over_5.5') return 'won'
      if (total <= 5.5 && selection === 'under_5.5') return 'won'
      return 'lost'
    }
    case 'over_under_7_5': {
      const total = homeScore + awayScore
      if (total > 7.5 && selection === 'over_7.5') return 'won'
      if (total <= 7.5 && selection === 'under_7.5') return 'won'
      return 'lost'
    }
    case 'handicap': {
      const diff = homeScore - awayScore
      if (selection === 'home_minus_1_5') return diff >= 2 ? 'won' : 'lost'
      if (selection === 'away_plus_1_5')  return diff <= 1 ? 'won' : 'lost'
      if (selection === 'home_minus_2_5') return diff >= 3 ? 'won' : 'lost'
      if (selection === 'away_plus_2_5')  return diff <= 2 ? 'won' : 'lost'
      // Mirrored (away-favoured) direction.
      if (selection === 'away_minus_1_5') return diff <= -2 ? 'won' : 'lost'
      if (selection === 'home_plus_1_5')  return diff >= -1 ? 'won' : 'lost'
      if (selection === 'away_minus_2_5') return diff <= -3 ? 'won' : 'lost'
      if (selection === 'home_plus_2_5')  return diff >= -2 ? 'won' : 'lost'
      return 'lost'
    }
    case 'exact_score': {
      // selection format: "2:1"
      const parts = selection.split(':')
      if (parts.length !== 2) return 'lost'
      const selHome = parseInt(parts[0])
      const selAway = parseInt(parts[1])
      if (selHome === homeScore && selAway === awayScore) return 'won'
      return 'lost'
    }
    default:
      return 'lost'
  }
}
