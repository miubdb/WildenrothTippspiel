'use client'
import { useState } from 'react'

/** Umschalter „Community / Meine Tipps" – beide Inhalte werden serverseitig gerendert, hier wird nur sichtbar/unsichtbar
 *  geschaltet (kein Nachladen, keine zusätzlichen Datenabfragen). Persönliche Inhalte sind nur im HTML des
 *  eingeloggten Nutzers vorhanden. */
export function BestTipTabs({ community, mine }: { community: React.ReactNode; mine: React.ReactNode }) {
  const [tab, setTab] = useState<'community' | 'mine'>('community')
  const btn = (id: 'community' | 'mine', label: string) => (
    <button type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
      className={`flex-1 rounded-lg py-2 text-sm font-bold transition-colors ${tab === id ? 'bg-white dark:bg-gray-700 text-red-700 dark:text-red-300 shadow-sm' : 'text-gray-600 dark:text-gray-300'}`}>{label}</button>
  )
  return (
    <div>
      <div role="tablist" aria-label="Beste Tipps" className="mx-4 mt-3 flex rounded-xl bg-gray-100 dark:bg-gray-900/60 p-1 gap-1">
        {btn('community', 'Community')}{btn('mine', 'Mein bester Tipp')}
      </div>
      <div role="tabpanel">{tab === 'community' ? community : mine}</div>
    </div>
  )
}
