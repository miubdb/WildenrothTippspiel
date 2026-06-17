@AGENTS.md

## Branch- und Deployment-Strategie

**Zwei Branches:**
- `integration` = Entwicklung/Test → Vercel Preview Deployment
- `main` = Produktion → Vercel Production Deployment

**WICHTIG – Pushes:**
- Claude pusht Änderungen **ausschließlich auf `integration`**: `git push origin integration`
- **Niemals direkt auf `main` pushen**, außer der Nutzer sagt ausdrücklich: „Bitte integration nach main übernehmen" oder „Bitte auf production deployen"
- Kein `git push origin integration:main` als Standard-Commit-Abschluss

**Merge nach main (nur auf explizite Anweisung):**
```bash
git push origin integration:main
```

**Warum:** Jeder Push auf `main` erzeugt ein neues Vercel Production Deployment.
Jeder Push auf `integration` erzeugt ein Vercel Preview Deployment.
Beide Branches gleichzeitig zu pushen erzeugt doppelte Deployments und ist zu vermeiden.

## Odds model (lib/odds.ts)

**Unified Poisson model** — all markets (1X2, DC, O/U, BTTS, Exact Score) derive from a single
`buildScoreMatrix(homeXG, awayXG)` call. No separate PPG model for 1X2.

**xG calculation — geometric-mean model with Bayesian shrinkage + form multiplier:**
- `rawHomeXG = sqrt(homeGoalsScoredAtHome × awayGoalsConcededAway)`
- `rawAwayXG = sqrt(awayGoalsScoredAway × homeGoalsConcededAtHome)`
- `homeXG = bayesianXG(rawHomeXG, LEAGUE_HOME_XG, n_avg) × homeFormMult` where
  `bayesianXG(r, L, n) = (n*r + K*L) / (n+K)` → shrunk toward LEAGUE_HOME_XG with K=5
- Same for awayXG toward LEAGUE_AWAY_XG, scaled by awayFormMult
- `formMult = 0.80 + 0.40 × (lastN_pts / (lastN * 3))` from last 5 games (range [0.80, 1.20]);
  applies only when ≥ 3 recent games, otherwise 1.0
- Floor: `Math.max(0.25, ...)`
- Constants: `LEAGUE_HOME_XG = 1.25`, `LEAGUE_AWAY_XG = 1.10`, `HOUSE_MARGIN = 0.12`, `XG_PRIOR = 5`

**Why geometric mean (not arithmetic, not full product):**
- Arithmetic `(atk+def)/2`: underestimates quality mismatches.
- Full product `L × atkRate × defRate`: explodes for two extreme teams (two rates of 1.8→ factor 3.24×).
- Geometric mean `sqrt(atk×def)`: AM≥GM inequality keeps the combined signal bounded; a
  strong attacker vs strong defence yields moderate xG (correct), but a strong attacker vs
  weak defence still yields amplified xG, so matchup differentiation is preserved.

**Season filter:** only matches with `match_date >= '2026-08-01'` count for odds and standings.
