import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const TEST_MATCHDAY = 999
// Single key stores a JSON map { userId: balance } for ALL users — restored on teardown
const BALANCE_SNAPSHOT_KEY = 'test_balance_snapshot'

// 6 test matches
// Team IDs: 14=SpVgg Wildenroth, 8=SC Schöngeising, 1=SV Germering,
//   2=TSV Hechendorf, 3=TSV Alling, 4=1.SC Gröbenzell, 6=Gautinger SC,
//   7=SpFr Breitbrunn, 5=SC Fürstenfeldbruck, 10=VfL Egenburg,
//   11=FC Landsberied, 9=TSV Geiselbullach II
const TEST_MATCHES = [
  { home: 14, away: 8,  offsetMin: 5   }, // Wildenroth-Heimspiel (Torschützen-Test)
  { home: 1,  away: 2,  offsetMin: 30  }, // Normales Spiel (1X2 / O-U / BTTS)
  { home: 3,  away: 4,  offsetMin: 90  }, // Späteres Spiel (Sichtbarkeit je Anpfiff)
  { home: 6,  away: 7,  offsetMin: 150 }, // Kombi- / Risky-Testspiel
  { home: 5,  away: 10, offsetMin: 210 }, // Postpone-Test
  { home: 11, away: 9,  offsetMin: 270 }, // Abschluss-Spiel
] as const

// ── Auth helper ─────────────────────────────────────────────────────────────

async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { ok: false }
  return { ok: true, userId: user.id }
}

// ── GET: status ──────────────────────────────────────────────────────────────

export async function GET() {
  const auth = await requireAdmin()
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

  const { data: snapshotRow } = await admin
    .from('app_settings').select('value').eq('key', BALANCE_SNAPSHOT_KEY).single()
  const snapshotExists = !!snapshotRow

  return NextResponse.json({ exists: mapped.length > 0, matches: mapped, snapshotExists })
}

// ── POST: seed / teardown ────────────────────────────────────────────────────

export async function POST(req: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const body = await req.json()

  // ── Seed ────────────────────────────────────────────────────────────────────
  if (body.action === 'seed') {
    const { data: existing } = await admin
      .from('matches').select('id').eq('matchday', TEST_MATCHDAY).limit(1).single()
    if (existing) {
      return NextResponse.json({ error: 'Test-Spieltag existiert bereits. Erst teardown ausführen.' }, { status: 400 })
    }

    // Snapshot ALL users' balances so teardown can restore everyone
    const { data: allProfiles } = await admin.from('profiles').select('id, balance')
    const snapshot: Record<string, number> = {}
    for (const p of allProfiles ?? []) snapshot[p.id] = p.balance as number

    await admin.from('app_settings').upsert({
      key: BALANCE_SNAPSHOT_KEY,
      value: JSON.stringify(snapshot),
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
      snapshotted: Object.keys(snapshot).length,
      note: 'Bets on matchday 999 use season=TEST, excluded from real leaderboard P&L. Teardown restores all user balances.',
    })
  }

  // ── Teardown ─────────────────────────────────────────────────────────────────
  // Idempotent: safe to run multiple times; always leaves a clean state.
  if (body.action === 'teardown') {

    // ── 1. Collect test match IDs ────────────────────────────────────────────
    const { data: testMatchRows } = await admin
      .from('matches').select('id').eq('matchday', TEST_MATCHDAY)
    const testMatchIds = (testMatchRows ?? []).map(m => m.id as number)

    // ── 2. Collect all test bet IDs and combo IDs ────────────────────────────
    //    Primary source: bets linked to test match IDs
    //    Fallback: any bets with season='TEST' (catch orphans)
    const betsByMatchId = testMatchIds.length > 0
      ? (await admin.from('bets').select('id, combo_id').in('match_id', testMatchIds)).data ?? []
      : []
    const betsBySeasonTest = (await admin.from('bets').select('id, combo_id').eq('season', 'TEST')).data ?? []

    const allTestBets = [...betsByMatchId, ...betsBySeasonTest]
    const testBetIds = [...new Set(allTestBets.map(b => b.id as number))]
    const testComboIds = [...new Set(
      allTestBets
        .filter(b => b.combo_id != null)
        .map(b => b.combo_id as number)
    )]

    // Also catch combo_bets with season='TEST' directly (belt-and-suspenders)
    const combosBySeasonTest = (await admin.from('combo_bets').select('id').eq('season', 'TEST')).data ?? []
    const finalComboIds = [...new Set([...testComboIds, ...combosBySeasonTest.map(c => c.id as number)])]

    // ── 3. Reactions & comments on test bets/combos ──────────────────────────
    if (testBetIds.length > 0) {
      await admin.from('reactions').delete().eq('target_type', 'bet').in('target_id', testBetIds)
      await admin.from('bet_comments').delete().eq('target_type', 'bet').in('target_id', testBetIds)
    }
    if (finalComboIds.length > 0) {
      await admin.from('reactions').delete().eq('target_type', 'combo').in('target_id', finalComboIds)
      await admin.from('bet_comments').delete().eq('target_type', 'combo').in('target_id', finalComboIds)
    }

    // ── 4. Delete combo_bets and bets ────────────────────────────────────────
    if (finalComboIds.length > 0) {
      await admin.from('combo_bets').delete().in('id', finalComboIds)
    }
    if (testBetIds.length > 0) {
      await admin.from('bets').delete().in('id', testBetIds)
    }

    // ── 5. Match-related tables (all keyed by match_id) ──────────────────────
    if (testMatchIds.length > 0) {
      await admin.from('odds').delete().in('match_id', testMatchIds)
      await admin.from('match_goalscorer_odds').delete().in('match_id', testMatchIds)
      await admin.from('match_goalscorers').delete().in('match_id', testMatchIds)
      await admin.from('match_lineups').delete().in('match_id', testMatchIds)
      await admin.from('match_odds_overrides').delete().in('match_id', testMatchIds)
    }
    // Belt-and-suspenders: also delete odds by matchday (odds table has matchday column)
    await admin.from('odds').delete().eq('matchday', TEST_MATCHDAY)

    // ── 6. Delete test matches ───────────────────────────────────────────────
    await admin.from('matches').delete().eq('matchday', TEST_MATCHDAY)

    // ── 7. Notification tables ───────────────────────────────────────────────
    await admin.from('notification_log').delete().eq('dedupe_key', `betting-open-${TEST_MATCHDAY}`)
    await admin.from('notification_log').delete().like('dedupe_key', `bet-reminder-${TEST_MATCHDAY}-%`)
    // Settlement notifications keyed by matchId
    for (const matchId of testMatchIds) {
      await admin.from('notification_log').delete().like('dedupe_key', `settlement-%-${matchId}`)
    }
    await admin.from('push_reminders').delete().eq('matchday', TEST_MATCHDAY)

    // ── 8. Restore ALL user balances from snapshot ───────────────────────────
    let usersRestored = 0
    const { data: snapshotRow } = await admin
      .from('app_settings').select('value').eq('key', BALANCE_SNAPSHOT_KEY).single()

    if (snapshotRow) {
      let snapshot: Record<string, number> = {}
      try { snapshot = JSON.parse(snapshotRow.value) } catch { /* malformed, skip */ }

      const restoreOps = Object.entries(snapshot).map(([userId, balance]) =>
        admin.from('profiles').update({ balance }).eq('id', userId)
      )
      await Promise.allSettled(restoreOps)
      usersRestored = Object.keys(snapshot).length

      await admin.from('app_settings').delete().eq('key', BALANCE_SNAPSHOT_KEY)
    }

    // Clean up legacy per-user snapshot keys from older versions
    await admin.from('app_settings').delete().like('key', 'test_balance_snapshot_%')

    return NextResponse.json({
      ok: true,
      matchesDeleted: testMatchIds.length,
      betsDeleted: testBetIds.length,
      combosDeleted: finalComboIds.length,
      usersRestored,
    })
  }

  return NextResponse.json({ error: 'Unknown action: use seed or teardown' }, { status: 400 })
}
