import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Real push services only — otherwise the server-side webpush.sendNotification()
// call in lib/push.ts becomes an authenticated SSRF/port-scan primitive against
// any host+port a member cares to submit here (see app/api/push/test/route.ts,
// which reflects the connection outcome back to the caller).
const ALLOWED_PUSH_HOSTS = [
  /(^|\.)googleapis\.com$/,          // Chrome / FCM
  /(^|\.)push\.services\.mozilla\.com$/, // Firefox
  /(^|\.)notify\.windows\.com$/,     // Edge / Windows
  /(^|\.)push\.apple\.com$/,         // Safari
]
const MAX_SUBSCRIPTIONS_PER_USER = 10

function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  return ALLOWED_PUSH_HOSTS.some((re) => re.test(url.hostname))
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const body = await request.json()
  const { endpoint, keys } = body

  if (!isAllowedPushEndpoint(endpoint) || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: 'Ungültige Subscription.' }, { status: 400 })
  }

  const { count } = await supabase
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
  if ((count ?? 0) >= MAX_SUBSCRIPTIONS_PER_USER) {
    return NextResponse.json({ error: 'Zu viele registrierte Geräte.' }, { status: 429 })
  }

  await supabase.from('push_subscriptions').upsert({
    user_id: user.id,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
  }, { onConflict: 'user_id,endpoint' })

  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const { endpoint } = await request.json()
  await supabase.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', endpoint)
  return NextResponse.json({ success: true })
}
