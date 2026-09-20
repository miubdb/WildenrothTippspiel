import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPushToAll } from '@/lib/push'
import { buildEffectiveMatchdayIndex, effectiveMatchdayOf, recapMatchdayOf, SEASON_START } from '@/lib/season'
import { computeAndPersistMatchdayAwards } from '@/lib/awards'
import { settleActiveMatchdaySpecials } from '@/lib/matchdaySpecials'
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
  if (matchday == null || matchday >= 900) return // test matchday: no recap, awards or penalty

  const matchdayMatches = seasonMatchesForMd.filter((m) => recapMatchdayOf(m, mdIndex) === matchday)
  const displayMatchdayMatches = seasonMatchesForMd.filter((m) => effectiveMatchdayOf(m, mdIndex) === matchday)

  const nonPostponedInMatchday = matchdayMatches.filter((m) => m.status !== 'postponed')
  const allFinished = nonPostponedInMatchday.length > 0 && nonPostponedInMatchday.every((m) => m.status === 'finished')
  if (!allFinished) return

  const mIds = matchdayMatches.map((m) => m.id)
  if (mIds.length === 0) return

  // "All non-postponed matches finished" is not the same as "this Spieltag is
  // truly done" — bets (including goalscorer bets, which resolve on their own
  // timeline) may still be pending. Gate everything below on the bets, not
  // just the matches, so we never announce "Spieltag X abgeschlossen" while a
  // stake on it is still open.
  const { count: stillPendingCount } = await admin
    .from('bets')
    .select('id', { count: 'exact', head: true })
    .in('match_id', mIds)
    .eq('status', 'pending')
  const spieltagTrulyDone = !stillPendingCount
  if (!spieltagTrulyDone) return

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
    // Fairness check uses the DISPLAY grouping, not the recap grouping — a
    // user who bet on a match shown under this Spieltag's tab must count as
    // active for it even if that specific match later turned out to be a
    // recap-outlier reassigned elsewhere for award purposes.
    const mdMatchIds = displayMatchdayMatches.map((m) => m.id)
    if (mdMatchIds.length > 0) {
      const { data: activeBetRows } = await admin
        .from('bets')
        .select('user_id')
        .in('match_id', mdMatchIds)
        .neq('status', 'void')
      const activeUserIds = new Set((activeBetRows ?? []).map((b) => b.user_id as string))

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
