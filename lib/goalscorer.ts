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
// Back to 30 — the level Spieltag 1-7 was priced at. See the PRICING LAYER
// below: 30 is the ASYMPTOTE the compression approaches, never a value it
// reaches, so nothing piles up on it.
const MAX_ODDS = 30.0

// ---------- PRICING LAYER ----------
//
// Separate from the probability model on purpose. `prob_score` and `playerXG`
// are the model's honest output and are stored and diagnosed unchanged; this
// only decides how the fair price derived from them is PRESENTED.
//
// Why it exists: once every outfield player is offered, the fair prices run to
// 458/1 (George Condor, 0.19 %). Spieltag 1-7 never showed anything above 30
// only because the old model hid those players entirely. Offering them at the
// raw fair price would make Spieltag 8 read as a different product — the
// measured Wildenroth I preview had a median of 63.5 against a historical 10.3,
// and 15 of 21 players above 30.
//
// A plain `min(raw, 30)` is exactly what must NOT happen: it would hand a
// 32/1 player and a 458/1 player the identical price and destroy the
// differentiation the corrected model just earned.
//
// The function used instead:
//
//     o(r) = r                                        for r ≤ T
//     o(r) = CAP − D / (1 + (r − T)/D),  D = CAP − T,  for r > T
//
// Properties, all of which are asserted in scripts/goalscorer-check.ts:
//   - identity below T: the favourites keep their price to the cent
//   - C¹ at r = T: both branches meet at value T and slope 1, so no kink
//   - strictly increasing everywhere: player order can never flip
//   - asymptotic to CAP from below, never reaching it: no pile-up
//   - o(r) ≤ r always, so compression can only shorten a price — it can never
//     create a positive-EV bet
//
// T = 6 because the five players a Wildenroth card actually revolves around
// price between 1.6 and 5.8; T = 6 leaves every one of them untouched and
// starts compressing immediately after. The upper branch decays like 1/x rather
// than exp(−x) deliberately: an exponential branch is within 0.5 of the cap from
// raw ≈ 100 onward, which re-creates the pile-up one step further out (raw 311
// and raw 458 would both price at 30.00). The harmonic branch still separates
// them — 28.25 against 28.79.
const PRICE_COMPRESSION_START = 6.0

/** Raw fair odds → offered odds. See the PRICING LAYER block above. */
export function compressOdds(raw: number, cap = MAX_ODDS, start = PRICE_COMPRESSION_START): number {
  if (!Number.isFinite(raw)) return cap
  if (raw <= start) return raw
  const d = cap - start
  return cap - d / (1 + (raw - start) / d)
}

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

// Floors on P(plays). Two levels, because being OFFERED and being NAMED IN THE
// MATCHDAY SQUAD are different statements.
//
// The market opens with the whole active squad and the admin removes players
// afterwards once the real squad is known. Anyone still in the list is therefore
// a candidate, and a candidate must not price at exactly zero: a player with no
// recorded appearances (a new signing, or someone whose games predate the
// records) otherwise came out at P(plays) = 0 → xG 0 → probability 0 → the
// maximum price, which is a dead offer rather than a long shot. His real chance
// is small but certainly not nil.
const OFFERED_MIN_PLAY_PROB = 0.05

// Expected number of DIFFERENT outfield players used in a match: ten start and
// roughly five more come on over ninety minutes. The raw appearance rates are
// scaled so that Σ P(plays) lands near this — they otherwise miss it badly
// (measured 10.6 for the Wildenroth I pool, 13.4 for II), i.e. the projection
// implicitly expected fewer players to feature than really do.
//
// A PRIOR on the squad total, not a selection: nobody is forced to zero and
// nobody is forced in, every candidate stays offered. It also moves no odds —
// the minute budget is `pPlays × minutesIfPlaying` renormalized to 900, and that
// renormalization is invariant to scaling every pPlays by the same factor. It
// corrects what the diagnostics say about rotation without repricing anybody.
const EXPECTED_OUTFIELD_PLAYERS_USED = 15
//
// Once the concrete matchday squad IS confirmed, being named in it beats any
// statistical appearance rate, and the floor rises to "named but might not come
// on". Regulars stay far above both floors — these only lift the bottom.
const SQUAD_MEMBER_MIN_PLAY_PROB = 0.4

// OFFERING RULE (product decision, not a modelling one): every outfield player
// in the matchday squad is bettable as a goalscorer. Scoring probability sets
// the PRICE, never whether a player appears at all. The old probability/minute
// thresholds are therefore gone from the scorer market — they were filtering out
// exactly the long shots this market is fun for, and once the probabilities were
// corrected downward they would have cut the offer from 15 players to 5.
//
// Who is offered: active, not a goalkeeper, not blocked for this match.
// Who is not: goalkeepers, and anyone an admin marked as outside the squad /
// injured / missing / not bettable (see lib/goalscorerContext.ts).
//
// The 2+ goals market keeps a threshold: it is a separate, much longer market
// and a 0.2% "scores twice" price is noise rather than a bet.
const MIN_PROB_SCORE_2PLUS = 0.05

// Cross-team history is weaker evidence than history with the team actually
// playing, even after being converted onto its goal level: different opposition,
// different role, different team-mates.
const CROSS_TEAM_WEIGHT = 0.5

// Shrinkage of "minutes per appearance" toward the squad's own average, in
// pseudo-appearances. Team I's FuPa minutes are complete and exact, so barely
// any shrinkage. Team II's are approximate — substitutions back on are not
// maintained there — so a single 39-minute reading must not be treated as a
// precise fact (`wildenroth_player_team_stats.minutes_reliable`).
const MINUTES_PRIOR_APPS_RELIABLE = 0.5
const MINUTES_PRIOR_APPS_UNRELIABLE = 3

/** One team's slice of a player's current season — see
 *  `wildenroth_player_team_stats`. A `squad='both'` player has one of these per
 *  Wildenroth side and they must never be pooled: a B-Klasse appearance is not
 *  Kreisliga minutes, and a B-Klasse scoring rate is not a Kreisliga one. */
export type TeamStats = {
  games: number
  minutes: number
  goals: number
  /** Team matches this snapshot covers — makes a stale snapshot visible. */
  asOfMatches: number
  /** False for Wildenroth II, whose FuPa minutes are approximate. */
  minutesReliable: boolean
}

export type WildenrothPlayer = {
  id: number
  name: string
  position: 'Torwart' | 'Abwehr' | 'Mittelfeld' | 'Angriff' | null
  /** CLUB-WIDE current season (both teams pooled). Kept only as the fallback
   *  for a player with no per-team row yet; `teamStats` takes precedence. */
  games: number
  minutes: number
  goals: number
  assists: number
  /** This fixture's team. Preferred source for everything current-season. */
  teamStats?: TeamStats | null
  /** The OTHER Wildenroth side. Prior/fallback only, and converted onto this
   *  team's goal level first (see `crossTeamScale`). */
  otherTeamStats?: TeamStats | null
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
  /** Fair odds straight from `playerXG`, BEFORE the pricing compression —
   *  stored so the offered price stays auditable against the model. */
  fairOddsScore: number
  fairOddsScore2plus: number
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

/** Fair odds from a probability — the model's own number, before pricing. */
function fairOdds(prob: number): number {
  return prob > 0 ? 1 / (prob * (1 + HOUSE_MARGIN)) : Infinity
}

/** The price actually offered: fair odds put through the compression above and
 *  rounded to two decimals. Rounding is the LAST step so the result is a
 *  continuous decimal (8.37, 13.62, 21.48…) rather than a bucket. */
function toOdds(prob: number): number {
  return Math.round(compressOdds(fairOdds(prob)) * 100) / 100
}

function positionPrior(position: string | null): number {
  switch (position) {
    case 'Angriff':    return 0.35
    case 'Mittelfeld': return 0.15
    case 'Abwehr':     return 0.05
    default:           return 0.08
  }
}

/**
 * Converts a scoring rate achieved with the OTHER Wildenroth side onto this
 * team's scale: a player who scored at a given rate in a team that scores 2.0
 * goals a game is, relative to his team-mates, the same player in a team that
 * scores 1.5 — his absolute rate just has to be restated.
 *
 * This is NOT "the B-Klasse is easier, so scale it down". That would be the
 * double-count the brief warns about, because the fixture's own goal level is
 * already inside teamMatchXG and the weights are normalized to shares anyway.
 * It is only about making two samples comparable BEFORE they are blended —
 * without it, a B-Klasse goals/90 would outvote a Kreisliga one purely because
 * more goals get scored in the B-Klasse.
 */
function crossTeamScale(ctx: GoalscorerMatchContext): number {
  const here = ctx.teamGoalsPerMatch
  const there = ctx.otherTeamGoalsPerMatch
  if (!here || !there || there <= 0) return 1
  return here / there
}

/**
 * Bayesian goals per 90, built from three samples in decreasing order of
 * relevance: this team this season, the other team this season (converted and
 * down-weighted), last season club-wide. Shrunk toward a position prior.
 */
function bayesianGoalsPer90(player: WildenrothPlayer, ctx: GoalscorerMatchContext): number {
  const positionPriorRate = positionPrior(player.position)

  // 1) This team, this season — the authoritative sample when it exists.
  const own = player.teamStats
  const currentMinutes = own ? own.minutes : (player.minutes ?? 0)
  const currentGoals = own ? own.goals : (player.goals ?? 0)
  const currentN = currentMinutes / 90
  const currentPer90 = currentMinutes > 0 ? (currentGoals / currentMinutes) * 90 : 0

  let blended = { avg: currentPer90, n: currentN }

  // 2) The other Wildenroth side, this season — restated onto this team's goal
  //    level and counted at CROSS_TEAM_WEIGHT.
  const other = player.otherTeamStats
  if (other && other.minutes > 0) {
    const otherPer90 = (other.goals / other.minutes) * 90 * crossTeamScale(ctx)
    blended = blendWithPrior(blended, otherPer90, (other.minutes / 90) * CROSS_TEAM_WEIGHT)
  }

  // 3) Last season, club-wide. `wildenroth_players.prev_*` has no team split, so
  //    it cannot be restated per team — it is used as-is at half weight and is
  //    a documented limitation, not an oversight.
  const prevMinutes = player.prev_minutes ?? 0
  if (prevMinutes > 0) {
    const prevPer90 = ((player.prev_goals ?? 0) / prevMinutes) * 90
    blended = blendWithPrior(blended, prevPer90, (prevMinutes / 90) * PRIOR_SEASON_WEIGHT)
  }

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
  // `asOfMatches` is authoritative when present: it says how many matches the
  // snapshot covers, so a squad where nobody played every game still gets the
  // right denominator. The squad maximum is the fallback.
  const asOf = Math.max(0, ...players.map((p) => p.teamStats?.asOfMatches ?? 0))
  const maxGames = Math.max(0, ...players.map((p) => p.teamStats?.games ?? p.games ?? 0))
  return {
    current: asOf > 0 ? asOf : maxGames,
    prior: Math.max(0, ...players.map((p) => p.prev_games ?? 0)),
  }
}

/** Average minutes per appearance across everyone in the squad who has played.
 *  The shrinkage target for an individual player's appearance length. */
function squadMeanMinutes(players: WildenrothPlayer[]): number {
  let minutes = 0, apps = 0
  for (const p of players) {
    if (p.is_goalkeeper) continue
    const st = p.teamStats
    minutes += st ? st.minutes : (p.minutes ?? 0)
    apps += st ? st.games : (p.games ?? 0)
  }
  return apps > 0 ? minutes / apps : 0
}

export interface GoalscorerMatchContext {
  /** Goals per match this team has scored in its own league this season, and
   *  the same for the other Wildenroth side. Used ONLY to put a cross-team
   *  scoring rate on a comparable scale before blending — see `crossTeamScale`.
   *  Not a goal-level adjustment: the fixture's goal level lives entirely in
   *  teamMatchXG, and the weights are normalized to shares afterwards, so this
   *  cannot double-count the B-Klasse being a higher-scoring league. */
  teamGoalsPerMatch?: number
  otherTeamGoalsPerMatch?: number
  /** Players an admin has explicitly made unavailable for THIS match
   *  (match_goalscorer_odds.status of injured/missing/not_bettable, or a
   *  manual block). Removed from the pool entirely, so their share goes to
   *  the players who can actually play rather than evaporating. */
  blockedPlayerIds?: ReadonlySet<number>
  /** status = 'questionable' — halved appearance probability, not excluded. */
  questionablePlayerIds?: ReadonlySet<number>
  /** True when the other Wildenroth side plays at nearly the same time, so a
   *  `squad='both'` player cannot feature for both. See BOTH_SQUAD_SPLIT.
   *  Statistical fallback only — once the squad is confirmed, being in it (or
   *  not) settles the question and this stops mattering. */
  bothSquadConflict?: boolean
  /** `matches.goalscorer_squad_confirmed_at` is set: the players still in the
   *  pool ARE the matchday squad. Raises the P(plays) floor to
   *  SQUAD_MEMBER_MIN_PLAY_PROB and turns off the parallel-fixture guess,
   *  because the squad already answers it. Optional — the market does not wait
   *  for it; the admin removes non-squad players as they become known. */
  squadConfirmed?: boolean
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

/** Scale appearance probabilities so they sum to `target`, each capped at 1 —
 *  they are probabilities, not rates. Water-filled like the minute budget:
 *  scale, cap whoever spills past 1, re-share the rest among the others. If the
 *  pool is too small to reach the target everyone ends at 1 and the sum falls
 *  short, which is the honest outcome rather than an invented player. */
function scalePlayProbabilities(raw: number[], target: number): number[] {
  const out = [...raw]
  const capped = new Array<boolean>(raw.length).fill(false)
  let remaining = target

  for (let pass = 0; pass <= raw.length; pass++) {
    let openTotal = 0
    for (let i = 0; i < raw.length; i++) if (!capped[i]) openTotal += raw[i]
    if (openTotal <= 0 || remaining <= 0) break

    const scale = remaining / openTotal
    let spilled = false
    for (let i = 0; i < raw.length; i++) {
      if (capped[i] || raw[i] * scale < 1) continue
      out[i] = 1
      capped[i] = true
      remaining -= 1
      spilled = true
    }
    if (!spilled) {
      for (let i = 0; i < raw.length; i++) if (!capped[i]) out[i] = raw[i] * scale
      break
    }
  }
  return out
}

function project(
  players: WildenrothPlayer[],
  ctx: GoalscorerMatchContext
): Projection[] {
  const recorded = squadRecordedGames(players)
  const squadMeanMinutesPerApp = squadMeanMinutes(players)

  const projections: Projection[] = players.map((player): Projection => {
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
    const own = player.teamStats
    const curRate = recorded.current > 0 ? Math.min(1, (own ? own.games : (player.games ?? 0)) / recorded.current) : 0
    const priorRate = recorded.prior > 0 ? Math.min(1, (player.prev_games ?? 0) / recorded.prior) : 0
    const blendedPlays = blendWithPrior(
      { avg: curRate, n: recorded.current },
      priorRate,
      recorded.prior * PRIOR_SEASON_WEIGHT
    )
    // Raw appearance propensity only. Scaling to the squad total and the floors
    // both need the whole squad, so they happen in the second pass below.
    const rawPlays = blendedPlays.n > 0 ? blendedPlays.avg : 0

    // E[minutes | appears]. Sample size is the player's OWN appearance count,
    // not the squad's — "how long do I last when I'm picked" — and it comes from
    // THIS team's record when we have one.
    const curGames = own ? own.games : (player.games ?? 0)
    const curMinutes = own ? own.minutes : (player.minutes ?? 0)
    const curMinutesPerApp = curGames > 0 ? curMinutes / curGames : 0
    const priorGames = player.prev_games ?? 0
    const priorMinutesPerApp = priorGames > 0 ? (player.prev_minutes ?? 0) / priorGames : 0
    let blendedMinutes = blendWithPrior(
      { avg: curMinutesPerApp, n: curGames },
      priorMinutesPerApp,
      priorGames * PRIOR_SEASON_WEIGHT
    )
    // Where the recorded minutes are only approximate (Wildenroth II), shrink
    // toward the squad's average appearance length so a single unreliable
    // reading cannot drive the projection. A 39-minute FuPa entry for team II
    // means "came on at some point", not "played exactly 39 minutes".
    const minutesPrior = own && !own.minutesReliable
      ? MINUTES_PRIOR_APPS_UNRELIABLE
      : MINUTES_PRIOR_APPS_RELIABLE
    if (squadMeanMinutesPerApp > 0) {
      blendedMinutes = blendWithPrior(blendedMinutes, squadMeanMinutesPerApp, minutesPrior)
    }
    const minutesIfPlaying = blendedMinutes.n > 0 ? Math.min(90, blendedMinutes.avg) : 0

    const goalsPer90 = bayesianGoalsPer90(player, ctx)

    let bump = 1
    if (player.is_penalty_taker) bump += PENALTY_TAKER_WEIGHT_BUMP
    if (player.is_freekick_taker) bump += FREEKICK_TAKER_WEIGHT_BUMP
    bump += Math.min(FRIENDLY_WEIGHT_BUMP_CAP, (player.friendly_goals ?? 0) * FRIENDLY_GOAL_WEIGHT_BUMP)

    return {
      player, excluded: null,
      pPlays: rawPlays,
      minutesIfPlaying,
      rawMinutes: 0, // set in the second pass, once pPlays is final
      goalsPer90,
      // Weight is filled in after the minute normalization below.
      rawWeight: bump,
    }
  })

  // Second pass: put the squad's appearance probabilities on the expected
  // "how many different players actually feature" scale, then apply the
  // per-player adjustments and floors. Scaling first and flooring afterwards
  // means the total lands NEAR the target instead of exactly on it — which is
  // the intent, since it is a prior and not a constraint.
  const rawUnscaled = projections.map((p) => (p.excluded ? 0 : p.pPlays))
  const scaled = scalePlayProbabilities(rawUnscaled, EXPECTED_OUTFIELD_PLAYERS_USED)

  // The same per-player adjustments apply to both, so they live in one place.
  const adjust = (base: number, pl: WildenrothPlayer): number => {
    let v = base
    // A confirmed squad is a fact about this match; the parallel-fixture split
    // is a guess about the same thing. Once we have the fact, drop the guess.
    if (!ctx.squadConfirmed && ctx.bothSquadConflict && pl.squad === 'both') v *= BOTH_SQUAD_SPLIT
    v = Math.max(v, ctx.squadConfirmed ? SQUAD_MEMBER_MIN_PLAY_PROB : OFFERED_MIN_PLAY_PROB)
    if (ctx.questionablePlayerIds?.has(pl.id)) v *= QUESTIONABLE_PLAY_FACTOR
    return v
  }

  for (let i = 0; i < projections.length; i++) {
    const p = projections[i]
    if (p.excluded) continue

    // Reported probability: on the squad-total scale, so Σ P(plays) reflects how
    // many different players actually feature.
    p.pPlays = Math.min(1, adjust(scaled[i], p.player))

    // Minute split: the UNSCALED propensity, with the same adjustments.
    //
    // `allocateMinutes` renormalizes to 900 and is therefore invariant to
    // scaling every propensity by one common factor — but the 1.0 cap inside
    // `scalePlayProbabilities` is NOT uniform: it holds the near-certain
    // starters back while everyone else is scaled up, which shifts the relative
    // minutes and would reprice the whole market (measured on the Spieltag-8
    // preview: Ritter 3.37 → 3.89, Schorer 5.77 → 4.92). The squad-total prior
    // says HOW MANY different players feature; it carries no new information
    // about how the minutes divide between them, so it must move no price.
    p.rawMinutes = adjust(rawUnscaled[i], p.player) * p.minutesIfPlaying
  }

  return projections
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

    // Every outfield player in the matchday squad is offered — see the
    // OFFERING RULE above. Probability sets the price, not the availability.
    const isOffered = !p.excluded
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
        fairOddsScore: fairOdds(probScore),
        fairOddsScore2plus: fairOdds(probScore2plus),
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
