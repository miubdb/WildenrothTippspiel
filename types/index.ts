export type MarketType = '1x2' | 'double_chance' | 'over_under' | 'over_under_3_5' | 'over_under_5_5' | 'over_under_7_5' | 'btts' | 'exact_score' | 'handicap' | 'goalscorer' | 'goalscorer_2plus'

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
}

export interface LineupEntry {
  id: number
  match_id: number
  team_name: string
  player_name: string
  minutes_played: number
  goals: number
  assists: number
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
}
