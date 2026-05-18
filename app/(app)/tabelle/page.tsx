import { createClient } from '@/lib/supabase/server'
import type { Match } from '@/types'
import { getForm } from '@/lib/odds'

function shortTeamName(name: string): string {
  // Strip common club prefixes only at the START of the name
  return name.replace(/^(SpVgg|SpFr|TSV|FC|SV|VfL|1\.\s*SC|SC)\s+/i, '').trim()
}

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
  // Build H2H mini-table within tied group
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
    // 1. H2H points
    if (bh.pts !== ah.pts) return bh.pts - ah.pts
    // 2. H2H goal difference
    const agd = ah.gf - ah.ga; const bgd = bh.gf - bh.ga
    if (bgd !== agd) return bgd - agd
    // 3. H2H away goals
    if (bh.awayGF !== ah.awayGF) return bh.awayGF - ah.awayGF
    // 4. Overall goal difference
    if (b.gd !== a.gd) return b.gd - a.gd
    // 5. Overall goals scored
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

  // Sort by pts first, then apply BFV tiebreaker within tied groups
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

export default async function TabellePage() {
  const supabase = await createClient()

  const { data: rawMatches } = await supabase
    .from('matches')
    .select(
      `id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status,
       home_team:teams!matches_home_team_id_fkey(id, name, short_name),
       away_team:teams!matches_away_team_id_fkey(id, name, short_name)`
    )
    .order('match_date', { ascending: true })

  const allRaw: Match[] = (rawMatches ?? []).map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  }))

  // Only current season matches for standings and form
  const matches = allRaw.filter((m) => m.match_date >= '2025-08-01')

  const standings = computeStandings(matches)
  const wildenrothPos = standings.findIndex((s) => s.teamName.includes('Wildenroth')) + 1
  const playedMatchdays = Math.max(
    ...matches.filter((m) => m.status === 'finished').map((m) => m.matchday),
    0
  )

  // Top scorers (goals per game) - derived from team averages
  const topAttacks = [...standings]
    .sort((a, b) => b.gf - a.gf)
    .slice(0, 5)

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Header */}
      <div className="bg-red-700 text-white rounded-2xl px-5 py-4 shadow-sm">
        <div className="text-red-200 text-xs font-medium uppercase tracking-wide">Saison 25/26</div>
        <div className="text-2xl font-black mt-0.5">Tabelle</div>
        <div className="text-red-200 text-sm mt-1">
          Kreisklasse Gruppe 1 · {playedMatchdays}. Spieltag gespielt
        </div>
        {wildenrothPos > 0 && (
          <div className="mt-3 bg-red-800/60 rounded-xl px-3 py-2 text-sm">
            SpVgg Wildenroth: <span className="font-bold text-white">Platz {wildenrothPos}</span>
          </div>
        )}
      </div>

      {/* Standings Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">Tabellenstand</h2>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto_auto] gap-x-2 px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">
          <div className="w-6 text-center">#</div>
          <div>Verein</div>
          <div className="w-6 text-center">Sp</div>
          <div className="w-6 text-center hidden sm:block">S</div>
          <div className="w-6 text-center hidden sm:block">U</div>
          <div className="w-6 text-center hidden sm:block">N</div>
          <div className="w-12 text-center">Tore</div>
          <div className="w-8 text-center font-bold text-gray-700">P</div>
        </div>

        {/* Rows */}
        {standings.map((s, idx) => {
          const pos = idx + 1
          const total = standings.length
          const isWildenroth = s.teamName.includes('Wildenroth')
          // Zones for 14-team Kreisklasse:
          // Platz 1: Aufstieg direkt, Platz 2: Aufstieg Relegation
          // Platz 11-12: Abstieg Relegation, Platz 13-14: Direktabstieg
          const isPromotion = pos === 1
          const isPromotionPlayoff = pos === 2
          const isDirect = total >= 14 && pos >= total - 1         // 13-14
          const isPlayoff = total >= 14 && pos >= total - 3 && pos <= total - 2  // 11-12
          return (
            <div
              key={s.teamId}
              className={`grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto_auto] gap-x-2 px-3 py-2.5 items-center border-b border-gray-50 last:border-0 ${
                isWildenroth ? 'bg-red-50' : ''
              }`}
            >
              {/* Position */}
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                isPromotion
                  ? 'bg-green-600 text-white'
                  : isPromotionPlayoff
                  ? 'bg-green-200 text-green-800'
                  : isDirect
                  ? 'bg-red-500 text-white'
                  : isPlayoff
                  ? 'bg-orange-200 text-orange-700'
                  : 'text-gray-400'
              }`}>
                {pos}
              </div>

              {/* Team */}
              <div>
                <div className={`text-sm font-semibold leading-tight ${isWildenroth ? 'text-red-700' : 'text-gray-900'}`}>
                  {shortTeamName(s.teamName)}
                  {isWildenroth && <span className="ml-1 text-xs text-red-400">⚽</span>}
                </div>
                {/* Form */}
                <div className="flex gap-0.5 mt-0.5">
                  {s.form.map((r, i) => (
                    <span
                      key={i}
                      className={`w-3.5 h-3.5 rounded-sm text-white text-[8px] font-bold flex items-center justify-center ${
                        r === 'W' ? 'bg-green-500' : r === 'D' ? 'bg-yellow-400' : 'bg-red-400'
                      }`}
                    >
                      {r === 'W' ? 'S' : r === 'D' ? 'U' : 'N'}
                    </span>
                  ))}
                </div>
              </div>

              {/* Played */}
              <div className="w-6 text-center text-xs text-gray-500">{s.played}</div>

              {/* W */}
              <div className="w-6 text-center text-xs text-green-600 font-semibold hidden sm:block">{s.w}</div>

              {/* D */}
              <div className="w-6 text-center text-xs text-yellow-600 font-semibold hidden sm:block">{s.d}</div>

              {/* L */}
              <div className="w-6 text-center text-xs text-red-500 font-semibold hidden sm:block">{s.l}</div>

              {/* Goals */}
              <div className="w-12 text-center text-xs text-gray-600">
                {s.gf}:{s.ga}
              </div>

              {/* Points */}
              <div className={`w-8 text-center text-sm font-black ${isWildenroth ? 'text-red-700' : 'text-gray-900'}`}>
                {s.pts}
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3">
        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-full bg-green-600" />
            <span>Aufstieg (Platz 1)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-full bg-green-200" />
            <span>Aufstiegsrelegation (Platz 2)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-full bg-orange-200" />
            <span>Abstiegsrelegation (Platz 11–12)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-full bg-red-500" />
            <span>Direktabstieg (Platz 13–14)</span>
          </div>
        </div>
      </div>

      {/* Team Stats Cards */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">Beste Angriffe</h2>
        </div>
        <div className="divide-y divide-gray-50">
          {topAttacks.map((s, i) => (
            <div key={s.teamId} className="flex items-center px-4 py-2.5 gap-3">
              <div className="text-sm font-bold text-gray-300 w-4">{i + 1}</div>
              <div className="flex-1 text-sm font-medium text-gray-800">
                {shortTeamName(s.teamName)}
              </div>
              <div className="text-sm font-bold text-gray-900">{s.gf}</div>
              <div className="text-xs text-gray-400">Tore</div>
            </div>
          ))}
        </div>
      </div>

      {/* All team stats */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">Teamstatistiken</h2>
          <div className="text-xs text-gray-400 mt-0.5">Alle {standings.length} Vereine</div>
        </div>
        <div className="divide-y divide-gray-50">
          {standings.map((s) => (
            <div key={s.teamId} className={`px-4 py-3 ${s.teamName.includes('Wildenroth') ? 'bg-red-50' : ''}`}>
              <div className={`font-semibold text-sm mb-2 ${s.teamName.includes('Wildenroth') ? 'text-red-700' : 'text-gray-800'}`}>
                {s.teamName}
              </div>
              <div className="grid grid-cols-6 gap-1 text-center text-xs">
                <StatCell label="Punkte" value={String(s.pts)} highlight={s.teamName.includes('Wildenroth')} />
                <StatCell label="Siege" value={String(s.w)} />
                <StatCell label="Unent." value={String(s.d)} />
                <StatCell label="Niederl." value={String(s.l)} />
                <StatCell label="Tordiff." value={s.gd >= 0 ? `+${s.gd}` : String(s.gd)} />
                <StatCell label="P/Spiel" value={s.ppg.toFixed(2)} />
              </div>
            </div>
          ))}
        </div>
      </div>
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
