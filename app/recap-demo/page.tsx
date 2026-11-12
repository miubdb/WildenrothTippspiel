import Link from 'next/link'
import { loadDemoState } from '@/lib/recap/demo'

export const dynamic = 'force-dynamic'

export default async function DemoHub({ searchParams }: { searchParams: Promise<{ me?: string }> }) {
  const { me } = await searchParams
  const st = loadDemoState(me ?? '')
  const q = `?me=${st.meId}`
  return (
    <div className="px-4 py-4 space-y-4">
      <h1 className="text-2xl font-black text-gray-900 dark:text-gray-100">Recaps</h1>
      <Link href={`/recap-demo/winter${q}`} className="block rounded-3xl bg-gradient-to-br from-red-700 via-red-600 to-amber-500 text-white p-5 shadow-lg">
        <div className="text-xs font-bold uppercase tracking-widest text-red-100">Neu · Saison 2026/27</div>
        <div className="text-2xl font-black mt-1">Winter-Recap</div>
        <div className="text-sm text-red-50 mt-1">Tipper-IQ, Awards und die besten Tipps der Hinrunde →</div>
        <div className="mt-2 inline-block rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold">Testvorschau · Spieltag 16 simuliert</div>
      </Link>
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
        <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-1">Spieltags-Recaps</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Vereinfachte Demo – das echte Spieltags-Recap bleibt unverändert und braucht die Datenbank.</p>
        <div className="grid grid-cols-4 gap-2">{Array.from({ length: 15 }, (_, i) => 15 - i).map((md) => <Link key={md} href={`/recap-demo/spieltag/${md}${q}`} className="rounded-xl bg-gray-50 dark:bg-gray-900/40 py-3 text-center text-sm font-bold text-gray-800 dark:text-gray-100">ST {md}</Link>)}</div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-sm text-gray-700 dark:text-gray-200">
        <h2 className="font-bold mb-2 text-gray-900 dark:text-gray-100">Als wer testest du?</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Für „Mein bester Tipp“ und deine Zeile im Tipper-IQ. Aktuell: <b>{st.profiles.find((p) => p.id === st.meId)?.name}</b></p>
        <div className="flex flex-wrap gap-1.5">{st.profiles.map((p) => <Link key={p.id} href={`/recap-demo?me=${p.id}`} className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${p.id === st.meId ? 'border-red-600 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300' : 'border-gray-300 dark:border-gray-600'}`}>{p.name}</Link>)}</div>
      </div>
    </div>
  )
}
