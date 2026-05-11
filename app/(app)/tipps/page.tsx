import { createClient } from '@/lib/supabase/server'
import { BettingMatchCard } from '@/components/BettingMatchCard'
import { BetSlip } from '@/components/BetSlip'
import type { Match } from '@/types'
import { calculateOdds } from '@/lib/odds'
import Link from 'next/link'

export const revalidate = 60

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
    .order('match_date', { ascending: true })

  const allMatches: Match[] = (allMatchesRaw ?? []).map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  }))

  const allMatchdays = [...new Set(allMatches.map((m) => m.matchday))].sort((a, b) => a - b)

  // First scheduled matchday as default
  const firstScheduled = allMatches
    .filter((m) => m.status === 'scheduled')
    .map((m) => m.matchday)
    .sort((a, b) => a - b)[0]

  const defaultMatchday = firstScheduled ?? Math.max(...allMatchdays)
  const requestedMd = params.matchday ? parseInt(params.matchday, 10) : null
  const currentMatchday =
    requestedMd && allMatchdays.includes(requestedMd) ? requestedMd : defaultMatchday

  const matchdayMatches = allMatches
    .filter((m) => m.matchday === currentMatchday)
    .sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime())

  const deadline = matchdayMatches[0] ? new Date(matchdayMatches[0].match_date) : null
  const isDeadlinePassed = deadline ? deadline <= new Date() : false

  // Only use current season matches for odds/form (exclude old seasons, friendlies, cup games)
  const SEASON_START = '2025-08-01'
  const seasonMatches = allMatches.filter((m) => m.match_date >= SEASON_START)

  // Calculate odds dynamically for scheduled matches
  const oddsMap: Record<number, ReturnType<typeof calculateOdds>> = {}
  for (const m of matchdayMatches) {
    if (m.status === 'scheduled') {
      oddsMap[m.id] = calculateOdds(seasonMatches, m.home_team_id, m.away_team_id)
    }
  }

  // Bet counter for current matchday
  const { data: { user } } = await supabase.auth.getUser()
  const matchdayMatchIds = matchdayMatches.map((m) => m.id)
  let betCountForMatchday = 0
  if (user && matchdayMatchIds.length > 0) {
    const [{ count: singleCount }, { data: comboLegs }] = await Promise.all([
      supabase
        .from('bets')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .is('combo_id', null)
        .in('match_id', matchdayMatchIds),
      supabase
        .from('bets')
        .select('combo_id')
        .eq('user_id', user.id)
        .not('combo_id', 'is', null)
        .in('match_id', matchdayMatchIds),
    ])
    const distinctCombos = new Set((comboLegs ?? []).map((b) => b.combo_id)).size
    betCountForMatchday = (singleCount ?? 0) + distinctCombos
  }

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Matchday Header */}
      <div className="bg-red-700 text-white rounded-2xl px-5 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-red-200 text-xs font-medium uppercase tracking-wide">
              Spieltag
            </div>
            <div className="text-2xl font-black mt-0.5">{currentMatchday}. Spieltag</div>
          </div>
          <div className="text-right flex gap-4">
            <div>
              <div className="text-red-200 text-xs font-medium">Spiele</div>
              <div className="text-xl font-bold">{matchdayMatches.length}</div>
            </div>
            <div>
              <div className="text-red-200 text-xs font-medium">Wetten</div>
              <div className={`text-xl font-bold ${betCountForMatchday >= 2 ? 'text-yellow-300' : ''}`}>
                {betCountForMatchday}/2
              </div>
            </div>
          </div>
        </div>

        {deadline && !isDeadlinePassed && matchdayMatches.some((m) => m.status === 'scheduled') && (
          <div className="mt-3 bg-red-800/60 rounded-xl px-3 py-2">
            <div className="text-red-200 text-xs">Annahmeschluss</div>
            <div className="text-white font-semibold text-sm">
              {deadline.toLocaleDateString('de-DE', {
                weekday: 'long',
                day: '2-digit',
                month: '2-digit',
              })}{' '}
              um{' '}
              {deadline.toLocaleTimeString('de-DE', {
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              Uhr
            </div>
          </div>
        )}

        {isDeadlinePassed && matchdayMatches.some((m) => m.status === 'scheduled') && (
          <div className="mt-3 bg-red-900/60 rounded-xl px-3 py-2 text-red-200 text-xs font-medium">
            Annahmeschluss überschritten — keine neuen Tipps möglich
          </div>
        )}
      </div>

      {/* Matchday Selector */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-none">
        {allMatchdays.map((md) => {
          const mdMatches = allMatches.filter((m) => m.matchday === md)
          const hasScheduled = mdMatches.some((m) => m.status === 'scheduled')
          const allFinished = mdMatches.every((m) => m.status === 'finished')
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
                  : 'bg-red-800/40 text-red-300'
              }`}
            >
              {md}
            </Link>
          )
        })}
      </div>

      {/* Match Cards */}
      {matchdayMatches.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">⚽</div>
          <div className="font-medium">Keine Spiele</div>
        </div>
      ) : (
        <div className="space-y-3">
          {matchdayMatches.map((match) => (
            <BettingMatchCard
              key={match.id}
              match={match}
              odds={match.status === 'scheduled' ? (oddsMap[match.id] ?? null) : null}
              allMatches={seasonMatches}
            />
          ))}
        </div>
      )}

      <BetSlip />
    </div>
  )
}
