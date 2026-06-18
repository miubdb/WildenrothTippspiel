import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const TEST_MATCHDAY = 999
const BALANCE_SNAPSHOT_PREFIX = 'test_balance_snapshot_'

// 6 test matches: [homeTeamId, awayTeamId, offsetMinutes, label]
// Team IDs from DB: 14=SpVgg Wildenroth, 8=SC Schöngeising, 1=SV Germering,
//   2=TSV Hechendorf, 3=TSV Alling, 4=1.SC Gröbenzell, 6=Gautinger SC,
//   7=SpFr Breitbrunn, 5=SC Fürstenfeldbruck, 10=VfL Egenburg, 11=FC Landsberied, 9=TSV Geiselbullach II
const TEST_MATCHES = [
  { home: 14, away: 8,  offsetMin: 5,   label: 'Wildenroth-Heimspiel (Torschützen-Test, Anpfiff in 5 Min)' },
  { home: 1,  away: 2,  offsetMin: 30,  label: 'Normales Spiel (1X2/O-U, Anpfiff in 30 Min)' },
  { home: 3,  away: 4,  offsetMin: 90,  label: 'Späteres Spiel für Sichtbarkeits-Test (Anpfiff in 90 Min)' },
  { home: 6,  away: 7,  offsetMin: 150, label: 'Kombi-/Risky-Testspiel (Anpfiff in 150 Min)' },
  { home: 5,  away: 10, offsetMin: 210, label: 'Spiel zum Verschieben (Postpone-Test, Anpfiff in 210 Min)' },
  { home: 11, away: 9,  offsetMin: 270, label: 'Abschluss-Spiel (letzter Anpfiff, Anpfiff in 270 Min)' },
] as const

async function isAdmin(req: Request): Promise<{ ok: boolean; userId?: string; balance?: number }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const { data: profile } = await supabase.from('profiles').select('is_admin, balance').eq('id', user.id).single()
  if (!profile?.is_admin) return { ok: false }
  return { ok: true, userId: user.id, balance: profile.balance as number }
}

export async function GET() {
  const auth = await isAdmin(new Request('http://x'))
  if (!auth.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: testMatches } = await admin
    .from('matches')
    .select('id, match_date, status, home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name)')
    .eq('matchday', TEST_MATCHDAY)
    .order('match_date')

  const mapped = (testMatches ?? []).map(m => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  }))

  return NextResponse.json({ exists: mapped.length > 0, matches: mapped })
}

export async function POST(req: Request) {
  const auth = await isAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const body = await req.json()

  // ── Seed ──────────────────────────────────────────────────────────────────
  if (body.action === 'seed') {
    const { data: existing } = await admin
      .from('matches').select('id').eq('matchday', TEST_MATCHDAY).limit(1).single()
    if (existing) {
      return NextResponse.json({ error: 'Test-Spieltag existiert bereits. Erst teardown ausführen.' }, { status: 400 })
    }

    // Save balance snapshot so teardown can restore it
    await admin.from('app_settings').upsert({
      key: `${BALANCE_SNAPSHOT_PREFIX}${auth.userId}`,
      value: String(auth.balance),
      updated_at: new Date().toISOString(),
    })

    const now = new Date()
    const matchRows = TEST_MATCHES.map((m, idx) => ({
      match_number: 9990 + idx + 1,
      matchday: TEST_MATCHDAY,
      home_team_id: m.home,
      away_team_id: m.away,
      match_date: new Date(now.getTime() + m.offsetMin * 60_000).toISOString(),
      status: 'scheduled',
    }))

    const { data: created, error } = await admin.from('matches').insert(matchRows).select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      ok: true,
      matchday: TEST_MATCHDAY,
      created: created?.length ?? 0,
      note: 'Bets placed on matchday 999 use season=TEST and are excluded from leaderboard P&L.',
    })
  }

  // ── Teardown ──────────────────────────────────────────────────────────────
  if (body.action === 'teardown') {
    const { data: testMatches } = await admin
      .from('matches').select('id').eq('matchday', TEST_MATCHDAY)
    const testMatchIds = (testMatches ?? []).map(m => m.id)

    let betsDeleted = 0
    let combosDeleted = 0

    if (testMatchIds.length > 0) {
      // Collect combo IDs before deleting bets
      const { data: testBets } = await admin
        .from('bets').select('id, combo_id').in('match_id', testMatchIds)
      const testBetIds = (testBets ?? []).map(b => b.id)
      const comboIds = [...new Set((testBets ?? []).filter(b => b.combo_id != null).map(b => b.combo_id as number))]

      if (comboIds.length > 0) {
        await admin.from('combo_bets').delete().in('id', comboIds)
        combosDeleted = comboIds.length
      }
      if (testBetIds.length > 0) {
        await admin.from('bets').delete().in('id', testBetIds)
        betsDeleted = testBetIds.length
      }

      await admin.from('matches').delete().eq('matchday', TEST_MATCHDAY)

      // Clean up notification_log entries for test matchday
      await admin.from('notification_log').delete().eq('dedupe_key', `betting-open-${TEST_MATCHDAY}`)
      await admin.from('notification_log').delete().like('dedupe_key', `bet-reminder-${TEST_MATCHDAY}-%`)
      // Settlement notifications
      for (const matchId of testMatchIds) {
        await admin.from('notification_log').delete().like('dedupe_key', `%-${matchId}`)
      }

      // Clean up push_reminders
      await admin.from('push_reminders').delete().eq('matchday', TEST_MATCHDAY)
    }

    // Restore admin balance from snapshot
    let balanceRestored: number | null = null
    const { data: snapshot } = await admin
      .from('app_settings').select('value').eq('key', `${BALANCE_SNAPSHOT_PREFIX}${auth.userId}`).single()
    if (snapshot) {
      const restored = parseFloat(snapshot.value)
      if (!isNaN(restored)) {
        await admin.from('profiles').update({ balance: restored }).eq('id', auth.userId)
        balanceRestored = restored
      }
      await admin.from('app_settings').delete().eq('key', `${BALANCE_SNAPSHOT_PREFIX}${auth.userId}`)
    }

    return NextResponse.json({
      ok: true,
      matchesDeleted: testMatchIds.length,
      betsDeleted,
      combosDeleted,
      balanceRestored,
    })
  }

  return NextResponse.json({ error: 'Unknown action: use seed or teardown' }, { status: 400 })
}
