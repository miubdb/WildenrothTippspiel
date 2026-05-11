@AGENTS.md

## Odds model (lib/odds.ts)

**1X2 win probabilities** — multiplicative strength model:
- `homeBasePPG = Math.max(homeHomePPG, overallPPG)` — home boost only if team is genuinely stronger at home
- `awayBasePPG = getTeamAwayPPG(...)` — uses actual away record (falls back to overall if < 3 away games)
- `formMult = 0.65 + 0.70 * (formPts_L5 / 15)` — range 0.65 (no form) to 1.35 (perfect form)
- `str = basePPG * formMult`
- Draw: `max(0.13, 0.28 - 0.30 * |pHome - pAway|)` — floor 13%, falls for mismatches
- House margin: 10% overround applied via `toOdds(prob / (1 + 0.10))`

**xG / goal markets** (O/U 3.5, BTTS, Exact Score) — context-specific Poisson:
- `rawHomeXG = (avgScoredHome(home) + avgConcededAway(away)) / 2`
- `rawAwayXG = (avgScoredAway(away) + avgConcededHome(home)) / 2`
- Shrinkage: `xG = 0.85 * raw + 0.15 * 1.8` (league mean 1.8 goals/game)
- avgScored/Conceded Home/Away fall back to overall if < 2 home/away games

**Season filter:** only matches with `match_date >= '2025-08-01'` count for odds and standings.
