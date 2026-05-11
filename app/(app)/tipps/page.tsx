import { createClient } from '@/lib/supabase/server'
import { BettingMatchCard } from '@/components/BettingMatchCard'
import { BetSlip } from '@/components/BetSlip'
import type { Match, Odds } from '@/types'

export const revalidate = 60

export default async function TippsPage() {
  const supabase = await createClient()

  // Fetch all matches with team info
  const { data: allMatches } = await supabase
    .from('matches')
    .select(
      `id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status,
       home_team:teams!matches_home_team_id_fkey(id, name, short_name),
       away_team:teams!matches_away_team_id_fkey(id, name, short_name)`
    )
    .order('match_date', { ascending: true })

  const matches: Match[] = (allMatches ?? []).map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  }))

  // Find current matchday: first matchday with scheduled matches
  const scheduledMatchdays = [
    ...new Set(
      matches
        .filter((m) => m.status === 'scheduled')
        .map((m) => m.matchday)
    ),
  ].sort((a, b) => a - b)

  const currentMatchday =
    scheduledMatchdays[0] ??
    Math.max(...matches.map((m) => m.matchday), 1)

  const matchdayMatches = matches.filter((m) => m.matchday === currentMatchday)

  // Find deadline = first game of matchday
  const sortedByDate = [...matchdayMatches].sort(
    (a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime()
  )
  const firstGame = sortedByDate[0]
  const deadline = firstGame ? new Date(firstGame.match_date) : null

  // Fetch odds for this matchday's matches
  const matchIds = matchdayMatches.map((m) => m.id)
  const { data: oddsData } = await supabase
    .from('odds')
    .select('*')
    .in('match_id', matchIds)

  const oddsMap: Record<number, Odds> = {}
  for (const o of oddsData ?? []) {
    oddsMap[o.match_id] = o
  }

  const isDeadlinePassed = deadline ? deadline <= new Date() : false

  // Matchday navigation info
  const allMatchdays = [...new Set(matches.map((m) => m.matchday))].sort((a, b) => a - b)

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Matchday Header */}
      <div className="bg-red-700 text-white rounded-2xl px-5 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-red-200 text-xs font-medium uppercase tracking-wide">
              Aktueller Spieltag
            </div>
            <div className="text-2xl font-black mt-0.5">{currentMatchday}. Spieltag</div>
          </div>
          <div className="text-right">
            <div className="text-red-200 text-xs font-medium">Spiele</div>
            <div className="text-xl font-bold">{matchdayMatches.length}</div>
          </div>
        </div>

        {deadline && !isDeadlinePassed && (
          <div className="mt-3 bg-red-800/60 rounded-xl px-3 py-2">
            <div className="text-red-200 text-xs">Annahmeschluss</div>
            <div className="text-white font-semibold text-sm">
              {deadline.toLocaleDateString('de-DE', {
                weekday: 'long',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
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

        {isDeadlinePassed && (
          <div className="mt-3 bg-red-900/60 rounded-xl px-3 py-2">
            <div className="text-red-200 text-xs font-medium">
              Annahmeschluss überschritten – keine neuen Tipps möglich
            </div>
          </div>
        )}
      </div>

      {/* Matchday Selector */}
      {allMatchdays.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
          {allMatchdays.map((md) => (
            <a
              key={md}
              href={`/tipps?matchday=${md}`}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                md === currentMatchday
                  ? 'bg-red-700 text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-red-300'
              }`}
            >
              {md}. Spieltag
            </a>
          ))}
        </div>
      )}

      {/* Match Cards */}
      {matchdayMatches.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">⚽</div>
          <div className="font-medium">Keine Spiele verfügbar</div>
          <div className="text-sm mt-1">Bald werden neue Spiele angezeigt</div>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedByDate.map((match) => (
            <BettingMatchCard
              key={match.id}
              match={match}
              odds={oddsMap[match.id] ?? null}
            />
          ))}
        </div>
      )}

      {/* Bet Slip (floating) */}
      <BetSlip />
    </div>
  )
}
