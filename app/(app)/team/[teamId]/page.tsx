import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Match } from '@/types'
import { getForm } from '@/lib/odds'
import { TeamLogo } from '@/components/TeamLogo'
import { LEAGUE_STATS_SEASON_START } from '@/lib/leagueStats'
import { resultForStandings } from '@/lib/matchAnnulment'

export const revalidate = 60

interface Standing {
  teamId: number; teamName: string
  played: number; w: number; d: number; l: number
  gf: number; ga: number; gd: number
}

function computeStandings(matches: Match[]): Standing[] {
  const teamMap = new Map<number, string>()
  for (const m of matches) {
    if (m.home_team) teamMap.set(m.home_team_id, m.home_team.name)
    if (m.away_team) teamMap.set(m.away_team_id, m.away_team.name)
  }
  const stats = new Map<number, Standing>()
  for (const [id, name] of teamMap) stats.set(id, { teamId: id, teamName: name, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0 })
  for (const m of matches) {
    const result = resultForStandings(m)
    if (!result) continue
    const hs = result.home_score; const as_ = result.away_score
    const home = stats.get(m.home_team_id)!; const away = stats.get(m.away_team_id)!
    home.played++; away.played++
    home.gf += hs; home.ga += as_; home.gd = home.gf - home.ga
    away.gf += as_; away.ga += hs; away.gd = away.gf - away.ga
    if (hs > as_) { home.w++; away.l++ } else if (hs < as_) { away.w++; home.l++ } else { home.d++; away.d++ }
  }
  return [...stats.values()].sort((a, b) => (b.w * 3 + b.d) - (a.w * 3 + a.d) || b.gd - a.gd || b.gf - a.gf)
}

export default async function TeamDetailPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  const id = parseInt(teamId, 10)
  if (!Number.isFinite(id)) notFound()

  const supabase = await createClient()

  const { data: team } = await supabase.from('teams').select('id, name, short_name').eq('id', id).single()
  if (!team) notFound()

  const { data: rawMatches } = await supabase
    .from('matches')
    .select(`id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status, match_category,
             annulment_official_home_score, annulment_official_away_score, annulment_official_confirmed_at,
             home_team:teams!matches_home_team_id_fkey(id, name, short_name),
             away_team:teams!matches_away_team_id_fkey(id, name, short_name)`)
    .gte('match_date', LEAGUE_STATS_SEASON_START)
    .or('match_category.is.null,match_category.eq.kreisliga')
    .neq('matchday', 999)
    // One-off cup fixtures (e.g. Pokal-Spezial, see CLAUDE.md) keep
    // match_category='kreisliga' for betting/display purposes but must never
    // count toward a team's league standing/form here.
    .or('competition_type.is.null,competition_type.neq.cup')
    .order('match_date', { ascending: true })

  const matches: Match[] = (rawMatches ?? []).map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  }))

  const standings = computeStandings(matches)
  const own = standings.find((s) => s.teamId === id)
  const position = own ? standings.findIndex((s) => s.teamId === id) + 1 : null
  const form = getForm(matches, id, 5)
  const cleanSheets = matches.filter((m) => {
    const result = resultForStandings(m)
    if (!result) return false
    if (m.home_team_id === id) return result.away_score === 0
    if (m.away_team_id === id) return result.home_score === 0
    return false
  }).length

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="bg-gradient-to-br from-gray-700 to-gray-900 text-white rounded-2xl px-5 py-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center flex-shrink-0 shadow p-2">
            <TeamLogo name={team.name} size="lg" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-gray-300 text-xs font-medium uppercase tracking-wide">Kreisliga Gruppe 2 · Saison 26/27</div>
            <h1 className="text-2xl font-black leading-tight truncate">{team.name}</h1>
            {own && own.played > 0 && (
              <div className="text-gray-200 text-sm mt-1">{own.w} Siege · {own.d} Unentschieden · {own.l} Niederlagen</div>
            )}
          </div>
        </div>
      </div>

      {/* Mannschaftsübersicht */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-gray-100">Mannschaftsübersicht</h2>
        </div>
        {own && own.played > 0 ? (
          <>
            <div className="grid grid-cols-4 divide-x divide-gray-100 dark:divide-gray-700">
              {[
                { label: 'Platz', value: position != null ? String(position) : '—' },
                { label: 'Spiele', value: String(own.played) },
                { label: 'Tore', value: `${own.gf}:${own.ga}` },
                { label: 'Tordiff.', value: own.gd >= 0 ? `+${own.gd}` : String(own.gd) },
              ].map(({ label, value }) => (
                <div key={label} className="px-3 py-3 text-center">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</div>
                  <div className="font-black text-gray-900 dark:text-gray-100 text-lg">{value}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Form</span>
                <div className="flex gap-1.5">
                  {form.length > 0 ? form.map((r, i) => (
                    <span key={i} className={`w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center ${r === 'W' ? 'bg-green-500' : r === 'D' ? 'bg-gray-400' : 'bg-red-500'}`}>
                      {r === 'W' ? 'S' : r === 'D' ? 'U' : 'N'}
                    </span>
                  )) : <span className="text-sm text-gray-400 dark:text-gray-500">–</span>}
                </div>
              </div>
              <div className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{cleanSheets} × zu Null</div>
            </div>
          </>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">Noch keine Spiele dieser Saison erfasst.</div>
        )}
      </div>

      {/* Individuelle Spielerstatistiken (Highlights, Kader aus erfassten Aufstellungen) hier
          entfernt — siehe Abschlussbericht "Spielerstatistiken automatisieren oder ausblenden":
          kein zulässiger automatisierter Datenabruf bei BFV/FuPa möglich (BFV-Nutzungsbedingungen
          untersagen die Weiterverarbeitung der DFBnet-Daten außerhalb des offiziellen Widgets,
          FuPas robots.txt sperrt die match- und playerstats-Pfade sowie die gesamte api.fupa.net
          für jeden automatisierten Zugriff), manuelle Nachpflege wollte der Nutzer nicht wiederholen.
          lib/leagueStats.ts (computeTeamRoster, teamRosterHighlights, fetchPlayerSnapshots,
          groupRosterByPosition) bleibt unverändert bestehen, nur hier nicht mehr aufgerufen. */}
    </div>
  )
}
