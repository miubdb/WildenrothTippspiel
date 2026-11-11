'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function RecapPublishPanel({ recap, ready, published, blockers, previewTo }: { recap: string; ready: boolean; published: boolean; blockers: string[]; previewTo: number | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  async function set(next: boolean) {
    if (next && !window.confirm('Recap jetzt für alle Mitglieder sichtbar machen?')) return
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/recap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recap, published: next }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) setMsg(j.error ?? 'Fehlgeschlagen.')
      else router.refresh()
    } finally { setBusy(false) }
  }
  return (
    <div className="rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-900 dark:text-amber-100">
      <div className="font-bold mb-1">Admin-Ansicht</div>
      {published ? <p>Dieser Recap ist <b>veröffentlicht</b> und für alle sichtbar.</p>
        : ready ? <p>Alle Spieltage sind abgeschlossen und abgerechnet. Der Recap ist <b>bereit</b>, aber noch nur für Admins sichtbar.</p>
          : <p>Noch nicht bereit{previewTo ? ` – Testansicht mit Daten bis Spieltag ${previewTo}` : ''}. Mitglieder sehen nichts.</p>}
      {!ready && blockers.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
      <div className="mt-3 flex gap-2">
        {!published && <button disabled={!ready || busy} onClick={() => set(true)} className="rounded-lg bg-red-700 px-4 py-2 font-bold text-white disabled:opacity-40">Veröffentlichen</button>}
        {published && <button disabled={busy} onClick={() => set(false)} className="rounded-lg bg-gray-700 px-4 py-2 font-bold text-white disabled:opacity-40">Zurückziehen</button>}
      </div>
      {msg && <p className="mt-2 text-xs font-semibold text-red-700">{msg}</p>}
    </div>
  )
}
