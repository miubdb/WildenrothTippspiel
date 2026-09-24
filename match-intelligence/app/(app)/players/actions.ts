'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth'

export async function createPlayer(formData: FormData) {
  const membership = await getCurrentMembership()
  if (!membership || !membership.isOrgAdmin) throw new Error('Nicht autorisiert.')

  const firstName = String(formData.get('firstName') ?? '').trim()
  const lastName = String(formData.get('lastName') ?? '').trim()
  const birthYearRaw = String(formData.get('birthYear') ?? '').trim()
  const isGoalkeeper = formData.get('isGoalkeeper') === 'on'
  if (!firstName || !lastName) throw new Error('Vorname und Nachname erforderlich.')

  const supabase = await createClient()
  await supabase.from('players').insert({
    org_id: membership.orgId,
    first_name: firstName,
    last_name: lastName,
    birth_year: birthYearRaw ? Number(birthYearRaw) : null,
    is_goalkeeper: isGoalkeeper,
  })
  revalidatePath('/players')
}

export async function updatePlayer(playerId: string, formData: FormData) {
  const membership = await getCurrentMembership()
  if (!membership || !membership.isOrgAdmin) throw new Error('Nicht autorisiert.')

  const firstName = String(formData.get('firstName') ?? '').trim()
  const lastName = String(formData.get('lastName') ?? '').trim()
  const birthYearRaw = String(formData.get('birthYear') ?? '').trim()
  const isGoalkeeper = formData.get('isGoalkeeper') === 'on'
  const isActive = formData.get('isActive') === 'on'

  const supabase = await createClient()
  await supabase
    .from('players')
    .update({
      first_name: firstName,
      last_name: lastName,
      birth_year: birthYearRaw ? Number(birthYearRaw) : null,
      is_goalkeeper: isGoalkeeper,
      is_active: isActive,
    })
    .eq('id', playerId)
  revalidatePath('/players')
}
