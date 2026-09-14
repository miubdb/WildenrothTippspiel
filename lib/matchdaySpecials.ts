import type { SupabaseClient } from '@supabase/supabase-js'
import type { Match } from '@/types'
import { getMatchXG, buildMatchScoreMatrix, oddsFromProbability } from './odds'
import { cappedPayout } from './payout'
import { sendPushToUser } from './push'

/**
 * Spieltag-Specials: normal, stake/odds-bearing bets (same `bets`/`combo_bets`
 * rows, same settlement/payout machinery as every other market — see
 * app/api/bets/place/route.ts and lib/matchdayFinalize.ts) whose outcome
 * depends on an ENTIRE Spieltag's matches rather than one. This file is the
 * generic engine: 11 reusable templates, probability/line/odds generation
 * (reusing lib/odds.ts's exact Poisson/score-matrix/house-margin machinery —
 * no second odds philosophy), and pure settlement evaluation.
 */

export type SpecialTemplateKey =
  | 'total_goals' | 'draws' | 'home_wins' | 'away_wins' | 'over25_games'
  | 'btts_games' | 'clean_sheet_games' | 'teams_3plus_goals'
  | 'biggest_win_margin' | 'any_00' | 'team_5plus_goals'

export type SpecialCategory = 'volume' | 'structure' | 'extreme'

export interface SpecialOption {
  key: string
  label: string
  probability: number
  generated_odds: number
  final_odds: number
  overridden: boolean
}

export interface SpecialTemplateMeta {
  key: SpecialTemplateKey
  category: SpecialCategory
  title: string
  isYesNo: boolean
}

export const SPECIAL_TEMPLATES: SpecialTemplateMeta[] = [
  { key: 'total_goals', category: 'volume', title: 'Wie viele Tore fallen an diesem Spieltag?', isYesNo: false },
  { key: 'draws', category: 'structure', title: 'Wie viele Unentschieden gibt es?', isYesNo: false },
  { key: 'home_wins', category: 'structure', title: 'Wie viele Heimsiege gibt es?', isYesNo: false },
  { key: 'away_wins', category: 'structure', title: 'Wie viele Auswärtssiege gibt es?', isYesNo: false },
  { key: 'over25_games', category: 'volume', title: 'Bei wie vielen Spielen fallen mehr als 2,5 Tore?', isYesNo: false },
  { key: 'btts_games', category: 'structure', title: 'Bei wie vielen Spielen treffen beide Teams?', isYesNo: false },
  { key: 'clean_sheet_games', category: 'structure', title: 'Bei wie vielen Spielen bleibt mindestens ein Team ohne eigenes Tor?', isYesNo: false },
  { key: 'teams_3plus_goals', category: 'volume', title: 'Wie viele Teams erzielen mindestens 3 Tore?', isYesNo: false },
  { key: 'biggest_win_margin', category: 'extreme', title: 'Gibt es einen Sieg mit mindestens {X}+ Toren Unterschied?', isYesNo: true },
  { key: 'any_00', category: 'extreme', title: 'Endet mindestens ein Spiel 0:0?', isYesNo: true },
  { key: 'team_5plus_goals', category: 'extreme', title: 'Erzielt mindestens ein Team 5 oder mehr Tore?', isYesNo: true },
]

const MAX_GOALS = 10 // matches lib/odds.ts's SCORE_MATRIX_MAX_GOALS

interface MatchProb {
  matchId: number
  totalGoalsPmf: number[] // index = total goals for this match, 0..2*MAX_GOALS
  pDraw: number
  pHomeWin: number
  pAwayWin: number
  pOver25: number
  pBtts: number
  pCleanSheetEither: number
  p00: number
  homeGoalsPmf: number[]
  awayGoalsPmf: number[]
  /** P(|home-away| > x) for a given integer threshold x. */
  pDiffGt: (x: number) => number
}

/** Per-match probabilities from the SAME xG/Poisson model every other market
 *  in this app uses (lib/odds.ts#getMatchXG + buildMatchScoreMatrix), without
 *  the prior-season/roster context (optional there) — a reasonable, still
 *  Bayesian-shrunk-to-league-average approximation for a secondary market;
 *  the primary 1X2/O-U markets remain the authoritative, fully-contextual
 *  odds elsewhere in the app. */
function buildMatchProbabilities(seasonMatches: Match[], match: Match): MatchProb {
  const { homeXG, awayXG } = getMatchXG(seasonMatches, match.home_team_id, match.away_team_id)
  const matrix = buildMatchScoreMatrix(homeXG, awayXG, MAX_GOALS)

  const totalGoalsPmf = new Array(2 * MAX_GOALS + 1).fill(0)
  const homeGoalsPmf = new Array(MAX_GOALS + 1).fill(0)
  const awayGoalsPmf = new Array(MAX_GOALS + 1).fill(0)
  let pDraw = 0, pHomeWin = 0, pAwayWin = 0, pOver25 = 0, pBtts = 0, pCleanSheetEither = 0
  const diffMass = new Map<number, number>() // |diff| -> probability mass

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = matrix[h][a]
      totalGoalsPmf[h + a] += p
      homeGoalsPmf[h] += p
      awayGoalsPmf[a] += p
      if (h === a) pDraw += p
      else if (h > a) pHomeWin += p
      else pAwayWin += p
      if (h + a >= 3) pOver25 += p
      if (h > 0 && a > 0) pBtts += p
      if (h === 0 || a === 0) pCleanSheetEither += p
      const diff = Math.abs(h - a)
      diffMass.set(diff, (diffMass.get(diff) ?? 0) + p)
    }
  }
  const p00 = matrix[0][0]

  function pDiffGt(x: number): number {
    let sum = 0
    for (const [diff, mass] of diffMass) if (diff > x) sum += mass
    return sum
  }

  return { matchId: match.id, totalGoalsPmf, pDraw, pHomeWin, pAwayWin, pOver25, pBtts, pCleanSheetEither, p00, homeGoalsPmf, awayGoalsPmf, pDiffGt }
}

function convolve(a: number[], b: number[]): number[] {
  const out = new Array(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j]
  }
  return out
}

/** Poisson-binomial: distribution of the COUNT of successes across N
 *  independent trials with different per-trial probabilities. Returns an
 *  array indexed 0..N. */
function poissonBinomialPmf(ps: number[]): number[] {
  let dist = [1]
  for (const p of ps) {
    const next = new Array(dist.length + 1).fill(0)
    for (let k = 0; k < dist.length; k++) {
      next[k] += dist[k] * (1 - p)
      next[k + 1] += dist[k] * p
    }
    dist = next
  }
  return dist
}

/** Picks the half-integer boundary (X,5 — never an integer, so a push is
 *  structurally impossible) whose over/under split is closest to 50/50,
 *  scanning every possible boundary of the given discrete distribution. */
function pickBalancedLine(pmf: number[]): { line: number; pOver: number } {
  let best = { line: 0.5, pOver: 0, diff: Infinity }
  let cumulative = 0
  for (let k = 0; k < pmf.length - 1; k++) {
    cumulative += pmf[k]
    const pOver = Math.max(0, 1 - cumulative)
    const line = k + 0.5
    const diff = Math.abs(pOver - 0.5)
    if (diff < best.diff) best = { line, pOver, diff }
  }
  return best
}

export interface SpecialCandidate {
  templateKey: SpecialTemplateKey
  category: SpecialCategory
  title: string
  line: number | null
  options: SpecialOption[]
}

function buildOverUnderOptions(pOver: number, line: number, unitLabel: (n: number) => string): SpecialOption[] {
  const pUnder = Math.max(0, 1 - pOver)
  const oddsOver = oddsFromProbability(pOver)
  const oddsUnder = oddsFromProbability(pUnder)
  return [
    { key: 'over', label: `Über ${unitLabel(line)}`, probability: pOver, generated_odds: oddsOver, final_odds: oddsOver, overridden: false },
    { key: 'under', label: `Unter ${unitLabel(line)}`, probability: pUnder, generated_odds: oddsUnder, final_odds: oddsUnder, overridden: false },
  ]
}

function buildYesNoOptions(pYes: number): SpecialOption[] {
  const pNo = Math.max(0, 1 - pYes)
  return [
    { key: 'yes', label: 'Ja', probability: pYes, generated_odds: oddsFromProbability(pYes), final_odds: oddsFromProbability(pYes), overridden: false },
    { key: 'no', label: 'Nein', probability: pNo, generated_odds: oddsFromProbability(pNo), final_odds: oddsFromProbability(pNo), overridden: false },
  ]
}

const fmtLine = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/**
 * Computes one candidate per template for the given set of matches. Pure —
 * no DB writes. `seasonMatches` is the full current-season match list (for
 * getMatchXG's in-season goal-rate model), `includedMatches` the specific
 * Spieltag matches this special would snapshot into `included_match_ids`.
 */
export function generateSpecialCandidates(seasonMatches: Match[], includedMatches: Match[]): SpecialCandidate[] {
  const probs = includedMatches.map((m) => buildMatchProbabilities(seasonMatches, m))
  if (probs.length === 0) return []

  const candidates: SpecialCandidate[] = []

  // A) Gesamttore — convolve every match's own total-goals PMF.
  {
    const totalPmf = probs.reduce((acc, p) => (acc ? convolve(acc, p.totalGoalsPmf) : p.totalGoalsPmf), null as number[] | null)!
    const { line, pOver } = pickBalancedLine(totalPmf)
    candidates.push({ templateKey: 'total_goals', category: 'volume', title: 'Wie viele Tore fallen an diesem Spieltag?', line, options: buildOverUnderOptions(pOver, line, fmtLine) })
  }
  // B) Unentschieden
  {
    const pmf = poissonBinomialPmf(probs.map((p) => p.pDraw))
    const { line, pOver } = pickBalancedLine(pmf)
    candidates.push({ templateKey: 'draws', category: 'structure', title: 'Wie viele Unentschieden gibt es an diesem Spieltag?', line, options: buildOverUnderOptions(pOver, line, fmtLine) })
  }
  // C) Heimsiege
  {
    const pmf = poissonBinomialPmf(probs.map((p) => p.pHomeWin))
    const { line, pOver } = pickBalancedLine(pmf)
    candidates.push({ templateKey: 'home_wins', category: 'structure', title: 'Wie viele Heimsiege gibt es an diesem Spieltag?', line, options: buildOverUnderOptions(pOver, line, fmtLine) })
  }
  // D) Auswärtssiege
  {
    const pmf = poissonBinomialPmf(probs.map((p) => p.pAwayWin))
    const { line, pOver } = pickBalancedLine(pmf)
    candidates.push({ templateKey: 'away_wins', category: 'structure', title: 'Wie viele Auswärtssiege gibt es an diesem Spieltag?', line, options: buildOverUnderOptions(pOver, line, fmtLine) })
  }
  // E) Spiele über 2,5 Tore
  {
    const pmf = poissonBinomialPmf(probs.map((p) => p.pOver25))
    const { line, pOver } = pickBalancedLine(pmf)
    candidates.push({ templateKey: 'over25_games', category: 'volume', title: 'Bei wie vielen Spielen fallen mehr als 2,5 Tore?', line, options: buildOverUnderOptions(pOver, line, fmtLine) })
  }
  // F) Beide treffen
  {
    const pmf = poissonBinomialPmf(probs.map((p) => p.pBtts))
    const { line, pOver } = pickBalancedLine(pmf)
    candidates.push({ templateKey: 'btts_games', category: 'structure', title: 'Bei wie vielen Spielen treffen beide Teams?', line, options: buildOverUnderOptions(pOver, line, fmtLine) })
  }
  // G) "Zu Null" — mindestens ein Team ohne eigenes Tor
  {
    const pmf = poissonBinomialPmf(probs.map((p) => p.pCleanSheetEither))
    const { line, pOver } = pickBalancedLine(pmf)
    candidates.push({ templateKey: 'clean_sheet_games', category: 'structure', title: 'Bei wie vielen Spielen bleibt mindestens ein Team ohne eigenes Tor?', line, options: buildOverUnderOptions(pOver, line, fmtLine) })
  }
  // H) Teams mit 3+ Toren — jedes der 2N Teams einzeln als Bernoulli-Versuch.
  {
    const teamPs: number[] = []
    for (const p of probs) {
      teamPs.push(p.homeGoalsPmf.slice(3).reduce((a, b) => a + b, 0))
      teamPs.push(p.awayGoalsPmf.slice(3).reduce((a, b) => a + b, 0))
    }
    const pmf = poissonBinomialPmf(teamPs)
    const { line, pOver } = pickBalancedLine(pmf)
    candidates.push({ templateKey: 'teams_3plus_goals', category: 'volume', title: 'Wie viele Teams erzielen an diesem Spieltag mindestens 3 Tore?', line, options: buildOverUnderOptions(pOver, line, fmtLine) })
  }
  // I) Höchster Sieg — Ja/Nein ab einer Tordifferenz-Schwelle, die selbst per
  // "möglichst nah 50/50" aus den Kandidatenschwellen 1,2,3,4,5 gewählt wird.
  {
    let bestX = 3, bestDiff = Infinity, bestPYes = 0
    for (let x = 1; x <= 6; x++) {
      const pYes = 1 - probs.reduce((acc, p) => acc * (1 - p.pDiffGt(x)), 1)
      const diff = Math.abs(pYes - 0.5)
      if (diff < bestDiff) { bestDiff = diff; bestX = x; bestPYes = pYes }
    }
    candidates.push({
      templateKey: 'biggest_win_margin', category: 'extreme',
      title: `Gibt es einen Sieg mit mindestens ${bestX + 1}+ Toren Unterschied an diesem Spieltag?`,
      line: bestX + 0.5,
      options: buildYesNoOptions(bestPYes),
    })
  }
  // J) Mindestens ein 0:0
  {
    const pYes = 1 - probs.reduce((acc, p) => acc * (1 - p.p00), 1)
    candidates.push({ templateKey: 'any_00', category: 'extreme', title: 'Endet mindestens ein Spiel an diesem Spieltag 0:0?', line: null, options: buildYesNoOptions(pYes) })
  }
  // K) Mindestens ein Team mit 5+ Toren
  {
    const pAnyTeam5 = 1 - probs.reduce((acc, p) => {
      const pHome5 = p.homeGoalsPmf.slice(5).reduce((a, b) => a + b, 0)
      const pAway5 = p.awayGoalsPmf.slice(5).reduce((a, b) => a + b, 0)
      return acc * (1 - pHome5) * (1 - pAway5)
    }, 1)
    candidates.push({ templateKey: 'team_5plus_goals', category: 'extreme', title: 'Erzielt an diesem Spieltag mindestens ein Team 5 oder mehr Tore?', line: null, options: buildYesNoOptions(pAnyTeam5) })
  }

  return candidates
}

/**
 * Picks 2-3 candidates spanning DIFFERENT categories (volume/structure/
 * extreme) instead of three near-duplicate markets — see SPIELTAG-SPECIALS
 * requirement 16. Falls back to filling remaining slots from any category
 * once every category has contributed one, so a request for more than 3
 * (categories.length) still returns something reasonable.
 */
export function pickDiverseSuggestions(candidates: SpecialCandidate[], count = 3): SpecialCandidate[] {
  const byCategory = new Map<SpecialCategory, SpecialCandidate[]>()
  for (const c of candidates) {
    const arr = byCategory.get(c.category) ?? []
    arr.push(c)
    byCategory.set(c.category, arr)
  }
  // Within a category, prefer the candidate whose better side is closest to
  // a coin flip — a more genuinely uncertain, interesting market.
  for (const arr of byCategory.values()) {
    arr.sort((a, b) => {
      const da = Math.abs((a.options[0]?.probability ?? 0.5) - 0.5)
      const db = Math.abs((b.options[0]?.probability ?? 0.5) - 0.5)
      return da - db
    })
  }
  const categories: SpecialCategory[] = ['volume', 'structure', 'extreme']
  const picked: SpecialCandidate[] = []
  const usedKeys = new Set<string>()
  for (const cat of categories) {
    if (picked.length >= count) break
    const pick = byCategory.get(cat)?.find((c) => !usedKeys.has(c.templateKey))
    if (pick) { picked.push(pick); usedKeys.add(pick.templateKey) }
  }
  if (picked.length < count) {
    for (const c of candidates) {
      if (picked.length >= count) break
      if (!usedKeys.has(c.templateKey)) { picked.push(c); usedKeys.add(c.templateKey) }
    }
  }
  return picked
}

// ---------- Settlement (exact final values, section 9's definitions) ----------

export interface FinalMatchResult {
  id: number
  home_score: number
  away_score: number
}

/** The single number this template's line/Ja-Nein question is graded
 *  against, computed from FINAL scores only — never estimated. */
export function computeFinalStat(templateKey: SpecialTemplateKey, matches: FinalMatchResult[]): number {
  switch (templateKey) {
    case 'total_goals':
      return matches.reduce((a, m) => a + m.home_score + m.away_score, 0)
    case 'draws':
      return matches.filter((m) => m.home_score === m.away_score).length
    case 'home_wins':
      return matches.filter((m) => m.home_score > m.away_score).length
    case 'away_wins':
      return matches.filter((m) => m.away_score > m.home_score).length
    case 'over25_games':
      return matches.filter((m) => m.home_score + m.away_score >= 3).length
    case 'btts_games':
      return matches.filter((m) => m.home_score > 0 && m.away_score > 0).length
    case 'clean_sheet_games':
      return matches.filter((m) => m.home_score === 0 || m.away_score === 0).length
    case 'teams_3plus_goals': {
      let count = 0
      for (const m of matches) {
        if (m.home_score >= 3) count++
        if (m.away_score >= 3) count++
      }
      return count
    }
    case 'biggest_win_margin':
      return Math.max(0, ...matches.map((m) => Math.abs(m.home_score - m.away_score)))
    case 'any_00':
      return matches.some((m) => m.home_score === 0 && m.away_score === 0) ? 1 : 0
    case 'team_5plus_goals':
      return matches.some((m) => m.home_score >= 5 || m.away_score >= 5) ? 1 : 0
  }
}

/** Given the special's stored `line`/`options` and the final computed stat,
 *  returns the single winning option key. Over/Under templates always use
 *  an X,5 line (no push possible); Ja/Nein templates compare the stat
 *  against the threshold baked into `line` (biggest_win_margin) or a fixed
 *  0/1 flag (any_00/team_5plus_goals, `line` is null there). */
export function evaluateSpecial(templateKey: SpecialTemplateKey, line: number | null, finalStat: number): 'over' | 'under' | 'yes' | 'no' {
  const meta = SPECIAL_TEMPLATES.find((t) => t.key === templateKey)!
  if (meta.isYesNo) {
    if (templateKey === 'biggest_win_margin') return finalStat > (line ?? 3.5) ? 'yes' : 'no'
    return finalStat >= 1 ? 'yes' : 'no'
  }
  return finalStat > (line ?? 0) ? 'over' : 'under'
}

const SPECIALS_SEASON = '26/27' // matches CURRENT_SEASON elsewhere — duplicated per-file per project convention (see CLAUDE.md)

/**
 * Settles every 'active' Spieltag-Special that includes `matchId` and whose
 * OWN `included_match_ids` are ALL finished — independent of the outer
 * Spieltag's `allFinished` gate in lib/matchdayFinalize.ts, since a
 * Special's immutable snapshot need not equal the current Spieltag match
 * set. Looked up by matchId membership rather than by matchday NUMBER
 * deliberately: a Special is created under `effectiveMatchdayOf` (see
 * app/api/admin/matchday-specials/route.ts) while this function is called
 * from a `recapMatchdayOf`-keyed context (lib/season.ts's two grouping
 * systems can diverge for a BFV-rescheduled Spieltag) — matching on the
 * concrete match id sidesteps that numbering mismatch entirely.
 * Reuses the exact same single/combo settlement + payout pattern as
 * app/api/admin/settle/route.ts (won/lost per leg, capped payout, combo
 * resolves once no leg is pending and none lost). A Special with any
 * included match not yet 'finished' (postponed, still pending) is left
 * untouched — SPIELTAG-SPECIALS requirement 11 — for the admin to either
 * wait for a Nachholspiel or void it via /api/admin/matchday-specials/[id]/void.
 * Called from lib/matchdayFinalize.ts#finalizeMatchdayIfDone, the single
 * shared hook point both app/api/admin/settle/route.ts and
 * app/api/admin/goalscorers/scorers/route.ts already call through.
 */
export async function settleActiveMatchdaySpecials(admin: SupabaseClient, matchId: number): Promise<void> {
  const { data: specials } = await admin
    .from('matchday_specials')
    .select('id, matchday, template_key, title, line, options, included_match_ids')
    .eq('season', SPECIALS_SEASON)
    .eq('status', 'active')
    .contains('included_match_ids', [matchId])
  if (!specials || specials.length === 0) return

  for (const special of specials) {
    const includedIds: number[] = special.included_match_ids ?? []
    if (includedIds.length === 0) continue

    const { data: includedMatches } = await admin
      .from('matches')
      .select('id, home_score, away_score, status')
      .in('id', includedIds)
    if (!includedMatches || includedMatches.length !== includedIds.length) continue

    // Any included match not yet finished (still pending, or postponed) —
    // never auto-settle on a partial result. Admin decides (wait/void).
    if (includedMatches.some((m) => m.status !== 'finished')) continue

    const finalResults = includedMatches.map((m) => ({ id: m.id, home_score: m.home_score ?? 0, away_score: m.away_score ?? 0 }))
    const finalStat = computeFinalStat(special.template_key as SpecialTemplateKey, finalResults)
    const winningKey = evaluateSpecial(special.template_key as SpecialTemplateKey, special.line, finalStat)

    const { data: pendingBets } = await admin
      .from('bets')
      .select('id, user_id, selection, stake, odds_value, combo_id, is_risky')
      .eq('special_id', special.id)
      .eq('status', 'pending')

    const userBalanceUpdates: Record<string, number> = {}
    const userWonCount: Record<string, number> = {}
    const userLostCount: Record<string, number> = {}
    const combosToCheck = new Set<number>()

    for (const bet of pendingBets ?? []) {
      const result: 'won' | 'lost' = bet.selection === winningKey ? 'won' : 'lost'
      let payout = 0
      if (result === 'won' && bet.combo_id === null) {
        payout = Math.round(cappedPayout(bet.stake, bet.odds_value, bet.is_risky) * 100) / 100
        userBalanceUpdates[bet.user_id] = (userBalanceUpdates[bet.user_id] ?? 0) + payout
      }
      await admin.from('bets').update({ status: result, payout: result === 'won' ? payout : 0 }).eq('id', bet.id)
      if (bet.combo_id !== null) {
        combosToCheck.add(bet.combo_id)
      } else {
        if (result === 'won') userWonCount[bet.user_id] = (userWonCount[bet.user_id] ?? 0) + 1
        else userLostCount[bet.user_id] = (userLostCount[bet.user_id] ?? 0) + 1
      }
    }

    for (const comboId of combosToCheck) {
      const { data: comboLegs } = await admin.from('bets').select('id, status, is_risky').eq('combo_id', comboId)
      if (!comboLegs) continue
      const allSettled = comboLegs.every((leg) => leg.status !== 'pending')
      const anyLost = comboLegs.some((leg) => leg.status === 'lost')
      if (!anyLost && !allSettled) continue

      const { data: comboBet } = await admin.from('combo_bets').select('id, stake, total_odds, user_id, status').eq('id', comboId).single()
      if (!comboBet || comboBet.status !== 'pending') continue

      if (anyLost) {
        await admin.from('combo_bets').update({ status: 'lost', payout: 0 }).eq('id', comboId)
        userLostCount[comboBet.user_id] = (userLostCount[comboBet.user_id] ?? 0) + 1
      } else {
        const comboIsRisky = comboLegs[0]?.is_risky ?? false
        const payout = Math.round(cappedPayout(comboBet.stake, comboBet.total_odds, comboIsRisky) * 100) / 100
        await admin.from('combo_bets').update({ status: 'won', payout }).eq('id', comboId)
        userBalanceUpdates[comboBet.user_id] = (userBalanceUpdates[comboBet.user_id] ?? 0) + payout
        userWonCount[comboBet.user_id] = (userWonCount[comboBet.user_id] ?? 0) + 1
      }
    }

    const allAffectedUsers = new Set([...Object.keys(userBalanceUpdates), ...Object.keys(userWonCount), ...Object.keys(userLostCount)])
    for (const userId of allAffectedUsers) {
      const amount = userBalanceUpdates[userId] ?? 0
      if (amount > 0) {
        await admin.rpc('increment_balance', { p_user_id: userId, p_amount: amount })
      }
      const won = userWonCount[userId] ?? 0
      const lost = userLostCount[userId] ?? 0
      let title: string, body: string
      if (won > 0 && lost === 0) {
        title = '🔥 Spieltag-Special gewonnen!'
        body = `+${amount.toFixed(2)} Wildis wurden deinem Konto gutgeschrieben.`
      } else if (lost > 0 && won === 0) {
        title = '🔥 Spieltag-Special verloren'
        body = 'Viel Glück beim nächsten Spieltag!'
      } else if (won > 0 && lost > 0) {
        title = '🔥 Spieltag-Special ausgewertet'
        body = `Saldo: ${amount >= 0 ? '+' : ''}${amount.toFixed(2)} Wildis`
      } else {
        continue
      }
      try {
        await sendPushToUser(userId, title, body, `/recap/${special.matchday}`, 'settlement', `special-settlement-${userId}-${special.id}`)
      } catch (e) { console.error('Special settlement push failed:', e) }
    }

    await admin
      .from('matchday_specials')
      .update({ status: 'settled', settlement_result: { finalStat, winningKey }, settled_at: new Date().toISOString() })
      .eq('id', special.id)
  }
}
