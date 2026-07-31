import { SupabaseClient } from '@supabase/supabase-js'
import type { Match } from '@/types'

/**
 * Returns Monday 12:00 Europe/Berlin of the week containing refDate.
 * Single source of truth for the "betting opens Monday noon" rule — do not
 * reimplement this elsewhere. Uses Date.UTC (not raw day-of-month subtraction)
 * so month/year boundaries (e.g. day 1 minus 2 days) resolve correctly instead
 * of producing an invalid date string like "2026-07--1".
 */
export function bettingOpenTime(refDate: Date): Date {
  const berlinDate = refDate.toLocaleDateString('sv', { timeZone: 'Europe/Berlin' })
  const [y, m, d] = berlinDate.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=Sun..6=Sat
  const daysBack = dow === 0 ? 6 : dow - 1
  const mondayStr = new Date(Date.UTC(y, m - 1, d - daysBack)).toISOString().slice(0, 10)
  // Determine Berlin UTC offset at Monday noon and convert to UTC
  const probe = new Date(`${mondayStr}T12:00:00Z`)
  const berlinHour = parseInt(
    new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(probe),
    10
  )
  const utcHour = 24 - berlinHour
  return new Date(`${mondayStr}T${String(utcHour).padStart(2, '0')}:00:00Z`)
}

/** Returns true if the current season has started.
 *  Priority: app_settings.season_started=true  OR  first matchday-1 match has kicked off */
export async function isSeasonStarted(supabase: SupabaseClient): Promise<boolean> {
  // Check admin flag first
  const { data: setting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'season_started')
    .single()
  if (setting?.value === 'true') return true

  // Fallback: first match of matchday 1 in the current (26/27) season
  const { data: firstMatch } = await supabase
    .from('matches')
    .select('match_date')
    .eq('matchday', 1)
    .gte('match_date', '2026-08-01')
    .order('match_date', { ascending: true })
    .limit(1)
    .single()
  if (!firstMatch) return false
  return new Date(firstMatch.match_date) <= new Date()
}

/** Returns true iff the real first matchday-1 match of the current season has
 *  actually kicked off. Unlike isSeasonStarted(), this ignores the admin-togglable
 *  app_settings.season_started display flag — use this wherever "has the season
 *  truly begun" gates something consequential (registration eligibility, payouts),
 *  since that flag can be set early purely to display the real schedule. */
export async function hasFirstMatchdayKickedOff(supabase: SupabaseClient): Promise<boolean> {
  const { data: firstMatch } = await supabase
    .from('matches')
    .select('match_date')
    .eq('matchday', 1)
    .gte('match_date', '2026-08-01')
    .order('match_date', { ascending: true })
    .limit(1)
    .single()
  if (!firstMatch) return false
  return new Date(firstMatch.match_date) <= new Date()
}

const isKreisligaMatch = (m: Pick<Match, 'match_category'>) =>
  !m.match_category || m.match_category === 'kreisliga'

export interface EffectiveMatchdayIndex {
  kreisligaMatchdaysSorted: number[]
  matchdayMinDate: Map<number, number>
  matchdayMaxDate: Map<number, number>
}

/**
 * Kreisliga (1. Mannschaft) defines the Tippspiel-Spieltag structure. Wildenroth II
 * and B-Klasse-Topspiel matches run on their own, independent BFV matchday
 * numbering — their raw `matchday` number is NOT meaningful on its own. Build
 * this index once per request from ALL current-season matches, then look up
 * each match's *effective* Spieltag via `effectiveMatchdayOf`.
 *
 * Single source of truth — every place that groups matches/bets by "the
 * Spieltag the user bet under" must use this, not the raw `matchday` column,
 * or it silently disagrees with what tipps/page.tsx displayed and let the
 * user bet on. This has drifted out of sync between files before.
 */
export function buildEffectiveMatchdayIndex(seasonMatches: Match[]): EffectiveMatchdayIndex {
  const kreisligaMatches = seasonMatches.filter((m) => m.matchday !== 999 && isKreisligaMatch(m))
  const matchdayMinDate = new Map<number, number>()
  const matchdayMaxDate = new Map<number, number>()
  for (const m of kreisligaMatches) {
    const t = new Date(m.match_date).getTime()
    const prevMin = matchdayMinDate.get(m.matchday)
    if (prevMin === undefined || t < prevMin) matchdayMinDate.set(m.matchday, t)
    const prevMax = matchdayMaxDate.get(m.matchday)
    if (prevMax === undefined || t > prevMax) matchdayMaxDate.set(m.matchday, t)
  }
  const kreisligaMatchdaysSorted = [...matchdayMinDate.keys()].sort(
    (a, b) => matchdayMinDate.get(a)! - matchdayMinDate.get(b)!
  )
  return { kreisligaMatchdaysSorted, matchdayMinDate, matchdayMaxDate }
}

/**
 * Assigns a Wildenroth-II / Topspiel-flagged B-Klasse match to the Kreisliga
 * Spieltag whose date range it falls inside (or the nearest one by distance
 * otherwise). Plain B-Klasse matches (not the admin-selected weekly Topspiel)
 * return null — they're never bettable and never shown on the Tippspiel page.
 */
export function effectiveMatchdayOf(m: Match, index: EffectiveMatchdayIndex): number | null {
  if (m.matchday === 999) return 999
  if (isKreisligaMatch(m)) return m.matchday
  const isWildenrothII = m.match_category === 'wildenroth_ii'
  const isTopspiel = m.match_category === 'bklasse_topspiel' || (m.match_category === 'b-klasse' && m.is_topspiel)
  if (!isWildenrothII && !isTopspiel) return null
  if (index.kreisligaMatchdaysSorted.length === 0) return null
  const t = new Date(m.match_date).getTime()
  let best: number = index.kreisligaMatchdaysSorted[0]
  let bestDist = Infinity
  for (const md of index.kreisligaMatchdaysSorted) {
    const min = index.matchdayMinDate.get(md)!
    const max = index.matchdayMaxDate.get(md)!
    const dist = t < min ? min - t : t > max ? t - max : 0
    if (dist < bestDist) { bestDist = dist; best = md }
  }
  return best
}
