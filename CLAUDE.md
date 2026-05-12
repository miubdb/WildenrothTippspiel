@AGENTS.md

## Odds model (lib/odds.ts)

**Unified Poisson model** — all markets (1X2, DC, O/U, BTTS, Exact Score) derive from a single
`buildScoreMatrix(homeXG, awayXG)` call. No separate PPG model for 1X2.

**xG calculation — multiplicative Dixon-Coles with Bayesian shrinkage:**
- `homeXG = LEAGUE_HOME_XG × homeAtkRate × awayDefRate`
- `awayXG = LEAGUE_AWAY_XG × awayAtkRate × homeDefRate`
- Each rate = `bayesianRate(raw, leagueAvg, n)` = `(n*raw + K*leagueAvg) / ((n+K)*leagueAvg)`
  → shrunk toward 1.0 with K=4 (XG_PRIOR) equivalent games
- `homeAtkRate`: home goals scored / LEAGUE_HOME_XG baseline
- `awayDefRate`: goals conceded away by away team / LEAGUE_HOME_XG baseline
- `awayAtkRate`: away goals scored / LEAGUE_AWAY_XG baseline
- `homeDefRate`: goals conceded at home by home team / LEAGUE_AWAY_XG baseline
- Floor: `Math.max(0.20, ...)`
- Constants: `LEAGUE_HOME_XG = 1.20`, `LEAGUE_AWAY_XG = 1.05`, `HOUSE_MARGIN = 0.12`

**Why multiplicative over additive mean:**
Quality mismatches compound (strong attacker vs weak defense → amplified xG), BTTS and O/U
naturally vary more between different matchups, home advantage is data-driven not hardcoded.

**Season filter:** only matches with `match_date >= '2025-08-01'` count for odds and standings.
