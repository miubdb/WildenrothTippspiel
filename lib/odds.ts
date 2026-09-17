import type { Match, OddsData, PriorMatch, LeaguePlayer, LineupEntry } from '@/types'
import { simulateCupMatch } from './cupSimulation'

// ---------- Constants ----------

const HOUSE_MARGIN = 0.12
// Floor for any offered price. This is NOT cosmetic: toOdds() computes
// 1/(p*(1+margin)), which for a near-certain outcome legitimately falls below
// 1.0, and clamping it back up hands the punter a positive-EV bet. At the old
// floor of 1.05 anything with p > 1/(1.05*1.12) = 0.851 was clamped, so e.g.
// "Unter 5,5" (p ~ 0.977) paid 1.05 for an EV of 1.026 — free money, and the
// paired book summed to < 1.0, i.e. backing both sides was risk-free profit.
// At 1.01 the break-even point moves to p > 0.990; swept over the realistic xG
// band this leaves zero positive-EV selections and zero sub-1.0 books.
const MIN_ODDS = 1.01
const MAX_ODDS = 100.0 // high cap so exact scores spread naturally
// Caps how much a team's prior-season dominance ratio (own rate vs. that league's
// average) can carry over when projected onto the target league — without this, a
// team that heavily dominated a weaker league (e.g. a promoted side) could still
// project as above-average in the new, stronger league even after LEAGUE_STRENGTH
// scaling, since an extreme enough ratio (e.g. 1.8×) times a discount (e.g. 0.68)
// can still exceed 1.0. Capped symmetrically so relegated/weak teams aren't
// distorted either.
const PRIOR_RATIO_CAP = 1.4

// Form multiplier from the last 5 finished games — moderate ±10% adjustment (v2: was ±20%).
// Pure season-long attack/defense averages can't capture momentum, so an
// in-form team gets a meaningful xG boost beyond what their season totals show.
// v2: ramped in linearly between FORM_RAMP_START and FORM_RAMP_FULL current-season
// games played, instead of snapping to full strength the moment 3 games exist — a
// 3-game sample was swinging odds by the full ±20% (now ±10%) with no runway.
const FORM_GAMES = 5
const FORM_MULT_BASE = 0.90
const FORM_MULT_RANGE = 0.20 // result range [0.90, 1.10] at full ramp
const FORM_RAMP_START = 3
const FORM_RAMP_FULL = 8

// Prior-season cross-league normalization.
// Prior games count at half weight vs current-season games; a full prior season
// (~15 home + 15 away games) contributes ~7.5 pseudo-observations each side.
const PRIOR_WEIGHT = 0.5
// League-strength multiplier: how team performance in one league translates to
// another. Used ONLY as a source→target RATIO (see leagueTransition) — never as
// an absolute discount against a fixed Kreisliga anchor, which is what made a
// B-Klasse team's own-league form get scaled by 0.68 in a B-Klasse fixture.
//
// These describe COMPETITIVE level, not the goal environment: the two move in
// opposite directions here (prior_season_matches: Kreisklasse 4.45 goals/game
// vs Kreisliga 3.67 — the weaker league is the higher-scoring one, because
// defences are weaker). The goal environment is handled entirely by the
// per-tier baselines below; these factors only carry "this team beat up on
// weaker/stronger opposition". They cannot be derived from the data on hand
// (the stored leagues never play each other), so they stay a documented
// assumption — but one that is now neutral within a league.
const LEAGUE_STRENGTH: Record<PriorMatch['league_level'], number> = {
  bezirksliga: 1.10,
  kreisliga:   1.00,
  kreisklasse: 0.78,
  b_klasse:    0.68,
}

// ---------- League tiers & empirical baselines ----------

/** The leagues this app actually prices. Kept deliberately coarse: these are
 *  the two goal environments we have (or can bootstrap) data for. */
export type LeagueTier = 'kreisliga' | 'b_klasse'

/** Single explicit mapping from a match's category to its goal environment.
 *  `wildenroth_ii`, `bklasse_topspiel` and `b-klasse` are all B-Klasse
 *  fixtures; `kreisliga` (and a missing category, the historical default) is
 *  Kreisliga. Verified against the categories actually present in `matches`. */
export function leagueTierOfCategory(category: string | null | undefined): LeagueTier {
  switch (category) {
    case 'wildenroth_ii':
    case 'bklasse_topspiel':
    case 'b-klasse':
      return 'b_klasse'
    default:
      return 'kreisliga'
  }
}

/** league_level key used when transitioning prior-season stats INTO this tier. */
const TIER_LEVEL: Record<LeagueTier, PriorMatch['league_level']> = {
  kreisliga: 'kreisliga',
  b_klasse: 'b_klasse',
}

/**
 * Which tier a fixture belongs to, inferred from the two teams' own matches
 * rather than passed in by each caller — freeze, preview, recalc and the
 * Specials engine all hand us the same `matches` array, so inferring here is
 * what guarantees they can't disagree about a match's league.
 */
function inferTier(matches: Match[], homeTeamId: number, awayTeamId: number): LeagueTier {
  for (const m of matches) {
    if (m.home_team_id === homeTeamId && m.away_team_id === awayTeamId) {
      return leagueTierOfCategory(m.match_category)
    }
  }
  // Fall back to whatever either team usually plays in.
  const own = matches.find(
    (m) => m.home_team_id === homeTeamId || m.away_team_id === homeTeamId ||
           m.home_team_id === awayTeamId || m.away_team_id === awayTeamId
  )
  return leagueTierOfCategory(own?.match_category)
}

export interface LeagueBaseline {
  tier: LeagueTier
  /** Goals per game for the home side in an average fixture of this league. */
  home: number
  /** Goals per game for the away side in an average fixture of this league. */
  away: number
  /** (home + away) / 2 — an average team in an average fixture. */
  avgTeam: number
  /** Matches that actually informed this baseline (prior season + finished
   *  current-season fixtures of this tier). Reported in diagnostics so a thin
   *  sample is visible rather than implied. */
  sampleMatches: number
}

// Pseudo-matches of the pooled all-leagues prior mixed into a tier's own
// baseline. B-Klasse has NO prior-season matches stored at all, so without
// this its baseline would swing wildly on the first handful of results; with
// it, the tier starts at the broad amateur average and converges to its own
// level as real matches accumulate. Roughly "trust a tier's own level once it
// has clearly more evidence than one matchday's worth of fixtures".
const LEAGUE_BASELINE_PRIOR_MATCHES = 60

interface GoalSample { home: number; away: number; n: number }

function sampleOfPriorMatches(priorMatches: PriorMatch[], level?: PriorMatch['league_level']): GoalSample {
  let home = 0, away = 0, n = 0
  for (const m of priorMatches) {
    if (level && m.league_level !== level) continue
    home += m.home_score
    away += m.away_score
    n++
  }
  return { home, away, n }
}

function sampleOfCurrentMatches(matches: Match[], tier: LeagueTier): GoalSample {
  let home = 0, away = 0, n = 0
  for (const m of matches) {
    if (m.status !== 'finished' || m.home_score == null || m.away_score == null) continue
    if (m.matchday === 999) continue
    if ((m as unknown as { competition_type?: string | null }).competition_type === 'cup') continue
    if (leagueTierOfCategory(m.match_category) !== tier) continue
    home += m.home_score
    away += m.away_score
    n++
  }
  return { home, away, n }
}

const baselineCache = new WeakMap<Match[], Map<string, LeagueBaseline>>()

/**
 * Empirical, per-tier home/away goal baselines — the anchor every market's
 * absolute goal level hangs off.
 *
 * Replaces the single pair of hardcoded Kreisliga constants that used to
 * anchor B-Klasse fixtures too. Derived rather than chosen:
 *   1. Pool every stored prior-season match (all levels) → the broad amateur
 *      average, used as the prior for a tier we know little about.
 *   2. Add the tier's own evidence: its prior-season matches (Kreisliga: 364;
 *      B-Klasse: none on record) plus every finished current-season fixture of
 *      that tier. In the backtest only fixtures already played at that point
 *      are visible, so this stays walk-forward safe automatically.
 *   3. Shrink the tier's own total goals and home SHARE toward the pooled
 *      prior with LEAGUE_BASELINE_PRIOR_MATCHES pseudo-matches.
 *
 * Total and home share are shrunk separately on purpose: the total is what the
 * Over/Under markets are calibrated against, while the share is the home
 * advantage — a single league-season can look like a 45% home edge by chance
 * (the old constants did), and the pooled prior keeps that in check.
 */
export function getLeagueBaselines(
  matches: Match[],
  tier: LeagueTier,
  priorMatches: PriorMatch[] | undefined
): LeagueBaseline {
  let perArray = baselineCache.get(matches)
  if (!perArray) { perArray = new Map(); baselineCache.set(matches, perArray) }
  const cacheKey = `${tier}:${priorMatches?.length ?? 0}`
  const hit = perArray.get(cacheKey)
  if (hit) return hit

  const prior = priorMatches ?? []
  const pooled = sampleOfPriorMatches(prior)
  const pooledTotal = pooled.n > 0 ? (pooled.home + pooled.away) / pooled.n : FALLBACK_TOTAL_GOALS
  const pooledHomeShare = pooled.home + pooled.away > 0
    ? pooled.home / (pooled.home + pooled.away)
    : FALLBACK_HOME_SHARE

  const own = sampleOfPriorMatches(prior, TIER_LEVEL[tier])
  const cur = sampleOfCurrentMatches(matches, tier)
  const n = own.n + cur.n
  const goalsHome = own.home + cur.home
  const goalsAway = own.away + cur.away

  const k = LEAGUE_BASELINE_PRIOR_MATCHES
  const total = n > 0
    ? (goalsHome + goalsAway + k * pooledTotal) / (n + k)
    : pooledTotal
  const homeShare = goalsHome + goalsAway > 0
    ? (goalsHome + k * pooledTotal * pooledHomeShare) / (goalsHome + goalsAway + k * pooledTotal)
    : pooledHomeShare

  const baseline: LeagueBaseline = {
    tier,
    home: total * homeShare,
    away: total * (1 - homeShare),
    avgTeam: total / 2,
    sampleMatches: n,
  }
  perArray.set(cacheKey, baseline)
  return baseline
}

// Used only when there is no prior-season data at all (fresh install / tests).
// Matches the pooled level of the stored prior seasons so behaviour without
// data is the same as with it, rather than a second invented anchor.
const FALLBACK_TOTAL_GOALS = 4.0
const FALLBACK_HOME_SHARE = 0.56

/** Source-league → target-league transition. 1.0 within the same league, so a
 *  B-Klasse team's B-Klasse history is carried over untouched; >1 when coming
 *  down from a stronger league, <1 when coming up from a weaker one. Attack is
 *  multiplied by it and defence divided (see getPriorTeamStats). */
function leagueTransition(source: PriorMatch['league_level'], target: LeagueTier): number {
  return LEAGUE_STRENGTH[source] / LEAGUE_STRENGTH[TIER_LEVEL[target]]
}


// Absolute floor on a team's xG. Guards the Poisson against a degenerate
// lambda (a side with literally zero goals in its sample would otherwise make
// "scores at least once" impossible and the exact-score matrix collapse onto
// one column). Kept at the long-standing 0.25: the backtest showed no gain
// from lowering it, and with the hierarchical estimate above a team's rate no
// longer reaches the floor by accident — only a genuinely goalless record does.
const XG_FLOOR = 0.25

function clamp(odds: number): number {
  return Math.max(MIN_ODDS, Math.min(MAX_ODDS, odds))
}

// Symmetric cap on a prior-season performance ratio (team rate vs. that league's
// average) — see PRIOR_RATIO_CAP above.
function clampRatio(ratio: number): number {
  return Math.max(1 / PRIOR_RATIO_CAP, Math.min(PRIOR_RATIO_CAP, ratio))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Convert a raw probability to bookmaker odds.
 * Formula: Q = 1 / (p × (1 + margin))
 * Implied-prob sum = Σ p×(1+m) = 1×(1+m) > 1 → no arbitrage possible.
 */
function toOdds(prob: number): number {
  if (prob <= 0) return MAX_ODDS
  return clamp(round2(1 / (prob * (1 + HOUSE_MARGIN))))
}

// Exported aliases for lib/matchdaySpecials.ts — Spieltag-Specials reuse the
// EXACT same probability→odds conversion (house margin, rounding, min/max
// clamp) and Poisson/score-matrix machinery as every other market in this
// file, rather than inventing a second odds philosophy. See toOdds/poisson/
// buildScoreMatrix's own doc comments above for the underlying math.
export const oddsFromProbability = toOdds
export { poisson as poissonPmf }

/** Poisson probability mass function (log-space for numerical stability) */
function poisson(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0
  let logP = k * Math.log(lambda) - lambda
  for (let i = 1; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

/** Score-matrix dimension. Must stay comfortably above the highest plausible
 *  xG so the truncated tail is negligible: at maxGoals=10 the discarded mass is
 *  ~1e-5 even for an xG of 3.5. (It was 8, which was already thin once the
 *  league baselines were corrected upward.) */
const SCORE_MATRIX_MAX_GOALS = 10

/**
 * Build a home×away score probability matrix using independent Poisson for each team.
 * All downstream markets are derived from this single matrix for full consistency.
 *
 * The matrix is normalised to sum to exactly 1. Without it the truncated tail
 * (scores above maxGoals) is silently dropped, and since every "under" market is
 * derived as `1 - pOver`, that missing mass — which belongs entirely to "over" —
 * would be handed to "under" instead, pricing unders too short and overs too long.
 */
function buildScoreMatrix(homeXG: number, awayXG: number, maxGoals = SCORE_MATRIX_MAX_GOALS): number[][] {
  const matrix: number[][] = []
  let total = 0
  for (let h = 0; h <= maxGoals; h++) {
    matrix[h] = []
    for (let a = 0; a <= maxGoals; a++) {
      const p = poisson(homeXG, h) * poisson(awayXG, a)
      matrix[h][a] = p
      total += p
    }
  }
  if (total > 0 && total !== 1) {
    for (let h = 0; h <= maxGoals; h++) {
      for (let a = 0; a <= maxGoals; a++) matrix[h][a] /= total
    }
  }
  return matrix
}

// See the export block near toOdds above for why this (and poisson) are
// re-exported for lib/matchdaySpecials.ts's reuse.
export { buildScoreMatrix as buildMatchScoreMatrix }

/** Last N results as W/D/L (oldest first).
 *
 *  `excludeMatchday`, when given, drops any finished game sharing that raw
 *  `matchday` number — i.e. the other fixtures of the SAME round as the match
 *  currently being displayed. Without this, a Saturday result from the same
 *  Spieltag as a Sunday match would leak into some OTHER team's form the
 *  moment it finishes, even though from a bettor's viewpoint the whole round
 *  is still "in progress" and form should only advance one Spieltag at a
 *  time. A genuine Nachholspiel (a makeup game for an EARLIER round, played
 *  midweek right before this one) has a different, lower matchday number, so
 *  it still counts — that's the one case where the same team plays twice in
 *  a matter of days and the more recent result should already show. */
export function getForm(matches: Match[], teamId: number, n = 5, excludeMatchday?: number): ('W' | 'D' | 'L')[] {
  const games = matches
    .filter(
      (m) =>
        m.status === 'finished' &&
        (m.home_team_id === teamId || m.away_team_id === teamId) &&
        (excludeMatchday == null || m.matchday !== excludeMatchday)
    )
    .sort((a, b) => new Date(b.match_date).getTime() - new Date(a.match_date).getTime())
    .slice(0, n)
  return games.map((m) => {
    const hs = m.home_score ?? 0; const as_ = m.away_score ?? 0
    const isHome = m.home_team_id === teamId
    if ((isHome && hs > as_) || (!isHome && as_ > hs)) return 'W'
    if (hs === as_) return 'D'
    return 'L'
  }).reverse()
}

/** Team record for display in match card. See getForm's excludeMatchday doc. */
export function getTeamRecord(matches: Match[], teamId: number, excludeMatchday?: number) {
  const games = matches.filter(
    (m) =>
      m.status === 'finished' &&
      (m.home_team_id === teamId || m.away_team_id === teamId) &&
      (excludeMatchday == null || m.matchday !== excludeMatchday)
  )
  let w = 0, d = 0, l = 0, gf = 0, ga = 0
  for (const m of games) {
    const hs = m.home_score ?? 0; const as_ = m.away_score ?? 0
    const isHome = m.home_team_id === teamId
    if ((isHome && hs > as_) || (!isHome && as_ > hs)) w++
    else if (hs === as_) d++
    else l++
    gf += isHome ? hs : as_
    ga += isHome ? as_ : hs
  }
  return { played: games.length, w, d, l, gf, ga, gd: gf - ga, pts: w * 3 + d }
}

// ---------- Prior-season cross-league normalization ----------

interface LeagueAvg {
  homeAvg: number
  awayAvg: number
  level: PriorMatch['league_level']
}

interface PriorTeamStats {
  atkRatio: number
  defRatio: number
  transition: number
  games: number
}

// ---------- Hierarchical team-strength estimation ----------

// How many pseudo-games of the LEAGUE average a team's overall rate is shrunk
// toward. This is now the ONLY shrinkage toward the league mean — the old model
// stacked prior-season pseudo-observations AND a second Bayesian pull with an
// effective K that reached 11 in the first weeks, which meant a team could play
// three games, concede 18 goals, and still be priced within a whisker of an
// average side.
//
// Value chosen from a 3x3 walk-forward sweep (TEAM 3/5/8 x VENUE 2/4/8, n=70):
// every point on that grid beat the old two-stage shrinkage, and less
// league-shrinkage was monotonically better across the whole grid — the
// direction is the signal, the exact minimum (3/8) is not, at this sample
// size. 4 sits on the plateau without chasing the argmin.
const TEAM_PRIOR_GAMES = 4

// How many pseudo-games of the team's OWN overall rate (adjusted by the
// league's home/away split) a venue-specific rate is shrunk toward. This is the
// hierarchy: one home game no longer defines a team's entire home attack, it
// just nudges it away from what that team does in general. At 5 the venue
// record carries half the weight once a team has played 5 games at that venue
// (a third of a season) — the same sweep showed 2 clearly worse and 4-8 flat.
const VENUE_PRIOR_GAMES = 5

interface TeamRates {
  /** Goals per game overall, already shrunk toward the league average. */
  atk: number
  def: number
  gamesAll: number
  gamesVenue: number
  rawAtkAll: number
  rawDefAll: number
  rawAtkVenue: number | null
  rawDefVenue: number | null
  priorGames: number
  transition: number
  /** Share of the venue estimate that came from real venue games. */
  venueWeight: number
}

interface RateSample { scored: number; conceded: number; weight: number }

/** Goals for/against per game over a set of finished matches, red-card-weighted. */
function rateSample(
  matches: Match[],
  teamId: number,
  venue: 'home' | 'away' | 'any',
  redCards?: Map<string, number>
): RateSample {
  let scored = 0, conceded = 0, weight = 0
  for (const m of matches) {
    if (m.status !== 'finished' || m.home_score == null || m.away_score == null) continue
    const isHome = m.home_team_id === teamId
    const isAway = m.away_team_id === teamId
    if (!isHome && !isAway) continue
    if (venue === 'home' && !isHome) continue
    if (venue === 'away' && !isAway) continue
    const w = redCardWeight(m, redCards)
    scored += (isHome ? m.home_score : m.away_score) * w
    conceded += (isHome ? m.away_score : m.home_score) * w
    weight += w
  }
  return { scored, conceded, weight }
}

/**
 * Two-level estimate of what a team scores and concedes in a given fixture.
 *
 * Level 1 — overall: the team's goals for/against per game across EVERY match
 * it has played this season (not just this venue), blended with its
 * prior-season ratios and shrunk toward the league average. Using all matches
 * is the main fix for early-season fragility: three away thrashings now inform
 * the home estimate instead of being discarded.
 *
 * Level 2 — venue: the team's actual home (or away) record, shrunk toward its
 * own overall rate scaled by the league's home/away split. With one home game
 * the estimate sits close to "this team in general, at home"; by eight it is
 * dominated by real home data. The transition is continuous — there is no
 * threshold where the model's behaviour jumps.
 */
function teamRates(
  matches: Match[],
  teamId: number,
  teamName: string | undefined,
  venue: 'home' | 'away',
  baseline: LeagueBaseline,
  priorCtx: PriorContext | undefined,
  target: LeagueTier
): TeamRates {
  const redCards = priorCtx?.redCards
  const all = rateSample(matches, teamId, 'any', redCards)
  const own = rateSample(matches, teamId, venue, redCards)

  const prior = priorCtx && teamName
    ? getPriorTeamStats(priorCtx.priorMatches, priorCtx.leagueAvgs, teamName, target)
    : null

  // Prior season in target-league goal units. Attack scales WITH the transition
  // factor, defence against it: a side that conceded league-average in a weaker
  // league will concede more than average here, not less.
  const priorGames = prior ? prior.games * PRIOR_WEIGHT : 0
  const priorAtk = prior ? prior.atkRatio * prior.transition * baseline.avgTeam : baseline.avgTeam
  const priorDef = prior ? (prior.defRatio / prior.transition) * baseline.avgTeam : baseline.avgTeam

  const rawAtkAll = all.weight > 0 ? all.scored / all.weight : baseline.avgTeam
  const rawDefAll = all.weight > 0 ? all.conceded / all.weight : baseline.avgTeam

  // Single shrinkage: current season + prior-season pseudo-games, pulled toward
  // the league average with TEAM_PRIOR_GAMES.
  const nAll = all.weight + priorGames
  const blendedAtk = nAll > 0
    ? (all.scored + priorGames * priorAtk) / nAll
    : baseline.avgTeam
  const blendedDef = nAll > 0
    ? (all.conceded + priorGames * priorDef) / nAll
    : baseline.avgTeam
  const atkAll = (nAll * blendedAtk + TEAM_PRIOR_GAMES * baseline.avgTeam) / (nAll + TEAM_PRIOR_GAMES)
  const defAll = (nAll * blendedDef + TEAM_PRIOR_GAMES * baseline.avgTeam) / (nAll + TEAM_PRIOR_GAMES)

  // Venue level. The league's own split says how much more is scored at home;
  // a team's overall rate is lifted/lowered by that before its own venue
  // record is allowed to pull it further.
  const venueFactorFor = venue === 'home' ? baseline.home / baseline.avgTeam : baseline.away / baseline.avgTeam
  const concededFactorFor = venue === 'home' ? baseline.away / baseline.avgTeam : baseline.home / baseline.avgTeam
  const expectedAtkVenue = atkAll * venueFactorFor
  const expectedDefVenue = defAll * concededFactorFor

  const nVenue = own.weight
  const atk = (own.scored + VENUE_PRIOR_GAMES * expectedAtkVenue) / (nVenue + VENUE_PRIOR_GAMES)
  const def = (own.conceded + VENUE_PRIOR_GAMES * expectedDefVenue) / (nVenue + VENUE_PRIOR_GAMES)

  return {
    atk, def,
    gamesAll: all.weight,
    gamesVenue: nVenue,
    rawAtkAll, rawDefAll,
    rawAtkVenue: nVenue > 0 ? own.scored / nVenue : null,
    rawDefVenue: nVenue > 0 ? own.conceded / nVenue : null,
    priorGames,
    transition: prior?.transition ?? 1,
    venueWeight: nVenue / (nVenue + VENUE_PRIOR_GAMES),
  }
}


export interface PriorContext {
  priorMatches: PriorMatch[]
  teamNames: Map<number, string>
  leagueAvgs: Map<string, LeagueAvg>
  homeAdvMap: Map<string, number>
  awayAdvMap: Map<string, number>
  leaguePlayers: Map<string, LeaguePlayer[]>
  lineups: Map<string, LineupEntry[]>
  /** Earliest red-card minute per (match, team), keyed `${match_id}:${team_name}`.
   *  Built from the same `match_lineups` rows as `lineups` above — see
   *  `redCardWeight` for how this discounts a match's contribution to a
   *  team's rolling goal-scoring stats. */
  redCards: Map<string, number>
}

const HOME_ADV_CAP_LOW = 0.75
const HOME_ADV_CAP_HIGH = 1.40

/**
 * Build per-team home/away advantage factors from prior-season data.
 * Factor = teamAvg / leagueAvg, capped to [0.75, 1.40].
 * Applied as a multiplier to rawHomeXG / rawAwayXG before Bayesian shrinkage.
 */
function buildHomeAdvantageMap(priorMatches: PriorMatch[]): {
  homeAdvMap: Map<string, number>
  awayAdvMap: Map<string, number>
} {
  const homeGoals = new Map<string, number>()
  const homeGames = new Map<string, number>()
  const awayGoals = new Map<string, number>()
  const awayGames = new Map<string, number>()

  let totalHomeGoals = 0
  let totalHomeGames = 0
  let totalAwayGoals = 0
  let totalAwayGames = 0

  for (const m of priorMatches) {
    homeGoals.set(m.home_team, (homeGoals.get(m.home_team) ?? 0) + m.home_score)
    homeGames.set(m.home_team, (homeGames.get(m.home_team) ?? 0) + 1)
    awayGoals.set(m.away_team, (awayGoals.get(m.away_team) ?? 0) + m.away_score)
    awayGames.set(m.away_team, (awayGames.get(m.away_team) ?? 0) + 1)
    totalHomeGoals += m.home_score
    totalHomeGames++
    totalAwayGoals += m.away_score
    totalAwayGames++
  }

  const leagueHomeAvg = totalHomeGames > 0 ? totalHomeGoals / totalHomeGames : FALLBACK_TOTAL_GOALS * FALLBACK_HOME_SHARE
  const leagueAwayAvg = totalAwayGames > 0 ? totalAwayGoals / totalAwayGames : FALLBACK_TOTAL_GOALS * (1 - FALLBACK_HOME_SHARE)

  const homeAdvMap = new Map<string, number>()
  const awayAdvMap = new Map<string, number>()

  for (const [team, g] of homeGames) {
    const avg = (homeGoals.get(team) ?? 0) / g
    const factor = leagueHomeAvg > 0 ? avg / leagueHomeAvg : 1.0
    homeAdvMap.set(team, Math.min(HOME_ADV_CAP_HIGH, Math.max(HOME_ADV_CAP_LOW, factor)))
  }

  for (const [team, g] of awayGames) {
    const avg = (awayGoals.get(team) ?? 0) / g
    const factor = leagueAwayAvg > 0 ? avg / leagueAwayAvg : 1.0
    awayAdvMap.set(team, Math.min(HOME_ADV_CAP_HIGH, Math.max(HOME_ADV_CAP_LOW, factor)))
  }

  return { homeAdvMap, awayAdvMap }
}

/** Pre-compute per-league goal averages once before the match loop. */
function buildLeagueAvgs(priorMatches: PriorMatch[]): Map<string, LeagueAvg> {
  const acc = new Map<string, { homeGoals: number; awayGoals: number; games: number; level: PriorMatch['league_level'] }>()
  for (const m of priorMatches) {
    const key = m.league_number ?? m.league_name
    if (!acc.has(key)) acc.set(key, { homeGoals: 0, awayGoals: 0, games: 0, level: m.league_level })
    const d = acc.get(key)!
    d.homeGoals += m.home_score
    d.awayGoals += m.away_score
    d.games++
  }
  const result = new Map<string, LeagueAvg>()
  for (const [key, d] of acc) {
    result.set(key, {
      homeAvg: d.homeGoals / d.games,
      awayAvg: d.awayGoals / d.games,
      level: d.level,
    })
  }
  return result
}

/**
 * A team's prior-season record, expressed as league-relative RATIOS rather than
 * goal counts, plus the transition factor into the league we're pricing.
 *
 * Ratios (not absolute goals) are what survives a league change: "scored 30%
 * more than an average team in its league" carries over, "scored 2.4 goals a
 * game" does not. The caller turns these back into goals by multiplying with
 * the TARGET tier's own baseline, which is what makes a B-Klasse fixture get
 * B-Klasse goal levels instead of Kreisliga ones.
 *
 * Venue splits are deliberately NOT carried over: half a season of home games
 * (~15) is a thin sample for a team-specific home effect, and the league's own
 * home/away split (LeagueBaseline) already supplies that structure.
 */
function getPriorTeamStats(
  priorMatches: PriorMatch[],
  leagueAvgs: Map<string, LeagueAvg>,
  teamName: string,
  target: LeagueTier
): PriorTeamStats | null {
  type Acc = { scored: number; conceded: number; games: number; level: PriorMatch['league_level'] }
  const byLeague = new Map<string, Acc>()

  const touch = (key: string, level: PriorMatch['league_level']): Acc => {
    let acc = byLeague.get(key)
    if (!acc) { acc = { scored: 0, conceded: 0, games: 0, level }; byLeague.set(key, acc) }
    return acc
  }

  for (const m of priorMatches) {
    const key = m.league_number ?? m.league_name
    if (m.home_team === teamName) {
      const acc = touch(key, m.league_level)
      acc.scored += m.home_score
      acc.conceded += m.away_score
      acc.games++
    }
    if (m.away_team === teamName) {
      const acc = touch(key, m.league_level)
      acc.scored += m.away_score
      acc.conceded += m.home_score
      acc.games++
    }
  }
  if (byLeague.size === 0) return null

  let atkSum = 0, defSum = 0, transSum = 0, games = 0
  for (const [key, acc] of byLeague) {
    const la = leagueAvgs.get(key)
    if (!la || acc.games === 0) continue
    // Per-team goals per game in that league — the yardstick both ratios use.
    const leagueTeamAvg = (la.homeAvg + la.awayAvg) / 2
    if (leagueTeamAvg <= 0) continue
    const atkRatio = clampRatio((acc.scored / acc.games) / leagueTeamAvg)
    const defRatio = clampRatio((acc.conceded / acc.games) / leagueTeamAvg)
    atkSum += atkRatio * acc.games
    defSum += defRatio * acc.games
    transSum += leagueTransition(acc.level, target) * acc.games
    games += acc.games
  }
  if (games === 0) return null

  return {
    atkRatio: atkSum / games,
    defRatio: defSum / games,
    transition: transSum / games,
    games,
  }
}

/**
 * Build a PriorContext from prior-season matches and the team-ID→name mapping.
 * Call this once before the per-match odds loop for efficiency.
 */
export function buildPriorContext(
  priorMatches: PriorMatch[],
  teamNames: Map<number, string>,
  leaguePlayers: LeaguePlayer[] = [],
  lineupEntries: LineupEntry[] = []
): PriorContext {
  const { homeAdvMap, awayAdvMap } = buildHomeAdvantageMap(priorMatches)

  const leaguePlayersMap = new Map<string, LeaguePlayer[]>()
  for (const p of leaguePlayers) {
    const arr = leaguePlayersMap.get(p.team_name) ?? []
    arr.push(p)
    leaguePlayersMap.set(p.team_name, arr)
  }

  const lineupsMap = new Map<string, LineupEntry[]>()
  const redCardsMap = new Map<string, number>()
  for (const e of lineupEntries) {
    const arr = lineupsMap.get(e.team_name) ?? []
    arr.push(e)
    lineupsMap.set(e.team_name, arr)
    if (e.red_card_minute != null) {
      const key = `${e.match_id}:${e.team_name}`
      // A team fielding two red cards in one match is rare but not impossible —
      // keep the EARLIEST one, since that's when the man disadvantage started
      // and therefore the larger share of the match was affected.
      const existing = redCardsMap.get(key)
      if (existing == null || e.red_card_minute < existing) redCardsMap.set(key, e.red_card_minute)
    }
  }

  return {
    priorMatches,
    teamNames,
    leagueAvgs: buildLeagueAvgs(priorMatches),
    homeAdvMap,
    awayAdvMap,
    leaguePlayers: leaguePlayersMap,
    lineups: lineupsMap,
    redCards: redCardsMap,
  }
}

// ---------- xG estimation — geometric-mean attack/defense model with Bayesian shrinkage ----------

/** Count of finished current-season matches for teamId (home or away). */
function getGamesPlayedThisSeason(matches: Match[], teamId: number): number {
  return matches.filter(
    (m) => m.status === 'finished' && (m.home_team_id === teamId || m.away_team_id === teamId)
  ).length
}

// A match partly played with a man disadvantage (red card) is a poor sample of
// a team's normal strength for BOTH sides — the carded team's output is
// suppressed, and the opponent's is inflated — but we don't know which
// direction dominates a specific scoreline, so rather than adjust the value
// we just trust it less. Weight ramps from RED_CARD_MIN_WEIGHT (a card in the
// first minute) up to 1.0 (a card in stoppage time barely changes anything),
// linear in the card's minute. Whichever side got the card, both team's
// stats for that match are discounted the same way (see redCardWeight).
const RED_CARD_MIN_WEIGHT = 0.3

/** Discount weight for one match's contribution to a team's goal-scoring
 *  average, based on the earliest red card (either side) in that match —
 *  looked up by team NAME (not id) since that's how match_lineups keys it,
 *  same as the roster-factor lineup data this reuses. */
function redCardWeight(m: Match, redCards?: Map<string, number>): number {
  if (!redCards || redCards.size === 0) return 1
  const homeMinute = m.home_team?.name ? redCards.get(`${m.id}:${m.home_team.name}`) : undefined
  const awayMinute = m.away_team?.name ? redCards.get(`${m.id}:${m.away_team.name}`) : undefined
  const minute = [homeMinute, awayMinute].filter((v): v is number => v != null).sort((a, b) => a - b)[0]
  if (minute == null) return 1
  return Math.max(RED_CARD_MIN_WEIGHT, Math.min(1, minute / 90))
}

/**
 * Form multiplier from the last FORM_GAMES finished matches (W=3, D=1, L=0).
 * Maps the form ratio [0, 1] linearly to [FORM_MULT_BASE, FORM_MULT_BASE+FORM_MULT_RANGE],
 * then ramps that result in linearly between FORM_RAMP_START and FORM_RAMP_FULL total
 * current-season games played — at exactly FORM_RAMP_START games the multiplier is
 * neutral (1.0), reaching full strength only once FORM_RAMP_FULL games exist. Below
 * FORM_RAMP_START games, neutral (1.0) — not enough evidence to react to at all.
 *
 * Season-long attack/defense averages alone don't reflect momentum. A top-of-table
 * team riding a streak (or a struggling team in a slump) shows up in form first,
 * before the season averages catch up. The multiplier injects that signal into
 * the team's own xG so real, current sporting differences come through clearly —
 * but the ramp prevents a 3-game sample from swinging odds at full strength.
 */
function getTeamFormMult(matches: Match[], teamId: number): number {
  const gamesPlayed = getGamesPlayedThisSeason(matches, teamId)
  if (gamesPlayed < FORM_RAMP_START) return 1.0
  const form = getForm(matches, teamId, FORM_GAMES)
  if (form.length < 3) return 1.0
  const pts = form.reduce((acc, r) => acc + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0)
  const fullMult = FORM_MULT_BASE + FORM_MULT_RANGE * (pts / (form.length * 3))
  const rampProgress = Math.min(1, (gamesPlayed - FORM_RAMP_START) / (FORM_RAMP_FULL - FORM_RAMP_START))
  return 1.0 + (fullMult - 1.0) * rampProgress
}

const TRANSFER_FACTOR_FLOOR = 0.65
const TRANSFER_FACTOR_CEILING = 1.15
const LOSS_DAMPING = 0.5   // departures are a certain loss — apply at half strength
const GAIN_DAMPING = 0.4   // signings are an uncertain gain — apply more conservatively
const INCOMING_CONFIDENCE = 0.65 // extra discount: new signings must still prove it at the new club
const MIN_CONTRIBUTION_SAMPLE = 8
// A goals-only importance metric is blind to non-scorers — a regular centre-back
// or keeper who plays every minute but never scores contributed 0 to the old
// "totalKeyGoals" sum, so losing them moved the roster factor not at all. Convert
// minutes played into goal-equivalent "contribution" too, so a full-season
// regular (~2000-2500 minutes) registers on a similar scale to a decent scorer
// regardless of whether they ever found the net themselves.
const MINUTES_PER_GOAL_EQUIVALENT = 200

function contribution(p: Pick<LeaguePlayer, 'goals' | 'minutes'>): number {
  return p.goals + (p.minutes ?? 0) / MINUTES_PER_GOAL_EQUIVALENT
}

// Below this many current-season lineup-tracked matches, the live-lineup read
// (LINEUP_GAMES_FULL_WEIGHT) is blended with the static transfer fallback rather
// than fully trusted — a single missing name could be a vacation or a benching,
// not a real departure. Weight ramps linearly to 100% lineup-based by this count.
const LINEUP_GAMES_FULL_WEIGHT = 3

/** Tier 1: share of last season's contribution still showing up in recent lineups. */
function lineupBasedFactor(
  returningPlayers: LeaguePlayer[],
  totalKeyContribution: number,
  recentLineups: LineupEntry[],
  uniqueMatches: Set<number>
): number {
  if (totalKeyContribution === 0) return 1.0
  const last5MatchIds = [...uniqueMatches].slice(-5)
  const recentPlayers = new Set(
    recentLineups.filter(e => last5MatchIds.includes(e.match_id)).map(e => e.player_name)
  )
  const activeContribution = returningPlayers
    .filter(p => recentPlayers.has(p.name))
    .reduce((s, p) => s + contribution(p), 0)
  const activeShare = activeContribution / totalKeyContribution
  if (activeShare < 0.5) return 0.90
  if (activeShare < 0.7) return 0.95
  return 1.0
}

/** Tier 2: static prior-season transfer/retirement/signing records. */
function transferBasedFactor(
  returningPlayers: LeaguePlayer[],
  incomingPlayers: LeaguePlayer[],
  totalKeyContribution: number
): number {
  if (totalKeyContribution < MIN_CONTRIBUTION_SAMPLE) return 1.0

  const retainedContribution = returningPlayers
    .filter(p => !p.status || p.status === 'active')
    .reduce((s, p) => s + contribution(p), 0)

  const incomingCreditedContribution = incomingPlayers.reduce((s, p) => {
    const level = p.prior_league_level as PriorMatch['league_level'] | null | undefined
    const strength = level ? LEAGUE_STRENGTH[level] : 1.0
    return s + contribution(p) * strength * INCOMING_CONFIDENCE
  }, 0)

  const ratio = (retainedContribution + incomingCreditedContribution) / totalKeyContribution
  const delta = ratio - 1
  const factor = 1 + delta * (delta < 0 ? LOSS_DAMPING : GAIN_DAMPING)
  return Math.max(TRANSFER_FACTOR_FLOOR, Math.min(TRANSFER_FACTOR_CEILING, factor))
}

/**
 * Roster factor reflecting whether last season's key contributors are still
 * around, and whether known incoming signings add comparable quality back.
 * "Contribution" = goals + minutes played (see MINUTES_PER_GOAL_EQUIVALENT) so
 * non-scoring regulars (defenders, goalkeepers) are weighed too, not just
 * scorers — a team can lose real quality with zero effect on the score sheet.
 *
 * Two tiers, blended by how much CURRENT-season lineup evidence exists:
 * 1. Live lineup read — a player who left (or is injured/benched) simply won't
 *    show up in recent lineups, so this naturally detects both departures and
 *    short-term absences. New signings are excluded here since their real
 *    current-season output is already captured by the normal season-average
 *    stats once they have appearances.
 * 2. Static prior-season transfer/retirement/signing records — net last
 *    season's contribution that departed against contribution a known new
 *    signing brings in (normalized across leagues via LEAGUE_STRENGTH, then
 *    damped for integration uncertainty), dampened into a bounded multiplier.
 *    Active from matchday 1, before any lineup evidence exists.
 *
 * Below LINEUP_GAMES_FULL_WEIGHT tracked matches, tier 1 is blended in at
 * partial weight (ramping 0→100% linearly) rather than switched on at full
 * strength — one or two absences from lineups could just as easily be a
 * rotation or a player back from vacation, not a real long-term loss. At
 * LINEUP_GAMES_FULL_WEIGHT+ matches, tier 1 fully replaces tier 2.
 */
function getRosterFactor(teamName: string, priorCtx: PriorContext): number {
  const allPlayers = priorCtx.leaguePlayers.get(teamName) ?? []
  const returningPlayers = allPlayers.filter(p => p.status !== 'transferred_in')
  const incomingPlayers = allPlayers.filter(p => p.status === 'transferred_in')

  const totalKeyContribution = returningPlayers.reduce((s, p) => s + contribution(p), 0)

  const recentLineups = priorCtx.lineups.get(teamName) ?? []
  const uniqueMatches = new Set(recentLineups.map(e => e.match_id))

  const tier2 = transferBasedFactor(returningPlayers, incomingPlayers, totalKeyContribution)
  if (uniqueMatches.size === 0) return tier2

  const tier1 = lineupBasedFactor(returningPlayers, totalKeyContribution, recentLineups, uniqueMatches)
  const lineupWeight = Math.min(1, uniqueMatches.size / LINEUP_GAMES_FULL_WEIGHT)
  return tier2 * (1 - lineupWeight) + tier1 * lineupWeight
}

export interface OddsDiagnosticsSide {
  gamesPlayed: number
  kEffective: number
  formMult: number
  rosterFactor: number
  rawXG: number
  finalXG: number
  /** Finished matches this season (red-card-weighted), all venues. */
  gamesAll: number
  /** …of those, played at the venue this fixture uses. */
  gamesVenue: number
  goalsForPerGameAll: number
  goalsAgainstPerGameAll: number
  /** null when the team has not played at this venue yet. */
  goalsForPerGameVenue: number | null
  goalsAgainstPerGameVenue: number | null
  /** 0 = estimate came purely from the team's overall rate, 1 = purely venue. */
  venueWeight: number
  /** Prior-season pseudo-games mixed in (games × PRIOR_WEIGHT). */
  priorGames: number
  /** Source-league → target-league factor applied to the prior season (1 = same league). */
  leagueTransition: number
  estimatedAttack: number
  estimatedDefence: number
}

export interface OddsDiagnostics {
  /** Which league's goal environment this fixture was priced in. */
  tier: LeagueTier
  baselineHome: number
  baselineAway: number
  /** Matches backing that baseline — small means "still mostly the pooled prior". */
  baselineSampleMatches: number
  home: OddsDiagnosticsSide
  away: OddsDiagnosticsSide
}

/**
 * Geometric-mean xG model with Bayesian shrinkage and form adjustment.
 *
 * Why geometric mean (not arithmetic, not full product):
 * - Arithmetic mean `(atk + def) / 2` underestimates compounding quality mismatches.
 * - Full product `L × atkRate × defRate` overestimates them — two rates of 1.8×
 *   combine to 3.24×, producing absurdly short O/U and BTTS odds.
 * - Geometric mean `sqrt(atk × def)` threads the needle: identical to the
 *   arithmetic mean for equal values, lower for unequal values (AM–GM inequality),
 *   so a strong attacker vs a strong defence still yields moderate xG (correct).
 *
 * Shrinkage happens ONCE, inside teamRates(): prior-season pseudo-games are blended
 * into the team's overall rate, that rate is shrunk toward the tier baseline with
 * TEAM_PRIOR_GAMES, and the venue-specific rate is then shrunk toward
 * "overall rate × this venue's factor" with VENUE_PRIOR_GAMES. The previous model
 * shrank twice (augmentStat, then a dynamic K ramping to 11), which pinned an
 * early-season fixture's xG almost entirely onto the league constants; the backtest
 * used to choose these two constants is scripts/backtest.ts. A ramped team-form
 * multiplier (±10%) then modulates each team's own xG to reflect recent momentum
 * that the season-long averages haven't fully absorbed yet.
 *
 * Also returns `diagnostics` — the intermediate values behind the final xG, persisted
 * to `odds_diagnostics` by callers for admin explainability. Computing it is free
 * (everything here is already computed for the xG itself), so it's always returned;
 * callers simply choose whether to persist it.
 */
export function getMatchXG(
  matches: Match[],
  homeTeamId: number,
  awayTeamId: number,
  priorCtx?: PriorContext,
  targetTier?: LeagueTier
): { homeXG: number; awayXG: number; diagnostics: OddsDiagnostics } {
  const tier = targetTier ?? inferTier(matches, homeTeamId, awayTeamId)
  const baseline = getLeagueBaselines(matches, tier, priorCtx?.priorMatches)

  const homeName = priorCtx?.teamNames.get(homeTeamId)
  const awayName = priorCtx?.teamNames.get(awayTeamId)

  const home = teamRates(matches, homeTeamId, homeName, 'home', baseline, priorCtx, tier)
  const away = teamRates(matches, awayTeamId, awayName, 'away', baseline, priorCtx, tier)

  // Geometric mean of "what the attack produces" and "what the defence allows".
  // Unchanged on purpose: AM ≥ GM keeps a strong-attack/strong-defence pairing
  // bounded while still amplifying a genuine mismatch. Both inputs are already
  // on this venue's goal scale, so two average teams reproduce the league
  // baseline exactly.
  const rawHomeXG = Math.sqrt(home.atk * away.def)
  const rawAwayXG = Math.sqrt(away.atk * home.def)

  const homeGamesPlayed = getGamesPlayedThisSeason(matches, homeTeamId)
  const awayGamesPlayed = getGamesPlayedThisSeason(matches, awayTeamId)

  const homeFormMult = getTeamFormMult(matches, homeTeamId)
  const awayFormMult = getTeamFormMult(matches, awayTeamId)

  const homeRosterFactor = homeName && priorCtx ? getRosterFactor(homeName, priorCtx) : 1.0
  const awayRosterFactor = awayName && priorCtx ? getRosterFactor(awayName, priorCtx) : 1.0

  const homeXG = Math.max(XG_FLOOR, rawHomeXG * homeFormMult * homeRosterFactor)
  const awayXG = Math.max(XG_FLOOR, rawAwayXG * awayFormMult * awayRosterFactor)

  const side = (r: TeamRates, gamesPlayed: number, formMult: number, rosterFactor: number, rawXG: number, finalXG: number) => ({
    gamesPlayed,
    // Retained for the existing diagnostics schema/UI. The dynamic early-season
    // K is gone (one shrinkage instead of two), so this now reports the single
    // league-shrinkage weight actually used.
    kEffective: TEAM_PRIOR_GAMES,
    formMult,
    rosterFactor,
    rawXG,
    finalXG,
    gamesAll: r.gamesAll,
    gamesVenue: r.gamesVenue,
    goalsForPerGameAll: r.rawAtkAll,
    goalsAgainstPerGameAll: r.rawDefAll,
    goalsForPerGameVenue: r.rawAtkVenue,
    goalsAgainstPerGameVenue: r.rawDefVenue,
    venueWeight: r.venueWeight,
    priorGames: r.priorGames,
    leagueTransition: r.transition,
    estimatedAttack: r.atk,
    estimatedDefence: r.def,
  })

  return {
    homeXG,
    awayXG,
    diagnostics: {
      tier,
      baselineHome: baseline.home,
      baselineAway: baseline.away,
      baselineSampleMatches: baseline.sampleMatches,
      home: side(home, homeGamesPlayed, homeFormMult, homeRosterFactor, rawHomeXG, homeXG),
      away: side(away, awayGamesPlayed, awayFormMult, awayRosterFactor, rawAwayXG, awayXG),
    },
  }
}

// ---------- Main calculation (all markets from one unified Poisson model) ----------

/**
 * Derives every market's odds from a given (homeXG, awayXG) pair via the shared
 * score matrix. Split out from calculateOdds() so callers who already have xG
 * (e.g. because they also need the getMatchXG diagnostics) don't compute it twice.
 */
export function oddsFromXG(homeXG: number, awayXG: number): OddsData {
  const matrix = buildScoreMatrix(homeXG, awayXG)

  // Aggregate raw probabilities from the joint score distribution
  let pHome = 0, pDraw = 0, pAway = 0
  let pOver25 = 0, pOver35 = 0, pOver55 = 0, pOver75 = 0
  let pBtts = 0
  let pHomeMinus15 = 0, pHomeMinus25 = 0
  let pAwayMinus15 = 0, pAwayMinus25 = 0

  for (let h = 0; h <= SCORE_MATRIX_MAX_GOALS; h++) {
    for (let a = 0; a <= SCORE_MATRIX_MAX_GOALS; a++) {
      const p = matrix[h][a]
      if (h > a) pHome += p
      else if (h === a) pDraw += p
      else pAway += p
      if (h + a > 2) pOver25 += p
      if (h + a > 3) pOver35 += p
      if (h + a > 5) pOver55 += p
      if (h + a > 7) pOver75 += p
      if (h > 0 && a > 0) pBtts += p
      if (h - a >= 2) pHomeMinus15 += p
      if (h - a >= 3) pHomeMinus25 += p
      if (a - h >= 2) pAwayMinus15 += p
      if (a - h >= 3) pAwayMinus25 += p
    }
  }

  // Double chance: derived consistently from the same 1X2 probabilities
  // Über 9,5 — einseitige Spaßlinie, siehe GOALS_LINE_95_MAX_ODDS.
  let pOver95 = 0
  for (let h = 0; h <= SCORE_MATRIX_MAX_GOALS; h++) {
    for (let a = 0; a <= SCORE_MATRIX_MAX_GOALS; a++) {
      if (h + a > 9.5) pOver95 += matrix[h][a]
    }
  }

  const p1x = pHome + pDraw
  const px2 = pDraw + pAway
  const p12 = pHome + pAway

  // Apply consistent bookmaker margin to every market via toOdds()
  return {
    home_win:  toOdds(pHome),
    draw:      toOdds(pDraw),
    away_win:  toOdds(pAway),
    odds_1x:   toOdds(p1x),
    odds_x2:   toOdds(px2),
    odds_12:   toOdds(p12),
    over_2_5:  toOdds(pOver25),
    under_2_5: toOdds(1 - pOver25),
    over_3_5:  toOdds(pOver35),
    under_3_5: toOdds(1 - pOver35),
    over_5_5:  toOdds(pOver55),
    under_5_5: toOdds(1 - pOver55),
    over_7_5:  toOdds(pOver75),
    under_7_5: toOdds(1 - pOver75),
    // One-sided: a fixture where ten goals is a real possibility gets the line,
    // everywhere else it is null and simply not shown. Never an `under_9_5` —
    // see the migration comment and GOALS_LINE_95_MAX_ODDS.
    over_9_5: offerOver95(pOver95),
    btts_yes:  toOdds(pBtts),
    btts_no:   toOdds(1 - pBtts),
    hdp_home_minus_1_5: toOdds(pHomeMinus15),
    hdp_away_plus_1_5:  toOdds(1 - pHomeMinus15),
    hdp_home_minus_2_5: toOdds(pHomeMinus25),
    hdp_away_plus_2_5:  toOdds(1 - pHomeMinus25),
    // Mirrored direction (away favoured to win by 2+/3+) — always computed
    // alongside the home direction so the DB/admin always has both, but only
    // ONE direction per line is actually offered to bettors (see
    // lib/oddsMarkets.ts#homeHandicapFavored) — the unfavoured direction's
    // odds would otherwise be either a near-certainty or a near-impossibility,
    // not a meaningful bet.
    hdp_away_minus_1_5: toOdds(pAwayMinus15),
    hdp_home_plus_1_5:  toOdds(1 - pAwayMinus15),
    hdp_away_minus_2_5: toOdds(pAwayMinus25),
    hdp_home_plus_2_5:  toOdds(1 - pAwayMinus25),
  }
}

export function calculateOdds(
  matches: Match[],
  homeTeamId: number,
  awayTeamId: number,
  priorCtx?: PriorContext
): OddsData {
  const { homeXG, awayXG } = getMatchXG(matches, homeTeamId, awayTeamId, priorCtx)
  return oddsFromXG(homeXG, awayXG)
}

/**
 * Exact-score odds derived from the same Poisson model as calculateOdds.
 * Only scores with odds ≤ MAX_EXACT_ODDS are offered — scores above that
 * threshold are so unlikely they add noise without meaningful value. This is
 * purely an offer/visibility cutoff, NOT a cap: a score's odds are never
 * clamped down to this value, they're just hidden above it (see MAX_ODDS for
 * the actual technical odds ceiling, which is unrelated and unaffected).
 * Consistent with 1X2: the house margin factor is identical for every score,
 * so the sum of exact-score implied probabilities for any subset is always ≤
 * the corresponding 1X2 implied probability. No arbitrage across markets is possible.
 *
 * Exported: the same threshold is the binding "is this score offered at all"
 * cutoff used when validating a bet server-side and when persisting the
 * frozen exact-score set — must not be duplicated as a second magic number.
 */
export const MAX_EXACT_ODDS = 50

// "Über 9,5 Tore" is a novelty line, offered only where ten goals is a genuine
// possibility. Reuses MAX_EXACT_ODDS as the cutoff rather than inventing a
// second number: it already encodes "beyond this price a selection is noise
// rather than a bet" for the exact-score market. A normal Kreisliga fixture
// prices around 400, so the line stays hidden there instead of showing a dead
// 100.00 on every card.
//
// ONE-SIDED ON PURPOSE. There is no `under_9_5`: its fair price is about 0.91,
// which MIN_ODDS would lift to 1.01 — a bet nobody places, and one whose margin
// against a positive expected value is thin enough to be uncomfortable. The
// over side has no such issue, since clamping a price down can only reduce the
// punter's return.
const GOALS_LINE_95_MAX_ODDS = MAX_EXACT_ODDS

/** Offered price for Über 9,5, or null where the line is not worth showing. */
function offerOver95(prob: number): number | null {
  if (prob <= 0) return null
  const odds = toOdds(prob)
  return odds <= GOALS_LINE_95_MAX_ODDS ? odds : null
}

/**
 * Exact-score odds from an already-computed (homeXG, awayXG) pair — the exact
 * same relationship oddsFromXG() has to calculateOdds(). Callers that already
 * have xG on hand (the odds-freeze loop, which computes it once per match for
 * every market) should use this directly instead of getExactScoreOdds(),
 * which would silently recompute xG a second time.
 */
export function exactScoreOddsFromXG(homeXG: number, awayXG: number): { score: string; odds: number }[] {
  const results: { score: string; odds: number; total: number; homeGoals: number }[] = []

  // Derive from the same normalised matrix every other market uses, so the
  // "no arbitrage across markets" property described above actually holds.
  const matrix = buildScoreMatrix(homeXG, awayXG)

  for (let h = 0; h <= SCORE_MATRIX_MAX_GOALS; h++) {
    for (let a = 0; a <= SCORE_MATRIX_MAX_GOALS; a++) {
      const o = toOdds(matrix[h][a])
      if (o <= MAX_EXACT_ODDS) {
        results.push({ score: `${h}:${a}`, odds: o, total: h + a, homeGoals: h })
      }
    }
  }

  // Sort: fewest total goals first; within same total, more home goals first
  results.sort((a, b) => a.total - b.total || b.homeGoals - a.homeGoals)

  return results.map(({ score, odds }) => ({ score, odds }))
}

export function getExactScoreOdds(
  matches: Match[],
  homeTeamId: number,
  awayTeamId: number,
  priorCtx?: PriorContext
): { score: string; odds: number }[] {
  const { homeXG, awayXG } = getMatchXG(matches, homeTeamId, awayTeamId, priorCtx)
  return exactScoreOddsFromXG(homeXG, awayXG)
}

/**
 * Every score from 0:0 to maxGoals:maxGoals with its model odds, regardless
 * of the MAX_EXACT_ODDS cutoff. This — not exactScoreOddsFromXG's already-
 * filtered list — is what gets persisted as the match's auto exact-score
 * grid (odds.exact_score_odds): an admin override must be able to pull a
 * score that's currently > MAX_EXACT_ODDS (and therefore normally hidden) under the
 * threshold, and reverting an override needs a real auto value to fall back
 * to even for a score nobody would otherwise be offered. Defaults to the
 * same 0..10 range every other score-matrix computation in this file uses,
 * so nothing that could naturally be ≤ MAX_EXACT_ODDS is ever left out.
 */
export function getFullExactScoreMatrix(homeXG: number, awayXG: number, maxGoals = SCORE_MATRIX_MAX_GOALS): { score: string; odds: number }[] {
  const matrix = buildScoreMatrix(homeXG, awayXG, maxGoals)
  const results: { score: string; odds: number; total: number; homeGoals: number }[] = []
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      results.push({ score: `${h}:${a}`, odds: toOdds(matrix[h][a]), total: h + a, homeGoals: h })
    }
  }
  results.sort((a, b) => a.total - b.total || b.homeGoals - a.homeGoals)
  return results.map(({ score, odds }) => ({ score, odds }))
}

/**
 * Merges the persisted auto-computed exact-score grid with any admin
 * override, THEN applies the MAX_EXACT_ODDS cutoff to the merged value —
 * never to the raw auto value first. An override can pull an otherwise
 * too-long score under the threshold (making it offered) or push an
 * otherwise-offered score over it (making it not offered); filtering before
 * the merge would silently break both directions. Single source of truth for
 * "what exact scores are actually offered for this match", used identically
 * for display (tipps/page.tsx), the admin preview, and server-side bet
 * validation (app/api/bets/place/route.ts) so they can never disagree.
 *
 * Ordering: ascending by FINAL odds (most likely first) — a manual override
 * moves a score's position too, since it changes the value being sorted on.
 * Deterministic tie-break for equal final odds: fewer total goals, then
 * fewer home goals, then fewer away goals. Sorting lives here (not in each
 * caller/column) so display, admin preview and any future consumer can never
 * disagree on order.
 */
// ---------- Cup-specific markets (one-off knockout fixture, no extra time) ----------

// There is no shootout-specific historical data anywhere in this dataset, so
// a shootout's win probability is deliberately NOT modelled with any real
// precision — it's anchored near 50:50 and nudged only slightly by overall
// team strength (the same xG this match's every other market already uses),
// capped so the tilt can never swing more than a few points either way. This
// is a conservative, openly-approximate heuristic, not a fitted model.
const SHOOTOUT_STRENGTH_DIFF_CAP = 0.3
const SHOOTOUT_TILT_FACTOR = 0.2
/** Exported so lib/cupSimulation.ts's Monte Carlo shootout draw uses the
 *  EXACT same heuristic as the closed-form cup_advance market instead of a
 *  second, potentially-drifting reimplementation. */
export function shootoutHomeWinProb(homeXG: number, awayXG: number): number {
  const totalXG = homeXG + awayXG
  if (totalXG <= 0) return 0.5
  const diffRatio = (homeXG - awayXG) / totalXG
  const capped = Math.max(-SHOOTOUT_STRENGTH_DIFF_CAP, Math.min(SHOOTOUT_STRENGTH_DIFF_CAP, diffRatio))
  return 0.5 + capped * SHOOTOUT_TILT_FACTOR
}

export interface CupMarketOdds {
  cup_advance_home: number
  cup_advance_away: number
  cup_first_goal_home: number
  cup_first_goal_away: number
  cup_first_goal_none: number
  /** True model-derived odds for "Kein Tor in 90 Min." before the product
   *  cap below — kept for transparency, never itself offered/bettable. */
  cup_first_goal_none_model: number
}

// Deliberate PRODUCT pricing rule, not a model correction: a mathematically
// fair ~43 for "no goal in 90 minutes" is technically correct (see
// cupMarketOddsFromXG's own doc) but reads as an unplayable/uninteresting
// outcome for a one-off cup special. The model's fair_probability and
// model_odds are preserved as-is (see cup_first_goal_none_model above); only
// the OFFERED price is capped, keeping the two concerns cleanly separate.
export const MAX_CUP_FIRST_GOAL_NONE_ODDS = 15.0

/**
 * The 3 correlated/path-dependent cup specials (Halbzeitführung & Weiterkommen,
 * Comeback & Weiterkommen, Elfmeterschießen & Weiterkommen) plus "Wie fällt
 * die Entscheidung?" (90 Minuten vs. Elfmeterschießen — a simple partition of
 * cup_advance's own draw probability, no simulation needed for that one).
 * "home"/"away" match cup_advance's own convention (home = Wildenroth on
 * match 573). See lib/cupSimulation.ts for the Monte Carlo methodology.
 */
export interface CupSpecialMarketOdds {
  cup_decision_regulation: number
  cup_decision_shootout: number
  cup_halftime_lead_advance_yes: number
  cup_halftime_lead_advance_no: number
  cup_comeback_advance_yes: number
  cup_comeback_advance_no: number
  cup_shootout_advance_yes: number
  cup_shootout_advance_no: number
  /** True model-derived odds for each special's "Ja" side, before the
   *  commercial rounding below — kept for transparency. The "Nein" side is
   *  no longer offered as a bettable outcome (product decision: these 3
   *  markets read as pure prop specials, see components/CupMatchCard.tsx),
   *  so it has no separate model/offered split — its stored value is simply
   *  the model's own number, same as before. */
  cup_halftime_lead_advance_yes_model: number
  cup_comeback_advance_yes_model: number
  cup_shootout_advance_yes_model: number
}

/**
 * Deliberate commercial rounding for the 3 one-off cup specials' "Ja" price —
 * a product decision (readable, "nice" odds for a special bet), not a model
 * correction. Each mapping below is a manually chosen, individually reasoned
 * override (not a generic round-to-nearest-ladder function, since this only
 * ever applies to these 3 specific one-off markets on this one match).
 *
 * ROUND 6 UPDATE: after the Geiselbullach/Wildenroth xG recalibration (see
 * the round-6 report — Geiselbullach is now the model favourite, homeXG≈2.01/
 * awayXG≈2.52 instead of the previous ~2.12/1.65), all 3 "Wildenroth does X
 * and still advances" paths got meaningfully LESS likely (Wildenroth is the
 * "home" side these markets are phrased around), so their fair odds lengthened
 * substantially and the old fixed prices (2.50/5.50/8.00) would now be
 * significantly bettor-favourable (positive EV) if left unchanged:
 * - Halbzeitführung & Weiterkommen: new model ≈3.95 (was 2.52). Rounds to
 *   4.00 — close to fair, ~10.6% margin (was ~11.6%), same spirit as before.
 * - Comeback & Weiterkommen: new model ≈6.18 (was 5.32). Rounds to 6.50 —
 *   deliberately generous (~6.6% margin) same as before's below-standard
 *   margin choice for this rare/fun market.
 * - Elfmeterschießen & Weiterkommen: new model ≈9.99 (was 8.07). Rounds to
 *   10.00 — negligible move, margin essentially unchanged (~11.9%).
 */
function roundCupSpecialYesOdds(field: 'halftime' | 'comeback' | 'shootout'): number {
  switch (field) {
    case 'halftime': return 4.0
    case 'comeback': return 6.5
    case 'shootout': return 10.0
  }
}

/**
 * "Wer kommt weiter?" and "Wer erzielt das erste Tor?" for a one-off knockout
 * cup fixture with no extra time — a 90(+stoppage)-minute draw goes straight
 * to penalties. Derived from the SAME (homeXG, awayXG) pair — via the same
 * normalised score matrix — as every other market on this match, so the fair
 * 90-minute split used here can never silently disagree with the match's own
 * 1X2 card.
 *
 * "Wer erzielt das erste Tor?" uses the standard competing-independent-
 * Poisson-processes approximation: among two goal processes with rates
 * homeXG and awayXG over 90+stoppage minutes, the probability a given side
 * scores first (conditional on any goal at all) is its share of the combined
 * rate; P(no goal at all) = e^-(homeXG+awayXG) — exactly this match's own
 * 0:0 probability, so "none" and the match's own scoreline can't disagree
 * either. Penalty-shootout goals never count for this market.
 */
export function cupMarketOddsFromXG(homeXG: number, awayXG: number): CupMarketOdds {
  const matrix = buildScoreMatrix(homeXG, awayXG)
  let pHome = 0, pDraw = 0, pAway = 0
  for (let h = 0; h <= SCORE_MATRIX_MAX_GOALS; h++) {
    for (let a = 0; a <= SCORE_MATRIX_MAX_GOALS; a++) {
      const p = matrix[h][a]
      if (h > a) pHome += p
      else if (h === a) pDraw += p
      else pAway += p
    }
  }

  const pShootoutHome = shootoutHomeWinProb(homeXG, awayXG)
  const pAdvanceHome = pHome + pDraw * pShootoutHome
  const pAdvanceAway = pAway + pDraw * (1 - pShootoutHome)

  const pNoGoal = Math.exp(-(homeXG + awayXG))
  const pAnyGoal = 1 - pNoGoal
  const totalXG = homeXG + awayXG
  const pFirstHome = totalXG > 0 ? pAnyGoal * (homeXG / totalXG) : 0
  const pFirstAway = totalXG > 0 ? pAnyGoal * (awayXG / totalXG) : 0

  const modelNoneOdds = toOdds(pNoGoal)

  return {
    cup_advance_home: toOdds(pAdvanceHome),
    cup_advance_away: toOdds(pAdvanceAway),
    cup_first_goal_home: toOdds(pFirstHome),
    cup_first_goal_away: toOdds(pFirstAway),
    cup_first_goal_none: Math.min(modelNoneOdds, MAX_CUP_FIRST_GOAL_NONE_ODDS),
    cup_first_goal_none_model: modelNoneOdds,
  }
}

// Simulation count: 50,000-100,000 was the target range in the spec; 80,000
// was chosen as the fixed point — comfortably inside a Next.js server route's
// render budget (benchmarked at well under 100ms in this repo's runtime for
// this match's xG, negligible next to the rest of the freeze pipeline, which
// already touches the DB per match) while keeping simulation noise small.
// Standard error of a simulated probability p over N=80,000 draws is
// sqrt(p*(1-p)/N); worst case p=0.5 gives ~0.18 percentage points (95% CI
// ~±0.35pp) — far tighter than the odds are rounded to (2 decimals) or than
// the underlying xG estimate's own uncertainty, so simulation noise is not a
// meaningful source of error here.
export const CUP_SIMULATION_RUNS = 80000

/**
 * The 3 correlated cup specials, via Monte Carlo match simulation (see
 * lib/cupSimulation.ts), plus "Wie fällt die Entscheidung?" which is a plain
 * partition of cup_advance's own 90-minute draw probability and needs no
 * simulation. Same (homeXG, awayXG) as cupMarketOddsFromXG and every other
 * market on this fixture — call both from the same xG so they can never
 * disagree. `numSims` is exposed only for tests (cross-checking against the
 * closed form at lower run counts); production callers should always use the
 * default.
 */
export function cupSpecialMarketOddsFromXG(
  homeXG: number,
  awayXG: number,
  numSims: number = CUP_SIMULATION_RUNS
): CupSpecialMarketOdds & { diagnostics: ReturnType<typeof simulateCupMatch> } {
  const sim = simulateCupMatch(homeXG, awayXG, numSims)
  const halftimeModel = toOdds(sim.pHomeHtLeadAndAdvance)
  const comebackModel = toOdds(sim.pAwayEverLedAndHomeAdvances)
  const shootoutModel = toOdds(sim.pShootoutAndHomeAdvances)

  return {
    cup_decision_regulation: toOdds(sim.pDecidedIn90),
    cup_decision_shootout: toOdds(sim.pDecidedInShootout),
    cup_halftime_lead_advance_yes: roundCupSpecialYesOdds('halftime'),
    cup_halftime_lead_advance_no: toOdds(1 - sim.pHomeHtLeadAndAdvance),
    cup_comeback_advance_yes: roundCupSpecialYesOdds('comeback'),
    cup_comeback_advance_no: toOdds(1 - sim.pAwayEverLedAndHomeAdvances),
    cup_shootout_advance_yes: roundCupSpecialYesOdds('shootout'),
    cup_shootout_advance_no: toOdds(1 - sim.pShootoutAndHomeAdvances),
    cup_halftime_lead_advance_yes_model: halftimeModel,
    cup_comeback_advance_yes_model: comebackModel,
    cup_shootout_advance_yes_model: shootoutModel,
    diagnostics: sim,
  }
}

// ---------- Round-6 cup specials: Frühes Tor / Mehr Tore je Halbzeit / BTTS beide HZ ----------

export interface CupRound6MarketOdds {
  cup_early_goal_yes: number
  cup_early_goal_no: number
  cup_early_goal_yes_model: number
  cup_ht_more_goals_h1: number
  cup_ht_more_goals_h2: number
  cup_ht_more_goals_equal: number
  cup_both_halves_btts_yes: number
  cup_both_halves_btts_yes_model: number
}

/**
 * Deliberate commercial rounding for the round-6 "Frühes Tor" and "Beide
 * Teams in beiden Halbzeiten" Ja-only props — same product pattern as
 * roundCupSpecialYesOdds above (manually reasoned per-market, not a generic
 * ladder). "Mehr Tore je Halbzeit" is a genuine 3-way market (no natural
 * short-priced favourite to round away), so it's left at the model's own
 * (rounded-to-cent) price like the main 1X2/O-U markets.
 */
function roundCupRound6YesOdds(field: 'early_goal' | 'both_halves_btts', modelOdds: number): number {
  switch (field) {
    // Model odds are short (this match's early-goal probability is >50% at
    // the recalibrated, higher-scoring xG) — round to the nearest 0.05, same
    // granularity as the main markets, instead of the coarser 0.50 step used
    // for the other (long-shot) round-6/round-2 specials below, which would
    // move the price too far from fair for a >50%-likely outcome.
    case 'early_goal': return Math.round(modelOdds * 20) / 20
    // Model is long (needs both teams to score in BOTH halves) — round to a
    // clean whole/half number near the model value, same spirit as
    // "Elfmeterschießen & Weiter" above (negligible move, keep the margin).
    case 'both_halves_btts': return Math.round(modelOdds * 2) / 2
  }
}

/**
 * The 3 round-6 cup specials, derived from the SAME Monte Carlo simulation
 * (lib/cupSimulation.ts) and the SAME (homeXG, awayXG) as every other cup
 * market — see cupSpecialMarketOddsFromXG's own doc for why a full match
 * simulation (not closed-form) is needed for path-dependent events. Callers
 * should call this together with cupSpecialMarketOddsFromXG using ONE shared
 * `simulateCupMatch` result where possible to avoid running the simulation
 * twice; a separate export is used here so cupSpecialMarketOddsFromXG's own
 * return shape (kept stable for existing callers) doesn't need to change.
 */
export function cupRound6MarketOddsFromSim(sim: ReturnType<typeof simulateCupMatch>): CupRound6MarketOdds {
  const earlyGoalModel = toOdds(sim.pEarlyGoal)
  const earlyGoalNoModel = toOdds(1 - sim.pEarlyGoal)
  const bothHalvesModel = toOdds(sim.pBttsInBothHalves)
  return {
    cup_early_goal_yes: roundCupRound6YesOdds('early_goal', earlyGoalModel),
    cup_early_goal_no: roundCupRound6YesOdds('early_goal', earlyGoalNoModel),
    cup_early_goal_yes_model: earlyGoalModel,
    cup_ht_more_goals_h1: toOdds(sim.pMoreGoalsFirstHalf),
    cup_ht_more_goals_h2: toOdds(sim.pMoreGoalsSecondHalf),
    cup_ht_more_goals_equal: toOdds(sim.pEqualGoalsPerHalf),
    cup_both_halves_btts_yes: roundCupRound6YesOdds('both_halves_btts', bothHalvesModel),
    cup_both_halves_btts_yes_model: bothHalvesModel,
  }
}

export function mergeExactScoreOffers(
  autoOdds: Record<string, number> | null | undefined,
  overrides: Record<string, number> | null | undefined,
): { score: string; odds: number }[] {
  const scores = new Set([...Object.keys(autoOdds ?? {}), ...Object.keys(overrides ?? {})])
  const results: { score: string; odds: number; total: number; homeGoals: number; awayGoals: number }[] = []
  for (const score of scores) {
    const overrideVal = overrides?.[score]
    const autoVal = autoOdds?.[score]
    const finalOdds = overrideVal != null ? Number(overrideVal) : (autoVal != null ? Number(autoVal) : null)
    if (finalOdds == null || finalOdds > MAX_EXACT_ODDS) continue
    const [hg, ag] = score.split(':').map(Number)
    if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue
    results.push({ score, odds: finalOdds, total: hg + ag, homeGoals: hg, awayGoals: ag })
  }
  results.sort((a, b) =>
    a.odds - b.odds || a.total - b.total || a.homeGoals - b.homeGoals || a.awayGoals - b.awayGoals
  )
  return results.map(({ score, odds }) => ({ score, odds }))
}
