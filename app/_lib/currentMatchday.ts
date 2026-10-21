import { effectiveMatchdayOf, bettingOpenTime, type EffectiveMatchdayIndex } from '@/lib/season'
import type { Match } from '@/types'

const isKreisligaMatch = (m: Pick<Match, 'match_category'>) => !m.match_category || m.match_category === 'kreisliga'

/**
 * The Spieltag the app defaults to showing right now. Extracted verbatim out of
 * app/(app)/tipps/page.tsx's own inline computation (only parameterised by `now`
 * for testability) so "Meine Wetten" (app/(app)/meine-wetten/page.tsx) can resolve
 * the SAME current Spieltag the Tipps-Seite would show, instead of a cheaper
 * stand-in — a `MeineWettenClient` that picked "the latest matchday with at least
 * one still-open bet" made the current Spieltag disappear the moment every bet on
 * it was settled, which is exactly the kind of drift this extraction prevents:
 * one implementation, both pages behave identically by construction, not by
 * convention.
 *
 * Before the next Spieltag's betting window opens → the in-progress Spieltag, or
 * failing that the last completed one. After it opens → the upcoming one. See the
 * original inline comments in tipps/page.tsx (git history) for the full reasoning
 * behind each step — reproduced here unchanged, not reinterpreted.
 */
export function defaultCurrentMatchday(
  seasonMatches: Match[],
  mdIndex: EffectiveMatchdayIndex,
  explicitBettingOpens: ReadonlyMap<number, Date>,
  opts: { isPreSeason: boolean; hasTestMatchday: boolean },
  now: Date = new Date(),
): number {
  const { isPreSeason, hasTestMatchday } = opts
  const effOf = (m: Match) => effectiveMatchdayOf(m, mdIndex)
  const kreisligaMatches = seasonMatches.filter((m) => m.matchday !== 999 && isKreisligaMatch(m))

  const allMatchdays = isPreSeason
    ? [...(hasTestMatchday ? [999] : []), ...Array.from({ length: 28 }, (_, i) => i + 1)]
    : [...(hasTestMatchday ? [999] : []), ...mdIndex.kreisligaMatchdaysSorted]

  const firstScheduled = [...new Set(
    kreisligaMatches
      .filter((m) => m.status === 'scheduled')
      .map((m) => effOf(m))
      .filter((md): md is number => md != null)
  )].sort((a, b) => (mdIndex.matchdayAnchorDate.get(a) ?? 0) - (mdIndex.matchdayAnchorDate.get(b) ?? 0))[0]

  const nextMatchdayOpensAt = firstScheduled != null
    ? (explicitBettingOpens.get(firstScheduled) ?? bettingOpenTime(new Date(mdIndex.matchdayMinDate.get(firstScheduled) ?? now.getTime())))
    : null
  const isBeforeMondayNoon = nextMatchdayOpensAt ? now < nextMatchdayOpensAt : true

  const completedMatchdays = allMatchdays.filter((md) => {
    const mdM = seasonMatches.filter((m) => effOf(m) === md)
    const nonPostponed = mdM.filter((m) => m.status !== 'postponed' && m.status !== 'annulled')
    return nonPostponed.length > 0 && nonPostponed.every((m) => m.status === 'finished')
  })
  const lastCompletedMd = completedMatchdays.length > 0
    ? completedMatchdays.reduce((latest, md) =>
        (mdIndex.matchdayAnchorDate.get(md) ?? 0) > (mdIndex.matchdayAnchorDate.get(latest) ?? 0) ? md : latest
      )
    : null

  const nowMs = now.getTime()
  const inProgressMd = [...new Set(
    seasonMatches
      .map((m) => effOf(m))
      .filter((md): md is number => md != null && md !== 999)
  )]
    .filter((md) => {
      const nonPostponed = seasonMatches.filter((m) => effOf(m) === md && m.status !== 'postponed' && m.status !== 'annulled')
      if (nonPostponed.length === 0) return false
      const hasStarted = nonPostponed.some((m) => m.status === 'finished' || new Date(m.match_date).getTime() <= nowMs)
      const allDone = nonPostponed.every((m) => m.status === 'finished')
      return hasStarted && !allDone
    })
    .sort((a, b) => (mdIndex.matchdayAnchorDate.get(a) ?? 0) - (mdIndex.matchdayAnchorDate.get(b) ?? 0))
    .at(-1) ?? null

  const latestMatchdayByAnchor = () => allMatchdays.filter((md) => md !== 999).reduce((latest, md) =>
    (mdIndex.matchdayAnchorDate.get(md) ?? 0) > (mdIndex.matchdayAnchorDate.get(latest) ?? 0) ? md : latest
  )

  return isPreSeason
    ? (hasTestMatchday ? 999 : 1)
    : isBeforeMondayNoon
      ? (inProgressMd ?? lastCompletedMd ?? firstScheduled ?? latestMatchdayByAnchor())
      : (firstScheduled ?? latestMatchdayByAnchor())
}
