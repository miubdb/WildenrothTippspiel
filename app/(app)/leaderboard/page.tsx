import { createClient } from '@/lib/supabase/server'
import { LeaderboardClient } from './LeaderboardClient'
import type { BetRow, ComboMeta, MatchdayStats } from './LeaderboardClient'

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
    supabase.from('profiles').select('id, username, display_name, balance').order('balance', { ascending: false }),
    supabase.auth.getUser(),
    supabase.from('matches').select('id, matchday, match_date, status').order('match_date', { ascending: true }),
    supabase.from('bets').select('id, user_id, match_id, market_type, selection, stake, odds_value, status, payout, combo_id'),
    supabase.from('combo_bets').select('id, user_id, stake, total_odds, status, payout'),
  ])

  const allMatches = allMatchesRaw ?? []
  const allBets = allBetsRaw ?? []
  const allCombos = allCombosRaw ?? []

  // All matchdays
  const allMatchdays = [...new Set(allMatches.map(m => m.matchday))].sort((a, b) => a - b)

  // Current matchday for Spieltag tab
  const firstScheduledMd = allMatches
    .filter(m => m.status === 'scheduled')
    .map(m => m.matchday)
    .sort((a, b) => a - b)[0]
  const defaultMatchday = firstScheduledMd ?? (allMatchdays.length > 0 ? Math.max(...allMatchdays) : null)

  const requestedMd = params.spieltag ? parseInt(params.spieltag, 10) : null
  const currentMatchday = requestedMd && allMatchdays.includes(requestedMd) ? requestedMd : defaultMatchday

  const matchdayMatches = currentMatchday != null
    ? allMatches.filter(m => m.matchday === currentMatchday).sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime())
    : []

  const firstMatch = matchdayMatches[0]
  const isDeadlinePassed = firstMatch ? new Date(firstMatch.match_date) <= new Date() : false
  const matchdayMatchIds = new Set(matchdayMatches.map(m => m.id))

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
         match:matches(id, home_score, away_score, status,
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

  // ── Per-matchday stats for all users (Wochentippkönig + Streaks) ──
  // Build matchId → matchday map
  const matchToMatchday = new Map(allMatches.map(m => [m.id, m.matchday]))

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

  // Wochentippkönig: per settled matchday, who gained the most?
  const settledMatchdays = [...new Set(
    allMatches.filter(m => m.status === 'finished').map(m => m.matchday)
  )]
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

  return (
    <LeaderboardClient
      profiles={profiles ?? []}
      currentUserId={user?.id ?? null}
      matchdayBets={matchdayBets}
      matchdayNumber={currentMatchday}
      allMatchdays={allMatchdays}
      combos={combosObj}
      isDeadlinePassed={isDeadlinePassed}
      weeklyWinners={weeklyWinnersObj}
      streaks={streaks}
      mdStats={mdStats}
      initialReactions={initialReactions}
    />
  )
}
