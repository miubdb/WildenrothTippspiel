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

/**
 * Parses the hand-set, final betting-open overrides from app_settings rows
 * (key `betting_open_md_<N>`) into a Spieltag → instant map. These were set
 * once ahead of go-live for every real Tippspiel-Spieltag and are the actual
 * source of truth for "when does this Spieltag's betting window open" —
 * they win over bettingOpenTime()'s dynamic Monday-noon formula (which
 * remains only as a fallback for a Spieltag with no explicit entry, e.g. the
 * test matchday). Single source of truth for this lookup — every place that
 * gates on "has betting opened for Spieltag N" (the /tipps page itself, the
 * "Spieltag offen" push, admin odds preview) must resolve through this, or
 * they can silently disagree about the exact same instant.
 */
export function parseBettingOpenOverrides(appSettings: Iterable<readonly [string, string]>): Map<number, Date> {
  const overrides = new Map<number, Date>()
  for (const [key, value] of appSettings) {
    const m = /^betting_open_md_(\d+)$/.exec(key)
    if (m) overrides.set(Number(m[1]), new Date(value))
  }
  return overrides
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

/** Flat starting balance for anyone who registers before the last match of
 *  Spieltag 1 has kicked off — see `startingBalanceForRegistration` below. */
export const STARTING_BALANCE = 1000

const isKreisligaMatch = (m: Pick<Match, 'match_category'>) =>
  !m.match_category || m.match_category === 'kreisliga'

export interface EffectiveMatchdayIndex {
  /** Spieltag numbers ordered by each Spieltag's own RAW earliest kickoff
   *  (`matchdayMinDate`) — not outlier-robust, and NOT for display. This
   *  feeds only the betting-window sequencing gate ("never two Spieltage
   *  open at once" in tipps/page.tsx), which must keep comparing Spieltage
   *  by their own original schedule so opening times stay exactly as they
   *  are today. A single Kreisliga match rescheduled weeks away distorts
   *  this list's position for its whole Spieltag (see
   *  `kreisligaMatchdaysDisplayOrder` for the fix used everywhere else). */
  kreisligaMatchdaysSorted: number[]
  /** Spieltag numbers ordered chronologically by the outlier-robust MEDIAN
   *  kickoff (`matchdayAnchorDate`), tie-broken by the official Spieltag
   *  number. This is what every user-facing Spieltag overview/picker must
   *  render (tipps, leaderboard): Spieltage appear in the order they are
   *  actually played, not by their official number — but unlike a
   *  min()-based order, a single match rescheduled far outside its own
   *  Spieltag's week doesn't drag that whole Spieltag's position around,
   *  since the median stays put as long as most of its matches didn't move. */
  kreisligaMatchdaysDisplayOrder: number[]
  matchdayMinDate: Map<number, number>
  /** Median kickoff timestamp per Kreisliga Spieltag — used (not min/max) to
   *  place a Wildenroth-II/Topspiel match, specifically because it stays
   *  stable when a single Kreisliga match of that Spieltag gets postponed and
   *  later rescheduled far out (a min/max window would balloon to cover that
   *  outlier date and could then wrongly "claim" a later Spieltag's matches).
   *  Also drives `kreisligaMatchdaysDisplayOrder` above for the same reason. */
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
  const kreisligaMatchdaysDisplayOrder = [...matchdayAnchorDate.keys()].sort((a, b) => {
    const diff = matchdayAnchorDate.get(a)! - matchdayAnchorDate.get(b)!
    return diff !== 0 ? diff : a - b
  })
  return { kreisligaMatchdaysSorted, kreisligaMatchdaysDisplayOrder, matchdayMinDate, matchdayAnchorDate }
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
 *
 * `m.tippspiel_matchday`, when set, is an explicit, hand-pinned override that
 * wins over the dynamic computation below — used for the small set of BFV
 * Nachholspiele and the full B-Klasse date-block assignment the club fixed
 * ahead of go-live (see the go-live migration). It is checked from INSIDE
 * each branch (after the Kreisliga/Wildenroth-II/Topspiel category gate), not
 * at the top of the function, so a non-Topspiel B-Klasse match with a
 * pre-assigned override still correctly returns null today — it only takes
 * effect once an admin actually flags that match as this week's Topspiel.
 */
export function effectiveMatchdayOf(m: Match, index: EffectiveMatchdayIndex): number | null {
  if (m.matchday === 999) return 999
  if (isKreisligaMatch(m)) {
    if (m.tippspiel_matchday != null) return m.tippspiel_matchday
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
  if (m.tippspiel_matchday != null) return m.tippspiel_matchday
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

/** Last kickoff among every match (Kreisliga + Wildenroth-II/Topspiel) that
 *  effectively belongs to `matchday` — i.e. the moment that whole Spieltag is
 *  definitively underway, not just its first game. Unlike matchdayMinDate/
 *  matchdayAnchorDate (Kreisliga-only, used for ordering/anchoring), this
 *  must account for every match actually shown/bettable under that Spieltag.
 *  Returns null if no match is currently assigned to that Spieltag. */
export function lastKickoffOfEffectiveMatchday(
  matchday: number,
  seasonMatches: Match[],
  index: EffectiveMatchdayIndex,
): number | null {
  let max: number | null = null
  for (const m of seasonMatches) {
    if (effectiveMatchdayOf(m, index) !== matchday) continue
    const t = new Date(m.match_date).getTime()
    if (max === null || t > max) max = t
  }
  return max
}

/**
 * Graduated starting balance for a new registration, based on how many
 * Tippspiel-Spieltage had ALREADY fully kicked off (their own last match) at
 * registration time — a product decision to reward early sign-ups without
 * blocking late ones outright:
 *   - before Spieltag 1's last kickoff: 1000 (STARTING_BALANCE)
 *   - after Spieltag 1's last kickoff:   950
 *   - after Spieltag 2's last kickoff:   900
 *   - after each further Spieltag's last kickoff: -20 more (880, 860, ...)
 * Never goes below 0. Counts every Spieltag whose last kickoff has already
 * passed, not just consecutive ones from the start, so a lone rescheduled
 * Spieltag can't stall the count for everyone registering after it.
 */
export function startingBalanceForRegistration(
  registeredAt: Date,
  seasonMatches: Match[],
  index: EffectiveMatchdayIndex,
): number {
  const t = registeredAt.getTime()
  let kickedOffCount = 0
  for (const md of index.kreisligaMatchdaysDisplayOrder) {
    const last = lastKickoffOfEffectiveMatchday(md, seasonMatches, index)
    if (last != null && last <= t) kickedOffCount++
  }
  if (kickedOffCount === 0) return STARTING_BALANCE
  if (kickedOffCount === 1) return 950
  if (kickedOffCount === 2) return 900
  return Math.max(0, 900 - (kickedOffCount - 2) * 20)
}
