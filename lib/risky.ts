import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Central Risky classification, per lib/risky.ts's single caller-facing rule:
 * a user's active (pending) bet slips for one effective Tippspiel-Spieltag are
 * "normal" up to 2. A 3rd slip is only allowed once at least one active slip's
 * odds exceed RISKY_ODDS_THRESHOLD — and then it is always the slip with the
 * SINGLE HIGHEST odds among all of them that is classified Risky, never a slip
 * merely because its own odds happen to exceed the threshold. This is a
 * property of the whole set, not of one slip in isolation: adding or
 * cancelling a slip can change which (if any) existing slip is Risky.
 */
export const RISKY_ODDS_THRESHOLD = 20
export const MAX_NORMAL_SLIPS = 2

export type RiskySlip = { id: string; odds: number }

/** First slip (by array order) achieving the maximum odds, but only if that
 *  maximum exceeds the threshold — otherwise no slip is Risky. Ties are
 *  broken by array order so callers can put existing (already-placed) slips
 *  first: on an exact odds tie, the one placed earlier keeps the Risky slot. */
export function pickRiskySlipId(slips: RiskySlip[]): string | null {
  let bestIdx = -1
  let bestOdds = -Infinity
  slips.forEach((s, i) => {
    if (s.odds > bestOdds) {
      bestOdds = s.odds
      bestIdx = i
    }
  })
  return bestIdx >= 0 && bestOdds > RISKY_ODDS_THRESHOLD ? slips[bestIdx].id : null
}

export interface RiskyEvaluation {
  /** id of the slip classified Risky, or null if none is */
  riskyId: string | null
  /** whether this exact set of slips respects "max 2 normal, max 3 total
   *  (3rd only once at least one slip's odds exceed the threshold)" */
  valid: boolean
  /** per-slip-id Risky flag (true for at most one id — the Risky slip) */
  classification: Map<string, boolean>
}

export function evaluateSlips(slips: RiskySlip[]): RiskyEvaluation {
  const riskyId = pickRiskySlipId(slips)
  const valid = slips.length <= (riskyId !== null ? MAX_NORMAL_SLIPS + 1 : MAX_NORMAL_SLIPS)
  const classification = new Map(slips.map((s) => [s.id, s.id === riskyId]))
  return { riskyId, valid, classification }
}

/**
 * Recomputes and persists is_risky for every pending slip (single bets +
 * combos, keyed by combo_id) this user has among `matchdayMatchIds` — the
 * full set of matches belonging to one effective Tippspiel-Spieltag. Must be
 * called after any successful placement or cancellation that touches that
 * Spieltag, so an existing slip's classification updates immediately when a
 * new higher-odds slip arrives, or when the current Risky slip is cancelled
 * and the next-highest (if any, and if still > threshold) takes over.
 *
 * Only issues UPDATEs for slips whose is_risky actually changed.
 */
export async function recomputeRiskyForUserMatchday(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  matchdayMatchIds: number[],
): Promise<void> {
  if (matchdayMatchIds.length === 0) return

  const { data: legs } = await admin
    .from('bets')
    .select('id, combo_id, odds_value, is_risky')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .in('match_id', matchdayMatchIds)

  if (!legs || legs.length === 0) return

  const singleLegs = legs.filter((b) => b.combo_id == null)
  const comboIds = [...new Set(legs.filter((b) => b.combo_id != null).map((b) => b.combo_id as number))]

  let combos: { id: number; total_odds: number }[] = []
  if (comboIds.length > 0) {
    const { data } = await admin
      .from('combo_bets')
      .select('id, total_odds')
      .in('id', comboIds)
      .eq('status', 'pending')
    combos = data ?? []
  }

  // combo_bets has no is_risky column of its own — all legs of one combo
  // carry the same value (see app/api/bets/place/route.ts), so any one leg
  // reflects the combo's current classification.
  const comboCurrentRisky = new Map<number, boolean>()
  for (const l of legs) {
    if (l.combo_id != null && !comboCurrentRisky.has(l.combo_id)) {
      comboCurrentRisky.set(l.combo_id, l.is_risky)
    }
  }

  const slips: RiskySlip[] = [
    ...singleLegs.map((b) => ({ id: `bet-${b.id}`, odds: Number(b.odds_value) })),
    ...combos.map((c) => ({ id: `combo-${c.id}`, odds: Number(c.total_odds) })),
  ]
  const { classification } = evaluateSlips(slips)

  const updates: PromiseLike<unknown>[] = []
  for (const b of singleLegs) {
    const next = classification.get(`bet-${b.id}`) ?? false
    if (next !== b.is_risky) {
      updates.push(admin.from('bets').update({ is_risky: next }).eq('id', b.id))
    }
  }
  for (const c of combos) {
    const next = classification.get(`combo-${c.id}`) ?? false
    if (next !== comboCurrentRisky.get(c.id)) {
      updates.push(admin.from('bets').update({ is_risky: next }).eq('combo_id', c.id))
    }
  }
  await Promise.all(updates)
}
