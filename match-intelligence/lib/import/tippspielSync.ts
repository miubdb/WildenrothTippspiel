import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { ExistingTippspielProvider } from '@/lib/providers/match-data/existing-tippspiel-provider'
import { reconcileFields, determineSyncAction } from '@/lib/import/reconcile'
import type { MatchDataProvider, ProviderLineupPlayer } from '@/lib/providers/match-data/types'

type DB = SupabaseClient<Database>

export interface SyncSummary {
  matchesCreated: number
  matchesUpdated: number
  matchesUnchanged: number
  conflictsCreated: number
  matchesConsidered: number
  error: string | null
}

/**
 * Orchestrates one "Datenquellen → Wildenroth Tippspiel → Synchronisieren"
 * run for a single squad. Reads from the read-only ExistingTippspielProvider
 * only; every write below is to OUR OWN database (`supabase`, the caller's
 * already-authenticated, RLS-scoped admin session) — the Tippspiel project
 * itself is never touched. Idempotent: re-running with no upstream changes
 * reports everything as "unchanged" and creates no duplicate rows, because
 * matching an already-imported match/team always goes through
 * `source_imports` (entity_type + source_identifier), never a fresh guess.
 */
export async function runTippspielSync(
  supabase: DB,
  params: { orgId: string; squadId: string; startedBy: string },
  provider: MatchDataProvider = new ExistingTippspielProvider()
): Promise<SyncSummary> {
  const { orgId, squadId } = params

  const { data: dataSource } = await supabase
    .from('data_sources')
    .select('id, config')
    .eq('org_id', orgId)
    .eq('source_type', 'wildenroth_tippspiel')
    .maybeSingle()

  if (!dataSource) {
    return emptySummary('Keine Datenquelle vom Typ "wildenroth_tippspiel" angelegt. Bitte zuerst unter Einstellungen → Datenquellen anlegen.')
  }

  const { data: squad } = await supabase.from('squads').select('id, name').eq('id', squadId).single()
  const { data: season } = await supabase.from('seasons').select('id, start_date').eq('org_id', orgId).eq('is_current', true).maybeSingle()

  if (!season) {
    return emptySummary('Keine aktuelle Saison konfiguriert (seasons.is_current). Bitte zuerst eine Saison anlegen.')
  }

  const config = (dataSource.config ?? {}) as { ownTeamNamesBySquad?: Record<string, string[]> }
  const ownTeamNames = config.ownTeamNamesBySquad?.[squadId] ?? []
  if (ownTeamNames.length === 0) {
    return emptySummary(
      `Kein Team-Name im Tippspiel für Squad "${squad?.name ?? squadId}" konfiguriert. Bitte unter Einstellungen → Datenquellen hinterlegen (z. B. "SpVgg Wildenroth").`
    )
  }

  if (!(await provider.isAvailable())) {
    return emptySummary('TIPPSPIEL_SUPABASE_URL / TIPPSPIEL_SUPABASE_ANON_KEY sind nicht konfiguriert.')
  }

  const { data: runRow } = await supabase
    .from('sync_runs')
    .insert({ org_id: orgId, data_source_id: dataSource.id, squad_id: squadId, status: 'running', started_by: params.startedBy })
    .select('id')
    .single()

  const summary: SyncSummary = { matchesCreated: 0, matchesUpdated: 0, matchesUnchanged: 0, conflictsCreated: 0, matchesConsidered: 0, error: null }

  try {
    const to = new Date()
    to.setDate(to.getDate() + 400)
    const providerMatches = await provider.fetchMatches({ teamName: ownTeamNames[0], from: season.start_date, to: to.toISOString() })
    summary.matchesConsidered = providerMatches.length

    for (const pm of providerMatches) {
      const opponentTeamId = await resolveOpponentTeam(supabase, { orgId, dataSourceId: dataSource.id, name: pm.opponentName, sourceIdentifier: pm.opponentSourceIdentifier })
      const competitionId = await resolveCompetition(supabase, { orgId, name: pm.competitionName ?? 'Liga' })

      const incoming: Record<string, unknown> = {
        kickoff_at: pm.kickoffAt,
        home_away: pm.homeAway,
        opponent_team_id: opponentTeamId,
        matchday: pm.matchday,
        competition_id: competitionId,
        status: pm.status,
        our_score: pm.ourScore,
        opponent_score: pm.opponentScore,
      }

      const { data: existingImport } = await supabase
        .from('source_imports')
        .select('id, entity_id')
        .eq('org_id', orgId)
        .eq('data_source_id', dataSource.id)
        .eq('entity_type', 'matches')
        .eq('source_identifier', pm.sourceIdentifier)
        .maybeSingle()

      let matchId: string

      if (!existingImport) {
        const { data: created, error } = await supabase
          .from('matches')
          .insert({ org_id: orgId, squad_id: squadId, season_id: season.id, ...incoming } as Database['public']['Tables']['matches']['Insert'])
          .select('id')
          .single()
        if (error || !created) throw new Error(`Match konnte nicht angelegt werden: ${error?.message}`)
        matchId = created.id
        await supabase.from('source_imports').insert({
          org_id: orgId,
          data_source_id: dataSource.id,
          entity_type: 'matches',
          entity_id: matchId,
          source_identifier: pm.sourceIdentifier,
          confidence: 1,
          raw_payload: pm as unknown as Database['public']['Tables']['source_imports']['Insert']['raw_payload'],
        })
        summary.matchesCreated++
      } else {
        matchId = existingImport.entity_id
        const { data: current } = await supabase
          .from('matches')
          .select('kickoff_at, home_away, opponent_team_id, matchday, competition_id, status, our_score, opponent_score, manually_edited_fields')
          .eq('id', matchId)
          .single()

        if (!current) throw new Error(`Referenzierter Match ${matchId} nicht gefunden.`)

        const { patch, conflicts } = reconcileFields(current, incoming, current.manually_edited_fields)
        const action = determineSyncAction(true, patch)

        if (action === 'update') {
          await supabase.from('matches').update(patch as Database['public']['Tables']['matches']['Update']).eq('id', matchId)
          summary.matchesUpdated++
        } else {
          summary.matchesUnchanged++
        }

        for (const conflict of conflicts) {
          const created = await recordConflictIfNew(supabase, { orgId, entityType: 'matches', entityId: matchId, field: conflict.field, currentValue: conflict.currentValue, incomingValue: conflict.incomingValue })
          if (created) summary.conflictsCreated++
        }

        await supabase.from('source_imports').update({ last_synced_at: new Date().toISOString() }).eq('id', existingImport.id)
      }

      await syncLineups(supabase, { orgId, matchId, sourceIdentifier: pm.sourceIdentifier, ownTeamNames, provider })
    }

    if (runRow) {
      await supabase
        .from('sync_runs')
        .update({
          status: 'completed',
          matches_created: summary.matchesCreated,
          matches_updated: summary.matchesUpdated,
          matches_unchanged: summary.matchesUnchanged,
          conflicts_created: summary.conflictsCreated,
          finished_at: new Date().toISOString(),
        })
        .eq('id', runRow.id)
    }

    return summary
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler beim Sync.'
    if (runRow) {
      await supabase.from('sync_runs').update({ status: 'failed', error: message, finished_at: new Date().toISOString() }).eq('id', runRow.id)
    }
    return { ...summary, error: message }
  }
}

function emptySummary(error: string): SyncSummary {
  return { matchesCreated: 0, matchesUpdated: 0, matchesUnchanged: 0, conflictsCreated: 0, matchesConsidered: 0, error }
}

async function resolveOpponentTeam(supabase: DB, params: { orgId: string; dataSourceId: string; name: string; sourceIdentifier: string | null }): Promise<string> {
  if (params.sourceIdentifier) {
    const { data: existingImport } = await supabase
      .from('source_imports')
      .select('entity_id')
      .eq('org_id', params.orgId)
      .eq('entity_type', 'teams')
      .eq('source_identifier', params.sourceIdentifier)
      .maybeSingle()
    if (existingImport) return existingImport.entity_id
  }

  const { data: byName } = await supabase.from('teams').select('id').eq('org_id', params.orgId).ilike('name', params.name).maybeSingle()
  if (byName) {
    if (params.sourceIdentifier) {
      await supabase.from('source_imports').insert({
        org_id: params.orgId,
        data_source_id: params.dataSourceId,
        entity_type: 'teams',
        entity_id: byName.id,
        source_identifier: params.sourceIdentifier,
        confidence: 0.9,
      })
    }
    return byName.id
  }

  const { data: created, error } = await supabase.from('teams').insert({ org_id: params.orgId, name: params.name, is_own_club: false }).select('id').single()
  if (error || !created) throw new Error(`Gegner-Team konnte nicht angelegt werden: ${error?.message}`)
  if (params.sourceIdentifier) {
    await supabase.from('source_imports').insert({
      org_id: params.orgId,
      data_source_id: params.dataSourceId,
      entity_type: 'teams',
      entity_id: created.id,
      source_identifier: params.sourceIdentifier,
      confidence: 1,
    })
  }
  return created.id
}

async function resolveCompetition(supabase: DB, params: { orgId: string; name: string }): Promise<string> {
  const { data: existing } = await supabase.from('competitions').select('id').eq('org_id', params.orgId).eq('name', params.name).maybeSingle()
  if (existing) return existing.id
  const { data: created, error } = await supabase.from('competitions').insert({ org_id: params.orgId, name: params.name }).select('id').single()
  if (error || !created) throw new Error(`Wettbewerb konnte nicht angelegt werden: ${error?.message}`)
  return created.id
}

/** Inserts a data_conflicts row only if no unresolved conflict for this exact field already exists — re-running a sync must not pile up duplicate conflict rows. */
async function recordConflictIfNew(
  supabase: DB,
  params: { orgId: string; entityType: string; entityId: string; field: string; currentValue: unknown; incomingValue: unknown }
): Promise<boolean> {
  const { data: existing } = await supabase
    .from('data_conflicts')
    .select('id')
    .eq('entity_type', params.entityType)
    .eq('entity_id', params.entityId)
    .eq('field_name', params.field)
    .is('resolved_at', null)
    .maybeSingle()
  if (existing) return false

  await supabase.from('data_conflicts').insert({
    org_id: params.orgId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    field_name: params.field,
    conflicting_values: [
      { source: 'manual', value: params.currentValue },
      { source: 'wildenroth_tippspiel', value: params.incomingValue },
    ] as unknown as Database['public']['Tables']['data_conflicts']['Insert']['conflicting_values'],
  })
  return true
}

async function syncLineups(
  supabase: DB,
  params: { orgId: string; matchId: string; sourceIdentifier: string; ownTeamNames: string[]; provider: MatchDataProvider }
) {
  const lineups = await params.provider.fetchLineups({ matchSourceIdentifier: params.sourceIdentifier, ownTeamNames: params.ownTeamNames })
  if (!lineups) return

  await syncLineupSide(supabase, { matchId: params.matchId, side: 'own', players: lineups.own })
  await syncLineupSide(supabase, { matchId: params.matchId, side: 'opponent', players: lineups.opponent })
}

async function syncLineupSide(supabase: DB, params: { matchId: string; side: 'own' | 'opponent'; players: ProviderLineupPlayer[] }) {
  if (params.players.length === 0) return

  const { data: existingLineup } = await supabase.from('match_lineups').select('id').eq('match_id', params.matchId).eq('side', params.side).maybeSingle()

  const lineupId =
    existingLineup?.id ??
    (
      await supabase
        .from('match_lineups')
        .insert({ match_id: params.matchId, side: params.side })
        .select('id')
        .single()
    ).data?.id

  if (!lineupId) return

  for (const player of params.players) {
    const incoming: Record<string, unknown> = {
      is_starting: player.isStarting,
      minutes_played: player.minutesPlayed,
      goals: player.goals,
      assists: player.assists,
      yellow_cards: player.yellowCards,
      red_card_minute: player.redCardMinute,
      penalty_missed: player.penaltyMissed,
    }

    const { data: existingRow } = await supabase
      .from('lineup_players')
      .select('id, is_starting, minutes_played, goals, assists, yellow_cards, red_card_minute, penalty_missed, manually_edited_fields')
      .eq('lineup_id', lineupId)
      .eq('raw_player_name', player.playerName)
      .maybeSingle()

    if (!existingRow) {
      await supabase.from('lineup_players').insert({
        lineup_id: lineupId,
        raw_player_name: player.playerName,
        ...incoming,
      } as Database['public']['Tables']['lineup_players']['Insert'])
      continue
    }

    const { patch } = reconcileFields(existingRow, incoming, existingRow.manually_edited_fields)
    if (Object.keys(patch).length > 0) {
      await supabase.from('lineup_players').update(patch as Database['public']['Tables']['lineup_players']['Update']).eq('id', existingRow.id)
    }
  }
}
