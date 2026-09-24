'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export async function createSquad(formData: FormData) {
  const membership = await getCurrentMembership()
  if (!membership || !membership.isOrgAdmin) throw new Error('Nicht autorisiert.')

  const name = String(formData.get('name') ?? '').trim()
  const level = String(formData.get('level') ?? '').trim()
  if (!name) throw new Error('Name erforderlich.')

  const supabase = await createClient()
  await supabase.from('squads').insert({ org_id: membership.orgId, name, slug: slugify(name), level: level || null })
  revalidatePath('/squads')
}

export async function updateSquad(squadId: string, formData: FormData) {
  const membership = await getCurrentMembership()
  if (!membership || !membership.isOrgAdmin) throw new Error('Nicht autorisiert.')

  const name = String(formData.get('name') ?? '').trim()
  const level = String(formData.get('level') ?? '').trim()
  const isActive = formData.get('isActive') === 'on'

  const supabase = await createClient()
  await supabase.from('squads').update({ name, level: level || null, is_active: isActive }).eq('id', squadId)
  revalidatePath(`/squads/${squadId}`)
  revalidatePath('/squads')
}

export async function addPlayerToSquad(squadId: string, seasonId: string, formData: FormData) {
  const membership = await getCurrentMembership()
  if (!membership || !membership.isOrgAdmin) throw new Error('Nicht autorisiert.')

  const supabase = await createClient()
  const existingPlayerId = String(formData.get('existingPlayerId') ?? '')
  const jerseyNumberRaw = String(formData.get('jerseyNumber') ?? '').trim()
  const position = String(formData.get('position') ?? '').trim()
  const jerseyNumber = jerseyNumberRaw ? Number(jerseyNumberRaw) : null

  let playerId = existingPlayerId
  if (!playerId) {
    const firstName = String(formData.get('firstName') ?? '').trim()
    const lastName = String(formData.get('lastName') ?? '').trim()
    const isGoalkeeper = formData.get('isGoalkeeper') === 'on'
    if (!firstName || !lastName) throw new Error('Vorname und Nachname erforderlich.')

    const { data: created, error } = await supabase
      .from('players')
      .insert({ org_id: membership.orgId, first_name: firstName, last_name: lastName, is_goalkeeper: isGoalkeeper })
      .select('id')
      .single()
    if (error || !created) throw new Error(error?.message ?? 'Spieler konnte nicht angelegt werden.')
    playerId = created.id
  }

  await supabase.from('player_squad_memberships').insert({
    player_id: playerId,
    squad_id: squadId,
    season_id: seasonId,
    jersey_number: jerseyNumber,
    position: position || null,
  })

  revalidatePath(`/squads/${squadId}`)
}

export async function updateMembership(membershipId: string, squadId: string, formData: FormData) {
  const membership = await getCurrentMembership()
  if (!membership || !membership.isOrgAdmin) throw new Error('Nicht autorisiert.')

  const jerseyNumberRaw = String(formData.get('jerseyNumber') ?? '').trim()
  const position = String(formData.get('position') ?? '').trim()
  const status = String(formData.get('status') ?? 'active')

  const supabase = await createClient()
  await supabase
    .from('player_squad_memberships')
    .update({ jersey_number: jerseyNumberRaw ? Number(jerseyNumberRaw) : null, position: position || null, status: status as never })
    .eq('id', membershipId)

  revalidatePath(`/squads/${squadId}`)
}

export async function createSeason(formData: FormData) {
  const membership = await getCurrentMembership()
  if (!membership || !membership.isOrgAdmin) throw new Error('Nicht autorisiert.')

  const name = String(formData.get('name') ?? '').trim()
  const startDate = String(formData.get('startDate') ?? '')
  const makeCurrent = formData.get('makeCurrent') === 'on'
  if (!name || !startDate) throw new Error('Name und Startdatum erforderlich.')

  const supabase = await createClient()
  if (makeCurrent) {
    await supabase.from('seasons').update({ is_current: false }).eq('org_id', membership.orgId).eq('is_current', true)
  }
  await supabase.from('seasons').insert({ org_id: membership.orgId, name, start_date: startDate, is_current: makeCurrent })
  revalidatePath('/squads')
  redirect('/squads')
}
