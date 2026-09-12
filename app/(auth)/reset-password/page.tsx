'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Phase = 'checking' | 'ready' | 'invalid' | 'success'

/**
 * Other half of the "Passwort vergessen" flow. The recovery link's ?code=
 * is exchanged into a session automatically by the browser client
 * (detectSessionInUrl), which then fires a PASSWORD_RECOVERY auth event —
 * that event, not just "is there a session", is what gates the form, so a
 * normal logged-in user browsing here directly can't change their password
 * without going through the email link.
 */
export default function ResetPasswordPage() {
  const [phase, setPhase] = useState<Phase>('checking')
  const [password, setPassword] = useState('')
  const [passwordRepeat, setPasswordRepeat] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const supabase = createClient()

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPhase('ready')
      }
    })

    const timeout = setTimeout(() => {
      setPhase((current) => (current === 'checking' ? 'invalid' : current))
    }, 4000)

    return () => {
      listener.subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    if (!password || !passwordRepeat) {
      setFormError('Bitte beide Felder ausfüllen.')
      return
    }
    if (password.length < 6) {
      setFormError('Das Passwort muss mindestens 6 Zeichen lang sein.')
      return
    }
    if (password !== passwordRepeat) {
      setFormError('Die Passwörter stimmen nicht überein.')
      return
    }

    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setSaving(false)
      if (error.message.toLowerCase().includes('network')) {
        setFormError('Verbindung fehlgeschlagen. Bitte überprüfe deine Internetverbindung und versuche es noch einmal.')
      } else {
        setFormError('Das Passwort konnte nicht geändert werden. Bitte fordere einen neuen Reset-Link an.')
      }
      return
    }

    await supabase.auth.signOut()
    setSaving(false)
    setPhase('success')
  }

  if (phase === 'checking') {
    return (
      <div className="p-8 flex flex-col items-center gap-4">
        <span className="animate-spin inline-block w-6 h-6 border-2 border-red-700 border-t-transparent rounded-full" />
        <p className="text-gray-500 text-sm">Link wird überprüft...</p>
      </div>
    )
  }

  if (phase === 'invalid') {
    return (
      <div className="p-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Neues Passwort festlegen</h2>
        <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl border border-red-100">
          Dieser Link ist nicht mehr gültig. Bitte fordere einen neuen Passwort-Reset an.
        </div>
        <Link
          href="/forgot-password"
          className="mt-6 block text-center py-3 px-4 bg-red-700 hover:bg-red-800 text-white font-semibold rounded-xl transition-colors"
        >
          Neuen Reset-Link anfordern
        </Link>
      </div>
    )
  }

  if (phase === 'success') {
    return (
      <div className="p-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Neues Passwort festlegen</h2>
        <div className="bg-green-50 text-green-800 text-sm px-4 py-3 rounded-xl border border-green-100">
          ✅ Dein Passwort wurde geändert.
        </div>
        <Link
          href="/login"
          className="mt-6 block text-center py-3 px-4 bg-red-700 hover:bg-red-800 text-white font-semibold rounded-xl transition-colors"
        >
          Zum Login
        </Link>
      </div>
    )
  }

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Neues Passwort festlegen</h2>
      <p className="text-gray-500 text-sm mb-6">
        Wähle ein neues Passwort für dein Konto.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
            Neues Passwort
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 placeholder-gray-400 transition"
            placeholder="••••••••"
          />
        </div>

        <div>
          <label htmlFor="passwordRepeat" className="block text-sm font-medium text-gray-700 mb-1">
            Neues Passwort wiederholen
          </label>
          <input
            id="passwordRepeat"
            type="password"
            required
            value={passwordRepeat}
            onChange={(e) => setPasswordRepeat(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 placeholder-gray-400 transition"
            placeholder="••••••••"
          />
        </div>

        {formError && (
          <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl border border-red-100">
            {formError}
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full py-3 px-4 bg-red-700 hover:bg-red-800 disabled:bg-red-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              Wird gespeichert...
            </>
          ) : (
            'Passwort speichern'
          )}
        </button>
      </form>
    </div>
  )
}
