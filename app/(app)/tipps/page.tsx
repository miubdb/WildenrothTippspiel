import { createClient } from '@/lib/supabase/server'
import { BettingMatchCard } from '@/components/BettingMatchCard'
import { BetSlip } from '@/components/BetSlip'
import { MatchdayScroller } from '@/components/MatchdayScroller'
import type { Match } from '@/types'
import { calculateOdds } from '@/lib/odds'
import Link from 'next/link'

export const revalidate = 60

const SELECTION_DISPLAY: Record<string, Record<string, string>> = {
  '1x2': { home: 'Heimsieg', draw: 'Unentschieden', away: 'Auswärtssieg' },
  double_chance: { '1x': '1X', x2: 'X2', '12': '12' },
  over_under_3_5: { 'over_3.5': 'Über 3,5', 'under_3.5': 'Unter 3,5' },
  btts: { yes: 'Beide treffen', no: 'Nicht beide' },
}

function socialSelLabel(marketType: string, selection: string) {
  if (marketType === 'exact_score') return selection
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
    .order('match_date', { ascending: true })

  const allMatches: Match[] = (allMatchesRaw ?? []).map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  }))

  const allMatchdays = [...new Set(allMatches.map((m) => m.matchday))].sort((a, b) => a - b)

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

  // Betting window: opens Monday 12:00 of match week
  const bettingOpens = deadline ? bettingOpenTime(deadline) : null
  const isBettingOpen = !bettingOpens || new Date() >= bettingOpens

  const SEASON_START = '2025-08-01'
  const seasonMatches = allMatches.filter((m) => m.match_date >= SEASON_START)

  // Odds snapshot: freeze odds at Monday 12:00 — only use matches finished before that cutoff
  const oddsSnapshotCutoff = bettingOpens ?? deadline
  const oddsMatches = oddsSnapshotCutoff
    ? seasonMatches.filter(
        (m) => m.status !== 'finished' || new Date(m.match_date) < oddsSnapshotCutoff
      )
    : seasonMatches

  // Odds only when betting window is open and match is scheduled
  const oddsMap: Record<number, ReturnType<typeof calculateOdds>> = {}
  if (isBettingOpen) {
    for (const m of matchdayMatches) {
      if (m.status === 'scheduled') {
        oddsMap[m.id] = calculateOdds(oddsMatches, m.home_team_id, m.away_team_id)
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

  // Fetch user profile (for Wildenroth player flag)
  const isWildenrothPlayer = user ? await supabase
    .from('profiles')
    .select('is_wildenroth')
    .eq('id', user.id)
    .single()
    .then(({ data }) => data?.is_wildenroth ?? false) : false

  // Find Wildenroth team ID
  const wildenrothTeam = allMatches.flatMap(m => [m.home_team, m.away_team])
    .find(t => t?.name?.includes('Wildenroth'))
  const wildenrothTeamId = wildenrothTeam?.id ?? null

  const matchdayMatchIds = matchdayMatches.map((m) => m.id)

  // Own bet counter
  let betCountForMatchday = 0
  if (user && matchdayMatchIds.length > 0) {
    const [{ count: singleCount }, { data: comboLegs }] = await Promise.all([
      supabase.from('bets').select('id', { count: 'exact', head: true })
        .eq('user_id', user.id).is('combo_id', null).in('match_id', matchdayMatchIds),
      supabase.from('bets').select('combo_id')
        .eq('user_id', user.id).not('combo_id', 'is', null).in('match_id', matchdayMatchIds),
    ])
    const distinctCombos = new Set((comboLegs ?? []).map((b) => b.combo_id)).size
    betCountForMatchday = (singleCount ?? 0) + distinctCombos
  }

  // Social bets: visible after first match kicks off (RLS policy allows this)
  type SocialBet = { id: string; market_type: string; selection: string; odds_value: number; status: string; combo_id: string | null; user_id: string; match_id: number }
  type SocialProfile = { id: string; display_name: string | null; username: string }
  let socialBets: SocialBet[] = []
  let socialProfiles: SocialProfile[] = []

  if (isDeadlinePassed && matchdayMatchIds.length > 0) {
    const { data: rawSocial } = await supabase
      .from('bets')
      .select('id, market_type, selection, odds_value, status, combo_id, user_id, match_id')
      .in('match_id', matchdayMatchIds)
      .neq('user_id', user?.id ?? '')

    if (rawSocial && rawSocial.length > 0) {
      socialBets = rawSocial
      const uids = [...new Set(rawSocial.map(b => b.user_id))]
      const { data: pData } = await supabase
        .from('profiles')
        .select('id, display_name, username')
        .in('id', uids)
      socialProfiles = pData ?? []
    }
  }

  // Build match label map for social section
  const matchMap = new Map(matchdayMatches.map(m => [m.id, m]))

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Matchday Header */}
      <div className="bg-red-700 text-white rounded-2xl px-5 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-red-200 text-xs font-medium uppercase tracking-wide">Spieltag</div>
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

        {/* Betting window not yet open */}
        {!isBettingOpen && !isDeadlinePassed && bettingOpens && (
          <div className="mt-3 bg-red-800/60 rounded-xl px-3 py-2">
            <div className="text-red-200 text-xs">Wetten öffnen am</div>
            <div className="text-white font-semibold text-sm">
              {bettingOpens.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' })} um 12:00 Uhr
            </div>
          </div>
        )}

        {/* Betting open: show deadline */}
        {isBettingOpen && deadline && !isDeadlinePassed && matchdayMatches.some(m => m.status === 'scheduled') && (
          <div className="mt-3 bg-red-800/60 rounded-xl px-3 py-2">
            <div className="text-red-200 text-xs">Annahmeschluss</div>
            <div className="text-white font-semibold text-sm">
              {deadline.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' })}{' '}
              um {deadline.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })} Uhr
            </div>
          </div>
        )}

        {isDeadlinePassed && matchdayMatches.some(m => m.status === 'scheduled') && (
          <div className="mt-3 bg-red-900/60 rounded-xl px-3 py-2 text-red-200 text-xs font-medium">
            Annahmeschluss überschritten — keine neuen Tipps möglich
          </div>
        )}
      </div>

      {/* Matchday Selector */}
      <MatchdayScroller activeIndex={allMatchdays.indexOf(currentMatchday)}>
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
      </MatchdayScroller>

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
              odds={match.status === 'scheduled' && isBettingOpen ? (oddsMap[match.id] ?? null) : null}
              allMatches={seasonMatches}
              historyMatches={allMatches}
              positions={positions}
              isWildenrothPlayer={isWildenrothPlayer}
              wildenrothTeamId={wildenrothTeamId}
            />
          ))}
        </div>
      )}

      {/* Social Bets — visible once matchday has started */}
      {isDeadlinePassed && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="font-bold text-gray-900">Tipps der anderen</h2>
            {socialProfiles.length > 0 ? (
              <p className="text-xs text-gray-400 mt-0.5">{socialProfiles.length} Spieler haben getippt</p>
            ) : (
              <p className="text-xs text-gray-400 mt-0.5">Noch keine Tipps von Mitspielern</p>
            )}
          </div>

          {socialProfiles.length === 0 ? (
            <div className="px-4 py-6 text-center text-gray-400 text-sm">
              Keine Tipps vorhanden
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {socialProfiles.map(profile => {
                const userBets = socialBets.filter(b => b.user_id === profile.id)
                const shownCombos = new Set<string>()
                const initial = (profile.display_name || profile.username)[0].toUpperCase()
                const singlesCount = userBets.filter(b => !b.combo_id).length
                const combosCount = new Set(userBets.filter(b => b.combo_id).map(b => b.combo_id)).size
                const actionCount = singlesCount + combosCount

                return (
                  <div key={profile.id} className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-2.5">
                      <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-red-700 font-bold text-sm">{initial}</span>
                      </div>
                      <span className="font-semibold text-gray-900 text-sm flex-1">
                        {profile.display_name || profile.username}
                      </span>
                      <span className="text-xs text-gray-400">
                        {actionCount} {actionCount === 1 ? 'Wette' : 'Wetten'}
                      </span>
                    </div>

                    <div className="pl-10 space-y-1.5">
                      {userBets.map(bet => {
                        if (bet.combo_id) {
                          if (shownCombos.has(bet.combo_id)) return null
                          shownCombos.add(bet.combo_id)
                          const legs = userBets.filter(b => b.combo_id === bet.combo_id)
                          const comboOdds = legs.reduce((acc, l) => acc * l.odds_value, 1)
                          return (
                            <div key={bet.combo_id} className="bg-blue-50 border border-blue-100 rounded-xl p-2.5">
                              <div className="text-xs font-semibold text-blue-700 mb-1.5">
                                🔗 Kombiwette · {legs.length} Tipps · @{comboOdds.toFixed(2)}
                              </div>
                              {legs.map(leg => {
                                const m = matchMap.get(leg.match_id)
                                const ht = m?.home_team?.name ?? '?'
                                const at = m?.away_team?.name ?? '?'
                                return (
                                  <div key={leg.id} className="flex items-center gap-1.5 text-xs text-gray-600 py-0.5">
                                    <StatusDot status={leg.status} />
                                    <span className="text-gray-400">{ht}–{at}</span>
                                    <span className="font-medium text-gray-800">{socialSelLabel(leg.market_type, leg.selection)}</span>
                                    <span className="text-red-600 font-bold ml-auto">@{leg.odds_value.toFixed(2)}</span>
                                  </div>
                                )
                              })}
                            </div>
                          )
                        }

                        const m = matchMap.get(bet.match_id)
                        const ht = m?.home_team?.name ?? '?'
                        const at = m?.away_team?.name ?? '?'
                        return (
                          <div key={bet.id} className={`flex items-center gap-2 text-xs rounded-xl px-2.5 py-2 ${
                            bet.status === 'won' ? 'bg-green-50 border border-green-100' :
                            bet.status === 'lost' ? 'bg-red-50 border border-red-100' :
                            'bg-gray-50 border border-gray-100'
                          }`}>
                            <StatusDot status={bet.status} />
                            <span className="text-gray-400">{ht}–{at}</span>
                            <span className="font-medium text-gray-800 flex-1">{socialSelLabel(bet.market_type, bet.selection)}</span>
                            <span className="text-red-600 font-bold">@{bet.odds_value.toFixed(2)}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
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
