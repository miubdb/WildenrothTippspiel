import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const body = await req.json()

  if (body.action === 'toggle_season_started') {
    await admin.from('app_settings').upsert({ key: 'season_started', value: body.value ? 'true' : 'false', updated_at: new Date().toISOString() })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'set_user_eligible') {
    await admin.from('profiles').update({
      eligible_for_current_season: body.eligible,
      ...(body.balance != null ? { balance: body.balance, season_start_balance: body.balance } : {})
    }).eq('id', body.userId)
    return NextResponse.json({ ok: true })
  }

  // Sets both team flags in a single atomic update, mirroring the four
  // registration categories 1:1 (see app/(auth)/register/page.tsx) — a role
  // switch (e.g. team1 -> team2) can never leave a stale flag from a
  // separate, previous update the way two independent toggle calls could.
  if (body.action === 'set_user_wildenroth_role') {
    const ROLE_FLAGS: Record<string, { is_wildenroth: boolean; is_wildenroth_ii: boolean }> = {
      fan: { is_wildenroth: false, is_wildenroth_ii: false },
      team1: { is_wildenroth: true, is_wildenroth_ii: false },
      team2: { is_wildenroth: false, is_wildenroth_ii: true },
      both: { is_wildenroth: true, is_wildenroth_ii: true },
    }
    const flags = ROLE_FLAGS[body.role]
    if (!flags) return NextResponse.json({ error: 'Unbekannte Rolle.' }, { status: 400 })
    if (!body.userId) return NextResponse.json({ error: 'userId fehlt.' }, { status: 400 })
    await admin.from('profiles').update(flags).eq('id', body.userId)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
