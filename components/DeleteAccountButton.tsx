'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/** Self-service account deletion — small, low-emphasis trigger that expands
 *  into an explicit confirmation panel (no browser-native confirm(), to stay
 *  consistent with the rest of the app's own dialog styling). The actual
 *  deletion is a soft-delete on the server (see /api/profile/delete-account)
 *  — this component just handles the two-step confirm and the sign-out
 *  redirect afterwards. */
export function DeleteAccountButton() {
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  async function handleDelete() {
    setLoading(true)
    setError(null)
    const res = await fetch('/api/profile/delete-account', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setLoading(false)
      setError(data.error ?? 'Fehler beim Löschen.')
      return
    }
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="w-full py-2 text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium"
      >
        Account löschen
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-4 py-4 space-y-3">
      <div className="text-sm font-bold text-red-700 dark:text-red-400">Account wirklich löschen?</div>
      <p className="text-xs text-red-700 dark:text-red-400 leading-relaxed">
        Dein Login wird gesperrt, dein Guthaben und alle deine Wildis gehen verloren, und du verschwindest aus der
        Rangliste. Deine bereits platzierten Wetten bleiben aus historischen Gründen für andere sichtbar. Du kannst
        das <strong>nicht selbst rückgängig machen</strong> — nur ein Admin kann deinen Account wieder aktivieren.
      </p>
      {error && <p className="text-xs text-red-800 dark:text-red-300 font-semibold">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => { setConfirming(false); setError(null) }}
          disabled={loading}
          className="flex-1 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-semibold rounded-lg disabled:opacity-50"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={loading}
          className="flex-1 py-2 bg-red-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 hover:bg-red-800 transition-colors"
        >
          {loading ? 'Wird gelöscht…' : 'Ja, endgültig löschen'}
        </button>
      </div>
    </div>
  )
}
