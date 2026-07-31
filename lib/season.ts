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
  return { kreisligaMatchdaysSorted, matchdayMinDate, matchdayAnchorDate }
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

/**
 * Assigns a Wildenroth-II / Topspiel-flagged B-Klasse match to the Kreisliga
 * Spieltag whose median kickoff date it's closest to. Plain B-Klasse matches
 * (not the admin-selected weekly Topspiel) return null — they're never
 * bettable and never shown on the Tippspiel page.
 *
 * For a KREISLIGA match this always returns its own official BFV matchday
 * number, with no exception — that label is what tipps/page.tsx displays and
 * what the user placed their bet under, and (per the BFV's own "Verlegte
 * Spiele außerhalb des Spieltages" listing) it must never change just because
 * the match itself got rescheduled. Use this for anything DISPLAY/BETTING
 * related: which tab a match/bet appears under, the per-matchday bet limit,
 * etc. For anything about WHEN a Spieltag's story is considered told
 * (awards, recap, inactivity timing), use `recapMatchdayOf` instead — see its
 * doc comment for why these two must not be the same function.
 */
export function effectiveMatchdayOf(m: Match, index: EffectiveMatchdayIndex): number | null {
  if (m.matchday === 999) return 999
  if (isKreisligaMatch(m)) return m.matchday
  const isWildenrothII = m.match_category === 'wildenroth_ii'
  const isTopspiel = m.match_category === 'bklasse_topspiel' || (m.match_category === 'b-klasse' && m.is_topspiel)
  if (!isWildenrothII && !isTopspiel) return null
  const t = new Date(m.match_date).getTime()
  return nearestMatchdayByDate(t, index)
}

/** A Kreisliga match whose kickoff has drifted more than this many days from
 *  its own Spieltag's median date is treated, for recap/awards purposes only,
 *  as an outlier — its bets get folded into whichever Spieltag is actually
 *  being played around its real date instead of making that Spieltag's whole
 *  recap wait for it. Small BFV variance (a Monday game 1-2 days out) stays
 *  put; a genuine reschedule to a different part of the season does not. */
const RECAP_OUTLIER_DAYS = 10

/**
 * Answers "which Spieltag's story does this match's bets belong to?" — used
 * ONLY for awards, the recap push/page, per-Spieltag leaderboard P&L
 * (Wochentippkönig/streaks), and inactivity-penalty TIMING (not the fairness
 * check itself, see below).
 *
 * Why this must differ from `effectiveMatchdayOf`: that function anchors a
 * Kreisliga match to its own official number unconditionally, by design (the
 * label must never change). But that means a match postponed 60+ days out
 * would make its ENTIRE original Spieltag's awards/recap wait 60+ days too —
 * for a match whose own bettors already got settled and notified immediately
 * per-match regardless (see app/api/admin/settle/route.ts's per-user push,
 * sent the moment THAT match is scored). Nobody's money or "did I win" push
 * is delayed by any of this; only the supplementary trophy/recap layer was.
 * Once a Kreisliga match drifts beyond RECAP_OUTLIER_DAYS from its own
 * Spieltag's median, this reassigns it to the nearest Spieltag by date
 * instead — so the ORIGINAL Spieltag's recap can close promptly from its
 * on-time matches, and the outlier's contribution lands wherever it actually
 * played out, where it's far less likely to be badly late itself.
 *
 * Do NOT use this for what tab a match/bet displays under, or for the
 * per-matchday bet limit — those must stay on `effectiveMatchdayOf`.
 */
export function recapMatchdayOf(m: Match, index: EffectiveMatchdayIndex): number | null {
  if (m.matchday === 999) return 999
  if (isKreisligaMatch(m)) {
    const anchor = index.matchdayAnchorDate.get(m.matchday)
    const t = new Date(m.match_date).getTime()
    if (anchor != null && Math.abs(t - anchor) <= RECAP_OUTLIER_DAYS * 86400000) {
      return m.matchday
    }
    return nearestMatchdayByDate(t, index)
  }
  return effectiveMatchdayOf(m, index)
}
