import { createReadOnlyClient, type ReadOnlyClient } from './read-only-client'
import type { MatchDataProvider, ProviderMatch, ProviderMatchLineups, ProviderLineupPlayer } from './types'

/**
 * Read-only adapter onto the existing "Wildenroth Tippspiel" project's own
 * Supabase database (spec sections 10/53). Verified directly against that
 * project's live schema (read-only `information_schema`/`pg_policies`
 * queries — nothing here is guessed):
 *
 * - `matches`: id (int), match_number, matchday, home_team_id, away_team_id,
 *   match_date (timestamptz — date AND kickoff time together), home_score,
 *   away_score, status ('scheduled'|'finished' observed; 'live'/'postponed'/
 *   'cancelled' are the column's other conceptually valid values per that
 *   project's own type, not currently seen in the data), match_category,
 *   competition_type, competition_name, competition_round.
 *   NOT PRESENT: half-time score, venue, season, external league IDs — a
 *   `ProviderMatch` from this provider always reports these as `null`
 *   ("nicht vorhanden"), never a guess.
 * - `teams`: id, name, short_name. No external (BFV/FuPa) team IDs.
 * - `match_lineups`: one row per player per match — match_id, team_name
 *   (free text, NOT a team_id FK), player_name, is_starter (nullable bool),
 *   position (free German text: Torwart/Abwehr/Mittelfeld/Angriff),
 *   minutes_played, goals, assists, yellow_cards (a count, not a boolean),
 *   red_card_minute, penalty_missed, player_id (references that project's
 *   OWN `wildenroth_players` table, populated only for Wildenroth's own
 *   players — never for opponents). NOT PRESENT: jersey number, formation.
 *   RLS on this table there is `SELECT true for public`, so it's readable
 *   with a bare anon key, no session needed.
 * - `wildenroth_players` (shirt numbers, goalkeeper flag, career stats) and
 *   `match_goalscorers` (per-goal scorer records) DO exist in that project
 *   but their SELECT policy is scoped to `authenticated` — an anonymous
 *   read-only key cannot see them. This provider therefore cannot supply
 *   jersey numbers or minute-accurate goalscorer data; `fetchLineups`
 *   reports `jerseyNumber: null` for every player rather than guessing, and
 *   the app's own admin UI is where a jersey number gets entered by a human.
 *
 * This is a genuinely separate Supabase project: connect with a second,
 * read-only anon key (TIPPSPIEL_SUPABASE_URL / TIPPSPIEL_SUPABASE_ANON_KEY),
 * never the service role, and this file only ever calls `.select()` (see
 * ./read-only-client.ts — there is no other method available to call).
 */
export class ExistingTippspielProvider implements MatchDataProvider {
  readonly id = 'wildenroth_tippspiel'
  readonly sourceType = 'wildenroth_tippspiel' as const

  private client: ReadOnlyClient | null = null

  private getClient(): ReadOnlyClient | null {
    const url = process.env.TIPPSPIEL_SUPABASE_URL
    const key = process.env.TIPPSPIEL_SUPABASE_ANON_KEY
    if (!url || !key) return null
    if (!this.client) this.client = createReadOnlyClient(url, key)
    return this.client
  }

  async isAvailable() {
    return this.getClient() !== null
  }

  /** `tippspiel:<matches.id>` — the format every method here uses/expects as `sourceIdentifier`. */
  static matchSourceIdentifier(tippspielMatchId: number): string {
    return `tippspiel:${tippspielMatchId}`
  }

  static parseTippspielMatchId(sourceIdentifier: string): number | null {
    const m = /^tippspiel:(\d+)$/.exec(sourceIdentifier)
    return m ? Number(m[1]) : null
  }

  /** `tippspiel:team:<teams.id>` — used so an opponent can be re-matched across syncs without relying on name spelling staying identical. */
  static teamSourceIdentifier(tippspielTeamId: number): string {
    return `tippspiel:team:${tippspielTeamId}`
  }

  async fetchMatches({ teamName, from, to }: { teamName: string; from: string; to: string }): Promise<ProviderMatch[]> {
    const client = this.getClient()
    if (!client) return []

    const { data: teams, error: teamsError } = await client.from('teams').select('id, name').ilike('name', `%${teamName}%`)
    if (teamsError || !teams) return []
    const teamIds = new Set(teams.map((t: { id: number }) => t.id))
    if (teamIds.size === 0) return []

    const { data: matches, error } = await client
      .from('matches')
      .select(
        'id, match_date, home_team_id, away_team_id, home_score, away_score, status, matchday, match_category, competition_name, home_team:home_team_id(id, name), away_team:away_team_id(id, name)'
      )
      .gte('match_date', from)
      .lte('match_date', to)
      .order('match_date', { ascending: true })

    if (error || !matches) return []

    type KnownStatus = 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled'
    const KNOWN_STATUSES = new Set<string>(['scheduled', 'live', 'finished', 'postponed', 'cancelled'])
    function toKnownStatus(status: string): KnownStatus {
      return KNOWN_STATUSES.has(status) ? (status as KnownStatus) : 'scheduled'
    }

    interface TippspielMatchRow {
      id: number
      match_date: string
      home_team_id: number
      away_team_id: number
      home_score: number | null
      away_score: number | null
      status: string
      matchday: number | null
      match_category: string | null
      competition_name: string | null
      home_team: { id: number; name: string } | null
      away_team: { id: number; name: string } | null
    }

    return (matches as unknown as TippspielMatchRow[])
      .filter((m) => teamIds.has(m.home_team_id) || teamIds.has(m.away_team_id))
      .map((m): ProviderMatch => {
        const isHome = teamIds.has(m.home_team_id)
        const opponentTeam = isHome ? m.away_team : m.home_team
        return {
          sourceIdentifier: ExistingTippspielProvider.matchSourceIdentifier(m.id),
          kickoffAt: new Date(m.match_date).toISOString(),
          homeAway: isHome ? 'home' : 'away',
          opponentName: opponentTeam?.name ?? 'Unbekannt',
          opponentSourceIdentifier: opponentTeam ? ExistingTippspielProvider.teamSourceIdentifier(opponentTeam.id) : null,
          matchday: m.matchday ?? null,
          competitionName: m.competition_name ?? m.match_category ?? null,
          status: toKnownStatus(m.status),
          ourScore: isHome ? m.home_score : m.away_score,
          opponentScore: isHome ? m.away_score : m.home_score,
          htOurScore: null,
          htOpponentScore: null,
          venue: null,
        }
      })
  }

  async fetchLineups({
    matchSourceIdentifier,
    ownTeamNames,
  }: {
    matchSourceIdentifier: string
    ownTeamNames: string[]
  }): Promise<ProviderMatchLineups | null> {
    const client = this.getClient()
    if (!client) return null

    const tippspielId = ExistingTippspielProvider.parseTippspielMatchId(matchSourceIdentifier)
    if (tippspielId === null) return null

    const { data: rows, error } = await client
      .from('match_lineups')
      .select('team_name, player_name, is_starter, position, minutes_played, goals, assists, yellow_cards, red_card_minute, penalty_missed')
      .eq('match_id', tippspielId)

    if (error || !rows || rows.length === 0) return null

    const ownNamesLower = new Set(ownTeamNames.map((n) => n.toLowerCase()))
    const own: ProviderLineupPlayer[] = []
    const opponent: ProviderLineupPlayer[] = []

    interface TippspielLineupRow {
      team_name: string
      player_name: string
      is_starter: boolean | null
      position: string | null
      minutes_played: number | null
      goals: number | null
      assists: number | null
      yellow_cards: number | null
      red_card_minute: number | null
      penalty_missed: boolean | null
    }

    for (const row of rows as unknown as TippspielLineupRow[]) {
      const player: ProviderLineupPlayer = {
        playerName: row.player_name,
        jerseyNumber: null,
        position: row.position ?? null,
        isStarting: row.is_starter ?? null,
        minutesPlayed: row.minutes_played ?? null,
        goals: row.goals ?? 0,
        assists: row.assists ?? 0,
        yellowCards: row.yellow_cards ?? 0,
        redCardMinute: row.red_card_minute ?? null,
        penaltyMissed: Boolean(row.penalty_missed),
      }
      if (ownNamesLower.has(String(row.team_name).toLowerCase())) own.push(player)
      else opponent.push(player)
    }

    return { matchSourceIdentifier, own, opponent }
  }
}
