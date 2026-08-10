'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

// Server-side availability check — see app/api/auth/check-display-name/route.ts.
// A client-only SELECT can't be trusted as the uniqueness check: it's racy
// (two simultaneous registrations could both see "available") and the actual
// boundary is the DB's trimmed/lowercased UNIQUE index, enforced at signUp().
async function checkDisplayNameAvailable(name: string): Promise<{ available: boolean } | { error: string }> {
  try {
    const res = await fetch('/api/auth/check-display-name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: name }),
    })
    const data = await res.json()
    if (!res.ok) return { error: data.error ?? 'Name konnte nicht geprüft werden.' }
    return { available: !!data.available }
  } catch {
    return { error: 'Netzwerkfehler. Bitte erneut versuchen.' }
  }
}

// Server-side availability check — see app/api/auth/check-email/route.ts.
async function checkEmailAvailable(email: string): Promise<{ available: boolean } | { error: string }> {
  try {
    const res = await fetch('/api/auth/check-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    const data = await res.json()
    if (!res.ok) return { error: data.error ?? 'E-Mail konnte nicht geprüft werden.' }
    return { available: !!data.available }
  } catch {
    return { error: 'Netzwerkfehler. Bitte erneut versuchen.' }
  }
}

const EMAIL_TAKEN_MESSAGE = 'Diese E-Mail-Adresse wird bereits verwendet. Bitte melde dich an oder verwende eine andere E-Mail-Adresse.'

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

type PlayerRole = 'team1' | 'team2' | 'both' | 'fan'

const ROLE_OPTIONS: { value: PlayerRole; label: string }[] = [
  { value: 'team1', label: 'Ich bin Spieler/Trainer der 1. Mannschaft' },
  { value: 'team2', label: 'Ich bin Spieler/Trainer der 2. Mannschaft' },
  { value: 'both', label: 'Ich bin aktuell in beiden Mannschaften aktiv' },
  { value: 'fan', label: 'Ich bin nur Fan 🙂' },
]

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
  const [playerRole, setPlayerRole] = useState<PlayerRole | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [checkingName, setCheckingName] = useState(false)
  const [checkingEmail, setCheckingEmail] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function goNext() {
    setError(null)
    if (step === 'name') {
      const trimmed = form.displayName.trim()
      if (trimmed.length < 2) {
        setError('Bitte gib deinen Namen ein (mindestens 2 Zeichen).')
        return
      }
      setCheckingName(true)
      const result = await checkDisplayNameAvailable(trimmed)
      setCheckingName(false)
      if ('error' in result) {
        setError(result.error)
        return
      }
      if (!result.available) {
        setError('Dieser Name ist leider schon vergeben.')
        return
      }
      setStep('email')
    } else if (step === 'email') {
      const emailTrimmed = form.email.trim()
      if (!emailTrimmed) {
        setError('Bitte gib deine E-Mail-Adresse ein.')
        return
      }
      if (!playerRole) {
        setError('Bitte wähle eine der vier Optionen aus.')
        return
      }
      setCheckingEmail(true)
      const result = await checkEmailAvailable(emailTrimmed)
      setCheckingEmail(false)
      if ('error' in result) {
        setError(result.error)
        return
      }
      if (!result.available) {
        setError(EMAIL_TAKEN_MESSAGE)
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

    // Re-check right before signUp() to shrink the race window (still not a
    // full guarantee — the DB's unique index is the actual boundary).
    const nameTrimmed = form.displayName.trim()
    const emailTrimmed = form.email.trim()
    const recheck = await checkDisplayNameAvailable(nameTrimmed)
    if ('error' in recheck) {
      setError(recheck.error)
      setLoading(false)
      return
    }
    if (!recheck.available) {
      setError('Dieser Name ist leider schon vergeben.')
      setLoading(false)
      setStep('name')
      return
    }
    const emailRecheck = await checkEmailAvailable(emailTrimmed)
    if ('error' in emailRecheck) {
      setError(emailRecheck.error)
      setLoading(false)
      return
    }
    if (!emailRecheck.available) {
      setError(EMAIL_TAKEN_MESSAGE)
      setLoading(false)
      setStep('email')
      return
    }

    const supabase = createClient()
    const username = generateUsername(form.displayName)

    // Register user
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: emailTrimmed,
      password: form.password,
      options: {
        data: {
          username,
          display_name: nameTrimmed,
        },
      },
    })

    if (signUpError) {
      const msg = signUpError.message?.toLowerCase() ?? ''
      const isNameConflict = msg.includes('duplicate') || msg.includes('unique') || msg.includes('display_name')
      const isEmailConflict = msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already') || msg.includes('profiles_email')
      if (isNameConflict) {
        setError('Dieser Name ist leider schon vergeben.')
        setStep('name')
      } else if (isEmailConflict) {
        setError(EMAIL_TAKEN_MESSAGE)
        setStep('email')
      } else {
        setError('Registrierung fehlgeschlagen. Bitte versuche es erneut.')
      }
      setLoading(false)
      return
    }

    // Anti-enumeration: for an email that's already registered and confirmed,
    // Supabase can return success with no error but an empty identities array
    // (no new identity was actually created) instead of a clear duplicate
    // error. The checks above already catch this in the vast majority of
    // cases, but treat it as a duplicate too rather than silently proceeding
    // to /willkommen without a real new account.
    if (signUpData?.user && signUpData.user.identities?.length === 0) {
      setError(EMAIL_TAKEN_MESSAGE)
      setStep('email')
      setLoading(false)
      return
    }

    // Saisonstart-Regel + Wildenroth-Flag setzen
    try {
      await fetch('/api/auth/register-eligibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: playerRole }),
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
                Wie heißt du? (eindeutiger Nutzername)
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
                disabled={checkingName}
                className="w-full mt-4 py-3 px-4 bg-red-700 hover:bg-red-800 disabled:bg-red-300 text-white font-semibold rounded-xl transition-colors"
              >
                {checkingName ? 'Prüfe Name…' : 'Weiter'}
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
              <p className="text-xs text-gray-400 mt-1.5">
                Die Adresse muss nicht erreichbar sein. Wichtig: Merke sie dir – du brauchst sie später zum Login.
              </p>

              {/* Spieler/Fan-Auswahl — single-choice, genau eine Option Pflicht */}
              <fieldset className="mt-4">
                <legend className="text-sm font-medium text-gray-700 mb-1.5">Das trifft auf dich zu:</legend>
                <div className="space-y-2">
                  {ROLE_OPTIONS.map(({ value, label }) => (
                    <label
                      key={value}
                      className={`flex items-center gap-3 cursor-pointer rounded-xl px-4 py-3 border transition-colors ${
                        playerRole === value
                          ? 'bg-red-50 border-red-400'
                          : 'bg-gray-50 border-gray-200 hover:border-red-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="playerRole"
                        value={value}
                        checked={playerRole === value}
                        onChange={() => setPlayerRole(value)}
                        required
                        className="w-4 h-4 accent-red-700 flex-shrink-0"
                      />
                      <span className="text-sm font-semibold text-gray-800">{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

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
                  disabled={checkingEmail}
                  className="flex-1 py-3 px-4 bg-red-700 hover:bg-red-800 disabled:bg-red-300 text-white font-semibold rounded-xl transition-colors"
                >
                  {checkingEmail ? 'Prüfe E-Mail…' : 'Weiter'}
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
