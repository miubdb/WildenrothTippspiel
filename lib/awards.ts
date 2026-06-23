import { SupabaseClient } from '@supabase/supabase-js'

export type AwardType = 'mvp' | 'best_odds' | 'risky_hit' | 'best_combo' | 'unlucky_bastard' | 'biggest_loss' | 'safest_tip' | 'wildenroth_optimist' | 'craziest_bet' | 'safest_banker' | 'glaskugel'

export const AWARD_META: Record<AwardType, { title: string; icon: string; description: string }> = {
  mvp:                 { icon: '🏆', title: 'Spieltags-König',      description: 'Bester Saldo des Spieltags' },
  best_odds:           { icon: '🎯', title: 'Mutigster Treffer',    description: 'Höchste gewonnene Quote' },
  risky_hit:           { icon: '🎲', title: 'Risky-Held',           description: 'Beste gewonnene Risky-Wette' },
  best_combo:          { icon: '🔗', title: 'Kombi-König',          description: 'Beste gewonnene Kombiwette' },
  unlucky_bastard:     { icon: '😬', title: 'Pechvogel',            description: 'Kombi an einem Tipp gescheitert' },
  biggest_loss:        { icon: '💸', title: 'Größter Verlust',      description: 'Höchster Einsatz verloren' },
  safest_tip:          { icon: '🧠', title: 'Sicherster Treffer',   description: 'Gewonnen mit niedrigster Quote' },
  wildenroth_optimist: { icon: '❤️', title: 'Wildenroth-Optimist', description: 'Meiste Wildis auf Wildenroth-Sieg' },
  craziest_bet:        { icon: '🤪', title: 'Verrückteste Wette',   description: 'Höchste Quote des Spieltags' },
  safest_banker:       { icon: '🛡️', title: 'Safest Banker',        description: 'Sicherster gewonnener Tipp' },
  glaskugel:           { icon: '🔮', title: 'Glaskugel',             description: 'Exaktes Ergebnis richtig getippt' },
}

export interface AwardInput { user_id: string; award_type: AwardType; value?: number; value_text?: string }

export async function persistAwards(supabase: SupabaseClient, season: string, matchday: number, awards: AwardInput[]) {
  if (awards.length === 0) return
  if (matchday === 999) return
  const rows = awards.map(a => ({
    user_id: a.user_id, season, matchday,
    award_type: a.award_type,
    award_title: AWARD_META[a.award_type].title,
    award_description: AWARD_META[a.award_type].description,
    award_icon: AWARD_META[a.award_type].icon,
    value: a.value ?? null,
    value_text: a.value_text ?? null,
  }))
  await supabase.from('user_awards').upsert(rows, { onConflict: 'user_id,season,matchday,award_type' })
}
