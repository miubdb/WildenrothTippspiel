'use client'
import { useState } from 'react'

/** Umschalter „Community / Meine Tipps" – beide Inhalte werden serverseitig gerendert, hier wird nur sichtbar/unsichtbar
 *  geschaltet (kein Nachladen, keine zusätzlichen Datenabfragen). Persönliche Inhalte sind nur im HTML des
 *  eingeloggten Nutzers vorhanden. */
export function BestTipTabs({ community, mine }: { community: React.ReactNode; mine: React.ReactNode }) {
  const [tab, setTab] = useState<'community' | 'mine'>('community')
  const btn = (id: 'community' | 'mine', label: string) => (
    <button type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
      className={`flex-1 rounded-lg py-2 text-sm font-bold transition-colors ${tab === id ? 'bg-white text-[#1565a8] shadow-sm dark:bg-[#12315f] dark:text-[#8fd3ff]' : 'text-[#4d6a8a] dark:text-[#9db8d6]'}`}>{label}</button>
  )
  return (
    <div>
      <div role="tablist" aria-label="Beste Tipps" className="mx-4 mt-2 flex gap-1 rounded-xl bg-[#e3f1fc] p-1 dark:bg-white/10">
        {btn('community', 'Community')}{btn('mine', 'Mein bester Tipp')}
      </div>
      <div role="tabpanel">{tab === 'community' ? community : mine}</div>
    </div>
  )
}
