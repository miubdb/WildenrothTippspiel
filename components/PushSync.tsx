'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

// Silently syncs push_enabled=true if a SW subscription exists.
// Mounted in the app layout so it runs on every page load.
export function PushSync() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription()
      if (!sub) return
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('notification_preferences').upsert({
        user_id: user.id,
        push_enabled: true,
      })
    }).catch(() => {})
  }, [])
  return null
}
