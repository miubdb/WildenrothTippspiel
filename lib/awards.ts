import { SupabaseClient } from '@supabase/supabase-js'
import { wildiLabel } from '@/components/WildiIcon'
import { buildEffectiveMatchdayIndex, recapMatchdayOf } from '@/lib/season'
import { cappedPayout } from '@/lib/payout'
import type { Match } from '@/types'

const SEASON_START = '2026-08-01'

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

export const AWARD_META: Record<AwardType, { title: string; icon: string; description: string }> = {
  spieltagskoenig: { icon: '🏆', title: 'Spieltagskönig',    description: 'Bester Spieltagssaldo' },
  eier_aus_stahl:  { icon: '🥚', title: 'Eier aus Stahl',    description: 'Höchste gewonnene Quote' },
  unlucky_bastard: { icon: '😭', title: 'Unlucky Bastard',   description: 'Nur ein Tipp von einem großen Gewinn entfernt' },
  ergebnis_orakel: { icon: '🔮', title: 'Ergebnis-Orakel',   description: 'Exaktes Ergebnis richtig getippt' },
  griff_ins_klo:   { icon: '🚽', title: 'Griff ins Klo',     description: 'Schlechtester Netto-Saldo am Spieltag' },
  betonmischer:    { icon: '🧱', title: 'Betonmischer',       description: 'Sicherster gewonnener Tipp' },
  on_fire:         { icon: '🔥', title: 'On Fire',            description: 'Meiste gewonnene Wettscheine' },
  // Deliberately Einzelwette-only (no combos) — a combo's win is really a
  // Spieltagskönig-flavored story (several legs contributing), so scoping
  // this to single bets keeps it a genuinely different category instead of
  // usually crowning the same person as Spieltagskönig for the same reason.
  grosser_wurf:        { icon: '🎯', title: 'Volltreffer',           description: 'Höchster Gewinn mit einer Einzelwette am Spieltag' },
  torschuetzen_koenig: { icon: '⚽', title: 'Torschützen-König',     description: 'Meiste richtige Torschützen-Tipps am Spieltag' },
  last_minute_tipper:  { icon: '⏱️', title: 'Last-Minute-Tipper',   description: 'Gewonnene Wette, weniger als 1 Std. vor Anpfiff platziert' },
}

export interface AwardInput {
  user_id: string
  award_type: AwardType
  value?: number
  value_text?: string
}

export async function persistAwards(
  supabase: SupabaseClient,
  season: string,
  matchday: number,
  awards: AwardInput[]
) {
  if (matchday === 999) return
  // Award winners can change on a recompute (e.g. a postponed match settles
  // later, or goalscorer bets settle after the matchday's other bets did) —
  // the upsert below only overwrites a row that stays keyed to the SAME user,
  // so a changed winner would otherwise leave the old winner's row in place
  // alongside the new one. Clear every award type being recomputed for this
  // (season, matchday) first so a recompute always fully replaces the old set.
  const types = [...new Set(awards.map(a => a.award_type))]
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
    .select('user_id, match_id, stake, odds_value, payout, status, is_risky, combo_id, market_type, selection, created_at')
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
  const lastMinuteCandidates: { user_id: string; gapMs: number; kickoff: string }[] = []
  for (const b of wonSingles as { user_id: string; match_id: number; created_at: string }[]) {
    const kickoff = matchDateMap.get(b.match_id)
    if (!kickoff) continue
    const gapMs = new Date(kickoff).getTime() - new Date(b.created_at).getTime()
    if (gapMs >= 0 && gapMs < ONE_HOUR_MS) lastMinuteCandidates.push({ user_id: b.user_id, gapMs, kickoff })
  }
  for (const c of wonCombos as (CB & { created_at: string })[]) {
    const kickoff = comboEarliestKickoff.get(c.id)
    if (!kickoff) continue
    const gapMs = new Date(kickoff).getTime() - new Date(c.created_at).getTime()
    if (gapMs >= 0 && gapMs < ONE_HOUR_MS) lastMinuteCandidates.push({ user_id: c.user_id, gapMs, kickoff })
  }
  if (lastMinuteCandidates.length > 0) {
    lastMinuteCandidates.sort((a, b) => a.gapMs - b.gapMs)
    const lm = lastMinuteCandidates[0]
    const gapMin = Math.round(lm.gapMs / 60000)
    awardInputs.push({
      user_id: lm.user_id,
      award_type: 'last_minute_tipper',
      value: gapMin,
      value_text: `${gapMin} Min. vor Anpfiff gewettet — und gewonnen`,
    })
  }

  const toPersist = onlyTypes ? awardInputs.filter(a => onlyTypes.includes(a.award_type)) : awardInputs
  await persistAwards(admin, season, matchday, toPersist)
  return toPersist.length
}
