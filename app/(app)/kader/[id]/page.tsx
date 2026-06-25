import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 60

interface CareerRow {
  id: number
  season: string
  team_name: string
  league_name: string
  games: number
  goals: number
  assists: number
  yellow_cards: number
  yellow_red_cards: number
  red_cards: number
  sort_order: number
}

function age(birthDate: string): number {
  const today = new Date()
  const birth = new Date(birthDate)
  let a = today.getFullYear() - birth.getFullYear()
  if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) a--
  return a
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function MiniStat({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span className={`text-lg font-black ${highlight && value > 0 ? 'text-red-600' : 'text-gray-900'}`}>{value}</span>
      <span className="text-[10px] text-gray-400 uppercase tracking-wide mt-0.5">{label}</span>
    </div>
  )
}

function CardStat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-4">
      <div className="text-2xl font-black text-red-700">{value}</div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wide mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

export default async function KaderProfilPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const playerId = Number(id)
  if (!Number.isFinite(playerId)) notFound()

  const supabase = await createClient()

  const [{ data: p }, { data: careerRaw }] = await Promise.all([
    supabase.from('wildenroth_players').select('*').eq('id', playerId).single(),
    supabase.from('player_career_stats').select('*').eq('player_id', playerId).order('sort_order'),
  ])

  if (!p) notFound()

  const career: CareerRow[] = (careerRaw ?? []) as CareerRow[]

  const backHref = p.squad === '2' ? '/team/wildenroth-ii' : '/team/wildenroth'

  const careerTotals = career.reduce(
    (acc, r) => ({
      games: acc.games + r.games,
      goals: acc.goals + r.goals,
      assists: acc.assists + r.assists,
      yellow: acc.yellow + r.yellow_cards,
      yellowRed: acc.yellowRed + r.yellow_red_cards,
      red: acc.red + r.red_cards,
    }),
    { games: 0, goals: 0, assists: 0, yellow: 0, yellowRed: 0, red: 0 }
  )

  const initials = p.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
  const squadLabel = p.squad === '1' ? '1. Mannschaft' : p.squad === '2' ? '2. Mannschaft' : '1. & 2. Mannschaft'

  const minPerGame = (p.games ?? 0) > 0 && (p.minutes ?? 0) > 0
    ? Math.round(p.minutes / p.games) : null
  const prevMinPerGame = (p.prev_games ?? 0) > 0 && (p.prev_minutes ?? 0) > 0
    ? Math.round(p.prev_minutes / p.prev_games) : null
  const hasPrevStats = (p.prev_games ?? 0) + (p.prev_goals ?? 0) + (p.prev_assists ?? 0) + (p.prev_minutes ?? 0) > 0

  return (
    <div className="pb-8">
      {/* Hero */}
      <div className="relative bg-gradient-to-b from-red-800 via-red-700 to-red-600 px-5 pt-4 pb-8">
        <Link href={backHref} className="flex items-center gap-1 text-red-200 text-sm mb-4">
          <span className="text-lg leading-none">‹</span> Zurück
        </Link>
        <div className="flex items-end gap-4">
          {/* Photo */}
          <div className="relative flex-shrink-0">
            {p.image_url ? (
              <Image
                src={p.image_url}
                alt={p.name}
                width={96}
                height={96}
                className="w-24 h-24 rounded-2xl object-cover border-4 border-white/30 shadow-xl"
              />
            ) : (
              <div className="w-24 h-24 rounded-2xl bg-white/20 border-4 border-white/30 flex items-center justify-center text-3xl font-black text-white shadow-xl">
                {initials}
              </div>
            )}
            {p.shirt_number != null && (
              <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-white text-red-700 text-sm font-black flex items-center justify-center shadow-md">
                {p.shirt_number}
              </div>
            )}
          </div>

          {/* Name & meta */}
          <div className="min-w-0 flex-1 pb-1">
            <div className="text-red-200 text-xs font-semibold uppercase tracking-widest mb-0.5">{squadLabel}</div>
            <h1 className="text-white text-2xl font-black leading-tight">{p.name}</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {p.position && (
                <span className="text-xs bg-white/15 text-white px-2.5 py-1 rounded-full font-semibold">{p.position}</span>
              )}
              {p.is_penalty_taker && (
                <span className="text-xs bg-white/15 text-white px-2.5 py-1 rounded-full font-semibold">Elfmeter</span>
              )}
              {p.is_freekick_taker && (
                <span className="text-xs bg-white/15 text-white px-2.5 py-1 rounded-full font-semibold">Freistoß</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 space-y-4 mt-4">

        {/* Persönliches */}
        {p.birth_date && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3 flex items-center gap-3">
            <span className="text-2xl">🎂</span>
            <div>
              <div className="text-sm font-bold text-gray-900">
                {formatDate(p.birth_date)}
              </div>
              <div className="text-xs text-gray-400">{age(p.birth_date)} Jahre</div>
            </div>
          </div>
        )}

        {/* Aktuelle Saison */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 pt-3 pb-2 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-gray-900 text-sm">Saison 26/27</h2>
              <p className="text-[11px] text-gray-400">Aktuelle Saison · {p.squad === '2' ? 'B-Klasse' : 'Kreisliga'}</p>
            </div>
            <span className="text-[10px] bg-red-50 text-red-600 border border-red-100 px-2 py-1 rounded-full font-bold uppercase tracking-wide">Aktuell</span>
          </div>
          <div className="grid grid-cols-4 divide-x divide-gray-100">
            <CardStat label="Spiele" value={p.games ?? 0} />
            <CardStat label="Tore" value={p.goals ?? 0} />
            <CardStat label="Assists" value={p.assists ?? 0} />
            <CardStat label="Minuten" value={p.minutes ?? 0} sub={minPerGame ? `Ø ${minPerGame}'` : undefined} />
          </div>
        </div>

        {/* Vorherige Saison */}
        {hasPrevStats && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 pt-3 pb-2 border-b border-gray-100">
              <h2 className="font-bold text-gray-900 text-sm">Saison {p.prev_season ?? '25/26'}</h2>
              <p className="text-[11px] text-gray-400">Vorherige Saison</p>
            </div>
            <div className="grid grid-cols-4 divide-x divide-gray-100">
              <CardStat label="Spiele" value={p.prev_games ?? 0} />
              <CardStat label="Tore" value={p.prev_goals ?? 0} />
              <CardStat label="Assists" value={p.prev_assists ?? 0} />
              <CardStat label="Minuten" value={p.prev_minutes ?? 0} sub={prevMinPerGame ? `Ø ${prevMinPerGame}'` : undefined} />
            </div>
          </div>
        )}

        {/* Karriere-Bilanz */}
        {career.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 pt-3 pb-2 border-b border-gray-100">
              <h2 className="font-bold text-gray-900 text-sm">Karriere-Bilanz</h2>
              <p className="text-[11px] text-gray-400">Alle Stationen zusammen</p>
            </div>
            <div className="grid grid-cols-3 divide-x divide-gray-100">
              <CardStat label="Spiele" value={careerTotals.games} />
              <CardStat label="Tore" value={careerTotals.goals} />
              <CardStat label="Assists" value={careerTotals.assists} />
            </div>
            {(careerTotals.yellow > 0 || careerTotals.yellowRed > 0 || careerTotals.red > 0) && (
              <div className="flex items-center gap-4 px-4 py-3 border-t border-gray-100">
                {careerTotals.yellow > 0 && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-3.5 h-4.5 rounded-sm bg-yellow-400" style={{ height: 18 }} />
                    <span className="text-sm font-bold text-gray-700">{careerTotals.yellow}</span>
                  </div>
                )}
                {careerTotals.yellowRed > 0 && (
                  <div className="flex items-center gap-0.5">
                    <div className="w-3 rounded-sm bg-yellow-400" style={{ height: 18 }} />
                    <div className="w-3 rounded-sm bg-red-500 -ml-1" style={{ height: 18 }} />
                    <span className="text-sm font-bold text-gray-700 ml-1.5">{careerTotals.yellowRed}</span>
                  </div>
                )}
                {careerTotals.red > 0 && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-3.5 rounded-sm bg-red-500" style={{ height: 18 }} />
                    <span className="text-sm font-bold text-gray-700">{careerTotals.red}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Stationen */}
        {career.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 pt-3 pb-2 border-b border-gray-100">
              <h2 className="font-bold text-gray-900 text-sm">Spielerstationen</h2>
              <p className="text-[11px] text-gray-400">{career.filter(c => c.games > 0).length} Stationen</p>
            </div>
            <div className="divide-y divide-gray-50">
              {career.filter(c => c.games > 0).map((c, i, arr) => {
                const isII = c.team_name.includes('II')
                const isCurrent = i === 0
                return (
                  <div key={c.id} className={`px-4 py-3 flex items-center gap-3 ${isCurrent ? 'bg-red-50/50' : ''}`}>
                    {/* Timeline dot */}
                    <div className="flex flex-col items-center flex-shrink-0" style={{ width: 20 }}>
                      <div className={`w-2.5 h-2.5 rounded-full border-2 ${isCurrent ? 'bg-red-600 border-red-600' : 'bg-white border-gray-300'}`} />
                      {i < arr.length - 1 && <div className="w-px flex-1 bg-gray-200 mt-1" style={{ minHeight: 16 }} />}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-sm font-bold ${isCurrent ? 'text-red-700' : 'text-gray-800'}`}>
                          {c.season}
                        </span>
                        {isII && (
                          <span className="text-[10px] bg-red-50 text-red-500 border border-red-100 px-1.5 py-0.5 rounded font-bold">II</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 truncate mt-0.5">{c.league_name}</div>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <MiniStat label="Sp" value={c.games} />
                      <MiniStat label="Tor" value={c.goals} highlight />
                      <MiniStat label="Ast" value={c.assists} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
