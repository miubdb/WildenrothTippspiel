import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Atomic settlement / void primitives. Status change AND wallet credit happen in ONE database transaction
 * (RPCs settle_bet / settle_combo / void_slip_refund, see supabase/immutable_placed_matchday_2026.sql):
 *  - 'applied'  → this call flipped the row and (if won) credited the payout exactly once
 *  - 'skipped'  → already decided by someone else (idempotent: nothing credited again)
 *  - 'error'    → the transaction rolled back, the row is STILL pending and a retry can pay it
 * Never write bets/combo_bets status + increment_balance as two separate statements again.
 */
export type SettleOutcome = 'applied' | 'skipped' | 'error'

export async function settleSingle(admin: SupabaseClient, betId: number, status: 'won' | 'lost', payout: number): Promise<SettleOutcome> {
  const { data, error } = await admin.rpc('settle_bet', { p_bet_id: betId, p_status: status, p_payout: payout })
  if (error) { console.error('settle_bet failed (row stays pending, retry is safe)', { betId, error }); return 'error' }
  return data === true ? 'applied' : 'skipped'
}

export async function settleCombo(admin: SupabaseClient, comboId: number, status: 'won' | 'lost', payout: number): Promise<SettleOutcome> {
  const { data, error } = await admin.rpc('settle_combo', { p_combo_id: comboId, p_status: status, p_payout: payout })
  if (error) { console.error('settle_combo failed (row stays pending, retry is safe)', { comboId, error }); return 'error' }
  return data === true ? 'applied' : 'skipped'
}

export type VoidReason = 'user_cancelled' | 'admin_special_voided' | 'admin_goalscorer_unavailable'

/** Returns the refunded stake, or null when the slip was not (or no longer) voidable. Throws on a database error (rolled back). */
export async function voidSlipWithRefund(
  admin: SupabaseClient,
  kind: 'single' | 'combo',
  id: number,
  reason: VoidReason,
  opts: { userId?: string; allLegs?: boolean } = {},
): Promise<number | null> {
  const { data, error } = await admin.rpc('void_slip_refund', {
    p_kind: kind, p_id: id, p_reason: reason, p_user_id: opts.userId ?? null, p_all_legs: opts.allLegs ?? false,
  })
  if (error) throw new Error(`void_slip_refund failed: ${error.message}`)
  return data == null ? null : Number(data)
}

/** Combos that already have a settled leg on these bets but are still pending themselves (e.g. a crashed earlier run
 *  settled the legs but never reached the combo step). Re-checking them makes a re-run self-healing. */
export async function findStuckComboIds(admin: SupabaseClient, filter: { matchId?: number; specialId?: number; markets?: string[] }): Promise<number[]> {
  let q = admin.from('bets').select('combo_id').not('combo_id', 'is', null).in('status', ['won', 'lost'])
  if (filter.matchId != null) q = q.eq('match_id', filter.matchId)
  if (filter.specialId != null) q = q.eq('special_id', filter.specialId)
  if (filter.markets) q = q.in('market_type', filter.markets)
  const { data, error } = await q
  if (error) { console.error('findStuckComboIds failed', error); return [] }
  return [...new Set((data ?? []).map((r) => r.combo_id as number))]
}
