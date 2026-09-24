import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import type { MatchDataProvider, ProviderLineup, ProviderMatch } from './types'

/**
 * Read-only adapter onto the existing "Wildenroth Tippspiel" project's
 * Supabase database (spec section 10/53). That project already tracks every
 * Kreisliga/B-Klasse fixture SpVgg Wildenroth plays, with results and
 * lineups (see its `matches`, `teams`, `lineup_entries`-equivalent tables —
 * documented below from reading its `types/index.ts` and `lib/season.ts`,
 * never inferred).
 *
 * Documented source schema (Tippspiel project, read but not modified):
 * - `matches`: id, match_number, matchday, home_team_id, away_team_id,
 *   match_date, home_score, away_score, status, match_category,
 *   competition_type, competition_name. Season filter: `match_date >=
 *   '2026-08-01'` (its lib/season.ts#SEASON_START).
 * - `teams`: id, name, short_name.
 * - No dedicated lineup table was found reachable read-only in V1 scope;
 *   `fetchLineup` therefore returns null until that project's lineup source
 *   (`match_lineups`/`lineup_entries`, per its lib/goalscorer.ts references)
 *   is confirmed and explicitly wired up — never guessed at.
 *
 * This is a genuinely separate Supabase project/database: connect with a
 * second, read-only anon key (TIPPSPIEL_SUPABASE_URL /
 * TIPPSPIEL_SUPABASE_ANON_KEY), never the service role, and never write
 * through this client — "Ändere das alte Projekt NICHT ungefragt" (spec
 * section 53).
 */
export class ExistingTippspielProvider implements MatchDataProvider {
  readonly id = 'wildenroth_tippspiel'
  readonly sourceType = 'wildenroth_tippspiel' as const

  private client: SupabaseClient | null = null

  private getClient(): SupabaseClient | null {
    const url = process.env.TIPPSPIEL_SUPABASE_URL
    const key = process.env.TIPPSPIEL_SUPABASE_ANON_KEY
    if (!url || !key) return null
    if (!this.client) {
      this.client = createSupabaseClient(url, key, { auth: { persistSession: false } })
    }
    return this.client
  }

  async isAvailable() {
    return this.getClient() !== null
  }

  async fetchMatches({ teamName, from, to }: { teamName: string; from: string; to: string }): Promise<ProviderMatch[]> {
    const client = this.getClient()
    if (!client) return []

    const { data: teams } = await client.from('teams').select('id, name').ilike('name', `%${teamName}%`)
    const teamIds = new Set((teams ?? []).map((t) => t.id))
    if (teamIds.size === 0) return []

    const { data: matches, error } = await client
      .from('matches')
      .select('id, match_date, home_team_id, away_team_id, home_score, away_score, status, matchday, match_category, home_team:home_team_id(name), away_team:away_team_id(name)')
      .gte('match_date', from)
      .lte('match_date', to)
      .order('match_date', { ascending: true })

    if (error || !matches) return []

    return matches
      .filter((m) => teamIds.has(m.home_team_id) || teamIds.has(m.away_team_id))
      .map((m): ProviderMatch => {
        const isHome = teamIds.has(m.home_team_id)
        const opponentTeam = (isHome ? m.away_team : m.home_team) as unknown as { name: string } | null
        return {
          sourceIdentifier: `tippspiel:${m.id}`,
          kickoffAt: new Date(m.match_date).toISOString(),
          homeAway: isHome ? 'home' : 'away',
          opponentName: opponentTeam?.name ?? 'Unbekannt',
          matchday: m.matchday ?? null,
          competitionName: m.match_category ?? null,
          status: (m.status ?? 'scheduled') as ProviderMatch['status'],
          ourScore: isHome ? m.home_score : m.away_score,
          opponentScore: isHome ? m.away_score : m.home_score,
        }
      })
  }

  async fetchLineup(): Promise<ProviderLineup | null> {
    // Not wired up yet — see class doc comment. Returning null (rather than
    // throwing) keeps this a "partial data" case the UI already handles,
    // not an error.
    return null
  }
}
