import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin, username, display_name').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  // Reset all balances to 1000 and record season_start_balance
  const { error } = await admin
    .from('profiles')
    .update({ balance: 1000, season_start_balance: 1000 })
    .neq('id', '00000000-0000-0000-0000-000000000000') // update all

  await logAdminAction({
    actorId: user.id, actorName: profile.display_name || profile.username,
    action: 'season_reset', objectType: 'profiles', newValue: { balance: 1000, season_start_balance: 1000 },
    success: !error, errorMessage: error?.message,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
