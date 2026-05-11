export type MarketType = '1x2' | 'over_under' | 'over_under_3_5' | 'btts' | 'exact_score'

export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'cancelled'

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
}

export interface Odds {
  id: number
  match_id: number
  home_win: number
  draw: number
  away_win: number
  over_2_5: number
  under_2_5: number
  btts_yes: number
  btts_no: number
  updated_at: string
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
}

export interface OddsData {
  home_win: number
  draw: number
  away_win: number
  over_2_5: number
  under_2_5: number
  over_3_5: number
  under_3_5: number
  btts_yes: number
  btts_no: number
}
