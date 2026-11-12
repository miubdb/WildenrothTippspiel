import { notFound } from 'next/navigation'
import { loadDemoState } from '@/lib/recap/demo'
import { isSettled } from '@/lib/recap/slips'
import { DemoNav } from '../../DemoNav'

export const dynamic = 'force-dynamic'
const fmt = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 0 })

/** Vereinfachte Demo des Spieltags-Recaps (Rangliste nach Nettogewinn). Das echte Spieltags-Recap ist unverändert. */
export default async function DemoSpieltag({ params, searchParams }: { params: Promise<{ n: string }>; searchParams: Promise<{ me?: string }> }) {
  const { n } = await params
  const { me } = await searchParams
  const md = parseInt(n, 10)
  if (!(md >= 1 && md <= 16)) notFound()
  const st = loadDemoState(me ?? '')
  const name = new Map(st.profiles.map((p) => [p.id, p.name]))
  const by = new Map<string, number>()
  for (const s of st.slips) if (s.ownerMatchday === md && isSettled(s) && name.has(s.userId)) by.set(s.userId, (by.get(s.userId) ?? 0) + s.net)
  const rows = [...by.entries()].sort((a, b) => b[1] - a[1])
  return (
    <div className="px-4 py-4 space-y-4">
      <DemoNav current="spieltag" me={st.meId} />
      <div className="bg-gradient-to-br from-red-700 to-red-900 text-white rounded-2xl px-5 py-5 shadow-sm"><h1 className="text-xl font-black">Spieltag {md} – Recap</h1><p className="text-red-200 text-sm mt-1">Demo-Ansicht{md === 16 ? ' · simuliert' : ''}</p></div>
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-700 font-bold text-gray-900 dark:text-gray-100">Rangliste</div>
        {rows.slice(0, 12).map(([u, v], i) => <div key={u} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${u === st.meId ? 'bg-red-50 dark:bg-red-900/10' : ''}`}><span className="w-6 text-gray-500">{i + 1}</span><span className="flex-1 truncate font-semibold text-gray-900 dark:text-gray-100">{name.get(u)}</span><b className={v >= 0 ? 'text-green-600' : 'text-red-600'}>{v >= 0 ? '+' : '−'}{fmt(Math.abs(v))}</b></div>)}
      </div>
    </div>
  )
}
