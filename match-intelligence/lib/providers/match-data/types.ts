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
 * data. The import route decides how to reconcile it with existing rows
 * (including raising a data_conflicts row on disagreement), so providers
 * stay simple and testable in isolation.
 */

export const providerMatchSchema = z.object({
  sourceIdentifier: z.string(),
  kickoffAt: z.string().datetime(),
  homeAway: z.enum(['home', 'away']),
  opponentName: z.string(),
  matchday: z.number().int().nullable(),
  competitionName: z.string().nullable(),
  status: z.enum(['scheduled', 'live', 'finished', 'postponed', 'cancelled']),
  ourScore: z.number().int().nullable(),
  opponentScore: z.number().int().nullable(),
  htOurScore: z.number().int().nullable().optional(),
  htOpponentScore: z.number().int().nullable().optional(),
  venue: z.string().nullable().optional(),
})
export type ProviderMatch = z.infer<typeof providerMatchSchema>

export const providerLineupPlayerSchema = z.object({
  playerName: z.string(),
  jerseyNumber: z.number().int().nullable(),
  isStarting: z.boolean(),
  minutesPlayed: z.number().int().nullable(),
})
export type ProviderLineupPlayer = z.infer<typeof providerLineupPlayerSchema>

export const providerLineupSchema = z.object({
  matchSourceIdentifier: z.string(),
  side: z.enum(['own', 'opponent']),
  // Formation is optional and must come from the source itself — a provider
  // implementation must never infer/guess one (spec section 12C).
  formation: z.string().nullable(),
  players: z.array(providerLineupPlayerSchema),
})
export type ProviderLineup = z.infer<typeof providerLineupSchema>

export interface MatchDataProvider {
  readonly id: string
  readonly sourceType: 'bfv' | 'fupa' | 'wildenroth_tippspiel' | 'manual'

  /** Whether this provider is currently usable (config present, reachable). */
  isAvailable(): Promise<boolean>

  /** Fetches known fixtures/results for a team within a date range. */
  fetchMatches(params: { teamName: string; from: string; to: string }): Promise<ProviderMatch[]>

  /** Fetches a lineup for one previously-fetched match, if the provider has one. */
  fetchLineup(params: { matchSourceIdentifier: string }): Promise<ProviderLineup | null>
}
