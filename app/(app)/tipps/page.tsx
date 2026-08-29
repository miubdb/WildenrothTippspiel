import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paginatedSelect'
import { BettingMatchCard } from '@/components/BettingMatchCard'
import { BetSlip } from '@/components/BetSlip'
import { MyBets } from '@/components/MyBets'
import { MatchdayScroller } from '@/components/MatchdayScroller'
import { MatchdayRecap } from '@/components/MatchdayRecap'
import type { RecapData } from '@/components/MatchdayRecap'
import type { Match, PriorMatch, LeaguePlayer, LineupEntry } from '@/types'
import { calculateOdds, oddsFromXG, getMatchXG, buildPriorContext, getFullExactScoreMatrix, mergeExactScoreOffers } from '@/lib/odds'
import { persistOddsDiagnostics } from '@/lib/oddsDiagnostics'
import { isSeasonStarted, bettingOpenTime, parseBettingOpenOverrides, buildEffectiveMatchdayIndex, effectiveMatchdayOf as effectiveMatchdayOfShared, isRescheduledMatch } from '@/lib/season'
import { computeGoalscorerOffersForMatch, type WildenrothPlayer, type GoalscorerOffer } from '@/lib/goalscorer'
import Link from 'next/link'
import { TeamLogo } from '@/components/TeamLogo'
import { wildiLabel } from '@/components/WildiIcon'
import { oddsColorClass } from '@/components/WetteCard'

export const revalidate = 60

const SELECTION_DISPLAY: Record<string, Record<string, string>> = {
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

function socialSelLabel(marketType: string, selection: string, players?: Record<number, string>) {
  if (marketType === 'exact_score') return selection
  if (marketType === 'goalscorer' || marketType === 'goalscorer_2plus') {
    const id = parseInt(selection, 10)
    const name = players?.[id] ?? `Spieler #${id}`
    return marketType === 'goalscorer_2plus' ? `${name} (2+)` : name
  }
  return SELECTION_DISPLAY[marketType]?.[selection] ?? selection
}

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
      .select('id, match_id, team_name, player_name, minutes_played, goals, assists, created_at')
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

  const allMatches: Match[] = (allMatchesRaw ?? []).map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  }))

  const priorMatches: PriorMatch[] = (priorMatchesRaw ?? []) as PriorMatch[]

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
  const firstScheduled = [...new Set(
    kreisligaMatches
      .filter((m) => m.status === 'scheduled')
      .map((m) => effectiveMatchdayOf(m))
      .filter((md): md is number => md != null)
  )].sort((a, b) => (matchdayMinDate.get(a) ?? 0) - (matchdayMinDate.get(b) ?? 0))[0]

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
        (matchdayMinDate.get(md) ?? 0) > (matchdayMinDate.get(latest) ?? 0) ? md : latest
      )
    : null
  const defaultMatchday = isPreSeason
    ? (hasTestMatchday ? 999 : 1)
    : isBeforeMondayNoon && lastCompletedMd != null
      ? lastCompletedMd
      : (firstScheduled ?? allMatchdays.filter(md => md !== 999).reduce((latest, md) =>
          (matchdayMinDate.get(md) ?? 0) > (matchdayMinDate.get(latest) ?? 0) ? md : latest
        ))
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

  // Odds snapshot: freeze odds at Monday 12:00 — only use matches finished before that cutoff
  const oddsSnapshotCutoff = bettingOpens ?? deadline
  const oddsMatches = oddsSnapshotCutoff
    ? seasonMatches.filter(
        (m) => m.status !== 'finished' || new Date(m.match_date) < oddsSnapshotCutoff
      )
    : seasonMatches

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
  if (isBettingOpen) {
    const scheduledMatchIds = matchdayMatches.filter(m => m.status === 'scheduled').map(m => m.id)

    // Match-specific model xG override (match_odds_overrides.model_home/away_xg_override)
    // — a rare, explicit correction for a single match whose statistically-derived
    // xG conflicts with a deliberately set manual 1X2 (see SpVgg Wildenroth – TSV
    // 1882 Landsberg II). When present, it is the basis for that match's EXACT-SCORE
    // matrix only — never for the standard markets (oddsFromXG below still always
    // uses the model's own getMatchXG output), and never for other matches' team
    // data (this is a per-match override, not a global stat correction).
    const exactScoreXgOverrideMap = new Map<number, { homeXG: number; awayXG: number }>()
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
    }

    // Compute + persist odds for any scheduled match not yet frozen
    const toFreeze = matchdayMatches.filter(m => m.status === 'scheduled' && !frozenSet.has(m.id))
    if (toFreeze.length > 0) {
      const now = new Date().toISOString()
      for (const m of toFreeze) {
        const { homeXG, awayXG, diagnostics } = getMatchXG(oddsMatches, m.home_team_id, m.away_team_id, priorCtx)
        const odds = oddsFromXG(homeXG, awayXG)
        oddsMap[m.id] = odds
        // Standard markets above always use the model's own xG. The exact-score
        // grid uses the match-specific override when one exists (see comment above).
        const modelXg = exactScoreXgOverrideMap.get(m.id)
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

      if (wildenrothMatches.length > 0 && isBettingOpen) {
        const wmIds = wildenrothMatches.map(m => m.id)

        const { data: existingRows } = await supabase
          .from('match_goalscorer_odds')
          .select('match_id, player_id, status, is_offered, is_offered_2plus, prob_score, prob_score_2plus, odds_score, odds_score_2plus, frozen_at')
          .in('match_id', wmIds)

        const frozenSet = new Set((existingRows ?? []).filter(r => r.frozen_at).map(r => r.match_id))
        // match_goalscorer_odds only grants writes to admins, so the freeze must
        // go through the service-role client exactly like the 1X2 freeze above —
        // otherwise a normal member's page load silently writes nothing and the
        // Torschützen tab never appears for them.
        const adminSupaGs = createAdminClient()

        for (const m of wildenrothMatches) {
          if (!frozenSet.has(m.id)) {
            // Freeze for this match now
            const offers = computeGoalscorerOffersForMatch(
              seasonMatches, m.home_team_id, m.away_team_id, wildenrothId, players, priorCtx,
            )
            const now = new Date().toISOString()
            for (const o of offers) {
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

  // Standings positions
  const teamPtsMap = new Map<number, { pts: number; gd: number; gf: number }>()
  for (const m of seasonMatches) {
    if (m.status !== 'finished' || m.home_score === null || m.away_score === null) continue
    const hs = m.home_score; const as_ = m.away_score
    const h = teamPtsMap.get(m.home_team_id) ?? { pts: 0, gd: 0, gf: 0 }
    const a = teamPtsMap.get(m.away_team_id) ?? { pts: 0, gd: 0, gf: 0 }
    h.gf += hs; h.gd += hs - as_; a.gf += as_; a.gd += as_ - hs
    if (hs > as_) h.pts += 3; else if (hs < as_) a.pts += 3; else { h.pts++; a.pts++ }
    teamPtsMap.set(m.home_team_id, h); teamPtsMap.set(m.away_team_id, a)
  }
  const sortedTeams = [...teamPtsMap.entries()].sort(([, a], [, b]) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
  const positions: Record<number, number> = {}
  sortedTeams.forEach(([id], idx) => { positions[id] = idx + 1 })

  // Find Wildenroth team IDs (1. and 2. Mannschaft are separate teams/flags)
  const allTeamsInMatches = allMatches.flatMap(m => [m.home_team, m.away_team])
  const wildenrothTeamId = allTeamsInMatches.find(t => t?.name === 'SpVgg Wildenroth')?.id ?? null
  const wildenrothIiTeamId = allTeamsInMatches.find(t => t?.name === 'SpVgg Wildenroth II')?.id ?? null

  const matchdayMatchIds = matchdayMatches.map((m) => m.id)

  // Fetch user profile and own bets in parallel
  type OwnBet = {
    id: number; match_id: number; market_type: string; selection: string
    odds_value: number; stake: number | null; status: string; combo_id: number | null; is_risky: boolean
  }
  type OwnCombo = { id: number; stake: number; status: string; legs: OwnBet[] }

  const [{ data: userProfile }, ownBetsResult] = await Promise.all([
    user ? supabase.from('profiles').select('is_wildenroth, is_wildenroth_ii, eligible_for_current_season, is_admin').eq('id', user.id).single() : Promise.resolve({ data: null }),
    user && matchdayMatchIds.length > 0
      ? supabase.from('bets').select('id, match_id, market_type, selection, odds_value, stake, status, combo_id, is_risky').eq('user_id', user.id).in('match_id', matchdayMatchIds)
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
      // whole combo's slot. Only PENDING bets occupy a slot — a settled bet no
      // longer counts toward the limit (cancellation deletes the row outright,
      // so it's already excluded either way).
      const pendingSingles = userSingles.filter(b => b.status === 'pending')
      const pendingCombos = userCombos.filter(c => c.status === 'pending')
      const riskySingles = pendingSingles.filter(b => b.is_risky).length
      const riskyCombos = pendingCombos.filter(c => c.legs[0]?.is_risky).length
      riskyBetCount = riskySingles + riskyCombos
      normalBetCount = (pendingSingles.length - riskySingles) + (pendingCombos.length - riskyCombos)
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
  type SocialBet = { id: string; market_type: string; selection: string; odds_value: number; status: string; combo_id: string | null; user_id: string; match_id: number; stake: number | null }
  type SocialCombo = { id: number; stake: number; total_odds: number; status: string; payout: number | null }
  type SocialProfile = { id: string; display_name: string | null; username: string }
  let socialBets: SocialBet[] = []
  let socialCombos: Record<string, SocialCombo> = {}
  let socialProfiles: SocialProfile[] = []
  // Count of other users' bet slips per match (always fetched via admin for placeholder display)
  const betCountByMatch: Record<number, number> = {}

  if (user && matchdayMatchIds.length > 0) {
    const adminSupa = createAdminClient()
    const { data: countRows } = await adminSupa
      .from('bets')
      .select('match_id, combo_id')
      .in('match_id', matchdayMatchIds)
      .neq('user_id', user.id)
      .neq('status', 'cancelled')
    // Keyed by "matchId:comboId", not just comboId — a combo's bet slip counts as
    // one "Wettschein" on EVERY match it has a leg on, not just the one match
    // whose row happens to come first in this unordered query. A combo-id-only
    // Set here meant a match whose combo legs never "won" that arbitrary race
    // got credited 0 bets and silently vanished from "Alle Tipps" entirely
    // (return null on count === 0), even though it had real, visible bets and
    // was fully bettable — this is what made SV Fuchstal – FC Issing disappear.
    const seenCountSlips = new Set<string>()
    for (const b of countRows ?? []) {
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
      .select('id, market_type, selection, odds_value, status, combo_id, user_id, match_id, stake')
      .in('match_id', matchdayMatchIds)

    if (rawSocial && rawSocial.length > 0) {
      socialBets = rawSocial
      const uids = [...new Set(rawSocial.map(b => b.user_id))]
      const comboIds = [...new Set(rawSocial.filter(b => b.combo_id).map(b => b.combo_id as string))]
      const [pResult, cbResult] = await Promise.all([
        supabase.from('profiles').select('id, display_name, username').in('id', uids),
        comboIds.length > 0
          ? supabase.from('combo_bets').select('id, stake, total_odds, status, payout').in('id', comboIds)
          : Promise.resolve({ data: [] }),
      ])
      socialProfiles = pResult.data ?? []
      for (const cb of cbResult.data ?? []) socialCombos[String(cb.id)] = cb
    }
  }

  // Build match label map for social section
  const matchMap = new Map(matchdayMatches.map(m => [m.id, m]))

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
      .select('id, user_id, match_id, market_type, selection, stake, odds_value, payout, status, combo_id, is_risky')
      .in('match_id', matchdayMatchIds)
      .in('status', ['won', 'lost'])

    if (recapBets && recapBets.length > 0) {
      const singleBets = recapBets.filter(b => !b.combo_id)
      const comboLegBets = recapBets.filter(b => b.combo_id)
      const comboIds = [...new Set(comboLegBets.map(b => Number(b.combo_id)))]

      let recapCombos: { id: number; user_id: string; stake: number; total_odds: number; payout: number; status: string }[] = []
      let allComboLegs: { id: number; combo_id: number; status: string }[] = []

      if (comboIds.length > 0) {
        const { data: comboRows } = await supabase
          .from('combo_bets')
          .select('id, user_id, stake, total_odds, payout, status')
          .in('id', comboIds)
          .in('status', ['won', 'lost'])
        recapCombos = comboRows ?? []

        const { data: legRows } = await supabase
          .from('bets')
          .select('id, combo_id, status')
          .in('combo_id', comboIds)
        allComboLegs = (legRows ?? []).map(l => ({ ...l, combo_id: Number(l.combo_id) }))
      }

      const recapUserIds = [...new Set([...recapBets.map(b => b.user_id), ...recapCombos.map(c => c.user_id)])]
      const { data: recapProfiles } = await supabase
        .from('profiles')
        .select('id, display_name, username')
        .in('id', recapUserIds)
      const pMap = Object.fromEntries((recapProfiles ?? []).map(p => [p.id, p.display_name || p.username || 'Unbekannt']))

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
          eierAusStahl = { name: pMap[topWonSingle.user_id] ?? 'Unbekannt', odds: sO, stake: topWonSingle.stake, payout: topWonSingle.payout ?? 0, isCombo: false }
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
      const unluckyResults = recapCombos
        .filter(c => c.status === 'lost')
        .map(c => {
          const legs = legsByCombo[c.id] ?? []
          return { c, legs, lostCount: legs.filter(l => l.status === 'lost').length }
        })
        .filter(x => x.lostCount === 1 && x.legs.length >= 2 && x.legs.every(l => l.status !== 'pending'))
        .sort((a, b) => (b.c.stake * b.c.total_odds) - (a.c.stake * a.c.total_odds))
      const unlucky = unluckyResults[0] ?? null

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
      let unluckyLegDetails: import('@/components/MatchdayRecap').RecapLegDetail[] = []
      if (unlucky) {
        const { data: legDetailRows } = await supabase
          .from('bets')
          .select('market_type, selection, odds_value, status, match:matches(home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name))')
          .eq('combo_id', unlucky.c.id)
          .order('id')
        unluckyLegDetails = (legDetailRows ?? []).map(l => {
          const m = Array.isArray(l.match) ? l.match[0] : l.match
          const ht = m ? (Array.isArray(m.home_team) ? m.home_team[0] : m.home_team) : null
          const at = m ? (Array.isArray(m.away_team) ? m.away_team[0] : m.away_team) : null
          const sel = l.market_type === 'exact_score' ? l.selection
            : (l.market_type === 'goalscorer' || l.market_type === 'goalscorer_2plus')
              ? (playerNameMap[parseInt(l.selection, 10)] ?? l.selection)
              : (RECAP_SEL_LBL[l.market_type]?.[l.selection] ?? l.selection)
          return {
            matchName: `${ht?.name ?? '?'} – ${at?.name ?? '?'}`,
            market: RECAP_MKT_LBL[l.market_type] ?? l.market_type,
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
        wouldHavePayout: Math.round(unlucky.c.stake * unlucky.c.total_odds * 100) / 100,
        legDetails: unluckyLegDetails,
      } : null

      // 4. Ergebnis-Orakel — won exact_score bet, highest stake wins tie
      const exactWon = singleBets
        .filter(b => b.market_type === 'exact_score' && b.status === 'won')
        .sort((a, b) => b.stake - a.stake)
      const ergebnisOrakel: RecapData['ergebnisOrakel'] = exactWon[0]
        ? { name: pMap[exactWon[0].user_id] ?? 'Unbekannt', score: exactWon[0].selection, stake: exactWon[0].stake }
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
        ...wonSingles.map(b => ({ user_id: b.user_id, odds: b.odds_value, stake: b.stake, payout: b.payout ?? 0, isCombo: false })),
        ...wonCombos.map(c => ({ user_id: c.user_id, odds: c.total_odds, stake: c.stake, payout: c.payout, isCombo: true })),
      ].sort((a, b) => a.odds - b.odds || b.stake - a.stake)
      const betonmischer: RecapData['betonmischer'] = allWonForBeton[0]
        ? { name: pMap[allWonForBeton[0].user_id] ?? 'Unbekannt', odds: allWonForBeton[0].odds, stake: allWonForBeton[0].stake, payout: allWonForBeton[0].payout, isCombo: allWonForBeton[0].isCombo }
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

      if (spieltagskoenig || eierAusStahl || unluckyBastard || ergebnisOrakel || griffInsKlo || betonmischer || onFire) {
        recapData = { spieltagskoenig, eierAusStahl, unluckyBastard, ergebnisOrakel, griffInsKlo, betonmischer, onFire }
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
              {bettingOpens.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' })} um 12:00 Uhr
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
            const kreisliga = matchdayMatches.filter(m => !m.match_category || m.match_category === 'kreisliga')
            const bklasse = matchdayMatches.filter(m => m.match_category === 'wildenroth_ii' || m.match_category === 'bklasse_topspiel' || (m.match_category === 'b-klasse' && m.is_topspiel))
            return (
              <>
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

      {/* Social Bets — grouped by match; per-match visibility after each game's kickoff.
          Includes the current user's own bets (labelled "Du") for one complete overview. */}
      {user && Object.values(betCountByMatch).some(c => c > 0) && (() => {
        const now = new Date()
        const activeSocial = socialBets.filter(b => b.status !== 'cancelled')
        const profileMap = new Map(socialProfiles.map(p => [p.id, p]))
        const nameOf = (uid: string) => {
          if (uid === user.id) return 'Du'
          const p = profileMap.get(uid)
          return p ? (p.display_name || p.username) : 'Unbekannt'
        }
        const initialOf = (uid: string) => (uid === user.id ? 'D' : (nameOf(uid)[0] ?? '?').toUpperCase())
        const totalTippers = new Set(activeSocial.map(b => b.user_id)).size

        // Each combo gets ONE full card (avatar/name/stake/collapsible other legs), placed
        // under its earliest-kickoff match — every other match it touches gets only a slim
        // one-line mention (see compactComboRow below) instead of repeating the full card,
        // which got noisy once combos routinely span 5-8 matches across a matchday.
        const comboFirstMatchId = new Map<string, number>()
        for (const b of activeSocial) {
          if (!b.combo_id) continue
          const cid = String(b.combo_id)
          if (!comboFirstMatchId.has(cid)) {
            comboFirstMatchId.set(cid, b.match_id)
          } else {
            const curMatchDate = new Date(matchMap.get(comboFirstMatchId.get(cid)!)?.match_date ?? '').getTime()
            const thisMatchDate = new Date(matchMap.get(b.match_id)?.match_date ?? '').getTime()
            if (thisMatchDate < curMatchDate) comboFirstMatchId.set(cid, b.match_id)
          }
        }

        return (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-bold text-gray-900 dark:text-gray-100">Alle Tipps</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {totalTippers > 0 ? `${totalTippers} Spieler haben getippt` : 'Tipps sichtbar ab Anpfiff'}
              </p>
            </div>

            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {matchdayMatches.map(match => {
                const matchKickedOff = new Date(match.match_date) <= now
                const count = betCountByMatch[match.id] ?? 0

                if (!matchKickedOff) {
                  if (count === 0) return null
                  return (
                    <div key={match.id} className="px-4 py-3">
                      <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">
                        <TeamLogo name={match.home_team?.name ?? '?'} size="sm" />
                        <span className="truncate">{match.home_team?.name ?? '?'}</span>
                        <span className="text-gray-400 dark:text-gray-500 text-xs">vs</span>
                        <span className="truncate">{match.away_team?.name ?? '?'}</span>
                        <TeamLogo name={match.away_team?.name ?? '?'} size="sm" />
                      </div>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        🔒 {count} Wettschein{count !== 1 ? 'e' : ''} · sichtbar ab Anpfiff
                      </p>
                    </div>
                  )
                }

                // Match has kicked off — show actual bet details
                const singles = activeSocial.filter(b => !b.combo_id && b.match_id === match.id)
                // Show a combo under EVERY match it has a (started) leg on — not just its
                // earliest-kickoff match — so a leg on an already-started match is never
                // hidden just because an earlier leg of the same combo hasn't shown yet.
                // Each occurrence expands its own leg for this match and collapses the rest.
                const comboIdsHere = [...new Set(
                  activeSocial
                    .filter(b => b.combo_id && b.match_id === match.id)
                    .map(b => b.combo_id as string)
                )]
                if (singles.length === 0 && comboIdsHere.length === 0) return null

                return (
                  <div key={match.id} className="px-4 py-3 space-y-2">
                    {/* Match header */}
                    <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-gray-100 flex-wrap">
                      <TeamLogo name={match.home_team?.name ?? '?'} size="sm" />
                      <span>{match.home_team?.name ?? '?'}</span>
                      <span className="text-gray-400 dark:text-gray-500 text-xs flex-shrink-0">vs</span>
                      <span>{match.away_team?.name ?? '?'}</span>
                      <TeamLogo name={match.away_team?.name ?? '?'} size="sm" />
                      {match.status === 'finished' && match.home_score != null && (
                        <span className="ml-auto text-xs font-black text-red-700 dark:text-red-400">{match.home_score}:{match.away_score}</span>
                      )}
                    </div>

                    {/* Single bets on this match */}
                    {singles.map(bet => {
                      const stake = bet.stake ?? 0
                      const potWin = Math.round(stake * bet.odds_value * 100) / 100
                      const borderCls = bet.status === 'won' ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20' : bet.status === 'lost' ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20' : 'border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/40'
                      return (
                        <div key={bet.id} className={`rounded-xl border overflow-hidden ${borderCls}`}>
                          <div className="flex items-center gap-2 px-3 pt-2">
                            <div className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                              <span className="text-red-700 dark:text-red-400 font-bold text-[10px]">{initialOf(bet.user_id)}</span>
                            </div>
                            <StatusDot status={bet.status} />
                            <span className="text-[10px] font-bold bg-gray-500 dark:bg-gray-600 text-white rounded px-1.5 py-0.5 flex-shrink-0">EINZEL</span>
                            <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate min-w-0 flex-1">{nameOf(bet.user_id)}</span>
                          </div>
                          <div className="flex items-center gap-2 px-3 pb-2 pt-0.5 text-[11px]">
                            <span className="text-gray-500 dark:text-gray-400">Einzelwette · <span className={`font-bold ${oddsColorClass(bet.status)}`}>@{bet.odds_value.toFixed(2).replace('.', ',')}</span></span>
                            <div className="ml-auto text-right flex-shrink-0">
                              {stake > 0 && bet.status === 'pending' && <span className="text-gray-500 dark:text-gray-400">{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)} → <span className="font-bold text-gray-700 dark:text-gray-200">{potWin.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(potWin)}</span></span>}
                              {stake > 0 && bet.status === 'won' && <span className="text-gray-500 dark:text-gray-400">{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)} → <span className="font-bold text-green-600">+{potWin.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(potWin)}</span></span>}
                              {bet.status === 'lost' && stake > 0 && <span className="text-red-500 line-through">{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)}</span>}
                            </div>
                          </div>
                          <div className="border-t border-black/5 dark:border-white/5 px-3 py-1.5">
                            <div className="flex items-start gap-1.5 text-xs py-0.5">
                              <StatusDot status={bet.status} />
                              <span className="font-medium text-gray-800 dark:text-gray-200">{socialSelLabel(bet.market_type, bet.selection, playerNameMap)}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}

                    {/* Combos with a leg on this match. The full card (below) renders only at
                        the combo's earliest-kickoff match; every other match gets a compact
                        one-line mention instead — see the comboFirstMatchId check inside the
                        map. Within the full card, only the leg belonging to THIS match is
                        shown inline, with the other legs collapsed behind a <details> toggle
                        (no client-side state needed since this stays a server component). */}
                    {comboIdsHere.map(comboId => {
                      const legs = activeSocial.filter(b => b.combo_id === comboId)
                      if (legs.length === 0) return null
                      const owner = legs[0].user_id
                      const cb = socialCombos[comboId]
                      const totalOdds = cb?.total_odds ?? legs.reduce((acc, l) => acc * l.odds_value, 1)
                      const stake = cb?.stake ?? 0
                      const potWin = Math.round(stake * totalOdds * 100) / 100
                      const dbSt = cb?.status ?? 'pending'
                      const comboStatus = (dbSt === 'won' || dbSt === 'lost') ? dbSt
                        : legs.some(l => l.status === 'lost') ? 'lost'
                        : legs.every(l => l.status === 'won') ? 'won'
                        : 'pending'
                      const borderCls = comboStatus === 'won' ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20' : comboStatus === 'lost' ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20' : 'border-blue-100 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/10'
                      // Left-edge accent for the compact rows: reflects the COMBO's overall
                      // current status, not just this one leg — a combo that already lost an
                      // earlier leg is dead regardless of what this later, not-yet-played leg
                      // does, and the edge colour needs to say so at a glance.
                      const edgeCls = comboStatus === 'won' ? 'border-l-green-500' : comboStatus === 'lost' ? 'border-l-red-400' : 'border-l-yellow-400'
                      const ownLeg = legs.find(l => l.match_id === match.id) ?? legs[0]
                      const otherLegs = legs.filter(l => l.id !== ownLeg.id)
                      // This leg hasn't been decided yet, but the combo is already lost via a
                      // different leg — still interesting to look at, but no longer relevant to
                      // the outcome. Marked distinctly (dash, dimmed) instead of the normal
                      // "still open" yellow dot, which would misleadingly suggest it still
                      // matters.
                      const ownLegMoot = ownLeg.status === 'pending' && comboStatus === 'lost'

                      // A leg can individually be "won" while the combo as a whole is "lost"
                      // (this pick was right, another leg in the same slip wasn't) — the only
                      // direction this can diverge, since any lost leg always lost the combo
                      // too. The caption below spells out the divergence in words, since the
                      // green leg dot right under the combo's red status dot alone would read
                      // as contradictory.
                      const legWonButComboLost = ownLeg.status === 'won' && comboStatus === 'lost'
                      const renderLeg = (leg: typeof ownLeg) => {
                        const lm = matchMap.get(leg.match_id)
                        const moot = leg.status === 'pending' && comboStatus === 'lost'
                        return (
                          <div key={leg.id} className={`flex items-start gap-1.5 text-xs py-0.5 ${moot ? 'opacity-50' : ''}`}>
                            <LegResultMark status={leg.status} moot={moot} />
                            <div className="flex-1 min-w-0">
                              <span className="text-gray-400 dark:text-gray-500 text-[10px] block truncate">{lm?.home_team?.short_name ?? lm?.home_team?.name ?? '?'} – {lm?.away_team?.short_name ?? lm?.away_team?.name ?? '?'}</span>
                              <div className="font-medium text-gray-800 dark:text-gray-200">{socialSelLabel(leg.market_type, leg.selection, playerNameMap)}</div>
                            </div>
                            <span className={`font-bold flex-shrink-0 ${oddsColorClass(leg.status)}`}>@{leg.odds_value.toFixed(2).replace('.', ',')}</span>
                          </div>
                        )
                      }

                      // Only the combo's earliest-kickoff match gets the full card (avatar,
                      // stake/payout, collapsible other legs). Every other match this combo
                      // touches gets a compact, but still expandable, single line instead —
                      // repeating the full card once per leg got noisy for combos spanning
                      // most of a matchday. Tapping it opens the same "all legs" detail as the
                      // full card's own toggle. The left edge colour is the combo's overall
                      // status (see edgeCls) so an already-dead combo reads as dead here too,
                      // not just on its primary card.
                      if (comboFirstMatchId.get(comboId) !== match.id) {
                        return (
                          <details key={comboId} className={`group rounded-lg bg-gray-50 dark:bg-gray-700/40 border-l-4 ${edgeCls} overflow-hidden`}>
                            <summary className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 cursor-pointer select-none list-none marker:hidden">
                              <span className="w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                                <span className="text-blue-700 dark:text-blue-400 font-bold text-[9px]">{initialOf(owner)}</span>
                              </span>
                              <span className="font-semibold text-gray-800 dark:text-gray-200 truncate flex-shrink-0 max-w-[9rem]">{nameOf(owner)}</span>
                              <span className="text-[9px] font-bold bg-blue-600 text-white rounded px-1 py-0.5 flex-shrink-0">KOMBI</span>
                              <LegResultMark status={ownLeg.status} moot={ownLegMoot} />
                              <span className={`truncate flex-1 min-w-0 ${ownLegMoot ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300'}`}>{socialSelLabel(ownLeg.market_type, ownLeg.selection, playerNameMap)}</span>
                              <span className={`font-bold flex-shrink-0 ${oddsColorClass(ownLeg.status)}`}>@{ownLeg.odds_value.toFixed(2).replace('.', ',')}</span>
                              <span className="text-gray-400 dark:text-gray-500 text-[10px] flex-shrink-0 transition-transform group-open:rotate-180">▾</span>
                            </summary>
                            <div className="px-2.5 pb-2 pt-1 border-t border-black/5 dark:border-white/5 space-y-1.5">
                              {ownLegMoot && (
                                <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                                  Dieser Tipp ist noch offen, aber die Kombi ist bereits an anderer Stelle verloren.
                                </p>
                              )}
                              <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
                                <span>{legs.length} Tipps · <span className={`font-bold ${oddsColorClass(comboStatus)}`}>@{totalOdds.toFixed(2).replace('.', ',')}</span></span>
                                {stake > 0 && comboStatus === 'pending' && <span>{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)} → <span className="font-bold text-gray-700 dark:text-gray-200">{potWin.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(potWin)}</span></span>}
                                {stake > 0 && comboStatus === 'won' && cb?.payout != null && <span>{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)} → <span className="font-bold text-green-600">+{cb.payout.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(cb.payout)}</span></span>}
                                {comboStatus === 'lost' && stake > 0 && <span className="text-red-500 line-through">{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)}</span>}
                              </div>
                              <div className="space-y-1">
                                {legs.map(renderLeg)}
                              </div>
                            </div>
                          </details>
                        )
                      }

                      return (
                        <div key={comboId} className={`rounded-xl border overflow-hidden ${borderCls}`}>
                          {/* Name row: avatar/badge/name get the full row width to themselves so
                              a long name never competes for space with the stake/payout text
                              (which, for a pending bet, is itself long — "X Wildis → Y Wildis" —
                              and used to squeeze the name down to a couple of letters). */}
                          <div className="flex items-center gap-2 px-3 pt-2">
                            <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                              <span className="text-blue-700 dark:text-blue-400 font-bold text-[10px]">{initialOf(owner)}</span>
                            </div>
                            <StatusDot status={comboStatus} />
                            <span className="text-[10px] font-bold bg-blue-600 text-white rounded px-1.5 py-0.5 flex-shrink-0">KOMBI</span>
                            <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate min-w-0 flex-1">{nameOf(owner)}</span>
                          </div>
                          {/* Info row: tips-count/odds and stake/payout each get their own
                              side, wrapping onto a second line (flex-wrap) instead of
                              truncating when the stake/payout text runs long. */}
                          <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 px-3 pb-2 pt-0.5 text-[11px]">
                            <span className="text-gray-500 dark:text-gray-400">{legs.length} Tipps · <span className={`font-bold ${oddsColorClass(comboStatus)}`}>@{totalOdds.toFixed(2).replace('.', ',')}</span></span>
                            <div className="ml-auto text-right">
                              {stake > 0 && comboStatus === 'pending' && <span className="text-gray-500 dark:text-gray-400">{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)} → <span className="font-bold text-gray-700 dark:text-gray-200">{potWin.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(potWin)}</span></span>}
                              {stake > 0 && comboStatus === 'won' && cb?.payout != null && <span className="text-gray-500 dark:text-gray-400">{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)} → <span className="font-bold text-green-600">+{cb.payout.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(cb.payout)}</span></span>}
                              {comboStatus === 'lost' && stake > 0 && <span className="text-red-500 line-through">{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)}</span>}
                            </div>
                          </div>
                          <div className="border-t border-black/5 dark:border-white/5 px-3 py-1.5">
                            {renderLeg(ownLeg)}
                            {legWonButComboLost && (
                              <p className="text-[10px] text-gray-400 dark:text-gray-500 italic pl-4 pt-0.5">
                                Dieser Tipp war richtig, die Kombi ist aber an anderer Stelle verloren.
                              </p>
                            )}
                            {otherLegs.length > 0 && (
                              <details className="mt-0.5">
                                <summary className="text-[10px] text-blue-700 dark:text-blue-400 font-semibold cursor-pointer py-1 select-none">
                                  +{otherLegs.length} weitere{otherLegs.length === 1 ? 'r' : ''} Tipp{otherLegs.length !== 1 ? 'e' : ''} in dieser Kombi
                                </summary>
                                <div className="space-y-1 pt-0.5">
                                  {otherLegs.map(renderLeg)}
                                </div>
                              </details>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Own placed bets */}
      {user && (userSingles.length > 0 || userCombos.length > 0) && (
        <MyBets
          singles={userSingles}
          combos={userCombos}
          matchMap={userMatchMap}
          isDeadlinePassed={isDeadlinePassed}
          playerNameMap={playerNameMap}
        />
      )}

      {/* External recommendation — unrelated to the Wildenroth Tippspiel itself,
          kept as a single small, low-key card so it doesn't compete with the
          actual betting UI above. */}
      <div className="bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 rounded-2xl px-4 py-3 text-center">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Jetzt Lust bekommen, auch die Bundesliga mit Freunden zu tippen — ganz ohne echtes Geld, aber mit dynamischen Quoten wie bei einem echten Wettanbieter?
        </p>
        <a
          href="https://www.freebet-pro.de"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-1.5 text-xs font-semibold text-red-700 dark:text-red-400 hover:underline"
        >
          Jetzt auf FreeBet-Pro.de registrieren →
        </a>
      </div>

      <BetSlip />
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
      status === 'won' ? 'bg-green-500' :
      status === 'lost' ? 'bg-red-400' : 'bg-yellow-400'
    }`} />
  )
}

// Deliberately NOT a colored dot like StatusDot — this marks the result of one
// leg inside a combo card, right below the combo-level StatusDot (which shows
// the whole slip's outcome). Two same-shaped dots in different colors read as
// contradictory when a leg won but the combo still lost; a check/cross reads
// unambiguously as "this pick" regardless of the combo's own color above it.
function LegResultMark({ status, moot }: { status: string; moot?: boolean }) {
  // Same 🟡/🟢/🔴 dot convention as StatusDot everywhere else — a leg that
  // individually won while its combo overall lost is disambiguated via the
  // "Dieser Tipp war richtig, die Kombi ist aber an anderer Stelle verloren."
  // caption next to it, not via a different mark shape.
  //
  // "moot" = still pending on its own, but the combo it belongs to is already lost via a
  // different leg — a plain "still open" yellow dot would misleadingly suggest it still
  // matters, so this gets its own neutral, dimmed mark instead.
  if (moot) return <span className="text-gray-400 dark:text-gray-500 font-bold text-[11px] leading-4 flex-shrink-0" aria-label="Nicht mehr relevant">–</span>
  if (status === 'won') return <span className="inline-block w-2 h-2 rounded-full bg-green-500 flex-shrink-0 mt-1" aria-label="Tipp richtig" />
  if (status === 'lost') return <span className="inline-block w-2 h-2 rounded-full bg-red-400 flex-shrink-0 mt-1" aria-label="Tipp falsch" />
  return <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0 mt-1" aria-label="Tipp offen" />
}
