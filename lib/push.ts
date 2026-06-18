import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'

function initVapid() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  )
}

async function logNotification(
  userId: string | null,
  category: string,
  title: string,
  body: string,
  dedupeKey: string | null,
  status: 'sent' | 'failed' | 'skipped',
  errorMessage?: string
) {
  const supabase = createAdminClient()
  try {
    await supabase.from('notification_log').insert({
      user_id: userId,
      category,
      title,
      body,
      dedupe_key: dedupeKey,
      status,
      error_message: errorMessage,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
    })
  } catch {
    // Silently fail on logging errors
  }
}

export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  url = '/tipps',
  category = 'manual',
  dedupeKey?: string
) {
  console.log(`[push] sendPushToUser start: userId=${userId} category=${category} dedupeKey=${dedupeKey}`)

  if (!process.env.VAPID_SUBJECT || !process.env.VAPID_PRIVATE_KEY) {
    console.log('[push] skipped: VAPID keys missing')
    await logNotification(userId, category, title, body, dedupeKey ?? null, 'skipped', 'VAPID keys missing')
    return
  }

  const supabase = createAdminClient()

  if (dedupeKey) {
    const { data: existing, error: dedupeErr } = await supabase
      .from('notification_log')
      .select('id')
      .eq('dedupe_key', dedupeKey)
      .eq('status', 'sent')
      .limit(1)
      .single()
    if (dedupeErr) console.log(`[push] dedupe query error: ${dedupeErr.message}`)

    if (existing) {
      console.log('[push] skipped: already sent (dedupe)')
      await logNotification(userId, category, title, body, dedupeKey, 'skipped', 'Already sent')
      return
    }
  }

  const { data: prefData, error: prefErr } = await supabase
    .from('notification_preferences')
    .select('push_enabled')
    .eq('user_id', userId)
    .single()
  console.log(`[push] prefData=${JSON.stringify(prefData)} prefErr=${prefErr?.message}`)

  if (!prefData?.push_enabled) {
    console.log('[push] skipped: push disabled or no pref row')
    await logNotification(userId, category, title, body, dedupeKey ?? null, 'skipped', 'User disabled push')
    return
  }

  initVapid()
  const { data: subs, error: subsErr } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)
  console.log(`[push] subs count=${subs?.length} subsErr=${subsErr?.message}`)

  if (!subs || subs.length === 0) {
    console.log('[push] skipped: no subscriptions')
    await logNotification(userId, category, title, body, dedupeKey ?? null, 'skipped', 'No subscriptions')
    return
  }

  const payload = JSON.stringify({ title, body, url })
  const failed: string[] = []
  let sentCount = 0

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
        sentCount++
      } catch (err) {
        failed.push(sub.endpoint)
        console.error(`Push failed for ${sub.endpoint}:`, err)
      }
    })
  )

  if (failed.length > 0) {
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .in('endpoint', failed)
  }

  if (sentCount > 0) {
    await logNotification(userId, category, title, body, dedupeKey ?? null, 'sent')
  } else {
    await logNotification(
      userId,
      category,
      title,
      body,
      dedupeKey ?? null,
      'failed',
      `All ${failed.length} subscriptions failed`
    )
  }
}

export async function sendPushToAll(title: string, body: string, url = '/tipps', category = 'broadcast', dedupeKey?: string) {
  if (!process.env.VAPID_SUBJECT || !process.env.VAPID_PRIVATE_KEY) return
  initVapid()

  const admin = createAdminClient()

  if (dedupeKey) {
    const { data: existing } = await admin
      .from('notification_log')
      .select('id')
      .eq('dedupe_key', dedupeKey)
      .eq('status', 'sent')
      .limit(1)
      .single()

    if (existing) {
      console.log(`Push deduplicated: ${dedupeKey}`)
      return
    }
  }

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('user_id, endpoint, p256dh, auth')

  if (!subs || subs.length === 0) return

  const payload = JSON.stringify({ title, body, url })
  const failed: string[] = []
  const sentUsers = new Set<string>()
  const failedUsers = new Set<string>()

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
        sentUsers.add(sub.user_id)
      } catch (err) {
        failed.push(sub.endpoint)
        failedUsers.add(sub.user_id)
      }
    })
  )

  if (failed.length > 0) {
    await admin
      .from('push_subscriptions')
      .delete()
      .in('endpoint', failed)
  }

  for (const userId of sentUsers) {
    logNotification(userId, category, title, body, dedupeKey ?? null, 'sent').catch(() => {})
  }

  if (dedupeKey) {
    await logNotification(null, category, title, body, dedupeKey, 'sent').catch(() => {})
  }
}
