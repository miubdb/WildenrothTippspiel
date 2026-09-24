'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth'
import type { HomeAway } from '@/types/database'

async function requireEditAccess(squadId: string) {
  const membership = await getCurrentMembership()
  if (!membership) throw new Error('Nicht angemeldet.')
  if (!membership.isOrgAdmin && !membership.squadIds.includes(squadId)) throw new Error('Keine Berechtigung für diese Mannschaft.')
  return membership
}

export async function createMatch(formData: FormData) {
  const squadId = String(formData.get('squadId') ?? '')
  const membership = await requireEditAccess(squadId)
  const supabase = await createClient()

  const seasonId = String(formData.get('seasonId') ?? '')
  const opponentTeamId = String(formData.get('opponentTeamId') ?? '')
  const competitionId = String(formData.get('competitionId') ?? '') || null
  const homeAway = String(formData.get('homeAway') ?? 'home')
  const kickoffAt = String(formData.get('kickoffAt') ?? '')
  const matchdayRaw = String(formData.get('matchday') ?? '').trim()

  if (!seasonId || !opponentTeamId || !kickoffAt) throw new Error('Pflichtfelder fehlen.')

  const { data: created, error } = await supabase
    .from('matches')
    .insert({
      org_id: membership.orgId,
      squad_id: squadId,
      season_id: seasonId,
      opponent_team_id: opponentTeamId,
      competition_id: competitionId,
      home_away: homeAway as HomeAway,
      kickoff_at: new Date(kickoffAt).toISOString(),
      matchday: matchdayRaw ? Number(matchdayRaw) : null,
      status: 'scheduled',
    })
    .select('id')
    .single()

  if (error || !created) throw new Error(error?.message ?? 'Spiel konnte nicht angelegt werden.')

  // Manually created matches are their own source of truth from the start —
  // recorded in source_imports with source_type 'manual' for a consistent
  // provenance trail across every match, not only imported ones.
  const { data: manualSource } = await supabase.from('data_sources').select('id').eq('org_id', membership.orgId).eq('source_type', 'manual').maybeSingle()
  if (manualSource) {
    await supabase.from('source_imports').insert({
      org_id: membership.orgId,
      data_source_id: manualSource.id,
      entity_type: 'matches',
      entity_id: created.id,
      source_identifier: `manual:${created.id}`,
      confidence: 1,
    })
  }

  revalidatePath('/matches')
  redirect(`/matches/${created.id}`)
}

async function requireEditAccessForMatch(supabase: Awaited<ReturnType<typeof createClient>>, matchId: string) {
  const { data: match } = await supabase.from('matches').select('id, squad_id').eq('id', matchId).single()
  if (!match) throw new Error('Spiel nicht gefunden.')
  await requireEditAccess(match.squad_id)
  return match
}

/**
 * Updates core match fields and marks each changed field as manually
 * edited, so a later Tippspiel sync will surface a conflict instead of
 * silently overwriting this correction (spec requirement).
 */
export async function updateMatchResult(matchId: string, formData: FormData) {
  const supabase = await createClient()
  await requireEditAccessForMatch(supabase, matchId)

  const { data: current } = await supabase.from('matches').select('manually_edited_fields, our_score, opponent_score, status, kickoff_at').eq('id', matchId).single()
  if (!current) throw new Error('Spiel nicht gefunden.')

  const ourScoreRaw = String(formData.get('ourScore') ?? '').trim()
  const opponentScoreRaw = String(formData.get('opponentScore') ?? '').trim()
  const status = String(formData.get('status') ?? current.status)
  const kickoffAt = String(formData.get('kickoffAt') ?? '')

  const nextValues: Record<string, unknown> = {
    our_score: ourScoreRaw === '' ? null : Number(ourScoreRaw),
    opponent_score: opponentScoreRaw === '' ? null : Number(opponentScoreRaw),
    status,
    kickoff_at: kickoffAt ? new Date(kickoffAt).toISOString() : current.kickoff_at,
  }

  const changedFields = Object.keys(nextValues).filter((field) => {
    const before = (current as Record<string, unknown>)[field]
    const after = nextValues[field]
    if (field === 'kickoff_at') return new Date(before as string).getTime() !== new Date(after as string).getTime()
    return before !== after
  })

  const manuallyEditedFields = new Set(current.manually_edited_fields)
  for (const field of changedFields) manuallyEditedFields.add(field)

  await supabase
    .from('matches')
    .update({ ...nextValues, manually_edited_fields: Array.from(manuallyEditedFields) })
    .eq('id', matchId)

  revalidatePath(`/matches/${matchId}`)
}
