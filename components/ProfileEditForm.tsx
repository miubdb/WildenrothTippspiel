'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LEAGUE_TEAMS, crestPath } from '@/lib/teams'

type Field = 'username' | 'password'

interface Props {
  userId: string
  displayName: string
  username: string
  avatarUrl: string | null
  bio: string | null
  favoriteTeam: string | null
}

export function ProfileEditForm({
  userId,
  displayName: initialDisplayName,
  username: initialUsername,
  avatarUrl: initialAvatarUrl,
  bio: initialBio,
  favoriteTeam: initialFavoriteTeam,
}: Props) {
  const [open, setOpen] = useState(false)
  const supabase = createClient()

  // ── New combined profile fields (avatar, display_name, bio, favorite team) ──
  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [bio, setBio] = useState(initialBio ?? '')
  const [favoriteTeam, setFavoriteTeam] = useState(initialFavoriteTeam ?? '')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [saving, setSaving] = useState(false)
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)

  // ── Username / Password (kept via existing API route) ──
  const [activeField, setActiveField] = useState<Field | null>(null)
  const [username, setUsername] = useState(initialUsername)
  const [usernameInput, setUsernameInput] = useState(initialUsername)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPendingFile(file)
    setPreviewUrl(URL.createObjectURL(file))
    setProfileSuccess(null)
    setProfileError(null)
  }

  async function saveProfile() {
    setSaving(true)
    setProfileError(null)
    setProfileSuccess(null)

    try {
      let newAvatarUrl = avatarUrl

      if (pendingFile) {
        const ext = (pendingFile.name.split('.').pop() || 'png').toLowerCase()
        const path = `${userId}/avatar.${ext}`
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, pendingFile, { upsert: true, contentType: pendingFile.type })
        if (uploadError) throw uploadError
        const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
        // Cache-bust so the new image shows immediately
        newAvatarUrl = `${pub.publicUrl}?v=${Date.now()}`
      }

      const trimmedName = displayName.trim()
      if (!trimmedName) {
        setProfileError('Anzeigename darf nicht leer sein')
        setSaving(false)
        return
      }

      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          display_name: trimmedName,
          bio: bio.trim() ? bio.trim() : null,
          favorite_team: favoriteTeam ? favoriteTeam : null,
          avatar_url: newAvatarUrl,
        })
        .eq('id', userId)
      if (updateError) throw updateError

      setAvatarUrl(newAvatarUrl)
      setPendingFile(null)
      setPreviewUrl(null)
      setProfileSuccess('Profil gespeichert')
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Fehler beim Speichern')
    } finally {
      setSaving(false)
    }
  }

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

    const body: Record<string, string> = { field }

    if (field === 'username') {
      body.value = usernameInput.trim()
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

    if (field === 'username') setUsername(data.newValue)
    if (field === 'password') {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }

    setSuccess(field === 'username' ? 'Benutzername aktualisiert' : 'Passwort geändert')
    setActiveField(null)
  }

  const shownAvatar = previewUrl ?? avatarUrl
  const initial = (displayName || username || '?')[0].toUpperCase()

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 border-b border-gray-50 dark:border-gray-700"
        onClick={() => { setOpen(o => !o); setActiveField(null); setSuccess(null); setError(null) }}
      >
        <h2 className="font-bold text-gray-900 dark:text-gray-100">Profil bearbeiten</h2>
        <span className="text-gray-400 text-lg leading-none">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="divide-y divide-gray-50 dark:divide-gray-700">
          {/* ── Avatar + display_name + bio + favorite team ── */}
          <div className="px-4 py-4 space-y-4">
            {/* Avatar */}
            <div className="flex items-center gap-4">
              {shownAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={shownAvatar}
                  alt="Avatar"
                  className="w-16 h-16 rounded-full object-cover flex-shrink-0 border border-gray-200 dark:border-gray-600"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-red-700 flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-black text-2xl">{initial}</span>
                </div>
              )}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-sm font-semibold text-red-700 hover:text-red-800"
                >
                  Bild auswählen
                </button>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  {pendingFile ? pendingFile.name : 'JPG oder PNG'}
                </p>
              </div>
            </div>

            {/* Display name */}
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 font-medium block mb-1">Anzeigename</label>
              <input
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Dein Anzeigename"
              />
            </div>

            {/* Bio */}
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 font-medium block mb-1">Motto / Bio</label>
              <textarea
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 resize-none"
                value={bio}
                onChange={e => setBio(e.target.value.slice(0, 160))}
                rows={2}
                maxLength={160}
                placeholder="Sag etwas über dich…"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 text-right">{bio.length}/160</p>
            </div>

            {/* Favorite team */}
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 font-medium block mb-1">Lieblingsverein</label>
              <select
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                value={favoriteTeam}
                onChange={e => setFavoriteTeam(e.target.value)}
              >
                <option value="">—</option>
                {LEAGUE_TEAMS.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              {favoriteTeam && (
                <div className="flex items-center gap-2 mt-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={crestPath(favoriteTeam)} alt="" className="w-5 h-5 object-contain" />
                  <span className="text-xs text-gray-500 dark:text-gray-400">{favoriteTeam}</span>
                </div>
              )}
            </div>

            <div>
              {profileError && <p className="text-xs text-red-600 mb-1">{profileError}</p>}
              {profileSuccess && <p className="text-xs text-green-600 mb-1">{profileSuccess}</p>}
              <button
                onClick={saveProfile}
                disabled={saving}
                className="w-full py-2 bg-red-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 hover:bg-red-800 transition-colors"
              >
                {saving ? 'Speichern…' : 'Speichern'}
              </button>
            </div>
          </div>

          {/* Username */}
          <FieldRow
            label="Benutzername"
            currentValue={`@${username}`}
            active={activeField === 'username'}
            onEdit={() => openField('username')}
            onCancel={() => { setActiveField(null); setError(null); setSuccess(null) }}
          >
            <input
              className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
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
              className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 mb-2"
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="Aktuelles Passwort"
              autoFocus
            />
            <input
              className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 mb-2"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Neues Passwort"
            />
            <input
              className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
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
        <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{label}</span>
        {active ? (
          <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600">Abbrechen</button>
        ) : (
          <button onClick={onEdit} className="text-xs text-red-700 font-semibold hover:text-red-800">Ändern</button>
        )}
      </div>
      {!active && <div className="text-sm text-gray-800 dark:text-gray-200">{currentValue}</div>}
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
