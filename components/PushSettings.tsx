'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export function PushSettings() {
  const [pushEnabled, setPushEnabled] = useState(false)
  const [hasSubscription, setHasSubscription] = useState(false)
  const [loading, setLoading] = useState(true)
  const [testLoading, setTestLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const supabase = createClient()

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('push_enabled')
      .eq('user_id', user.id)
      .single()

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id')
      .eq('user_id', user.id)
      .limit(1)

    setPushEnabled(prefs?.push_enabled ?? true)
    setHasSubscription((subs?.length ?? 0) > 0)
    setLoading(false)
  }

  async function togglePushEnabled(value: boolean) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase.from('notification_preferences').upsert({
      user_id: user.id,
      push_enabled: value,
    })

    setPushEnabled(value)
    setMessage({ type: 'success', text: value ? 'Benachrichtigungen aktiviert' : 'Benachrichtigungen deaktiviert' })
    setTimeout(() => setMessage(null), 3000)
  }

  async function sendTestPush() {
    setTestLoading(true)
    setMessage(null)

    const res = await fetch('/api/push/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    setTestLoading(false)

    if (res.ok) {
      setMessage({ type: 'success', text: 'Test-Push gesendet! Schau auf dein Gerät.' })
    } else {
      const err = await res.json()
      setMessage({ type: 'error', text: err.error || 'Fehler beim Senden des Test-Push' })
    }

    setTimeout(() => setMessage(null), 5000)
  }

  if (loading) return <div className="animate-pulse h-32 bg-gray-200 rounded-xl" />

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-semibold text-gray-900 text-sm">Push-Benachrichtigungen</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {hasSubscription
                ? 'Benachrichtigungen sind aktiv'
                : 'Aktiviere Push im Browser, um Benachrichtigungen zu erhalten'}
            </div>
          </div>
          <button
            onClick={() => togglePushEnabled(!pushEnabled)}
            disabled={!hasSubscription}
            className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
              pushEnabled && hasSubscription ? 'bg-red-600' : 'bg-gray-300'
            } ${!hasSubscription ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${
                pushEnabled && hasSubscription ? 'right-1' : 'left-1'
              }`}
            />
          </button>
        </div>

        {hasSubscription && pushEnabled && (
          <button
            onClick={sendTestPush}
            disabled={testLoading}
            className="w-full py-2 px-3 bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-700 font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
          >
            {testLoading ? (
              <>
                <span className="animate-spin w-3 h-3 border-2 border-red-600 border-t-transparent rounded-full" />
                Sende Test...
              </>
            ) : (
              '🧪 Test-Push senden'
            )}
          </button>
        )}
      </div>

      {message && (
        <div
          className={`px-4 py-3 rounded-lg text-sm font-medium ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  )
}
