'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export function PushSubscribeButton() {
  const [state, setState] = useState<'unsupported' | 'loading' | 'subscribed' | 'unsubscribed'>('loading')
  const supabase = createClient()

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported')
      return
    }
    navigator.serviceWorker.register('/sw.js').then(async (reg) => {
      const existing = await reg.pushManager.getSubscription()
      if (existing) {
        // Ensure DB reflects the active subscription
        const supabaseClient = createClient()
        const { data: { user } } = await supabaseClient.auth.getUser()
        if (user) {
          await supabaseClient.from('notification_preferences').upsert({
            user_id: user.id,
            push_enabled: true,
          })
        }
        setState('subscribed')
      } else {
        setState('unsubscribed')
      }
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
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })

      if (res.ok) {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await supabase.from('notification_preferences').upsert({
            user_id: user.id,
            push_enabled: true,
          })
        }
      }

      setState('subscribed')
    } catch (err) {
      console.error('Push subscribe error:', err)
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
    } catch (err) {
      console.error('Push unsubscribe error:', err)
      setState('unsubscribed')
    }
  }

  if (state === 'unsupported') return null

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold text-gray-900 text-sm">Browser Push-Notifications</div>
          <div className="text-xs text-gray-400 mt-0.5">
            {state === 'subscribed'
              ? 'Browser hat Zugriff auf Benachrichtigungen'
              : 'Erlaube dem Browser, Benachrichtigungen zu senden'}
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
