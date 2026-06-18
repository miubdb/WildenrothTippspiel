import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser } from '@/lib/push'

export async function POST(request: NextRequest) {
  // Env check first — surface missing vars immediately
  const missingEnv = ['SUPABASE_SERVICE_ROLE_KEY', 'VAPID_SUBJECT', 'VAPID_PRIVATE_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY']
    .filter(k => !process.env[k])
  if (missingEnv.length > 0) {
    return NextResponse.json(
      { error: `Fehlende Umgebungsvariablen in Vercel: ${missingEnv.join(', ')}` },
      { status: 500 }
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  const body = await request.json()
  const { targetUserId } = body

  // Nutzer können nur sich selbst testen, Admins jeden
  if (targetUserId && targetUserId !== user.id && !profile?.is_admin) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })
  }

  const userId = targetUserId ?? user.id

  // Check if user has subscriptions
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id')
    .eq('user_id', userId)
    .limit(1)

  if (!subs || subs.length === 0) {
    return NextResponse.json(
      { error: 'Keine Push-Subscriptions gefunden.' },
      { status: 400 }
    )
  }

  // Auto-enable push if subscriptions exist (test implies intent to receive)
  await admin
    .from('notification_preferences')
    .upsert({ user_id: userId, push_enabled: true })

  // Send test push
  await sendPushToUser(
    userId,
    '🧪 Test-Benachrichtigung',
    'Wenn du das siehst, funktioniert Push zuverlässig!',
    '/profil',
    'test_push',
    `test-push-${userId}-${Date.now()}`
  )

  return NextResponse.json({
    success: true,
    message: 'Test-Push gesendet',
    info: {
      targetUserId: userId,
      subscriptionsCount: subs.length,
      timestamp: new Date().toISOString(),
    },
  })
}

// GET für Admin-Übersicht
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })
  }

  // Admin overview
  const [
    { count: totalUsers },
    { count: pushEnabledCount },
    { count: subscriptionsCount },
    { data: recentErrors },
  ] = await Promise.all([
    admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('eligible_for_current_season', true),
    admin
      .from('notification_preferences')
      .select('id', { count: 'exact', head: true })
      .eq('push_enabled', true),
    admin
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true }),
    admin
      .from('notification_log')
      .select('user_id, category, title, error_message, sent_at')
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  return NextResponse.json({
    pushOverview: {
      totalEligibleUsers: totalUsers ?? 0,
      usersWithPushEnabled: pushEnabledCount ?? 0,
      activeSubscriptions: subscriptionsCount ?? 0,
      enablementRate: totalUsers ? (((pushEnabledCount ?? 0) / totalUsers) * 100).toFixed(1) : 'N/A',
    },
    recentErrors: (recentErrors ?? []).slice(0, 5),
  })
}
