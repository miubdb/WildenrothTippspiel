import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Match } from '@/types'
import { getForm } from '@/lib/odds'
import { computeTeamRoster, teamRosterHighlights, type TeamRosterEntry } from '@/lib/leagueStats'

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
  prev_goals: number | null
  prev_assists: number | null
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

function PlayerAvatar({ player, size = 36 }: { player: PlayerRow; size?: number }) {
  const initials = player.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
  if (player.image_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={player.image_url}
        alt={player.name}
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

export default async function WildenrothIITeamPage() {
  const supabase = await createClient()

  // Kader list hidden for everyone (including admins) ahead of go-live — same
  // as the 1st-team page. Squad data, /kader/[id] pages and admin tooling
  // stay fully intact, this only gates rendering.
  const showSquad = false

  const [{ data: rawPlayers }, { data: rawMatches }] = await Promise.all([
    supabase
      .from('wildenroth_players')
      .select('id, name, position, shirt_number, image_url, squad, games, goals, assists, prev_goals, prev_assists, is_goalkeeper, is_penalty_taker, is_freekick_taker')
      .eq('active', true)
      .in('squad', ['2', 'both'])
      .order('name'),
    supabase
      .from('matches')
      .select(`id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status,
               home_team:teams!matches_home_team_id_fkey(id, name, short_name),
               away_team:teams!matches_away_team_id_fkey(id, name, short_name)`)
      .gte('match_date', SEASON_START)
      .in('match_category', ['wildenroth_ii', 'b-klasse'])
      .order('match_date', { ascending: true }),
  ])

  const players: PlayerRow[] = (rawPlayers ?? []) as PlayerRow[]

  // Zentrale Kader-Statistik-Schicht (lib/leagueStats.ts) — dieselbe
  // Funktion wie auf jeder anderen Vereinsseite, mit Kategorie explizit
  // auf die Kategorien der 2. Mannschaft gesetzt (aktuell 0 erfasste
  // Aufstellungszeilen für wildenroth_ii/b-klasse, siehe Modulkommentar in
  // lib/leagueStats.ts — die Sektion bleibt entsprechend leer, bis
  // Aufstellungsdaten für diese Kategorien erfasst werden).
  const roster = await computeTeamRoster(supabase, 'SpVgg Wildenroth II', ['wildenroth_ii', 'b-klasse'])
  const rosterHighlights = teamRosterHighlights(roster)
  const playersByName = new Map(players.map((p) => [p.name, p]))

  const matches: Match[] = (rawMatches ?? []).map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  }))

  const standings = computeStandings(matches)
  const wildenrothSt = standings.find((s) => s.teamName.includes('Wildenroth'))
  const wildenrothPos = wildenrothSt ? standings.findIndex((s) => s.teamId === wildenrothSt.teamId) + 1 : 0
  const hasFinished = matches.some((m) => m.status === 'finished')
  const form = wildenrothSt ? getForm(matches, wildenrothSt.teamId, 5) : []

  // No B-Klasse 25/26 results exist in prior_season_matches (verified), so
  // unlike the 1st-team page there is no prior-season fallback to show here —
  // just an honest "not started yet" until real 26/27 results exist.
  const hasCurrentGoals = players.some((p) => (p.goals ?? 0) > 0)
  const topScorers = hasCurrentGoals
    ? [...players].filter((p) => (p.goals ?? 0) > 0).sort((a, b) => (b.goals ?? 0) - (a.goals ?? 0)).slice(0, 5)
    : [...players].filter((p) => (p.prev_goals ?? 0) > 0).sort((a, b) => (b.prev_goals ?? 0) - (a.prev_goals ?? 0)).slice(0, 5)

  // Positionsgruppierung wie bei der 1. Mannschaft: bevorzugt
  // match_lineups.position (aktuell nirgends befüllt), fällt auf
  // wildenroth_players.position zurück.
  function resolvedPosition(r: TeamRosterEntry): string | null {
    if (r.position) return r.position
    const wp = playersByName.get(r.playerName)
    if (!wp) return null
    if (wp.is_goalkeeper) return 'Tor'
    return wp.position ?? null
  }
  const grouped = POSITIONS.map((g) => ({
    ...g,
    list: roster
      .filter((r) => {
        const pos = resolvedPosition(r)
        return g.key === 'Tor' ? pos === 'Tor' || pos === 'Torwart' : pos === g.key
      })
      .sort((a, b) => (playersByName.get(a.playerName)?.shirt_number ?? 99) - (playersByName.get(b.playerName)?.shirt_number ?? 99) || a.playerName.localeCompare(b.playerName, 'de')),
  })).filter((g) => g.list.length > 0)
  const ungroupedRoster = roster
    .filter((r) => !resolvedPosition(r))
    .sort((a, b) => b.minutes - a.minutes || a.playerName.localeCompare(b.playerName, 'de'))

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-br from-red-700 to-red-900 text-white rounded-2xl px-5 py-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center flex-shrink-0 shadow">
            <Image src={CREST} alt="SpVgg Wildenroth" width={52} height={52} className="object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-red-200 text-xs font-medium uppercase tracking-wide">2. Mannschaft · Saison 26/27</div>
            <h1 className="text-2xl font-black leading-tight">SpVgg Wildenroth II</h1>
            <div className="text-red-100 text-sm mt-1">B-Klasse 2</div>
          </div>
        </div>
      </div>

      {/* Tab link to 1st team */}
      <Link
        href="/team/wildenroth"
        className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      >
        <span>Zur 1. Mannschaft (Kreisliga)</span>
        <span className="text-gray-400 dark:text-gray-500">›</span>
      </Link>

      {/* Standings & Form */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-gray-100">Tabellenplatz &amp; Form</h2>
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">B-Klasse 2</div>
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
      {topScorers.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <h2 className="font-bold text-gray-900 dark:text-gray-100">Top-Torschützen</h2>
            {!hasCurrentGoals && (
              <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Vorsaison 25/26</div>
            )}
          </div>
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
                  <span className="text-xl font-black text-red-700 dark:text-red-400">{hasCurrentGoals ? (p.goals ?? 0) : (p.prev_goals ?? 0)}</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">Tore</span>
                </div>
                <div className="text-right flex-shrink-0 w-14">
                  <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{hasCurrentGoals ? (p.assists ?? 0) : (p.prev_assists ?? 0)}</div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500">Assists</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Kader-Highlights aus derselben Statistik-Schicht wie jede andere
          Vereinsseite (lib/leagueStats.ts#teamRosterHighlights) — bleibt
          leer, bis Aufstellungsdaten für wildenroth_ii/b-klasse existieren. */}
      {(rosterHighlights.ironMan || rosterHighlights.cardKing) && (
        <div className="grid grid-cols-2 gap-2">
          {rosterHighlights.ironMan && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm px-3 py-3">
              <div className="flex items-center gap-1.5 mb-1"><span className="text-base">⏱</span><span className="text-[11px] text-gray-500 dark:text-gray-400">Dauerbrenner (Saison 26/27)</span></div>
              <div className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{rosterHighlights.ironMan.playerName}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{rosterHighlights.ironMan.minutes} Min.</div>
            </div>
          )}
          {rosterHighlights.cardKing && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm px-3 py-3">
              <div className="flex items-center gap-1.5 mb-1"><span className="text-base">🟨</span><span className="text-[11px] text-gray-500 dark:text-gray-400">Kartenkönig (Saison 26/27)</span></div>
              <div className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{rosterHighlights.cardKing.playerName}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{rosterHighlights.cardKing.yellowCards} Gelb{rosterHighlights.cardKing.redCards > 0 ? ` · ${rosterHighlights.cardKing.redCards} Rot` : ''}</div>
            </div>
          )}
        </div>
      )}

      {/* Squad — hidden for everyone ahead of go-live, see showSquad above.
          Aus lib/leagueStats.ts#computeTeamRoster (dieselbe Quelle wie jede
          andere Vereinsseite) — wildenroth_players liefert hier nur noch die
          Zusatz-Anzeige (Bild, Trikotnummer, Position, I+II-Kennzeichnung). */}
      {showSquad && (
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-gray-100">Kader 2. Mannschaft</h2>
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{roster.length} Spieler aus erfassten Aufstellungen · Saison 26/27</div>
        </div>
        {roster.length > 0 ? (
          <>
            {grouped.map((g) => (
              <div key={g.key}>
                <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  {g.label}
                </div>
                <div className="divide-y divide-gray-50 dark:divide-gray-700">
                  {g.list.map((r) => <RosterRow key={r.playerName} entry={r} wp={playersByName.get(r.playerName) ?? null} />)}
                </div>
              </div>
            ))}
            {ungroupedRoster.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Ohne Positionsdaten
                </div>
                <div className="divide-y divide-gray-50 dark:divide-gray-700">
                  {ungroupedRoster.map((r) => <RosterRow key={r.playerName} entry={r} wp={playersByName.get(r.playerName) ?? null} />)}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">Für diesen Verein liegen noch keine Aufstellungsdaten vor.</div>
        )}
      </div>
      )}
    </div>
  )
}

function RosterRow({ entry: r, wp }: { entry: TeamRosterEntry; wp: PlayerRow | null }) {
  const inner = (
    <>
      {wp
        ? <PlayerAvatar player={wp} size={36} />
        : <div className="rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-bold flex items-center justify-center flex-shrink-0 text-xs" style={{ width: 36, height: 36 }}>
            {r.playerName.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
          </div>}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5 flex-wrap">
          {wp?.shirt_number != null && (
            <span className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded font-bold w-5 text-center">{wp.shirt_number}</span>
          )}
          {r.playerName}
          {wp?.squad === 'both' && (
            <span className="text-[10px] bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded font-bold">I+II</span>
          )}
        </div>
        {(r.starterRate != null || r.scorerPer90 != null) && (
          <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
            {r.starterRate != null && <span>Startelfquote {r.starterRate}%</span>}
            {r.goalsPer90 != null && <span className="ml-2">Tore/90: {r.goalsPer90.toFixed(2).replace('.', ',')}</span>}
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 grid-rows-2 gap-1 flex-shrink-0 text-center text-[10px] w-24">
        <MiniStat label="Sp." value={r.appearances} />
        <MiniStat label="Min." value={r.minutes} />
        <MiniStat label="Tore" value={r.goals} highlight={r.goals > 0} />
        <MiniStat label="Vorl." value={r.assists} highlight={r.assists > 0} />
        <MiniStat label="🟨" value={r.yellowCards} />
        <MiniStat label="🟥" value={r.redCards} />
      </div>
    </>
  )
  const className = 'flex items-center gap-3 px-4 py-2.5'
  return wp
    ? <Link href={`/kader/${wp.id}`} className={`${className} hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors`}>{inner}</Link>
    : <div className={className}>{inner}</div>
}

function MiniStat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-700 rounded-md py-1">
      <div className={`font-bold ${highlight ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>{value}</div>
      <div className="text-gray-400 dark:text-gray-500 text-[9px] leading-tight">{label}</div>
    </div>
  )
}
