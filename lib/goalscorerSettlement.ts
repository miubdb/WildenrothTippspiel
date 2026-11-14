import type { SupabaseClient } from '@supabase/supabase-js'
import { cappedPayout } from '@/lib/payout'
import { settleSingle, settleCombo, findStuckComboIds } from '@/lib/settlement'
import { WILDENROTH_TEAM_NAMES } from '@/lib/goalscorerContext'

/**
 * Goalscorer settlement — the ONE place that decides goalscorer bets, shared by
 * /api/admin/goalscorers/scorers (admin enters scorers) and /api/admin/settle (automatic
 * zero-goal settlement). Rules:
 *
 *  - The fixture must be `finished`; Wildenroth's own goal count comes from the stored result
 *    (home_score if Wildenroth I/II is the home side, away_score if away). Never from the client.
 *  - Wildenroth scored 0 → every pending goalscorer bet on this match is lost. No scorer list is
 *    needed (the old admin UI skipped the call for an empty list and left bets open forever).
 *  - Wildenroth scored > 0 → the submitted list must account for EXACTLY that many goals
 *    (player goals + goals marked as own goal). A missing or incomplete list is rejected and
 *    nothing is settled — it is never interpreted as "nobody scored".
 *  - Own goals (`isOwnGoal`) count towards the team total but never for a player's bet.
 *  - Status flip + payout go through settle_bet / settle_combo (atomic, idempotent).
 */

export type ScorerRow = { playerId: number; goals: number; isOwnGoal?: boolean }

export type WildenrothSide = 'home' | 'away'

export function wildenrothSideOf(
  match: { home_team_id: number | null; away_team_id: number | null },
  wildenrothTeamIds: readonly number[],
): WildenrothSide | 'both' | null {
  const home = match.home_team_id != null && wildenrothTeamIds.includes(match.home_team_id)
  const away = match.away_team_id != null && wildenrothTeamIds.includes(match.away_team_id)
  if (home && away) return 'both'
  if (home) return 'home'
  if (away) return 'away'
  return null
}

export type ScorerReportResult =
  | { ok: true; goalsByPlayer: Map<number, number>; playerGoals: number; ownGoals: number }
  | { ok: false; error: string }

/** Pure consistency check of an entered scorer list against Wildenroth's real goal count. */
export function validateScorerReport(teamGoals: number, rows: readonly ScorerRow[]): ScorerReportResult {
  if (!Number.isInteger(teamGoals) || teamGoals < 0) return { ok: false, error: 'Ergebnis des Spiels fehlt oder ist ungültig.' }
  const goalsByPlayer = new Map<number, number>()
  let playerGoals = 0
  let ownGoals = 0
  for (const r of rows) {
    if (!Number.isInteger(r.playerId) || r.playerId <= 0 || !Number.isInteger(r.goals) || r.goals < 1 || r.goals > 20) {
      return { ok: false, error: 'Ungültiger Torschütze.' }
    }
    if (r.isOwnGoal) { ownGoals += r.goals; continue }
    playerGoals += r.goals
    goalsByPlayer.set(r.playerId, (goalsByPlayer.get(r.playerId) ?? 0) + r.goals)
  }
  const total = playerGoals + ownGoals
  if (total !== teamGoals) {
    return {
      ok: false,
      error: total < teamGoals
        ? `Unvollständige Torschützenliste: ${total} von ${teamGoals} Wildenroth-Toren erfasst. Bitte alle Tore (inkl. Eigentore) eintragen – es wurde nichts abgerechnet.`
        : `Zu viele Tore erfasst: ${total}, Wildenroth hat laut Ergebnis aber ${teamGoals} Tor(e) erzielt. Es wurde nichts abgerechnet.`,
    }
  }
  return { ok: true, goalsByPlayer, playerGoals, ownGoals }
}

export function goalscorerBetResult(marketType: string, playerId: number, goalsByPlayer: ReadonlyMap<number, number>): 'won' | 'lost' {
  const goals = goalsByPlayer.get(playerId) ?? 0
  return marketType === 'goalscorer_2plus' ? (goals >= 2 ? 'won' : 'lost') : (goals >= 1 ? 'won' : 'lost')
}

export const GOALSCORER_MARKETS = ['goalscorer', 'goalscorer_2plus'] as const

export type GoalscorerSettlementOutcome =
  | { ok: false; status: number; error: string }
  | {
      ok: true
      teamGoals: number
      settled: number
      combosChecked: number
      settleErrors: number
      /** per user: credited payout (already booked atomically) */
      payouts: Map<string, number>
      /** users with at least one lost single goalscorer bet */
      losers: Set<string>
    }

async function loadWildenrothTeamIds(admin: SupabaseClient): Promise<number[] | null> {
  const { data, error } = await admin.from('teams').select('id, name').in('name', [...WILDENROTH_TEAM_NAMES])
  if (error || !data) return null
  return data.map((t) => t.id as number)
}

/** Wildenroth's own goals in a FINISHED fixture, from the stored result (home or away side). */
export async function resolveWildenrothGoals(
  admin: SupabaseClient,
  matchId: number,
): Promise<{ ok: true; teamGoals: number; side: WildenrothSide } | { ok: false; status: number; error: string }> {
  const { data: match, error: matchError } = await admin
    .from('matches').select('id, status, home_team_id, away_team_id, home_score, away_score').eq('id', matchId).single()
  if (matchError || !match) return { ok: false, status: 404, error: 'Spiel nicht gefunden.' }
  if (match.status !== 'finished') {
    return { ok: false, status: 409, error: 'Torschützenwetten werden erst nach dem abgerechneten Endergebnis ausgewertet.' }
  }
  const teamIds = await loadWildenrothTeamIds(admin)
  if (!teamIds) return { ok: false, status: 500, error: 'Wildenroth-Teams konnten nicht geladen werden.' }
  const side = wildenrothSideOf(match, teamIds)
  if (side == null) return { ok: false, status: 400, error: 'Kein Wildenroth-Spiel – keine Torschützenwetten.' }
  if (side === 'both') return { ok: false, status: 400, error: 'Wildenroth I gegen II: bitte manuell prüfen.' }
  const raw = side === 'home' ? match.home_score : match.away_score
  if (raw == null || !Number.isInteger(Number(raw))) return { ok: false, status: 409, error: 'Ergebnis des Spiels fehlt.' }
  return { ok: true, teamGoals: Number(raw), side }
}

/**
 * Settles every pending goalscorer bet of `matchId`.
 * `rows === null` means "automatic run" (from /api/admin/settle): only allowed when Wildenroth
 * scored 0, otherwise it returns { ok:false, status: 409 } without touching anything.
 */
export async function settleGoalscorerMarket(
  admin: SupabaseClient,
  matchId: number,
  rows: readonly ScorerRow[] | null,
): Promise<GoalscorerSettlementOutcome> {
  const ctx = await resolveWildenrothGoals(admin, matchId)
  if (!ctx.ok) return ctx
  const teamGoals = ctx.teamGoals

  if (rows === null && teamGoals !== 0) {
    return { ok: false, status: 409, error: 'Wildenroth hat getroffen – Torschützen müssen erfasst werden.' }
  }
  const report = validateScorerReport(teamGoals, rows ?? [])
  if (!report.ok) return { ok: false, status: 400, error: report.error }

  const { data: bets, error: betsError } = await admin
    .from('bets')
    .select('id, user_id, market_type, selection, stake, odds_value, combo_id, is_risky')
    .eq('match_id', matchId)
    .in('market_type', [...GOALSCORER_MARKETS])
    .eq('status', 'pending')
  if (betsError) return { ok: false, status: 500, error: 'Torschützenwetten konnten nicht geladen werden – es wurde nichts abgerechnet.' }

  const payouts = new Map<string, number>()
  const losers = new Set<string>()
  const combosToCheck = new Set<number>()
  let settled = 0
  let settleErrors = 0

  for (const b of bets ?? []) {
    const result = goalscorerBetResult(b.market_type, parseInt(b.selection, 10), report.goalsByPlayer)
    const payout = result === 'won' && b.combo_id == null
      ? Math.round(cappedPayout(Number(b.stake), Number(b.odds_value), b.is_risky) * 100) / 100
      : 0
    const outcome = await settleSingle(admin, b.id, result, payout)
    if (outcome === 'error') { settleErrors++; continue }
    if (outcome === 'skipped') continue
    settled++
    if (b.combo_id != null) combosToCheck.add(b.combo_id)
    else if (result === 'won') payouts.set(b.user_id, (payouts.get(b.user_id) ?? 0) + payout)
    else losers.add(b.user_id)
  }
  for (const id of await findStuckComboIds(admin, { matchId, markets: [...GOALSCORER_MARKETS] })) combosToCheck.add(id)

  for (const comboId of combosToCheck) {
    const { data: legs } = await admin.from('bets').select('status, is_risky').eq('combo_id', comboId)
    if (!legs || legs.length === 0) continue
    const anyLost = legs.some((l) => l.status === 'lost')
    const allSettled = legs.every((l) => l.status !== 'pending')
    if (!anyLost && !allSettled) continue
    const { data: combo } = await admin.from('combo_bets').select('id, user_id, stake, total_odds, status').eq('id', comboId).single()
    if (!combo || combo.status !== 'pending') continue
    if (anyLost) {
      if ((await settleCombo(admin, comboId, 'lost', 0)) === 'error') settleErrors++
    } else {
      const payout = Math.round(cappedPayout(Number(combo.stake), Number(combo.total_odds), legs[0]?.is_risky ?? false) * 100) / 100
      const o = await settleCombo(admin, comboId, 'won', payout)
      if (o === 'error') settleErrors++
      else if (o === 'applied') payouts.set(combo.user_id, (payouts.get(combo.user_id) ?? 0) + payout)
    }
  }

  return { ok: true, teamGoals, settled, combosChecked: combosToCheck.size, settleErrors, payouts, losers }
}
