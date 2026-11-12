import { loadDemoState } from '@/lib/recap/demo'
import { HinrundeView } from '@/components/recap/HinrundeView'
import { DemoNav } from '../DemoNav'

export const dynamic = 'force-dynamic'

export default async function DemoWinter({ searchParams }: { searchParams: Promise<{ me?: string }> }) {
  const { me } = await searchParams
  const st = loadDemoState(me ?? '')
  return (
    <div className="px-4 py-4 space-y-4">
      <DemoNav current="winter" me={st.meId} />
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
        Du testest als <b>{st.profiles.find((p) => p.id === st.meId)?.name}</b> · <a className="font-semibold text-red-700 dark:text-red-300" href={`/recap-demo?me=${st.meId}`}>Person wechseln</a>
        <br />Echte Bereitschaftsprüfung (ohne Simulation): {st.realReady ? 'bereit' : 'Spieltag 16 NICHT bereit'} · mit Simulation: {st.simReady ? 'bereit' : 'nicht bereit'}.
      </div>
      <HinrundeView report={st.report} personal={st.personal} myId={st.meId} previewTo={null} simulation={{ matches: st.simulated.matches, betRows: st.simulated.betRows, databaseRef: 'fixtures' }} />
    </div>
  )
}
