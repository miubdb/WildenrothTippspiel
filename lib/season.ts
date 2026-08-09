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
  /** Spieltag numbers ordered by earliest kickoff. This is CHRONOLOGICAL order,
   *  not numeric — the BFV plays Spieltage out of numeric sequence, so this is
   *  what "the Spieltag before this one" means. Used by the betting-window gate
   *  ("never two Spieltage open at once") and for tie-breaks in
   *  `nearestMatchdayByDate`. Do NOT render this to users — use
   *  `kreisligaMatchdaysNumeric` for any Spieltag picker. */
  kreisligaMatchdaysSorted: number[]
  /** Spieltag numbers in plain numeric ascending order (1, 2, 3, …). This is
   *  what every user-facing Spieltag selector must render: users look for
   *  "Spieltag 7" by its number, not by where it happens to fall in the
   *  calendar. */
  kreisligaMatchdaysNumeric: number[]
  matchdayMinDate: Map<number, number>
  /** Median kickoff timestamp per Kreisliga Spieltag — used (not min/max) to
   *  place a Wildenroth-II/Topspiel match, specifically because it stays
   *  stable when a single Kreisliga match of that Spieltag gets postponed and
   *  later rescheduled far out (a min/max window would balloon to cover that
   *  outlier date and could then wrongly "claim" a later Spieltag's matches). */
  matchdayAnchorDate: Map<number, number>
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
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
  const datesByMatchday = new Map<number, number[]>()
  for (const m of kreisligaMatches) {
    const t = new Date(m.match_date).getTime()
    const arr = datesByMatchday.get(m.matchday)
    if (arr) arr.push(t)
    else datesByMatchday.set(m.matchday, [t])
  }
  const matchdayMinDate = new Map<number, number>()
  const matchdayAnchorDate = new Map<number, number>()
  for (const [md, dates] of datesByMatchday) {
    dates.sort((a, b) => a - b)
    matchdayMinDate.set(md, dates[0])
    matchdayAnchorDate.set(md, median(dates))
  }
  const kreisligaMatchdaysSorted = [...matchdayMinDate.keys()].sort(
    (a, b) => matchdayMinDate.get(a)! - matchdayMinDate.get(b)!
  )
  const kreisligaMatchdaysNumeric = [...matchdayMinDate.keys()].sort((a, b) => a - b)
  return { kreisligaMatchdaysSorted, kreisligaMatchdaysNumeric, matchdayMinDate, matchdayAnchorDate }
}

function nearestMatchdayByDate(t: number, index: EffectiveMatchdayIndex): number | null {
  if (index.kreisligaMatchdaysSorted.length === 0) return null
  let best: number = index.kreisligaMatchdaysSorted[0]
  let bestDist = Infinity
  for (const md of index.kreisligaMatchdaysSorted) {
    const dist = Math.abs(t - index.matchdayAnchorDate.get(md)!)
    if (dist < bestDist) { bestDist = dist; best = md }
  }
  return best
}

/** A Kreisliga match whose kickoff has drifted more than this many days from
 *  its own Spieltag's median date is displayed/bet under whichever Spieltag
 *  it actually falls closest to instead of its own official number — a
 *  roughly one-week tolerance, since Spieltags themselves are usually about
 *  a week apart. Small BFV variance (a Monday catch-up 1-2 days out) stays
 *  under its own Spieltag; a genuine multi-week reschedule does not. */
const EFFECTIVE_OUTLIER_DAYS = 7

/**
 * Assigns a match to the Spieltag it should be displayed/bet under.
 *
 * Wildenroth-II / Topspiel-flagged B-Klasse matches run on their own,
 * independent BFV matchday numbering, so they're always placed on the
 * Kreisliga Spieltag whose median kickoff date they're closest to. Plain
 * B-Klasse matches (not the admin-selected weekly Topspiel) return null —
 * they're never bettable and never shown on the Tippspiel page.
 *
 * A KREISLIGA match normally keeps its own official BFV matchday number —
 * that's what tipps/page.tsx displays and what the user placed their bet
 * under. But once it drifts more than `EFFECTIVE_OUTLIER_DAYS` from its own
 * Spieltag's median date (a genuine reschedule to a different part of the
 * season, not just BFV's usual day-or-two variance), it's reassigned to
 * whichever Spieltag it actually falls closest to instead — showing a
 * 09.09.-dated match under "Spieltag 1" when the rest of that Spieltag was
 * played weeks earlier serves nobody. Use `isRescheduledMatch` to show a
 * "eigentlich Spieltag X" hint on such a match's card.
 *
 * Use this for everything: which tab a match/bet appears under, the
 * per-matchday bet limit, awards/recap grouping, leaderboard P&L, inactivity
 * timing — there is only one Spieltag grouping now.
 */
export function effectiveMatchdayOf(m: Match, index: EffectiveMatchdayIndex): number | null {
  if (m.matchday === 999) return 999
  if (isKreisligaMatch(m)) {
    const anchor = index.matchdayAnchorDate.get(m.matchday)
    const t = new Date(m.match_date).getTime()
    if (anchor != null && Math.abs(t - anchor) > EFFECTIVE_OUTLIER_DAYS * 86400000) {
      const nearest = nearestMatchdayByDate(t, index)
      if (nearest != null) return nearest
    }
    return m.matchday
  }
  const isWildenrothII = m.match_category === 'wildenroth_ii'
  const isTopspiel = m.match_category === 'bklasse_topspiel' || (m.match_category === 'b-klasse' && m.is_topspiel)
  if (!isWildenrothII && !isTopspiel) return null
  const t = new Date(m.match_date).getTime()
  return nearestMatchdayByDate(t, index)
}

/** True if this is a Kreisliga match being displayed/bet under a Spieltag
 *  other than its own official BFV number (see `effectiveMatchdayOf`) —
 *  drives the "eigentlich Spieltag X" hint on its match card. */
export function isRescheduledMatch(m: Match, index: EffectiveMatchdayIndex): boolean {
  return isKreisligaMatch(m) && m.matchday !== 999 && effectiveMatchdayOf(m, index) !== m.matchday
}

/**
 * Answers "which Spieltag's story does this match's bets belong to?" — used
 * for awards, the recap push/page, per-Spieltag leaderboard P&L
 * (Wochentippkönig/streaks), and inactivity-penalty TIMING. Kept as a
 * separate export for call-site clarity, but it's now the same grouping as
 * `effectiveMatchdayOf` — display, betting, and recap all agree on one
 * Spieltag per match.
 */
export function recapMatchdayOf(m: Match, index: EffectiveMatchdayIndex): number | null {
  return effectiveMatchdayOf(m, index)
}
