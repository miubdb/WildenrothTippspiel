'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { HomeModeSetting } from '@/lib/homeMode'

const LABELS: Record<HomeModeSetting, string> = { auto: 'Automatisch', winter: 'Pause', normal: 'Spieltag' }

/** Nur für Admins sichtbar: schaltet die Startseite zwischen Pausen- und Spieltags-Ansicht um. */
export function HomeModeAdminToggle({ current, active }: { current: HomeModeSetting; active: 'winter' | 'normal' }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  async function set(mode: HomeModeSetting) {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/home-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) setMsg(j.error ?? 'Fehlgeschlagen.')
      else router.refresh()
    } finally { setBusy(false) }
  }
  return (
    <div className="rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-900 dark:text-amber-100">
      <div className="font-bold">Admin · Startseite</div>
      <p className="mt-0.5">Aktuell sichtbar für alle: <b>{active === 'winter' ? 'Pausen-Ansicht' : 'Spieltags-Ansicht'}</b>{current === 'auto' ? ' (automatisch)' : ''}</p>
      <div className="mt-2 flex gap-1.5">
        {(Object.keys(LABELS) as HomeModeSetting[]).map((m) => (
          <button key={m} disabled={busy || m === current} onClick={() => set(m)}
            className={`flex-1 rounded-lg px-2 py-1.5 font-bold ${m === current ? 'bg-amber-600 text-white' : 'bg-white dark:bg-gray-800 border border-amber-300'} disabled:cursor-default`}>
            {LABELS[m]}
          </button>
        ))}
      </div>
      {msg && <p className="mt-1 font-semibold text-red-700">{msg}</p>}
    </div>
  )
}
