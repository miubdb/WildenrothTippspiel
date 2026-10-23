import { effectiveMatchdayOf, type EffectiveMatchdayIndex } from '@/lib/season'
import type { Match } from '@/types'

/**
 * Admin-Statistik "Beteiligung & Wettzeiten" (components/admin/StatsTab.tsx).
 * Reine Aggregationsfunktionen, getrennt von der Datenbeschaffung (app/api/admin/stats/route.ts),
 * damit sie direkt getestet werden können (scripts/betting-activity-stats-check.ts) — selbes
 * Muster wie lib/surveyAggregate.ts für die Umfrage-Auswertung.
 */

export interface ActivityLeg {
  id: number
  user_id: string
  combo_id: number | null
  created_at: string
  match: Pick<Match, 'matchday' | 'match_date' | 'status' | 'match_category' | 'is_topspiel' | 'tippspiel_matchday'> | null
}

export interface MatchdayParticipation {
  matchday: number
  users: number
  legs: number
  isCurrent: boolean
}

/**
 * Eindeutige Nutzer je effektivem Tippspiel-Spieltag (buildEffectiveMatchdayIndex /
 * effectiveMatchdayOf, lib/season.ts — NICHT die rohe BFV-Nummer, siehe CLAUDE.md
 * "Matchday scheduling quirk"). Jede Wett-Zeile (Single-Leg oder Kombi-Leg) zählt für ihren
 * eigenen effektiven Spieltag, auch wenn eine Kombi über mehrere Spieltage verteilt ist — eine
 * solche Kombi zählt dann (gewollt) auf jedem betroffenen Spieltag, statt künstlich einem
 * einzigen zugeordnet zu werden. Testspieltag (999) wird nie mitgezählt. Nur Spieltage mit
 * mindestens einer Zeile erscheinen im Ergebnis, in der normalen Anzeige-Reihenfolge
 * (`kreisligaMatchdaysDisplayOrder`).
 */
export function computeMatchdayParticipation(
  legs: ActivityLeg[],
  mdIndex: EffectiveMatchdayIndex,
  currentMatchday: number | null,
): MatchdayParticipation[] {
  const usersByMd = new Map<number, Set<string>>()
  const legsByMd = new Map<number, number>()
  for (const l of legs) {
    if (!l.match) continue
    const md = effectiveMatchdayOf(l.match as Match, mdIndex)
    if (md == null || md === 999) continue
    if (!usersByMd.has(md)) usersByMd.set(md, new Set())
    usersByMd.get(md)!.add(l.user_id)
    legsByMd.set(md, (legsByMd.get(md) ?? 0) + 1)
  }
  return mdIndex.kreisligaMatchdaysDisplayOrder
    .filter((md) => usersByMd.has(md))
    .map((md) => ({
      matchday: md,
      users: usersByMd.get(md)!.size,
      legs: legsByMd.get(md) ?? 0,
      isCurrent: md === currentMatchday,
    }))
}

/** Ø Nutzer über die letzten `lastN` Spieltage VOR dem aktuellen (laufenden), damit ein noch
 *  nicht fertig gespielter Spieltag den Schnitt nicht künstlich nach unten zieht. */
export function averageRecentParticipation(participation: MatchdayParticipation[], lastN: number): number | null {
  const completed = participation.filter((p) => !p.isCurrent)
  const recent = completed.slice(-lastN)
  if (recent.length === 0) return null
  return Math.round((recent.reduce((s, p) => s + p.users, 0) / recent.length) * 10) / 10
}

/**
 * Ein "Platzierungs-Ereignis" je Schein, nicht je Zeile: eine Kombi mit 6 Legs zählt für die
 * Zeitstatistik einmal (frühester `created_at` ihrer Legs — in der Praxis identisch, da alle
 * Legs einer Kombi atomar zusammen angelegt werden), ein Einzeltipp zählt für sich. Sonst würde
 * eine große Kombi die Uhrzeit-/Wochentag-Verteilung künstlich verzerren.
 */
export function placementEvents(legs: Pick<ActivityLeg, 'id' | 'combo_id' | 'created_at'>[]): { created_at: string }[] {
  const earliestByKey = new Map<string, string>()
  for (const l of legs) {
    const key = l.combo_id != null ? `c${l.combo_id}` : `s${l.id}`
    const existing = earliestByKey.get(key)
    if (!existing || l.created_at < existing) earliestByKey.set(key, l.created_at)
  }
  return [...earliestByKey.values()].map((created_at) => ({ created_at }))
}

export interface HourBucket { hour: number; count: number }
export interface WeekdayBucket { weekday: number; count: number } // 0=Mo..6=So

const BERLIN_HOUR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false })
const BERLIN_WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', weekday: 'short' })
const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

/** Stunde in Europe/Berlin (0-23), nicht UTC — sonst verschiebt sich das Bild je nach Sommer-/Winterzeit. */
export function computeHourBuckets(events: { created_at: string }[]): HourBucket[] {
  const counts = new Array(24).fill(0) as number[]
  for (const e of events) {
    const hour = parseInt(BERLIN_HOUR.format(new Date(e.created_at)), 10) % 24
    counts[hour]++
  }
  return counts.map((count, hour) => ({ hour, count }))
}

/** Wochentag in Europe/Berlin, Montag=0..Sonntag=6. */
export function computeWeekdayBuckets(events: { created_at: string }[]): WeekdayBucket[] {
  const counts = new Array(7).fill(0) as number[]
  for (const e of events) {
    const label = BERLIN_WEEKDAY.format(new Date(e.created_at))
    counts[WEEKDAY_INDEX[label]]++
  }
  return counts.map((count, weekday) => ({ weekday, count }))
}

export function topBucket<T extends { count: number }>(buckets: T[]): T | null {
  if (buckets.length === 0) return null
  return buckets.reduce((best, b) => (b.count > best.count ? b : best))
}

/**
 * Admin-Statistik, 2. Ausbaustufe: 24 Einzelstunden sind schwer auf einen Blick zu lesen — die
 * Tageszeit-Gruppierung beantwortet "wann wird getippt" in einem Satz statt in 24 Balken. Die
 * Grenzen sind an den Tagesablauf rund um Kreisliga-Anstoßzeiten angelehnt (Vormittag/Mittag als
 * eigene, schmale Fenster, weil genau dort laut Produktionsdaten der Peak liegt — Montag-12-Uhr-
 * Wettfreigabe), decken alle 24 Stunden genau einmal ab.
 */
export interface DaypartDef { key: string; label: string; startHour: number; endHour: number }
export interface DaypartBucket extends DaypartDef { count: number; share: number | null }

export const DAYPART_DEFS: DaypartDef[] = [
  { key: 'nacht', label: 'Nachts (0–5 Uhr)', startHour: 0, endHour: 5 },
  { key: 'morgen', label: 'Morgens (6–9 Uhr)', startHour: 6, endHour: 9 },
  { key: 'vormittag', label: 'Vormittags (10–11 Uhr)', startHour: 10, endHour: 11 },
  { key: 'mittag', label: 'Mittags (12–13 Uhr)', startHour: 12, endHour: 13 },
  { key: 'nachmittag', label: 'Nachmittags (14–17 Uhr)', startHour: 14, endHour: 17 },
  { key: 'abend', label: 'Abends (18–21 Uhr)', startHour: 18, endHour: 21 },
  { key: 'spaetabend', label: 'Spätabends (22–23 Uhr)', startHour: 22, endHour: 23 },
]

export function computeDaypartBuckets(hours: HourBucket[]): DaypartBucket[] {
  const total = hours.reduce((s, h) => s + h.count, 0)
  return DAYPART_DEFS.map((d) => {
    const count = hours.filter((h) => h.hour >= d.startHour && h.hour <= d.endHour).reduce((s, h) => s + h.count, 0)
    return { ...d, count, share: total > 0 ? Math.round((count / total) * 1000) / 10 : null }
  })
}

/** Wochenende = Sa+So (Index 5/6 in computeWeekdayBuckets, Mo=0). Beantwortet "wetten die Leute
 *  eher unter der Woche oder am Wochenende" als eine Zahl statt sieben einzelner Balken. */
export interface WeekdaySplit { weekdayCount: number; weekendCount: number; weekdayShare: number | null; weekendShare: number | null }

export function computeWeekdaySplit(weekdays: WeekdayBucket[]): WeekdaySplit {
  const total = weekdays.reduce((s, w) => s + w.count, 0)
  const weekendCount = weekdays.filter((w) => w.weekday === 5 || w.weekday === 6).reduce((s, w) => s + w.count, 0)
  const weekdayCount = total - weekendCount
  return {
    weekdayCount,
    weekendCount,
    weekdayShare: total > 0 ? Math.round((weekdayCount / total) * 1000) / 10 : null,
    weekendShare: total > 0 ? Math.round((weekendCount / total) * 1000) / 10 : null,
  }
}

/** Anteil `users` an `totalEligibleUsers` (berechtigte, nicht gelöschte Nutzer — dieselbe
 *  Definition wie das "berechtigt"-Pill im Spieler-Tab) in Prozent, eine Nachkommastelle. */
export function participationRate(users: number, totalEligibleUsers: number): number | null {
  if (totalEligibleUsers <= 0) return null
  return Math.round((users / totalEligibleUsers) * 1000) / 10
}
