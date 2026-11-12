import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadHinrundeState } from '@/lib/recap/loadRecap'
import { HINRUNDE } from '@/lib/recap/availability'
import { isPreviewEnvironment } from '@/lib/recap/simulation'
import { RecapTypeNav } from '@/components/recap/RecapTypeNav'
import { RecapPublishPanel } from '@/components/recap/RecapPublishPanel'
import { HinrundeView } from '@/components/recap/HinrundeView'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Winter-Recap' }

export default async function HinrundeRecapPage({ searchParams }: { searchParams: Promise<{ test?: string }> }) {
  const { test } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  const isAdmin = !!me?.is_admin
  const previewEnv = isPreviewEnvironment()
  const wantsSim = test === 'sim16'
  const state = await loadHinrundeState({ adminPreview: isAdmin, viewerId: user.id, simulate: wantsSim })
  const visibleToMembers = state.visibility === 'published' && !state.simulation

  return (
    <div className="px-4 py-4 space-y-4">
      <Link href="/recap" className="text-sm font-semibold text-red-700 dark:text-red-300">← Alle Recaps</Link>
      <RecapTypeNav current="hinrunde" available={{ hinrunde: visibleToMembers || isAdmin }} />
      {isAdmin && (
        <RecapPublishPanel recap="hinrunde" ready={state.simulation ? state.simulation.realReadiness.ready : state.readiness.ready} published={state.simulation ? false : state.published}
          blockers={(state.simulation ? state.simulation.realReadiness : state.readiness).blockers} previewTo={state.previewTo} simulation={!!state.simulation} />
      )}
      {isAdmin && previewEnv && (
        <div className="text-xs">
          {state.simulation
            ? <Link href="/recap/hinrunde" className="font-semibold text-red-700 dark:text-red-300">← Testvorschau beenden (echte Daten zeigen)</Link>
            : <Link href="/recap/hinrunde?test=sim16" className="font-semibold text-red-700 dark:text-red-300">🧪 Testvorschau öffnen: Spieltag {HINRUNDE.to} simuliert (nur Vorschau-Umgebung, schreibt nichts)</Link>}
        </div>
      )}
      {state.report ? (
        <HinrundeView report={state.report} personal={state.personal} myId={user.id} previewTo={state.previewTo} simulation={state.simulation} />
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm py-12 px-6 text-center">
          <div className="text-4xl mb-3">🏆</div>
          <h1 className="text-xl font-black text-gray-900 dark:text-gray-100">Winter-Recap</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            {state.readiness.ready ? 'Kommt in Kürze – die Auswertung wird gerade vorbereitet.' : `Der Recap erscheint, sobald Spieltag ${HINRUNDE.to} abgeschlossen und abgerechnet ist.`}
          </p>
          {!state.readiness.ready && <p className="text-xs text-gray-400 mt-3">Fortschritt: {state.completedUpTo} von {HINRUNDE.to} Spieltagen abgeschlossen</p>}
        </div>
      )}
    </div>
  )
}
