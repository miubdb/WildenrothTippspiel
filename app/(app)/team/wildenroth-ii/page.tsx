import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 60

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

  const { data: rawPlayers } = await supabase
    .from('wildenroth_players')
    .select('id, name, position, shirt_number, image_url, squad, games, goals, assists, is_goalkeeper, is_penalty_taker, is_freekick_taker')
    .eq('active', true)
    .in('squad', ['2', 'both'])
    .order('name')

  const players: PlayerRow[] = (rawPlayers ?? []) as PlayerRow[]

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

      {/* Top scorers */}
      {topScorers.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <h2 className="font-bold text-gray-900 dark:text-gray-100">Top-Torschützen</h2>
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
        </div>
      )}

      {/* Squad */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-gray-100">Kader 2. Mannschaft</h2>
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
