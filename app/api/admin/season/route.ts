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

  if (body.action === 'set_user_wildenroth') {
    await admin.from('profiles').update({ is_wildenroth: body.value }).eq('id', body.userId)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
