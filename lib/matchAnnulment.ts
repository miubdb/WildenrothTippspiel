import { cappedPayout } from './payout'

/**
 * Pure, DB-free core for "Nichtantritt / Annullierung mit Quote 1,00" — a
 * match (or a Spieltag-Special) that can never reach a real result gets every
 * PENDING selection tied to it neutralized: treated as neither won nor lost,
 * effective odds 1.00, stake refunded where that selection was a standalone
 * bet. This file is the single source of truth for "what should happen" —
 * the admin preview route and the `neutralize_match` SQL RPC (see
 * supabase/match_annulment.sql) must both implement EXACTLY this logic. The
 * RPC is a line-by-line SQL translation of `classifyCombo`/`planSingleBet`
 * below; any change here must be mirrored there (and vice versa) — see the
 * test script (scripts/run-match-annulment-check.mjs) that exercises this
 * file directly against hand-verified production figures.
 *
 * Deliberately NOT exported: any notion of "the new effective odds of the
 * neutralized selection itself" — it has none; 1.00 is a DISPLAY fact (its
 * contribution to a combo's product is multiplicatively neutral), never a
 * stored per-leg value. What IS stored/returned is the combo's NEW total
 * odds, computed fresh as the product of the remaining (non-neutralized)
 * legs' ORIGINAL odds_value — never by dividing the old, already-rounded
 * total_odds by the neutralized leg's odds (that stored value lost precision
 * at the first rounding and must never be used as a divisor).
 */

/** Matches the one rounding convention already used everywhere stakes/odds/
 *  payouts are persisted in this codebase (see lib/odds.ts, app/api/bets/
 *  place/route.ts, app/api/admin/settle/route.ts). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export type BetStatus = 'pending' | 'won' | 'lost' | 'void' | 'neutralized'

/** One leg of a combo, in the state it is in AFTER this annulment's own
 *  neutralization has already been applied to it (i.e. the caller has
 *  already flipped every leg whose match_id/special_id matches the
 *  annulment's target from 'pending' to 'neutralized' before building this
 *  array) — classifyCombo only reasons about the RESULT, it does not decide
 *  which legs get neutralized (that's `legMatchesTarget` below). */
export interface ComboLegAfterNeutralization {
  oddsValue: number
  status: BetStatus
}

export type ComboResolution =
  /** Precondition violated (a leg is already 'lost') — classifyCombo must
   *  only ever be called for a combo whose OWN status was 'pending' right
   *  before this annulment ran, and a 'pending' combo can never already
   *  contain a 'lost' leg (the normal settlement route would already have
   *  flipped it to 'lost' itself). Surfaced instead of silently mis-handled
   *  so a violation is a loud bug, not a quiet wrong payout. */
  | { kind: 'precondition_violated_already_lost' }
  /** Every leg of this combo was neutralized — nothing left to decide.
   *  Entire stake refunded; the combo itself counts as neither won nor lost. */
  | { kind: 'fully_neutralized' }
  /** At least one real (non-neutralized) leg remains, all of them 'won', and
   *  none still 'pending' — the combo is now decided WON purely because the
   *  neutralization removed the only still-open/undecided leg. */
  | { kind: 'now_won'; newTotalOdds: number }
  /** At least one real leg is still 'pending' — the combo stays open, but its
   *  total odds must be updated now so every downstream reader (settlement,
   *  Risky, stats, display) already sees the correct new price. */
  | { kind: 'still_pending'; newTotalOdds: number }

/**
 * Classifies a combo's new state given its legs AFTER this annulment's own
 * neutralization has been applied to them. `legs` must be ALL of the combo's
 * legs (not just the ones touched by this annulment) — a combo can span
 * several matches, and legs from other matches decide whether it's actually
 * won/lost/still pending.
 *
 * Caller precondition: only call this for a combo whose OWN `combo_bets.status`
 * was 'pending' immediately before this annulment ran (never for an
 * already-won/lost/void/neutralized combo — those must be left completely
 * untouched except for the leg-level neutralization itself, see
 * planAnnulment below).
 */
export function classifyCombo(legs: ComboLegAfterNeutralization[]): ComboResolution {
  const anyLost = legs.some((l) => l.status === 'lost')
  if (anyLost) return { kind: 'precondition_violated_already_lost' }

  const remaining = legs.filter((l) => l.status !== 'neutralized')
  if (remaining.length === 0) return { kind: 'fully_neutralized' }

  const newTotalOdds = round2(remaining.reduce((acc, l) => acc * l.oddsValue, 1))
  const stillOpen = remaining.some((l) => l.status === 'pending')
  if (stillOpen) return { kind: 'still_pending', newTotalOdds }
  // Every remaining leg is settled and none lost (anyLost already false) ->
  // every remaining leg is 'won'.
  return { kind: 'now_won', newTotalOdds }
}

export interface SingleBetPlan {
  betId: number
  userId: string
  refundAmount: number
}

/** A standalone (non-combo) pending bet on the annulled selection: always
 *  neutralized with a full stake refund — no win/loss scoring, ever. */
export function planSingleBet(bet: { id: number; userId: string; stake: number }): SingleBetPlan {
  return { betId: bet.id, userId: bet.userId, refundAmount: bet.stake }
}

export interface ComboPlanInput {
  comboId: number
  userId: string
  stake: number
  /** combo_bets.total_odds BEFORE this annulment touches it — snapshotted
   *  into combo_bets.original_total_odds the first time a combo is touched,
   *  and never overwritten again on a later idempotent re-run (see the RPC's
   *  use of COALESCE). */
  originalTotalOdds: number
  status: BetStatus
  isRisky: boolean
  /** Every leg of this combo, in its state AFTER this annulment's leg-level
   *  neutralization has been applied. */
  legs: ComboLegAfterNeutralization[]
}

export type ComboPlanAction =
  /** combo_bets.status was not 'pending' before this annulment ran (already
   *  won/lost/void/neutralized) — its OWN status/total_odds/payout are left
   *  completely untouched; only the matching leg(s) get neutralized (handled
   *  separately, see planAnnulment). Covers "already-lost combos must never
   *  be reactivated" and "already-cancelled bets remain completely untouched"
   *  by construction — there is nothing left for THIS function to decide. */
  | { kind: 'leg_only_no_combo_change' }
  | { kind: 'fully_neutralized_refund'; refundAmount: number }
  | { kind: 'now_won_payout'; newTotalOdds: number; payout: number }
  | { kind: 'still_pending_odds_updated'; newTotalOdds: number }
  /** Defensive — see classifyCombo's precondition_violated_already_lost.
   *  Never expected to occur; surfaced so a violation is loud, not silent. */
  | { kind: 'precondition_violated' }

export function planCombo(input: ComboPlanInput): ComboPlanAction {
  if (input.status !== 'pending') return { kind: 'leg_only_no_combo_change' }

  const resolution = classifyCombo(input.legs)
  switch (resolution.kind) {
    case 'precondition_violated_already_lost':
      return { kind: 'precondition_violated' }
    case 'fully_neutralized':
      return { kind: 'fully_neutralized_refund', refundAmount: input.stake }
    case 'now_won': {
      const payout = round2(cappedPayout(input.stake, resolution.newTotalOdds, input.isRisky))
      return { kind: 'now_won_payout', newTotalOdds: resolution.newTotalOdds, payout }
    }
    case 'still_pending':
      return { kind: 'still_pending_odds_updated', newTotalOdds: resolution.newTotalOdds }
  }
}

/**
 * A `matchday_special` bet's `match_id` is only its `representative_match_id`
 * — a technical FK anchor (see lib/matchdaySpecials.ts), picked as the
 * Spieltag's earliest kickoff. It is NEVER a real selection on that specific
 * match. Matching such a bet via match_id — as a plain `WHERE match_id = X`
 * would — wrongly neutralizes a Special merely anchored on the annulled
 * match, even when that Special's own `included_match_ids` doesn't contain
 * it at all (i.e. the Special has nothing to do with the real-world event
 * that got annulled). A Special may ONLY ever be reached through its own
 * `special_id`, gated on genuine `included_match_ids` membership — see
 * supabase/match_annulment.sql's `neutralize_match`, Step 2, which looks the
 * Special up by `included_match_ids @> [p_match_id]`, never by matchId.
 */
export function isRealMatchLeg(bet: { marketType: string }): boolean {
  return bet.marketType !== 'matchday_special'
}

/**
 * Strukturierte Admin-Auswahl beim Annullieren (nie vorausgewählt — siehe
 * components/admin/MatchAnnulmentPanel.tsx) — gespeichert in `matches.annulment_type`
 * (supabase/match_annulment_official_score.sql). Rein dokumentarisch/Grundlage für die
 * SEPARAT zu bestätigende offizielle Tabellenwertung unten — hat KEINEN Einfluss auf die
 * Wettneutralisierung selbst, die unverändert jede betroffene Auswahl neutralisiert,
 * unabhängig vom Grund.
 */
export type AnnulmentType = 'away_no_show' | 'home_no_show' | 'other'

export const ANNULMENT_TYPE_LABELS: Record<AnnulmentType, string> = {
  away_no_show: 'Nichtantritt Gastmannschaft',
  home_no_show: 'Nichtantritt Heimmannschaft',
  other: 'Anderer Grund',
}

/**
 * § 29 BFV-Spielordnung 2026: grundsätzlich 0:2 für die nicht angetretene Mannschaft,
 * 2:0 für den Gegner. Ein reiner UI-VORSCHLAG — wird NIE automatisch gespeichert; der
 * Admin muss die tatsächlich amtlich bestätigte Wertung separat eintragen (siehe
 * confirm_match_annulment_official_score), erst nachdem der BFV wirklich entschieden hat.
 * null für 'other', wo keine automatische Ergebniswertung vorgeschlagen wird.
 */
export function suggestedOfficialScore(type: AnnulmentType): { home: number; away: number } | null {
  if (type === 'away_no_show') return { home: 2, away: 0 }
  if (type === 'home_no_show') return { home: 0, away: 2 }
  return null
}

/**
 * Die offizielle, vom BFV bestätigte Wertung eines annullierten Spiels — ausschließlich für
 * die Fußballtabelle/Teamstatistiken gedacht (lib/matchAnnulment.ts#resultForStandings unten).
 * Gibt null zurück, solange keine Wertung bestätigt ist (Spiel nicht annulliert, oder
 * annulliert aber `annulment_official_confirmed_at` noch null — die BFV-Entscheidung steht
 * dann bewusst noch aus, siehe docs/spielannullierung-regelwerk.md).
 *
 * STRIKTE TRENNUNG (siehe Modulkommentar oben, selbe Begründung): diese Funktion liest
 * ausschließlich die drei neuen `annulment_official_*`-Spalten, nie `home_score`/`away_score`.
 * Das Quotenmodell (lib/odds.ts#getMatchXG/getForm/getTeamRecord), settleBet(), die
 * Torschützen-Logik und settleActiveMatchdaySpecials rufen diese Funktion nicht auf und lesen
 * diese Spalten nirgends — ein annulliertes Spiel bleibt für sie strukturell unsichtbar
 * (sie verlangen alle `status === 'finished'`, das ein annulliertes Spiel nie wieder erreicht).
 */
export function officialStandingsResult(m: {
  status: string
  annulment_official_home_score?: number | null
  annulment_official_away_score?: number | null
  annulment_official_confirmed_at?: string | null
}): { home_score: number; away_score: number } | null {
  if (m.status !== 'annulled') return null
  if (m.annulment_official_confirmed_at == null) return null
  if (m.annulment_official_home_score == null || m.annulment_official_away_score == null) return null
  return { home_score: m.annulment_official_home_score, away_score: m.annulment_official_away_score }
}

/**
 * Das Ergebnis, das für die Fußballtabelle/Teamstatistiken zählt: ein echtes 'finished'-
 * Ergebnis, ODER (ausschließlich dafür) die bestätigte offizielle Wertung eines annullierten
 * Spiels (officialStandingsResult oben). null, wenn keines von beiden zutrifft (noch offen,
 * verschoben, oder annulliert ohne bestätigte Wertung) — Aufrufer behandeln das exakt wie
 * bisher "noch kein Ergebnis", kein neuer Sonderfall nötig.
 *
 * Einzige vorgesehene Stelle für "zählt dieses annullierte Spiel als gewertetes
 * Tabellenspiel?" — app/(app)/tabelle/page.tsx, app/(app)/team/[teamId]/page.tsx,
 * app/(app)/team/wildenroth/page.tsx und app/(app)/team/wildenroth-ii/page.tsx rufen
 * ausschließlich diese Funktion auf, keine eigene zweite Logik.
 */
export function resultForStandings(m: {
  status: string
  home_score?: number | null
  away_score?: number | null
  annulment_official_home_score?: number | null
  annulment_official_away_score?: number | null
  annulment_official_confirmed_at?: string | null
}): { home_score: number; away_score: number } | null {
  if (m.status === 'finished' && m.home_score != null && m.away_score != null) {
    return { home_score: m.home_score, away_score: m.away_score }
  }
  return officialStandingsResult(m)
}

/** True for any bet row this annulment must neutralize: a still-open
 *  ('pending') selection whose match_id is the annulled match (and which is
 *  a REAL selection on it, see isRealMatchLeg — never a Special merely
 *  anchored there), OR whose special_id is a Spieltag-Special being voided
 *  because it genuinely includes that match (see supabase/match_annulment.sql's
 *  `neutralize_match` — Specials branch). Already-won/lost/void/neutralized
 *  rows are never touched again — this is what makes the whole operation
 *  idempotent: a second run finds nothing matching and changes nothing. */
export function legMatchesTarget(
  bet: { status: BetStatus; matchId: number | null; specialId: number | null; marketType: string },
  target: { matchId?: number; specialId?: number },
): boolean {
  if (bet.status !== 'pending') return false
  if (target.matchId != null && bet.matchId === target.matchId && isRealMatchLeg(bet)) return true
  if (target.specialId != null && bet.specialId === target.specialId) return true
  return false
}
