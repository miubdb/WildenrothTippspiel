import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPushToAll } from '@/lib/push'
import { buildEffectiveMatchdayIndex, effectiveMatchdayOf, recapMatchdayOf, SEASON_START } from '@/lib/season'
import { computeAndPersistMatchdayAwards } from '@/lib/awards'
import { settleActiveMatchdaySpecials } from '@/lib/matchdaySpecials'
import { canFinalizeMatchday, type CompletionPendingBet, type CompletionSpecial } from '@/lib/matchdayFinishReadiness'
import type { Match } from '@/types'
const CURRENT_SEASON = '26/27'
const INACTIVITY_PENALTY = 50
/** Credited to every eligible player once per completed Spieltag — the
 *  counterpart to INACTIVITY_PENALTY, which is also charged per Spieltag.
 *  Replaced the old weekly Monday-noon cron (add_weekly_pocket_money) so both
 *  sides of the balance now follow the same rhythm: no Spieltag, no booking
 *  (e.g. during the winter break), and a midweek catch-up Spieltag pays out
 *  like any other. Paid regardless of whether the player bet — its purpose is
 *  letting someone who ran out of Wildis back into the game. */
const POCKET_MONEY_PER_MATCHDAY = 10

/**
 * "Did settling this one match just complete its whole Spieltag's story?" —
 * if so, persist awards, send the recap push, apply the inactivity penalty
 * and credit the per-Spieltag pocket money, each exactly once. Called from
 * BOTH app/api/admin/settle/route.ts
 * (after a match's score is entered) and
 * app/api/admin/goalscorers/scorers/route.ts (after goalscorer bets settle,
 * which can be the LAST thing to resolve for a Spieltag — a goalscorer-only
 * settlement used to skip this whole block entirely, silently dropping the
 * recap push and the inactivity penalty for that Spieltag).
 *
 * Two different Spieltag groupings are in play here, deliberately — see
 * lib/season.ts's doc comments on effectiveMatchdayOf/recapMatchdayOf:
 *  - recapMatchdayOf: which Spieltag's STORY this match belongs to (awards,
 *    recap push, "is this Spieltag done" — a badly rescheduled match is
 *    folded into whichever Spieltag it actually landed near).
 *  - effectiveMatchdayOf: which Spieltag tab a bet was actually placed under
 *    (used only for the inactivity fairness check — a user who bet on a
 *    match shown under Spieltag X's tab must count as active for X even if
 *    that match is later a recap-outlier reassigned elsewhere for awards).
 */
export async function finalizeMatchdayIfDone(admin: SupabaseClient, matchId: number): Promise<void> {
  const { data: matchInfo } = await admin
    .from('matches')
    .select('id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status, match_category, is_topspiel, tippspiel_matchday')
    .eq('id', matchId)
    .single()
  if (!matchInfo) return

  const { data: seasonMatchesRaw } = await admin
    .from('matches')
    .select('id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status, match_category, is_topspiel, tippspiel_matchday')
    .or(`match_date.gte.${SEASON_START},matchday.eq.999`)
  const seasonMatchesForMd = (seasonMatchesRaw ?? []) as Match[]
  const mdIndex = buildEffectiveMatchdayIndex(seasonMatchesForMd)
  // Spieltag-Specials settle independently of the recap-Spieltag gating
  // below — a Special's own included_match_ids may finish before (or
  // regardless of) the whole recap Spieltag being done, and looking it up
  // by this matchId sidesteps the effective-vs-recap matchday numbering
  // mismatch entirely (see settleActiveMatchdaySpecials's doc comment).
  try {
    await settleActiveMatchdaySpecials(admin, matchId)
  } catch (e) { console.error('Spieltag-Special settlement failed:', e) }

  const matchday = recapMatchdayOf(matchInfo as Match, mdIndex)
  // A delayed match can resolve a slip from an ALREADY closed earlier betting
  // round. Recompute that round's awards without charging its penalty/pocket
  // money again or sending another recap push.
  const { data: ownedLegs, error: ownersError } = await admin
    .from('bets').select('placed_matchday')
    .eq('match_id', matchId).eq('season', CURRENT_SEASON)
  if (ownersError) {
    console.error('Unable to load delayed-bet owners:', ownersError)
    return // fail closed before any penalty/award writes
  }
  for (const ownerMd of new Set((ownedLegs ?? []).map((b) => b.placed_matchday as number | null))) {
    if (ownerMd == null || ownerMd >= 900 || ownerMd === matchday) continue
    const { data: priorRecap } = await admin.from('push_reminders').select('id')
      .eq('type', 'recap').eq('season', CURRENT_SEASON).eq('matchday', ownerMd).maybeSingle()
    if (!priorRecap) continue
    const { data: originBetIds, error: originError } = await admin.from('bets')
      .select('match_id').eq('season', CURRENT_SEASON).eq('placed_matchday', ownerMd)
    if (originError || !originBetIds) {
      console.error('Cannot recalculate original round awards:', originError)
      continue
    }
    const ownerIds = [...new Set(originBetIds.map((b) => b.match_id))]
    try { await computeAndPersistMatchdayAwards(admin, CURRENT_SEASON, ownerMd, ownerIds) }
    catch (e) { console.error('Delayed-match award refresh failed:', e) }
  }
  if (matchday == null || matchday >= 900) return // test matchday: no recap, awards or penalty

  const matchdayMatches = seasonMatchesForMd.filter((m) => recapMatchdayOf(m, mdIndex) === matchday)
  const displayMatchdayMatches = seasonMatchesForMd.filter((m) => effectiveMatchdayOf(m, mdIndex) === matchday)

  // "Verschoben" excludes this game's kickoff AND its still-pending bets
  // from the CURRENT Spieltag's completion gate. Those bets remain untouched
  // and will settle normally on the makeup date (or follow the separate
  // neutralisation process if the game is ultimately cancelled).
  //
  // We must not simply count ALL pending bets for this matchday: that would
  // silently keep Recap, Awards, Inaktivitätsstrafe and Taschengeld blocked
  // for weeks after the other matches have all finished. Conversely, pending
  // bets on a non-postponed match (especially goalscorer tips) still block.
  const mIds = matchdayMatches.map((m) => m.id)
  if (mIds.length === 0) return

  const { data: pendingBetsRaw, count: pendingBetCount, error: pendingError } = await admin
    .from('bets')
    .select('match_id, special_id, market_type, status', { count: 'exact' })
    .in('match_id', mIds)
    .eq('status', 'pending')
  if (pendingError || pendingBetsRaw == null || pendingBetCount !== pendingBetsRaw.length) {
    // Supabase may truncate result rows at its server-side max_rows limit.
    // Never treat an incomplete pending-bet sample as "all bets settled".
    console.error('Could not verify *all* pending bets before matchday finalization:', pendingError, { pendingBetCount, loaded: pendingBetsRaw?.length })
    return // fail closed: never pay or notify on incomplete data
  }
  const pendingBets = pendingBetsRaw as CompletionPendingBet[]

  // A Special's representative_match_id is just a technical anchor. Load
  // real included_match_ids before deciding whether its pending bet blocks
  // the current Spieltag. Unknown/deleted special = blocking, not ignored.
  const specialIds = [...new Set(pendingBets.filter((b) => b.market_type === 'matchday_special')
    .map((b) => b.special_id).filter((id): id is number => id != null))]
  let pendingSpecials: CompletionSpecial[] = []
  if (specialIds.length) {
    const { data: specialsRaw, error: specialsError } = await admin
      .from('matchday_specials')
      .select('id, included_match_ids')
      .in('id', specialIds)
    if (specialsError || specialsRaw == null) {
      console.error('Could not verify pending specials before matchday finalization:', specialsError)
      return
    }
    pendingSpecials = specialsRaw as CompletionSpecial[]
  }

  if (!canFinalizeMatchday(matchdayMatches, pendingBets, seasonMatchesForMd, pendingSpecials)) return

  // Awards reflect all bets currently settled on this Spieltag. If the
  // postponed match later finishes while it still belongs to this recap
  // matchday, a later call recalculates the awards; dedup locks prevent a
  // second recap notification, inactivity fee or pocket-money credit.
  try {
    await computeAndPersistMatchdayAwards(admin, CURRENT_SEASON, matchday, mIds)
  } catch (e) { console.error('Award persistence failed:', e) }

  // Deactivate early betting override once any matchday is settled
  await admin.from('app_settings').update({ value: 'false', updated_at: new Date().toISOString() }).eq('key', 'early_betting_open')

  const { error: dedupError } = await admin
    .from('push_reminders')
    .insert({ type: 'recap', matchday, season: CURRENT_SEASON })
  if (!dedupError) {
    // Only send if insert succeeded (prevents duplicate on concurrent requests)
    await sendPushToAll(
      '📊 Spieltags-Recap verfügbar',
      `Der ${matchday}. Spieltag ist abgeschlossen – schau dir die Highlights an!`,
      `/recap/${matchday}`,
      'matchday_recap',
      `recap-${matchday}`
    )
  }

  // Dedup via push_reminders so this only runs once even if multiple matches
  // settle simultaneously. Season is part of the dedupe key — matchday
  // numbers reset every season.
  const { error: penaltyDedupError } = await admin
    .from('push_reminders')
    .insert({ type: 'inactivity_fee', matchday, season: CURRENT_SEASON })
  if (!penaltyDedupError) {
    // Activity is an immutable property of the PLACED slip, not the fixture's
    // CURRENT kickoff grouping. Pending postponed wagers count at the ORIGINAL
    // round, never at the new March round. User-cancelled slips (void) do not.
    const mdMatchIds = displayMatchdayMatches.map((m) => m.id)
    if (mdMatchIds.length > 0) {
      const { data: activeBetRows, count: activeBetCount, error: activityError } = await admin
        .from('bets')
        .select('user_id', { count: 'exact' })
        .eq('season', CURRENT_SEASON)
        .eq('placed_matchday', matchday)
        .neq('status', 'void')
      if (activityError || activeBetRows == null || activeBetCount !== activeBetRows.length) {
        console.error('Incomplete penalty-eligibility data; no penalties charged:',
          { activityError, count: activeBetCount, loaded: activeBetRows?.length })
        return
      }
      const activeUserIds = new Set(activeBetRows.map((b) => b.user_id as string))

      // Only users actually allowed to bet this season can be "inactive" —
      // ineligible users are hard-blocked from placing any bet at all (see
      // app/api/bets/place/route.ts NOT_ELIGIBLE), so penalizing them here
      // would charge people for a season they were never allowed to play.
      const { data: allProfiles } = await admin
        .from('profiles')
        .select('id, created_at')
        .or('eligible_for_current_season.eq.true,is_admin.eq.true')

      // Someone who registered after every one of this Spieltag's matches had
      // already kicked off had zero opportunity to place a bet on it — every
      // market was closed before they existed. Charging them the same as a
      // member who simply chose not to bet would penalize an impossibility,
      // not inactivity (observed: a user who signed up minutes after the last
      // kickoff, well before this settlement ran, still got the full −50).
      const latestKickoff = displayMatchdayMatches.length > 0
        ? Math.max(...displayMatchdayMatches.map((m) => new Date(m.match_date).getTime()))
        : null

      await Promise.allSettled(
        (allProfiles ?? [])
          .filter((p) => !activeUserIds.has(p.id))
          .filter((p) => latestKickoff == null || new Date(p.created_at).getTime() <= latestKickoff)
          .map((p) => admin.rpc('apply_penalty', { p_user_id: p.id, p_amount: INACTIVITY_PENALTY }))
      )
    }
  }

  // Pocket money — same per-Spieltag rhythm and the same
  // insert-as-dedup-lock pattern as the penalty above, but its OWN lock row:
  // keeping them separate means one can't silently swallow the other if the
  // penalty block was already recorded for this Spieltag (e.g. by an earlier
  // deploy) while this one hadn't run yet.
  const { error: pocketMoneyDedupError } = await admin
    .from('push_reminders')
    .insert({ type: 'pocket_money', matchday, season: CURRENT_SEASON })
  if (!pocketMoneyDedupError) {
    // Everyone allowed to play this season, whether they bet or not — a
    // player sitting at 0 Wildis is exactly who this is for. Ineligible
    // accounts are excluded for the same reason they're excluded from the
    // penalty: they were never able to take part.
    const { data: payoutProfiles } = await admin
      .from('profiles')
      .select('id')
      .or('eligible_for_current_season.eq.true,is_admin.eq.true')

    await Promise.allSettled(
      (payoutProfiles ?? []).map((p) =>
        admin.rpc('increment_balance', { p_user_id: p.id, p_amount: POCKET_MONEY_PER_MATCHDAY })
      )
    )
  }
}
