import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'

function initVapid() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  )
}

export async function sendPushToUser(userId: string, title: string, body: string, url = '/tipps') {
  if (!process.env.VAPID_SUBJECT || !process.env.VAPID_PRIVATE_KEY) return
  initVapid()
  // Use admin client so this works in cron/server contexts regardless of RLS
  const supabase = createAdminClient()
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key')
    .eq('user_id', userId)

  if (!subs || subs.length === 0) return

  const payload = JSON.stringify({ title, body, url })
  const failed: string[] = []

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload
        )
      } catch {
        failed.push(sub.endpoint)
      }
    })
  )

  // Remove expired/invalid subscriptions
  if (failed.length > 0) {
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .in('endpoint', failed)
  }
}

export async function sendPushToAll(title: string, body: string, url = '/tipps') {
  if (!process.env.VAPID_SUBJECT || !process.env.VAPID_PRIVATE_KEY) return
  initVapid()
  const admin = createAdminClient()
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('user_id, endpoint, p256dh, auth_key')

  if (!subs || subs.length === 0) return

  const payload = JSON.stringify({ title, body, url })
  const failed: string[] = []

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload
        )
      } catch {
        failed.push(sub.endpoint)
      }
    })
  )

  if (failed.length > 0) {
    await admin
      .from('push_subscriptions')
      .delete()
      .in('endpoint', failed)
  }
}
