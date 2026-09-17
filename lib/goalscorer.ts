import type { Match } from '@/types'
import { getMatchXG, type PriorContext } from '@/lib/odds'

/**
 * Goalscorer odds for Wildenroth players.
 *
 * TWO LEVELS, strictly separated:
 *
 *   A) TEAM — `teamMatchXG` comes from the main model (lib/odds.ts#getMatchXG),
 *      read-only. It is the same number that prices 1X2, O/U, BTTS, handicap and
 *      exact score for that fixture, including any match_odds_overrides xG
 *      correction. Opponent strength, venue, league, form, prior season and the
 *      roster factor are ALL already inside it.
 *
 *   B) PLAYERS — this file only decides HOW THAT xG IS SPLIT. Player features
 *      produce relative weights; the weights become shares; the shares divide
 *      teamMatchXG. Nothing here re-estimates how many goals the team scores.
 *
 * Why it matters: the previous version computed every player independently as
 * `per90 × minutes/90 × (teamXG / leagueBaseline)` and let the results land
 * where they may. They landed at roughly TWICE the team's own xG — Wildenroth I
 * vs Oberweikertshofen II: team xG 2.04, sum of offered player xG 4.28 — because
 * nothing ever tied the parts to the whole. On top of that the projected minutes
 * summed to 1316 for a match that has 900 outfield minutes in it, since each
 * player was given his personal average as if the whole squad played at once.
 * Both errors pushed player odds too short.
 *
 * It also means opponent strength enters EXACTLY ONCE, through teamMatchXG.
 * Never multiply a second opponent/matchup factor onto a player — that is the
 * same information twice.
 */

// Raising this lowers every offered goalscorer odds by the SAME proportional
// factor (toOdds = 1/(p*(1+margin))) — ratios between players are completely
// unaffected, only the overall price level. Deliberately NOT touched while the
// probability model was being fixed: margin is a pricing decision, not a repair
// mechanism for a miscalibrated probability.
const HOUSE_MARGIN = 0.15
const MIN_ODDS = 1.20
const MAX_ODDS = 30.0

// Bayesian shrinkage of per-90 goal rate toward a position-based prior.
const PRIOR_GAMES = 5

// How much weight last season's sample keeps once current-season data exists,
// as a fraction of last season's own game count — mirrors lib/odds.ts's team-level
// PRIOR_WEIGHT pattern. Was previously a hard cutover (sampleOf picked
// EITHER this season OR last season, never both), which meant a single quiet
// substitute appearance could wipe out a strong prior season overnight (e.g. a
// proven 29-goal striker cameo'ing for 19 scoreless minutes would crash straight
// to the position-prior floor), while a player with zero current-season minutes
// kept 100% of last season's credibility with no discount at all for currently
// not featuring. Blending avoids both: a small current sample only nudges the
// season-long rate, and an unplayed player's prior season counts at half weight.
const PRIOR_SEASON_WEIGHT = 0.5

// A match has ten outfield players on the pitch for ninety minutes. That is a
// hard fact about football, not a modelling assumption, so the squad's projected
// minutes are normalized to it. The uncertainty about WHO plays is not lost by
// doing this — it lives in each player's P(plays), which spreads the budget over
// more players than will actually appear. Goalkeepers are excluded throughout
// (they are never offered), so this is the outfield budget only.
const OUTFIELD_MINUTES_PER_MATCH = 10 * 90
const MAX_MINUTES_PER_PLAYER = 90

// Share of team xG withheld from the player pool for goals that cannot be
// credited to a Wildenroth player — own goals by the opponent, essentially.
// DERIVED, NOT CHOSEN: across all recorded Wildenroth fixtures this season
// (I: 7 matches / 15 goals, II: 2 matches / 4 goals) every single goal was
// attributed to a named, active outfield player and match_goalscorers holds
// zero own goals. There is therefore no evidence for a residual and inventing
// one would just shorten every player's odds for no reason. Re-check this
// against match_goalscorers.is_own_goal once a season or two has accumulated;
// if own goals turn out to be ~2% of the team's goals, set this to 0.02.
const OWN_GOAL_SHARE = 0

// Set-piece and preseason bumps. These used to be ADDITIVE to a player's xG
// (+0.06 / +0.03 / +0.02 per friendly goal). Additive no longer works: the
// player xG values must sum to the team's xG, so an additive bump would either
// break that identity or silently steal xG from team-mates in an unstated way.
// They are now multiplicative on the player's WEIGHT, i.e. they change his share
// of the team's goals rather than the team's total. The values are the old
// additive bumps expressed relative to a typical offered player's xG (~0.28), so
// a penalty taker gains about as much relative to his team-mates as before:
// 0.06/0.28 ≈ 21%, 0.03/0.28 ≈ 11%, 0.02/0.28 ≈ 7% per friendly goal.
const PENALTY_TAKER_WEIGHT_BUMP = 0.21
const FREEKICK_TAKER_WEIGHT_BUMP = 0.11
const FRIENDLY_GOAL_WEIGHT_BUMP = 0.07
const FRIENDLY_WEIGHT_BUMP_CAP = 0.50

// A player flagged `questionable` for this match still might play. Halving his
// appearance probability is the honest reading of "doubtful" and it
// automatically redistributes his share to team-mates who are fit.
const QUESTIONABLE_PLAY_FACTOR = 0.5

// A `squad='both'` player when BOTH Wildenroth sides play at (nearly) the same
// time: he can only appear for one of them. This is a PROJECTION adjustment, not
// a second locking mechanism — the existing double-fixture lock in
// app/(app)/tipps/page.tsx handles the different case of ONE side playing twice
// in a week by keeping the later match's whole Torschützen tab closed. That lock
// does not fire when team I and team II play in parallel, which is exactly when
// this factor applies. Without a per-player history of which side he turns out
// for, an even split is the only defensible value.
const BOTH_SQUAD_SPLIT = 0.5

// Filtering thresholds. Unchanged in value, but note that projected minutes are
// now normalized to the real 900-minute budget, so the same 25 is a stricter
// test than it used to be against the old (inflated, ~1300-minute) projections.
// That is intended: it was only ever meant to mean "plays a decent share of the
// match", and it now actually does.
const MIN_PROJ_MINUTES = 25
const MIN_PROB_SCORE = 0.06
const MIN_PROB_SCORE_2PLUS = 0.05

export type WildenrothPlayer = {
  id: number
  name: string
  position: 'Torwart' | 'Abwehr' | 'Mittelfeld' | 'Angriff' | null
  /** Appearances (not squad matches) and total minutes in those appearances. */
  games: number
  minutes: number
  goals: number
  assists: number
  is_goalkeeper: boolean
  is_penalty_taker: boolean
  is_freekick_taker: boolean
  active: boolean
  /** '1' | '2' | 'both' — which Wildenroth side(s) this player belongs to. */
  squad?: string | null
  /** Last completed season. Used as the sample while the current season has no
   *  data — without this the market is dead by construction on matchday 1 of
   *  every season, since `games`/`minutes` are reset to 0 at the season roll. */
  prev_games?: number | null
  prev_minutes?: number | null
  prev_goals?: number | null
  friendly_goals?: number | null
}

/** Weighted average of a current-season stat with a down-weighted prior-season
 *  stat. `priorN` should already have PRIOR_SEASON_WEIGHT applied by the caller. */
function blendWithPrior(
  current: { avg: number; n: number },
  priorAvg: number,
  priorN: number
): { avg: number; n: number } {
  if (priorN === 0) return current
  if (current.n === 0) return { avg: priorAvg, n: priorN }
  const totalN = current.n + priorN
  return { avg: (current.n * current.avg + priorN * priorAvg) / totalN, n: totalN }
}

export type GoalscorerOffer = {
  player_id: number
  player_name: string
  position: string | null
  prob_score: number
  prob_score_2plus: number
  odds_score: number
  odds_score_2plus: number
  is_offered: boolean
  is_offered_2plus: boolean
  /** Everything behind the number, so the admin preview and any future
   *  "Warum diese Quote?" view can show the derivation instead of re-deriving
   *  it. Costs nothing to return — it is all computed anyway. */
  diagnostics: GoalscorerPlayerDiagnostics
}

/** What the member-facing page needs. Rows read back from
 *  `match_goalscorer_odds` carry the frozen price only — the model diagnostics
 *  are not persisted, so display code must not require them. */
export type GoalscorerDisplayOffer = Omit<GoalscorerOffer, 'diagnostics'>

export type GoalscorerPlayerDiagnostics = {
  /** P(this player appears at all in this match). */
  pPlays: number
  /** E[minutes | he appears]. */
  minutesIfPlaying: number
  /** pPlays × minutesIfPlaying, after normalizing the squad to 900 minutes. */
  projectedMinutes: number
  /** Bayesian-shrunk goals per 90. */
  goalsPer90: number
  /** Relative scoring weight before normalization. */
  rawWeight: number
  /** rawWeight / Σ rawWeight — this player's slice of the team's goals. */
  share: number
  /** teamMatchXG × (1 − OWN_GOAL_SHARE) × share. */
  playerXG: number
  /** Why he is not in the pool at all, if he isn't. */
  excluded: 'goalkeeper' | 'inactive' | 'blocked' | null
}

export type GoalscorerSquadResult = {
  offers: GoalscorerOffer[]
  /** The team xG this squad's shares were divided out of. */
  teamMatchXG: number
  /** Σ playerXG over every eligible player — equals teamMatchXG × (1 − OWN_GOAL_SHARE). */
  allocatedXG: number
  /** Σ playerXG over the players actually OFFERED. The gap to allocatedXG is the
   *  fringe/squad-player residual: real expected goals that belong to players
   *  nobody is offered a price on. Not invented — it falls out of the split. */
  offeredXG: number
  /** teamMatchXG − allocatedXG, i.e. the own-goal reserve (currently 0). */
  unallocatedXG: number
  /** Σ projectedMinutes over the eligible pool. Equals OUTFIELD_MINUTES_PER_MATCH
   *  unless the squad has no usable history at all. */
  projectedMinutesTotal: number
}

function clamp(odds: number): number {
  return Math.max(MIN_ODDS, Math.min(MAX_ODDS, odds))
}

function toOdds(prob: number): number {
  if (prob <= 0) return MAX_ODDS
  return Math.round((1 / (prob * (1 + HOUSE_MARGIN))) * 100) / 100
}

function positionPrior(position: string | null): number {
  switch (position) {
    case 'Angriff':    return 0.35
    case 'Mittelfeld': return 0.15
    case 'Abwehr':     return 0.05
    default:           return 0.08
  }
}

function bayesianGoalsPer90(player: WildenrothPlayer): number {
  const positionPriorRate = positionPrior(player.position)

  const currentMinutes = player.minutes ?? 0
  const currentN = currentMinutes / 90
  const currentPer90 = currentMinutes > 0 ? (player.goals / currentMinutes) * 90 : 0

  const prevMinutes = player.prev_minutes ?? 0
  const prevN = (prevMinutes / 90) * PRIOR_SEASON_WEIGHT
  const prevPer90 = prevMinutes > 0 ? ((player.prev_goals ?? 0) / prevMinutes) * 90 : 0

  const blended = blendWithPrior({ avg: currentPer90, n: currentN }, prevPer90, prevN)
  if (blended.n === 0) return positionPriorRate

  return (blended.n * blended.avg + PRIOR_GAMES * positionPriorRate) / (blended.n + PRIOR_GAMES)
}

/**
 * How many matches this squad actually has player data for. NOT the number of
 * matches the team played: `wildenroth_players.games` only counts appearances
 * the admin has entered, so dividing by the team's real fixture count would
 * make everyone look like a rotation player. Taking the squad maximum
 * self-calibrates — whoever played every recorded match defines "all of them".
 */
function squadRecordedGames(players: WildenrothPlayer[]) {
  return {
    current: Math.max(0, ...players.map((p) => p.games ?? 0)),
    prior: Math.max(0, ...players.map((p) => p.prev_games ?? 0)),
  }
}

export interface GoalscorerMatchContext {
  /** Players an admin has explicitly made unavailable for THIS match
   *  (match_goalscorer_odds.status of injured/missing/not_bettable, or a
   *  manual block). Removed from the pool entirely, so their share goes to
   *  the players who can actually play rather than evaporating. */
  blockedPlayerIds?: ReadonlySet<number>
  /** status = 'questionable' — halved appearance probability, not excluded. */
  questionablePlayerIds?: ReadonlySet<number>
  /** True when the other Wildenroth side plays at nearly the same time, so a
   *  `squad='both'` player cannot feature for both. See BOTH_SQUAD_SPLIT. */
  bothSquadConflict?: boolean
}

interface Projection {
  player: WildenrothPlayer
  excluded: GoalscorerPlayerDiagnostics['excluded']
  pPlays: number
  minutesIfPlaying: number
  rawMinutes: number
  goalsPer90: number
  rawWeight: number
}

function project(
  players: WildenrothPlayer[],
  ctx: GoalscorerMatchContext
): Projection[] {
  const recorded = squadRecordedGames(players)

  return players.map((player): Projection => {
    const excluded: GoalscorerPlayerDiagnostics['excluded'] =
      player.is_goalkeeper ? 'goalkeeper'
      : !player.active ? 'inactive'
      : ctx.blockedPlayerIds?.has(player.id) ? 'blocked'
      : null

    if (excluded) {
      return { player, excluded, pPlays: 0, minutesIfPlaying: 0, rawMinutes: 0, goalsPer90: 0, rawWeight: 0 }
    }

    // P(appears). Appearance rate this season blended with last season's, the
    // same prior weighting every other estimate in this file uses.
    const curRate = recorded.current > 0 ? Math.min(1, (player.games ?? 0) / recorded.current) : 0
    const priorRate = recorded.prior > 0 ? Math.min(1, (player.prev_games ?? 0) / recorded.prior) : 0
    const blendedPlays = blendWithPrior(
      { avg: curRate, n: recorded.current },
      priorRate,
      recorded.prior * PRIOR_SEASON_WEIGHT
    )
    let pPlays = blendedPlays.n > 0 ? blendedPlays.avg : 0

    if (ctx.questionablePlayerIds?.has(player.id)) pPlays *= QUESTIONABLE_PLAY_FACTOR
    if (ctx.bothSquadConflict && player.squad === 'both') pPlays *= BOTH_SQUAD_SPLIT

    // E[minutes | appears]. The sample size here is the player's OWN appearance
    // count, not the squad's — "how long do I last when I'm picked".
    const curGames = player.games ?? 0
    const curMinutesPerApp = curGames > 0 ? (player.minutes ?? 0) / curGames : 0
    const priorGames = player.prev_games ?? 0
    const priorMinutesPerApp = priorGames > 0 ? (player.prev_minutes ?? 0) / priorGames : 0
    const blendedMinutes = blendWithPrior(
      { avg: curMinutesPerApp, n: curGames },
      priorMinutesPerApp,
      priorGames * PRIOR_SEASON_WEIGHT
    )
    const minutesIfPlaying = blendedMinutes.n > 0 ? Math.min(90, blendedMinutes.avg) : 0

    const goalsPer90 = bayesianGoalsPer90(player)

    let bump = 1
    if (player.is_penalty_taker) bump += PENALTY_TAKER_WEIGHT_BUMP
    if (player.is_freekick_taker) bump += FREEKICK_TAKER_WEIGHT_BUMP
    bump += Math.min(FRIENDLY_WEIGHT_BUMP_CAP, (player.friendly_goals ?? 0) * FRIENDLY_GOAL_WEIGHT_BUMP)

    return {
      player, excluded: null,
      pPlays,
      minutesIfPlaying,
      rawMinutes: pPlays * minutesIfPlaying,
      goalsPer90,
      // Weight is filled in after the minute normalization below.
      rawWeight: bump,
    }
  })
}

/**
 * Distribute the 900-minute outfield budget in proportion to each player's
 * raw expected minutes, with a hard 90-minute ceiling per player.
 *
 * The ceiling is not cosmetic. When a squad's raw projection sums to LESS than
 * 900 — which happens whenever appearance probabilities are broadly low, e.g. a
 * squad with little recorded data — a plain rescale multiplies everyone up and
 * can hand a near-ever-present starter 95+ minutes, which is impossible.
 * Water-filling instead: scale, cap whoever spills over at 90, then re-share
 * the remaining budget among the players still below the cap, and repeat.
 *
 * If the pool is too small to absorb 900 minutes (fewer than ten eligible
 * players), everyone ends at 90 and the total falls short. That is the honest
 * outcome — the alternative would be inventing players.
 */
function allocateMinutes(raw: number[]): number[] {
  const out = new Array<number>(raw.length).fill(0)
  const capped = new Array<boolean>(raw.length).fill(false)
  let remaining = OUTFIELD_MINUTES_PER_MATCH

  // At most one pass per player: every pass caps at least one more of them.
  for (let pass = 0; pass <= raw.length; pass++) {
    let openTotal = 0
    for (let i = 0; i < raw.length; i++) if (!capped[i]) openTotal += raw[i]
    if (openTotal <= 0 || remaining <= 0) break

    const scale = remaining / openTotal
    let spilled = false
    for (let i = 0; i < raw.length; i++) {
      if (capped[i]) continue
      const want = raw[i] * scale
      if (want >= MAX_MINUTES_PER_PLAYER) {
        out[i] = MAX_MINUTES_PER_PLAYER
        capped[i] = true
        remaining -= MAX_MINUTES_PER_PLAYER
        spilled = true
      }
    }
    if (!spilled) {
      for (let i = 0; i < raw.length; i++) if (!capped[i]) out[i] = raw[i] * scale
      break
    }
  }
  return out
}

/**
 * Split one team's match xG across its squad.
 *
 * `teamMatchXG` must be the main model's xG for this fixture (see the file
 * header) — this function never estimates it.
 */
export function computeGoalscorerOffers(
  players: WildenrothPlayer[],
  teamMatchXG: number,
  ctx: GoalscorerMatchContext = {}
): GoalscorerSquadResult {
  const projections = project(players, ctx)

  // Normalize the squad's projected minutes onto the real 900-minute outfield
  // budget. This is what stops eleven players from each being handed their
  // personal 60-90 minute average as though they all played simultaneously.
  const projectedMinutes = allocateMinutes(projections.map((p) => p.rawMinutes))

  // Relative scoring weight: rate × share of the match × set-piece bumps.
  const weights = projections.map((p, i) => p.excluded ? 0 : p.goalsPer90 * (projectedMinutes[i] / 90) * p.rawWeight)
  const weightTotal = weights.reduce((s, w) => s + w, 0)

  const allocatable = teamMatchXG * (1 - OWN_GOAL_SHARE)

  let allocatedXG = 0
  let offeredXG = 0
  let projectedMinutesTotal = 0

  const offers = projections.map((p, i): GoalscorerOffer => {
    const share = weightTotal > 0 ? weights[i] / weightTotal : 0
    const playerXG = allocatable * share
    const projMin = projectedMinutes[i]

    allocatedXG += playerXG
    projectedMinutesTotal += projMin

    // Poisson: P(0 goals) = e^-λ; P(≥1) = 1 - e^-λ; P(≥2) = 1 - e^-λ(1+λ).
    const probScore = playerXG > 0 ? 1 - Math.exp(-playerXG) : 0
    const probScore2plus = playerXG > 0 ? 1 - Math.exp(-playerXG) * (1 + playerXG) : 0

    const isOffered = !p.excluded && projMin >= MIN_PROJ_MINUTES && probScore >= MIN_PROB_SCORE
    const isOffered2plus = isOffered && probScore2plus >= MIN_PROB_SCORE_2PLUS
    if (isOffered) offeredXG += playerXG

    return {
      player_id: p.player.id,
      player_name: p.player.name,
      position: p.player.position,
      prob_score: Math.round(probScore * 10000) / 10000,
      prob_score_2plus: Math.round(probScore2plus * 10000) / 10000,
      odds_score: clamp(toOdds(probScore)),
      odds_score_2plus: clamp(toOdds(probScore2plus)),
      is_offered: isOffered,
      is_offered_2plus: isOffered2plus,
      diagnostics: {
        pPlays: p.pPlays,
        minutesIfPlaying: p.minutesIfPlaying,
        projectedMinutes: projMin,
        goalsPer90: p.goalsPer90,
        rawWeight: weights[i],
        share,
        playerXG,
        excluded: p.excluded,
      },
    }
  })

  return {
    offers,
    teamMatchXG,
    allocatedXG,
    offeredXG,
    unallocatedXG: teamMatchXG - allocatedXG,
    projectedMinutesTotal,
  }
}

/**
 * Compute Wildenroth's match xG from the season fixtures — via the SAME
 * getMatchXG the 1X2/O-U/BTTS/handicap/exact-score markets use — and then split
 * it across the squad.
 *
 * `matches` must carry `match_category` and `competition_type`, i.e. come from
 * lib/oddsInputs.ts#loadOddsModelInputs. Without `match_category` getMatchXG
 * infers the wrong league tier and a Wildenroth II B-Klasse fixture gets priced
 * on Kreisliga goal levels (this was live in the admin recompute route and
 * produced a 5% xG error against the main market).
 */
export function computeGoalscorerOffersForMatch(
  matches: Match[],
  homeTeamId: number,
  awayTeamId: number,
  wildenrothTeamId: number,
  players: WildenrothPlayer[],
  priorCtx?: PriorContext,
  /** Match-specific (homeXG, awayXG) override — see lib/odds.ts
   *  `match_odds_overrides.model_home_xg_override`/`model_away_xg_override`.
   *  When given, used INSTEAD of getMatchXG's own output so a match-specific
   *  correction shifts the goalscorer market consistently with every other
   *  market on the same fixture. */
  xgOverride?: { homeXG: number; awayXG: number },
  ctx: GoalscorerMatchContext = {},
): GoalscorerSquadResult {
  // priorCtx must be passed: without it this xG skips prior-season blending and
  // the roster factor, so the goalscorer market would be derived from a
  // different team-strength estimate than the 1X2/O-U markets on the same card.
  const { homeXG: modelHomeXG, awayXG: modelAwayXG } =
    getMatchXG(matches, homeTeamId, awayTeamId, priorCtx)
  const homeXG = xgOverride?.homeXG ?? modelHomeXG
  const awayXG = xgOverride?.awayXG ?? modelAwayXG
  const teamMatchXG = homeTeamId === wildenrothTeamId ? homeXG : awayXG
  return computeGoalscorerOffers(players, teamMatchXG, ctx)
}
