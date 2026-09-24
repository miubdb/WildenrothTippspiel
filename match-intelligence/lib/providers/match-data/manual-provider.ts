import type { MatchDataProvider, ProviderMatch, ProviderMatchLineups } from './types'

/**
 * The always-available fallback: no automatic fetching, just a typed target
 * for CSV/JSON import (spec section 10 — "wenn keine Schnittstelle verfügbar
 * ist, zunächst sauberen Adapter + CSV/JSON-Import-Fallback bauen"). The
 * actual parsing lives in the admin import route; this provider's job is
 * only to satisfy the MatchDataProvider contract so callers don't need a
 * special case for "no automated source configured". Manual matches/players/
 * lineups are otherwise created directly through the app's own forms and
 * server actions (app/(app)/matches, app/(app)/players) — those write with
 * `source_type: 'manual'` in source_imports, they don't go through this
 * provider's (empty) fetch methods at all.
 */
export class ManualProvider implements MatchDataProvider {
  readonly id = 'manual'
  readonly sourceType = 'manual' as const

  async isAvailable() {
    return true
  }

  async fetchMatches(): Promise<ProviderMatch[]> {
    return []
  }

  async fetchLineups(): Promise<ProviderMatchLineups | null> {
    return null
  }
}
