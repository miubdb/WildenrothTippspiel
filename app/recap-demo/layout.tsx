import { notFound } from 'next/navigation'
import { isFixtureDemoEnabled, loadDemoState } from '@/lib/recap/demo'
import { demoKey } from '@/lib/recap/demoKey'

/** Nur im separaten Test-Projekt (RECAP_FIXTURE_DEMO=1) sichtbar – überall sonst 404. Keine Datenbank, keine Anmeldung. */
export default async function DemoLayout({ children }: { children: React.ReactNode }) {
  if (!isFixtureDemoEnabled()) notFound()
  const real = loadDemoState('', await demoKey()).source === 'snapshot'
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="sticky top-0 z-30 bg-amber-400 text-amber-950 text-center text-xs font-black uppercase tracking-wide px-3 py-1.5">{real ? '🔒 Vorschau · echte Hinrunde (nur lesend) · Spieltag 16 simuliert' : '🧪 Testumgebung · erfundene Daten · keine Datenbank'}</div>
      <main className="mx-auto max-w-2xl">{children}</main>
    </div>
  )
}
