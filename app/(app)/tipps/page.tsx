import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BettingMatchCard } from '@/components/BettingMatchCard'
import { BetSlip } from '@/components/BetSlip'
import { MyBets } from '@/components/MyBets'
import { MatchdayScroller } from '@/components/MatchdayScroller'
import { MatchdayRecap } from '@/components/MatchdayRecap'
import type { RecapData } from '@/components/MatchdayRecap'
import type { Match, PriorMatch } from '@/types'
import { calculateOdds, buildPriorContext } from '@/lib/odds'
import { isSeasonStarted } from '@/lib/season'
import { computeGoalscorerOffersForMatch, type WildenrothPlayer, type GoalscorerOffer } from '@/lib/goalscorer'
import Link from 'next/link'
import { crestPath } from '@/lib/teams'

export const revalidate = 60

const SELECTION_DISPLAY: Record<string, Record<string, string>> = {
  '1x2': { home: 'Heimsieg', draw: 'Unentschieden', away: 'Auswärtssieg' },
  double_chance: { '1x': '1X', x2: 'X2', '12': '12' },
  over_under: { 'over_2.5': 'Über 2,5', 'under_2.5': 'Unter 2,5' },
  over_under_3_5: { 'over_3.5': 'Über 3,5', 'under_3.5': 'Unter 3,5' },
  over_under_5_5: { 'over_5.5': 'Über 5,5', 'under_5.5': 'Unter 5,5' },
  over_under_7_5: { 'over_7.5': 'Über 7,5', 'under_7.5': 'Unter 7,5' },
  btts: { yes: 'Beide treffen', no: 'Nicht beide' },
  handicap: { home_minus_1_5: '–1,5', away_plus_1_5: '+1,5', home_minus_2_5: '–2,5', away_plus_2_5: '+2,5' },
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

/** Returns Monday 12:00 Europe/Berlin of the week containing firstMatchDate */
function bettingOpenTime(firstMatchDate: Date): Date {
  // Get date string in Berlin timezone (sv locale → YYYY-MM-DD)
  const berlinDate = firstMatchDate.toLocaleDateString('sv', { timeZone: 'Europe/Berlin' })
  const [y, m, d] = berlinDate.split('-').map(Number)
  // Weekday in Berlin (UTC date for YYYY-MM-DD has correct weekday)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=Sun..6=Sat
  const daysBack = dow === 0 ? 6 : dow - 1
  const mondayD = d - daysBack
  const mondayStr = `${y}-${String(m).padStart(2, '0')}-${String(mondayD).padStart(2, '0')}`
  // Determine Berlin UTC offset at Monday noon and convert to UTC
  const probe = new Date(`${mondayStr}T12:00:00Z`)
  const berlinHour = parseInt(
    new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(probe),
    10
  )
  // berlinHour is Berlin clock when UTC=12; to get Berlin=12: utcHour = 12 - (berlinHour - 12)
  const utcHour = 24 - berlinHour
  return new Date(`${mondayStr}T${String(utcHour).padStart(2, '0')}:00:00Z`)
}

export default async function TippsPage({
  searchParams,
}: {
  searchParams: Promise<{ matchday?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const { data: allMatchesRaw } = await supabase
    .from('matches')
    .select(
      `id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status,
       home_team:teams!matches_home_team_id_fkey(id, name, short_name),
       away_team:teams!matches_away_team_id_fkey(id, name, short_name)`
    )
    .gte('match_date', '2026-08-01')
    .order('match_date', { ascending: true })

  const allMatches: Match[] = (allMatchesRaw ?? []).map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  }))

  const { data: priorMatchesRaw } = await supabase
    .from('prior_season_matches')
    .select('id, season, league_name, league_level, league_number, home_team, away_team, home_score, away_score, match_date')

  const priorMatches: PriorMatch[] = (priorMatchesRaw ?? []) as PriorMatch[]

  const teamNames = new Map<number, string>()
  for (const m of allMatches) {
    if (m.home_team) teamNames.set(m.home_team_id, m.home_team.name)
    if (m.away_team) teamNames.set(m.away_team_id, m.away_team.name)
  }
  const priorCtx = buildPriorContext(priorMatches, teamNames)

  const SEASON_START_TIPPS = '2026-08-01'
  // Matchday 999 is the test matchday — always include it regardless of date
  const seasonMatches = allMatches.filter((m) => m.matchday === 999 || m.match_date >= SEASON_START_TIPPS)
  const isPreSeason = seasonMatches.filter((m) => m.matchday !== 999).length === 0

  // Pre-season: show 1-28 placeholder; in-season: derive from actual matches
  // Always include test matchday 999 when it exists
  const hasTestMatchday = seasonMatches.some(m => m.matchday === 999)
  const allMatchdays = isPreSeason
    ? [...(hasTestMatchday ? [999] : []), ...Array.from({ length: 28 }, (_, i) => i + 1)]
    : [...new Set(seasonMatches.map((m) => m.matchday))].sort((a, b) => a - b)

  const firstScheduled = seasonMatches
    .filter((m) => m.status === 'scheduled')
    .map((m) => m.matchday)
    .sort((a, b) => a - b)[0]

  // Before Monday 12:00 Berlin → default to last completed matchday (Sunday games just ended)
  // After Monday 12:00 Berlin → default to next upcoming matchday
  const thisWeekMondayNoon = bettingOpenTime(new Date())
  const isBeforeMondayNoon = new Date() < thisWeekMondayNoon
  const completedMatchdays = allMatchdays.filter((md) => {
    const mdM = seasonMatches.filter((m) => m.matchday === md)
    const nonPostponed = mdM.filter((m) => m.status !== 'postponed')
    return nonPostponed.length > 0 && nonPostponed.every((m) => m.status === 'finished')
  })
  const lastCompletedMd = completedMatchdays.length > 0 ? Math.max(...completedMatchdays) : null
  const defaultMatchday = isPreSeason
    ? (hasTestMatchday ? 999 : 1)
    : isBeforeMondayNoon && lastCompletedMd != null
      ? lastCompletedMd
      : (firstScheduled ?? Math.max(...allMatchdays))
  const requestedMd = params.matchday ? parseInt(params.matchday, 10) : null
  const currentMatchday =
    requestedMd && allMatchdays.includes(requestedMd) ? requestedMd : defaultMatchday

  const matchdayMatches = seasonMatches
    .filter((m) => m.matchday === currentMatchday)
    .sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime())

  const deadline = matchdayMatches[0] ? new Date(matchdayMatches[0].match_date) : null
  const isDeadlinePassed = deadline ? deadline <= new Date() : false

  // Betting window: opens Monday 12:00 of match week
  const bettingOpens = deadline ? bettingOpenTime(deadline) : null
  const isBettingOpen = !bettingOpens || new Date() >= bettingOpens

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
  if (isBettingOpen) {
    const scheduledMatchIds = matchdayMatches.filter(m => m.status === 'scheduled').map(m => m.id)

    // Load any already-frozen rows from DB
    const { data: frozenRows } = scheduledMatchIds.length > 0
      ? await supabase.from('odds').select('*').in('match_id', scheduledMatchIds).not('frozen_at', 'is', null)
      : { data: [] }

    // "Complete" = frozen row that also has the new-market columns populated.
    // Rows frozen before the market-expansion migration have NULL new fields
    // (Number(null)→0); treat those as incomplete so they get recomputed+updated.
    const completeFrozenRows = (frozenRows ?? []).filter(r => r.over_5_5 !== null)
    const frozenSet = new Set(completeFrozenRows.map(r => r.match_id))

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
      }
    }

    // Compute + persist odds for any scheduled match not yet frozen
    const toFreeze = matchdayMatches.filter(m => m.status === 'scheduled' && !frozenSet.has(m.id))
    if (toFreeze.length > 0) {
      const now = new Date().toISOString()
      for (const m of toFreeze) {
        const odds = calculateOdds(oddsMatches, m.home_team_id, m.away_team_id, priorCtx)
        oddsMap[m.id] = odds
        // Upsert: safe to call concurrently — snapshot cutoff is deterministic,
        // so any two simultaneous requests produce identical values.
        await supabase.from('odds').upsert({
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
        }, { onConflict: 'match_id' })
      }
    }
  }

  // Goalscorer odds for Wildenroth matches: compute + freeze on first request after Mon 12:00.
  // Map structure: matchId → array of GoalscorerOffer (only is_offered/is_offered_2plus players).
  const goalscorerOffersByMatch: Record<number, (GoalscorerOffer & { status: string })[]> = {}
  // Player name map used by display components for goalscorer selections.
  const playerNameMap: Record<number, string> = {}
  {
    // Identify Wildenroth team via name match against season teams
    const wildenrothTeamRow = allMatches.flatMap(m => [m.home_team, m.away_team])
      .find(t => t?.name?.includes('Wildenroth'))
    const wildenrothId = wildenrothTeamRow?.id ?? null

    if (wildenrothId != null) {
      const wildenrothMatches = matchdayMatches.filter(
        m => m.status === 'scheduled' && (m.home_team_id === wildenrothId || m.away_team_id === wildenrothId)
      )

      // Always fetch active players (needed for name map at display time).
      const { data: playersRaw } = await supabase
        .from('wildenroth_players')
        .select('id, name, position, games, minutes, goals, assists, is_goalkeeper, is_penalty_taker, is_freekick_taker, active')
        .eq('active', true)
      const players = (playersRaw ?? []) as WildenrothPlayer[]
      for (const p of players) playerNameMap[p.id] = p.name

      if (wildenrothMatches.length > 0 && isBettingOpen) {
        const wmIds = wildenrothMatches.map(m => m.id)

        const { data: existingRows } = await supabase
          .from('match_goalscorer_odds')
          .select('match_id, player_id, status, is_offered, is_offered_2plus, prob_score, prob_score_2plus, odds_score, odds_score_2plus, frozen_at')
          .in('match_id', wmIds)

        const frozenSet = new Set((existingRows ?? []).filter(r => r.frozen_at).map(r => r.match_id))

        for (const m of wildenrothMatches) {
          if (!frozenSet.has(m.id)) {
            // Freeze for this match now
            const offers = computeGoalscorerOffersForMatch(
              seasonMatches, m.home_team_id, m.away_team_id, wildenrothId, players,
            )
            const now = new Date().toISOString()
            for (const o of offers) {
              await supabase.from('match_goalscorer_odds').upsert({
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
  if (isBettingOpen && matchdayMatches.some(m => m.status === 'scheduled')) {
    const scheduledIds = matchdayMatches.filter(m => m.status === 'scheduled').map(m => m.id)
    if (scheduledIds.length > 0) {
      // Use admin client to bypass RLS — overrides must be visible to all users, not just admins.
      const { data: overrideRows } = await createAdminClient()
        .from('match_odds_overrides')
        .select('*')
        .in('match_id', scheduledIds)
      for (const ov of overrideRows ?? []) {
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
        oddsMap[ov.match_id] = merged
      }
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

  const { data: { user } } = await supabase.auth.getUser()

  // Fetch user profile (Wildenroth flag + season eligibility)
  const { data: userProfile } = user ? await supabase
    .from('profiles')
    .select('is_wildenroth, eligible_for_current_season, is_admin')
    .eq('id', user.id)
    .single() : { data: null }
  const isWildenrothPlayer = userProfile?.is_wildenroth ?? false

  // Saisonstart-Regel: nicht teilnahmeberechtigte Nutzer bekommen eine Hinweis-Seite
  const seasonStarted = await isSeasonStarted(supabase)
  const isNotEligible = seasonStarted && !!user
    && !userProfile?.eligible_for_current_season && !userProfile?.is_admin

  // Find Wildenroth team ID
  const wildenrothTeam = allMatches.flatMap(m => [m.home_team, m.away_team])
    .find(t => t?.name?.includes('Wildenroth'))
  const wildenrothTeamId = wildenrothTeam?.id ?? null

  const matchdayMatchIds = matchdayMatches.map((m) => m.id)

  // Own bets: fetch full data for MyBets component + derive counts for header
  type OwnBet = {
    id: number; match_id: number; market_type: string; selection: string
    odds_value: number; stake: number | null; status: string; combo_id: number | null; is_risky: boolean
  }
  type OwnCombo = { id: number; stake: number; status: string; legs: OwnBet[] }

  let normalBetCount = 0
  let riskyBetCount = 0
  let userSingles: OwnBet[] = []
  let userCombos: OwnCombo[] = []

  if (user && matchdayMatchIds.length > 0) {
    const { data: ownBets } = await supabase
      .from('bets')
      .select('id, match_id, market_type, selection, odds_value, stake, status, combo_id, is_risky')
      .eq('user_id', user.id)
      .in('match_id', matchdayMatchIds)

    if (ownBets && ownBets.length > 0) {
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

      // Compute counts dynamically: risky = the single bet/combo with the highest
      // effective odds (if > 20); all others are normal.
      const singleOdds = userSingles.map(b => b.odds_value)
      const comboOdds = userCombos.map(c => c.legs.reduce((acc, l) => acc * l.odds_value, 1))
      const allOdds = [...singleOdds, ...comboOdds]
      const maxOdds = allOdds.length > 0 ? Math.max(...allOdds) : 0
      riskyBetCount = maxOdds > 20 ? 1 : 0
      normalBetCount = allOdds.length - riskyBetCount
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
    const seenCountCombos = new Set<string>()
    for (const b of countRows ?? []) {
      if (!b.combo_id) {
        betCountByMatch[b.match_id] = (betCountByMatch[b.match_id] ?? 0) + 1
      } else if (!seenCountCombos.has(String(b.combo_id))) {
        seenCountCombos.add(String(b.combo_id))
        betCountByMatch[b.match_id] = (betCountByMatch[b.match_id] ?? 0) + 1
      }
    }
  }

  if (isDeadlinePassed && matchdayMatchIds.length > 0) {
    const { data: rawSocial } = await supabase
      .from('bets')
      .select('id, market_type, selection, odds_value, status, combo_id, user_id, match_id, stake')
      .in('match_id', matchdayMatchIds)
      .neq('user_id', user?.id ?? '')

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

  // Spieltags-Recap: complete when all non-postponed matches are finished (≥1 must be finished)
  const nonPostponedMatches = matchdayMatches.filter(m => m.status !== 'postponed')
  const isMatchdayComplete = nonPostponedMatches.length > 0 &&
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

      // MVP: user with highest net gain (payout - stake) across singles + combos this matchday
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
      const mvp = mvpEntry ? { name: pMap[mvpEntry[0]] ?? 'Unbekannt', profit: mvpEntry[1] } : null

      // Best winning odds: highest single odds or combo total_odds (won)
      const wonSingles = singleBets.filter(b => b.status === 'won').sort((a, b) => b.odds_value - a.odds_value)
      const wonCombos = recapCombos.filter(c => c.status === 'won').sort((a, b) => b.total_odds - a.total_odds)
      const topSingle = wonSingles[0] ?? null
      const topCombo = wonCombos[0] ?? null
      let bestOdds: RecapData['bestOdds'] = null

      // Unlucky Bastard: lost combo with exactly 1 lost leg (all legs settled)
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
        .sort((a, b) => b.c.total_odds - a.c.total_odds)
      const unlucky = unluckyResults[0] ?? null

      // Fetch leg details for the unlucky bastard combo
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
        handicap: { home_minus_1_5: 'Heim –1,5', away_plus_1_5: 'Gast +1,5', home_minus_2_5: 'Heim –2,5', away_plus_2_5: 'Gast +2,5' },
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

      // Biggest Loss: single bet or combo with highest absolute loss
      const lostSingles = singleBets.filter(b => b.status === 'lost').sort((a, b) => b.stake - a.stake)
      const lostCombos = recapCombos.filter(c => c.status === 'lost').sort((a, b) => b.stake - a.stake)
      let biggestLoss: RecapData['biggestLoss'] = null
      if (lostSingles[0] || lostCombos[0]) {
        const sSt = lostSingles[0]?.stake ?? 0
        const cSt = lostCombos[0]?.stake ?? 0
        if (sSt >= cSt && lostSingles[0]) {
          biggestLoss = { name: pMap[lostSingles[0].user_id] ?? 'Unbekannt', loss: sSt, isCombo: false }
        } else if (lostCombos[0]) {
          biggestLoss = { name: pMap[lostCombos[0].user_id] ?? 'Unbekannt', loss: cSt, isCombo: true }
        }
      }

      // Safest Tip: won single/combo with lowest odds >= 1.20
      const safeSingles = wonSingles.filter(b => b.odds_value >= 1.20).sort((a, b) => a.odds_value - b.odds_value)
      const safeCombos = wonCombos.filter(c => c.total_odds >= 1.20).sort((a, b) => a.total_odds - b.total_odds)
      let safestTip: RecapData['safestTip'] = null
      if (safeSingles[0] || safeCombos[0]) {
        const sOdds = safeSingles[0]?.odds_value ?? Infinity
        const cOdds = safeCombos[0]?.total_odds ?? Infinity
        if (sOdds <= cOdds && safeSingles[0]) {
          safestTip = { name: pMap[safeSingles[0].user_id] ?? 'Unbekannt', odds: safeSingles[0].odds_value, stake: safeSingles[0].stake, payout: safeSingles[0].payout ?? 0 }
        } else if (safeCombos[0]) {
          safestTip = { name: pMap[safeCombos[0].user_id] ?? 'Unbekannt', odds: safeCombos[0].total_odds, stake: safeCombos[0].stake, payout: safeCombos[0].payout }
        }
      }

      // Beste Kombi: won combo with highest total_odds
      const bestComboEntry = wonCombos[0] ?? null
      const bestCombo: RecapData['bestCombo'] = bestComboEntry ? {
        name: pMap[bestComboEntry.user_id] ?? 'Unbekannt',
        odds: bestComboEntry.total_odds,
        stake: bestComboEntry.stake,
        payout: bestComboEntry.payout,
        legs: (legsByCombo[bestComboEntry.id] ?? []).length,
      } : null

      // Risky-Hit: won bet (single or combo) that has is_risky=true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wonRiskySingles = singleBets.filter(b => b.status === 'won' && (b as any).is_risky)
        .sort((a, b) => b.odds_value - a.odds_value)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wonRiskyCombos = recapCombos.filter(c => {
        const comboLegsForC = recapBets.filter(b => b.combo_id === c.id)
        return c.status === 'won' && comboLegsForC.some(l => (l as any).is_risky)
      }).sort((a, b) => b.total_odds - a.total_odds)
      let riskyHit: RecapData['riskyHit'] = null
      if (wonRiskySingles[0] || wonRiskyCombos[0]) {
        const rSingle = wonRiskySingles[0]
        const rCombo = wonRiskyCombos[0]
        const rSOdds = rSingle?.odds_value ?? 0
        const rCOdds = rCombo?.total_odds ?? 0
        if (rSOdds >= rCOdds && rSingle) {
          riskyHit = { name: pMap[rSingle.user_id] ?? 'Unbekannt', odds: rSingle.odds_value, stake: rSingle.stake, payout: rSingle.payout ?? 0, isCombo: false }
        } else if (rCombo) {
          riskyHit = { name: pMap[rCombo.user_id] ?? 'Unbekannt', odds: rCombo.total_odds, stake: rCombo.stake, payout: rCombo.payout, isCombo: true }
        }
      }

      // Best winning odds — add stake
      if (topSingle || topCombo) {
        const sOdds2 = topSingle?.odds_value ?? 0
        const cOdds2 = topCombo?.total_odds ?? 0
        if (sOdds2 >= cOdds2 && topSingle) {
          bestOdds = { name: pMap[topSingle.user_id] ?? 'Unbekannt', odds: topSingle.odds_value, stake: topSingle.stake, payout: topSingle.payout ?? 0, isCombo: false }
        } else if (topCombo) {
          bestOdds = { name: pMap[topCombo.user_id] ?? 'Unbekannt', odds: topCombo.total_odds, stake: topCombo.stake, payout: topCombo.payout, isCombo: true, legs: (legsByCombo[topCombo.id] ?? []).length }
        }
      }

      // Wildenroth-Optimist: highest stake single bet on a Wildenroth win
      let wildenrothOptimist: RecapData['wildenrothOptimist'] = null
      if (wildenrothTeamId != null) {
        const wOpt = singleBets
          .filter(b => {
            const m = matchMap.get((b as { match_id?: number }).match_id ?? -1)
            if (!m) return false
            const wIsHome = m.home_team_id === wildenrothTeamId
            const wIsAway = m.away_team_id === wildenrothTeamId
            if (!wIsHome && !wIsAway) return false
            return b.market_type === '1x2' && ((wIsHome && b.selection === 'home') || (wIsAway && b.selection === 'away'))
          })
          .sort((a, b) => (b.stake ?? 0) - (a.stake ?? 0))[0]
        if (wOpt) wildenrothOptimist = { name: pMap[wOpt.user_id] ?? 'Unbekannt', stake: wOpt.stake ?? 0, odds: wOpt.odds_value }
      }

      // Craziest Bet: non-cancelled bet/combo with highest odds (win or loss); tie → higher stake
      const craziestSingle = [...singleBets].sort((a, b) => (b.odds_value - a.odds_value) || ((b.stake ?? 0) - (a.stake ?? 0)))[0] ?? null
      const craziestCombo = [...recapCombos].sort((a, b) => (b.total_odds - a.total_odds) || (b.stake - a.stake))[0] ?? null
      let craziestBet: RecapData['craziestBet'] = null
      if (craziestSingle || craziestCombo) {
        const sO = craziestSingle?.odds_value ?? 0
        const cO = craziestCombo?.total_odds ?? 0
        if (sO >= cO && craziestSingle) {
          craziestBet = { name: pMap[craziestSingle.user_id] ?? 'Unbekannt', odds: craziestSingle.odds_value, stake: craziestSingle.stake ?? 0, isCombo: false, won: craziestSingle.status === 'won' }
        } else if (craziestCombo) {
          craziestBet = { name: pMap[craziestCombo.user_id] ?? 'Unbekannt', odds: craziestCombo.total_odds, stake: craziestCombo.stake, isCombo: true, won: craziestCombo.status === 'won' }
        }
      }

      // Safest Banker: won bet/combo with the LOWEST odds
      const lowSingle = wonSingles.length > 0 ? [...wonSingles].sort((a, b) => a.odds_value - b.odds_value)[0] : null
      const lowCombo = wonCombos.length > 0 ? [...wonCombos].sort((a, b) => a.total_odds - b.total_odds)[0] : null
      let safestBanker: RecapData['safestBanker'] = null
      if (lowSingle || lowCombo) {
        const sO = lowSingle?.odds_value ?? Infinity
        const cO = lowCombo?.total_odds ?? Infinity
        if (sO <= cO && lowSingle) {
          safestBanker = { name: pMap[lowSingle.user_id] ?? 'Unbekannt', odds: lowSingle.odds_value, stake: lowSingle.stake ?? 0, payout: lowSingle.payout ?? 0, isCombo: false }
        } else if (lowCombo) {
          safestBanker = { name: pMap[lowCombo.user_id] ?? 'Unbekannt', odds: lowCombo.total_odds, stake: lowCombo.stake, payout: lowCombo.payout, isCombo: true }
        }
      }

      if (mvp || bestOdds || unluckyBastard || biggestLoss || safestTip || bestCombo || riskyHit || wildenrothOptimist || craziestBet || safestBanker) {
        recapData = { mvp, bestOdds, unluckyBastard, biggestLoss, safestTip, bestCombo, riskyHit, wildenrothOptimist, craziestBet, safestBanker }
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
            Du hast dich nach Saisonstart registriert. Jani schaltet dich in Kürze für die aktuelle Saison frei.
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
      {/* ↓↓↓ SOMMERPAUSE-BANNER — zum Entfernen diese 5 Zeilen löschen ↓↓↓ */}
      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-amber-800">
        <span className="text-base">☀️</span>
        <span><strong>Sommerpause</strong> — Kreisliga loading, wir kommen wieder!</span>
      </div>
      {/* ↑↑↑ SOMMERPAUSE-BANNER Ende ↑↑↑ */}

      {/* Matchday Header */}
      <div className="bg-red-700 text-white rounded-2xl px-5 py-4 shadow-sm">
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
      <MatchdayScroller activeIndex={allMatchdays.indexOf(currentMatchday)}>
        {allMatchdays.map((md) => {
          const mdMatches = seasonMatches.filter((m) => m.matchday === md)
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
      {isPreSeason && matchdayMatches.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <div className="text-4xl mb-3">📅</div>
          <div className="font-medium text-gray-600 dark:text-gray-300">Spielplan wird noch veröffentlicht</div>
          <div className="text-sm mt-1">Die Saison 26/27 startet im August 2026</div>
        </div>
      ) : matchdayMatches.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <div className="text-4xl mb-3">⚽</div>
          <div className="font-medium">Keine Spiele</div>
        </div>
      ) : (
        <div className="space-y-3">
          {matchdayMatches.map((match) => (
            <BettingMatchCard
              key={match.id}
              match={match}
              odds={match.status === 'scheduled' && isBettingOpen ? (oddsMap[match.id] ?? null) : null}
              allMatches={seasonMatches}
              historyMatches={allMatches}
              positions={positions}
              isWildenrothPlayer={isWildenrothPlayer}
              wildenrothTeamId={wildenrothTeamId}
              goalscorers={goalscorerOffersByMatch[match.id] ?? null}
            />
          ))}
        </div>
      )}

      {/* Social Bets — grouped by match; per-match visibility after each game's kickoff */}
      {user && Object.values(betCountByMatch).some(c => c > 0) && (() => {
        const now = new Date()
        const activeSocial = socialBets.filter(b => b.status !== 'cancelled')
        const profileMap = new Map(socialProfiles.map(p => [p.id, p]))
        const nameOf = (uid: string) => {
          const p = profileMap.get(uid)
          return p ? (p.display_name || p.username) : 'Unbekannt'
        }
        const initialOf = (uid: string) => (nameOf(uid)[0] ?? '?').toUpperCase()
        const totalTippers = new Set(activeSocial.map(b => b.user_id)).size

        // For combo dedup: assign each combo to the match with the earliest kickoff among its legs
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
              <h2 className="font-bold text-gray-900 dark:text-gray-100">Tipps der anderen</h2>
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
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={crestPath(match.home_team?.name ?? '')} alt="" className="w-5 h-5 object-contain flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        <span className="truncate">{match.home_team?.name ?? '?'}</span>
                        <span className="text-gray-400 dark:text-gray-500 text-xs">vs</span>
                        <span className="truncate">{match.away_team?.name ?? '?'}</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={crestPath(match.away_team?.name ?? '')} alt="" className="w-5 h-5 object-contain flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      </div>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        🔒 {count} Wettschein{count !== 1 ? 'e' : ''} · sichtbar ab Anpfiff
                      </p>
                    </div>
                  )
                }

                // Match has kicked off — show actual bet details
                const singles = activeSocial.filter(b => !b.combo_id && b.match_id === match.id)
                // Only show combos that are "assigned" to this match (first-leg match)
                const comboIdsHere = [...new Set(
                  activeSocial
                    .filter(b => b.combo_id && comboFirstMatchId.get(String(b.combo_id)) === match.id)
                    .map(b => b.combo_id as string)
                )]
                if (singles.length === 0 && comboIdsHere.length === 0) return null

                return (
                  <div key={match.id} className="px-4 py-3 space-y-2">
                    {/* Match header */}
                    <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-gray-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={crestPath(match.home_team?.name ?? '')} alt="" className="w-5 h-5 object-contain flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      <span className="truncate">{match.home_team?.name ?? '?'}</span>
                      <span className="text-gray-400 dark:text-gray-500 text-xs">vs</span>
                      <span className="truncate">{match.away_team?.name ?? '?'}</span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={crestPath(match.away_team?.name ?? '')} alt="" className="w-5 h-5 object-contain flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
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
                        <div key={bet.id} className={`rounded-xl border px-3 py-2 ${borderCls}`}>
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                              <span className="text-red-700 dark:text-red-400 font-bold text-[10px]">{initialOf(bet.user_id)}</span>
                            </div>
                            <StatusDot status={bet.status} />
                            <div className="flex-1 min-w-0">
                              <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{nameOf(bet.user_id)}</div>
                              <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">{socialSelLabel(bet.market_type, bet.selection, playerNameMap)}</div>
                            </div>
                            <div className="text-right text-xs flex-shrink-0">
                              <div className="font-bold text-red-700 dark:text-red-400">@{bet.odds_value.toFixed(2).replace('.', ',')}</div>
                              {stake > 0 && bet.status === 'pending' && <div className="text-gray-400 dark:text-gray-500">{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} WR → <span className="font-bold text-gray-700 dark:text-gray-200">{potWin.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} WR</span></div>}
                              {bet.status === 'won' && <div className="font-bold text-green-600">+{potWin.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} WR</div>}
                              {bet.status === 'lost' && stake > 0 && <div className="text-red-500 line-through">{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} WR</div>}
                            </div>
                          </div>
                        </div>
                      )
                    })}

                    {/* Combos assigned to this match (shown only once, not under every leg's match) */}
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
                      return (
                        <div key={comboId} className={`rounded-xl border overflow-hidden ${borderCls}`}>
                          <div className="flex items-center gap-2 px-3 py-2 border-b border-black/5 dark:border-white/5">
                            <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                              <span className="text-blue-700 dark:text-blue-400 font-bold text-[10px]">{initialOf(owner)}</span>
                            </div>
                            <StatusDot status={comboStatus} />
                            <span className="text-[10px] font-bold bg-blue-600 text-white rounded px-1.5 py-0.5">KOMBI</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400 ml-0.5 truncate">{nameOf(owner)} · {legs.length} Tipps · <span className="font-bold text-gray-700 dark:text-gray-200">@{totalOdds.toFixed(2).replace('.', ',')}</span></span>
                            <div className="ml-auto text-right text-xs flex-shrink-0">
                              {stake > 0 && comboStatus === 'pending' && <span className="text-gray-500 dark:text-gray-400">{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} WR → <span className="font-bold text-gray-700 dark:text-gray-200">{potWin.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} WR</span></span>}
                              {comboStatus === 'won' && cb?.payout != null && <span className="font-bold text-green-600">+{cb.payout.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} WR</span>}
                              {comboStatus === 'lost' && stake > 0 && <span className="text-red-500 line-through">{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} WR</span>}
                            </div>
                          </div>
                          <div className="px-3 py-1.5 space-y-1">
                            {legs.map(leg => {
                              const lm = matchMap.get(leg.match_id)
                              return (
                                <div key={leg.id} className="flex items-start gap-1.5 text-xs py-0.5">
                                  <StatusDot status={leg.status} />
                                  <div className="flex-1 min-w-0">
                                    <span className="text-gray-400 dark:text-gray-500 text-[10px]">{lm?.home_team?.name ?? '?'} – {lm?.away_team?.name ?? '?'}</span>
                                    <div className="font-medium text-gray-800 dark:text-gray-200">{socialSelLabel(leg.market_type, leg.selection, playerNameMap)}</div>
                                  </div>
                                  <span className="text-red-600 dark:text-red-400 font-bold flex-shrink-0">@{leg.odds_value.toFixed(2).replace('.', ',')}</span>
                                </div>
                              )
                            })}
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
