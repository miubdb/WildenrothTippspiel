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

const STEPS = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'E-Mail' },
  { key: 'password', label: 'Passwort' },
] as const

type StepKey = typeof STEPS[number]['key']

function StepIndicator({ current }: { current: StepKey }) {
  const currentIdx = STEPS.findIndex(s => s.key === current)
  return (
    <div className="flex items-center px-8 pt-6 pb-2">
      {STEPS.map((step, idx) => {
        const done = idx < currentIdx
        const active = idx === currentIdx
        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  done
                    ? 'bg-red-700 text-white'
                    : active
                      ? 'bg-red-700 text-white ring-4 ring-red-100'
                      : 'bg-gray-100 text-gray-400'
                }`}
              >
                {done ? '✓' : idx + 1}
              </div>
              <span className={`text-[10px] mt-1 uppercase tracking-wide font-semibold ${active ? 'text-red-700' : 'text-gray-400'}`}>
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 -mt-4 transition-colors ${done ? 'bg-red-700' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function RegisterPage() {
  const router = useRouter()
  const [step, setStep] = useState<StepKey>('name')
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

  function goNext() {
    setError(null)
    if (step === 'name') {
      if (form.displayName.trim().length < 2) {
        setError('Bitte gib deinen Namen ein (mindestens 2 Zeichen).')
        return
      }
      setStep('email')
    } else if (step === 'email') {
      if (!form.email.trim()) {
        setError('Bitte gib deine E-Mail-Adresse ein.')
        return
      }
      setStep('password')
    }
  }

  function goBack() {
    setError(null)
    if (step === 'email') setStep('name')
    else if (step === 'password') setStep('email')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

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

  function handleStepKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      goNext()
    }
  }

  return (
    <div>
      <StepIndicator current={step} />

      <div className="p-8 pt-4">
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Registrieren</h2>
        <p className="text-gray-500 text-sm mb-6">
          Erstelle dein Tippspiel-Konto
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {step === 'name' && (
            <div onKeyDown={handleStepKeyDown}>
              <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-1">
                Wie heißt du?
              </label>
              <input
                id="displayName"
                name="displayName"
                type="text"
                required
                autoFocus
                value={form.displayName}
                onChange={handleChange}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 placeholder-gray-400 transition"
                placeholder="Dein Name"
              />

              {error && (
                <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl border border-red-100 mt-4">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={goNext}
                className="w-full mt-4 py-3 px-4 bg-red-700 hover:bg-red-800 text-white font-semibold rounded-xl transition-colors"
              >
                Weiter
              </button>
            </div>
          )}

          {step === 'email' && (
            <div onKeyDown={handleStepKeyDown}>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Deine E-Mail-Adresse
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoFocus
                value={form.email}
                onChange={handleChange}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 placeholder-gray-400 transition"
                placeholder="deine@email.de"
              />

              {/* Wildenroth-Spieler */}
              <label className="flex items-start gap-3 cursor-pointer bg-gray-50 rounded-xl px-4 py-3 border border-gray-200 hover:border-red-300 transition-colors mt-4">
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
                <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl border border-red-100 mt-4">
                  {error}
                </div>
              )}

              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={goBack}
                  className="py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition-colors"
                >
                  Zurück
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  className="flex-1 py-3 px-4 bg-red-700 hover:bg-red-800 text-white font-semibold rounded-xl transition-colors"
                >
                  Weiter
                </button>
              </div>
            </div>
          )}

          {step === 'password' && (
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Passwort erstellen
              </label>
              <p className="text-xs text-gray-400 mb-2">Mindestens 6 Zeichen.</p>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoFocus
                value={form.password}
                onChange={handleChange}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 placeholder-gray-400 transition"
                placeholder="Mindestens 6 Zeichen"
              />

              <label htmlFor="passwordConfirm" className="block text-sm font-medium text-gray-700 mb-1 mt-4">
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

              {error && (
                <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl border border-red-100 mt-4">
                  {error}
                </div>
              )}

              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={goBack}
                  className="py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition-colors"
                >
                  Zurück
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-3 px-4 bg-red-700 hover:bg-red-800 disabled:bg-red-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
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
              </div>
            </div>
          )}
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
    </div>
  )
}
