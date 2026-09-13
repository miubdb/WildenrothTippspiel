import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * "Bonus-Tipps" (UI-Name; DB/Code: bonus_tips) — Prognosen OHNE Einsatz,
 * getrennt von bets/combo_bets. Richtige Antwort zahlt eine feste Belohnung
 * (Default 100 Wildis, pro Bonus-Tipp konfigurierbar), falsche Antwort zahlt
 * nichts (nie negativ). Siehe Migration add_bonus_tips_system für Schema/RLS
 * und die SECURITY DEFINER-Funktion evaluate_bonus_tip_payout für die
 * atomare, idempotente Gutschrift.
 */

export type BonusTipType =
  | 'total_goals_matchday'
  | 'match_goals'
  | 'highest_scoring_match'
  | 'biggest_win_matchday'
  | 'long_term'

export const BONUS_TIP_TYPE_LABEL: Record<BonusTipType, string> = {
  total_goals_matchday: 'Gesamttore eines Spieltags',
  match_goals: 'Tore in einem bestimmten Spiel',
  highest_scoring_match: 'Torreichstes Spiel des Spieltags',
  biggest_win_matchday: 'Höchster Sieg des Spieltags',
  long_term: 'Langzeit-/Winterpausen-Prognose',
}

/** true für die 4 Typen, deren korrekte Antwort automatisch aus
 *  matches.home_score/away_score berechnet werden kann. 'long_term' braucht
 *  immer eine manuelle Admin-Eingabe (siehe evaluateBonusTip unten). */
export function isAutoEvaluable(type: BonusTipType): boolean {
  return type !== 'long_term'
}

export interface BonusTipOption {
  key: string
  label: string
  /** Für highest_scoring_match/biggest_win_matchday: welches Spiel diese
   *  Option repräsentiert. */
  matchId?: number
  /** Für total_goals_matchday/match_goals: Intervall- oder Exaktwert-Grenzen. */
  minGoals?: number
  maxGoals?: number
  exactGoals?: number
}

export interface BonusTip {
  id: number
  created_by: string | null
  title: string
  description: string
  type: BonusTipType
  scope_matchday: number | null
  scope_match_id: number | null
  period_label: string | null
  options: BonusTipOption[]
  opens_at: string
  closes_at: string
  reward_wildis: number
  group_key: string | null
  group_max_per_user: number | null
  correct_option_keys: string[] | null
  evaluated_at: string | null
  created_at: string
}

export type BonusTipStatus = 'upcoming' | 'open' | 'closed' | 'evaluated'

export function bonusTipStatus(t: Pick<BonusTip, 'opens_at' | 'closes_at' | 'evaluated_at'>, now: Date = new Date()): BonusTipStatus {
  if (t.evaluated_at) return 'evaluated'
  const n = now.getTime()
  if (n < new Date(t.opens_at).getTime()) return 'upcoming'
  if (n < new Date(t.closes_at).getTime()) return 'open'
  return 'closed'
}

type MatchFacts = { id: number; home_score: number | null; away_score: number | null; status: string }

/**
 * Berechnet für einen automatisch auswertbaren Bonus-Tipp die Menge der
 * korrekten `option.key`s (mehrere bei Gleichstand — siehe Aufgabenstellung
 * "torreichstes Spiel"/"höchster Sieg": alle geteilten Sieger gelten als
 * richtig). Gibt null zurück, wenn die nötigen Spiele noch nicht (alle)
 * beendet sind — dann darf noch nicht ausgewertet werden.
 */
export function computeCorrectOptionKeys(tip: Pick<BonusTip, 'type' | 'options'>, matches: MatchFacts[]): string[] | null {
  const byId = new Map(matches.map(m => [m.id, m]))

  if (tip.type === 'total_goals_matchday') {
    // Alle referenzierten Spiele müssen fertig sein, um die Gesamtzahl zu kennen.
    if (matches.length === 0 || matches.some(m => m.status !== 'finished' || m.home_score == null || m.away_score == null)) return null
    const total = matches.reduce((a, m) => a + (m.home_score ?? 0) + (m.away_score ?? 0), 0)
    return tip.options.filter(o => matchesGoalCount(o, total)).map(o => o.key)
  }

  if (tip.type === 'match_goals') {
    const m = matches[0]
    if (!m || m.status !== 'finished' || m.home_score == null || m.away_score == null) return null
    const total = m.home_score + m.away_score
    return tip.options.filter(o => matchesGoalCount(o, total)).map(o => o.key)
  }

  if (tip.type === 'highest_scoring_match') {
    const relevant = tip.options.map(o => (o.matchId != null ? byId.get(o.matchId) : undefined))
    if (relevant.some(m => !m || m.status !== 'finished' || m.home_score == null || m.away_score == null)) return null
    const goalsByOption = tip.options.map((o, i) => ({ key: o.key, goals: (relevant[i]!.home_score ?? 0) + (relevant[i]!.away_score ?? 0) }))
    const max = Math.max(...goalsByOption.map(g => g.goals))
    return goalsByOption.filter(g => g.goals === max).map(g => g.key)
  }

  if (tip.type === 'biggest_win_matchday') {
    const relevant = tip.options.map(o => (o.matchId != null ? byId.get(o.matchId) : undefined))
    if (relevant.some(m => !m || m.status !== 'finished' || m.home_score == null || m.away_score == null)) return null
    const diffByOption = tip.options.map((o, i) => ({ key: o.key, diff: Math.abs((relevant[i]!.home_score ?? 0) - (relevant[i]!.away_score ?? 0)) }))
    const max = Math.max(...diffByOption.map(d => d.diff))
    if (max === 0) return [] // kein einziges Spiel mit echtem Sieg (nur Unentschieden) -> niemand richtig
    return diffByOption.filter(d => d.diff === max).map(d => d.key)
  }

  return null // 'long_term' — immer manuell, siehe isAutoEvaluable
}

function matchesGoalCount(o: BonusTipOption, total: number): boolean {
  if (o.exactGoals != null) return total === o.exactGoals
  const min = o.minGoals ?? -Infinity
  const max = o.maxGoals ?? Infinity
  return total >= min && total <= max
}

/**
 * Lädt genau die Match-Fakten, die computeCorrectOptionKeys für diesen
 * Bonus-Tipp braucht (scope_matchday-Spiele für total_goals_matchday,
 * scope_match_id für match_goals, die in den Optionen referenzierten
 * matchIds für highest_scoring_match/biggest_win_matchday).
 */
export async function loadRelevantMatches(
  supabase: SupabaseClient,
  tip: Pick<BonusTip, 'type' | 'scope_matchday' | 'scope_match_id' | 'options'>,
): Promise<MatchFacts[]> {
  let matchIds: number[] = []
  if (tip.type === 'match_goals' && tip.scope_match_id != null) {
    matchIds = [tip.scope_match_id]
  } else if (tip.type === 'highest_scoring_match' || tip.type === 'biggest_win_matchday') {
    matchIds = tip.options.map(o => o.matchId).filter((id): id is number => id != null)
  } else if (tip.type === 'total_goals_matchday' && tip.scope_matchday != null) {
    // effektive Spieltag-Zuordnung wie überall sonst — Wildenroth-II/Topspiel
    // eingeschlossen, nicht nur die rohe Kreisliga-Spieltagsnummer.
    const { buildEffectiveMatchdayIndex, effectiveMatchdayOf } = await import('./season')
    type SeasonMatchRow = {
      id: number; matchday: number; tippspiel_matchday: number | null; match_date: string
      match_category: string | null; is_topspiel: boolean | null
      home_team_id: number; away_team_id: number; status: string
      home_score: number | null; away_score: number | null
    }
    const { data: seasonMatchesRaw } = await supabase
      .from('matches')
      .select('id, matchday, tippspiel_matchday, match_date, match_category, is_topspiel, home_team_id, away_team_id, status, home_score, away_score')
      .or('match_date.gte.2026-08-01,matchday.eq.999')
    const seasonMatches = (seasonMatchesRaw ?? []) as SeasonMatchRow[]
    const mdIndex = buildEffectiveMatchdayIndex(seasonMatches as never)
    const md = tip.scope_matchday
    // seasonMatches already carries home_score/away_score/status — return
    // directly instead of a second query for the same rows.
    return seasonMatches.filter(m => effectiveMatchdayOf(m as never, mdIndex) === md)
  }
  if (matchIds.length === 0) return []
  const { data } = await supabase.from('matches').select('id, home_score, away_score, status').in('id', matchIds)
  return (data ?? []) as MatchFacts[]
}
