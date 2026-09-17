# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

A mobile-first PWA (Next.js App Router) for SpVgg Wildenroth's internal "Tippspiel" — members bet
virtual currency ("Wildis") on real Kreisliga/B-Klasse football matches (1X2, double chance,
over/under, BTTS, handicap, exact score, goalscorer markets). Odds are model-generated (Poisson),
not sportsbook-sourced. UI is German; code/comments are English.

## Commands

```bash
npm run dev      # start dev server (Turbopack)
npm run build    # production build — run this (or `npx tsc --noEmit`) before considering a change done
npm run lint     # eslint

# Quotenmodell (kein Test-Framework — Backtest statt Unit-Tests)
node --experimental-strip-types scripts/run-backtest.mjs --compare /tmp/baseline.json
node --experimental-strip-types scripts/run-matchday-preview.mjs 8
```

Beide Skripte brauchen die Datenexporte unter `$BACKTEST_DATA_DIR` (Default `/tmp/bt`):
`matches.json`, `prior.json`, `players.json`, `lineups.json` — je ein Array von Spalten-Arrays,
exportiert per `json_agg` aus Supabase (siehe `scripts/backtest.ts#loadData` für die Spaltenreihenfolge).

There is no test suite. Validate changes with `npx tsc --noEmit` and `npm run build`; for
betting/odds logic changes, reason through the math by hand or query Supabase directly (MCP tools)
against real data rather than relying on unit tests.

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

## Architecture

**Route groups**: `app/(app)/*` = authenticated member area (tipps, tabelle, leaderboard, kader
player profiles, profil), `app/(auth)/*` = login/register, `app/admin/*` = admin-only panel.
Auth/admin gating happens in `proxy.ts` (this Next.js version renames `middleware.ts` → `proxy.ts`,
see AGENTS.md) — it redirects unauthenticated users out of protected routes and non-admins out of
`/admin`. Individual API routes under `app/api/admin/*` re-check `profiles.is_admin` themselves too
(the proxy only guards page routes, not `/api/*`).

**Supabase client factories** (`lib/supabase/`):
- `server.ts` — session-scoped client (RLS applies), used in Server Components/most API routes
- `client.ts` — browser client for Client Components
- `admin.ts` — service-role client bypassing RLS, used only where an action must touch another
  user's row (settlement payouts, admin writes) — never expose to client code

**RLS is the real security boundary**, not just API-route checks — `profiles` has column-level
GRANTs restricting which columns the `authenticated` role can UPDATE directly (only `username`,
`display_name`, `bio`, `favorite_team`, `avatar_url`); `balance`, `is_admin`, `is_wildenroth`,
`eligible_for_current_season`, `season_start_balance` can only change via the service-role client.
Balance mutations (bet placement/cancellation/settlement/inactivity penalty) go through atomic
Postgres functions (`deduct_balance`, `increment_balance`, `apply_penalty` — called via
`supabase.rpc()`), not read-then-write in JS, to avoid double-spend races.

### Odds model (`lib/odds.ts`)

**Unified Poisson model** — all markets (1X2, double chance, O/U at 2.5/3.5/5.5/7.5, BTTS, Asian
handicap ±1.5/±2.5, exact score) derive from a single `buildScoreMatrix(homeXG, awayXG)` call. No
separate PPG model for 1X2 — this keeps every market internally consistent.

**League baselines** (`getLeagueBaselines`) — every market's absolute goal level is anchored on an
*empirical, per-league* home/away pair, not a hardcoded constant. Two tiers (`LeagueTier`):
`kreisliga` (default + `match_category='kreisliga'`) and `b_klasse` (`wildenroth_ii`,
`bklasse_topspiel`, `b-klasse`). Derived by empirical Bayes: the tier's own evidence
(`prior_season_matches` of that level + finished current-season fixtures of that tier) shrunk
toward the pooled all-leagues prior with `LEAGUE_BASELINE_PRIOR_MATCHES = 60` pseudo-matches.
Total goals and home SHARE are shrunk separately — the total is what the O/U markets are
calibrated against, the share is the home advantage. `prior_season_matches` contains **no
b_klasse rows at all**, so the B-Klasse baseline is mostly the pooled prior early on;
`diagnostics.baselineSampleMatches` reports how much real evidence there actually is. Fallbacks
(`FALLBACK_TOTAL_GOALS = 4.0`, `FALLBACK_HOME_SHARE = 0.56`) apply only with zero prior data.

**xG calculation** (`getMatchXG`) — hierarchical overall→venue rates, then a geometric mean:
- `teamRates()` per side: prior-season pseudo-games (cross-league-normalized) are blended into the
  team's OVERALL current-season attack/defence rate, that rate is shrunk toward the tier baseline
  with `TEAM_PRIOR_GAMES = 4`, and the venue-specific rate is then shrunk toward
  `overallRate × thisVenue'sFactor` with `VENUE_PRIOR_GAMES = 5`. No hard jump at 3 games — the
  venue record simply gains weight continuously (`diagnostics.*.venueWeight`).
- `rawHomeXG = sqrt(home.atk × away.def)`, `rawAwayXG = sqrt(away.atk × home.def)` — both inputs
  are already on this venue's goal scale, so two average teams reproduce the baseline exactly.
- `homeXG = max(XG_FLOOR, rawHomeXG × homeFormMult × homeRosterFactor)`, same for away.
- `formMult = 0.90 + 0.20 × (lastN_pts / (lastN × 3))` from the last 5 games (range [0.90, 1.10]),
  ramped in linearly between `FORM_RAMP_START = 3` and `FORM_RAMP_FULL = 8` current-season games.
- Match contributions are red-card-weighted (`redCardWeight`), so game counts in diagnostics are
  fractional on purpose.
- Constants: `HOUSE_MARGIN = 0.12`, `XG_FLOOR = 0.25`, `MIN_ODDS = 1.01`, `MAX_ODDS = 100`.
- **Shrinkage happens exactly once.** The previous model shrank twice (`augmentStat`, then a
  dynamic `K` ramping to 11 during the first 8 games), which pinned an early-season fixture's xG
  almost entirely onto two hardcoded league constants — every match looked roughly the same
  before Christmas. Both of those are gone; don't reintroduce a second shrinkage layer.

**Why geometric mean (not arithmetic, not full product):**
- Arithmetic `(atk+def)/2`: underestimates quality mismatches.
- Full product `L × atkRate × defRate`: explodes for two extreme teams (two rates of 1.8→ factor 3.24×).
- Geometric mean `sqrt(atk×def)`: AM≥GM inequality keeps the combined signal bounded; a
  strong attacker vs strong defence yields moderate xG (correct), but a strong attacker vs
  weak defence still yields amplified xG, so matchup differentiation is preserved.

**Cross-league normalization** (`LEAGUE_STRENGTH`): bezirksliga 1.10 / kreisliga 1.00 / kreisklasse
0.78 / b_klasse 0.68. Applied as a source→target **transition** (`leagueTransition(source, target)
= LEAGUE_STRENGTH[source] / LEAGUE_STRENGTH[targetTier]`), not as an absolute discount: it is
exactly 1.0 within a league (a B-Klasse team's B-Klasse history carries over untouched), >1 coming
down from a stronger league, <1 coming up from a weaker one. Attack is multiplied by it, defence
divided — opposite directions, since a team promoted from a weaker league should look both less
dangerous AND more porous in the stronger one. The old code applied the absolute factor to both
sides in the same direction, which anchored every B-Klasse fixture on Kreisliga goal levels with
an inflated conceding rate (→ systematically too-short BTTS/Over). Also used for individual
transferred-in players' prior-club goal output in the roster factor.

**Roster factor** (`getRosterFactor`, `league_players` + `match_lineups` tables) — two tiers. Once
≥3 matches of current-season lineup data exist for a team, real lineup presence/absence drives the
factor directly. Before that (pre-season / early matchdays), it falls back to known transfer
records: `league_players.status` (`active` / `transferred_out` / `retired` / `internal_move` /
`transferred_in`) nets last season's departed scorers (full weight — certain loss) against known
incoming signings (`prior_league_level`-normalized via `LEAGUE_STRENGTH`, then damped 0.65× — unproven
at the new club), bounded to `[0.65, 1.15]` (asymmetric: losses are certain, gains aren't yet).

**Odds freezing**: odds are computed live until a matchday's betting window opens (Monday 12:00
Europe/Berlin of match week — or immediately if `app_settings.early_betting_open` is set), then
frozen into the `odds` table (`frozen_at` set) and never recomputed after that point. This happens
in `tipps/page.tsx` on page load, and on demand via `app/api/admin/odds/route.ts` ("Quoten neu
berechnen"). **All model inputs load through `lib/oddsInputs.ts#loadOddsModelInputs`** — freeze,
admin preview, recalc and the Spieltag-Specials engine must see the same matches, the same
`PriorContext` and the same columns. They had drifted: the recalc route selected matches without
`match_category` (→ wrong league tier), and `lib/matchdaySpecials.ts` passed no `PriorContext` at
all. Add a new odds call site by importing that loader, never by writing another query.

**Bet placement** (`app/api/bets/place/route.ts`) re-validates everything server-side rather than
trusting the client: stake bounds, odds values against the frozen `odds` row (exact score is
sanity-bounded against its 1X2 direction since it isn't a stored column), same-match combo
contradiction checks, betting deadlines, per-matchday bet limits (max 3 total / max 2 non-risky),
and the Wildenroth conflict-of-interest rule (`lib/wildenroth.ts` — a flagged Wildenroth
player/coach can't place a bet whose payout depends on their own team not winning).

**Season filter:** only matches with `match_date >= SEASON_START` (currently `'2026-08-01'`) count
for odds and standings. Exported once from `lib/season.ts` (re-exported by `lib/oddsInputs.ts`) —
it used to be copy-pasted as a literal into ~20 files; import it.

**Backtest** (`scripts/backtest.ts`, run via `node --experimental-strip-types
scripts/run-backtest.mjs`) — walk-forward over finished matches in true chronological order by
`match_date`, importing the REAL production model through `scripts/ts-resolver.mjs` (the old
`scripts/check-odds.js` re-implemented the model with copied constants and silently drifted out of
sync; it is deleted). For each fixture the model only sees results/lineups from matches that had
already finished before that kickoff. Scores probabilities BEFORE the house margin. Use
`--save <f>` / `--compare <f>` to compare two model versions; **this is the only place model
constants may be chosen.** `scripts/run-matchday-preview.mjs <spieltag> [--old <odds.ts>]` prices
an upcoming Spieltag for eyeballing — it has no results and must never inform calibration.

**BTTS / scoring-probability monitoring** (`scripts/btts-analysis.ts`, run via
`scripts/run-btts-analysis.mjs`) — BTTS is not a market of its own: under independent Poisson
`P(BTTS) = P(home ≥ 1) × P(away ≥ 1)` exactly (verified to 4e-5 against the score matrix), so a
BTTS price can only be wrong if a per-team scoring probability is wrong, or if the two teams'
goal counts are not independent. The script measures both separately, plus per-team calibration
bucketed by the team's observed goals/game before kickoff. **Never "fix" BTTS directly** — it has
no parameters of its own, and a fix at the xG level automatically moves 1X2, O/U, handicap and
exact score with it (which is the point).

Reviewed after Spieltag 7 (n=70 matches / 140 team-games): BTTS 67.3 % modelled vs 68.6 % actual
(z = +0.23); the zero cell — the only thing BTTS depends on — predicted 25.0 of 140, observed 25;
independence φ = 0.075 ± 0.120. **No change made.** The apparent "weak offences get too much xG"
signal was 2 of 12 B-Klasse teams with 3 games each. Re-check at **n ≈ 150 matches** (roughly
Spieltag 14), watching in this order: (1) the zero cell predicted-vs-observed across all team-games,
(2) `P(team scores ≥ 1)` split by whether the team has prior-season data — the no-prior group ran
87 % vs 81 % on n=32, the single largest open gap, (3) modelled vs actual total goals per match
(3.61 vs 3.97, z = +1.42 — the model may run ~10 % low on goal level, which is an O/U question, not
a BTTS one). Lowering `TEAM_PRIOR_GAMES` improves every metric on the full sample but the entire
gain sits in the second half of the season and in the no-prior-season group; it was rejected as
overfitting at this sample size.

### Goalscorer model (`lib/goalscorer.ts`)

**Two strictly separated levels.** (A) `teamMatchXG` comes from the main model
(`getMatchXG`, plus any `match_odds_overrides` xG correction) and is read-only here — it is the
same number that prices 1X2/O-U/BTTS/handicap/exact score for that fixture. (B) This file only
decides **how that xG is split**: player features (Bayesian goals/90, projected minutes, set-piece
and preseason bumps) form relative weights → shares → `playerXG_i = teamMatchXG × share_i`. So
`Σ playerXG == teamMatchXG` by construction.

**Opponent strength enters exactly once, through `teamMatchXG`.** Never multiply a second
opponent/matchup factor onto a player — that is the same information twice. The old model did
`per90 × minutes/90 × (teamXG / leagueBaseline)` per player with nothing tying the parts to the
whole, and the parts came out at ~2× the whole (Wildenroth I vs Oberweikertshofen II: team xG
2.04, Σ offered player xG 4.28).

**Minutes are a budget, not per-player averages.** `OUTFIELD_MINUTES_PER_MATCH = 900` (10 outfield
× 90) is distributed by `P(plays) × E[minutes | plays]`, water-filled with a hard 90-minute cap per
player (`allocateMinutes`). The old model gave each player his personal average independently, so
they summed to 1316 minutes for a 900-minute match. `P(plays)` comes from appearance rate against
`squadRecordedGames` — the squad MAXIMUM of `wildenroth_players.games`, not the team's real fixture
count, because that column only counts appearances an admin has entered.

**Set-piece/preseason bumps are multiplicative on the weight**, not additive on xG — additive would
break `Σ playerXG == teamMatchXG`. Values are the old additive bumps expressed relative to a typical
offered player's xG (~0.28).

**`OWN_GOAL_SHARE = 0` is derived, not chosen**: all 19 Wildenroth goals on record this season went
to named active outfield players and `match_goalscorers` holds zero own goals. Re-check before
inventing a residual.

**Offering rule (product decision)**: every outfield player in the matchday squad is bettable.
Scoring probability sets the PRICE, never whether a player appears. Goalkeepers are never offered;
players an admin marked as outside the squad / injured / missing / not bettable are not. The old
`MIN_PROB_SCORE`/`MIN_PROJ_MINUTES` gates are gone from the scorer market (the 2+ market keeps one).

**Pricing layer** (`compressOdds`) — separate from the probability model and the only thing that
decides the OFFERED price. `prob_score`, `playerXG` and `diagnostics.fairOddsScore` keep the model's
honest numbers. Offering every player means fair prices run to 458/1; Spieltag 1-7 never showed
anything above 30 only because the old model hid those players, so raw pricing made Spieltag 8 a
visibly different product (measured Wildenroth I preview: median 63.5 vs a historical 10.3, 15 of 21
above 30). The function is

    o(r) = r                                      for r ≤ 6
    o(r) = 30 − D/(1 + (r−6)/D),   D = 30 − 6,    for r > 6

Identity below 6 (every favourite keeps its price to the cent), C¹ at the join (both branches meet
at value 6 and slope 1), strictly increasing so player order can never flip, asymptotic to 30 from
below so nothing piles up on the cap, and `o(r) ≤ r` always — compression can only shorten a price,
never create positive EV. The upper branch decays like 1/x rather than exp(−x) **on purpose**: an
exponential branch sits within 0.5 of the cap from raw ≈ 100 onward, which just relocates the
pile-up (raw 311 and raw 458 would both price 30.00; harmonic gives 28.27 vs 28.80). Rounding to two
decimals is the LAST step, so prices are continuous decimals, never buckets. `MAX_ODDS = 30` is the
asymptote, not a clamp. The 2+ market uses the same function: measured on Spieltag 8 only 1 (I) and
3 (II) selections clear the 5 % threshold at all, with fair odds of 4.8-12.1, so nothing there comes
near 30 and a separate cap of 40/50 would change nothing.

**Per-team current-season stats** (`wildenroth_player_team_stats`) — ~8 players turn out for both
Wildenroth I (Kreisliga) and II (B-Klasse), and `wildenroth_players.games/minutes/goals` is one
global pair per player. The per-team table is the authoritative cumulative stand; the fixture's team
is the primary sample and the OTHER team's record is a down-weighted prior
(`CROSS_TEAM_WEIGHT = 0.5`) that is first restated onto this team's goal level via `crossTeamScale`.
That conversion only makes two samples comparable before blending — it is NOT a "B-Klasse is easier"
adjustment, which would double-count, since the fixture's goal level lives in `teamMatchXG` and the
weights are normalized to shares anyway. `minutes_reliable` is false for team II (FuPa does not
maintain substitutions back on there), which shrinks its minutes harder toward the squad mean.
`match_lineups` stays the intended long-term source; it cannot serve yet because team II has no
lineup rows at all and guessing which of two matches a one-appearance player featured in would
fabricate data. **The admin goalscorer UI reads this table too** (`GET /api/admin/goalscorers/match`
returns `team_stats` per row plus `statsTeam`) — it used to show `wildenroth_players.games/minutes/
goals`, which pools a `both` player's two leagues into one misleading figure (Scheidl appeared as
3 Sp / 198 Min / 1 T instead of his Wildenroth I record of 5 / 379 / 5). A player with no row for
the playing side shows 0/0/0 with a warning, never the other team's numbers.

**Availability**: `BLOCKING_GOALSCORER_STATUSES` (`lib/goalscorerContext.ts`) removes a player from
the allocation pool entirely rather than merely hiding him. What that *does* depends on whether the
market is already open — **before** open (`frozen_at IS NULL`) his share is redistributed across the
remaining players and Σ playerXG is the full team xG again; **after** open nothing is redistributed,
he is just closed for new bets. `questionable` halves `P(plays)` instead of excluding.

**Draft → live** (`goalscorerRowAction`) — one decision point for every write to
`match_goalscorer_odds`, and the reason the admin workflow holds: (1) admin computes → draft rows
(`frozen_at IS NULL`), (2) admin reviews and retypes some prices, (3) the Spieltag opens and
**exactly that reviewed state goes live**, (4) the squad becomes known and non-squad players are
closed without moving anyone else.

At market open an existing draft row is only stamped with `frozen_at` — never recomputed — whether
or not `manually_overridden` is set. A price the admin looked at and deliberately left alone is as
much part of the reviewed market as one they retyped; recomputing at open would mean the numbers
checked in the admin and the numbers that went live could differ with nothing hinting at it. (The
automatic freeze in `tipps/page.tsx` used to re-run the model for every non-overridden row.) Only a
player with **no draft row at all** still gets a freshly computed price at open, and that never
touches the rows around him.

`manually_overridden` therefore no longer answers "recompute at open?" — it only protects a hand-set
price from an explicit admin recompute. `frozen_at IS NOT NULL` beats every trigger: published, a
snapshot, and not rewritable even with `force`. `force` means only "run again even though part of
this market is already published", i.e. price the not-yet-published players.

| | before open (`frozen_at IS NULL`) | after open (`frozen_at IS NOT NULL`) |
|---|---|---|
| player set to `not_in_squad` / injured / … | full recompute allowed | only HE is closed for new bets |
| his xG share | redistributed to the remaining players | **not** redistributed |
| other players' `playerXG`, probabilities, odds | may change | **exactly unchanged** |
| Σ playerXG of the still-open players | equals team xG again | may be **less** than team xG — intended |

The team xG was correctly split across the pool that existed at open; re-normalizing over a smaller
pool later would silently reprice selections people already hold. Only an explicit manual override
(`/api/admin/goalscorers/availability`) may change a published price — a plain status change never
counts as one.

**`EXPECTED_OUTFIELD_PLAYERS_USED_DIAGNOSTIC = 15` is a MONITORING VALUE, not a pricing parameter.**
Ten outfield players start and roughly five more come on, so ~15 different ones feature. That number
produces exactly one figure — `diagnostics.playProbabilityDiagnostic` — which answers "does the
projection expect a plausible amount of rotation?" (the raw rates alone sum to 10.6 for the
Wildenroth I pool). **Nothing downstream reads it.** Minutes, `playerXG`, probabilities and prices
all come from `diagnostics.pPlays` (`rawPlayProbability` internally); changing 15 to any other value
cannot move a single price, which the checks assert directly. It is deliberately NOT used for
pricing because the 1.0 cap inside `scalePlayProbabilities` is a non-uniform transformation:
`allocateMinutes` renormalizes to 900 and is invariant to a uniform scale, but the cap holds
near-certain starters back while everyone else scales up, which would reprice the market (measured:
Ritter 3.37 → 3.89, Schorer 5.77 → 4.92). The squad total says how MANY different players feature;
it says nothing about how the minutes divide between them.

**The market opens with the whole active squad.** It does NOT wait for the matchday squad to be
known — the admin prunes afterwards by marking players `not_in_squad`. Whether that redistributes
their share depends on the open/closed table above. Freezing is gated only on the normal betting
window, like every other market.

Because being offered means being a candidate, `OFFERED_MIN_PLAY_PROB = 0.05` floors `P(plays)` for
everyone still in the pool: a player with no recorded appearances otherwise landed at exactly 0%
→ xG 0 → the maximum price, which is a dead offer rather than a long shot. `matches.
goalscorer_squad_confirmed_at` is optional and gates nothing; when an admin does set it,
`SQUAD_MEMBER_MIN_PLAY_PROB = 0.4` replaces that floor and the parallel-fixture guess for
`squad='both'` players switches off, because the squad has answered it directly.

**`squad = 'both'` when both Wildenroth sides play in parallel**: `hasConcurrentOtherSquadFixture`
halves that player's `P(plays)` — a statistical fallback for the preview only. It is a projection
adjustment, NOT a second lock: the double-fixture lock in `tipps/page.tsx`
(`GOALSCORER_DOUBLE_FIXTURE_BUFFER_MS`) handles the different case of ONE side playing twice in a
week and stays the mechanism for that.

Model inputs must come from `loadOddsModelInputs` — the admin recompute route used its own query
without `match_category`, which priced a Wildenroth II B-Klasse fixture in the Kreisliga (2.518 xG
against the main market's 2.651), and ignored `match_odds_overrides` entirely.

Checks: `node --experimental-strip-types scripts/run-goalscorer-check.mjs` (100 assertions, exits
non-zero on failure) and `scripts/run-goalscorer-preview.mjs <spieltag> [--old <goalscorer.ts>]
[--squad-confirmed]` for a read-only old-vs-new preview. Both need `wplayers.json` and
`wteamstats.json` in `$BACKTEST_DATA_DIR` alongside the odds exports. Player parameters are NOT
fitted — there are only ~6 (Wildenroth I) and ~2 (II) matches with recorded scorers, far too few to
calibrate `PRIOR_GAMES`, position priors, bumps or the 15% margin.

**The 1000-row cap (silent data loss):** every Supabase `.select()` stops at PostgREST's
server-side row limit (1000) with **no error and no truncation flag** — a truncated result is
indistinguishable from a complete one. `bets` (1128 rows), `match_lineups` and
`prior_season_matches` are already at or past that line and every table here only grows. Any query
that is **not** narrowed to a handful of rows (`.eq('id', …)`, `.eq('user_id', …)`,
`.in('match_id', <one matchday>)`, `.single()`, `.limit(n)`) **must** page through
`fetchAllRows` (`lib/supabase/paginatedSelect.ts`) with a stable unique `.order('id')` before
`.range(from, to)`. Filters like `.eq('season', …)`, `.neq('status', 'void')` or
`.eq('status', 'pending')` do **not** count as narrowing — they still return whole-table-sized
result sets. This has already caused one silent production bug: the Spieltag-Rangliste dropped
11 of 13 bet slips because the leg rows past row 1000 never arrived, so those combos had no
Spieltag mapping and were skipped. When touching any query over `bets`/`combo_bets`/`matches`,
check the current row count first (`select count(*)`), don't assume it's small.

### Matchday scheduling quirk

The BFV (district football association) sometimes schedules a matchday's actual kickoff well out
of numeric order — e.g. Spieltag 2 played as a midweek catch-up *after* Spieltag 7. The displayed
matchday **number** never changes, but the Spieltag **overview/picker** (tipps, leaderboard) is
sorted chronologically by actual kickoff, not by number — `kreisligaMatchdaysDisplayOrder`
(`lib/season.ts#buildEffectiveMatchdayIndex`), ordered by the outlier-robust median
`matchdayAnchorDate` (tie-broken by Spieltag number) so a single rescheduled match can't drag its
whole Spieltag's position around the way a raw earliest-date sort would. The internal
betting-window sequencing gate ("never two Spieltage open at once", `tipps/page.tsx`) deliberately
uses a *separate* list — `kreisligaMatchdaysSorted` (raw earliest-kickoff per official Spieltag) —
do not merge the two, or betting-open times shift. This has been fixed inconsistently across files
before, so grep for `kreisligaMatchdaysDisplayOrder` to catch all user-facing picker sites if you
touch matchday ordering.

`lib/season.ts`'s `bettingOpenTime()` is the single source of truth for "Monday 12:00 Europe/Berlin
of match week" — it used to be duplicated across 4 files with a month-boundary bug in each; don't
reintroduce a duplicate.

### Other conventions

- `matchday === 999` is a reserved **test matchday** — always included regardless of date filters,
  excluded from real leaderboard/award calculations (bets on it get `season = 'TEST'`).
- `match_category` on `matches` distinguishes `kreisliga` (default), `wildenroth_ii`,
  `bklasse_topspiel`, `b-klasse` — drives which section of the tipps page a match appears in.
- Team crests (`public/crests/*.png`, resolved via `lib/teams.ts#crestPath` /
  `components/TeamLogo.tsx`) are shield-shaped and drawn edge-to-edge — never wrap them in a
  circular (`rounded-full`) mask, use `rounded-md`/no rounding, or corners (year, club name) get
  clipped.
- The app's actual scroll container is ambiguous across browsers (flex `overflow-y-auto` child vs.
  window) — `components/ScrollToTopOnNavigate.tsx` resets both on every route/query change; don't
  assume only one is authoritative.
- Awards (`lib/awards.ts`, 7 types) are computed and persisted automatically during matchday
  settlement (`app/api/admin/settle/route.ts`) — there's no separate "award ceremony" step.
