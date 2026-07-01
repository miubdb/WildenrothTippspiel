import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Match } from '@/types'
import { getForm } from '@/lib/odds'

export const revalidate = 60

const SEASON_START = '2026-08-01'
const CREST = '/crests/spvgg-wildenroth.png'

interface PlayerRow {
  id: number
  name: string
  position: string | null
  shirt_number: number | null
  image_url: string | null
  squad: string
  games: number | null
  goals: number | null
  assists: number | null
  is_goalkeeper: boolean | null
  is_penalty_taker: boolean | null
  is_freekick_taker: boolean | null
}

interface Standing {
  teamId: number; teamName: string
  played: number; w: number; d: number; l: number
  gf: number; ga: number; gd: number; pts: number
}

function computeStandings(matches: Match[]): Standing[] {
  const teamMap = new Map<number, string>()
  for (const m of matches) {
    if (m.home_team) teamMap.set(m.home_team_id, m.home_team.name)
    if (m.away_team) teamMap.set(m.away_team_id, m.away_team.name)
  }
  const stats = new Map<number, Standing>()
  for (const [id, name] of teamMap)
    stats.set(id, { teamId: id, teamName: name, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 })
  for (const m of matches) {
    if (m.status !== 'finished' || m.home_score === null || m.away_score === null) continue
    const hs = m.home_score; const as_ = m.away_score
    const home = stats.get(m.home_team_id)!; const away = stats.get(m.away_team_id)!
    home.played++; away.played++
    home.gf += hs; home.ga += as_; home.gd = home.gf - home.ga
    away.gf += as_; away.ga += hs; away.gd = away.gf - away.ga
    if (hs > as_) { home.w++; home.pts += 3; away.l++ }
    else if (hs < as_) { away.w++; away.pts += 3; home.l++ }
    else { home.d++; away.d++; home.pts++; away.pts++ }
  }
  return [...stats.values()].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
}

const POSITIONS = [
  { key: 'Tor',       label: 'Tor' },
  { key: 'Abwehr',    label: 'Abwehr' },
  { key: 'Mittelfeld',label: 'Mittelfeld' },
  { key: 'Angriff',   label: 'Angriff' },
]

function PlayerAvatar({ player, size = 40 }: { player: PlayerRow; size?: number }) {
  const initials = player.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
  if (player.image_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={player.image_url}
        alt={player.name}
        width={size}
        height={size}
        className="rounded-full object-cover flex-shrink-0 bg-gray-100 dark:bg-gray-700"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-bold flex items-center justify-center flex-shrink-0 text-xs"
      style={{ width: size, height: size }}
    >
      {initials}
    </div>
  )
}

export default async function WildenrothTeamPage() {
  const supabase = await createClient()

  const [{ data: rawMatches }, { data: rawPlayers }] = await Promise.all([
    supabase
      .from('matches')
      .select(`id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status,
               home_team:teams!matches_home_team_id_fkey(id, name, short_name),
               away_team:teams!matches_away_team_id_fkey(id, name, short_name)`)
      .gte('match_date', SEASON_START)
      .not('match_category', 'in', '("wildenroth_ii","b-klasse")')
      .order('match_date', { ascending: true }),
    supabase
      .from('wildenroth_players')
      .select('id, name, position, shirt_number, image_url, squad, games, goals, assists, is_goalkeeper, is_penalty_taker, is_freekick_taker')
      .eq('active', true)
      .in('squad', ['1', 'both'])
      .order('name'),
  ])

  const matches: Match[] = (rawMatches ?? []).map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  }))
  const players: PlayerRow[] = (rawPlayers ?? []) as PlayerRow[]

  const standings = computeStandings(matches)
  const wildenrothSt = standings.find((s) => s.teamName.includes('Wildenroth') && !s.teamName.includes('II'))
  const wildenrothPos = wildenrothSt ? standings.findIndex((s) => s.teamId === wildenrothSt.teamId) + 1 : 0
  const hasFinished = matches.some((m) => m.status === 'finished')
  const form = wildenrothSt ? getForm(matches, wildenrothSt.teamId, 5) : []

  const topScorers = [...players]
    .filter((p) => (p.goals ?? 0) > 0)
    .sort((a, b) => (b.goals ?? 0) - (a.goals ?? 0))
    .slice(0, 5)

  const grouped = POSITIONS.map((g) => ({
    ...g,
    list: players
      .filter((p) =>
        g.key === 'Tor'
          ? p.position === 'Tor' || p.position === 'Torwart' || p.is_goalkeeper === true
          : p.position === g.key && p.is_goalkeeper !== true
      )
      .sort((a, b) => (a.shirt_number ?? 99) - (b.shirt_number ?? 99) || a.name.localeCompare(b.name, 'de')),
  })).filter((g) => g.list.length > 0)

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-br from-red-700 to-red-900 text-white rounded-2xl px-5 py-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center flex-shrink-0 shadow">
            <Image src={CREST} alt="SpVgg Wildenroth" width={52} height={52} className="object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-red-200 text-xs font-medium uppercase tracking-wide">1. Mannschaft · Saison 26/27</div>
            <h1 className="text-2xl font-black leading-tight">SpVgg Wildenroth</h1>
            <div className="text-red-100 text-sm mt-1">
              {wildenrothSt && hasFinished
                ? `${wildenrothSt.w} Siege · ${wildenrothSt.d} Unentschieden · ${wildenrothSt.l} Niederlagen · ${wildenrothSt.gf}:${wildenrothSt.ga} Tore`
                : 'Saison noch nicht gestartet'}
            </div>
          </div>
        </div>
      </div>

      {/* Tab link to 2nd team */}
      <Link
        href="/team/wildenroth-ii"
        className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      >
        <span>Zur 2. Mannschaft (B-Klasse)</span>
        <span className="text-gray-400 dark:text-gray-500">›</span>
      </Link>

      {/* Standings & Form */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-gray-100">Tabellenplatz &amp; Form</h2>
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Kreisliga Gruppe 2</div>
        </div>
        {wildenrothSt && hasFinished && wildenrothPos > 0 ? (
          <>
            <div className="grid grid-cols-4 divide-x divide-gray-100 dark:divide-gray-700">
              {[
                { label: 'Platz', value: String(wildenrothPos) },
                { label: 'Punkte', value: String(wildenrothSt.pts) },
                { label: 'Spiele', value: String(wildenrothSt.played) },
                { label: 'Tordiff.', value: wildenrothSt.gd >= 0 ? `+${wildenrothSt.gd}` : String(wildenrothSt.gd) },
              ].map(({ label, value }) => (
                <div key={label} className="px-3 py-3 text-center">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</div>
                  <div className="font-black text-red-700 dark:text-red-400 text-lg">{value}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-700">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Form</span>
              <div className="flex gap-1.5">
                {form.length > 0 ? form.map((r, i) => (
                  <span key={i} className={`w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center ${r === 'W' ? 'bg-green-500' : r === 'D' ? 'bg-gray-400' : 'bg-red-500'}`}>
                    {r === 'W' ? 'S' : r === 'D' ? 'U' : 'N'}
                  </span>
                )) : <span className="text-sm text-gray-400 dark:text-gray-500">–</span>}
              </div>
            </div>
          </>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">Saison noch nicht gestartet</div>
        )}
      </div>

      {/* Top scorers */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-gray-100">Top-Torschützen</h2>
        </div>
        {topScorers.length > 0 ? (
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {topScorers.map((p, idx) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${idx === 0 ? 'bg-yellow-400 text-white' : idx === 1 ? 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200' : idx === 2 ? 'bg-amber-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                  {idx + 1}
                </div>
                <PlayerAvatar player={p} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{p.name}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500">{p.position ?? '—'}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className="text-xl font-black text-red-700 dark:text-red-400">{p.goals ?? 0}</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">Tore</span>
                </div>
                <div className="text-right flex-shrink-0 w-14">
                  <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{p.assists ?? 0}</div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500">Assists</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">Noch keine Torschützen erfasst.</div>
        )}
      </div>

      {/* Squad */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-gray-100">Kader 1. Mannschaft</h2>
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{players.length} Spieler · Saison 26/27</div>
        </div>
        {grouped.length > 0 ? grouped.map((g) => (
          <div key={g.key}>
            <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              {g.label}
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-700">
              {g.list.map((p) => (
                <Link key={p.id} href={`/kader/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  <PlayerAvatar player={p} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5 flex-wrap">
                      {p.shirt_number != null && (
                        <span className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded font-bold w-5 text-center">{p.shirt_number}</span>
                      )}
                      {p.name}
                      {p.squad === 'both' && (
                        <span className="text-[10px] bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded font-bold">I+II</span>
                      )}
                      {p.is_penalty_taker && (
                        <span className="text-[10px] bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-1.5 py-0.5 rounded font-bold">Elfer</span>
                      )}
                      {p.is_freekick_taker && (
                        <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded font-bold">Freistoß</span>
                      )}
                    </div>
                  </div>
                  <div className="text-center flex-shrink-0 w-10">
                    <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{p.games ?? 0}</div>
                    <div className="text-[10px] text-gray-400 dark:text-gray-500">Spiele</div>
                  </div>
                  <div className="text-center flex-shrink-0 w-10">
                    <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{p.goals ?? 0}</div>
                    <div className="text-[10px] text-gray-400 dark:text-gray-500">Tore</div>
                  </div>
                  <div className="text-center flex-shrink-0 w-10">
                    <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{p.assists ?? 0}</div>
                    <div className="text-[10px] text-gray-400 dark:text-gray-500">Assists</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )) : (
          <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">Keine aktiven Spieler erfasst.</div>
        )}
      </div>
    </div>
  )
}
