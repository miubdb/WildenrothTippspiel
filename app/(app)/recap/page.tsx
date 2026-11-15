import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadCompletedMatchdays, loadReadinessOnly } from '@/lib/recap/loadRecap'
import { HINRUNDE, recapVisibility } from '@/lib/recap/availability'
import { isSimulationAllowed } from '@/lib/recap/environmentGuard'

export const dynamic = 'force-dynamic'

/** Recap-Hub: Einstieg für alle Recap-Typen. Der bestehende Spieltags-Recap (/recap/[matchday]) bleibt unverändert. */
export default async function RecapHubPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  const isAdmin = !!me?.is_admin
  const [done, readiness, setting] = await Promise.all([
    loadCompletedMatchdays(), loadReadinessOnly(),
    createAdminClient().from('app_settings').select('value').eq('key', HINRUNDE.settingKey).maybeSingle(),
  ])
  const vis = recapVisibility(readiness.ready, setting.data?.value ?? null)
  const hinrundeVisible = vis === 'published' || isAdmin
  const sorted = [...done].sort((a, b) => b - a)
  return (
    <div className="px-4 py-4 space-y-4">
      <h1 className="text-2xl font-black text-gray-900 dark:text-gray-100">Recaps</h1>
      {hinrundeVisible && (
        <Link href="/recap/hinrunde" className="block rounded-3xl bg-gradient-to-br from-red-700 via-red-600 to-amber-500 text-white p-5 shadow-lg">
          <div className="text-xs font-bold uppercase tracking-widest text-red-100">Neu · Saison 2026/27</div>
          <div className="text-2xl font-black mt-1">Winter-Recap</div>
          <div className="text-sm text-red-50 mt-1">Tipper-IQ, Awards und die besten Tipps der Hinrunde →</div>
          {vis !== 'published' && <div className="mt-2 inline-block rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold">Admin-Vorschau{vis === 'hidden_not_ready' ? ' · noch nicht bereit' : ' · nicht veröffentlicht'}</div>}
        </Link>
      )}
      {isAdmin && isSimulationAllowed() && (
        <Link href="/recap/hinrunde?test=sim16" className="block rounded-2xl border-2 border-dashed border-amber-500 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-900 dark:text-amber-100">
          <b>🧪 Testvorschau (nur Vorschau-Umgebung)</b><br />Winter-Recap mit simuliertem Spieltag 16 öffnen – es wird nichts gespeichert.
        </Link>
      )}
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400">Noch kein Spieltag abgeschlossen.</p>
      ) : (
        <>
          <Link href={`/recap/${sorted[0]}`} className="flex items-center gap-3 rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-4 shadow-sm">
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-red-50 dark:bg-red-900/30 text-2xl" aria-hidden>🏆</span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold uppercase tracking-wide text-gray-400">Letzter Spieltag</span>
              <span className="block text-lg font-black text-gray-900 dark:text-gray-100">{sorted[0]}. Spieltag</span>
              <span className="block text-sm text-gray-500 dark:text-gray-400">Pokale, Helden und Pechvögel</span>
            </span>
            <span className="text-red-700 dark:text-red-300 font-bold" aria-hidden>→</span>
          </Link>
          {sorted.length > 1 && (
            <details className="group rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 font-bold text-gray-900 dark:text-gray-100">
                <span>Frühere Spieltage <span className="font-normal text-gray-400">({sorted.length - 1})</span></span>
                <span className="text-gray-400 transition-transform group-open:rotate-180" aria-hidden>▾</span>
              </summary>
              <div className="grid grid-cols-5 gap-2 px-4 pb-4">
                {sorted.slice(1).map((md) => <Link key={md} href={`/recap/${md}`} className="rounded-xl bg-gray-50 dark:bg-gray-900/40 py-2.5 text-center text-sm font-bold text-gray-800 dark:text-gray-100 active:bg-red-50">{md}</Link>)}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  )
}
