import { notFound } from 'next/navigation'
import { isFixtureDemoEnabled, loadDemoState, germanDayMonth, SnapshotKeyError } from '@/lib/recap/demo'
import { demoKey } from '@/lib/recap/demoKey'

/** Nur im separaten Test-Projekt (RECAP_FIXTURE_DEMO=1) sichtbar – überall sonst 404. Keine Datenbank, keine Anmeldung. */
export default async function DemoLayout({ children }: { children: React.ReactNode }) {
  if (!isFixtureDemoEnabled()) notFound()
  let label: string, real = false
  try {
    const st = loadDemoState('', await demoKey())
    real = st.source === 'snapshot'
    label = real ? `Datenquelle: Echte Wildenroth-Daten (Snapshot vom ${germanDayMonth(st.dataAsOf)}) · Spieltag 16 simuliert` : 'Datenquelle: Musterdaten (erfundene Daten, nicht die echten)'
  } catch (e) {
    if (!(e instanceof SnapshotKeyError)) throw e
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="sticky top-0 z-30 bg-red-700 text-white text-center text-xs font-black uppercase tracking-wide px-3 py-1.5">Fehler · echte Daten nicht geladen</div>
        <main className="mx-auto max-w-2xl px-4 py-6"><div role="alert" className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-900/30 dark:border-red-700 p-4 text-sm text-red-900 dark:text-red-100">{e.message} Es werden bewusst <b>keine</b> Musterdaten angezeigt. Bitte den Vorschau-Link neu öffnen.</div></main>
      </div>
    )
  }
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div data-source={real ? 'snapshot' : 'fixtures'} className={`sticky top-0 z-30 text-center text-xs font-black tracking-wide px-3 py-1.5 ${real ? 'bg-sky-700 text-white' : 'bg-amber-400 text-amber-950'}`}>{real ? '🔒 ' : '🧪 '}{label}</div>
      <main className="mx-auto max-w-2xl">{children}</main>
    </div>
  )
}
