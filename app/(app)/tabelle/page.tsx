import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Match } from '@/types'
import { getForm } from '@/lib/odds'
import { TeamLogo } from '@/components/TeamLogo'

export const revalidate = 60

interface Standing {
  teamId: number
  teamName: string
  played: number
  w: number
  d: number
  l: number
  gf: number
  ga: number
  gd: number
  pts: number
  ppg: number
  form: ('W' | 'D' | 'L')[]
}

function sortByBFV(group: Standing[], matches: Match[]): Standing[] {
  const groupIds = new Set(group.map((s) => s.teamId))
  const h2hMatches = matches.filter(
    (m) =>
      m.status === 'finished' &&
      groupIds.has(m.home_team_id) &&
      groupIds.has(m.away_team_id)
  )
  type H2H = { pts: number; gf: number; ga: number; awayGF: number }
  const h2h = new Map<number, H2H>()
  for (const s of group) h2h.set(s.teamId, { pts: 0, gf: 0, ga: 0, awayGF: 0 })

  for (const m of h2hMatches) {
    const hs = m.home_score ?? 0; const as_ = m.away_score ?? 0
    const home = h2h.get(m.home_team_id)!
    const away = h2h.get(m.away_team_id)!
    home.gf += hs; home.ga += as_
    away.gf += as_; away.ga += hs
    away.awayGF += as_
    if (hs > as_) home.pts += 3
    else if (hs === as_) { home.pts++; away.pts++ }
    else away.pts += 3
  }

  return [...group].sort((a, b) => {
    const ah = h2h.get(a.teamId)!; const bh = h2h.get(b.teamId)!
    if (bh.pts !== ah.pts) return bh.pts - ah.pts
    const agd = ah.gf - ah.ga; const bgd = bh.gf - bh.ga
    if (bgd !== agd) return bgd - agd
    if (bh.awayGF !== ah.awayGF) return bh.awayGF - ah.awayGF
    if (b.gd !== a.gd) return b.gd - a.gd
    return b.gf - a.gf
  })
}

function computeStandings(matches: Match[]): Standing[] {
  const teamMap = new Map<number, { name: string }>()
  for (const m of matches) {
    if (m.home_team) teamMap.set(m.home_team_id, { name: m.home_team.name })
    if (m.away_team) teamMap.set(m.away_team_id, { name: m.away_team.name })
  }

  const stats = new Map<number, Omit<Standing, 'teamName' | 'ppg' | 'form'>>()
  for (const [id] of teamMap) {
    stats.set(id, { teamId: id, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 })
  }

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

  const rows: Standing[] = [...stats.values()].map((s) => ({
    ...s,
    teamName: teamMap.get(s.teamId)?.name ?? `Team ${s.teamId}`,
    ppg: s.played > 0 ? Math.round((s.pts / s.played) * 100) / 100 : 0,
    form: getForm(matches, s.teamId, 5),
  }))

  rows.sort((a, b) => b.pts - a.pts)
  const result: Standing[] = []
  let i = 0
  while (i < rows.length) {
    let j = i + 1
    while (j < rows.length && rows[j].pts === rows[i].pts) j++
    const group = rows.slice(i, j)
    result.push(...(group.length > 1 ? sortByBFV(group, matches) : group))
    i = j
  }
  return result
}

interface PriorStanding {
  team: string
  leagueName: string
  leagueLevel: string
  pos: number
  totalTeams: number
  games: number
  pts: number
  gf: number
  ga: number
  gd: number
}

const LEAGUE_LEVEL_ORDER: Record<string, number> = { bezirksliga: 0, kreisliga: 1, kreisklasse: 2 }

function leagueShort(leagueName: string): string {
  if (leagueName.includes('Bezirksliga')) return 'Bezirksliga'
  const m = leagueName.match(/Gruppe\s+(\d+|[A-Z])/i)
  if (leagueName.includes('Kreisliga')) return `Kreisliga ${m?.[1] ?? ''}`
  if (leagueName.includes('Kreisklasse')) return `Kreisklasse ${m?.[1] ?? ''}`
  return leagueName
}

async function getPriorStandings(supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>): Promise<PriorStanding[]> {
  const { data } = await supabase.rpc('get_prior_standings' as never)
  if (data) return data as PriorStanding[]

  const { data: rows } = await supabase.from('prior_season_matches').select('home_team,away_team,home_score,away_score,league_name,league_level,league_number')
  if (!rows) return []

  type TeamKey = string
  const stats = new Map<TeamKey, { team: string; leagueName: string; leagueLevel: string; leagueNumber: string; pts: number; gf: number; ga: number; games: number }>()

  for (const r of rows) {
    const homeTeam = PRIOR_NAME_MAP[r.home_team] ?? r.home_team
    const awayTeam = PRIOR_NAME_MAP[r.away_team] ?? r.away_team
    const hn = `${homeTeam}::${r.league_number}`
    const an = `${awayTeam}::${r.league_number}`
    if (!stats.has(hn)) stats.set(hn, { team: homeTeam, leagueName: r.league_name, leagueLevel: r.league_level, leagueNumber: r.league_number, pts: 0, gf: 0, ga: 0, games: 0 })
    if (!stats.has(an)) stats.set(an, { team: awayTeam, leagueName: r.league_name, leagueLevel: r.league_level, leagueNumber: r.league_number, pts: 0, gf: 0, ga: 0, games: 0 })
    const h = stats.get(hn)!; const a = stats.get(an)!
    const hs = r.home_score ?? 0; const as_ = r.away_score ?? 0
    h.gf += hs; h.ga += as_; h.games++
    a.gf += as_; a.ga += hs; a.games++
    if (hs > as_) { h.pts += 3 } else if (hs === as_) { h.pts++; a.pts++ } else { a.pts += 3 }
  }

  const byLeague = new Map<string, typeof stats extends Map<string, infer V> ? V[] : never>()
  for (const [, v] of stats) {
    const arr = byLeague.get(v.leagueNumber) ?? []
    arr.push(v as never)
    byLeague.set(v.leagueNumber, arr as never)
  }

  const result: PriorStanding[] = []
  for (const [, teams] of byLeague) {
    const sorted = [...teams].sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf)
    sorted.forEach((t, i) => {
      result.push({ team: t.team, leagueName: t.leagueName, leagueLevel: t.leagueLevel, pos: i + 1, totalTeams: sorted.length, games: t.games, pts: t.pts, gf: t.gf, ga: t.ga, gd: t.gf - t.ga })
    })
  }
  return result
}

// Kreisliga teams (1. Mannschaft)
const OUR_TEAMS = new Set(['TSV Geiselbullach','SpVgg Wildenroth','SC Schöngeising','TSV Altenstadt','TSV Peiting','FC Wildsteig/Rottenbuch','SC Unterpfaffenhofen','SV Fuchstal','TSV 1882 Landsberg II','FC Aich','SC Oberweikertshofen II','TSV Türkenfeld','SV Igling','FC Issing','VfL Denklingen','TSV Oberalting-Seefeld'])

// B-Klasse teams (2. Mannschaft) — IDs 29–40
const BKLASSE_TEAM_NAMES = ['SV Adelshofen II','SV Germering III','VSST Günzelhofen','TSV Herrsching II','SV Kottgeisering','FC Landsberied II','SV Mammendorf','TSV Moorenweis II','SC Schöngeising II','TV Stockdorf II','TSV Türkenfeld II','SpVgg Wildenroth II']
const BKLASSE_TEAM_IDS = new Set([29,30,31,32,33,34,35,36,37,38,39,40])

const PRIOR_NAME_MAP: Record<string, string> = { 'TSV Oberalting': 'TSV Oberalting-Seefeld' }

export default async function TabellePage({
  searchParams,
}: {
  searchParams: Promise<{ liga?: string }>
}) {
  const { liga } = await searchParams
  const isB = liga === 'b-klasse'

  const supabase = await createClient()

  const { data: rawMatches } = await supabase
    .from('matches')
    .select(
      `id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status, match_category,
       home_team:teams!matches_home_team_id_fkey(id, name, short_name),
       away_team:teams!matches_away_team_id_fkey(id, name, short_name)`
    )
    .gte('match_date', '2026-08-01')
    .order('match_date', { ascending: true })

  const allMatches: Match[] = (rawMatches ?? []).map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  }))

  // Split matches by liga
  const kreisligaMatches = allMatches.filter(
    (m) => !m.match_category || m.match_category === 'kreisliga' || m.match_category === 'bklasse_topspiel'
  )
  const bklasseMatches = allMatches.filter(
    (m) => m.match_category === 'b-klasse' || m.match_category === 'wildenroth_ii'
  )

  const activeMatches = isB ? bklasseMatches : kreisligaMatches

  const computedStandings = computeStandings(activeMatches)

  const fallbackTeams = isB
    ? BKLASSE_TEAM_NAMES.sort((a, b) => a.localeCompare(b, 'de'))
    : [...OUR_TEAMS].sort((a, b) => a.localeCompare(b, 'de'))

  const standings: Standing[] = computedStandings.length > 0
    ? computedStandings
    : fallbackTeams.map((name, idx) => ({
        teamId: -(idx + 1),
        teamName: name,
        played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, ppg: 0, form: [],
      }))

  const wildenrothPos = standings.findIndex((s) => s.teamName.includes('Wildenroth')) + 1
  const wildenrothName = isB ? 'SpVgg Wildenroth II' : 'SpVgg Wildenroth'

  const playedMatchdays = Math.max(
    ...activeMatches.filter((m) => m.status === 'finished').map((m) => m.matchday),
    0
  )

  const priorStandings = (!isB && playedMatchdays === 0) ? await getPriorStandings(supabase) : []
  const ourPriorStandings = priorStandings
    .filter(s => OUR_TEAMS.has(s.team))
    .sort((a, b) => (LEAGUE_LEVEL_ORDER[a.leagueLevel] ?? 9) - (LEAGUE_LEVEL_ORDER[b.leagueLevel] ?? 9) || b.pts - a.pts)

  const topAttacks = [...standings].sort((a, b) => b.gf - a.gf).slice(0, 5)

  // Position badge logic
  function getPositionStyle(pos: number, total: number, bklasse: boolean) {
    if (bklasse) {
      if (pos === 1) return 'bg-green-600 text-white'        // Direktaufstieg
      if (pos === total) return 'bg-red-500 text-white'      // Direktabstieg
      return 'text-gray-400'
    }
    if (pos === 1) return 'bg-green-600 text-white'
    if (pos === 2) return 'bg-green-200 text-green-800'
    if (total >= 16 && pos >= total - 1) return 'bg-red-500 text-white'
    if (total >= 16 && pos >= total - 3 && pos <= total - 2) return 'bg-orange-200 text-orange-700'
    return 'text-gray-400'
  }

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Header */}
      <div className="bg-red-700 text-white rounded-2xl px-5 py-4 shadow-sm">
        <div className="text-red-200 text-xs font-medium uppercase tracking-wide">Saison 26/27</div>
        <div className="text-2xl font-black mt-0.5">Tabelle</div>
        <div className="text-red-200 text-sm mt-1">
          {isB ? 'B-Klasse 2' : 'Kreisliga Gruppe 2'} · {playedMatchdays}. Spieltag gespielt
        </div>
        {wildenrothPos > 0 && (
          <div className="mt-3 bg-red-800/60 rounded-xl px-3 py-2 text-sm">
            {wildenrothName}: <span className="font-bold text-white">Platz {wildenrothPos}</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <Link
          href="/tabelle"
          className={`flex-1 text-center py-2.5 rounded-xl text-sm font-semibold transition-colors ${
            !isB
              ? 'bg-red-700 text-white shadow-sm'
              : 'bg-white text-gray-500 border border-gray-200'
          }`}
        >
          1. Mannschaft
        </Link>
        <Link
          href="/tabelle?liga=b-klasse"
          className={`flex-1 text-center py-2.5 rounded-xl text-sm font-semibold transition-colors ${
            isB
              ? 'bg-red-700 text-white shadow-sm'
              : 'bg-white text-gray-500 border border-gray-200'
          }`}
        >
          2. Mannschaft
        </Link>
      </div>

      {/* Standings Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">Tabellenstand</h2>
        </div>

        <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-2 px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">
          <div className="w-6 text-center">#</div>
          <div>Verein</div>
          <div className="w-7 text-center">Sp.</div>
          <div className="w-10 text-center">Tore</div>
          <div className="w-8 text-center font-bold text-gray-700">Pkt.</div>
        </div>

        {standings.map((s, idx) => {
          const pos = idx + 1
          const total = standings.length
          const isWildenroth = s.teamName.includes('Wildenroth')
          const badgeStyle = getPositionStyle(pos, total, isB)
          return (
            <div
              key={s.teamId}
              className={`grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-2 px-3 py-2.5 items-center border-b border-gray-50 last:border-0 ${
                isWildenroth ? 'bg-red-50' : ''
              }`}
            >
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${badgeStyle}`}>
                {pos}
              </div>

              {isWildenroth ? (
                <Link href={isB ? '/team/wildenroth-ii' : '/team/wildenroth'} className="flex items-center gap-1.5 min-w-0 group">
                  <TeamLogo name={s.teamName} size="xs" className="flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-tight truncate text-red-700 group-hover:underline">
                      {s.teamName}
                      <span className="ml-1 text-xs text-red-400">⚽</span>
                      <span className="ml-1 text-xs text-red-400">›</span>
                    </div>
                    <div className="flex gap-0.5 mt-0.5">
                      {s.form.map((r, i) => (
                        <span key={i} className={`w-3.5 h-3.5 rounded-sm text-white text-[8px] font-bold flex items-center justify-center ${
                          r === 'W' ? 'bg-green-500' : r === 'D' ? 'bg-yellow-400' : 'bg-red-400'
                        }`}>
                          {r === 'W' ? 'S' : r === 'D' ? 'U' : 'N'}
                        </span>
                      ))}
                    </div>
                  </div>
                </Link>
              ) : (
                <div className="flex items-center gap-1.5 min-w-0">
                  <TeamLogo name={s.teamName} size="xs" className="flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-tight truncate text-gray-900">
                      {s.teamName}
                    </div>
                    <div className="flex gap-0.5 mt-0.5">
                      {s.form.map((r, i) => (
                        <span key={i} className={`w-3.5 h-3.5 rounded-sm text-white text-[8px] font-bold flex items-center justify-center ${
                          r === 'W' ? 'bg-green-500' : r === 'D' ? 'bg-yellow-400' : 'bg-red-400'
                        }`}>
                          {r === 'W' ? 'S' : r === 'D' ? 'U' : 'N'}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="w-7 text-center text-xs text-gray-500">{s.played}</div>
              <div className="w-10 text-center text-xs text-gray-600">{s.gf}:{s.ga}</div>
              <div className={`w-8 text-center text-sm font-black ${isWildenroth ? 'text-red-700' : 'text-gray-900'}`}>{s.pts}</div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3">
        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-full bg-green-600" />
            <span>Direktaufstieg (Platz 1)</span>
          </div>
          {!isB && (
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded-full bg-green-200" />
              <span>Aufstiegsrelegation (Platz 2)</span>
            </div>
          )}
          {!isB && (
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded-full bg-orange-200" />
              <span>Abstiegsrelegation (Platz 13–14)</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-full bg-red-500" />
            <span>Direktabstieg ({isB ? `Platz ${standings.length}` : 'Platz 15–16'})</span>
          </div>
        </div>
      </div>

      {/* Team Stats */}
      {!isB && playedMatchdays === 0 && ourPriorStandings.length > 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="font-bold text-gray-900">Teamstatistiken</h2>
            <div className="text-xs text-gray-400 mt-0.5">Abschneiden Saison 25/26 · geordnet nach Ligaebene</div>
          </div>
          <div className="divide-y divide-gray-50">
            {ourPriorStandings.map((s, idx) => {
              const isWildenroth = s.team.includes('Wildenroth')
              const levelColor = s.leagueLevel === 'bezirksliga' ? 'bg-purple-100 text-purple-700' : s.leagueLevel === 'kreisliga' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
              return (
                <div key={s.team} className={`px-4 py-3 ${isWildenroth ? 'bg-red-50' : ''}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-bold text-gray-400 w-5">{idx + 1}.</span>
                    <TeamLogo name={s.team} size="sm" className="flex-shrink-0" />
                    <span className={`text-sm font-semibold flex-1 min-w-0 truncate ${isWildenroth ? 'text-red-700' : 'text-gray-800'}`}>
                      {s.team}{isWildenroth && <span className="ml-1 text-xs text-red-400">⚽</span>}
                    </span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${levelColor}`}>
                      Pl. {s.pos} · {leagueShort(s.leagueName)}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-center text-xs ml-7">
                    <StatCell label="Punkte" value={String(s.pts)} highlight={isWildenroth} />
                    <StatCell label="Spiele" value={String(s.games)} />
                    <StatCell label="Tore" value={`${s.gf}:${s.ga}`} />
                    <StatCell label="Diff." value={s.gd >= 0 ? `+${s.gd}` : String(s.gd)} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <>
          {topAttacks.length > 0 && topAttacks.some(t => t.gf > 0) && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="font-bold text-gray-900">Beste Angriffe</h2>
              </div>
              <div className="divide-y divide-gray-50">
                {topAttacks.map((s, i) => (
                  <div key={s.teamId} className="flex items-center px-4 py-2.5 gap-2">
                    <div className="text-sm font-bold text-gray-300 w-4">{i + 1}</div>
                    <TeamLogo name={s.teamName} size="sm" className="flex-shrink-0" />
                    <div className="flex-1 text-sm font-medium text-gray-800 truncate">{s.teamName}</div>
                    <div className="text-sm font-bold text-gray-900">{s.gf}</div>
                    <div className="text-xs text-gray-400">Tore</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">Teamstatistiken</h2>
              <div className="text-xs text-gray-400 mt-0.5">
                {isB ? 'B-Klasse 2 · ' : 'Kreisliga Gruppe 2 · '}Alle {standings.length} Vereine
              </div>
            </div>
            <div className="divide-y divide-gray-50">
              {standings.map((s) => {
                const isW = s.teamName.includes('Wildenroth')
                return (
                  <div key={s.teamId} className={`px-4 py-3 ${isW ? 'bg-red-50' : ''}`}>
                    <div className={`flex items-center gap-2 font-semibold text-sm mb-2 ${isW ? 'text-red-700' : 'text-gray-800'}`}>
                      <TeamLogo name={s.teamName} size="sm" className="flex-shrink-0" />
                      {s.teamName}
                    </div>
                    <div className="grid grid-cols-6 gap-1 text-center text-xs">
                      <StatCell label="Punkte" value={String(s.pts)} highlight={isW} />
                      <StatCell label="Siege" value={String(s.w)} />
                      <StatCell label="Unent." value={String(s.d)} />
                      <StatCell label="Niederl." value={String(s.l)} />
                      <StatCell label="Tordiff." value={s.gd >= 0 ? `+${s.gd}` : String(s.gd)} />
                      <StatCell label="P/Spiel" value={s.ppg.toFixed(2)} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function StatCell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-gray-50 rounded-lg py-1.5">
      <div className={`font-bold text-sm ${highlight ? 'text-red-700' : 'text-gray-900'}`}>{value}</div>
      <div className="text-gray-400 text-[10px] leading-tight mt-0.5">{label}</div>
    </div>
  )
}
