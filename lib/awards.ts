import { SupabaseClient } from '@supabase/supabase-js'

export type AwardType =
  | 'spieltagskoenig'
  | 'eier_aus_stahl'
  | 'unlucky_bastard'
  | 'ergebnis_orakel'
  | 'griff_ins_klo'
  | 'betonmischer'
  | 'on_fire'

export const AWARD_META: Record<AwardType, { title: string; icon: string; description: string }> = {
  spieltagskoenig: { icon: '🏆', title: 'Spieltagskönig',    description: 'Bester Spieltagssaldo' },
  eier_aus_stahl:  { icon: '🥚', title: 'Eier aus Stahl',    description: 'Höchste gewonnene Quote' },
  unlucky_bastard: { icon: '😭', title: 'Unlucky Bastard',   description: 'Nur ein Tipp von einem großen Gewinn entfernt' },
  ergebnis_orakel: { icon: '🔮', title: 'Ergebnis-Orakel',   description: 'Exaktes Ergebnis richtig getippt' },
  griff_ins_klo:   { icon: '🚽', title: 'Griff ins Klo',     description: 'Höchster verlorener Einsatz' },
  betonmischer:    { icon: '🧱', title: 'Betonmischer',       description: 'Sicherster gewonnener Tipp' },
  on_fire:         { icon: '🔥', title: 'On Fire',            description: 'Meiste gewonnene Wettscheine' },
}

export interface AwardInput {
  user_id: string
  award_type: AwardType
  value?: number
  value_text?: string
}

export async function persistAwards(
  supabase: SupabaseClient,
  season: string,
  matchday: number,
  awards: AwardInput[]
) {
  if (awards.length === 0) return
  if (matchday === 999) return
  const rows = awards.map(a => ({
    user_id: a.user_id,
    season,
    matchday,
    award_type: a.award_type,
    award_title: AWARD_META[a.award_type].title,
    award_description: AWARD_META[a.award_type].description,
    award_icon: AWARD_META[a.award_type].icon,
    value: a.value ?? null,
    value_text: a.value_text ?? null,
  }))
  await supabase
    .from('user_awards')
    .upsert(rows, { onConflict: 'user_id,season,matchday,award_type' })
}
