/**
 * Monte Carlo match simulation for the 3 correlated/path-dependent cup
 * specials (see lib/odds.ts#cupSpecialMarketOddsFromXG and the "Pokal-
 * Spezial" round-2 spec) — halftime-lead-and-advance, comeback-and-advance,
 * shootout-and-advance. These are NOT naive products of two independent
 * closed-form probabilities (P(half-time lead) × P(advance) etc.) because the
 * two events are correlated within the same match: a team that led at
 * half-time is systematically more likely to have also won in 90 minutes (or
 * at least not lost), so P(A and B) ≠ P(A) × P(B). A full match simulation
 * sidesteps having to derive a closed-form joint distribution by hand.
 *
 * Pure function, no I/O — deterministic given (homeXG, awayXG, numSims); the
 * only randomness source is Math.random(), which is fine here since this
 * feeds odds (not cryptography) and runs server-side at freeze time, not
 * per-request.
 *
 * MODELLING ASSUMPTIONS (mirrors the existing "no minute data" caveats
 * elsewhere in this codebase, e.g. cup_first_goal's competing-Poisson-
 * processes approximation):
 * - Goal counts: independent Poisson(homeXG) / Poisson(awayXG) over the full
 *   90+stoppage minutes — the SAME per-match goal expectation every other
 *   market on this fixture uses (see getMatchXG), so this simulation can
 *   never silently disagree with the match's own 1X2/BTTS/cup_advance cards.
 * - Goal timing: each scored goal is assigned an independent minute drawn
 *   uniformly from {1, ..., 90} (equivalently: a 50/50 first-half/second-half
 *   split with no further skew within each half) — there is no historical
 *   per-minute goal-timing data anywhere in this dataset to justify anything
 *   more specific (same caveat as the shootout heuristic in lib/odds.ts).
 *   This is enough to determine half-time score (goals with minute <= 45)
 *   and the "did the away side ever lead in regulation" comeback condition
 *   (by walking the goals in minute order and tracking the running score),
 *   without overclaiming precision this dataset doesn't support.
 * - Shootout: on a 90-minute draw, the winner is drawn with
 *   shootoutHomeWinProb(homeXG, awayXG) — the EXACT same conservative,
 *   near-50:50 heuristic used by the closed-form cup_advance market (see
 *   lib/odds.ts), reused rather than reimplemented so the two can't drift
 *   apart.
 */
import { shootoutHomeWinProb } from './odds'

export interface CupSimulationOutput {
  numSims: number
  /** P(home/Wildenroth advances to the next round), from the simulation. */
  pAdvanceHome: number
  /** P(decided in 90 minutes, i.e. NOT a draw after 90). */
  pDecidedIn90: number
  /** P(decided by penalty shootout, i.e. a draw after 90). */
  pDecidedInShootout: number
  /** P(home led at half-time AND home advances) — market 3. */
  pHomeHtLeadAndAdvance: number
  /** P(away led at some point during the 90 AND home still advances) — market 4. */
  pAwayEverLedAndHomeAdvances: number
  /** P(draw after 90 AND home wins the shootout) — market 5. Identical event
   *  to "shootout decides it AND home advances", kept as a separate field
   *  for readability at call sites. */
  pShootoutAndHomeAdvances: number
  /** P(the match's first goal — either team, regular time + stoppage —
   *  falls in minute 1-15 inclusive). Round-6 "Frühes Tor" market. False
   *  when there is no goal at all in the 90 (a shootout-only decision never
   *  counts, matching cup_first_goal's own "penalties never count" rule). */
  pEarlyGoal: number
  /** P(strictly more total goals — both teams combined — in the 2nd half
   *  than the 1st). Round-6 "Mehr Tore" market. */
  pMoreGoalsSecondHalf: number
  /** P(strictly more total goals in the 1st half than the 2nd). */
  pMoreGoalsFirstHalf: number
  /** P(equal total goals in both halves, including 0-0/0-0). */
  pEqualGoalsPerHalf: number
  /** P(both teams score AT LEAST once in HZ1 AND both teams score at least
   *  once in HZ2) — round-6 "Beide Teams in beiden Halbzeiten" market. */
  pBttsInBothHalves: number
}

/** Knuth's algorithm — draws one Poisson(lambda) sample from a uniform RNG. */
function samplePoisson(lambda: number, rng: () => number): number {
  if (lambda <= 0) return 0
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k += 1
    p *= rng()
  } while (p > L)
  return k - 1
}

export function simulateCupMatch(
  homeXG: number,
  awayXG: number,
  numSims = 80000,
  rng: () => number = Math.random
): CupSimulationOutput {
  const pShootoutHome = shootoutHomeWinProb(homeXG, awayXG)

  let advanceHomeCount = 0
  let decided90Count = 0
  let htLeadAdvanceCount = 0
  let awayEverLedAdvanceCount = 0
  let shootoutAdvanceCount = 0
  let earlyGoalCount = 0
  let moreSecondHalfCount = 0
  let moreFirstHalfCount = 0
  let equalHalvesCount = 0
  let bttsBothHalvesCount = 0

  for (let i = 0; i < numSims; i++) {
    const homeGoals = samplePoisson(homeXG, rng)
    const awayGoals = samplePoisson(awayXG, rng)

    // Assign each goal an independent minute in [1, 90], then walk them in
    // time order to get half-time score and "did away ever lead" (see
    // module doc for why this level of detail, and no more, is justified).
    const minutes: { team: 'home' | 'away'; minute: number }[] = []
    for (let g = 0; g < homeGoals; g++) minutes.push({ team: 'home', minute: 1 + Math.floor(rng() * 90) })
    for (let g = 0; g < awayGoals; g++) minutes.push({ team: 'away', minute: 1 + Math.floor(rng() * 90) })
    minutes.sort((a, b) => a.minute - b.minute)

    let h = 0, a = 0
    let awayEverLed = false
    let htHome = 0, htAway = 0
    for (const ev of minutes) {
      if (ev.team === 'home') h++
      else a++
      if (a > h) awayEverLed = true
      if (ev.minute <= 45) {
        if (ev.team === 'home') htHome++
        else htAway++
      }
    }

    const finalHome = homeGoals
    const finalAway = awayGoals

    let homeAdvances: boolean
    let decidedIn90: boolean
    if (finalHome > finalAway) {
      homeAdvances = true
      decidedIn90 = true
    } else if (finalAway > finalHome) {
      homeAdvances = false
      decidedIn90 = true
    } else {
      decidedIn90 = false
      homeAdvances = rng() < pShootoutHome
    }

    if (homeAdvances) advanceHomeCount++
    if (decidedIn90) decided90Count++
    if (htHome > htAway && homeAdvances) htLeadAdvanceCount++
    if (awayEverLed && homeAdvances) awayEverLedAdvanceCount++
    if (!decidedIn90 && homeAdvances) shootoutAdvanceCount++

    // "Frühes Tor" (round 6): did ANY goal (either team) fall in minute 1-15?
    if (minutes.length > 0 && minutes[0].minute <= 15) earlyGoalCount++

    // "Mehr Tore in welcher Halbzeit?" (round 6): total goals per half.
    const htTotal = htHome + htAway
    const secondHalfTotal = (finalHome - htHome) + (finalAway - htAway)
    if (secondHalfTotal > htTotal) moreSecondHalfCount++
    else if (htTotal > secondHalfTotal) moreFirstHalfCount++
    else equalHalvesCount++

    // "Beide Teams treffen in beiden Halbzeiten" (round 6): both teams score
    // in HZ1 AND both teams score in HZ2 (fulltime minus halftime per team).
    const secondHalfHome = finalHome - htHome
    const secondHalfAway = finalAway - htAway
    if (htHome > 0 && htAway > 0 && secondHalfHome > 0 && secondHalfAway > 0) bttsBothHalvesCount++
  }

  return {
    numSims,
    pAdvanceHome: advanceHomeCount / numSims,
    pDecidedIn90: decided90Count / numSims,
    pDecidedInShootout: 1 - decided90Count / numSims,
    pHomeHtLeadAndAdvance: htLeadAdvanceCount / numSims,
    pAwayEverLedAndHomeAdvances: awayEverLedAdvanceCount / numSims,
    pShootoutAndHomeAdvances: shootoutAdvanceCount / numSims,
    pEarlyGoal: earlyGoalCount / numSims,
    pMoreGoalsSecondHalf: moreSecondHalfCount / numSims,
    pMoreGoalsFirstHalf: moreFirstHalfCount / numSims,
    pEqualGoalsPerHalf: equalHalvesCount / numSims,
    pBttsInBothHalves: bttsBothHalvesCount / numSims,
  }
}
