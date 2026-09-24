'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface SyncSummary {
  matchesCreated: number
  matchesUpdated: number
  matchesUnchanged: number
  conflictsCreated: number
  matchesConsidered: number
  error: string | null
}

export function SyncButton({ squadId, squadName }: { squadId: string; squadName: string }) {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<SyncSummary | { error: string } | null>(null)
  const router = useRouter()

  function runSync() {
    startTransition(async () => {
      setResult(null)
      try {
        const res = await fetch('/api/admin/data-sources/tippspiel-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ squadId }),
        })
        const data = await res.json()
        setResult(data)
        router.refresh()
      } catch {
        setResult({ error: 'Netzwerkfehler beim Synchronisieren.' })
      }
    })
  }

  return (
    <div className="space-y-2">
      <button
        onClick={runSync}
        disabled={pending}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
      >
        {pending ? 'Synchronisiere …' : `${squadName} synchronisieren`}
      </button>
      {result && 'error' in result && result.error && (
        <p className="rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">{result.error}</p>
      )}
      {result && !('error' in result && result.error) && 'matchesCreated' in result && (
        <p className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300">
          {result.matchesConsidered} Spiele geprüft — {result.matchesCreated} neu, {result.matchesUpdated} aktualisiert,{' '}
          {result.matchesUnchanged} unverändert, {result.conflictsCreated} neue Konflikte.
        </p>
      )}
    </div>
  )
}
