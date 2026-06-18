'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

function generateUsername(displayName: string): string {
  const base = displayName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20) || 'user'
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${base}_${suffix}`
}

export default function RegisterPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    displayName: '',
    email: '',
    password: '',
    passwordConfirm: '',
  })
  const [isWildenroth, setIsWildenroth] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (form.displayName.trim().length < 2) {
      setError('Bitte gib deinen Namen ein (mindestens 2 Zeichen).')
      return
    }
    if (form.password !== form.passwordConfirm) {
      setError('Passwörter stimmen nicht überein.')
      return
    }
    if (form.password.length < 6) {
      setError('Das Passwort muss mindestens 6 Zeichen lang sein.')
      return
    }

    setLoading(true)

    const supabase = createClient()
    const username = generateUsername(form.displayName)

    // Register user
    const { error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: {
          username,
          display_name: form.displayName.trim(),
        },
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    // Saisonstart-Regel + Wildenroth-Flag setzen
    try {
      await fetch('/api/auth/register-eligibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isWildenroth }),
      })
    } catch {
      // best-effort; Admin kann Berechtigung manuell setzen
    }

    router.push('/willkommen')
    router.refresh()
  }

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Registrieren</h2>
      <p className="text-gray-500 text-sm mb-6">
        Erstelle dein Tippspiel-Konto
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-1">
            Name
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            required
            value={form.displayName}
            onChange={handleChange}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 placeholder-gray-400 transition"
            placeholder="Dein Name"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            E-Mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            value={form.email}
            onChange={handleChange}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 placeholder-gray-400 transition"
            placeholder="deine@email.de"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
            Passwort
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            value={form.password}
            onChange={handleChange}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 placeholder-gray-400 transition"
            placeholder="Mindestens 6 Zeichen"
          />
        </div>

        <div>
          <label htmlFor="passwordConfirm" className="block text-sm font-medium text-gray-700 mb-1">
            Passwort wiederholen
          </label>
          <input
            id="passwordConfirm"
            name="passwordConfirm"
            type="password"
            required
            value={form.passwordConfirm}
            onChange={handleChange}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 placeholder-gray-400 transition"
            placeholder="••••••••"
          />
        </div>

        {/* Wildenroth-Spieler */}
        <label className="flex items-start gap-3 cursor-pointer bg-gray-50 rounded-xl px-4 py-3 border border-gray-200 hover:border-red-300 transition-colors">
          <input
            type="checkbox"
            checked={isWildenroth}
            onChange={e => setIsWildenroth(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded accent-red-700 flex-shrink-0"
          />
          <div>
            <div className="text-sm font-semibold text-gray-800">Ich bin aktiver Spieler, Trainer oder Torwarttrainer der 1. Mannschaft von SpVgg Wildenroth</div>
            <div className="text-xs text-gray-500 mt-0.5">Wildenroth-Spieler dürfen nicht gegen die eigene Mannschaft tippen.</div>
          </div>
        </label>

        {error && (
          <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl border border-red-100">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 px-4 bg-red-700 hover:bg-red-800 disabled:bg-red-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              Registrieren...
            </>
          ) : (
            'Konto erstellen'
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        Bereits ein Konto?{' '}
        <Link
          href="/login"
          className="text-red-700 font-semibold hover:text-red-800 transition-colors"
        >
          Jetzt anmelden
        </Link>
      </p>
    </div>
  )
}
