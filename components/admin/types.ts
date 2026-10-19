/**
 * Geteilte Typen für den Admin-Bereich — ausgelagert aus app/admin/page.tsx, damit sowohl die
 * Seite als auch die neuen, rein darstellenden Komponenten (ResultCards, ErgebnisseTabView, …)
 * sie importieren können, ohne dass eine Seite von einer Komponente importiert oder umgekehrt
 * ein Kreis entsteht. Reine Typdeklarationen, keine Logik — unverändert gegenüber den bisherigen
 * Interfaces in app/admin/page.tsx.
 */

export interface MatchRow {
  id: number
  match_number: number
  matchday: number
  match_date: string
  status: string
  home_score: number | null
  away_score: number | null
  home_team: { name: string; short_name: string } | null
  away_team: { name: string; short_name: string } | null
  match_category: string | null
  is_topspiel: boolean
  competition_type?: string | null
  tippspiel_matchday?: number | null
}

/** Draft row for the inline Spieltag-tab scorer entry — mirrors the shape
 *  `/api/admin/goalscorers/scorers` expects, minus the DB-only `id`. */
export interface ScorerDraft {
  playerId: number
  goals: number
  isOwnGoal: boolean
}
