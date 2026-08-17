import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Self-service account deletion. Mirrors the admin soft-delete exactly (see
 * app/api/admin/season/route.ts's soft_delete_user): bans login (10y —
 * GoTrue has no permanent-ban concept) and sets profiles.deleted_at, but
 * never hard-deletes the row — bets/combo_bets have no FK to profiles, so a
 * hard delete would silently orphan the user's own bet history instead of
 * preserving it (see CLAUDE.md). Only an admin can undo this (Verwaltung
 * tab "Reaktivieren") — a user can't self-restore, matching the "kannst du
 * nicht selbst rückgängig machen" warning shown before confirming.
 */
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin, deleted_at')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profil nicht gefunden.' }, { status: 404 })

  // The app currently has exactly one admin account — self-deletion here
  // would lock them out of the admin panel with no other admin able to
  // reactivate them. Blocked unconditionally rather than trusting a client
  // check, same reasoning as every other admin-only guard in this app.
  if (profile.is_admin) {
    return NextResponse.json({ error: 'Admin-Accounts können sich nicht selbst löschen.' }, { status: 403 })
  }
  if (profile.deleted_at) {
    return NextResponse.json({ error: 'Account ist bereits gelöscht.' }, { status: 400 })
  }

  const admin = createAdminClient()
  await admin.auth.admin.updateUserById(user.id, { ban_duration: '87600h' })
  await admin.from('profiles').update({ deleted_at: new Date().toISOString() }).eq('id', user.id)

  return NextResponse.json({ ok: true })
}
