import webpush from 'web-push'
import { createClient } from '@/lib/supabase/server'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

export async function sendPushToUser(userId: string, title: string, body: string, url = '/tipps') {
  const supabase = await createClient()
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
