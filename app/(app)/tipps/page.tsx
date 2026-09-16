import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paginatedSelect'
import { BettingMatchCard } from '@/components/BettingMatchCard'
import { BetSlip } from '@/components/BetSlip'
import { MyBets } from '@/components/MyBets'
import { MatchdayScroller } from '@/components/MatchdayScroller'
import { MatchdayRecap } from '@/components/MatchdayRecap'
import { AllTippsSection } from '@/components/AllTippsSection'
import { BonusTipsSection } from '@/components/BonusTipsSection'
import type { BonusTip } from '@/lib/bonusTips'
import type { RecapData } from '@/components/MatchdayRecap'
import type { Match, PriorMatch, LeaguePlayer, LineupEntry } from '@/types'
import { calculateOdds, oddsFromXG, getMatchXG, buildPriorContext, getFullExactScoreMatrix, mergeExactScoreOffers, cupMarketOddsFromXG, cupSpecialMarketOddsFromXG, cupRound6MarketOddsFromSim } from '@/lib/odds'
import { CupMatchCard } from '@/components/CupMatchCard'
import { persistOddsDiagnostics } from '@/lib/oddsDiagnostics'
import { isSeasonStarted, bettingOpenTime, parseBettingOpenOverrides, buildEffectiveMatchdayIndex, effectiveMatchdayOf as effectiveMatchdayOfShared, isRescheduledMatch } from '@/lib/season'
import { computeGoalscorerOffersForMatch, type WildenrothPlayer, type GoalscorerOffer } from '@/lib/goalscorer'
import Link from 'next/link'
import { CUP_MARKET_LABEL, cupSelectionLabel, type SpecialDisplayInfo, specialShortTitle, specialSelectionLabel } from '@/lib/betDisplay'
import { computeStornoChamp } from '@/lib/awards'
import { cappedPayout } from '@/lib/payout'
import { MatchdaySpecialsSection, type MatchdaySpecialForDisplay } from '@/components/MatchdaySpecialsSection'

export const revalidate = 60

export default async function TippsPage({
  searchParams,
}: {
  searchParams: Promise<{ matchday?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  // Fetch all independent data in parallel
  const [
    { data: allMatchesRaw, error: allMatchesError },
    { data: priorMatchesRaw },
    { data: leaguePlayersRaw },
    { data: lineupEntriesRaw },
    seasonStarted,
    { data: appSettingsRaw },
    { data: { user } },
  ] = await Promise.all([
    supabase
      .from('matches')
      .select(
        `id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status, match_category, is_topspiel, tippspiel_matchday,
         competition_type, competition_name, competition_round, cup_shootout_winner, cup_first_goal_team,
         home_team:teams!matches_home_team_id_fkey(id, name, short_name),
         away_team:teams!matches_away_team_id_fkey(id, name, short_name)`
      )
      .gte('match_date', '2026-08-01')
      .order('match_date', { ascending: true }),
    fetchAllRows((from, to) => supabase
      .from('prior_season_matches')
      .select('id, season, league_name, league_level, league_number, home_team, away_team, home_score, away_score, match_date')
      .order('id')
      .range(from, to)
    ).then((data) => ({ data })),
    fetchAllRows((from, to) => supabase
      .from('league_players')
      .select('id, team_name, name, goals, matches, minutes, status, transfer_to, prior_league_level, prior_team_name')
      .order('id')
      .range(from, to)
    ).then((data) => ({ data })),
    fetchAllRows((from, to) => supabase
      .from('match_lineups')
      .select('id, match_id, team_name, player_name, minutes_played, goals, assists, red_card_minute, created_at')
      .order('id')
      .range(from, to)
    ).then((data) => ({ data })),
    isSeasonStarted(supabase),
    supabase.from('app_settings').select('key, value'),
    supabase.auth.getUser(),
  ])

  if (allMatchesError) {
    // A failed matches fetch silently becomes an empty array below, which is
    // indistinguishable from a genuinely empty matchday and renders "Keine
    // Spiele" — exactly the "Spieltag nicht geladen" report. Logging it
    // server-side leaves a trail if a transient DB/network hiccup recurs.
    console.error('Failed to load matches for tipps page:', allMatchesError)
  }

  const appSettings = new Map((appSettingsRaw ?? []).map((s) => [s.key, s.value]))
  // Explicit, hand-fixed betting-open time per Tippspiel-Spieltag, set once
  // ahead of go-live (app_settings key `betting_open_md_<N>`) — overrides both
  // the Monday-noon formula (bettingOpenTime) and the "not before the previous
  // Spieltag's last kickoff" clamp below, since the explicit times already
  // account for that by hand. A Spieltag without an explicit entry falls back
  // to the dynamic computation unchanged.
  const explicitBettingOpens = parseBettingOpenOverrides(appSettings)
  const surveyMode = appSettings.get('survey_mode') ?? 'hidden'

  const allMatches: Match[] = (allMatchesRaw ?? []).map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  }))

  const priorMatches: PriorMatch[] = (priorMatchesRaw ?? []) as PriorMatch[]

  // Bonus-Tipps (Sondertipps ohne Einsatz) — jeder bereits geöffnete Tipp der
  // letzten Zeit, unabhängig vom aktuell angezeigten Spieltag (ein
  // Langzeit-/Winterpausen-Tipp hat ohnehin keinen Spieltagsbezug). RLS
  // erlaubt jedem eingeloggten Nutzer das Lesen aller Bonus-Tipps.
  const { data: bonusTipsRaw } = await supabase
    .from('bonus_tips')
    .select('*')
    .lte('opens_at', new Date().toISOString())
    .order('closes_at', { ascending: false })
    .limit(20)
  const bonusTips: BonusTip[] = (bonusTipsRaw ?? []) as BonusTip[]
  const bonusTipIds = bonusTips.map((t) => t.id)
  const [{ data: myBonusAnswersRaw }, { data: myBonusPayoutsRaw }] = user && bonusTipIds.length > 0
    ? await Promise.all([
        supabase.from('bonus_tip_answers').select('bonus_tip_id, answer_key').eq('user_id', user.id).in('bonus_tip_id', bonusTipIds),
        supabase.from('bonus_tip_payouts').select('bonus_tip_id, amount').eq('user_id', user.id).in('bonus_tip_id', bonusTipIds),
      ])
    : [{ data: [] }, { data: [] }]

  const teamNames = new Map<number, string>()
  for (const m of allMatches) {
    if (m.home_team) teamNames.set(m.home_team_id, m.home_team.name)
    if (m.away_team) teamNames.set(m.away_team_id, m.away_team.name)
  }
  const leaguePlayers: LeaguePlayer[] = (leaguePlayersRaw ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    team_name: p.team_name,
    goals: p.goals,
    games: p.matches,
    minutes: p.minutes,
    status: p.status,
    transfer_to: p.transfer_to,
    prior_league_level: p.prior_league_level,
    prior_team_name: p.prior_team_name,
  }))
  const lineupEntries: LineupEntry[] = (lineupEntriesRaw ?? []) as LineupEntry[]
  const priorCtx = buildPriorContext(priorMatches, teamNames, leaguePlayers, lineupEntries)

  const SEASON_START_TIPPS = '2026-08-01'
  // Matchday 999 is the test matchday — always include it regardless of date
  const seasonMatches = allMatches.filter((m) => m.matchday === 999 || m.match_date >= SEASON_START_TIPPS)
  const isPreSeason = !seasonStarted || seasonMatches.filter((m) => m.matchday !== 999).length === 0

  // Pre-season: show 1-28 placeholder; in-season: derive from actual matches
  // Always include test matchday 999 when it exists
  const hasTestMatchday = seasonMatches.some(m => m.matchday === 999)

  // The BFV sometimes schedules a matchday's makeup date well after later-numbered
  // matchdays (e.g. Spieltag 2 played as a midweek catch-up after Spieltag 7).
  // The official matchday NUMBER stays as-is everywhere (labels, tables, results),
  // but ordering/"default"/"completed" logic must follow actual kickoff dates.
  //
  // Kreisliga (1. Mannschaft) defines the Tippspiel-Spieltag structure. Wildenroth II
  // and B-Klasse matches run on their own, independent BFV matchday numbering — their
  // raw `matchday` number is NOT meaningful here. Instead each such match is assigned
  // to whichever Kreisliga-Spieltag's date range it falls closest to (see
  // `effectiveMatchdayOf` below). Plain B-Klasse matches (not the admin-selected
  // weekly Topspiel) never appear on the Tippspiel page at all.
  const isKreisligaMatch = (m: Match) => !m.match_category || m.match_category === 'kreisliga'
  const kreisligaMatches = seasonMatches.filter((m) => m.matchday !== 999 && isKreisligaMatch(m))

  const mdIndex = buildEffectiveMatchdayIndex(seasonMatches)
  const { matchdayMinDate, kreisligaMatchdaysSorted } = mdIndex
  const effectiveMatchdayOf = (m: Match) => effectiveMatchdayOfShared(m, mdIndex)

  // CHRONOLOGICAL list (earliest kickoff first). Feeds `chronologicalMatchdays`
  // below, where "the Spieltag before this one" must mean the one actually
  // played before it — the BFV runs Spieltage out of numeric sequence, so a
  // numeric list there would let two Spieltage be bettable at once.
  const allMatchdays = isPreSeason
    ? [...(hasTestMatchday ? [999] : []), ...Array.from({ length: 28 }, (_, i) => i + 1)]
    : [...(hasTestMatchday ? [999] : []), ...kreisligaMatchdaysSorted]
  // DISPLAY list for the Spieltag picker: chronological order by actual
  // kickoff date (outlier-robust median anchor), not by official Spieltag
  // number — product decision: the overview shows Spieltage in the order
  // they're actually played. Deliberately a SEPARATE list from `allMatchdays`
  // above (which drives the betting-window sequencing gate and stays on the
  // raw earliest-kickoff order) — reordering the picker must not shift when
  // any Spieltag opens for betting.
  const displayMatchdays = isPreSeason
    ? allMatchdays
    : [...(hasTestMatchday ? [999] : []), ...mdIndex.kreisligaMatchdaysDisplayOrder]

  // Must resolve through effectiveMatchdayOf, not the raw `matchday` column —
  // a single Kreisliga match rescheduled far out of its own Spieltag's window
  // (e.g. a postponed Spieltag-1 makeup match played weeks later) still
  // carries raw matchday=1, so a raw-matchday scan would keep treating
  // Spieltag 1 as "still has a scheduled match" (and, since its OTHER matches
  // give it the earliest matchdayMinDate, would keep it sorted first) even
  // though that outlier match has already been effectively reassigned to a
  // much later Spieltag by effectiveMatchdayOf — see the "matchday scheduling
  // quirk" note in CLAUDE.md. completedMatchdays/lastCompletedMd below already
  // gets this right via effective grouping; firstScheduled must match or the
  // default-Spieltag switch parks on an already-finished Spieltag forever.
  //
  // The sort key must be matchdayAnchorDate, NOT matchdayMinDate: both are
  // keyed by RAW matchday, but matchdayMinDate is the raw group's own earliest
  // date and is NOT outlier-robust (see its doc in lib/season.ts). A rescheduled
  // outlier match numerically reuses ANOTHER Spieltag's raw number (e.g. a
  // Spieltag-1 makeup effectively reassigned to Spieltag 7 still has raw
  // matchday=1, but a Spieltag-13 makeup effectively reassigned to Spieltag 7
  // still has raw matchday=13) — that drags matchdayMinDate.get(13) down to the
  // outlier's early date even though the outlier itself no longer runs under
  // effective Spieltag 13, making firstScheduled resolve to 13 instead of 7 and
  // permanently stalling the page on the last completed Spieltag. The
  // median-based matchdayAnchorDate isn't dragged by one early/late outlier.
  const firstScheduled = [...new Set(
    kreisligaMatches
      .filter((m) => m.status === 'scheduled')
      .map((m) => effectiveMatchdayOf(m))
      .filter((md): md is number => md != null)
  )].sort((a, b) => (mdIndex.matchdayAnchorDate.get(a) ?? 0) - (mdIndex.matchdayAnchorDate.get(b) ?? 0))[0]

  // Before the next Spieltag's betting window opens → default to last completed
  // matchday (Sunday games just ended). After it opens → default to the next
  // upcoming matchday. Must resolve through the same explicitBettingOpens
  // override used everywhere else on this page (see the comment above it) —
  // using the generic Monday-noon formula here instead would silently disagree
  // with the real opening instant whenever an admin hand-sets a Spieltag's
  // betting_open_md_<N> to something other than the natural Monday noon (e.g.
  // a rescheduled Spieltag), leaving the app parked on the old Spieltag (or
  // jumping early) even though betting has actually opened (or hasn't yet).
  const nextMatchdayOpensAt = firstScheduled != null
    ? (explicitBettingOpens.get(firstScheduled) ?? bettingOpenTime(new Date(matchdayMinDate.get(firstScheduled) ?? Date.now())))
    : null
  const isBeforeMondayNoon = nextMatchdayOpensAt ? new Date() < nextMatchdayOpensAt : true
  const completedMatchdays = allMatchdays.filter((md) => {
    // Group by the EFFECTIVE Spieltag, i.e. the matches actually shown under
    // this tab. Grouping by the raw `matchday` column would keep a Spieltag
    // "not completed" until an outlier match that is displayed under a
    // different Spieltag has been played.
    const mdM = seasonMatches.filter((m) => effectiveMatchdayOf(m) === md)
    const nonPostponed = mdM.filter((m) => m.status !== 'postponed')
    return nonPostponed.length > 0 && nonPostponed.every((m) => m.status === 'finished')
  })
  const lastCompletedMd = completedMatchdays.length > 0
    ? completedMatchdays.reduce((latest, md) =>
        (mdIndex.matchdayAnchorDate.get(md) ?? 0) > (mdIndex.matchdayAnchorDate.get(latest) ?? 0) ? md : latest
      )
    : null

  // A Spieltag that has already KICKED OFF but isn't finished yet fits
  // neither bucket above: `firstScheduled` only counts Kreisliga matches that
  // are still scheduled, and `completedMatchdays` demands every match be
  // finished. So the evening the last Kreisliga match of a Spieltag ends while
  // its Wildenroth-II/Topspiel game still runs the next day, the page jumped
  // BACK to the previous fully-completed Spieltag — showing a week-old recap
  // while the current Spieltag was still live. Takes precedence over
  // lastCompletedMd, but only while the NEXT Spieltag's betting window is
  // still closed: once that opens, the bettable Spieltag wins as before.
  const nowMs = Date.now()
  const inProgressMd = [...new Set(
    seasonMatches
      .map((m) => effectiveMatchdayOf(m))
      .filter((md): md is number => md != null && md !== 999)
  )]
    .filter((md) => {
      const nonPostponed = seasonMatches
        .filter((m) => effectiveMatchdayOf(m) === md && m.status !== 'postponed')
      if (nonPostponed.length === 0) return false
      const hasStarted = nonPostponed.some(
        (m) => m.status === 'finished' || new Date(m.match_date).getTime() <= nowMs
      )
      const allDone = nonPostponed.every((m) => m.status === 'finished')
      return hasStarted && !allDone
    })
    .sort((a, b) => (mdIndex.matchdayAnchorDate.get(a) ?? 0) - (mdIndex.matchdayAnchorDate.get(b) ?? 0))
    .at(-1) ?? null

  const latestMatchdayByAnchor = () => allMatchdays.filter(md => md !== 999).reduce((latest, md) =>
    (mdIndex.matchdayAnchorDate.get(md) ?? 0) > (mdIndex.matchdayAnchorDate.get(latest) ?? 0) ? md : latest
  )
  const defaultMatchday = isPreSeason
    ? (hasTestMatchday ? 999 : 1)
    : isBeforeMondayNoon
      ? (inProgressMd ?? lastCompletedMd ?? firstScheduled ?? latestMatchdayByAnchor())
      : (firstScheduled ?? latestMatchdayByAnchor())
  const requestedMd = params.matchday ? parseInt(params.matchday, 10) : null
  const currentMatchday =
    requestedMd && allMatchdays.includes(requestedMd) ? requestedMd : defaultMatchday

  const matchdayMatches = seasonMatches
    .filter((m) => effectiveMatchdayOf(m) === currentMatchday)
    .sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime())

  const deadline = matchdayMatches[0] ? new Date(matchdayMatches[0].match_date) : null
  const isDeadlinePassed = deadline ? deadline <= new Date() : false

  // Betting window: opens Monday 12:00 of match week (unless early_betting_open override is set)
  const earlyBettingOpen = appSettings.get('early_betting_open') === 'true'
  const ownBettingOpens = deadline ? bettingOpenTime(deadline) : null
  // Prevent two matchdays being open for betting at once: a matchday can never open
  // before the immediately preceding (chronological) matchday's last match has kicked
  // off, even if both fall in the same calendar week (BFV sometimes schedules e.g.
  // Spieltag 3 midweek and Spieltag 4 that same weekend).
  const chronologicalMatchdays = allMatchdays.filter((md) => md !== 999)
  const currentMdIdx = chronologicalMatchdays.indexOf(currentMatchday)
  const prevMatchday = currentMdIdx > 0 ? chronologicalMatchdays[currentMdIdx - 1] : null
  const prevMatchdayLastKickoff = prevMatchday != null
    ? seasonMatches
        // Must match by effective (displayed) Spieltag, not the raw `matchday`
        // column — a Wildenroth-II/Topspiel match keeps its own independent BFV
        // matchday number, which can coincidentally equal `prevMatchday` while its
        // real kickoff is weeks away, wrongly pushing the betting window open time.
        .filter((m) => effectiveMatchdayOf(m) === prevMatchday)
        .reduce<number | null>((latest, m) => {
          const t = new Date(m.match_date).getTime()
          return latest === null || t > latest ? t : latest
        }, null)
    : null
  const dynamicBettingOpens = ownBettingOpens && prevMatchdayLastKickoff != null && prevMatchdayLastKickoff > ownBettingOpens.getTime()
    ? new Date(prevMatchdayLastKickoff)
    : ownBettingOpens
  // Explicit, hand-fixed opening time (see explicitBettingOpens above) wins
  // outright over the dynamic formula+clamp above — it was set to already
  // account for the previous Spieltag's timing by hand, so re-clamping it here
  // would risk pushing it later than the intended, exact value.
  const bettingOpens = currentMatchday != null && explicitBettingOpens.has(currentMatchday)
    ? explicitBettingOpens.get(currentMatchday)!
    : dynamicBettingOpens
  // earlyBettingOpen only applies to the chronologically first upcoming matchday
  const isBettingOpen = (earlyBettingOpen && currentMatchday === firstScheduled) || !bettingOpens || new Date() >= bettingOpens

  const SEASON_START = '2026-08-01'
  // seasonMatches already declared above as filtered by SEASON_START_TIPPS (same value)

  // Spieltag-Specials: open with this Spieltag's normal betting window, closed
  // at the first included match's kickoff (see lib/matchdaySpecials.ts +
  // app/api/bets/place/route.ts's server-side deadline re-check — this is
  // display-only, never the enforcement point). Draft/inactive rows never show here.
  const CURRENT_SEASON_SPECIALS = '26/27'
  const { data: activeSpecialsRaw } = isBettingOpen
    ? await supabase
        .from('matchday_specials')
        .select('id, matchday, title, line, options, representative_match_id, closes_at')
        .eq('season', CURRENT_SEASON_SPECIALS)
        .eq('matchday', currentMatchday)
        .eq('status', 'active')
        .order('display_order', { ascending: true })
    : { data: null }
  const activeSpecials = ((activeSpecialsRaw ?? []) as unknown as (MatchdaySpecialForDisplay & { closes_at: string })[])
    .map((s) => ({ ...s, closed: new Date(s.closes_at) <= new Date() }))

  // Every Special of this Spieltag (any status, not just 'active') — needed to
  // render an ALREADY-PLACED bet's real "Spieltag N · <Markt>: <Antwort>"
  // label wherever bets are listed (MyBets, Alle Tipps, Recap). A Special
  // bet's own match_id is only representative_match_id (technical FK anchor,
  // see lib/matchdaySpecials.ts) — never derive its display from that match.
  const { data: allSpecialsForMdRaw } = await supabase
    .from('matchday_specials')
    .select('id, matchday, template_key, options, settlement_result')
    .eq('season', CURRENT_SEASON_SPECIALS)
    .eq('matchday', currentMatchday)
  const specialsById: Record<number, SpecialDisplayInfo> = Object.fromEntries(
    (allSpecialsForMdRaw ?? []).map((s) => [s.id, {
      matchday: s.matchday,
      template_key: s.template_key,
      options: s.options as { key: string; label: string }[],
      settlement_result: s.settlement_result as { finalStat: number; winningKey: string } | null,
    }])
  )

  // Odds snapshot: freeze odds at Monday 12:00 — only use matches finished before that cutoff.
  // competition_type === 'cup' (the one-off Pokal-Spezial, see CLAUDE.md) is
  // excluded here too — its sporting result must never feed the Poisson
  // model's team-strength/form/roster inputs for future league matches, even
  // though it stays match_category='kreisliga' for betting/display purposes.
  const oddsSnapshotCutoff = bettingOpens ?? deadline
  const oddsMatches = (oddsSnapshotCutoff
    ? seasonMatches.filter(
        (m) => m.status !== 'finished' || new Date(m.match_date) < oddsSnapshotCutoff
      )
    : seasonMatches
  ).filter((m) => m.competition_type !== 'cup')

  // Odds: computed live until Monday 12:00, then frozen in DB forever.
  // First request at/after bettingOpens writes frozen_at; subsequent reads use DB values.
  const oddsMap: Record<number, ReturnType<typeof calculateOdds>> = {}
  // Auto-computed exact-score grid per match (odds.exact_score_odds) — the
  // full 0..10-goals-per-side model output, unfiltered by MAX_EXACT_ODDS (see
  // getFullExactScoreMatrix). This is the persisted source of truth the
  // exact-score market now reads from everywhere, instead of every caller
  // recomputing it live — which is exactly how it silently ended up being
  // computed WITHOUT priorCtx in two places (BettingMatchCard, bets/place)
  // and producing near-identical score lists for every match pre-season.
  const exactScoreAutoMap: Record<number, Record<string, number>> = {}
  // Match-specific model xG override (match_odds_overrides.model_home/away_xg_override)
  // — a rare, explicit correction for a single match whose statistically-derived
  // xG conflicts with a deliberately set manual 1X2 (see SpVgg Wildenroth – TSV
  // 1882 Landsberg II), OR (round 6) the Geiselbullach/Wildenroth cup-match
  // recalibration. When present, it is the basis for that match's EXACT-SCORE
  // matrix and, for a cup match, every cup market AND the goalscorer market
  // — never for the standard 1X2/O-U/BTTS markets (oddsFromXG below still
  // always uses the model's own getMatchXG output, since those are never
  // shown/bettable for a cup match anyway), and never for other matches'
  // team data (this is a per-match override, not a global stat correction).
  // Declared at function scope (not inside the `if (isBettingOpen)` block
  // below) so the goalscorer section further down can also read it.
  const exactScoreXgOverrideMap = new Map<number, { homeXG: number; awayXG: number }>()
  if (isBettingOpen) {
    const scheduledMatchIds = matchdayMatches.filter(m => m.status === 'scheduled').map(m => m.id)

    if (scheduledMatchIds.length > 0) {
      const { data: xgOverrideRows } = await createAdminClient()
        .from('match_odds_overrides')
        .select('match_id, model_home_xg_override, model_away_xg_override')
        .in('match_id', scheduledMatchIds)
      for (const row of xgOverrideRows ?? []) {
        if (row.model_home_xg_override != null && row.model_away_xg_override != null) {
          exactScoreXgOverrideMap.set(row.match_id, {
            homeXG: Number(row.model_home_xg_override),
            awayXG: Number(row.model_away_xg_override),
          })
        }
      }
    }

    // Load any already-frozen rows from DB
    const { data: frozenRows } = scheduledMatchIds.length > 0
      ? await supabase.from('odds').select('*').in('match_id', scheduledMatchIds).not('frozen_at', 'is', null)
      : { data: [] }

    // "Complete" = frozen row that also has the new-market columns populated.
    // Rows frozen before the market-expansion migration have NULL new fields
    // (Number(null)→0); treat those as incomplete so they get recomputed+updated.
    const completeFrozenRows = (frozenRows ?? []).filter(r => r.over_5_5 !== null)
    const frozenSet = new Set(completeFrozenRows.map(r => r.match_id))

    // Freezing must succeed regardless of which user's page load triggers it (the
    // `odds` table only grants write access to admins under RLS) — use the
    // service-role client, same as the other system-level writes in this file.
    const adminSupaOdds = createAdminClient()

    for (const row of completeFrozenRows) {
      oddsMap[row.match_id] = {
        home_win:  Number(row.home_win),
        draw:      Number(row.draw),
        away_win:  Number(row.away_win),
        odds_1x:   Number(row.odds_1x),
        odds_x2:   Number(row.odds_x2),
        odds_12:   Number(row.odds_12),
        over_2_5:  Number(row.over_2_5),
        under_2_5: Number(row.under_2_5),
        over_3_5:  Number(row.over_3_5),
        under_3_5: Number(row.under_3_5),
        over_5_5:  Number(row.over_5_5),
        under_5_5: Number(row.under_5_5),
        over_7_5:  Number(row.over_7_5),
        under_7_5: Number(row.under_7_5),
        btts_yes:  Number(row.btts_yes),
        btts_no:   Number(row.btts_no),
        hdp_home_minus_1_5: Number(row.hdp_home_minus_1_5),
        hdp_away_plus_1_5:  Number(row.hdp_away_plus_1_5),
        hdp_home_minus_2_5: Number(row.hdp_home_minus_2_5),
        hdp_away_plus_2_5:  Number(row.hdp_away_plus_2_5),
        hdp_away_minus_1_5: Number(row.hdp_away_minus_1_5),
        hdp_home_plus_1_5:  Number(row.hdp_home_plus_1_5),
        hdp_away_minus_2_5: Number(row.hdp_away_minus_2_5),
        hdp_home_plus_2_5:  Number(row.hdp_home_plus_2_5),
        // Cup-only markets (see lib/odds.ts#cupMarketOddsFromXG) — null on
        // every normal league match's row, so only ever populated here.
        ...(row.cup_advance_home != null ? {
          cup_advance_home:    Number(row.cup_advance_home),
          cup_advance_away:    Number(row.cup_advance_away),
          cup_first_goal_home: Number(row.cup_first_goal_home),
          cup_first_goal_away: Number(row.cup_first_goal_away),
          cup_first_goal_none: Number(row.cup_first_goal_none),
        } : {}),
        ...(row.cup_decision_regulation != null ? {
          cup_decision_regulation:       Number(row.cup_decision_regulation),
          cup_decision_shootout:         Number(row.cup_decision_shootout),
          cup_halftime_lead_advance_yes: Number(row.cup_halftime_lead_advance_yes),
          cup_halftime_lead_advance_no:  Number(row.cup_halftime_lead_advance_no),
          cup_comeback_advance_yes:      Number(row.cup_comeback_advance_yes),
          cup_comeback_advance_no:       Number(row.cup_comeback_advance_no),
          cup_shootout_advance_yes:      Number(row.cup_shootout_advance_yes),
          cup_shootout_advance_no:       Number(row.cup_shootout_advance_no),
        } : {}),
        ...(row.cup_early_goal_yes != null ? {
          cup_early_goal_yes:      Number(row.cup_early_goal_yes),
          ...(row.cup_early_goal_no != null ? { cup_early_goal_no: Number(row.cup_early_goal_no) } : {}),
          cup_ht_more_goals_h1:    Number(row.cup_ht_more_goals_h1),
          cup_ht_more_goals_h2:    Number(row.cup_ht_more_goals_h2),
          cup_ht_more_goals_equal: Number(row.cup_ht_more_goals_equal),
          cup_both_halves_btts_yes: Number(row.cup_both_halves_btts_yes),
        } : {}),
      }
      if (row.exact_score_odds) {
        exactScoreAutoMap[row.match_id] = row.exact_score_odds as Record<string, number>
      } else {
        // Already frozen (standard markets correct and must stay untouched),
        // but predates the exact_score_odds column — backfill ONLY that one
        // column from today's full model, exactly once. Never rewrites any
        // of the standard-market columns already frozen above.
        const m = matchdayMatches.find(x => x.id === row.match_id)
        if (m) {
          const modelXg = exactScoreXgOverrideMap.get(row.match_id)
          const { homeXG, awayXG } = modelXg ?? getMatchXG(oddsMatches, m.home_team_id, m.away_team_id, priorCtx)
          const grid = Object.fromEntries(getFullExactScoreMatrix(homeXG, awayXG).map(r => [r.score, r.odds]))
          exactScoreAutoMap[row.match_id] = grid
          await adminSupaOdds.from('odds').update({ exact_score_odds: grid, updated_at: new Date().toISOString() }).eq('match_id', row.match_id)
        }
      }
      if (row.hdp_away_minus_1_5 == null) {
        // Already frozen (standard markets correct and must stay untouched),
        // but predates the mirrored away-favoured handicap columns (added
        // alongside the dynamic-direction Handicap market) — backfill ONLY
        // those 4 new columns from today's model, exactly once, same pattern
        // as the exact_score_odds backfill above. Never rewrites any of the
        // standard-market columns already frozen.
        const m = matchdayMatches.find(x => x.id === row.match_id)
        if (m) {
          const { homeXG, awayXG } = getMatchXG(oddsMatches, m.home_team_id, m.away_team_id, priorCtx)
          const mirrored = oddsFromXG(homeXG, awayXG)
          oddsMap[row.match_id].hdp_away_minus_1_5 = mirrored.hdp_away_minus_1_5
          oddsMap[row.match_id].hdp_home_plus_1_5 = mirrored.hdp_home_plus_1_5
          oddsMap[row.match_id].hdp_away_minus_2_5 = mirrored.hdp_away_minus_2_5
          oddsMap[row.match_id].hdp_home_plus_2_5 = mirrored.hdp_home_plus_2_5
          await adminSupaOdds.from('odds').update({
            hdp_away_minus_1_5: mirrored.hdp_away_minus_1_5,
            hdp_home_plus_1_5: mirrored.hdp_home_plus_1_5,
            hdp_away_minus_2_5: mirrored.hdp_away_minus_2_5,
            hdp_home_plus_2_5: mirrored.hdp_home_plus_2_5,
            updated_at: new Date().toISOString(),
          }).eq('match_id', row.match_id)
        }
      }
      if (row.cup_advance_home != null && row.cup_early_goal_yes == null) {
        // Round-6 addition: backfill ONLY the 3 new markets (Frühes Tor / Mehr
        // Tore je Halbzeit / Beide Teams in beiden HZ) for an already-frozen
        // cup row that predates them. Uses the SAME (homeXG, awayXG) as the
        // already-frozen cup_advance/cup_first_goal columns — including the
        // match-specific xG override when one exists (match 573's round-6
        // Geiselbullach/Wildenroth recalibration, see lib/odds.ts) — so it
        // can never disagree with the rest of this match's cup card. Never
        // rewrites any already-frozen column.
        const m = matchdayMatches.find(x => x.id === row.match_id)
        if (m) {
          const modelXg = exactScoreXgOverrideMap.get(row.match_id)
          const { homeXG: baseHomeXG, awayXG: baseAwayXG } = getMatchXG(oddsMatches, m.home_team_id, m.away_team_id, priorCtx)
          const homeXG = modelXg?.homeXG ?? baseHomeXG
          const awayXG = modelXg?.awayXG ?? baseAwayXG
          const sim = cupSpecialMarketOddsFromXG(homeXG, awayXG)
          const round6 = cupRound6MarketOddsFromSim(sim.diagnostics)
          Object.assign(oddsMap[row.match_id], round6)
          await adminSupaOdds.from('odds').update({
            ...round6,
            updated_at: new Date().toISOString(),
          }).eq('match_id', row.match_id)
        }
      }
      if (row.cup_advance_home != null && row.cup_early_goal_yes != null && row.cup_early_goal_no == null) {
        // Backfill cup_early_goal_no for already-frozen cup rows that predate
        // the 2-way Frühes-Tor market. Uses same (homeXG, awayXG) as the
        // already-frozen cup_early_goal_yes column.
        const m = matchdayMatches.find(x => x.id === row.match_id)
        if (m) {
          const modelXg = exactScoreXgOverrideMap.get(row.match_id)
          const { homeXG: baseHomeXG, awayXG: baseAwayXG } = getMatchXG(oddsMatches, m.home_team_id, m.away_team_id, priorCtx)
          const homeXG = modelXg?.homeXG ?? baseHomeXG
          const awayXG = modelXg?.awayXG ?? baseAwayXG
          const sim = cupSpecialMarketOddsFromXG(homeXG, awayXG)
          const { cup_early_goal_no } = cupRound6MarketOddsFromSim(sim.diagnostics)
          Object.assign(oddsMap[row.match_id], { cup_early_goal_no })
          await adminSupaOdds.from('odds').update({ cup_early_goal_no, updated_at: new Date().toISOString() }).eq('match_id', row.match_id)
        }
      }
      if (row.cup_advance_home != null && row.cup_decision_regulation == null) {
        // Already-frozen cup row (match 573 froze before the 3 correlated
        // specials + decision market existed) — backfill ONLY those new
        // columns via Monte Carlo simulation, from the SAME (homeXG, awayXG)
        // as the already-frozen cup_advance/cup_first_goal columns above, so
        // they can never disagree. Never rewrites any already-frozen column.
        const m = matchdayMatches.find(x => x.id === row.match_id)
        if (m) {
          const { homeXG, awayXG } = getMatchXG(oddsMatches, m.home_team_id, m.away_team_id, priorCtx)
          const simResult = cupSpecialMarketOddsFromXG(homeXG, awayXG)
          const special = {
            cup_decision_regulation:       simResult.cup_decision_regulation,
            cup_decision_shootout:         simResult.cup_decision_shootout,
            cup_halftime_lead_advance_yes: simResult.cup_halftime_lead_advance_yes,
            cup_halftime_lead_advance_no:  simResult.cup_halftime_lead_advance_no,
            cup_comeback_advance_yes:      simResult.cup_comeback_advance_yes,
            cup_comeback_advance_no:       simResult.cup_comeback_advance_no,
            cup_shootout_advance_yes:      simResult.cup_shootout_advance_yes,
            cup_shootout_advance_no:       simResult.cup_shootout_advance_no,
          }
          Object.assign(oddsMap[row.match_id], special)
          await adminSupaOdds.from('odds').update({
            ...special,
            updated_at: new Date().toISOString(),
          }).eq('match_id', row.match_id)
        }
      }
    }

    // Compute + persist odds for any scheduled match not yet frozen
    const toFreeze = matchdayMatches.filter(m => m.status === 'scheduled' && !frozenSet.has(m.id))
    if (toFreeze.length > 0) {
      const now = new Date().toISOString()
      for (const m of toFreeze) {
        const { homeXG: rawHomeXG, awayXG: rawAwayXG, diagnostics } = getMatchXG(oddsMatches, m.home_team_id, m.away_team_id, priorCtx)
        // Match-specific xG override (match_odds_overrides.model_home/away_xg_override)
        // — a rare, explicit correction to the model's own team-strength estimate
        // (see SpVgg Wildenroth – TSV 1882 Landsberg II / the Geiselbullach round-6
        // recalibration for prior examples). MUST apply to every market derived from
        // (homeXG, awayXG) below — 1X2, DC, O/U, BTTS, Handicap, exact score, cup
        // markets, goalscorer — not just exact-score/cup as before: leaving 1X2/O-U/
        // BTTS/Handicap on the raw model xG while exact-score/goalscorer used the
        // override produced exactly the "1X2 sagt X, Handicap/BTTS sagen Y"
        // inconsistency the whole odds model is designed to prevent.
        const modelXg = exactScoreXgOverrideMap.get(m.id)
        const homeXG = modelXg?.homeXG ?? rawHomeXG
        const awayXG = modelXg?.awayXG ?? rawAwayXG
        const odds = oddsFromXG(homeXG, awayXG)
        // Cup markets always use the same, possibly-overridden (homeXG, awayXG)
        // as the standard markets above — kept as separate cupHomeXG/cupAwayXG
        // names only because the rest of this block already refers to them.
        const cupHomeXG = homeXG
        const cupAwayXG = awayXG
        // Cup-only markets (see lib/odds.ts#cupMarketOddsFromXG) — derived from
        // the SAME (homeXG, awayXG) as every other market above, so they can
        // never disagree with this match's own 1X2 card. Undefined (and never
        // persisted) for every normal league match.
        const cupOdds = m.competition_type === 'cup' ? cupMarketOddsFromXG(cupHomeXG, cupAwayXG) : null
        if (cupOdds) Object.assign(odds, cupOdds)
        // The 3 Monte-Carlo-derived cup specials + decision market (see
        // lib/odds.ts#cupSpecialMarketOddsFromXG) — same (homeXG, awayXG),
        // undefined for every normal league match.
        const cupSpecialSim = m.competition_type === 'cup' ? cupSpecialMarketOddsFromXG(cupHomeXG, cupAwayXG) : null
        const cupSpecialOdds = cupSpecialSim ? {
          cup_decision_regulation:       cupSpecialSim.cup_decision_regulation,
          cup_decision_shootout:         cupSpecialSim.cup_decision_shootout,
          cup_halftime_lead_advance_yes: cupSpecialSim.cup_halftime_lead_advance_yes,
          cup_halftime_lead_advance_no:  cupSpecialSim.cup_halftime_lead_advance_no,
          cup_comeback_advance_yes:      cupSpecialSim.cup_comeback_advance_yes,
          cup_comeback_advance_no:       cupSpecialSim.cup_comeback_advance_no,
          cup_shootout_advance_yes:      cupSpecialSim.cup_shootout_advance_yes,
          cup_shootout_advance_no:       cupSpecialSim.cup_shootout_advance_no,
          cup_halftime_lead_advance_yes_model: cupSpecialSim.cup_halftime_lead_advance_yes_model,
          cup_comeback_advance_yes_model:      cupSpecialSim.cup_comeback_advance_yes_model,
          cup_shootout_advance_yes_model:      cupSpecialSim.cup_shootout_advance_yes_model,
        } : null
        if (cupSpecialOdds) Object.assign(odds, cupSpecialOdds)
        // Round-6 additions (Frühes Tor / Mehr Tore je Halbzeit / Beide Teams
        // in beiden HZ) — reuses the SAME simulation run above (cupSpecialSim)
        // rather than re-simulating, so all cup markets stay derived from one
        // Monte Carlo pass.
        const cupRound6Odds = cupSpecialSim ? cupRound6MarketOddsFromSim(cupSpecialSim.diagnostics) : null
        if (cupRound6Odds) Object.assign(odds, cupRound6Odds)
        oddsMap[m.id] = odds
        // Standard markets above always use the model's own xG. The exact-score
        // grid uses the match-specific override when one exists (see comment above).
        const exactGrid = Object.fromEntries(
          getFullExactScoreMatrix(modelXg?.homeXG ?? homeXG, modelXg?.awayXG ?? awayXG).map(r => [r.score, r.odds])
        )
        exactScoreAutoMap[m.id] = exactGrid
        // Upsert: safe to call concurrently — snapshot cutoff is deterministic,
        // so any two simultaneous requests produce identical values.
        await adminSupaOdds.from('odds').upsert({
          match_id:  m.id,
          matchday:  m.matchday,
          frozen_at: now,
          updated_at: now,
          home_win:  odds.home_win,
          draw:      odds.draw,
          away_win:  odds.away_win,
          odds_1x:   odds.odds_1x,
          odds_x2:   odds.odds_x2,
          odds_12:   odds.odds_12,
          over_2_5:  odds.over_2_5,
          under_2_5: odds.under_2_5,
          over_3_5:  odds.over_3_5,
          under_3_5: odds.under_3_5,
          over_5_5:  odds.over_5_5,
          under_5_5: odds.under_5_5,
          over_7_5:  odds.over_7_5,
          under_7_5: odds.under_7_5,
          btts_yes:  odds.btts_yes,
          btts_no:   odds.btts_no,
          hdp_home_minus_1_5: odds.hdp_home_minus_1_5,
          hdp_away_plus_1_5:  odds.hdp_away_plus_1_5,
          hdp_home_minus_2_5: odds.hdp_home_minus_2_5,
          hdp_away_plus_2_5:  odds.hdp_away_plus_2_5,
          hdp_away_minus_1_5: odds.hdp_away_minus_1_5,
          hdp_home_plus_1_5:  odds.hdp_home_plus_1_5,
          hdp_away_minus_2_5: odds.hdp_away_minus_2_5,
          hdp_home_plus_2_5:  odds.hdp_home_plus_2_5,
          exact_score_odds: exactGrid,
          ...(cupOdds ?? {}),
          ...(cupSpecialOdds ?? {}),
          ...(cupRound6Odds ?? {}),
        }, { onConflict: 'match_id' })
        await persistOddsDiagnostics(adminSupaOdds, m.id, 'freeze', diagnostics)
      }
    }
  }

  // Goalscorer odds for Wildenroth matches: compute + freeze on first request after Mon 12:00.
  // Map structure: matchId → array of GoalscorerOffer (only is_offered/is_offered_2plus players).
  const goalscorerOffersByMatch: Record<number, (GoalscorerOffer & { status: string })[]> = {}
  // Player name map used by display components for goalscorer selections.
  const playerNameMap: Record<number, string> = {}
  // When a Wildenroth side (I or II) has two of its own matches under the same
  // open Spieltag — a rescheduled midweek Nachholspiel landing on the same
  // effective Spieltag as that week's normal fixture, NOT the separate
  // single-match-per-team English-week Spieltage — both those matches' minute
  // projections are too uncertain (rotation risk across two games in one
  // week) to freeze/offer a Torschützen market immediately. Instead the whole
  // Torschützen tab for BOTH matches stays locked until a fixed buffer after
  // the EARLIER match's kickoff (a proxy for "that match is over"), by which
  // point the admin will typically have entered its match_lineups and
  // recomputed wildenroth_players — so the later match's own projection also
  // benefits from that game's real minutes/goals data once it unlocks.
  const GOALSCORER_DOUBLE_FIXTURE_BUFFER_MS = 2 * 60 * 60 * 1000
  const goalscorerLockUntilByMatch: Record<number, string> = {}
  {
    // Both Wildenroth sides get a goalscorer market, each from its own squad.
    // Resolved by exact name: a substring match on 'Wildenroth' also hits
    // 'SpVgg Wildenroth II', and .find() would then pick whichever happens to
    // appear first in the fixture list.
    const teamIdByName = new Map<string, number>()
    for (const m of allMatches) {
      if (m.home_team?.name) teamIdByName.set(m.home_team.name, m.home_team_id)
      if (m.away_team?.name) teamIdByName.set(m.away_team.name, m.away_team_id)
    }
    const wildenrothSides = [
      { teamId: teamIdByName.get('SpVgg Wildenroth') ?? null, squads: ['1', 'both'] },
      { teamId: teamIdByName.get('SpVgg Wildenroth II') ?? null, squads: ['2', 'both'] },
    ].filter((s): s is { teamId: number; squads: string[] } => s.teamId != null)

    for (const side of wildenrothSides) {
      const wildenrothId = side.teamId
      const wildenrothMatches = matchdayMatches.filter(
        m => m.status === 'scheduled' && (m.home_team_id === wildenrothId || m.away_team_id === wildenrothId)
      )

      // Always fetch active players (needed for name map at display time).
      const { data: playersRaw } = await supabase
        .from('wildenroth_players')
        .select('id, name, position, games, minutes, goals, assists, prev_games, prev_minutes, prev_goals, friendly_goals, is_goalkeeper, is_penalty_taker, is_freekick_taker, active')
        .eq('active', true).in('squad', side.squads)
      const players = (playersRaw ?? []) as WildenrothPlayer[]
      for (const p of players) playerNameMap[p.id] = p.name

      // Only the LATER match(es) of a double-fixture Spieltag get locked — the
      // earlier (e.g. midweek) match's own Torschützen market stays open and
      // freezes normally, exactly like Option 2 asked for. Locking the
      // earlier match too (as an earlier version of this code did) made no
      // sense: its own kickoff is what the lock is waiting on in the first
      // place.
      const lockedMatchIds = new Set<number>()
      if (wildenrothMatches.length >= 2) {
        const sortedByKickoff = [...wildenrothMatches].sort(
          (a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime()
        )
        const earliestKickoff = new Date(sortedByKickoff[0].match_date).getTime()
        const unlockAt = earliestKickoff + GOALSCORER_DOUBLE_FIXTURE_BUFFER_MS
        if (Date.now() < unlockAt) {
          for (const m of sortedByKickoff.slice(1)) {
            lockedMatchIds.add(m.id)
            goalscorerLockUntilByMatch[m.id] = new Date(unlockAt).toISOString()
          }
        }
      }
      const openWildenrothMatches = wildenrothMatches.filter(m => !lockedMatchIds.has(m.id))

      if (openWildenrothMatches.length > 0 && isBettingOpen) {
        const wmIds = openWildenrothMatches.map(m => m.id)

        const { data: existingRows } = await supabase
          .from('match_goalscorer_odds')
          .select('match_id, player_id, status, is_offered, is_offered_2plus, prob_score, prob_score_2plus, odds_score, odds_score_2plus, frozen_at, manually_overridden')
          .in('match_id', wmIds)

        // Per-(match,player) — NOT per-match. A match-level "is this match
        // already frozen" check meant that once a single row for a match had
        // frozen_at set, every other still-unfrozen row for that SAME match
        // (e.g. a player added/reactivated after the first freeze) would
        // never get frozen at all, silently staying invisible/unbettable
        // forever even though it holds a real admin-set price.
        const frozenKeys = new Set(
          (existingRows ?? []).filter(r => r.frozen_at).map(r => `${r.match_id}:${r.player_id}`)
        )
        // Rows an admin already manually blocked/enabled/re-priced (via
        // /availability or /cancel-player, typically before the window opened)
        // must survive this automatic freeze — otherwise the first real page
        // load after betting opens silently reverts the admin's edit back to
        // the model's own numbers, which is exactly what happened last time.
        const overriddenKeys = new Set(
          (existingRows ?? []).filter(r => r.manually_overridden).map(r => `${r.match_id}:${r.player_id}`)
        )
        // match_goalscorer_odds only grants writes to admins, so the freeze must
        // go through the service-role client exactly like the 1X2 freeze above —
        // otherwise a normal member's page load silently writes nothing and the
        // Torschützen tab never appears for them.
        const adminSupaGs = createAdminClient()

        for (const m of openWildenrothMatches) {
          // Match-specific xG override (see exactScoreXgOverrideMap above) —
          // so a cup fixture's goalscorer odds shift consistently with the
          // same corrected team xG used for its other cup markets, instead of
          // being derived from a different (uncorrected) strength estimate.
          const gsXgOverride = exactScoreXgOverrideMap.get(m.id)
          const offers = computeGoalscorerOffersForMatch(
            seasonMatches, m.home_team_id, m.away_team_id, wildenrothId, players, priorCtx, gsXgOverride,
          )
          const now = new Date().toISOString()
          for (const o of offers) {
            if (frozenKeys.has(`${m.id}:${o.player_id}`)) continue // already live — never re-freeze
            if (overriddenKeys.has(`${m.id}:${o.player_id}`)) {
              await adminSupaGs.from('match_goalscorer_odds')
                .update({ frozen_at: now, updated_at: now })
                .eq('match_id', m.id).eq('player_id', o.player_id)
              continue
            }
            await adminSupaGs.from('match_goalscorer_odds').upsert({
              match_id: m.id,
              player_id: o.player_id,
              status: 'available',
              is_offered: o.is_offered,
              is_offered_2plus: o.is_offered_2plus,
              prob_score: o.prob_score,
              prob_score_2plus: o.prob_score_2plus,
              odds_score: o.odds_score,
              odds_score_2plus: o.odds_score_2plus,
              frozen_at: now,
              updated_at: now,
            }, { onConflict: 'match_id,player_id' })
          }
        }

        // (Re)load frozen rows for display
        const { data: frozenRows } = await supabase
          .from('match_goalscorer_odds')
          .select('match_id, player_id, status, is_offered, is_offered_2plus, prob_score, prob_score_2plus, odds_score, odds_score_2plus')
          .in('match_id', wmIds)

        for (const r of frozenRows ?? []) {
          const list = goalscorerOffersByMatch[r.match_id] ?? []
          list.push({
            player_id: r.player_id,
            player_name: playerNameMap[r.player_id] ?? '?',
            position: null,
            prob_score: Number(r.prob_score ?? 0),
            prob_score_2plus: Number(r.prob_score_2plus ?? 0),
            odds_score: Number(r.odds_score ?? 0),
            odds_score_2plus: Number(r.odds_score_2plus ?? 0),
            is_offered: r.is_offered,
            is_offered_2plus: r.is_offered_2plus,
            status: r.status,
          })
          goalscorerOffersByMatch[r.match_id] = list
        }

        // Fill in position from playerNameMap join (re-query players already loaded)
        const playerMetaById = new Map(players.map(p => [p.id, p]))
        for (const matchId of Object.keys(goalscorerOffersByMatch)) {
          for (const o of goalscorerOffersByMatch[Number(matchId)]) {
            const p = playerMetaById.get(o.player_id)
            if (p) o.position = p.position
          }
        }
      }
    }
  }

  // Apply admin odds overrides (override any market value if set)
  const exactScoreOverrideMap: Record<number, Record<string, number>> = {}
  if (isBettingOpen && matchdayMatches.some(m => m.status === 'scheduled')) {
    const scheduledIds = matchdayMatches.filter(m => m.status === 'scheduled').map(m => m.id)
    if (scheduledIds.length > 0) {
      // Use admin client to bypass RLS — overrides must be visible to all users, not just admins.
      const { data: overrideRows } = await createAdminClient()
        .from('match_odds_overrides')
        .select('*')
        .in('match_id', scheduledIds)
      for (const ov of overrideRows ?? []) {
        if (ov.exact_score_overrides) exactScoreOverrideMap[ov.match_id] = ov.exact_score_overrides
        const existing = oddsMap[ov.match_id]
        if (!existing) continue
        const merged = { ...existing }
        if (ov.home_win != null) merged.home_win = Number(ov.home_win)
        if (ov.draw != null) merged.draw = Number(ov.draw)
        if (ov.away_win != null) merged.away_win = Number(ov.away_win)
        if (ov.odds_1x != null) merged.odds_1x = Number(ov.odds_1x)
        if (ov.odds_x2 != null) merged.odds_x2 = Number(ov.odds_x2)
        if (ov.odds_12 != null) merged.odds_12 = Number(ov.odds_12)
        if (ov.over_2_5 != null) merged.over_2_5 = Number(ov.over_2_5)
        if (ov.under_2_5 != null) merged.under_2_5 = Number(ov.under_2_5)
        if (ov.over_3_5 != null) merged.over_3_5 = Number(ov.over_3_5)
        if (ov.under_3_5 != null) merged.under_3_5 = Number(ov.under_3_5)
        if (ov.over_5_5 != null) merged.over_5_5 = Number(ov.over_5_5)
        if (ov.under_5_5 != null) merged.under_5_5 = Number(ov.under_5_5)
        if (ov.over_7_5 != null) merged.over_7_5 = Number(ov.over_7_5)
        if (ov.under_7_5 != null) merged.under_7_5 = Number(ov.under_7_5)
        if (ov.btts_yes != null) merged.btts_yes = Number(ov.btts_yes)
        if (ov.btts_no != null) merged.btts_no = Number(ov.btts_no)
        if (ov.hdp_home_minus_1_5 != null) merged.hdp_home_minus_1_5 = Number(ov.hdp_home_minus_1_5)
        if (ov.hdp_away_plus_1_5 != null) merged.hdp_away_plus_1_5 = Number(ov.hdp_away_plus_1_5)
        if (ov.hdp_home_minus_2_5 != null) merged.hdp_home_minus_2_5 = Number(ov.hdp_home_minus_2_5)
        if (ov.hdp_away_plus_2_5 != null) merged.hdp_away_plus_2_5 = Number(ov.hdp_away_plus_2_5)
        if (ov.hdp_away_minus_1_5 != null) merged.hdp_away_minus_1_5 = Number(ov.hdp_away_minus_1_5)
        if (ov.hdp_home_plus_1_5 != null) merged.hdp_home_plus_1_5 = Number(ov.hdp_home_plus_1_5)
        if (ov.hdp_away_minus_2_5 != null) merged.hdp_away_minus_2_5 = Number(ov.hdp_away_minus_2_5)
        if (ov.hdp_home_plus_2_5 != null) merged.hdp_home_plus_2_5 = Number(ov.hdp_home_plus_2_5)
        oddsMap[ov.match_id] = merged
      }
    }
  }

  // Final offered exact scores per match: persisted auto grid + admin
  // override, filtered to MAX_EXACT_ODDS only AFTER merging (see
  // mergeExactScoreOffers) — the single source of truth also used to
  // validate a submitted exact-score bet server-side.
  const exactScoreOffersMap: Record<number, { score: string; odds: number }[]> = {}
  for (const m of matchdayMatches) {
    if (exactScoreAutoMap[m.id]) {
      exactScoreOffersMap[m.id] = mergeExactScoreOffers(exactScoreAutoMap[m.id], exactScoreOverrideMap[m.id])
    }
  }

  // Standings positions — computed SEPARATELY per competition, not pooled
  // across all of them. 'kreisliga' matches are the real Kreisliga Zugspitze
  // table (Wildenroth I's league); 'wildenroth_ii' + 'bklasse_topspiel' +
  // 'b-klasse' matches all belong to the SAME underlying B-Klasse Gruppe 2
  // table (Wildenroth II's league) — mixing either group into one combined
  // ranking produced nonsense positions like "Platz 18"/"Platz 24" for
  // B-Klasse teams, since a league of ~11 teams can't have a position that
  // high; it was really their rank across two unrelated leagues' team pools
  // stacked together.
  function computePositions(pool: Match[]): Record<number, number> {
    const teamPtsMap = new Map<number, { pts: number; gd: number; gf: number }>()
    for (const m of pool) {
      if (m.status !== 'finished' || m.home_score === null || m.away_score === null) continue
      const hs = m.home_score; const as_ = m.away_score
      const h = teamPtsMap.get(m.home_team_id) ?? { pts: 0, gd: 0, gf: 0 }
      const a = teamPtsMap.get(m.away_team_id) ?? { pts: 0, gd: 0, gf: 0 }
      h.gf += hs; h.gd += hs - as_; a.gf += as_; a.gd += as_ - hs
      if (hs > as_) h.pts += 3; else if (hs < as_) a.pts += 3; else { h.pts++; a.pts++ }
      teamPtsMap.set(m.home_team_id, h); teamPtsMap.set(m.away_team_id, a)
    }
    const sortedTeams = [...teamPtsMap.entries()].sort(([, a], [, b]) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
    const result: Record<number, number> = {}
    sortedTeams.forEach(([id], idx) => { result[id] = idx + 1 })
    return result
  }
  const kreisligaPool = seasonMatches.filter(m => !m.match_category || m.match_category === 'kreisliga')
  const bKlassePool = seasonMatches.filter(m => m.match_category === 'wildenroth_ii' || m.match_category === 'bklasse_topspiel' || m.match_category === 'b-klasse')
  const positions: Record<number, number> = { ...computePositions(kreisligaPool), ...computePositions(bKlassePool) }

  // Find Wildenroth team IDs (1. and 2. Mannschaft are separate teams/flags)
  const allTeamsInMatches = allMatches.flatMap(m => [m.home_team, m.away_team])
  const wildenrothTeamId = allTeamsInMatches.find(t => t?.name === 'SpVgg Wildenroth')?.id ?? null
  const wildenrothIiTeamId = allTeamsInMatches.find(t => t?.name === 'SpVgg Wildenroth II')?.id ?? null

  const matchdayMatchIds = matchdayMatches.map((m) => m.id)

  // Fetch user profile and own bets in parallel
  type OwnBet = {
    id: number; match_id: number; market_type: string; selection: string
    odds_value: number; stake: number | null; status: string; combo_id: number | null; is_risky: boolean
    is_bonus: boolean; special_id: number | null
  }
  type OwnCombo = { id: number; stake: number; status: string; legs: OwnBet[] }

  const [{ data: userProfile }, ownBetsResult] = await Promise.all([
    user ? supabase.from('profiles').select('is_wildenroth, is_wildenroth_ii, eligible_for_current_season, is_admin').eq('id', user.id).single() : Promise.resolve({ data: null }),
    user && matchdayMatchIds.length > 0
      ? supabase.from('bets').select('id, match_id, market_type, selection, odds_value, stake, status, combo_id, is_risky, is_bonus, special_id').eq('user_id', user.id).in('match_id', matchdayMatchIds).neq('status', 'void')
      : Promise.resolve({ data: [] }),
  ])

  const isWildenrothPlayer = userProfile?.is_wildenroth ?? false
  const isWildenrothIiPlayer = userProfile?.is_wildenroth_ii ?? false

  // Saisonstart-Regel: nicht teilnahmeberechtigte Nutzer bekommen eine Hinweis-Seite
  const isNotEligible = seasonStarted && !!user
    && !userProfile?.eligible_for_current_season && !userProfile?.is_admin

  let normalBetCount = 0
  let riskyBetCount = 0
  let userSingles: OwnBet[] = []
  let userCombos: OwnCombo[] = []

  if (user && matchdayMatchIds.length > 0) {
    const ownBets = ownBetsResult.data ?? []
    if (ownBets.length > 0) {
      userSingles = (ownBets as OwnBet[]).filter(b => !b.combo_id)
      const comboIds = [...new Set(ownBets.filter(b => b.combo_id).map(b => Number(b.combo_id)))]
      if (comboIds.length > 0) {
        const { data: comboBetRows } = await supabase
          .from('combo_bets')
          .select('id, stake, status')
          .in('id', comboIds)
        userCombos = (comboBetRows ?? []).map(cb => ({
          id: cb.id,
          stake: cb.stake,
          status: cb.status,
          legs: (ownBets as OwnBet[]).filter(b => Number(b.combo_id) === cb.id),
        }))
      }

      // Counts come from the actually stored is_risky flag (set once, server-side,
      // at placement — see /api/bets/place) rather than re-derived from odds here.
      // A combo's legs all share one is_risky value, so any leg reflects the
      // whole combo's slot. Slot counting here must match the actual limit
      // enforced at placement (/api/bets/place): PENDING *and* already-settled
      // ('won'/'lost') bets occupy a slot — a slip settling early does not
      // free that slot back up, so the header must keep showing it as used
      // instead of dropping back to 0 and implying another normal/risky bet
      // is still available. `ownBetsResult` already excludes 'void' (cancelled)
      // bets via its `.neq('status', 'void')` fetch, so userSingles/userCombos
      // here are already exactly "pending + won + lost" — no extra filter needed.
      // The Pokal-Bonus slip (bets.is_bonus, see /api/bets/place) never
      // occupies a normal/risky slot either — same exclusion as the actual
      // limit enforcement (which filters `!b.is_bonus` before counting).
      const nonBonusSingles = userSingles.filter(b => !b.is_bonus)
      const riskySingles = nonBonusSingles.filter(b => b.is_risky).length
      const riskyCombos = userCombos.filter(c => c.legs[0]?.is_risky).length
      riskyBetCount = riskySingles + riskyCombos
      normalBetCount = (nonBonusSingles.length - riskySingles) + (userCombos.length - riskyCombos)
    }
  }

  const userMatchMap: Record<number, { home: string; away: string; kickoff: string }> = Object.fromEntries(
    matchdayMatches.map(m => [m.id, {
      home: m.home_team?.name ?? m.home_team?.short_name ?? '?',
      away: m.away_team?.name ?? m.away_team?.short_name ?? '?',
      kickoff: m.match_date,
    }])
  )

  // Social bets: visible after each individual match kicks off (RLS policy allows this)
  type SocialBet = { id: string; market_type: string; selection: string; odds_value: number; status: string; combo_id: string | null; user_id: string; match_id: number; stake: number | null; special_id: number | null }
  type SocialCombo = { id: number; stake: number; total_odds: number; status: string; payout: number | null }
  type SocialProfile = { id: string; display_name: string | null; username: string; avatar_url: string | null }
  let socialBets: SocialBet[] = []
  const socialCombos: Record<string, SocialCombo> = {}
  let socialProfiles: SocialProfile[] = []
  // Count of ALL bet slips per match, own included (always fetched via admin for placeholder display)
  const betCountByMatch: Record<number, number> = {}
  // Same idea, but for Spieltag-Specials — since a Special bet's match_id is
  // excluded from betCountByMatch above (see comment there), it would
  // otherwise show NO "🔒 N Wettscheine · sichtbar ab Anpfiff" placeholder at
  // all while still locked (before the Spieltag's first match kicks off),
  // silently looking as if nobody had bet on it yet.
  let specialBetCount = 0

  if (user && matchdayMatchIds.length > 0) {
    const adminSupa = createAdminClient()
    const { data: countRows } = await adminSupa
      .from('bets')
      .select('id, match_id, combo_id, market_type')
      .in('match_id', matchdayMatchIds)
      .neq('status', 'void')
    // Keyed by "matchId:comboId", not just comboId — a combo's bet slip counts as
    // one "Wettschein" on EVERY match it has a leg on, not just the one match
    // whose row happens to come first in this unordered query. A combo-id-only
    // Set here meant a match whose combo legs never "won" that arbitrary race
    // got credited 0 bets and silently vanished from "Alle Tipps" entirely
    // (return null on count === 0), even though it had real, visible bets and
    // was fully bettable — this is what made SV Fuchstal – FC Issing disappear.
    const seenCountSlips = new Set<string>()
    const seenSpecialSlips = new Set<string>()
    for (const b of countRows ?? []) {
      if (b.market_type === 'matchday_special') {
        // A Special bet's match_id is only its representative_match_id
        // (technical FK anchor) — never fold it into betCountByMatch (that
        // would inflate that one ordinary match's own count) — count it
        // separately instead, deduped by combo the same way.
        const key = b.combo_id ? `combo:${b.combo_id}` : `bet:${b.id}`
        if (!seenSpecialSlips.has(key)) {
          seenSpecialSlips.add(key)
          specialBetCount++
        }
        continue
      }
      if (!b.combo_id) {
        betCountByMatch[b.match_id] = (betCountByMatch[b.match_id] ?? 0) + 1
        continue
      }
      const dedupKey = `${b.match_id}:${b.combo_id}`
      if (!seenCountSlips.has(dedupKey)) {
        seenCountSlips.add(dedupKey)
        betCountByMatch[b.match_id] = (betCountByMatch[b.match_id] ?? 0) + 1
      }
    }
  }

  // RLS enforces per-match/per-combo-leg visibility server-side; this is just a cheap
  // pre-check to skip the query entirely before any match in the matchday has kicked off.
  // Includes the current user's own bets — the "Tipps der anderen" section below shows
  // them inline (labelled "Du") alongside everyone else's, for a single complete overview
  // per match, rather than requiring a separate look at "Own placed bets" for that.
  const anyMatchStarted = matchdayMatches.some((m) => new Date(m.match_date) <= new Date())
  if (anyMatchStarted && matchdayMatchIds.length > 0) {
    const { data: rawSocial } = await supabase
      .from('bets')
      .select('id, market_type, selection, odds_value, status, combo_id, user_id, match_id, stake, special_id, is_risky')
      .in('match_id', matchdayMatchIds)

    if (rawSocial && rawSocial.length > 0) {
      socialBets = rawSocial
      const uids = [...new Set(rawSocial.map(b => b.user_id))]
      const comboIds = [...new Set(rawSocial.filter(b => b.combo_id).map(b => b.combo_id as string))]
      const [pResult, cbResult] = await Promise.all([
        supabase.from('profiles').select('id, display_name, username, avatar_url').in('id', uids),
        comboIds.length > 0
          ? supabase.from('combo_bets').select('id, stake, total_odds, status, payout').in('id', comboIds)
          : Promise.resolve({ data: [] }),
      ])
      socialProfiles = pResult.data ?? []
      for (const cb of cbResult.data ?? []) socialCombos[String(cb.id)] = cb
    }
  }

  // Spieltags-Recap: complete when all non-postponed matches are finished (≥1 must be finished).
  // Matchday 999 is the reserved test matchday — excluded here too, matching
  // settle/route.ts and lib/awards.ts, so test-bet results/usernames never
  // surface as a "real" recap preview during a pre-season test run.
  const nonPostponedMatches = matchdayMatches.filter(m => m.status !== 'postponed')
  const isMatchdayComplete = currentMatchday !== 999 && nonPostponedMatches.length > 0 &&
    nonPostponedMatches.every(m => m.status === 'finished')

  let recapData: RecapData | null = null

  if (isMatchdayComplete && matchdayMatchIds.length > 0) {
    const { data: recapBets } = await supabase
      .from('bets')
      .select('id, user_id, match_id, market_type, selection, stake, odds_value, payout, status, combo_id, is_risky, created_at, special_id')
      .in('match_id', matchdayMatchIds)
      .in('status', ['won', 'lost'])

    if (recapBets && recapBets.length > 0) {
      const singleBets = recapBets.filter(b => !b.combo_id)
      const comboLegBets = recapBets.filter(b => b.combo_id)
      const comboIds = [...new Set(comboLegBets.map(b => Number(b.combo_id)))]

      let recapCombos: { id: number; user_id: string; stake: number; total_odds: number; payout: number; status: string; created_at: string }[] = []
      let allComboLegs: { id: number; combo_id: number; status: string; match_id: number }[] = []

      if (comboIds.length > 0) {
        const { data: comboRows } = await supabase
          .from('combo_bets')
          .select('id, user_id, stake, total_odds, payout, status, created_at')
          .in('id', comboIds)
          .in('status', ['won', 'lost'])
        recapCombos = comboRows ?? []

        const { data: legRows } = await supabase
          .from('bets')
          .select('id, combo_id, status, match_id')
          .in('combo_id', comboIds)
        allComboLegs = (legRows ?? []).map(l => ({ ...l, combo_id: Number(l.combo_id) }))
      }

      // Kickoff lookups for Last-Minute-Tipper: single bets use their own
      // match's kickoff; combos use the EARLIEST kickoff among all their
      // legs (that's when the whole slip stops being placeable).
      const matchDateMap = new Map<number, string>(matchdayMatches.map(m => [m.id, m.match_date]))
      const comboEarliestKickoff = new Map<number, string>()
      for (const l of allComboLegs) {
        const d = matchDateMap.get(l.match_id)
        if (!d) continue
        const cur = comboEarliestKickoff.get(l.combo_id)
        if (!cur || d < cur) comboEarliestKickoff.set(l.combo_id, d)
      }

      const recapUserIds = [...new Set([...recapBets.map(b => b.user_id), ...recapCombos.map(c => c.user_id)])]
      const { data: recapProfiles } = await supabase
        .from('profiles')
        .select('id, display_name, username')
        .in('id', recapUserIds)
      const pMap = Object.fromEntries((recapProfiles ?? []).map(p => [p.id, p.display_name || p.username || 'Unbekannt']))

      const RECAP_MKT_LBL: Record<string, string> = {
        '1x2': '1X2', double_chance: 'Dopp. Chance', over_under: 'Ü/U 2,5',
        over_under_3_5: 'Ü/U 3,5', over_under_5_5: 'Ü/U 5,5', over_under_7_5: 'Ü/U 7,5',
        btts: 'Beide treffen', handicap: 'Handicap', exact_score: 'Ergebnis',
        goalscorer: 'Torschütze', goalscorer_2plus: 'Mind. 2 Tore',
      }
      const RECAP_SEL_LBL: Record<string, Record<string, string>> = {
        '1x2': { home: 'Heimsieg', draw: 'Unentschieden', away: 'Auswärtssieg' },
        double_chance: { '1x': '1X', x2: 'X2', '12': '12' },
        over_under: { 'over_2.5': 'Über 2,5', 'under_2.5': 'Unter 2,5' },
        over_under_3_5: { 'over_3.5': 'Über 3,5', 'under_3.5': 'Unter 3,5' },
        over_under_5_5: { 'over_5.5': 'Über 5,5', 'under_5.5': 'Unter 5,5' },
        over_under_7_5: { 'over_7.5': 'Über 7,5', 'under_7.5': 'Unter 7,5' },
        btts: { yes: 'Beide treffen', no: 'Nicht beide' },
        handicap: {
          home_minus_1_5: 'Heim –1,5', away_plus_1_5: 'Gast +1,5', home_minus_2_5: 'Heim –2,5', away_plus_2_5: 'Gast +2,5',
          away_minus_1_5: 'Gast –1,5', home_plus_1_5: 'Heim +1,5', away_minus_2_5: 'Gast –2,5', home_plus_2_5: 'Heim +2,5',
        },
      }
      // Match names for the single-bet award detail lines below (Eier aus
      // Stahl/Betonmischer/Volltreffer/Ergebnis-Orakel/Last-Minute-Tipper) —
      // one query for this Spieltag's own matches, not per-award.
      const recapMatchNameMap = new Map<number, string>()
      {
        const { data: recapMatchRows } = await supabase
          .from('matches')
          .select('id, home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name)')
          .in('id', matchdayMatchIds)
        for (const m of recapMatchRows ?? []) {
          const ht = Array.isArray(m.home_team) ? m.home_team[0] : m.home_team
          const at = Array.isArray(m.away_team) ? m.away_team[0] : m.away_team
          recapMatchNameMap.set(m.id, `${ht?.name ?? '?'} – ${at?.name ?? '?'}`)
        }
      }
      function recapBetDetail(b: { match_id: number | null; market_type: string; selection: string; special_id?: number | null }): import('@/components/MatchdayRecap').RecapBetDetail | undefined {
        // A Special's match_id is only its representative_match_id (technical
        // FK anchor, see lib/matchdaySpecials.ts) — never resolve its recap
        // line via recapMatchNameMap, which would show the wrong "match".
        if (b.market_type === 'matchday_special') {
          const special = b.special_id != null ? specialsById[b.special_id] : undefined
          if (!special) return undefined
          return {
            matchName: `Spieltag ${special.matchday}`,
            market: specialShortTitle(special.template_key),
            selection: specialSelectionLabel(special, b.selection),
          }
        }
        if (!b.match_id) return undefined
        const matchName = recapMatchNameMap.get(b.match_id)
        if (!matchName) return undefined
        const selection = b.market_type === 'exact_score' ? b.selection
          : (b.market_type === 'goalscorer' || b.market_type === 'goalscorer_2plus')
            ? (playerNameMap[parseInt(b.selection, 10)] ?? b.selection)
            : (RECAP_SEL_LBL[b.market_type]?.[b.selection] ?? cupSelectionLabel(b.market_type, b.selection) ?? b.selection)
        return {
          matchName,
          market: RECAP_MKT_LBL[b.market_type] ?? CUP_MARKET_LABEL[b.market_type] ?? b.market_type,
          selection,
        }
      }

      // 1. Spieltagskönig — best net saldo (singles + combos)
      const netGain: Record<string, number> = {}
      for (const b of singleBets) {
        const g = b.status === 'won' ? (b.payout ?? 0) - b.stake : -b.stake
        netGain[b.user_id] = (netGain[b.user_id] ?? 0) + g
      }
      for (const c of recapCombos) {
        const g = c.status === 'won' ? c.payout - c.stake : -c.stake
        netGain[c.user_id] = (netGain[c.user_id] ?? 0) + g
      }
      const mvpEntry = Object.entries(netGain).filter(([, g]) => g > 0).sort((a, b) => b[1] - a[1])[0]
      const spieltagskoenig: RecapData['spieltagskoenig'] = mvpEntry
        ? { name: pMap[mvpEntry[0]] ?? 'Unbekannt', profit: mvpEntry[1] } : null

      // 2. Eier aus Stahl — highest won odds (singles OR combos)
      const wonSingles = singleBets.filter(b => b.status === 'won')
      const wonCombos = recapCombos.filter(c => c.status === 'won')
      const topWonSingle = [...wonSingles].sort((a, b) => b.odds_value - a.odds_value)[0] ?? null
      const topWonCombo  = [...wonCombos].sort((a, b) => b.total_odds - a.total_odds)[0] ?? null
      let eierAusStahl: RecapData['eierAusStahl'] = null
      {
        const sO = topWonSingle?.odds_value ?? 0
        const cO = topWonCombo?.total_odds ?? 0
        if (sO >= cO && topWonSingle) {
          eierAusStahl = { name: pMap[topWonSingle.user_id] ?? 'Unbekannt', odds: sO, stake: topWonSingle.stake, payout: topWonSingle.payout ?? 0, isCombo: false, bet: recapBetDetail(topWonSingle) }
        } else if (topWonCombo) {
          const legsByComboEi = allComboLegs.reduce<Record<number, unknown[]>>((acc, l) => { (acc[l.combo_id] ??= []).push(l); return acc }, {})
          eierAusStahl = { name: pMap[topWonCombo.user_id] ?? 'Unbekannt', odds: cO, stake: topWonCombo.stake, payout: topWonCombo.payout, isCombo: true, legs: (legsByComboEi[topWonCombo.id] ?? []).length }
        }
      }

      // 3. Unlucky Bastard — lost combo with exactly 1 lost leg
      const legsByCombo = allComboLegs.reduce<Record<number, { status: string }[]>>((acc, l) => {
        if (!acc[l.combo_id]) acc[l.combo_id] = []
        acc[l.combo_id].push({ status: l.status })
        return acc
      }, {})
      // combo_bets has no is_risky column of its own — every leg carries the
      // same value, so any one leg reflects the combo's classification.
      // comboLegBets (a subset of recapBets) still has is_risky; allComboLegs
      // (fetched separately, all legs incl. other matchdays) does not.
      const comboIsRiskyMap = new Map<number, boolean>()
      for (const l of comboLegBets) {
        const cid = Number(l.combo_id)
        if (!comboIsRiskyMap.has(cid)) comboIsRiskyMap.set(cid, !!l.is_risky)
      }
      const unluckyResults = recapCombos
        .filter(c => c.status === 'lost')
        .map(c => {
          const legs = legsByCombo[c.id] ?? []
          return { c, legs, lostCount: legs.filter(l => l.status === 'lost').length }
        })
        .filter(x => x.lostCount === 1 && x.legs.length >= 2 && x.legs.every(l => l.status !== 'pending'))
        .sort((a, b) => (b.c.stake * b.c.total_odds) - (a.c.stake * a.c.total_odds))
      const unlucky = unluckyResults[0] ?? null

      let unluckyLegDetails: import('@/components/MatchdayRecap').RecapLegDetail[] = []
      if (unlucky) {
        const { data: legDetailRows } = await supabase
          .from('bets')
          .select('market_type, selection, odds_value, status, special_id, match:matches(home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name))')
          .eq('combo_id', unlucky.c.id)
          .order('id')
        unluckyLegDetails = (legDetailRows ?? []).map(l => {
          // A Special leg's match_id is only its representative_match_id —
          // never show that joined match's teams for it.
          if (l.market_type === 'matchday_special') {
            const special = l.special_id != null ? specialsById[l.special_id] : undefined
            return {
              matchName: special ? `Spieltag ${special.matchday}` : 'Spieltag-Special',
              market: special ? specialShortTitle(special.template_key) : '',
              selection: special ? specialSelectionLabel(special, l.selection) : l.selection,
              odds: l.odds_value,
              status: l.status as 'won' | 'lost' | 'pending',
            }
          }
          const m = Array.isArray(l.match) ? l.match[0] : l.match
          const ht = m ? (Array.isArray(m.home_team) ? m.home_team[0] : m.home_team) : null
          const at = m ? (Array.isArray(m.away_team) ? m.away_team[0] : m.away_team) : null
          const sel = l.market_type === 'exact_score' ? l.selection
            : (l.market_type === 'goalscorer' || l.market_type === 'goalscorer_2plus')
              ? (playerNameMap[parseInt(l.selection, 10)] ?? l.selection)
              : (RECAP_SEL_LBL[l.market_type]?.[l.selection] ?? cupSelectionLabel(l.market_type, l.selection) ?? l.selection)
          return {
            matchName: `${ht?.name ?? '?'} – ${at?.name ?? '?'}`,
            market: RECAP_MKT_LBL[l.market_type] ?? CUP_MARKET_LABEL[l.market_type] ?? l.market_type,
            selection: sel,
            odds: l.odds_value,
            status: l.status as 'won' | 'lost' | 'pending',
          }
        })
      }
      const unluckyBastard: RecapData['unluckyBastard'] = unlucky ? {
        name: pMap[unlucky.c.user_id] ?? 'Unbekannt',
        odds: unlucky.c.total_odds,
        stake: unlucky.c.stake,
        legs: unlucky.legs.length,
        wouldHavePayout: Math.round(cappedPayout(unlucky.c.stake, unlucky.c.total_odds, comboIsRiskyMap.get(unlucky.c.id) ?? false) * 100) / 100,
        legDetails: unluckyLegDetails,
      } : null

      // 4. Ergebnis-Orakel — won exact_score bet, highest stake wins tie
      const exactWon = singleBets
        .filter(b => b.market_type === 'exact_score' && b.status === 'won')
        .sort((a, b) => b.stake - a.stake)
      const ergebnisOrakel: RecapData['ergebnisOrakel'] = exactWon[0]
        ? { name: pMap[exactWon[0].user_id] ?? 'Unbekannt', score: exactWon[0].selection, stake: exactWon[0].stake, matchName: exactWon[0].match_id ? recapMatchNameMap.get(exactWon[0].match_id) : undefined }
        : null

      // 5. Griff ins Klo — worst NET Spieltag saldo — the mirror image of
      // Spieltagskönig above, reusing netGain so the two numbers can never
      // contradict each other (previously this summed only lost stakes,
      // ignoring any bets the same user won that Spieltag). Kept in exact
      // sync with lib/awards.ts's persisted computation so this live preview
      // can never disagree with the eventual persisted award.
      const griffEntry = Object.entries(netGain).filter(([, g]) => g < 0).sort((a, b) => a[1] - b[1])[0]
      const griffInsKlo: RecapData['griffInsKlo'] = griffEntry
        ? { name: pMap[griffEntry[0]] ?? 'Unbekannt', loss: Math.abs(griffEntry[1]) }
        : null

      // 6. Betonmischer — lowest odds among won bets, tiebreak: higher stake
      const allWonForBeton = [
        ...wonSingles.map(b => ({ user_id: b.user_id, odds: b.odds_value, stake: b.stake, payout: b.payout ?? 0, isCombo: false, bet: b })),
        ...wonCombos.map(c => ({ user_id: c.user_id, odds: c.total_odds, stake: c.stake, payout: c.payout, isCombo: true, bet: undefined as typeof wonSingles[number] | undefined })),
      ].sort((a, b) => a.odds - b.odds || b.stake - a.stake)
      const betonmischer: RecapData['betonmischer'] = allWonForBeton[0]
        ? { name: pMap[allWonForBeton[0].user_id] ?? 'Unbekannt', odds: allWonForBeton[0].odds, stake: allWonForBeton[0].stake, payout: allWonForBeton[0].payout, isCombo: allWonForBeton[0].isCombo, bet: allWonForBeton[0].bet ? recapBetDetail(allWonForBeton[0].bet) : undefined }
        : null

      // 7. On Fire — most won slips (≥2), tiebreak: saldo
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
      const onFire: RecapData['onFire'] = fireEntry
        ? { name: pMap[fireEntry[0]] ?? 'Unbekannt', count: fireEntry[1].count, pnl: fireEntry[1].pnl }
        : null

      // 8. Großer Wurf — highest NET win among won SINGLE bets only (no
      // combos — a combo win is really Spieltagskönig's story, several legs
      // contributing together; scoping this to Einzelwetten keeps it a
      // genuinely different category instead of usually crowning the same
      // person as Spieltagskönig for the same reason).
      const netWinCandidates = wonSingles.map(b => ({ bet: b, net: (b.payout ?? 0) - b.stake })).sort((a, b) => b.net - a.net)
      const grosserWurf: RecapData['grosserWurf'] = netWinCandidates[0]
        ? { name: pMap[netWinCandidates[0].bet.user_id] ?? 'Unbekannt', amount: netWinCandidates[0].net, bet: recapBetDetail(netWinCandidates[0].bet) }
        : null

      // 9. Torschützen-König — most won goalscorer bets by one user.
      // Tiebreak: higher odds among their won goalscorer picks (not summed
      // payout) — a rarer/bolder correct pick should win the tie.
      const goalscorerWon = [...wonSingles, ...comboLegBets.filter(b => b.status === 'won')].filter(
        b => b.market_type === 'goalscorer' || b.market_type === 'goalscorer_2plus'
      )
      const goalscorerByUser: Record<string, { count: number; maxOdds: number; bestBet: typeof goalscorerWon[number] }> = {}
      for (const b of goalscorerWon) {
        const e = goalscorerByUser[b.user_id]
        if (!e) { goalscorerByUser[b.user_id] = { count: 1, maxOdds: b.odds_value, bestBet: b }; continue }
        goalscorerByUser[b.user_id] = {
          count: e.count + 1,
          maxOdds: Math.max(e.maxOdds, b.odds_value),
          bestBet: b.odds_value > e.maxOdds ? b : e.bestBet,
        }
      }
      const torschuetzenEntry = Object.entries(goalscorerByUser)
        .filter(([, { count }]) => count >= 1)
        .sort((a, b) => b[1].count - a[1].count || b[1].maxOdds - a[1].maxOdds)[0]
      const torschuetzenKoenig: RecapData['torschuetzenKoenig'] = torschuetzenEntry
        ? { name: pMap[torschuetzenEntry[0]] ?? 'Unbekannt', count: torschuetzenEntry[1].count, playerName: playerNameMap[parseInt(torschuetzenEntry[1].bestBet.selection, 10)] }
        : null

      // 10. Last-Minute-Tipper — won bet placed less than 1h before its own
      // kickoff. Tiebreak: smallest gap to kickoff wins.
      const ONE_HOUR_MS = 60 * 60 * 1000
      const lastMinuteCandidates: { user_id: string; gapMs: number; matchId?: number | null }[] = []
      for (const b of wonSingles) {
        const kickoff = matchDateMap.get(b.match_id)
        if (!kickoff) continue
        const gapMs = new Date(kickoff).getTime() - new Date(b.created_at).getTime()
        if (gapMs >= 0 && gapMs < ONE_HOUR_MS) lastMinuteCandidates.push({ user_id: b.user_id, gapMs, matchId: b.match_id })
      }
      for (const c of wonCombos) {
        const kickoff = comboEarliestKickoff.get(c.id)
        if (!kickoff) continue
        const gapMs = new Date(kickoff).getTime() - new Date(c.created_at).getTime()
        if (gapMs >= 0 && gapMs < ONE_HOUR_MS) lastMinuteCandidates.push({ user_id: c.user_id, gapMs })
      }
      lastMinuteCandidates.sort((a, b) => a.gapMs - b.gapMs)
      const lastMinuteTipper: RecapData['lastMinuteTipper'] = lastMinuteCandidates[0]
        ? {
            name: pMap[lastMinuteCandidates[0].user_id] ?? 'Unbekannt',
            gapMin: Math.round(lastMinuteCandidates[0].gapMs / 60000),
            gapSec: Math.round(lastMinuteCandidates[0].gapMs / 1000),
            matchName: lastMinuteCandidates[0].matchId != null ? recapMatchNameMap.get(lastMinuteCandidates[0].matchId) : undefined,
          }
        : null

      // Storno-Champ: same shared computeStornoChamp() as the persisted award
      // (lib/awards.ts) — naturally returns null while the relevant matches
      // haven't all finished yet, so this never shows a premature/wrong
      // answer mid-Spieltag, without any extra "is this Spieltag done" check
      // needed here.
      const stornoWinner = await computeStornoChamp(createAdminClient(), matchdayMatchIds)
      const stornoChamp: RecapData['stornoChamp'] = stornoWinner
        ? { name: pMap[stornoWinner.user_id] ?? 'Unbekannt', net: stornoWinner.net, label: stornoWinner.label, betId: stornoWinner.betId, comboId: stornoWinner.comboId }
        : null

      if (spieltagskoenig || eierAusStahl || unluckyBastard || ergebnisOrakel || griffInsKlo || betonmischer || onFire || grosserWurf || torschuetzenKoenig || lastMinuteTipper || stornoChamp) {
        recapData = { spieltagskoenig, eierAusStahl, unluckyBastard, ergebnisOrakel, griffInsKlo, betonmischer, onFire, grosserWurf, torschuetzenKoenig, lastMinuteTipper, stornoChamp }
      }
    }
  }

  if (isNotEligible) {
    return (
      <div className="px-4 py-8 space-y-4 max-w-lg mx-auto">
        <div className="text-center text-5xl">⏳</div>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-5 text-center">
          <h2 className="font-black text-lg text-gray-900 mb-2">Freischaltung ausstehend</h2>
          <p className="text-sm text-gray-600">
            Dein Account ist noch nicht freigeschaltet. Jani schaltet dich in Kürze für die aktuelle Saison frei.
          </p>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4 space-y-2">
          <div className="text-sm font-semibold text-gray-700">Was du schon jetzt tun kannst:</div>
          <ul className="text-sm text-gray-500 space-y-1 list-disc list-inside">
            <li>Rangliste anschauen</li>
            <li>Profil einrichten (Avatar, Lieblingsverein)</li>
            <li>Spielregeln lesen</li>
          </ul>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-4 space-y-4">
      {!seasonStarted && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-amber-800">
          <span>☀️</span>
          <span><strong>Sommerpause</strong> — wir kommen bald wieder!</span>
        </div>
      )}

      {/* Prominent survey banner — only rendered once app_settings.survey_mode
          is switched to 'prominent' (currently 'help_only', see CLAUDE.md /
          the survey feature spec). Built now so flipping the config flag
          alone is enough later. */}
      {surveyMode === 'prominent' && (
        <Link
          href="/umfrage"
          className="block bg-gradient-to-br from-amber-500 to-amber-600 text-white rounded-2xl px-5 py-4 shadow-sm"
        >
          <div className="font-bold text-sm leading-snug">
            📣 Halbzeit! Hilf mit, das Wildenroth-Wettspiel für die Rückrunde und nächste Saison zu verbessern.
          </div>
          <div className="mt-2 inline-block bg-white/20 rounded-lg px-3 py-1.5 text-sm font-bold">
            Umfrage starten →
          </div>
        </Link>
      )}

      {/* Matchday Header */}
      <div className="bg-gradient-to-br from-red-700 to-red-800 text-white rounded-2xl px-5 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-red-200 text-xs font-medium uppercase tracking-wide">Spieltag</div>
            <div className="text-2xl font-black mt-0.5">{currentMatchday}. Spieltag</div>
          </div>
          <div className="text-right flex gap-3">
            <div>
              <div className="text-red-200 text-xs font-medium">Spiele</div>
              <div className="text-xl font-bold">{matchdayMatches.length}</div>
            </div>
            <div>
              <div className="text-red-200 text-xs font-medium">Normal</div>
              <div className={`text-xl font-bold ${normalBetCount >= 2 ? 'text-yellow-300' : ''}`}>
                {normalBetCount}/2
              </div>
            </div>
            <div>
              <div className="text-red-200 text-xs font-medium flex items-center gap-0.5">🎲 Risky</div>
              <div className={`text-xl font-bold ${riskyBetCount >= 1 ? 'text-yellow-300' : ''}`}>
                {riskyBetCount}/1
              </div>
            </div>
          </div>
        </div>

        {/* Betting window not yet open */}
        {!isBettingOpen && !isDeadlinePassed && bettingOpens && (
          <div className="mt-3 bg-red-800/60 rounded-xl px-3 py-2">
            <div className="text-red-200 text-xs">Wetten öffnen am</div>
            <div className="text-white font-semibold text-sm">
              {bettingOpens.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' })} um{' '}
              {bettingOpens.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })} Uhr
            </div>
          </div>
        )}

        {/* Betting open: per-match deadlines */}
        {isBettingOpen && matchdayMatches.some(m => m.status === 'scheduled') && (
          <div className="mt-3 bg-red-800/60 rounded-xl px-3 py-2">
            <div className="text-red-200 text-xs">Tippschluss</div>
            <div className="text-white font-semibold text-sm">
              Jeweils vor dem Anpfiff des Spiels
            </div>
          </div>
        )}
      </div>

      {/* Matchday Selector */}
      <MatchdayScroller activeIndex={displayMatchdays.indexOf(currentMatchday)}>
        {displayMatchdays.map((md) => {
          // Select the pill's matches the same way the page selects the ones it
          // displays under that tab, so a pill's finished/bettable colour can't
          // disagree with its own content (raw `matchday` would pull in
          // B-Klasse/Wildenroth-II matches that carry independent BFV numbering
          // and miss Kreisliga matches reassigned into this Spieltag).
          const mdMatches = seasonMatches.filter((m) => effectiveMatchdayOf(m) === md)
          const hasScheduled = mdMatches.some((m) => m.status === 'scheduled')
          const allFinished = mdMatches.length > 0 && mdMatches.every((m) => m.status === 'finished')
          return (
            <Link
              key={md}
              href={`/tipps?matchday=${md}`}
              className={`flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full text-xs font-bold transition-colors ${
                md === currentMatchday
                  ? 'bg-white text-red-700 shadow'
                  : allFinished
                  ? 'bg-red-800/40 text-red-300'
                  : hasScheduled
                  ? 'bg-red-600 text-white ring-1 ring-red-400'
                  : 'bg-red-800/40 text-red-300/60'
              }`}
            >
              {md}
            </Link>
          )
        })}
      </MatchdayScroller>

      {/* Spieltags-Recap — shown prominently above match cards when matchday is complete */}
      {isMatchdayComplete && recapData && (
        <MatchdayRecap data={recapData} matchday={currentMatchday} />
      )}

      {/* Bonus-Tipps — Sondertipps ohne Einsatz, siehe lib/bonusTips.ts */}
      {user && bonusTips.length > 0 && (
        <BonusTipsSection
          tips={bonusTips}
          myAnswers={myBonusAnswersRaw ?? []}
          myPayouts={myBonusPayoutsRaw ?? []}
          userId={user.id}
        />
      )}

      {/* Match Cards */}
      {!seasonStarted ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm px-6 py-10 text-center space-y-3">
          <div className="text-4xl">📅</div>
          <div className="font-black text-gray-900 dark:text-gray-100 text-lg">Spielplan 26/27</div>
          <div className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">
            Der Spielplan der neuen Saison wird hier angezeigt,<br />
            sobald er vom BFV veröffentlicht wurde.
          </div>
        </div>
      ) : matchdayMatches.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <div className="text-4xl mb-3">⚽</div>
          <div className="font-medium">Keine Spiele</div>
        </div>
      ) : (
        <div className="space-y-3">
          {(() => {
            const kreisligaAll = matchdayMatches.filter(m => !m.match_category || m.match_category === 'kreisliga')
            // Cup fixtures (competition_type='cup') are pinned at the top of
            // their own Spieltag's section in a distinct card instead of the
            // normal Kreisliga list — same effective Spieltag (matchday/
            // tippspiel_matchday), same Wettschein/limits, just a different
            // display slot and its own 4-market card (see CupMatchCard).
            const cupMatches = kreisligaAll.filter(m => m.competition_type === 'cup')
            const kreisliga = kreisligaAll.filter(m => m.competition_type !== 'cup')
            const bklasse = matchdayMatches.filter(m => m.match_category === 'wildenroth_ii' || m.match_category === 'bklasse_topspiel' || (m.match_category === 'b-klasse' && m.is_topspiel))
            return (
              <>
                {cupMatches.map((match) => (
                  <CupMatchCard
                    key={match.id}
                    match={match}
                    odds={match.status === 'scheduled' && isBettingOpen ? (oddsMap[match.id] ?? null) : null}
                    goalscorers={goalscorerOffersByMatch[match.id] ?? null}
                    isWildenrothPlayer={isWildenrothPlayer}
                    wildenrothTeamId={wildenrothTeamId}
                  />
                ))}
                {kreisliga.map((match) => (
                  <BettingMatchCard
                    key={match.id}
                    match={match}
                    odds={match.status === 'scheduled' && isBettingOpen ? (oddsMap[match.id] ?? null) : null}
                    allMatches={oddsMatches}
                    historyMatches={allMatches}
                    positions={positions}
                    isWildenrothPlayer={isWildenrothPlayer}
                    wildenrothTeamId={wildenrothTeamId}
                    isWildenrothIiPlayer={isWildenrothIiPlayer}
                    wildenrothIiTeamId={wildenrothIiTeamId}
                    goalscorers={goalscorerOffersByMatch[match.id] ?? null}
                    goalscorerLockedUntil={goalscorerLockUntilByMatch[match.id] ?? null}
                    originalMatchday={isRescheduledMatch(match, mdIndex) ? match.matchday : null}
                    exactScores={exactScoreOffersMap[match.id] ?? []}
                  />
                ))}
                {bklasse.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 pt-1">
                      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                      <span className="text-xs text-gray-400 dark:text-gray-500 font-semibold uppercase tracking-wide">B-Klasse Spezial</span>
                      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                    </div>
                    {bklasse.map((match) => (
                      <BettingMatchCard
                        key={match.id}
                        match={match}
                        odds={match.status === 'scheduled' && isBettingOpen ? (oddsMap[match.id] ?? null) : null}
                        allMatches={oddsMatches}
                        historyMatches={allMatches}
                        positions={positions}
                        isWildenrothPlayer={isWildenrothPlayer}
                        wildenrothTeamId={wildenrothTeamId}
                        isWildenrothIiPlayer={isWildenrothIiPlayer}
                        wildenrothIiTeamId={wildenrothIiTeamId}
                        goalscorers={goalscorerOffersByMatch[match.id] ?? null}
                        goalscorerLockedUntil={goalscorerLockUntilByMatch[match.id] ?? null}
                        exactScores={exactScoreOffersMap[match.id] ?? []}
                      />
                    ))}
                  </>
                )}
              </>
            )
          })()}
        </div>
      )}

      {/* Spieltag-Specials — Spieltag-weite Wettmärkte, nach dem letzten normalen Spiel */}
      {seasonStarted && matchdayMatches.length > 0 && (
        <MatchdaySpecialsSection specials={activeSpecials} />
      )}

      {/* Social Bets — grouped by match; per-match visibility after each game's kickoff.
          Includes the current user's own bets (labelled "Du") for one complete overview.
          Extracted into a 'use client' component (components/AllTippsSection.tsx) so its
          "Nur aktive Wetten" filter toggle can react instantly, without a full page reload. */}
      {user && (
        <AllTippsSection
          matchdayMatches={matchdayMatches}
          betCountByMatch={betCountByMatch}
          specialBetCount={specialBetCount}
          socialBets={socialBets}
          socialCombos={socialCombos}
          socialProfiles={socialProfiles}
          playerNameMap={playerNameMap}
          userId={user.id}
          specialsById={specialsById}
        />
      )}

      {/* Own placed bets */}
      {user && (userSingles.length > 0 || userCombos.length > 0) && (
        <MyBets
          singles={userSingles}
          combos={userCombos}
          matchMap={userMatchMap}
          isDeadlinePassed={isDeadlinePassed}
          playerNameMap={playerNameMap}
          specialsById={specialsById}
        />
      )}

      <BetSlip />
    </div>
  )
}
