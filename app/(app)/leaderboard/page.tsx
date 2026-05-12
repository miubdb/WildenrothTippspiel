import { createClient } from '@/lib/supabase/server'
import { LeaderboardClient } from './LeaderboardClient'
import type { BetRow, ComboMeta } from './LeaderboardClient'

type ComboMap = Record<string, ComboMeta>

export const revalidate = 60

export default async function LeaderboardPage() {
  const supabase = await createClient()

  const [
    { data: profiles },
    { data: { user } },
    { data: allMatchesRaw },
  ] = await Promise.all([
    supabase.from('profiles').select('id, username, display_name, balance').order('balance', { ascending: false }),
    supabase.auth.getUser(),
    supabase
      .from('matches')
      .select('id, matchday, match_date, status')
      .order('match_date', { ascending: true }),
  ])

  const allMatches = allMatchesRaw ?? []

  // Determine current matchday: first with scheduled matches, or most recent
  const allMatchdays = [...new Set(allMatches.map(m => m.matchday))].sort((a, b) => a - b)
  const firstScheduledMd = allMatches
    .filter(m => m.status === 'scheduled')
    .map(m => m.matchday)
    .sort((a, b) => a - b)[0]
  const currentMatchday = firstScheduledMd ?? (allMatchdays.length > 0 ? Math.max(...allMatchdays) : null)

  const matchdayMatches = currentMatchday != null
    ? allMatches.filter(m => m.matchday === currentMatchday).sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime())
    : []

  const firstMatch = matchdayMatches[0]
  const isDeadlinePassed = firstMatch ? new Date(firstMatch.match_date) <= new Date() : false
  const matchdayMatchIds = matchdayMatches.map(m => m.id)

  // Fetch bets for this matchday (RLS allows own always, others after kickoff)
  let matchdayBets: BetRow[] = []
  const combosObj: ComboMap = {}

  if (matchdayMatchIds.length > 0 && user) {
    const { data: betsRaw } = await supabase
      .from('bets')
      .select(
        `id, user_id, market_type, selection, stake, odds_value, status, payout, combo_id,
         match:matches(id, home_score, away_score, status,
           home_team:teams!matches_home_team_id_fkey(name, short_name),
           away_team:teams!matches_away_team_id_fkey(name, short_name)
         )`
      )
      .in('match_id', matchdayMatchIds)

    matchdayBets = (betsRaw ?? []).map(b => ({
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

    // Fetch combo metadata
    const comboIds = [...new Set(matchdayBets.filter(b => b.combo_id).map(b => b.combo_id as string))]
    if (comboIds.length > 0) {
      const { data: cbData } = await supabase
        .from('combo_bets')
        .select('id, stake, total_odds, status, payout')
        .in('id', comboIds)
      for (const cb of cbData ?? []) combosObj[cb.id] = cb
    }
  }

  return (
    <LeaderboardClient
      profiles={profiles ?? []}
      currentUserId={user?.id ?? null}
      matchdayBets={matchdayBets}
      matchdayNumber={currentMatchday}
      combos={combosObj}
      isDeadlinePassed={isDeadlinePassed}
    />
  )
}
