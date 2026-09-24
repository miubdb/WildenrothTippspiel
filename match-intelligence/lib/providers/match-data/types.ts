import { z } from 'zod'

/**
 * MatchDataProvider — the adapter boundary for anything that can supply
 * match facts (fixtures, results, lineups) from outside this app's own
 * database. Every provider must validate what it returns against these Zod
 * schemas before the caller writes anything, and every returned fact carries
 * a `sourceIdentifier` so it can be recorded in `source_imports` (spec
 * section 9 — provenance is mandatory, not optional).
 *
 * A provider NEVER writes to Supabase itself — it only returns validated
 * data. The import route (app/api/admin/data-sources/tippspiel-sync) decides
 * how to reconcile it with existing rows via lib/import/reconcile.ts
 * (including raising a data_conflicts row on disagreement), so providers
 * stay simple, side-effect-free, and testable in isolation.
 */

export const providerMatchSchema = z.object({
  sourceIdentifier: z.string(),
  kickoffAt: z.string().datetime(),
  homeAway: z.enum(['home', 'away']),
  opponentName: z.string(),
  opponentSourceIdentifier: z.string().nullable(),
  matchday: z.number().int().nullable(),
  competitionName: z.string().nullable(),
  status: z.enum(['scheduled', 'live', 'finished', 'postponed', 'cancelled']),
  ourScore: z.number().int().nullable(),
  opponentScore: z.number().int().nullable(),
  // The Tippspiel schema (and most sources of this kind) has no half-time
  // score columns at all — always null via that provider, never derived.
  htOurScore: z.number().int().nullable(),
  htOpponentScore: z.number().int().nullable(),
  venue: z.string().nullable(),
})
export type ProviderMatch = z.infer<typeof providerMatchSchema>

export const providerLineupPlayerSchema = z.object({
  playerName: z.string(),
  // Not every source can supply a jersey number for lineup rows (the
  // Tippspiel `match_lineups` table has none) — null means "not provided",
  // never a guess.
  jerseyNumber: z.number().int().nullable(),
  position: z.string().nullable(),
  isStarting: z.boolean().nullable(), // null = source doesn't distinguish starter/bench
  minutesPlayed: z.number().int().nullable(),
  goals: z.number().int(),
  assists: z.number().int(),
  yellowCards: z.number().int(),
  redCardMinute: z.number().int().nullable(),
  penaltyMissed: z.boolean(),
})
export type ProviderLineupPlayer = z.infer<typeof providerLineupPlayerSchema>

export const providerMatchLineupsSchema = z.object({
  matchSourceIdentifier: z.string(),
  // Formation is intentionally absent here: no source wired up in V1
  // states one, and a provider must never guess it (spec section 12C) — the
  // caller always renders "Formation unbekannt" unless a human enters one.
  own: z.array(providerLineupPlayerSchema),
  opponent: z.array(providerLineupPlayerSchema),
})
export type ProviderMatchLineups = z.infer<typeof providerMatchLineupsSchema>

export interface MatchDataProvider {
  readonly id: string
  readonly sourceType: 'bfv' | 'fupa' | 'wildenroth_tippspiel' | 'manual'

  /** Whether this provider is currently usable (config present, reachable). */
  isAvailable(): Promise<boolean>

  /** Fetches known fixtures/results for a team within a date range. */
  fetchMatches(params: { teamName: string; from: string; to: string }): Promise<ProviderMatch[]>

  /**
   * Fetches both sides' lineups for one previously-fetched match, if the
   * provider has any. `ownTeamNames` lets the provider tell "our" rows apart
   * from the opponent's when the source only records a team name per row
   * (as Tippspiel's `match_lineups` does) rather than an explicit side.
   */
  fetchLineups(params: { matchSourceIdentifier: string; ownTeamNames: string[] }): Promise<ProviderMatchLineups | null>
}
