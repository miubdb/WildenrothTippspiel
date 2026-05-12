'use client'

import { useState } from 'react'

type Field = 'display_name' | 'username' | 'password'

interface Props {
  displayName: string
  username: string
}

export function ProfileEditForm({ displayName: initialDisplayName, username: initialUsername }: Props) {
  const [open, setOpen] = useState(false)
  const [activeField, setActiveField] = useState<Field | null>(null)

  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [username, setUsername] = useState(initialUsername)

  const [displayNameInput, setDisplayNameInput] = useState(initialDisplayName)
  const [usernameInput, setUsernameInput] = useState(initialUsername)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function openField(f: Field) {
    setActiveField(f)
    setSuccess(null)
    setError(null)
    if (!open) setOpen(true)
  }

  async function save(field: Field) {
    setLoading(true)
    setError(null)
    setSuccess(null)

    let value = ''
    let body: Record<string, string> = { field }

    if (field === 'display_name') {
      value = displayNameInput.trim()
      body.value = value
    } else if (field === 'username') {
      value = usernameInput.trim()
      body.value = value
    } else {
      if (newPassword !== confirmPassword) {
        setError('Passwörter stimmen nicht überein')
        setLoading(false)
        return
      }
      body.value = newPassword
      body.currentPassword = currentPassword
    }

    const res = await fetch('/api/profiles/update', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error ?? 'Fehler beim Speichern')
      return
    }

    if (field === 'display_name') setDisplayName(data.newValue)
    if (field === 'username') setUsername(data.newValue)
    if (field === 'password') {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }

    setSuccess(
      field === 'display_name' ? 'Anzeigename aktualisiert' :
      field === 'username' ? 'Benutzername aktualisiert' :
      'Passwort geändert'
    )
    setActiveField(null)
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 border-b border-gray-50"
        onClick={() => { setOpen(o => !o); setActiveField(null); setSuccess(null); setError(null) }}
      >
        <h2 className="font-bold text-gray-900">Profil bearbeiten</h2>
        <span className="text-gray-400 text-lg leading-none">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="divide-y divide-gray-50">
          {/* Display Name */}
          <FieldRow
            label="Anzeigename"
            currentValue={displayName}
            active={activeField === 'display_name'}
            onEdit={() => openField('display_name')}
            onCancel={() => { setActiveField(null); setError(null); setSuccess(null) }}
          >
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
              value={displayNameInput}
              onChange={e => setDisplayNameInput(e.target.value)}
              placeholder="Dein Anzeigename"
              autoFocus
            />
            <SaveRow loading={loading} onSave={() => save('display_name')} error={error} success={success} />
          </FieldRow>

          {/* Username */}
          <FieldRow
            label="Benutzername"
            currentValue={`@${username}`}
            active={activeField === 'username'}
            onEdit={() => openField('username')}
            onCancel={() => { setActiveField(null); setError(null); setSuccess(null) }}
          >
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
              value={usernameInput}
              onChange={e => setUsernameInput(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder="benutzername"
              autoFocus
            />
            <SaveRow loading={loading} onSave={() => save('username')} error={error} success={success} />
          </FieldRow>

          {/* Password */}
          <FieldRow
            label="Passwort"
            currentValue="••••••••"
            active={activeField === 'password'}
            onEdit={() => openField('password')}
            onCancel={() => { setActiveField(null); setError(null); setSuccess(null) }}
          >
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 mb-2"
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="Aktuelles Passwort"
              autoFocus
            />
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 mb-2"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Neues Passwort"
            />
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Neues Passwort bestätigen"
            />
            <SaveRow loading={loading} onSave={() => save('password')} error={error} success={success} />
          </FieldRow>
        </div>
      )}
    </div>
  )
}

function FieldRow({
  label,
  currentValue,
  active,
  onEdit,
  onCancel,
  children,
}: {
  label: string
  currentValue: string
  active: boolean
  onEdit: () => void
  onCancel: () => void
  children: React.ReactNode
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-500 font-medium">{label}</span>
        {active ? (
          <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600">Abbrechen</button>
        ) : (
          <button onClick={onEdit} className="text-xs text-red-700 font-semibold hover:text-red-800">Ändern</button>
        )}
      </div>
      {!active && <div className="text-sm text-gray-800">{currentValue}</div>}
      {active && <div className="space-y-2 mt-2">{children}</div>}
    </div>
  )
}

function SaveRow({ loading, onSave, error, success }: {
  loading: boolean
  onSave: () => void
  error: string | null
  success: string | null
}) {
  return (
    <div className="mt-2">
      {error && <p className="text-xs text-red-600 mb-1">{error}</p>}
      {success && <p className="text-xs text-green-600 mb-1">{success}</p>}
      <button
        onClick={onSave}
        disabled={loading}
        className="w-full py-2 bg-red-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 hover:bg-red-800 transition-colors"
      >
        {loading ? 'Speichern…' : 'Speichern'}
      </button>
    </div>
  )
}
