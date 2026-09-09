export type MarketType = '1x2' | 'double_chance' | 'over_under' | 'over_under_3_5' | 'over_under_5_5' | 'over_under_7_5' | 'btts' | 'exact_score' | 'handicap' | 'goalscorer' | 'goalscorer_2plus' | 'cup_advance' | 'cup_first_goal' | 'cup_decision' | 'cup_halftime_lead_advance' | 'cup_comeback_advance' | 'cup_shootout_advance' | 'cup_early_goal' | 'cup_ht_more_goals' | 'cup_both_halves_btts'

export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'cancelled' | 'postponed'

export type BetStatus = 'pending' | 'won' | 'lost' | 'void'

export type ComboBetStatus = 'pending' | 'won' | 'lost' | 'void'

export interface Team {
  id: number
  name: string
  short_name: string
}

export interface Match {
  id: number
  match_number: number
  matchday: number
  home_team_id: number
  away_team_id: number
  match_date: string
  home_score: number | null
  away_score: number | null
  status: MatchStatus
  home_team?: Team
  away_team?: Team
  match_category?: 'kreisliga' | 'wildenroth_ii' | 'bklasse_topspiel' | 'b-klasse'
  is_topspiel?: boolean
  tippspiel_matchday?: number | null
  /** 'league' (default) for every normal fixture, 'cup' for a one-off knockout
   *  match like the Sparkassen Fußball-Cup — see lib/odds.ts#cupMarketOddsFromXG
   *  and components/CupMatchCard.tsx. */
  competition_type?: 'league' | 'cup'
  competition_name?: string | null
  competition_round?: string | null
  /** Manual admin settlement input for a cup match's "Wer kommt weiter?"
   *  market when the 90-minute score is a draw — which side won the penalty
   *  shootout. Null for every league match and for a cup match decided in
   *  regular time. */
  cup_shootout_winner?: 'home' | 'away' | null
  /** Manual admin settlement input for a cup match's "Wer erzielt das erste
   *  Tor?" market — match_goalscorers has no minute column, so which side
   *  scored first cannot be derived automatically. */
  cup_first_goal_team?: 'home' | 'away' | 'none' | null
  /** Manual admin settlement input: half-time score, for
   *  cup_halftime_lead_advance. Null for every league match and unset until
   *  an admin enters it for a finished cup match. */
  cup_halftime_home_goals?: number | null
  cup_halftime_away_goals?: number | null
  /** Manual admin settlement input: did the AWAY side lead by goals at any
   *  point during regulation (90 min + stoppage)? Deliberately a plain
   *  boolean rather than derived from match_goalscorers (see
   *  lib/odds.ts#cupSpecialMarketOddsFromXG doc / round-2 spec) — this
   *  dataset has no reliable per-goal minute data to derive "who led when"
   *  automatically, and a wrong auto-derivation would settle real Wildis
   *  incorrectly. Only for cup_comeback_advance. */
  cup_away_team_led?: boolean | null
}


export interface Profile {
  id: string
  username: string
  display_name: string
  balance: number
  is_admin: boolean
  created_at: string
}

export interface Bet {
  id: number
  user_id: string
  match_id: number
  market_type: MarketType
  selection: string
  stake: number
  odds_value: number
  status: BetStatus
  payout: number | null
  combo_id: number | null
  created_at: string
  match?: Match
}

export interface ComboBet {
  id: number
  user_id: string
  stake: number
  total_odds: number
  status: ComboBetStatus
  payout: number | null
  created_at: string
  bets?: Bet[]
}

export interface BetSlipItem {
  matchId: number
  matchLabel: string  // e.g. "Wildenroth vs FC Pöcking"
  marketType: MarketType
  marketLabel: string // e.g. "1X2", "Über 2.5"
  selection: string   // e.g. "home", "draw", "away", "yes", "no", "1:0"
  selectionLabel: string // e.g. "Heimsieg", "Unentschieden"
  oddsValue: number
  homeTeam?: string
  awayTeam?: string
}

/** A result row from `prior_season_matches` — used as historical prior for xG when a team has little current-season data. */
export interface PriorMatch {
  id: number
  season: string
  league_name: string
  league_level: 'kreisklasse' | 'kreisliga' | 'bezirksliga' | 'b_klasse'
  league_number: string | null
  home_team: string
  away_team: string
  home_score: number
  away_score: number
  match_date: string
}

export interface LeaguePlayer {
  id: number
  name: string
  team_name: string
  goals: number
  games: number
  minutes: number
  status?: string | null
  transfer_to?: string | null
  prior_league_level?: 'bezirksliga' | 'kreisliga' | 'kreisklasse' | 'b_klasse' | null
  prior_team_name?: string | null
}

export interface LineupEntry {
  id: number
  match_id: number
  team_name: string
  player_name: string
  minutes_played: number
  goals: number
  assists: number
  /** Minute of a straight/second-yellow red card, if any — null otherwise. */
  red_card_minute?: number | null
  created_at: string
}

export interface OddsData {
  home_win: number
  draw: number
  away_win: number
  odds_1x: number
  odds_x2: number
  odds_12: number
  over_2_5: number
  under_2_5: number
  over_3_5: number
  under_3_5: number
  over_5_5: number
  under_5_5: number
  over_7_5: number
  under_7_5: number
  btts_yes: number
  btts_no: number
  hdp_home_minus_1_5: number
  hdp_away_plus_1_5: number
  hdp_home_minus_2_5: number
  hdp_away_plus_2_5: number
  hdp_away_minus_1_5: number
  hdp_home_plus_1_5: number
  hdp_away_minus_2_5: number
  hdp_home_plus_2_5: number
  /** Cup-only markets (see lib/odds.ts#cupMarketOddsFromXG) — undefined for
   *  every normal league match. */
  cup_advance_home?: number
  cup_advance_away?: number
  cup_first_goal_home?: number
  cup_first_goal_away?: number
  cup_first_goal_none?: number
  /** The 3 Monte-Carlo-derived cup specials (see
   *  lib/odds.ts#cupSpecialMarketOddsFromXG) plus the decision-method market
   *  — undefined for every normal league match. */
  cup_decision_regulation?: number
  cup_decision_shootout?: number
  cup_halftime_lead_advance_yes?: number
  cup_halftime_lead_advance_no?: number
  cup_comeback_advance_yes?: number
  cup_comeback_advance_no?: number
  cup_shootout_advance_yes?: number
  cup_shootout_advance_no?: number
  /** Round-6 additions (see lib/odds.ts#cupRound6MarketOddsFromSim) —
   *  undefined for every normal league match. */
  cup_early_goal_yes?: number
  cup_early_goal_no?: number
  cup_ht_more_goals_h1?: number
  cup_ht_more_goals_h2?: number
  cup_ht_more_goals_equal?: number
  cup_both_halves_btts_yes?: number
}
