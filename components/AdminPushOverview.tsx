'use client'

import { useState, useEffect } from 'react'

interface PushStats {
  totalEligibleUsers: number
  usersWithPushEnabled: number
  activeSubscriptions: number
  enablementRate: string | number
  recentErrors: Array<{
    user_id: string | null
    category: string
    title: string
    error_message: string | null
    sent_at: string | null
  }>
}

export function AdminPushOverview() {
  const [stats, setStats] = useState<PushStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [testLoading, setTestLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    loadStats()
  }, [])

  async function loadStats() {
    setLoading(true)
    const res = await fetch('/api/push/test', {
      headers: { 'Content-Type': 'application/json' },
    })

    if (res.ok) {
      const data = await res.json()
      setStats(data.pushOverview)
    }
    setLoading(false)
  }

  async function sendTestToMe() {
    setTestLoading(true)
    setMessage(null)

    const res = await fetch('/api/push/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    setTestLoading(false)

    if (res.ok) {
      setMessage('✓ Test-Push an dich selbst gesendet')
      await new Promise(r => setTimeout(r, 2000))
      setMessage(null)
    } else {
      const err = await res.json()
      setMessage(`✗ Fehler: ${err.error}`)
    }
  }

  if (loading) return <div className="animate-pulse h-40 bg-gray-200 rounded-xl" />

  if (!stats) return <div className="text-red-600 text-sm">Push-Daten konnten nicht geladen werden</div>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
          <div className="text-2xl font-black text-blue-600">{stats.usersWithPushEnabled}</div>
          <div className="text-[10px] text-blue-700 font-semibold leading-tight">
            Nutzer mit Push aktiviert
          </div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2">
          <div className="text-2xl font-black text-green-600">{stats.activeSubscriptions}</div>
          <div className="text-[10px] text-green-700 font-semibold leading-tight">
            Aktive Push-Subscriptions
          </div>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-xl px-3 py-2 col-span-2">
          <div className="text-2xl font-black text-purple-600">
            {typeof stats.enablementRate === 'string' ? stats.enablementRate : stats.enablementRate.toFixed(1)}%
          </div>
          <div className="text-[10px] text-purple-700 font-semibold leading-tight">
            Aktivierungsquote ({stats.totalEligibleUsers} berechtigt)
          </div>
        </div>
      </div>

      <button
        onClick={sendTestToMe}
        disabled={testLoading}
        className="w-full py-2 px-3 bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-700 font-semibold rounded-lg text-sm transition-colors"
      >
        {testLoading ? '🧪 Sende Test...' : '🧪 Test-Push an mich'}
      </button>

      {message && (
        <div className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium">
          {message}
        </div>
      )}

      {stats.recentErrors && stats.recentErrors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
          <div className="text-xs font-semibold text-red-700 mb-2">⚠️ Letzte Fehler</div>
          <div className="space-y-1 text-[11px] text-red-600">
            {stats.recentErrors.map((err, i) => (
              <div key={i} className="line-clamp-2">
                {err.title}: {err.error_message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
