import { createClient } from '@/lib/supabase/server'
import { BottomNav } from '@/components/BottomNav'
import { activeTippMatchday, countPlacedSlots, type NavBetState } from '@/components/navBetState'
import { SEASON_START } from '@/lib/season'
import { fetchAllRowsParallel } from '@/app/_lib/fetchAllRowsParallel'

/**
 * Untere Navigation mit der Anzeige „platzierte Scheine des aktuellen Spieltags“. Die Zahl braucht zwei Abfragen (Spielplan → Wetten);
 * damit sie die Seite nicht aufhält, wird sie per Streaming nachgereicht: Die Navigation erscheint sofort ohne Zahl (Suspense-Fallback in
 * app/(app)/layout.tsx), die Zahl folgt, sobald die Daten da sind. Definition der Zahl: components/navBetState.ts.
 */
export async function NavBottom({ userId }: { userId: string }) {
  const supabase = await createClient()
  let navBets: NavBetState | null = null
  try {
    const seasonMatches = await fetchAllRowsParallel((from, to) => supabase
      .from('matches')
      .select('id, matchday, match_date, status, match_category, is_topspiel, tippspiel_matchday, competition_type', { count: 'exact' })
      .or(`match_date.gte.${SEASON_START},matchday.eq.999`)
      .order('id').range(from, to))
    const active = activeTippMatchday(seasonMatches as never)
    if (active.matchday != null && active.matchIds.length > 0) {
      const { data: rows } = await supabase.from('bets').select('combo_id, is_risky, is_bonus').eq('user_id', userId).in('match_id', active.matchIds).neq('status', 'void')
      const { normal, risky } = countPlacedSlots(rows ?? [])
      navBets = { matchday: active.matchday, normal, risky }
    }
  } catch { /* ein Fehler blendet die Zahl einfach aus */ }
  return <BottomNav navBets={navBets} />
}
