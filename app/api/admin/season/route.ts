import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// profiles.email isn't RLS/GRANT-exposed to a normal session-scoped read (see
// CLAUDE.md) — the admin Verwaltung tab needs it, so this route reads the
// user list via the service-role client instead of the page querying
// `profiles` directly (which never gets email back regardless of is_admin).
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const [{ data: users }, { data: seenSetting }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, username, display_name, email, balance, eligible_for_current_season, is_admin, is_wildenroth, is_wildenroth_ii, deleted_at, created_at')
      .order('username'),
    admin.from('app_settings').select('value').eq('key', 'admin_new_users_seen_at').single(),
  ])

  return NextResponse.json({ users: users ?? [], newUsersSeenAt: seenSetting?.value ?? null })
}

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

  // Soft-delete: keeps the profiles row (and auth account) intact so a
  // user's already-placed bets/combos stay correctly attributed with their
  // name everywhere historical data is shown (recap, awards, admin bets
  // viewer, "Tipps der anderen" for bets they already placed) — bets/combo_bets
  // have no FK to profiles, so a hard delete would silently orphan that
  // history instead of preserving it. Also bans login (10y — GoTrue has no
  // "forever", see restore below) so a deactivated user can't place new bets.
  // Current-user listings (Rangliste, Admin-Verwaltung) filter on deleted_at;
  // Verwaltung deliberately still lists them (with a badge) so this is
  // reversible.
  if (body.action === 'soft_delete_user') {
    if (!body.userId) return NextResponse.json({ error: 'userId fehlt.' }, { status: 400 })
    await admin.auth.admin.updateUserById(body.userId, { ban_duration: '87600h' })
    await admin.from('profiles').update({ deleted_at: new Date().toISOString() }).eq('id', body.userId)
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'restore_user') {
    if (!body.userId) return NextResponse.json({ error: 'userId fehlt.' }, { status: 400 })
    await admin.auth.admin.updateUserById(body.userId, { ban_duration: 'none' })
    await admin.from('profiles').update({ deleted_at: null }).eq('id', body.userId)
    return NextResponse.json({ ok: true })
  }

  // Marks every user registered so far as "seen" — clears the "NEU"
  // highlighting/tab badge on the next Verwaltung load. Called when the admin
  // opens the Verwaltung tab; the CURRENT view keeps highlighting them (the
  // client doesn't overwrite its own already-loaded newUsersSeenAt), only a
  // later reload picks up the new cutoff.
  if (body.action === 'mark_new_users_seen') {
    const now = new Date().toISOString()
    await admin.from('app_settings').upsert({ key: 'admin_new_users_seen_at', value: now, updated_at: now })
    return NextResponse.json({ ok: true, seenAt: now })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
