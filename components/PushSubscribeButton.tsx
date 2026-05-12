'use client'

import { useState, useEffect } from 'react'

export function PushSubscribeButton() {
  const [state, setState] = useState<'unsupported' | 'loading' | 'subscribed' | 'unsubscribed'>('loading')

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported')
      return
    }
    navigator.serviceWorker.register('/sw.js').then(async (reg) => {
      const existing = await reg.pushManager.getSubscription()
      setState(existing ? 'subscribed' : 'unsubscribed')
    }).catch(() => setState('unsupported'))
  }, [])

  async function subscribe() {
    setState('loading')
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      })
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      setState('subscribed')
    } catch {
      setState('unsubscribed')
    }
  }

  async function unsubscribe() {
    setState('loading')
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setState('unsubscribed')
    } catch {
      setState('unsubscribed')
    }
  }

  if (state === 'unsupported') return null

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold text-gray-900 text-sm">Push-Benachrichtigungen</div>
          <div className="text-xs text-gray-400 mt-0.5">
            {state === 'subscribed'
              ? 'Du wirst bei Wettentscheidungen benachrichtigt'
              : 'Erhalte Benachrichtigungen bei Wettentscheidungen'}
          </div>
        </div>
        {state === 'loading' ? (
          <div className="w-10 h-6 rounded-full bg-gray-200 animate-pulse" />
        ) : state === 'subscribed' ? (
          <button
            onClick={unsubscribe}
            className="relative w-10 h-6 rounded-full bg-red-600 transition-colors flex-shrink-0"
          >
            <span className="absolute right-1 top-1 w-4 h-4 rounded-full bg-white shadow" />
          </button>
        ) : (
          <button
            onClick={subscribe}
            className="relative w-10 h-6 rounded-full bg-gray-300 transition-colors flex-shrink-0"
          >
            <span className="absolute left-1 top-1 w-4 h-4 rounded-full bg-white shadow" />
          </button>
        )}
      </div>
    </div>
  )
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}
