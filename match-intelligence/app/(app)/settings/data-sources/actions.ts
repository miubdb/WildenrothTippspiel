'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth'
import type { Database } from '@/types/database'

async function requireAdmin() {
  const membership = await getCurrentMembership()
  if (!membership || !membership.isOrgAdmin) throw new Error('Nicht autorisiert.')
  return membership
}

export async function createTippspielDataSource() {
  const membership = await requireAdmin()
  const supabase = await createClient()
  await supabase.from('data_sources').insert({
    org_id: membership.orgId,
    source_type: 'wildenroth_tippspiel',
    name: 'Wildenroth Tippspiel',
    config: { ownTeamNamesBySquad: {} },
  })
  revalidatePath('/settings/data-sources')
}

export async function setSquadTeamName(dataSourceId: string, squadId: string, teamName: string) {
  await requireAdmin()
  const supabase = await createClient()

  const { data: source } = await supabase.from('data_sources').select('config').eq('id', dataSourceId).single()
  const config = (source?.config ?? {}) as { ownTeamNamesBySquad?: Record<string, string[]> }
  const ownTeamNamesBySquad = { ...(config.ownTeamNamesBySquad ?? {}) }

  const trimmed = teamName.trim()
  if (trimmed) ownTeamNamesBySquad[squadId] = [trimmed]
  else delete ownTeamNamesBySquad[squadId]

  await supabase.from('data_sources').update({ config: { ...config, ownTeamNamesBySquad } }).eq('id', dataSourceId)
  revalidatePath('/settings/data-sources')
}

export async function resolveConflict(conflictId: string, resolution: 'keep_current' | 'accept_import') {
  const membership = await requireAdmin()
  const supabase = await createClient()

  const { data: conflict } = await supabase
    .from('data_conflicts')
    .select('id, entity_type, entity_id, field_name, conflicting_values')
    .eq('id', conflictId)
    .single()
  if (!conflict) throw new Error('Konflikt nicht gefunden.')

  const values = conflict.conflicting_values as unknown as { source: string; value: unknown }[]
  const currentValue = values.find((v) => v.source === 'manual')?.value
  const importValue = values.find((v) => v.source === 'wildenroth_tippspiel')?.value
  const resolutionValue = resolution === 'accept_import' ? importValue : currentValue

  if (conflict.entity_type === 'matches') {
    const { data: match } = await supabase.from('matches').select('manually_edited_fields').eq('id', conflict.entity_id).single()
    const fields = new Set(match?.manually_edited_fields ?? [])
    if (resolution === 'keep_current') fields.add(conflict.field_name)
    else fields.delete(conflict.field_name)

    const update: Record<string, unknown> = { manually_edited_fields: Array.from(fields) }
    if (resolution === 'accept_import') update[conflict.field_name] = importValue
    await supabase.from('matches').update(update as Database['public']['Tables']['matches']['Update']).eq('id', conflict.entity_id)
  } else if (conflict.entity_type === 'lineup_players') {
    const { data: row } = await supabase.from('lineup_players').select('manually_edited_fields').eq('id', conflict.entity_id).single()
    const fields = new Set(row?.manually_edited_fields ?? [])
    if (resolution === 'keep_current') fields.add(conflict.field_name)
    else fields.delete(conflict.field_name)

    const update: Record<string, unknown> = { manually_edited_fields: Array.from(fields) }
    if (resolution === 'accept_import') update[conflict.field_name] = importValue
    await supabase.from('lineup_players').update(update as Database['public']['Tables']['lineup_players']['Update']).eq('id', conflict.entity_id)
  }

  await supabase
    .from('data_conflicts')
    .update({ resolved_at: new Date().toISOString(), resolved_by: membership.profile.id, resolution_value: resolutionValue as never })
    .eq('id', conflictId)

  revalidatePath('/settings/data-sources')
}
