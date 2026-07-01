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
```

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

**xG calculation** (`getMatchXG`) — geometric-mean model with Bayesian shrinkage + form multiplier:
- `rawHomeXG = sqrt(homeGoalsScoredAtHome × awayGoalsConcededAway)`
- `rawAwayXG = sqrt(awayGoalsScoredAway × homeGoalsConcededAtHome)`
- `homeXG = bayesianXG(rawHomeXG, LEAGUE_HOME_XG, n_avg) × homeFormMult × homeRosterFactor` where
  `bayesianXG(r, L, n) = (n*r + K*L) / (n+K)` → shrunk toward LEAGUE_HOME_XG with K=5
- Same for awayXG toward LEAGUE_AWAY_XG, scaled by awayFormMult × awayRosterFactor
- `formMult = 0.80 + 0.40 × (lastN_pts / (lastN * 3))` from last 5 games (range [0.80, 1.20]);
  applies only when ≥ 3 recent games, otherwise 1.0
- Prior-season stats (`prior_season_matches`) are blended in first via `augmentStat` (half-weighted
  pseudo-observations that fade out as real current-season data accumulates)
- Floor: `Math.max(0.25, ...)`
- Constants: `LEAGUE_HOME_XG = 1.25`, `LEAGUE_AWAY_XG = 1.10`, `HOUSE_MARGIN = 0.12`, `XG_PRIOR = 5`

**Why geometric mean (not arithmetic, not full product):**
- Arithmetic `(atk+def)/2`: underestimates quality mismatches.
- Full product `L × atkRate × defRate`: explodes for two extreme teams (two rates of 1.8→ factor 3.24×).
- Geometric mean `sqrt(atk×def)`: AM≥GM inequality keeps the combined signal bounded; a
  strong attacker vs strong defence yields moderate xG (correct), but a strong attacker vs
  weak defence still yields amplified xG, so matchup differentiation is preserved.

**Cross-league normalization** (`LEAGUE_STRENGTH`): bezirksliga 1.10 / kreisliga 1.00 / kreisklasse
0.78 / b_klasse 0.68 — used both for team-level prior-season stats and for individual
transferred-in players' prior-club goal output, so a promoted team's inflated lower-league stats
don't overstate their real strength in the new league.

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
berechnen"). Keep all three `buildPriorContext` call sites (`tipps/page.tsx`,
`app/api/admin/odds/route.ts`, `app/api/admin/odds/preview/route.ts`) passing the same
`league_players`/`match_lineups` data — they've drifted out of sync before.

**Bet placement** (`app/api/bets/place/route.ts`) re-validates everything server-side rather than
trusting the client: stake bounds, odds values against the frozen `odds` row (exact score is
sanity-bounded against its 1X2 direction since it isn't a stored column), same-match combo
contradiction checks, betting deadlines, per-matchday bet limits (max 3 total / max 2 non-risky),
and the Wildenroth conflict-of-interest rule (`lib/wildenroth.ts` — a flagged Wildenroth
player/coach can't place a bet whose payout depends on their own team not winning).

**Season filter:** only matches with `match_date >= SEASON_START` (currently `'2026-08-01'`) count
for odds and standings — this constant is duplicated per-file, not shared config.

### Matchday scheduling quirk

The BFV (district football association) sometimes schedules a matchday's actual kickoff well out
of numeric order — e.g. Spieltag 2 played as a midweek catch-up *after* Spieltag 7. The displayed
matchday **number** always stays the official one, but any "current/default/completed matchday"
logic must order by actual kickoff date, not the number. See `matchdayMinDate` in `tipps/page.tsx`
and the equivalent in `leaderboard/page.tsx` — this has been fixed inconsistently across files
before, so grep for `matchdayMinDate` to catch all sites if you touch matchday ordering.

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
