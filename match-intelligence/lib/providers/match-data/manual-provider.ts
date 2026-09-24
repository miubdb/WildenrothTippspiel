import type { MatchDataProvider, ProviderLineup, ProviderMatch } from './types'

/**
 * The always-available fallback: no automatic fetching, just a typed target
 * for CSV/JSON import (spec section 10 — "wenn keine Schnittstelle verfügbar
 * ist, zunächst sauberen Adapter + CSV/JSON-Import-Fallback bauen"). The
 * actual parsing lives in the admin import route; this provider's job is
 * only to satisfy the MatchDataProvider contract so callers don't need a
 * special case for "no automated source configured".
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

  async fetchLineup(): Promise<ProviderLineup | null> {
    return null
  }
}
