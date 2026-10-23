import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paginatedSelect'
import { SEASON_START, buildEffectiveMatchdayIndex, parseBettingOpenOverrides } from '@/lib/season'
import { defaultCurrentMatchday } from '@/app/_lib/currentMatchday'
import { STATS_CURRENT_SEASON } from '@/lib/betStats'
import {
  computeMatchdayParticipation, averageRecentParticipation, placementEvents,
  computeHourBuckets, computeWeekdayBuckets, topBucket, computeDaypartBuckets,
  computeWeekdaySplit, participationRate, type ActivityLeg,
} from '@/lib/bettingActivityStats'
import type { Match } from '@/types'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 }) } as const
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 }) } as const
  return { error: null } as const
}

/**
 * Admin-Statistik "Beteiligung & Wettzeiten" (components/admin/StatsTab.tsx): Beteiligung je
 * Spieltag im Vergleich zu den letzten abgeschlossenen Spieltagen, plus Uhrzeit-/Wochentag-
 * Verteilung der Wettplatzierungen. Reine Lesestatistik, nie Wett-/Guthaben-/Statusdaten.
 *
 * Läuft über den Service-Role-Client (RLS auf `bets` lässt einen Nutzer nur seine eigenen Zeilen
 * sehen — für eine Statistik über ALLE Nutzer muss das hier sein, wie beim Umfrage-Tab) und
 * paginiert über `fetchAllRows` (CLAUDE.md "Der 1000-Zeilen-Deckel" — `bets` liegt mit über 1000
 * Zeilen längst über dem PostgREST-Limit). Spieltag-Zuordnung läuft ausschließlich über
 * `buildEffectiveMatchdayIndex`/`effectiveMatchdayOf`, nicht über die rohe BFV-`matchday`-Spalte.
 */
export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const admin = createAdminClient()

  let legs: ActivityLeg[]
  let seasonMatches: Match[]
  let settingsRows: { key: string; value: string }[]
  let totalEligibleUsers: number
  try {
    const [legsRaw, matchesRaw, settingsRes, eligibleRes] = await Promise.all([
      fetchAllRows<{
        id: number; user_id: string; combo_id: number | null; created_at: string; season: string | null
        match: ActivityLeg['match'] | ActivityLeg['match'][] | null
      }>((from, to) => admin
        .from('bets')
        .select('id, user_id, combo_id, created_at, season, match:matches(matchday, match_date, status, match_category, is_topspiel, tippspiel_matchday)')
        .order('id')
        .range(from, to)),
      fetchAllRows((from, to) => admin
        .from('matches')
        .select('id, matchday, match_date, status, match_category, is_topspiel, tippspiel_matchday, competition_type')
        .or(`match_date.gte.${SEASON_START},matchday.eq.999`)
        .order('id')
        .range(from, to)),
      admin.from('app_settings').select('key, value'),
      // "Berechtigt" — dieselbe Definition wie das Pill im Spieler-Tab (app/admin/page.tsx):
      // eligible_for_current_season=true und nicht gelöscht. Nenner für die Beteiligungsquote.
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('eligible_for_current_season', true).is('deleted_at', null),
    ])
    legs = legsRaw
      .filter((b) => !b.season || b.season === STATS_CURRENT_SEASON || b.season === 'TEST')
      .map((b) => ({ ...b, match: Array.isArray(b.match) ? b.match[0] ?? null : b.match }))
    seasonMatches = matchesRaw as unknown as Match[]
    settingsRows = (settingsRes.data ?? []) as { key: string; value: string }[]
    totalEligibleUsers = eligibleRes.count ?? 0
  } catch (err) {
    console.error('Admin-Statistik: Laden fehlgeschlagen:', err)
    return NextResponse.json({ error: 'Daten konnten nicht geladen werden.' }, { status: 500 })
  }

  const mdIndex = buildEffectiveMatchdayIndex(seasonMatches)
  const explicitBettingOpens = parseBettingOpenOverrides(new Map(settingsRows.map((s) => [s.key, s.value] as const)))
  const hasTestMatchday = seasonMatches.some((m) => m.matchday === 999)
  const isPreSeason = seasonMatches.filter((m) => m.matchday !== 999).length === 0
  const currentMatchday = isPreSeason
    ? null
    : defaultCurrentMatchday(seasonMatches, mdIndex, explicitBettingOpens, { isPreSeason, hasTestMatchday })

  const participation = computeMatchdayParticipation(legs, mdIndex, currentMatchday)
    .map((p) => ({ ...p, participationRate: participationRate(p.users, totalEligibleUsers) }))
  const avgRecent = averageRecentParticipation(participation, 6)
  const events = placementEvents(legs)
  const hours = computeHourBuckets(events)
  const weekdays = computeWeekdayBuckets(events)

  return NextResponse.json({
    currentMatchday,
    participation,
    avgRecentParticipation: avgRecent,
    totalPlacementEvents: events.length,
    totalEligibleUsers,
    hours,
    weekdays,
    dayparts: computeDaypartBuckets(hours),
    weekdaySplit: computeWeekdaySplit(weekdays),
    topHour: topBucket(hours),
    topWeekday: topBucket(weekdays),
  })
}
