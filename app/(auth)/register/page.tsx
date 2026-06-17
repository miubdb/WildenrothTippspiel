'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function RegisterPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    inviteCode: '',
    username: '',
    displayName: '',
    email: '',
    password: '',
    passwordConfirm: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
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
    if (form.username.length < 3) {
      setError('Der Benutzername muss mindestens 3 Zeichen lang sein.')
      return
    }

    setLoading(true)

    const supabase = createClient()

    // Validate invite code
    const { data: inviteData, error: inviteError } = await supabase
      .from('invite_codes')
      .select('id, max_uses, used_count, is_active')
      .eq('code', form.inviteCode.trim().toUpperCase())
      .single()

    if (inviteError || !inviteData) {
      setError('Ungültiger Einladungscode.')
      setLoading(false)
      return
    }
    if (!inviteData.is_active) {
      setError('Dieser Einladungscode ist nicht mehr aktiv.')
      setLoading(false)
      return
    }
    if (inviteData.max_uses !== null && inviteData.used_count >= inviteData.max_uses) {
      setError('Dieser Einladungscode wurde bereits zu oft verwendet.')
      setLoading(false)
      return
    }

    // Check username uniqueness
    const { data: existingUser } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', form.username.trim())
      .single()

    if (existingUser) {
      setError('Dieser Benutzername ist bereits vergeben.')
      setLoading(false)
      return
    }

    // Register user
    const { error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: {
          username: form.username.trim(),
          display_name: form.displayName.trim() || form.username.trim(),
        },
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    // Increment invite code usage
    await supabase
      .from('invite_codes')
      .update({ used_count: inviteData.used_count + 1 })
      .eq('id', inviteData.id)

    // Saisonstart-Regel: bei Registrierung nach Saisonstart als nicht teilnahmeberechtigt markieren
    try {
      await fetch('/api/auth/register-eligibility', { method: 'POST' })
    } catch {
      // best-effort; Admin kann Berechtigung manuell setzen
    }

    router.push('/tipps')
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
          <label htmlFor="inviteCode" className="block text-sm font-medium text-gray-700 mb-1">
            Einladungscode
          </label>
          <input
            id="inviteCode"
            name="inviteCode"
            type="text"
            required
            value={form.inviteCode}
            onChange={handleChange}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 placeholder-gray-400 uppercase tracking-widest transition"
            placeholder="WILDENROTH2025"
          />
        </div>

        <div>
          <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
            Benutzername
          </label>
          <input
            id="username"
            name="username"
            type="text"
            required
            value={form.username}
            onChange={handleChange}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 placeholder-gray-400 transition"
            placeholder="deinname"
          />
        </div>

        <div>
          <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-1">
            Anzeigename <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            value={form.displayName}
            onChange={handleChange}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 placeholder-gray-400 transition"
            placeholder="Dein vollständiger Name"
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
