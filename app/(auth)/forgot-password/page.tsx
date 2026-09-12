'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

/**
 * "Passwort vergessen" — sends a Supabase Auth recovery email. Deliberately
 * uses Supabase's own resetPasswordForEmail rather than any custom
 * token/backend logic (see /reset-password for the other half of the flow).
 *
 * Security: the success message is identical regardless of whether the
 * email actually belongs to an account — Supabase's own API already avoids
 * leaking that (resetPasswordForEmail resolves the same way for an unknown
 * address), and this UI never distinguishes the two cases either, so the
 * page can't be used to enumerate registered emails.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'network_error'>('idle')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')

    const supabase = createClient()
    try {
      // Errors from this call (rate-limited, unknown address, etc.) are
      // intentionally NOT surfaced differently from success — only a
      // genuine network/infra failure (caught below) gets its own message,
      // since that's a fact about connectivity, not about the account.
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      setStatus('sent')
    } catch {
      setStatus('network_error')
    }
  }

  if (status === 'sent') {
    return (
      <div className="p-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Passwort vergessen?</h2>
        <div className="bg-green-50 text-green-800 text-sm px-4 py-3 rounded-xl border border-green-100">
          Wenn ein Konto mit dieser E-Mail-Adresse existiert, haben wir dir einen Link zum
          Zurücksetzen des Passworts geschickt.
        </div>
        <p className="mt-3 text-xs text-gray-400">Bitte prüfe auch deinen Spam-Ordner.</p>
        <Link
          href="/login"
          className="mt-6 block text-center py-3 px-4 bg-red-700 hover:bg-red-800 text-white font-semibold rounded-xl transition-colors"
        >
          Zurück zum Login
        </Link>
      </div>
    )
  }

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Passwort vergessen?</h2>
      <p className="text-gray-500 text-sm mb-6">
        Gib deine E-Mail-Adresse ein. Wir schicken dir einen Link, mit dem du ein neues Passwort
        festlegen kannst.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            E-Mail
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 placeholder-gray-400 transition"
            placeholder="deine@email.de"
          />
        </div>

        {status === 'network_error' && (
          <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl border border-red-100">
            Verbindung fehlgeschlagen. Bitte überprüfe deine Internetverbindung und versuche es
            noch einmal.
          </div>
        )}

        <button
          type="submit"
          disabled={status === 'loading'}
          className="w-full py-3 px-4 bg-red-700 hover:bg-red-800 disabled:bg-red-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {status === 'loading' ? (
            <>
              <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              Wird gesendet...
            </>
          ) : (
            'Reset-Link senden'
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        <Link href="/login" className="text-red-700 font-semibold hover:text-red-800 transition-colors">
          Zurück zum Login
        </Link>
      </p>
    </div>
  )
}
