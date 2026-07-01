import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMatchXG, oddsFromXG, getExactScoreOdds, buildPriorContext } from '@/lib/odds'
import { persistOddsDiagnostics } from '@/lib/oddsDiagnostics'
import { ODDS_COLUMN } from '@/lib/oddsMarkets'
import type { Match, PriorMatch, LeaguePlayer, LineupEntry } from '@/types'

/**
 * ONE-OFF, HARD-SCOPED controlled correction: recompute the frozen odds for
 * Spieltag 1 under the Phase 1 v2 model, and (only for still-pending bets,
 * of which none exist as of writing this) bring their stored odds in line.
 *
 * This is NOT a general "recompute any frozen matchday" tool — that's exactly
 * what app/api/admin/odds/route.ts refuses to do by design (it skips any
 * match with frozen_at set). This route exists specifically because Spieltag 1
 * was frozen under the pre-Phase-1 model and the team wants a single, explicit,
 * audited correction while it's still pre-kickoff. `matchday` is intentionally
 * NOT read from the request for match selection — it's hard-coded below — the
 * request body values are only checked as an explicit confirmation gate.
 */
const SEASON_START = '2026-08-01'
const TARGET_MATCHDAY = 1

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  let body: { matchday?: number; forceRecomputeFrozen?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  // Explicit double-confirmation gate — does NOT select which matches get
  // touched (that's hard-coded to TARGET_MATCHDAY below), only guards against
  // accidental/automated invocation.
  if (body.matchday !== TARGET_MATCHDAY || body.forceRecomputeFrozen !== true) {
    return NextResponse.json(
      { error: `Diese Route korrigiert ausschließlich Spieltag ${TARGET_MATCHDAY}. Erfordert { matchday: ${TARGET_MATCHDAY}, forceRecomputeFrozen: true }.` },
      { status: 400 }
    )
  }

  const admin = createAdminClient()

  // Fetch every match ever recorded as "matchday 1" and filter to the current
  // season by date, so we never touch the 25/26 test data that shares the number.
  const { data: matchdayMatchesRaw } = await admin
    .from('matches')
    .select(
      `id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status,
       home_team:teams!matches_home_team_id_fkey(id, name, short_name),
       away_team:teams!matches_away_team_id_fkey(id, name, short_name)`
    )
    .eq('matchday', TARGET_MATCHDAY)
    .gte('match_date', SEASON_START)

  const matchdayMatches: Match[] = (matchdayMatchesRaw ?? []).map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  }))

  if (matchdayMatches.length === 0) {
    return NextResponse.json({ error: `Keine Spiele für Spieltag ${TARGET_MATCHDAY} gefunden.` }, { status: 404 })
  }

  // Hard safety gate: refuse entirely (no partial writes) unless every match is
  // still scheduled and its kickoff is genuinely in the future.
  const now = new Date()
  const notSafe = matchdayMatches.filter((m) => m.status !== 'scheduled' || new Date(m.match_date) <= now)
  if (notSafe.length > 0) {
    return NextResponse.json({
      error: 'Abgebrochen: mindestens ein Spiel ist bereits angepfiffen/beendet oder nicht mehr "scheduled". Keine Änderungen vorgenommen.',
      unsafeMatches: notSafe.map((m) => ({ id: m.id, status: m.status, match_date: m.match_date })),
    }, { status: 409 })
  }

  // Build the same prior context every other odds call site uses.
  const { data: allMatchesRaw } = await admin
    .from('matches')
    .select(
      `id, match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status, match_category,
       home_team:teams!matches_home_team_id_fkey(id, name, short_name),
       away_team:teams!matches_away_team_id_fkey(id, name, short_name)`
    )
    .gte('match_date', SEASON_START)

  const allMatches: Match[] = (allMatchesRaw ?? []).map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  }))

  const { data: priorMatchesRaw } = await admin
    .from('prior_season_matches')
    .select('id, season, league_name, league_level, league_number, home_team, away_team, home_score, away_score, match_date')
  const priorMatches: PriorMatch[] = (priorMatchesRaw ?? []) as PriorMatch[]

  const { data: leaguePlayersRaw } = await admin
    .from('league_players')
    .select('id, team_name, name, goals, matches, status, transfer_to, prior_league_level, prior_team_name')
  const { data: lineupEntriesRaw } = await admin
    .from('match_lineups')
    .select('id, match_id, team_name, player_name, minutes_played, goals, assists, created_at')

  const leaguePlayers: LeaguePlayer[] = (leaguePlayersRaw ?? []).map((p) => ({
    id: p.id, name: p.name, team_name: p.team_name, goals: p.goals, games: p.matches,
    status: p.status, transfer_to: p.transfer_to,
    prior_league_level: p.prior_league_level, prior_team_name: p.prior_team_name,
  }))
  const lineupEntries: LineupEntry[] = (lineupEntriesRaw ?? []) as LineupEntry[]

  const teamNames = new Map<number, string>()
  for (const m of allMatches) {
    if (m.home_team) teamNames.set(m.home_team_id, m.home_team.name)
    if (m.away_team) teamNames.set(m.away_team_id, m.away_team.name)
  }
  const priorCtx = buildPriorContext(priorMatches, teamNames, leaguePlayers, lineupEntries)

  const matchIds = matchdayMatches.map((m) => m.id)

  // Old odds, for the audit log.
  const { data: oldOddsRows } = await admin.from('odds').select('*').in('match_id', matchIds)
  const oldOddsMap = new Map((oldOddsRows ?? []).map((r) => [r.match_id, r]))

  const auditLog: Array<{
    matchId: number
    homeTeam: string
    awayTeam: string
    old1x2: { home: number; draw: number; away: number } | null
    new1x2: { home: number; draw: number; away: number }
    betCount: number
    betsUpdated: number
    betsSkipped: { id: number; reason: string }[]
  }> = []

  const nowIso = new Date().toISOString()

  for (const m of matchdayMatches) {
    const { homeXG, awayXG, diagnostics } = getMatchXG(allMatches, m.home_team_id, m.away_team_id, priorCtx)
    const odds = oddsFromXG(homeXG, awayXG)
    const exactScores = getExactScoreOdds(allMatches, m.home_team_id, m.away_team_id, priorCtx)
    const exactScoreMap = new Map(exactScores.map((e) => [e.score, e.odds]))

    const oldRow = oldOddsMap.get(m.id)

    await admin.from('odds').upsert({
      match_id: m.id,
      matchday: m.matchday,
      frozen_at: nowIso,
      updated_at: nowIso,
      home_win: odds.home_win,
      draw: odds.draw,
      away_win: odds.away_win,
      odds_1x: odds.odds_1x,
      odds_x2: odds.odds_x2,
      odds_12: odds.odds_12,
      over_2_5: odds.over_2_5,
      under_2_5: odds.under_2_5,
      over_3_5: odds.over_3_5,
      under_3_5: odds.under_3_5,
      over_5_5: odds.over_5_5,
      under_5_5: odds.under_5_5,
      over_7_5: odds.over_7_5,
      under_7_5: odds.under_7_5,
      btts_yes: odds.btts_yes,
      btts_no: odds.btts_no,
      hdp_home_minus_1_5: odds.hdp_home_minus_1_5,
      hdp_away_plus_1_5: odds.hdp_away_plus_1_5,
      hdp_home_minus_2_5: odds.hdp_home_minus_2_5,
      hdp_away_plus_2_5: odds.hdp_away_plus_2_5,
    }, { onConflict: 'match_id' })

    await persistOddsDiagnostics(admin, m.id, 'admin_recalc', diagnostics)

    // Bets on THIS match, any status — for the audit count.
    const { data: matchBets } = await admin
      .from('bets')
      .select('id, market_type, selection, odds_value, status, combo_id')
      .eq('match_id', m.id)

    const bets = matchBets ?? []
    let betsUpdated = 0
    const betsSkipped: { id: number; reason: string }[] = []

    for (const bet of bets) {
      if (bet.status !== 'pending') {
        betsSkipped.push({ id: bet.id, reason: `status=${bet.status}, not pending` })
        continue
      }
      if (bet.market_type === 'goalscorer' || bet.market_type === 'goalscorer_2plus') {
        betsSkipped.push({ id: bet.id, reason: 'goalscorer market — separate subsystem, out of scope' })
        continue
      }

      let newOddsValue: number | null = null
      if (bet.market_type === 'exact_score') {
        newOddsValue = exactScoreMap.get(bet.selection) ?? null
      } else {
        const col = ODDS_COLUMN[bet.market_type]?.[bet.selection]
        newOddsValue = col ? Number((odds as unknown as Record<string, number>)[col]) : null
      }

      if (newOddsValue == null || !Number.isFinite(newOddsValue)) {
        betsSkipped.push({ id: bet.id, reason: 'no matching recomputed market found' })
        continue
      }

      if (bet.combo_id != null) {
        // Combo leg: only update if EVERY leg of the whole combo (which may span
        // other matches too) is still pending. Recompute total_odds afterward.
        const { data: allLegs } = await admin
          .from('bets')
          .select('id, match_id, market_type, selection, odds_value, status')
          .eq('combo_id', bet.combo_id)

        const legs = allLegs ?? []
        if (legs.some((l) => l.status !== 'pending')) {
          betsSkipped.push({ id: bet.id, reason: 'combo has a non-pending leg — combo left untouched' })
          continue
        }

        await admin.from('bets').update({ odds_value: newOddsValue }).eq('id', bet.id)
        betsUpdated++

        const updatedLegOdds = legs.map((l) => (l.id === bet.id ? newOddsValue! : Number(l.odds_value)))
        const newTotalOdds = Math.round(updatedLegOdds.reduce((acc, v) => acc * v, 1) * 100) / 100
        await admin.from('combo_bets').update({ total_odds: newTotalOdds }).eq('id', bet.combo_id)
      } else {
        await admin.from('bets').update({ odds_value: newOddsValue }).eq('id', bet.id)
        betsUpdated++
      }
    }

    auditLog.push({
      matchId: m.id,
      homeTeam: m.home_team?.name ?? '?',
      awayTeam: m.away_team?.name ?? '?',
      old1x2: oldRow ? { home: Number(oldRow.home_win), draw: Number(oldRow.draw), away: Number(oldRow.away_win) } : null,
      new1x2: { home: odds.home_win, draw: odds.draw, away: odds.away_win },
      betCount: bets.length,
      betsUpdated,
      betsSkipped,
    })
  }

  // Audit-friendly console output.
  console.log(`[recompute-matchday-1] Controlled Phase 1 odds correction — ${matchdayMatches.length} matches`)
  for (const entry of auditLog) {
    console.log(
      `  Match ${entry.matchId} (${entry.homeTeam} vs ${entry.awayTeam}): ` +
      `old 1X2 ${entry.old1x2 ? `${entry.old1x2.home}/${entry.old1x2.draw}/${entry.old1x2.away}` : 'n/a'} → ` +
      `new 1X2 ${entry.new1x2.home}/${entry.new1x2.draw}/${entry.new1x2.away} | ` +
      `bets: ${entry.betCount} total, ${entry.betsUpdated} updated, ${entry.betsSkipped.length} skipped`
    )
    for (const skip of entry.betsSkipped) {
      console.log(`    - bet ${skip.id} left untouched: ${skip.reason}`)
    }
  }

  return NextResponse.json({ success: true, matchday: TARGET_MATCHDAY, matches: auditLog })
}
