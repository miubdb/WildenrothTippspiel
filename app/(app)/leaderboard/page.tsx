import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { LeaderboardClient } from './LeaderboardClient'
import type { BetRow, ComboMeta, MatchdayStats } from './LeaderboardClient'
import type { CommentData } from '@/components/CommentSection'
import type { RecapData } from '@/components/MatchdayRecap'
import { bettingOpenTime, buildEffectiveMatchdayIndex, effectiveMatchdayOf as effectiveMatchdayOfShared, recapMatchdayOf as recapMatchdayOfShared } from '@/lib/season'
import type { Match } from '@/types'

export const revalidate = 60

type ComboMap = Record<string, ComboMeta>

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ spieltag?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const [
    { data: profiles },
    { data: { user } },
    { data: allMatchesRaw },
    { data: allBetsRaw },
    { data: allCombosRaw },
  ] = await Promise.all([
    supabase.from('profiles').select('id, username, display_name, balance, season_start_balance, eligible_for_current_season, is_admin, avatar_url').or('eligible_for_current_season.eq.true,is_admin.eq.true').is('deleted_at', null).order('balance', { ascending: false }),
    supabase.auth.getUser(),
    supabase.from('matches').select('id, match_number, matchday, home_team_id, away_team_id, match_date, status, match_category, is_topspiel, tippspiel_matchday').order('match_date', { ascending: true }),
    supabase.from('bets').select('id, user_id, match_id, market_type, selection, stake, odds_value, status, payout, combo_id, is_risky, season'),
    supabase.from('combo_bets').select('id, user_id, stake, total_odds, status, payout, season'),
  ])

  // Current user profile (for name + admin flag)
  const currentProfile = user ? (profiles ?? []).find(p => p.id === user.id) : null
  const currentUserName = currentProfile
    ? (currentProfile.display_name || currentProfile.username || 'Du')
    : 'Du'
  const { data: adminCheck } = user
    ? await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
    : { data: null }
  const isAdmin = adminCheck?.is_admin ?? false

  const CURRENT_SEASON = '26/27'
  const SEASON_START = '2026-08-01'

  const allMatchesRaw2 = (allMatchesRaw ?? []) as Match[]
  // Only current-season matches drive the leaderboard matchday list
  // Matchday 999 is the test matchday — include regardless of date
  const seasonMatches = allMatchesRaw2.filter(m => m.matchday === 999 || m.match_date >= SEASON_START)

  // The league sometimes plays a matchday's makeup date well after later-numbered
  // matchdays (e.g. Spieltag 2 as a midweek catch-up after Spieltag 7). The official
  // matchday NUMBER stays as the label, but ordering/"current"/"completed" must
  // follow actual kickoff dates — mirrors the same fix applied in tipps/page.tsx.
  // Wildenroth-II / B-Klasse-Topspiel matches also carry their own independent BFV
  // matchday numbering, so every grouping of BETS below uses the shared
  // effective-Spieltag mapping (lib/season.ts) instead of the raw `matchday`
  // column — otherwise a bet placed on such a match (shown under a specific
  // Tippspiel-Spieltag tab on /tipps) lands under the wrong Spieltag here.
  const mdIndex = buildEffectiveMatchdayIndex(seasonMatches)
  const { matchdayMinDate, kreisligaMatchdaysDisplayOrder } = mdIndex
  const effectiveMatchdayOf = (m: Match) => effectiveMatchdayOfShared(m, mdIndex)
  // Recap grouping (awards/streaks/Wochentippkönig/"is this Spieltag's story
  // done" timing) differs from the display grouping above for a Kreisliga
  // match rescheduled far outside its own Spieltag's window — see
  // lib/season.ts recapMatchdayOf. Must match app/api/admin/settle/route.ts's
  // grouping exactly, or the persisted Spieltagskönig trophy and this page's
  // live Wochentippkönig banner could disagree about the same Spieltag.
  const recapMatchdayOf = (m: Match) => recapMatchdayOfShared(m, mdIndex)
  const byKickoff = (a: number, b: number) => (matchdayMinDate.get(a) ?? 0) - (matchdayMinDate.get(b) ?? 0)
  const isKreisligaMatch = (m: Match) => !m.match_category || m.match_category === 'kreisliga'
  const kreisligaMatches = seasonMatches.filter(m => m.matchday !== 999 && isKreisligaMatch(m))
  const hasTestMatchday = seasonMatches.some(m => m.matchday === 999)

  // Fall back to 1-28 placeholder when no real season matches exist yet (ignore test matchday).
  // Chronological order by actual kickoff (outlier-robust median anchor, see
  // lib/season.ts) — mirrors the same picker order used on tipps/page.tsx.
  // Every date-dependent decision below goes through the explicit `byKickoff`
  // comparator instead of this array's own order, so reordering it here is safe.
  const allMatchdays = kreisligaMatchdaysDisplayOrder.length > 0
    ? [...(hasTestMatchday ? [999] : []), ...kreisligaMatchdaysDisplayOrder]
    : [...(hasTestMatchday ? [999] : []), ...Array.from({ length: 28 }, (_, i) => i + 1)]
  const allMatches = allMatchesRaw2
  const allBets = (allBetsRaw ?? []).filter(b => !b.season || b.season === CURRENT_SEASON)
  const allCombos = (allCombosRaw ?? []).filter(c => !c.season || c.season === CURRENT_SEASON)

  // Current matchday for Spieltag tab — driven by the Kreisliga schedule only,
  // matching tipps/page.tsx's `firstScheduled`/`completedMatchdays`.
  const firstScheduledMd = [...new Set(kreisligaMatches.filter(m => m.status === 'scheduled').map(m => m.matchday))]
    .sort(byKickoff)[0]

  // Before Monday 12:00 Berlin → show last completed matchday; after → show upcoming matchday
  const thisWeekMondayNoon = bettingOpenTime(new Date())
  const isBeforeMondayNoon = new Date() < thisWeekMondayNoon
  const completedMatchdays = allMatchdays.filter((md) => {
    // Effective grouping — same reasoning as tipps/page.tsx: a Spieltag is done
    // when the matches actually shown under it are done, not when an outlier
    // match that lives under a different Spieltag has been played.
    const mdM = seasonMatches.filter((m) => effectiveMatchdayOf(m) === md)
    const nonPostponed = mdM.filter((m) => m.status !== 'postponed')
    return nonPostponed.length > 0 && nonPostponed.every((m) => m.status === 'finished')
  })
  const lastCompletedMd = completedMatchdays.length > 0
    ? completedMatchdays.reduce((latest, md) => byKickoff(md, latest) > 0 ? md : latest)
    : null
  // Pre-season: no season matches → default to Spieltag 1
  const defaultMatchday = seasonMatches.length === 0
    ? 1
    : isBeforeMondayNoon && lastCompletedMd != null
      ? lastCompletedMd
      : (firstScheduledMd ?? (allMatchdays.length > 0 ? allMatchdays.reduce((latest, md) => byKickoff(md, latest) > 0 ? md : latest) : null))

  const requestedMd = params.spieltag ? parseInt(params.spieltag, 10) : null
  const currentMatchday = requestedMd && allMatchdays.includes(requestedMd) ? requestedMd : defaultMatchday

  const matchdayMatches = currentMatchday != null
    ? seasonMatches.filter(m => effectiveMatchdayOf(m) === currentMatchday).sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime())
    : []

  const firstMatch = matchdayMatches[0]
  const isDeadlinePassed = firstMatch ? new Date(firstMatch.match_date) <= new Date() : false
  const matchdayMatchIds = new Set(matchdayMatches.map(m => m.id))
  // "Is this Spieltag's story done" uses the RECAP grouping (a match rescheduled
  // far out doesn't hold this Spieltag's recap hostage — see recapMatchdayOf
  // above), not the display list of matches shown under the tab.
  const recapGroupMatches = currentMatchday != null
    ? seasonMatches.filter(m => recapMatchdayOf(m) === currentMatchday)
    : []
  const recapGroupMatchIds = new Set(recapGroupMatches.map(m => m.id))
  const nonPostponedRecapMatches = recapGroupMatches.filter(m => m.status !== 'postponed')
  const matchdayHasPendingBets = allBets.some(b => b.status === 'pending' && b.match_id != null && recapGroupMatchIds.has(b.match_id))
  const isMatchdayComplete = nonPostponedRecapMatches.length > 0 && nonPostponedRecapMatches.every(m => m.status === 'finished') && !matchdayHasPendingBets
  // Default to Spieltag tab once the matchday kicks off, back to Rangliste once fully settled
  const hasMatchdayStarted = matchdayMatches.some(m => m.status === 'live' || m.status === 'finished')
  const defaultTabIsSpielTag = hasMatchdayStarted && !isMatchdayComplete

  // Always compute ALL pending stakes across all matches so balance+pending = true ranking value.
  // This prevents reducing balances from leaking bet sizes before reveal.
  //
  // betCountsPerUser, by contrast, drives the "N Wettscheine platziert" placeholder
  // shown under the currently selected Spieltag — it must count only bets that
  // touch THIS Spieltag's matches, not a user's pending bets for the whole
  // season, or a user with bets open on two Spieltage at once (e.g. one held
  // open by a postponed match) gets a combined, misleading count shown here.
  const pendingStakesPerUser: Record<string, number> = {}
  const betCountsPerUser: Record<string, number> = {}
  {
    const adminSupa = createAdminClient()
    const { data: pendingBetRows } = await adminSupa
      .from('bets')
      .select('id, user_id, stake, combo_id, match_id')
      .eq('status', 'pending')
    const seenComboIds = new Set<number>()
    const comboTouchesMatchday = new Set<number>()
    for (const b of pendingBetRows ?? []) {
      if (!b.combo_id) {
        pendingStakesPerUser[b.user_id] = (pendingStakesPerUser[b.user_id] ?? 0) + (b.stake ?? 0)
        if (matchdayMatchIds.has(b.match_id)) {
          betCountsPerUser[b.user_id] = (betCountsPerUser[b.user_id] ?? 0) + 1
        }
      } else {
        if (matchdayMatchIds.has(b.match_id)) comboTouchesMatchday.add(Number(b.combo_id))
        seenComboIds.add(Number(b.combo_id))
      }
    }
    if (seenComboIds.size > 0) {
      // seenComboIds includes any combo with at least one still-open leg (e.g.
      // a leg on a match that hasn't kicked off yet) — but the combo as a whole
      // may already be settled 'lost' if a DIFFERENT leg already lost (a combo
      // loses on its first losing leg, independent of its other legs' status).
      // Without this filter that already-lost stake kept counting as "pending"
      // here, inflating displayBalance and hiding the loss from the Rangliste
      // until every leg had been played — while a lost single bet's stake
      // already dropped out immediately via the status='pending' filter above.
      const { data: comboPendingRows } = await adminSupa
        .from('combo_bets')
        .select('id, user_id, stake')
        .in('id', [...seenComboIds])
        .eq('status', 'pending')
      for (const c of comboPendingRows ?? []) {
        pendingStakesPerUser[c.user_id] = (pendingStakesPerUser[c.user_id] ?? 0) + c.stake
        if (comboTouchesMatchday.has(c.id)) {
          betCountsPerUser[c.user_id] = (betCountsPerUser[c.user_id] ?? 0) + 1
        }
      }
    }
  }

  // Always sort by balance + pending stakes (true ranking value)
  const sortedProfiles = [...(profiles ?? [])].sort((a, b) => {
    const balA = a.balance + (pendingStakesPerUser[a.id] ?? 0)
    const balB = b.balance + (pendingStakesPerUser[b.id] ?? 0)
    if (balB !== balA) return balB - balA
    // Tiebreak: alphabetical by name, so exact ties render in a stable, defined order
    return (a.display_name || a.username).localeCompare(b.display_name || b.username, 'de')
  })

  // Bets for selected matchday
  const matchdayBets: BetRow[] = []
  const combosObj: ComboMap = {}
  const initialReactions: { target_type: string; target_id: number; emoji: string; user_id: string }[] = []

  if (matchdayMatchIds.size > 0 && user) {
    const matchIds = [...matchdayMatchIds]
    const { data: betsRaw } = await supabase
      .from('bets')
      .select(
        `id, user_id, market_type, selection, stake, odds_value, status, payout, combo_id,
         match:matches(id, match_date, home_score, away_score, status,
           home_team:teams!matches_home_team_id_fkey(name, short_name),
           away_team:teams!matches_away_team_id_fkey(name, short_name)
         )`
      )
      .in('match_id', matchIds)

    const mapped = (betsRaw ?? []).map(b => ({
      ...b,
      match: (() => {
        const m = Array.isArray(b.match) ? b.match[0] : b.match
        if (!m) return null
        return {
          ...m,
          home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
          away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
        }
      })(),
    })) as BetRow[]

    matchdayBets.push(...mapped)

    const comboIds = [...new Set(mapped.filter(b => b.combo_id).map(b => b.combo_id as number))]
    if (comboIds.length > 0) {
      const { data: cbData } = await supabase
        .from('combo_bets').select('id, stake, total_odds, status, payout').in('id', comboIds)
      for (const cb of cbData ?? []) combosObj[cb.id] = cb
    }

    // Fetch initial reactions for displayed bets and combos
    const betIds = mapped.filter(b => !b.combo_id).map(b => b.id)
    const allReactions: { target_type: string; target_id: number; emoji: string; user_id: string }[] = []
    if (betIds.length > 0) {
      const { data: rData } = await supabase.from('reactions').select('target_type, target_id, emoji, user_id').eq('target_type', 'bet').in('target_id', betIds)
      allReactions.push(...(rData ?? []))
    }
    if (comboIds.length > 0) {
      const { data: rData } = await supabase.from('reactions').select('target_type, target_id, emoji, user_id').eq('target_type', 'combo').in('target_id', comboIds)
      allReactions.push(...(rData ?? []))
    }
    initialReactions.push(...allReactions)
  }

  // Fetch initial comments for displayed bets and combos
  const initialComments: CommentData[] = []
  {
    const singleIds = matchdayBets.filter(b => !b.combo_id).map(b => b.id)
    const comboIds = [...new Set(matchdayBets.filter(b => b.combo_id).map(b => b.combo_id as number))]
    // Build author name map
    const profileMap = new Map((profiles ?? []).map(p => [p.id, p.display_name || p.username || '?']))
    const allComments: CommentData[] = []
    if (singleIds.length > 0) {
      const { data: cData } = await supabase
        .from('bet_comments').select('id, target_type, target_id, user_id, content, created_at')
        .eq('target_type', 'bet').in('target_id', singleIds)
      for (const c of cData ?? []) allComments.push({ ...c, author_name: profileMap.get(c.user_id) ?? '?' })
    }
    if (comboIds.length > 0) {
      const { data: cData } = await supabase
        .from('bet_comments').select('id, target_type, target_id, user_id, content, created_at')
        .eq('target_type', 'combo').in('target_id', comboIds)
      for (const c of cData ?? []) allComments.push({ ...c, author_name: profileMap.get(c.user_id) ?? '?' })
    }
    initialComments.push(...allComments)
  }

  // ── Per-matchday stats for all users (Wochentippkönig + Streaks) ──
  // Build matchId → RECAP Spieltag map (current season only — allBets/allCombos
  // are already CURRENT_SEASON-filtered). Recap grouping, not display grouping,
  // so Wochentippkönig/streaks agree with the persisted Spieltagskönig award
  // (see recapMatchdayOf above) instead of waiting on a rescheduled outlier.
  const matchToMatchday = new Map(seasonMatches.map(m => [m.id, recapMatchdayOf(m)]))

  // For each user × matchday: net P&L
  type UserMdKey = string // `${userId}_${matchday}`
  const mdPnl = new Map<UserMdKey, number>()

  // Single bets
  for (const b of allBets) {
    if (b.status === 'pending' || !b.match_id) continue
    const md = matchToMatchday.get(b.match_id)
    if (!md || b.combo_id) continue
    const key = `${b.user_id}_${md}`
    const delta = b.status === 'won' ? (b.payout ?? 0) - (b.stake ?? 0) : -(b.stake ?? 0)
    mdPnl.set(key, (mdPnl.get(key) ?? 0) + delta)
  }

  // Combo bets — map combo → matchday via first leg
  const comboToMatchday = new Map<number, number>()
  for (const b of allBets) {
    if (b.combo_id && b.match_id) {
      const md = matchToMatchday.get(b.match_id)
      if (md && !comboToMatchday.has(b.combo_id)) comboToMatchday.set(b.combo_id, md)
    }
  }
  for (const cb of allCombos) {
    if (cb.status === 'pending') continue
    const md = comboToMatchday.get(cb.id)
    if (!md) continue
    const key = `${cb.user_id}_${md}`
    const delta = cb.status === 'won' ? (cb.payout ?? 0) - (cb.stake ?? 0) : -(cb.stake ?? 0)
    mdPnl.set(key, (mdPnl.get(key) ?? 0) + delta)
  }

  // Wochentippkönig: per settled matchday, who gained the most? Current season
  // only, ordered by kickoff — `allMatches` includes prior-season history, which
  // used to make this permanently stuck on last season's final matchdays (the
  // 🔥 streak badge in particular never lit up during the whole current season).
  const settledMatchdays = [...new Set(
    seasonMatches.filter(m => m.status === 'finished').map(m => recapMatchdayOf(m))
  )].filter((md): md is number => md !== null).sort(byKickoff)
  const weeklyWinners = new Map<number, string>() // matchday → userId

  for (const md of settledMatchdays) {
    let bestUid = ''
    let bestPnl = -Infinity
    for (const p of profiles ?? []) {
      const pnl = mdPnl.get(`${p.id}_${md}`) ?? 0
      if (pnl > bestPnl) { bestPnl = pnl; bestUid = p.id }
    }
    if (bestUid && bestPnl > 0) weeklyWinners.set(md, bestUid)
  }

  const weeklyWinnersObj: Record<number, string> = {}
  weeklyWinners.forEach((uid, md) => { weeklyWinnersObj[md] = uid })

  // Streaks: per user, current consecutive matchdays with positive P&L
  const streaks: Record<string, number> = {}
  for (const p of profiles ?? []) {
    let streak = 0
    for (let i = settledMatchdays.length - 1; i >= 0; i--) {
      const pnl = mdPnl.get(`${p.id}_${settledMatchdays[i]}`) ?? null
      if (pnl === null) break // no bets this matchday, stop streak
      if (pnl > 0) streak++
      else break
    }
    streaks[p.id] = streak
  }

  // Per-matchday stats for selected matchday (for Wochentippkönig display)
  const mdStats: MatchdayStats = {}
  for (const p of profiles ?? []) {
    mdStats[p.id] = mdPnl.get(`${p.id}_${currentMatchday}`) ?? null
  }

  // Spieltag Recap for leaderboard
  let leaderboardRecapData: RecapData | null = null

  if (isMatchdayComplete && recapGroupMatchIds.size > 0) {
    // Recap grouping here too, so this live-computed card matches what
    // computeAndPersistMatchdayAwards persisted for the same Spieltag.
    const mdMatchIdArr = [...recapGroupMatchIds]
    const recapBets = allBets.filter(b => b.match_id != null && mdMatchIdArr.includes(b.match_id) && (b.status === 'won' || b.status === 'lost'))

    if (recapBets.length > 0) {
      const recapSingles = recapBets.filter(b => !b.combo_id)
      const recapComboLegBets = recapBets.filter(b => b.combo_id)
      const recapComboIds = [...new Set(recapComboLegBets.map(b => Number(b.combo_id)))]

      const recapCombos = allCombos.filter(cb => recapComboIds.includes(cb.id) && (cb.status === 'won' || cb.status === 'lost')) as { id: number; user_id: string; stake: number; total_odds: number; payout: number; status: string }[]

      // Fetch all legs for unlucky bastard check
      const { data: allLegRows } = recapComboIds.length > 0
        ? await supabase.from('bets').select('id, combo_id, status').in('combo_id', recapComboIds)
        : { data: [] }
      const allComboLegs = (allLegRows ?? []).map(l => ({ ...l, combo_id: Number(l.combo_id) }))

      const recapUserIds = [...new Set([...recapBets.map(b => b.user_id), ...recapCombos.map(c => c.user_id)])]
      const pMap = Object.fromEntries((profiles ?? []).filter(p => recapUserIds.includes(p.id)).map(p => [p.id, p.display_name || p.username || 'Unbekannt']))

      // 🏆 Spieltagskönig: best net saldo
      const netGain: Record<string, number> = {}
      for (const b of recapSingles) {
        const g = b.status === 'won' ? (b.payout ?? 0) - (b.stake ?? 0) : -(b.stake ?? 0)
        netGain[b.user_id] = (netGain[b.user_id] ?? 0) + g
      }
      for (const c of recapCombos) {
        const g = c.status === 'won' ? c.payout - c.stake : -c.stake
        netGain[c.user_id] = (netGain[c.user_id] ?? 0) + g
      }
      const koenig = Object.entries(netGain).filter(([, g]) => g > 0).sort((a, b) => b[1] - a[1])[0]
      const spieltagskoenig = koenig ? { name: pMap[koenig[0]] ?? 'Unbekannt', profit: koenig[1] } : null

      // 🥚 Eier aus Stahl: highest won odds
      const wonSingles = recapSingles.filter(b => b.status === 'won').sort((a, b) => b.odds_value - a.odds_value)
      const wonCombos = recapCombos.filter(c => c.status === 'won').sort((a, b) => b.total_odds - a.total_odds)
      const topSingle = wonSingles[0] ?? null
      const topCombo = wonCombos[0] ?? null
      let eierAusStahl: RecapData['eierAusStahl'] = null
      if (topSingle || topCombo) {
        const sOdds = topSingle?.odds_value ?? 0
        const cOdds = topCombo?.total_odds ?? 0
        if (sOdds >= cOdds && topSingle) {
          eierAusStahl = { name: pMap[topSingle.user_id] ?? 'Unbekannt', odds: topSingle.odds_value, stake: topSingle.stake ?? 0, payout: topSingle.payout ?? 0, isCombo: false }
        } else if (topCombo) {
          eierAusStahl = { name: pMap[topCombo.user_id] ?? 'Unbekannt', odds: topCombo.total_odds, stake: topCombo.stake, payout: topCombo.payout, isCombo: true, legs: allComboLegs.filter(l => l.combo_id === topCombo.id).length }
        }
      }

      // 😭 Unlucky Bastard: lost combo with exactly 1 lost leg
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
        handicap: { home_minus_1_5: 'Heim –1,5', away_plus_1_5: 'Gast +1,5', home_minus_2_5: 'Heim –2,5', away_plus_2_5: 'Gast +2,5' },
      }
      const recapPlayerMap: Record<number, string> = {}
      const { data: recapPlayers } = await supabase.from('wildenroth_players').select('id, name')
      for (const p of recapPlayers ?? []) recapPlayerMap[p.id] = p.name

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
              ? (recapPlayerMap[parseInt(l.selection, 10)] ?? l.selection)
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

      // 🔮 Ergebnis-Orakel: exact score won, highest stake wins
      const exactScoreWon = recapSingles
        .filter(b => b.status === 'won' && b.market_type === 'exact_score')
        .sort((a, b) => (b.stake ?? 0) - (a.stake ?? 0))
      const orakelBet = exactScoreWon[0] ?? null
      const ergebnisOrakel: RecapData['ergebnisOrakel'] = orakelBet ? {
        name: pMap[orakelBet.user_id] ?? 'Unbekannt',
        score: orakelBet.selection ?? '',
        stake: orakelBet.stake ?? 0,
      } : null

      // 🚽 Griff ins Klo: highest lost stake
      const lostSingles = recapSingles.filter(b => b.status === 'lost').sort((a, b) => (b.stake ?? 0) - (a.stake ?? 0))
      const lostCombos = recapCombos.filter(c => c.status === 'lost').sort((a, b) => b.stake - a.stake)
      let griffInsKlo: RecapData['griffInsKlo'] = null
      if (lostSingles[0] || lostCombos[0]) {
        const sSt = lostSingles[0]?.stake ?? 0
        const cSt = lostCombos[0]?.stake ?? 0
        if (sSt >= cSt && lostSingles[0]) {
          griffInsKlo = { name: pMap[lostSingles[0].user_id] ?? 'Unbekannt', loss: sSt, isCombo: false }
        } else if (lostCombos[0]) {
          griffInsKlo = { name: pMap[lostCombos[0].user_id] ?? 'Unbekannt', loss: cSt, isCombo: true }
        }
      }

      // 🧱 Betonmischer: lowest won odds, tiebreak higher stake
      const safeSingles = wonSingles.slice().sort((a, b) => a.odds_value - b.odds_value || (b.stake ?? 0) - (a.stake ?? 0))
      const safeCombos = wonCombos.slice().sort((a, b) => a.total_odds - b.total_odds || b.stake - a.stake)
      let betonmischer: RecapData['betonmischer'] = null
      if (safeSingles[0] || safeCombos[0]) {
        const sOdds = safeSingles[0]?.odds_value ?? Infinity
        const cOdds = safeCombos[0]?.total_odds ?? Infinity
        if (sOdds <= cOdds && safeSingles[0]) {
          betonmischer = { name: pMap[safeSingles[0].user_id] ?? 'Unbekannt', odds: safeSingles[0].odds_value, stake: safeSingles[0].stake ?? 0, payout: safeSingles[0].payout ?? 0, isCombo: false }
        } else if (safeCombos[0]) {
          betonmischer = { name: pMap[safeCombos[0].user_id] ?? 'Unbekannt', odds: safeCombos[0].total_odds, stake: safeCombos[0].stake, payout: safeCombos[0].payout, isCombo: true }
        }
      }

      // 🔥 On Fire: most won bet slips (min 2), tiebreak saldo
      const wonSlipCount: Record<string, number> = {}
      for (const b of recapSingles.filter(b => b.status === 'won')) wonSlipCount[b.user_id] = (wonSlipCount[b.user_id] ?? 0) + 1
      for (const c of wonCombos) wonSlipCount[c.user_id] = (wonSlipCount[c.user_id] ?? 0) + 1
      const onFireEntry = Object.entries(wonSlipCount)
        .filter(([, cnt]) => cnt >= 2)
        .sort(([aId, aCnt], [bId, bCnt]) => bCnt - aCnt || (netGain[bId] ?? 0) - (netGain[aId] ?? 0))[0]
      const onFire: RecapData['onFire'] = onFireEntry ? {
        name: pMap[onFireEntry[0]] ?? 'Unbekannt',
        count: onFireEntry[1],
        pnl: netGain[onFireEntry[0]] ?? 0,
      } : null

      if (spieltagskoenig || eierAusStahl || unluckyBastard || ergebnisOrakel || griffInsKlo || betonmischer || onFire) {
        leaderboardRecapData = { spieltagskoenig, eierAusStahl, unluckyBastard, ergebnisOrakel, griffInsKlo, betonmischer, onFire }
      }
    }
  }

  // Wildenroth roster for goalscorer bet labels
  const { data: rosterRows } = await supabase.from('wildenroth_players').select('id, name')
  const playerNameMap: Record<number, string> = Object.fromEntries((rosterRows ?? []).map(r => [r.id, r.name]))

  return (
    <LeaderboardClient
      profiles={sortedProfiles}
      currentUserId={user?.id ?? null}
      currentUserName={currentUserName}
      isAdmin={isAdmin}
      matchdayBets={matchdayBets}
      matchdayNumber={currentMatchday}
      allMatchdays={allMatchdays}
      combos={combosObj}
      isDeadlinePassed={isDeadlinePassed}
      weeklyWinners={weeklyWinnersObj}
      streaks={streaks}
      mdStats={mdStats}
      initialReactions={initialReactions}
      initialComments={initialComments}
      initialRecap={leaderboardRecapData}
      playerNameMap={playerNameMap}
      pendingStakesPerUser={pendingStakesPerUser}
      betCountsPerUser={betCountsPerUser}
      defaultTabIsSpielTag={defaultTabIsSpielTag}
    />
  )
}
