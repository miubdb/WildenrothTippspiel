import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { HOME_MODE_KEY, HOME_MODE_SETTINGS, type HomeModeSetting } from '@/lib/homeMode'

/** Admin: Startseiten-Modus der Tippen-Seite setzen (auto / winter / normal), siehe lib/homeMode.ts. */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })
  const { data: profile } = await supabase.from('profiles').select('is_admin, username, display_name').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  const body = await request.json().catch(() => null) as { mode?: string } | null
  const mode = body?.mode as HomeModeSetting | undefined
  if (!mode || !HOME_MODE_SETTINGS.includes(mode)) return NextResponse.json({ error: 'Ungültiger Modus.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: before } = await admin.from('app_settings').select('value').eq('key', HOME_MODE_KEY).maybeSingle()
  const { error } = mode === 'auto'
    ? await admin.from('app_settings').delete().eq('key', HOME_MODE_KEY)
    : await admin.from('app_settings').upsert({ key: HOME_MODE_KEY, value: mode, updated_at: new Date().toISOString() })

  await logAdminAction({
    actorId: user.id, actorName: profile.display_name || profile.username || 'Admin',
    action: 'home_mode_change', objectType: 'app_settings', objectId: HOME_MODE_KEY,
    oldValue: before?.value ?? null, newValue: mode === 'auto' ? null : mode,
    success: !error, errorMessage: error?.message ?? null,
  })
  if (error) return NextResponse.json({ error: 'Speichern fehlgeschlagen.' }, { status: 500 })
  return NextResponse.json({ ok: true, mode })
}
