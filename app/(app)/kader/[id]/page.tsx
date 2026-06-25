import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 60

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center justify-center py-3 px-2">
      <div className="text-xl font-black text-red-700">{value}</div>
      <div className="text-[10px] text-gray-400 mt-0.5 uppercase tracking-wide">{label}</div>
    </div>
  )
}

export default async function KaderProfilPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const playerId = Number(id)
  if (!Number.isFinite(playerId)) notFound()

  const supabase = await createClient()
  const { data: p } = await supabase
    .from('wildenroth_players')
    .select('*')
    .eq('id', playerId)
    .single()

  if (!p) notFound()

  const backHref = p.squad === '2' ? '/team/wildenroth-ii' : '/team/wildenroth'
  const minPerGame = (p.games ?? 0) > 0 && (p.minutes ?? 0) > 0
    ? Math.round(p.minutes / p.games)
    : null
  const prevMinPerGame = (p.prev_games ?? 0) > 0 && (p.prev_minutes ?? 0) > 0
    ? Math.round(p.prev_minutes / p.prev_games)
    : null
  const hasPrevStats = (p.prev_games ?? 0) > 0 || (p.prev_goals ?? 0) > 0 || (p.prev_assists ?? 0) > 0 || (p.prev_minutes ?? 0) > 0

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Back */}
      <Link href={backHref} className="flex items-center gap-1.5 text-sm text-gray-500 font-medium">
        <span className="text-gray-400">‹</span> Zurück zum Kader
      </Link>

      {/* Header */}
      <div className="bg-gradient-to-br from-red-700 to-red-900 text-white rounded-2xl px-5 py-5 shadow-sm">
        <div className="flex items-center gap-4">
          {p.image_url ? (
            <Image
              src={p.image_url}
              alt={p.name}
              width={72}
              height={72}
              className="rounded-full object-cover flex-shrink-0 border-2 border-white/30"
            />
          ) : (
            <div
              className="rounded-full bg-white/20 flex items-center justify-center flex-shrink-0 text-2xl font-black border-2 border-white/30"
              style={{ width: 72, height: 72 }}
            >
              {p.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-red-200 text-xs font-medium uppercase tracking-wide">
              {p.squad === '1' ? '1. Mannschaft' : p.squad === '2' ? '2. Mannschaft' : '1. & 2. Mannschaft'}
            </div>
            <h1 className="text-2xl font-black leading-tight">{p.name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {p.shirt_number != null && (
                <span className="text-xs bg-white/20 px-2 py-0.5 rounded font-bold">#{p.shirt_number}</span>
              )}
              {p.position && (
                <span className="text-red-100 text-sm">{p.position}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Rollen-Badges */}
      {(p.is_penalty_taker || p.is_freekick_taker || p.squad === 'both') && (
        <div className="flex gap-2 flex-wrap">
          {p.squad === 'both' && (
            <span className="text-xs bg-red-50 text-red-600 border border-red-100 px-3 py-1.5 rounded-xl font-bold">
              1. &amp; 2. Mannschaft
            </span>
          )}
          {p.is_penalty_taker && (
            <span className="text-xs bg-red-100 text-red-700 border border-red-200 px-3 py-1.5 rounded-xl font-bold">
              Elfmeterschütze
            </span>
          )}
          {p.is_freekick_taker && (
            <span className="text-xs bg-blue-50 text-blue-700 border border-blue-100 px-3 py-1.5 rounded-xl font-bold">
              Freistoßschütze
            </span>
          )}
        </div>
      )}

      {/* Aktuelle Saison 26/27 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">Saison 26/27</h2>
          <div className="text-xs text-gray-400 mt-0.5">Aktuelle Saison</div>
        </div>
        <div className="grid grid-cols-4 divide-x divide-gray-100">
          <StatBox label="Spiele" value={p.games ?? 0} />
          <StatBox label="Tore" value={p.goals ?? 0} />
          <StatBox label="Assists" value={p.assists ?? 0} />
          <StatBox label="Minuten" value={p.minutes ?? 0} />
        </div>
        {minPerGame != null && (
          <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400">
            Ø {minPerGame} Min. pro Spiel
          </div>
        )}
      </div>

      {/* Vorherige Saison */}
      {hasPrevStats && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="font-bold text-gray-900">Saison {p.prev_season ?? '25/26'}</h2>
            <div className="text-xs text-gray-400 mt-0.5">Vorherige Saison</div>
          </div>
          <div className="grid grid-cols-4 divide-x divide-gray-100">
            <StatBox label="Spiele" value={p.prev_games ?? 0} />
            <StatBox label="Tore" value={p.prev_goals ?? 0} />
            <StatBox label="Assists" value={p.prev_assists ?? 0} />
            <StatBox label="Minuten" value={p.prev_minutes ?? 0} />
          </div>
          {prevMinPerGame != null && (
            <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400">
              Ø {prevMinPerGame} Min. pro Spiel
            </div>
          )}
        </div>
      )}
    </div>
  )
}
