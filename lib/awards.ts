import { SupabaseClient } from '@supabase/supabase-js'
import { wildiLabel } from '@/components/WildiIcon'
import { buildEffectiveMatchdayIndex, recapMatchdayOf } from '@/lib/season'
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

export const AWARD_META: Record<AwardType, { title: string; icon: string; description: string }> = {
  spieltagskoenig: { icon: '🏆', title: 'Spieltagskönig',    description: 'Bester Spieltagssaldo' },
  eier_aus_stahl:  { icon: '🥚', title: 'Eier aus Stahl',    description: 'Höchste gewonnene Quote' },
  unlucky_bastard: { icon: '😭', title: 'Unlucky Bastard',   description: 'Nur ein Tipp von einem großen Gewinn entfernt' },
  ergebnis_orakel: { icon: '🔮', title: 'Ergebnis-Orakel',   description: 'Exaktes Ergebnis richtig getippt' },
  griff_ins_klo:   { icon: '🚽', title: 'Griff ins Klo',     description: 'Höchster Gesamtverlust am Spieltag' },
  betonmischer:    { icon: '🧱', title: 'Betonmischer',       description: 'Sicherster gewonnener Tipp' },
  on_fire:         { icon: '🔥', title: 'On Fire',            description: 'Meiste gewonnene Wettscheine' },
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
  matchIds: number[]
) {
  if (matchday === 999 || matchIds.length === 0) return

  const { data: rawBets } = await admin
    .from('bets')
    .select('user_id, match_id, stake, odds_value, payout, status, is_risky, combo_id, market_type, selection')
    .in('match_id', matchIds)
    .in('status', ['won', 'lost'])
  const allBets = rawBets ?? []
  const singleBets = allBets.filter((b: { combo_id: unknown }) => !b.combo_id)
  const legBets = allBets.filter((b: { combo_id: unknown }) => b.combo_id)
  const comboIds = [...new Set(legBets.map((b: { combo_id: unknown }) => Number(b.combo_id)))]

  // Fetch all combo_bets (won + lost) for these combos
  type CB = { id: number; user_id: string; stake: number; total_odds: number; payout: number; status: string }
  let comboBets: CB[] = []
  // Also fetch ALL legs of these combos (may include legs outside this matchday)
  let allLegs: { combo_id: number; status: string }[] = []
  if (comboIds.length > 0) {
    const { data: cbData } = await admin
      .from('combo_bets')
      .select('id, user_id, stake, total_odds, payout, status')
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
  const lostSingles = singleBets.filter((b: { status: string }) => b.status === 'lost')
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
  const unlucky = lostCombos
    .map(c => ({ c, legs: legsByCombo[c.id] ?? [], lostCount: (legsByCombo[c.id] ?? []).filter(l => l.status === 'lost').length }))
    .filter(x => x.lostCount === 1 && x.legs.length >= 2 && x.legs.every(l => l.status !== 'pending'))
    .sort((a, b) => (b.c.stake * b.c.total_odds) - (a.c.stake * a.c.total_odds))[0]
  if (unlucky) {
    const potential = unlucky.c.stake * unlucky.c.total_odds
    awardInputs.push({ user_id: unlucky.c.user_id, award_type: 'unlucky_bastard', value: potential, value_text: `${Math.round(potential)} ${wildiLabel(potential)} möglich` })
  }

  // 4. Ergebnis-Orakel — won exact_score bets; highest stake wins if multiple
  const exactWon = singleBets
    .filter((b: { market_type: string; status: string }) => b.market_type === 'exact_score' && b.status === 'won')
    .sort((a: { stake: number }, b: { stake: number }) => b.stake - a.stake)
  if (exactWon[0]) {
    awardInputs.push({ user_id: exactWon[0].user_id, award_type: 'ergebnis_orakel', value: exactWon[0].stake, value_text: exactWon[0].selection })
  }

  // 5. Griff ins Klo — highest TOTAL lost stake across the whole Spieltag
  // (all of a user's lost singles + lost combos summed), not the single
  // biggest lost bet — the max stake is 250, so a "highest single lost
  // stake" award trivially converges on "whoever lost a 250er", regardless
  // of how much else they lost that Spieltag. Tiebreak: higher potential
  // payout summed the same way (stake × odds per lost slip, totalled).
  const lostTotalsByUser = new Map<string, { total: number; potential: number }>()
  for (const b of lostSingles as { user_id: string; stake: number; odds_value: number }[]) {
    const e = lostTotalsByUser.get(b.user_id) ?? { total: 0, potential: 0 }
    e.total += b.stake
    e.potential += b.stake * b.odds_value
    lostTotalsByUser.set(b.user_id, e)
  }
  for (const c of lostCombos) {
    const e = lostTotalsByUser.get(c.user_id) ?? { total: 0, potential: 0 }
    e.total += c.stake
    e.potential += c.stake * c.total_odds
    lostTotalsByUser.set(c.user_id, e)
  }
  const griffWinner = [...lostTotalsByUser.entries()]
    .map(([user_id, e]) => ({ user_id, ...e }))
    .sort((a, b) => b.total - a.total || b.potential - a.potential)[0]
  if (griffWinner) {
    awardInputs.push({ user_id: griffWinner.user_id, award_type: 'griff_ins_klo', value: griffWinner.total, value_text: `${griffWinner.total} ${wildiLabel(griffWinner.total)} versenkt` })
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

  await persistAwards(admin, season, matchday, awardInputs)
}
