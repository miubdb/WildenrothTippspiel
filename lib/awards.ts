import { SupabaseClient } from '@supabase/supabase-js'
import { wildiLabel } from '@/components/WildiIcon'
import { buildEffectiveMatchdayIndex, recapMatchdayOf, SEASON_START } from '@/lib/season'
import { cappedPayout } from '@/lib/payout'
import { settleBet } from '@/lib/settleBet'
import { MARKET_LABELS } from '@/lib/betStats'
import { plainSelectionLabel, type SpecialDisplayInfo } from '@/lib/betDisplay'
import type { Match } from '@/types'

// Monthly awards (not implemented yet — conceptual note only, per release-scope
// decision to not build this before launch):
// Same 7 categories, computed the same way as the per-matchday versions here,
// but aggregated across all matchdays whose match_date falls in a calendar
// month instead of a single settled matchday. Would need: (1) a `period`
// column (e.g. 'YYYY-MM') alongside the existing `matchday` column on
// user_awards so both granularities coexist in one table, and (2) a monthly
// cron/admin trigger analogous to persistAwards() below, run once the month's
// last matchday settles. Deferred until after release.

export type AwardType =
  | 'spieltagskoenig'
  | 'eier_aus_stahl'
  | 'unlucky_bastard'
  | 'ergebnis_orakel'
  | 'griff_ins_klo'
  | 'betonmischer'
  | 'on_fire'
  | 'grosser_wurf'
  | 'torschuetzen_koenig'
  | 'last_minute_tipper'
  | 'storno_champ'

/** Every award type computeAndPersistMatchdayAwards evaluates. Used as the
 *  default delete scope in persistAwards, so an award that STOPS having a
 *  winner on a recompute actually disappears (see there). */
export const ALL_AWARD_TYPES: AwardType[] = [
  'spieltagskoenig', 'eier_aus_stahl', 'unlucky_bastard', 'ergebnis_orakel',
  'griff_ins_klo', 'betonmischer', 'on_fire', 'grosser_wurf',
  'torschuetzen_koenig', 'last_minute_tipper', 'storno_champ',
]

export const AWARD_META: Record<AwardType, { title: string; icon: string; description: string }> = {
  spieltagskoenig: { icon: '🏆', title: 'Spieltagskönig',    description: 'Bester Spieltagssaldo' },
  eier_aus_stahl:  { icon: '🥚', title: 'Eier aus Stahl',    description: 'Höchste gewonnene Quote' },
  unlucky_bastard: { icon: '😭', title: 'Unlucky Bastard',   description: 'Nur ein Tipp von einem großen Gewinn entfernt' },
  ergebnis_orakel: { icon: '🔮', title: 'Ergebnis-Orakel',   description: 'Exaktes Ergebnis richtig getippt' },
  griff_ins_klo:   { icon: '🚽', title: 'Griff ins Klo',     description: 'Schlechtester Netto-Saldo am Spieltag' },
  betonmischer:    { icon: '🧱', title: 'Betonmischer',       description: 'Sicherster gewonnener Tipp' },
  on_fire:         { icon: '🎯', title: 'Mehrfachtreffer',    description: 'Meiste gewonnene Wettscheine' },
  // Deliberately Einzelwette-only (no combos) — a combo's win is really a
  // Spieltagskönig-flavored story (several legs contributing), so scoping
  // this to single bets keeps it a genuinely different category instead of
  // usually crowning the same person as Spieltagskönig for the same reason.
  grosser_wurf:        { icon: '🎯', title: 'Volltreffer',           description: 'Höchster Gewinn mit einer Einzelwette am Spieltag' },
  torschuetzen_koenig: { icon: '⚽', title: 'Torschützen-König',     description: 'Meiste richtige Torschützen-Tipps am Spieltag' },
  last_minute_tipper:  { icon: '⏱️', title: 'Last-Minute-Tipper',   description: 'Gewonnene Wette, weniger als 1 Std. vor Anpfiff platziert' },
  storno_champ:        { icon: '🏆', title: 'Storno-Champ',         description: 'Höchster entgangener Nettogewinn einer stornierten Wette' },
}

export interface AwardInput {
  user_id: string
  award_type: AwardType
  value?: number
  value_text?: string
  /** Exactly one of these (or neither) — see user_awards.ref_bet_id/
   *  ref_combo_id migration comments. Set by storno_champ and
   *  last_minute_tipper today. */
  ref_bet_id?: number | null
  ref_combo_id?: number | null
}

export async function persistAwards(
  supabase: SupabaseClient,
  season: string,
  matchday: number,
  awards: AwardInput[],
  /** Which award types this run RECOMPUTED — not which ones produced a winner.
   *  The difference matters: an award that loses its winner (a rule change
   *  disqualifies the only candidate, a corrected result no longer makes the
   *  bet a winner) contributes no row to `awards`, so deriving the delete
   *  scope from `awards` alone would leave its stale row standing forever
   *  with no way to clear it. Defaults to every type, which is right for a
   *  full recompute; the backfill route narrows it so it cannot touch the
   *  awards it does not recompute. */
  recomputedTypes: AwardType[] = ALL_AWARD_TYPES
) {
  if (matchday === 999) return
  // Award winners can change on a recompute (e.g. a postponed match settles
  // later, or goalscorer bets settle after the matchday's other bets did) —
  // the upsert below only overwrites a row that stays keyed to the SAME user,
  // so a changed winner would otherwise leave the old winner's row in place
  // alongside the new one. Clear every award type being recomputed for this
  // (season, matchday) first so a recompute always fully replaces the old set.
  const types = [...new Set([...recomputedTypes, ...awards.map(a => a.award_type)])]
  if (types.length > 0) {
    await supabase
      .from('user_awards')
      .delete()
      .eq('season', season)
      .eq('matchday', matchday)
      .in('award_type', types)
  }
  if (awards.length === 0) return
  const rows = awards.map(a => ({
    user_id: a.user_id,
    season,
    matchday,
    award_type: a.award_type,
    award_title: AWARD_META[a.award_type].title,
    award_description: AWARD_META[a.award_type].description,
    award_icon: AWARD_META[a.award_type].icon,
    value: a.value ?? null,
    value_text: a.value_text ?? null,
    ref_bet_id: a.ref_bet_id ?? null,
    ref_combo_id: a.ref_combo_id ?? null,
  }))
  await supabase
    .from('user_awards')
    .upsert(rows, { onConflict: 'user_id,season,matchday,award_type' })
}

/**
 * Computes and persists the 7 per-matchday awards from every settled (won/lost)
 * bet whose match_id is in `matchIds`. Callers must ensure this only runs once
 * ALL bets for this Spieltag are actually settled — including goalscorer bets,
 * which resolve on a separate timeline from the match score (see
 * app/api/admin/settle/route.ts and app/api/admin/goalscorers/scorers/route.ts,
 * the two call sites that can each be the "last" event settling a Spieltag).
 */
export async function computeAndPersistMatchdayAwards(
  admin: SupabaseClient,
  season: string,
  matchday: number,
  matchIds: number[],
  // Scopes persistence to exactly these award types — every category is
  // still computed (cheap, no side effects), but only these get written.
  // Used by the admin backfill route to add newly-introduced categories to
  // already-settled Spieltage WITHOUT touching (deleting/reinserting) the
  // original 7 awards' already-persisted rows for those same Spieltage.
  onlyTypes?: AwardType[]
): Promise<number> {
  if (matchday === 999 || matchIds.length === 0) return 0

  const { data: rawBets } = await admin
    .from('bets')
    .select('id, user_id, match_id, stake, odds_value, payout, status, is_risky, combo_id, market_type, selection, created_at')
    .in('match_id', matchIds)
    .in('status', ['won', 'lost'])
  const allBets = rawBets ?? []

  // Kickoff times for this Spieltag's own matches — needed for Last-Minute-
  // Tipper's "placed < 1h before kickoff" check on single bets.
  const { data: mdMatchesRaw } = await admin.from('matches').select('id, match_date').in('id', matchIds)
  const matchDateMap = new Map<number, string>((mdMatchesRaw ?? []).map((m) => [m.id, m.match_date]))
  const singleBets = allBets.filter((b: { combo_id: unknown }) => !b.combo_id)
  const legBets = allBets.filter((b: { combo_id: unknown }) => b.combo_id)
  const comboIds = [...new Set(legBets.map((b: { combo_id: unknown }) => Number(b.combo_id)))]

  // Fetch all combo_bets (won + lost) for these combos
  type CB = { id: number; user_id: string; stake: number; total_odds: number; payout: number; status: string; created_at: string }
  let comboBets: CB[] = []
  // Also fetch ALL legs of these combos (may include legs outside this matchday)
  let allLegs: { combo_id: number; status: string }[] = []
  // Earliest kickoff among ALL of a combo's legs (may include matches outside
  // this Spieltag) — betting on the whole combo closes once the FIRST leg's
  // match starts, so that's the relevant deadline for Last-Minute-Tipper.
  const comboEarliestKickoff = new Map<number, string>()
  if (comboIds.length > 0) {
    const { data: cbData } = await admin
      .from('combo_bets')
      .select('id, user_id, stake, total_odds, payout, status, created_at')
      .in('id', comboIds)
      .in('status', ['won', 'lost'])
    comboBets = (cbData ?? []) as CB[]
    const { data: legData } = await admin
      .from('bets')
      .select('combo_id, status, match_id')
      .in('combo_id', comboIds)
    allLegs = (legData ?? []).map((l: { combo_id: unknown; status: string }) => ({ combo_id: Number(l.combo_id), status: l.status }))

    // A combo whose legs span two Spieltage must be counted toward exactly
    // ONE of them — this function runs once per Spieltag as it settles, so
    // without this a cross-Spieltag combo's full stake/payout would be
    // awarded toward Spieltagskönig (and every other combo-eligible award)
    // on EVERY Spieltag it touches. Canonical owner = the earliest
    // recap-Spieltag among all its legs (mirrors the equivalent fix in
    // app/(app)/recap/[matchday]/page.tsx's own per-user P&L display).
    const legMatchIds = [...new Set((legData ?? []).map((l) => l.match_id as number))]
    const { data: legMatchesRaw } = await admin
      .from('matches')
      .select('id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status, match_category, is_topspiel, tippspiel_matchday')
      .in('id', legMatchIds)
    const legMatchDateMap = new Map<number, string>((legMatchesRaw ?? []).map((m) => [m.id, m.match_date as string]))
    for (const l of legData ?? []) {
      const d = legMatchDateMap.get(l.match_id as number)
      if (!d) continue
      const cid = Number(l.combo_id)
      const cur = comboEarliestKickoff.get(cid)
      if (!cur || d < cur) comboEarliestKickoff.set(cid, d)
    }
    const { data: seasonMatchesRaw } = await admin
      .from('matches')
      .select('id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status, match_category, is_topspiel, tippspiel_matchday')
      .or(`match_date.gte.${SEASON_START},matchday.eq.999`)
    const mdIndex = buildEffectiveMatchdayIndex((seasonMatchesRaw ?? []) as Match[])
    const matchIdToRecapMd = new Map<number, number | null>(
      ((legMatchesRaw ?? []) as Match[]).map((m) => [m.id, recapMatchdayOf(m, mdIndex)])
    )
    const comboOwnerMatchday = new Map<number, number>()
    for (const l of legData ?? []) {
      const legMd = matchIdToRecapMd.get(l.match_id as number)
      if (legMd == null) continue
      const cid = Number(l.combo_id)
      const cur = comboOwnerMatchday.get(cid)
      if (cur == null || legMd < cur) comboOwnerMatchday.set(cid, legMd)
    }
    comboBets = comboBets.filter((c) => comboOwnerMatchday.get(c.id) === matchday)
    const ownedComboIds = new Set(comboBets.map((c) => c.id))
    allLegs = allLegs.filter((l) => ownedComboIds.has(l.combo_id))
  }

  const wonSingles = singleBets.filter((b: { status: string }) => b.status === 'won')
  const wonCombos  = comboBets.filter(c => c.status === 'won')
  const lostCombos  = comboBets.filter(c => c.status === 'lost')

  const awardInputs: AwardInput[] = []

  // 1. Spieltagskönig — best net saldo (singles + combos)
  const pnlByUser: Record<string, number> = {}
  for (const b of singleBets) {
    const g = b.status === 'won' ? (b.payout ?? 0) - b.stake : -b.stake
    pnlByUser[b.user_id] = (pnlByUser[b.user_id] ?? 0) + g
  }
  for (const c of comboBets) {
    const g = c.status === 'won' ? c.payout - c.stake : -c.stake
    pnlByUser[c.user_id] = (pnlByUser[c.user_id] ?? 0) + g
  }
  const topPnl = Object.entries(pnlByUser).filter(([, g]) => g > 0).sort((a, b) => b[1] - a[1])[0]
  if (topPnl) awardInputs.push({ user_id: topPnl[0], award_type: 'spieltagskoenig', value: topPnl[1], value_text: `+${topPnl[1].toFixed(2)} ${wildiLabel(topPnl[1])}` })

  // 2. Eier aus Stahl — highest won odds (singles OR combos)
  const bestWonSingle = [...wonSingles].sort((a: { odds_value: number }, b: { odds_value: number }) => b.odds_value - a.odds_value)[0]
  const bestWonCombo  = [...wonCombos].sort((a, b) => b.total_odds - a.total_odds)[0]
  const eiSOdds = bestWonSingle?.odds_value ?? 0
  const eiCOdds = bestWonCombo?.total_odds ?? 0
  if (eiSOdds > 0 || eiCOdds > 0) {
    if (eiSOdds >= eiCOdds && bestWonSingle) {
      awardInputs.push({ user_id: bestWonSingle.user_id, award_type: 'eier_aus_stahl', value: eiSOdds, value_text: `@${eiSOdds.toFixed(2).replace('.', ',')}` })
    } else if (bestWonCombo) {
      awardInputs.push({ user_id: bestWonCombo.user_id, award_type: 'eier_aus_stahl', value: eiCOdds, value_text: `@${eiCOdds.toFixed(2).replace('.', ',')}` })
    }
  }

  // 3. Unlucky Bastard — lost combo with exactly 1 lost leg, highest potential payout
  const legsByCombo: Record<number, { status: string }[]> = {}
  for (const l of allLegs) {
    if (!legsByCombo[l.combo_id]) legsByCombo[l.combo_id] = []
    legsByCombo[l.combo_id].push({ status: l.status })
  }
  // combo_bets has no is_risky column of its own — every leg carries the
  // same value (see lib/risky.ts), so any one leg reflects the combo's
  // classification. legBets is a superset of allLegs that still has it.
  const comboIsRiskyMap = new Map<number, boolean>()
  for (const l of legBets as { combo_id: unknown; is_risky?: boolean }[]) {
    const cid = Number(l.combo_id)
    if (!comboIsRiskyMap.has(cid)) comboIsRiskyMap.set(cid, !!l.is_risky)
  }
  const unlucky = lostCombos
    .map(c => ({ c, legs: legsByCombo[c.id] ?? [], lostCount: (legsByCombo[c.id] ?? []).filter(l => l.status === 'lost').length }))
    .filter(x => x.lostCount === 1 && x.legs.length >= 2 && x.legs.every(l => l.status !== 'pending'))
    .sort((a, b) => (b.c.stake * b.c.total_odds) - (a.c.stake * a.c.total_odds))[0]
  if (unlucky) {
    const potential = cappedPayout(unlucky.c.stake, unlucky.c.total_odds, comboIsRiskyMap.get(unlucky.c.id) ?? false)
    awardInputs.push({ user_id: unlucky.c.user_id, award_type: 'unlucky_bastard', value: potential, value_text: `${Math.round(potential)} ${wildiLabel(potential)} möglich` })
  }

  // 4. Ergebnis-Orakel — won exact_score bets; highest stake wins if multiple
  const exactWon = singleBets
    .filter((b: { market_type: string; status: string }) => b.market_type === 'exact_score' && b.status === 'won')
    .sort((a: { stake: number }, b: { stake: number }) => b.stake - a.stake)
  if (exactWon[0]) {
    awardInputs.push({ user_id: exactWon[0].user_id, award_type: 'ergebnis_orakel', value: exactWon[0].stake, value_text: exactWon[0].selection })
  }

  // 5. Griff ins Klo — worst NET Spieltag saldo (losses minus wins), the
  // mirror image of Spieltagskönig above. Previously this summed only lost
  // stakes, ignoring any bets the same user won that Spieltag — which read
  // as contradicting the per-user P&L shown right next to it (recap page,
  // leaderboard) whenever a user had both a loss and a win. Reusing
  // pnlByUser keeps this consistent with Spieltagskönig by construction.
  const worstPnl = Object.entries(pnlByUser).filter(([, g]) => g < 0).sort((a, b) => a[1] - b[1])[0]
  if (worstPnl) {
    const loss = Math.abs(worstPnl[1])
    awardInputs.push({ user_id: worstPnl[0], award_type: 'griff_ins_klo', value: loss, value_text: `${loss.toFixed(2)} ${wildiLabel(loss)} im Minus` })
  }

  // 6. Betonmischer — lowest odds among won bets (tiebreak: higher stake)
  const allWon = [
    ...wonSingles.map((b: { user_id: string; odds_value: number; stake: number; payout: number }) => ({ user_id: b.user_id, odds: b.odds_value, stake: b.stake })),
    ...wonCombos.map(c => ({ user_id: c.user_id, odds: c.total_odds, stake: c.stake })),
  ]
  if (allWon.length > 0) {
    allWon.sort((a, b) => a.odds - b.odds || b.stake - a.stake)
    const beton = allWon[0]
    awardInputs.push({ user_id: beton.user_id, award_type: 'betonmischer', value: beton.odds, value_text: `@${beton.odds.toFixed(2).replace('.', ',')}` })
  }

  // 7. On Fire — most won bet slips (singles + combos each = 1), min 2, tiebreak: saldo
  const wonSlips: Record<string, { count: number; pnl: number }> = {}
  for (const b of wonSingles) {
    const e = wonSlips[b.user_id] ?? { count: 0, pnl: 0 }
    wonSlips[b.user_id] = { count: e.count + 1, pnl: e.pnl + ((b.payout ?? 0) - b.stake) }
  }
  for (const c of wonCombos) {
    const e = wonSlips[c.user_id] ?? { count: 0, pnl: 0 }
    wonSlips[c.user_id] = { count: e.count + 1, pnl: e.pnl + (c.payout - c.stake) }
  }
  const fireEntry = Object.entries(wonSlips)
    .filter(([, { count }]) => count >= 2)
    .sort((a, b) => b[1].count - a[1].count || b[1].pnl - a[1].pnl)[0]
  if (fireEntry) {
    awardInputs.push({ user_id: fireEntry[0], award_type: 'on_fire', value: fireEntry[1].count, value_text: `${fireEntry[1].count} Wettscheine gewonnen` })
  }

  // 8. Großer Wurf — highest NET win among won SINGLE bets only (no combos).
  // Deliberately excludes combos: a combo win is really several legs
  // contributing together, which is what Spieltagskönig already celebrates —
  // scoping this to Einzelwetten keeps it a genuinely different category
  // instead of usually crowning the same person for the same reason.
  const netWinCandidates = wonSingles.map((b: { user_id: string; payout: number; stake: number }) => ({ user_id: b.user_id, net: (b.payout ?? 0) - b.stake }))
  if (netWinCandidates.length > 0) {
    netWinCandidates.sort((a, b) => b.net - a.net)
    const grosserWurf = netWinCandidates[0]
    awardInputs.push({ user_id: grosserWurf.user_id, award_type: 'grosser_wurf', value: grosserWurf.net, value_text: `+${grosserWurf.net.toFixed(2)} ${wildiLabel(grosserWurf.net)}` })
  }

  // 9. Torschützen-König — most won goalscorer bets by one user this Spieltag.
  // Tiebreak: higher odds among their won goalscorer picks (not summed
  // payout) — a rarer/bolder correct pick should win the tie, not just
  // whoever staked more.
  const goalscorerWon = [...wonSingles, ...legBets].filter(
    (b: { market_type: string; status: string }) => (b.market_type === 'goalscorer' || b.market_type === 'goalscorer_2plus') && b.status === 'won'
  )
  const goalscorerByUser: Record<string, { count: number; maxOdds: number }> = {}
  for (const b of goalscorerWon as { user_id: string; odds_value: number }[]) {
    const e = goalscorerByUser[b.user_id] ?? { count: 0, maxOdds: 0 }
    goalscorerByUser[b.user_id] = { count: e.count + 1, maxOdds: Math.max(e.maxOdds, b.odds_value) }
  }
  const torschuetzenEntry = Object.entries(goalscorerByUser)
    .filter(([, { count }]) => count >= 1)
    .sort((a, b) => b[1].count - a[1].count || b[1].maxOdds - a[1].maxOdds)[0]
  if (torschuetzenEntry) {
    const count = torschuetzenEntry[1].count
    awardInputs.push({
      user_id: torschuetzenEntry[0],
      award_type: 'torschuetzen_koenig',
      value: count,
      value_text: `${count} richtige${count === 1 ? 'r Torschützen-Tipp' : ' Torschützen-Tipps'}`,
    })
  }

  // 10. Last-Minute-Tipper — won bet placed less than 1h before its own
  // kickoff (single: the match's own kickoff; combo: the EARLIEST kickoff
  // among its legs, since that's when the whole slip stops being placeable).
  // Tiebreak: smallest gap to kickoff wins (most last-minute).
  const ONE_HOUR_MS = 60 * 60 * 1000
  const lastMinuteCandidates: { user_id: string; gapMs: number; kickoff: string; betId: number | null; comboId: number | null }[] = []
  for (const b of wonSingles as { id: number; user_id: string; match_id: number; created_at: string }[]) {
    const kickoff = matchDateMap.get(b.match_id)
    if (!kickoff) continue
    const gapMs = new Date(kickoff).getTime() - new Date(b.created_at).getTime()
    if (gapMs >= 0 && gapMs < ONE_HOUR_MS) lastMinuteCandidates.push({ user_id: b.user_id, gapMs, kickoff, betId: b.id, comboId: null })
  }
  for (const c of wonCombos as (CB & { created_at: string })[]) {
    const kickoff = comboEarliestKickoff.get(c.id)
    if (!kickoff) continue
    const gapMs = new Date(kickoff).getTime() - new Date(c.created_at).getTime()
    if (gapMs >= 0 && gapMs < ONE_HOUR_MS) lastMinuteCandidates.push({ user_id: c.user_id, gapMs, kickoff, betId: null, comboId: c.id })
  }
  if (lastMinuteCandidates.length > 0) {
    lastMinuteCandidates.sort((a, b) => a.gapMs - b.gapMs)
    const lm = lastMinuteCandidates[0]
    const gapMin = Math.round(lm.gapMs / 60000)
    // Under a minute, "0 Min." reads as a rounding error rather than the
    // extreme (most last-minute) case it actually is — switch to seconds so
    // e.g. an 18-second-before-kickoff bet shows as "18 Sek.", not "0 Min.".
    const gapSec = Math.round(lm.gapMs / 1000)
    const timeText = gapSec < 60 ? `${gapSec} Sek.` : `${gapMin} Min.`
    awardInputs.push({
      user_id: lm.user_id,
      award_type: 'last_minute_tipper',
      value: gapMin,
      value_text: `${timeText} vor Anpfiff gewettet — und gewonnen`,
      // The exact winning slip — same ref_bet_id/ref_combo_id mechanism as
      // Storno-Champ, so the UI can show the concrete bet instead of just
      // the match name (see getLastMinuteTipperWetteDetail below).
      ref_bet_id: lm.betId,
      ref_combo_id: lm.comboId,
    })
  }

  // 11. Storno-Champ — see computeStornoChamp() below (shared with the live
  // recap preview on tipps/page.tsx and leaderboard/page.tsx, so persisted
  // award, live preview and Pokalschrank can never disagree).
  const stornoWinner = await computeStornoChamp(admin, matchIds)
  if (stornoWinner) {
    awardInputs.push({
      user_id: stornoWinner.user_id,
      award_type: 'storno_champ',
      value: stornoWinner.net,
      value_text: `+${Math.round(stornoWinner.net)} ${wildiLabel(stornoWinner.net)} verschenkt — diese stornierte Wette (${stornoWinner.label}) wäre aufgegangen`,
      ref_bet_id: stornoWinner.betId,
      ref_combo_id: stornoWinner.comboId,
    })
  }

  const toPersist = onlyTypes ? awardInputs.filter(a => onlyTypes.includes(a.award_type)) : awardInputs
  await persistAwards(admin, season, matchday, toPersist, onlyTypes ?? ALL_AWARD_TYPES)
  return toPersist.length
}

/**
 * Storno-Champ: highest FORGONE net profit among slips a user THEMSELVES
 * cancelled (not any other reason a bet can end up `status='void'`) that,
 * per the actual final results, would have won outright. Never credits
 * Wildis — pure recap/award, reconstructed entirely from the
 * selection/odds/stake still preserved on the void row (cancellation never
 * touches those columns, only `status`/`void_reason`).
 *
 * `status='void'` is NOT by itself proof of a user-initiated storno —
 * app/api/admin/goalscorers/cancel-player/route.ts sets the exact same
 * status when an admin marks a goalscorer as no longer available, which
 * auto-cancels every bet (and, for a combo, ALL its legs regardless of
 * market) touching that player. Only `void_reason = 'user_cancelled'` (set
 * exclusively by app/api/bets/cancel/route.ts, see migration
 * add_void_reason_to_bets_and_combo_bets) counts here — deliberately NOT a
 * "no goalscorer leg means it's probably fine" heuristic for older rows.
 * Reliable storno tracking only exists from the moment that column was
 * introduced; every void row from before it (`void_reason IS NULL`) is
 * excluded outright, full stop, with no attempt to guess its origin — in
 * practice this means Storno-Champ simply doesn't exist for any Spieltag
 * settled before the column existed (every match up to and including
 * Spieltag 7 had already kicked off, so no bet on it could still be
 * cancelled afterward — there is no way for a pre-migration Spieltag to
 * ever pick up a `user_cancelled` row after the fact).
 *
 * A slip the user simply RE-PLACED is not a storno and never becomes a
 * candidate — cancelling a bet to raise its stake and immediately backing the
 * same selection again forgoes nothing. See loadStornoReplacements for what
 * counts as the same bet.
 *
 * A combo counts only if EVERY leg would have won, evaluated with the exact
 * same settleBet() switch the real settlement route uses, so this can never
 * disagree with how a real bet on the same market/selection would have been
 * graded. Returns null if no reliably-user-cancelled slip would have won —
 * including, naturally, while the relevant matches haven't finished yet
 * (wouldWin() returns null/not-true for anything not yet decided), so a
 * live-preview caller mid-Spieltag simply gets "no award yet" rather than a
 * false/premature one.
 *
 * Tie-break for two candidates with equal net: none beyond stable array
 * order (singles before combos, then DB row order) — the same "first in
 * wins ties" behaviour every other award in this file already has (e.g.
 * spieltagskoenig's `.sort(...)[0]` over `Object.entries`); no award in
 * this module defines an explicit secondary tiebreak.
 */
/** Identity of a single: the same user backing the same selection on the same
 *  match — stake and odds deliberately excluded, see loadStornoReplacements. */
function singleSelectionKey(userId: string, matchId: number, marketType: string, selection: string): string {
  return `${userId}|${matchId}|${marketType}|${selection}`
}

/** Identity of a combo: its set of legs, order-independent. Two combos with the
 *  same legs are the same bet even if the slip was built in another sequence. */
function comboLegKey(legs: { match_id: number; market_type: string; selection: string }[]): string {
  return legs.map((l) => `${l.match_id}|${l.market_type}|${l.selection}`).sort().join('#')
}

/**
 * Which cancelled slips were merely RE-PLACED rather than given up.
 *
 * Storno-Champ is about forgone profit: "du hättest gewonnen, aber du hast die
 * Wette weggeworfen". That premise fails when the user still holds the very
 * same pick — the classic case being a stake correction, where they cancel and
 * immediately re-place the identical selection with a different amount
 * (observed: Wildenroth II −1,5 @ 2,94 storniert mit 126,50, 86 Sekunden später
 * erneut mit 250,00 gesetzt und gewonnen). Nothing was forgone there, so such a
 * slip is not a candidate at all.
 *
 * Deliberate choices:
 *  - **Stake is not part of the identity.** Higher, lower or equal — the pick
 *    was kept, which is the only thing this award is about. The same holds for
 *    the odds: re-placing after a freeze can legitimately produce a different
 *    price for the same selection.
 *  - **No timestamp comparison.** The void row's `created_at` is when the bet
 *    was PLACED, not when it was cancelled (cancellation leaves no timestamp),
 *    so "the replacement came later" is not reliably derivable. It is also not
 *    needed: what matters is whether a live bet on that selection exists at
 *    settlement time, not in which order the two rows appeared.
 *  - **Singles match singles, combos match combos.** A single re-placed as a
 *    leg inside a combo is not the same bet — its payout now depends on other
 *    legs. Conversely a combo dissolved into singles genuinely forgoes the
 *    combined odds. Only a non-void combo with an IDENTICAL leg set counts as
 *    a re-placement of a cancelled combo.
 */
async function loadStornoReplacements(
  admin: SupabaseClient,
  opts: {
    userIds: string[]
    matchIds: number[]
    voidCombos: { id: number; user_id: string; legKey: string }[]
  },
): Promise<{ replacedSelections: Set<string>; replacedCombos: Set<number> }> {
  const empty = { replacedSelections: new Set<string>(), replacedCombos: new Set<number>() }
  if (opts.userIds.length === 0 || opts.matchIds.length === 0) return empty

  const { data: ownRowsRaw } = await admin
    .from('bets')
    .select('user_id, match_id, market_type, selection, status, combo_id')
    .in('match_id', opts.matchIds)
    .in('user_id', opts.userIds)
  const ownRows = (ownRowsRaw ?? []) as {
    user_id: string; match_id: number; market_type: string; selection: string; status: string; combo_id: number | null
  }[]

  const replacedSelections = new Set(
    ownRows
      .filter((r) => r.status !== 'void' && r.combo_id == null)
      .map((r) => singleSelectionKey(r.user_id, r.match_id, r.market_type, r.selection))
  )

  const replacedCombos = new Set<number>()
  const liveComboIds = [...new Set(
    ownRows.filter((r) => r.status !== 'void' && r.combo_id != null).map((r) => Number(r.combo_id))
  )]
  if (opts.voidCombos.length > 0 && liveComboIds.length > 0) {
    // The full leg set of each live combo — legs may sit on matches outside
    // this Spieltag, so this cannot be read off ownRows.
    const { data: liveLegRows } = await admin
      .from('bets')
      .select('combo_id, user_id, match_id, market_type, selection')
      .in('combo_id', liveComboIds)
    const legsByCombo = new Map<number, { match_id: number; market_type: string; selection: string }[]>()
    const userByCombo = new Map<number, string>()
    for (const l of (liveLegRows ?? []) as { combo_id: number; user_id: string; match_id: number; market_type: string; selection: string }[]) {
      const cid = Number(l.combo_id)
      if (!legsByCombo.has(cid)) legsByCombo.set(cid, [])
      legsByCombo.get(cid)!.push(l)
      userByCombo.set(cid, l.user_id)
    }
    const liveKeys = new Set(
      [...legsByCombo.entries()].map(([cid, legs]) => `${userByCombo.get(cid)}|${comboLegKey(legs)}`)
    )
    for (const vc of opts.voidCombos) {
      if (liveKeys.has(`${vc.user_id}|${vc.legKey}`)) replacedCombos.add(vc.id)
    }
  }

  return { replacedSelections, replacedCombos }
}

export async function computeStornoChamp(
  admin: SupabaseClient,
  matchIds: number[],
): Promise<{ user_id: string; net: number; label: string; betId: number | null; comboId: number | null } | null> {
  if (matchIds.length === 0) return null

  // matchday_special bets are excluded here: their match_id is only the
  // Spieltag's representative_match_id (technical FK anchor, see
  // lib/matchdaySpecials.ts), and wouldWin() below delegates to settleBet(),
  // which has no case for 'matchday_special' and falls through to its
  // `default: return 'lost'` — always false, regardless of the real outcome.
  // Rather than silently mis-grade a cancelled Special as an always-losing
  // Storno-Champ candidate, it's excluded from candidacy entirely.
  const { data: voidSinglesRaw } = await admin
    .from('bets')
    .select('id, user_id, match_id, market_type, selection, odds_value, stake, is_risky, combo_id, void_reason')
    .in('match_id', matchIds)
    .eq('status', 'void')
    .eq('void_reason', 'user_cancelled')
    .is('combo_id', null)
    .neq('market_type', 'matchday_special')
  const voidSingles = (voidSinglesRaw ?? []) as { id: number; user_id: string; match_id: number; market_type: string; selection: string; odds_value: number; stake: number | null; is_risky: boolean }[]

  const { data: voidComboLegsHere } = await admin
    .from('bets')
    .select('combo_id')
    .in('match_id', matchIds)
    .eq('status', 'void')
    .not('combo_id', 'is', null)
  const voidComboIdsHere = [...new Set((voidComboLegsHere ?? []).map((l) => Number(l.combo_id)))]

  type VoidCombo = { id: number; user_id: string; stake: number; total_odds: number; void_reason: string | null }
  let voidCombos: VoidCombo[] = []
  let voidComboAllLegs: { combo_id: number; match_id: number; market_type: string; selection: string; is_risky: boolean }[] = []
  if (voidComboIdsHere.length > 0) {
    const { data: cbData } = await admin
      .from('combo_bets')
      .select('id, user_id, stake, total_odds, status, void_reason')
      .in('id', voidComboIdsHere)
      .eq('status', 'void')
      .eq('void_reason', 'user_cancelled')
    voidCombos = (cbData ?? []) as VoidCombo[]
    const ownedIds = new Set(voidCombos.map((c) => c.id))
    const { data: legData } = await admin
      .from('bets')
      .select('combo_id, match_id, market_type, selection, is_risky')
      .in('combo_id', voidComboIdsHere)
    const allLegsForOwned = ((legData ?? []) as { combo_id: number; match_id: number; market_type: string; selection: string; is_risky: boolean }[])
      .filter((l) => ownedIds.has(Number(l.combo_id)))
    // A combo containing a matchday_special leg can't be correctly evaluated
    // by wouldWin() (same settleBet limitation as the singles case above) —
    // excluding the whole combo, not just that leg, since a wrongly-graded
    // leg would otherwise silently decide the combo's own would-win result.
    const comboIdsWithSpecialLeg = new Set(allLegsForOwned.filter((l) => l.market_type === 'matchday_special').map((l) => l.combo_id))
    voidCombos = voidCombos.filter((c) => !comboIdsWithSpecialLeg.has(c.id))
    voidComboAllLegs = allLegsForOwned.filter((l) => !comboIdsWithSpecialLeg.has(l.combo_id))
  }

  const evalMatchIds = [...new Set([
    ...voidSingles.map((b) => b.match_id),
    ...voidComboAllLegs.map((l) => l.match_id),
  ])]

  // Re-placed slips are not stornos — see replacedSelections/replacedCombos below.
  const { replacedSelections, replacedCombos } = await loadStornoReplacements(admin, {
    userIds: [...new Set([...voidSingles.map((b) => b.user_id), ...voidCombos.map((c) => c.user_id)])],
    matchIds: evalMatchIds,
    voidCombos: voidCombos.map((c) => ({
      id: c.id,
      user_id: c.user_id,
      legKey: comboLegKey(voidComboAllLegs.filter((l) => Number(l.combo_id) === c.id)),
    })),
  })
  const { data: evalMatchesRaw } = evalMatchIds.length > 0
    ? await admin
        .from('matches')
        .select('id, home_score, away_score, status, cup_shootout_winner, cup_first_goal_team, cup_halftime_home_goals, cup_halftime_away_goals, cup_away_team_led, cup_first_goal_minute')
        .in('id', evalMatchIds)
    : { data: [] as never[] }
  const evalMatchById = new Map((evalMatchesRaw ?? []).map((m) => [m.id, m]))

  function wouldWin(marketType: string, selection: string, matchId: number): boolean | null {
    const m = evalMatchById.get(matchId)
    if (!m || m.status !== 'finished' || m.home_score == null || m.away_score == null) return null
    return settleBet(
      marketType, selection, m.home_score, m.away_score,
      m.cup_shootout_winner as 'home' | 'away' | null | undefined,
      m.cup_first_goal_team as 'home' | 'away' | 'none' | null | undefined,
      m.cup_halftime_home_goals, m.cup_halftime_away_goals,
      m.cup_away_team_led, m.cup_first_goal_minute,
    ) === 'won'
  }

  const stornoCandidates: { user_id: string; net: number; label: string; betId: number | null; comboId: number | null }[] = []
  for (const b of voidSingles) {
    if (replacedSelections.has(singleSelectionKey(b.user_id, b.match_id, b.market_type, b.selection))) continue
    if (wouldWin(b.market_type, b.selection, b.match_id) !== true) continue
    const payout = cappedPayout(b.stake ?? 0, b.odds_value, b.is_risky)
    const net = payout - (b.stake ?? 0)
    if (net > 0) stornoCandidates.push({ user_id: b.user_id, net, label: `@${b.odds_value.toFixed(2).replace('.', ',')}`, betId: b.id, comboId: null })
  }
  for (const c of voidCombos) {
    if (replacedCombos.has(c.id)) continue
    const legs = voidComboAllLegs.filter((l) => Number(l.combo_id) === c.id)
    if (legs.length === 0) continue
    const allWon = legs.every((l) => wouldWin(l.market_type, l.selection, l.match_id) === true)
    if (!allWon) continue
    const isRisky = legs.some((l) => l.is_risky)
    const payout = cappedPayout(c.stake, c.total_odds, isRisky)
    const net = payout - c.stake
    if (net > 0) stornoCandidates.push({ user_id: c.user_id, net, label: `Kombi (${legs.length} Tipps)`, betId: null, comboId: c.id })
  }
  return stornoCandidates.sort((a, b) => b.net - a.net)[0] ?? null
}

export interface StornoChampLegDetail {
  matchName: string
  market: string
  selection: string
  odds: number
  finalScore: string | null
}

export interface StornoChampWetteDetail {
  isCombo: boolean
  stake: number
  odds: number
  theoreticalPayout: number
  net: number
  matchName?: string
  market?: string
  selection?: string
  finalScore?: string | null
  legs?: StornoChampLegDetail[]
}

/**
 * The single shared data-fetch behind the Storno-Champ detail view — used
 * by the click-to-expand sheet from ALL three places it can appear (live
 * recap preview, persisted /recap/[matchday], Pokalschrank), via one API
 * route (app/api/awards/storno-champ-detail/route.ts), so there is exactly
 * one implementation of "what was this stornoed bet" rather than three.
 * Takes the SAME ref_bet_id/ref_combo_id persisted on the award row (or
 * returned live by computeStornoChamp) — never re-derives "some other
 * successful storno" of the same user. Returns null if the referenced
 * bet/combo no longer exists (e.g. hard-deleted) so the caller can show a
 * graceful "nicht mehr verfügbar" message instead of crashing.
 */
export async function getStornoChampWetteDetail(
  admin: SupabaseClient,
  ref: { betId: number | null; comboId: number | null },
): Promise<StornoChampWetteDetail | null> {
  if (ref.betId != null) {
    const { data: bet } = await admin
      .from('bets')
      .select('market_type, selection, odds_value, stake, is_risky, match_id')
      .eq('id', ref.betId)
      .single()
    if (!bet) return null
    const { data: match } = await admin
      .from('matches')
      .select('home_score, away_score, status, home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name)')
      .eq('id', bet.match_id)
      .single()
    if (!match) return null
    const ht = Array.isArray(match.home_team) ? match.home_team[0] : match.home_team
    const at = Array.isArray(match.away_team) ? match.away_team[0] : match.away_team
    const finalScore = match.status === 'finished' && match.home_score != null ? `${match.home_score}:${match.away_score}` : null
    const theoreticalPayout = cappedPayout(bet.stake ?? 0, bet.odds_value, bet.is_risky)
    return {
      isCombo: false,
      stake: bet.stake ?? 0,
      odds: bet.odds_value,
      theoreticalPayout,
      net: theoreticalPayout - (bet.stake ?? 0),
      matchName: `${ht?.name ?? '?'} – ${at?.name ?? '?'}`,
      market: MARKET_LABELS[bet.market_type] ?? bet.market_type,
      selection: bet.selection,
      finalScore,
    }
  }
  if (ref.comboId != null) {
    const { data: combo } = await admin
      .from('combo_bets')
      .select('stake, total_odds')
      .eq('id', ref.comboId)
      .single()
    if (!combo) return null
    const { data: legsRaw } = await admin
      .from('bets')
      .select('market_type, selection, odds_value, is_risky, match_id')
      .eq('combo_id', ref.comboId)
    const legs = legsRaw ?? []
    if (legs.length === 0) return null
    const matchIds = [...new Set(legs.map((l) => l.match_id))]
    const { data: matchesRaw } = await admin
      .from('matches')
      .select('id, home_score, away_score, status, home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name)')
      .in('id', matchIds)
    const matchById = new Map((matchesRaw ?? []).map((m) => [m.id, m]))
    const isRisky = legs.some((l) => l.is_risky)
    const theoreticalPayout = cappedPayout(combo.stake, combo.total_odds, isRisky)
    return {
      isCombo: true,
      stake: combo.stake,
      odds: combo.total_odds,
      theoreticalPayout,
      net: theoreticalPayout - combo.stake,
      legs: legs.map((l) => {
        const m = matchById.get(l.match_id)
        const ht = m ? (Array.isArray(m.home_team) ? m.home_team[0] : m.home_team) : null
        const at = m ? (Array.isArray(m.away_team) ? m.away_team[0] : m.away_team) : null
        return {
          matchName: `${ht?.name ?? '?'} – ${at?.name ?? '?'}`,
          market: MARKET_LABELS[l.market_type] ?? l.market_type,
          selection: l.selection,
          odds: l.odds_value,
          finalScore: m?.status === 'finished' && m.home_score != null ? `${m.home_score}:${m.away_score}` : null,
        }
      }),
    }
  }
  return null
}

export interface LastMinuteTipperLegDetail {
  matchName: string
  market: string
  selection: string
  odds: number
}

export interface LastMinuteTipperWetteDetail {
  isCombo: boolean
  odds: number
  matchName?: string
  market?: string
  selection?: string
  legs?: LastMinuteTipperLegDetail[]
}

/**
 * The exact winning slip behind a Last-Minute-Tipper award — same shape as
 * getStornoChampWetteDetail, but for a real WON bet, not a hypothetical
 * stornoed one. Takes the ref_bet_id/ref_combo_id persisted on the award row
 * (computeAndPersistMatchdayAwards below), never re-derives "some other
 * last-minute win" of the same user. Selection labels go through
 * plainSelectionLabel — the same central mapping bet history/offene Wetten
 * use — so a raw code (`over_35`, `cup_shootout_advance_yes`, a bare player
 * id) never reaches the caller.
 */
export async function getLastMinuteTipperWetteDetail(
  admin: SupabaseClient,
  ref: { betId: number | null; comboId: number | null },
): Promise<LastMinuteTipperWetteDetail | null> {
  // matchday_special legs need the special's own options to resolve their
  // selection; goalscorer legs need a player name. Both are rare enough here
  // (only if the last-minute bet itself was on one) that loading them lazily
  // per call is fine — this runs once per award, not per bet-history row.
  async function resolveLeg(l: { market_type: string; selection: string; special_id: number | null }): Promise<string> {
    if (l.market_type === 'goalscorer' || l.market_type === 'goalscorer_2plus') {
      const { data: player } = await admin.from('wildenroth_players').select('name').eq('id', parseInt(l.selection, 10)).single()
      return plainSelectionLabel(l.market_type, l.selection, undefined, player ? { [parseInt(l.selection, 10)]: player.name } : undefined)
    }
    if (l.market_type === 'matchday_special' && l.special_id != null) {
      const { data: specialRow } = await admin
        .from('matchday_specials')
        .select('matchday, template_key, options, settlement_result')
        .eq('id', l.special_id)
        .single()
      return plainSelectionLabel(l.market_type, l.selection, specialRow as SpecialDisplayInfo | undefined)
    }
    return plainSelectionLabel(l.market_type, l.selection)
  }

  if (ref.betId != null) {
    const { data: bet } = await admin
      .from('bets')
      .select('market_type, selection, odds_value, match_id, special_id')
      .eq('id', ref.betId)
      .single()
    if (!bet) return null
    if (bet.market_type === 'matchday_special') {
      const { data: specialRow } = bet.special_id != null
        ? await admin.from('matchday_specials').select('matchday, template_key, options, settlement_result').eq('id', bet.special_id).single()
        : { data: null }
      return {
        isCombo: false,
        odds: bet.odds_value,
        matchName: specialRow ? `Spieltag ${specialRow.matchday}` : 'Spieltag-Special',
        market: MARKET_LABELS[bet.market_type] ?? bet.market_type,
        selection: await resolveLeg(bet),
      }
    }
    const { data: match } = await admin
      .from('matches')
      .select('home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name)')
      .eq('id', bet.match_id)
      .single()
    if (!match) return null
    const ht = Array.isArray(match.home_team) ? match.home_team[0] : match.home_team
    const at = Array.isArray(match.away_team) ? match.away_team[0] : match.away_team
    return {
      isCombo: false,
      odds: bet.odds_value,
      matchName: `${ht?.name ?? '?'} – ${at?.name ?? '?'}`,
      market: MARKET_LABELS[bet.market_type] ?? bet.market_type,
      selection: await resolveLeg(bet),
    }
  }
  if (ref.comboId != null) {
    const { data: combo } = await admin.from('combo_bets').select('total_odds').eq('id', ref.comboId).single()
    if (!combo) return null
    const { data: legsRaw } = await admin
      .from('bets')
      .select('market_type, selection, odds_value, match_id, special_id')
      .eq('combo_id', ref.comboId)
    const legs = legsRaw ?? []
    if (legs.length === 0) return null
    const matchIds = [...new Set(legs.filter((l) => l.market_type !== 'matchday_special').map((l) => l.match_id))]
    const { data: matchesRaw } = matchIds.length > 0
      ? await admin.from('matches').select('id, home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name)').in('id', matchIds)
      : { data: [] as never[] }
    const matchById = new Map((matchesRaw ?? []).map((m) => [m.id, m]))
    return {
      isCombo: true,
      odds: combo.total_odds,
      legs: await Promise.all(legs.map(async (l) => {
        if (l.market_type === 'matchday_special') {
          const { data: specialRow } = l.special_id != null
            ? await admin.from('matchday_specials').select('matchday, template_key, options, settlement_result').eq('id', l.special_id).single()
            : { data: null }
          return {
            matchName: specialRow ? `Spieltag ${specialRow.matchday}` : 'Spieltag-Special',
            market: MARKET_LABELS[l.market_type] ?? l.market_type,
            selection: await resolveLeg(l),
            odds: l.odds_value,
          }
        }
        const m = matchById.get(l.match_id)
        const ht = m ? (Array.isArray(m.home_team) ? m.home_team[0] : m.home_team) : null
        const at = m ? (Array.isArray(m.away_team) ? m.away_team[0] : m.away_team) : null
        return {
          matchName: `${ht?.name ?? '?'} – ${at?.name ?? '?'}`,
          market: MARKET_LABELS[l.market_type] ?? l.market_type,
          selection: await resolveLeg(l),
          odds: l.odds_value,
        }
      })),
    }
  }
  return null
}
