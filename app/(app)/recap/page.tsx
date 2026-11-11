import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadCompletedMatchdays, loadReadinessOnly } from '@/lib/recap/loadRecap'
import { HINRUNDE, recapVisibility } from '@/lib/recap/availability'
import { RecapTypeNav } from '@/components/recap/RecapTypeNav'

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
    <div className="space-y-4">
      <h1 className="text-2xl font-black text-gray-900 dark:text-gray-100">Recaps</h1>
      <RecapTypeNav current="spieltag" available={{ hinrunde: hinrundeVisible }} />
      {hinrundeVisible && (
        <Link href="/recap/hinrunde" className="block rounded-3xl bg-gradient-to-br from-red-700 via-red-600 to-amber-500 text-white p-5 shadow-lg">
          <div className="text-xs font-bold uppercase tracking-widest text-red-100">Neu · Saison 2026/27</div>
          <div className="text-2xl font-black mt-1">Hinrunden-Recap</div>
          <div className="text-sm text-red-50 mt-1">Tipper-IQ, Halbzeit-Awards und die besten Tipps der Hinrunde →</div>
          {vis !== 'published' && <div className="mt-2 inline-block rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold">Admin-Vorschau{vis === 'hidden_not_ready' ? ' · noch nicht bereit' : ' · nicht veröffentlicht'}</div>}
        </Link>
      )}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
        <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-3">Spieltags-Recaps</h2>
        {sorted.length === 0 ? <p className="text-sm text-gray-400">Noch kein Spieltag abgeschlossen.</p> : (
          <div className="grid grid-cols-4 gap-2">
            {sorted.map((md) => <Link key={md} href={`/recap/${md}`} className="rounded-xl bg-gray-50 dark:bg-gray-900/40 py-3 text-center text-sm font-bold text-gray-800 dark:text-gray-100 active:bg-red-50">ST {md}</Link>)}
          </div>
        )}
      </div>
    </div>
  )
}
