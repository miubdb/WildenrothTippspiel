import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadHinrundeState } from '@/lib/recap/loadRecap'
import { HINRUNDE } from '@/lib/recap/availability'
import { RecapTypeNav } from '@/components/recap/RecapTypeNav'
import { RecapPublishPanel } from '@/components/recap/RecapPublishPanel'
import { HinrundeView } from '@/components/recap/HinrundeView'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Hinrunden-Recap' }

export default async function HinrundeRecapPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  const isAdmin = !!me?.is_admin
  const state = await loadHinrundeState({ adminPreview: isAdmin })
  const visibleToMembers = state.visibility === 'published'

  return (
    <div className="space-y-4">
      <Link href="/recap" className="text-sm font-semibold text-red-700 dark:text-red-300">← Alle Recaps</Link>
      <RecapTypeNav current="hinrunde" available={{ hinrunde: visibleToMembers || isAdmin }} />
      {isAdmin && <RecapPublishPanel recap="hinrunde" ready={state.readiness.ready} published={state.published} blockers={state.readiness.blockers} previewTo={state.previewTo} />}
      {state.report ? (
        <HinrundeView report={state.report} myId={user.id} previewTo={state.previewTo} />
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm py-12 px-6 text-center">
          <div className="text-4xl mb-3">🏆</div>
          <h1 className="text-xl font-black text-gray-900 dark:text-gray-100">Hinrunden-Recap</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            {state.readiness.ready ? 'Kommt in Kürze – die Auswertung wird gerade vorbereitet.' : `Der Recap erscheint, sobald Spieltag ${HINRUNDE.to} abgeschlossen und abgerechnet ist.`}
          </p>
          {!state.readiness.ready && <p className="text-xs text-gray-400 mt-3">Fortschritt: {state.completedUpTo} von {HINRUNDE.to} Spieltagen abgeschlossen</p>}
        </div>
      )}
    </div>
  )
}
