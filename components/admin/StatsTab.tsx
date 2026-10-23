'use client'

import { useCallback, useEffect, useState } from 'react'
import { EmptyNote, LoadingBlock, Section } from '@/components/admin/ui'

interface MatchdayParticipation { matchday: number; users: number; legs: number; isCurrent: boolean; participationRate: number | null }
interface Bucket { count: number }
interface HourBucket extends Bucket { hour: number }
interface WeekdayBucket extends Bucket { weekday: number }
interface DaypartBucket extends Bucket { key: string; label: string; startHour: number; endHour: number; share: number | null }
interface WeekdaySplit { weekdayCount: number; weekendCount: number; weekdayShare: number | null; weekendShare: number | null }

interface StatsData {
  currentMatchday: number | null
  participation: MatchdayParticipation[]
  avgRecentParticipation: number | null
  totalPlacementEvents: number
  totalEligibleUsers: number
  hours: HourBucket[]
  weekdays: WeekdayBucket[]
  dayparts: DaypartBucket[]
  weekdaySplit: WeekdaySplit
  topHour: HourBucket | null
  topWeekday: WeekdayBucket | null
}

const WEEKDAY_LABEL = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const WEEKDAY_LABEL_FULL = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']

function fmtPct(n: number | null | undefined) {
  return n == null ? '—' : `${n.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`
}
function fmt1(n: number | null | undefined) {
  return n == null ? '—' : n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl px-3 py-3 text-center border bg-gray-50 border-gray-200">
      <div className="text-xl font-black text-gray-800">{value}</div>
      <div className="text-[10px] text-gray-500 font-semibold mt-0.5 leading-tight">{label}</div>
      {note && <div className="text-[10px] text-gray-400 mt-1 leading-tight">{note}</div>}
    </div>
  )
}

// Höhe des Balkenbereichs in px (nicht nur die Tailwind-Klasse `h-20`, siehe unten).
const BAR_AREA_HEIGHT_PX = 84

/** Vertikales Balkendiagramm, vom Muster her wie `ScaleBlock` in SurveyTab.tsx, aber bewusst MIT
 *  Pixel- statt Prozent-Höhen für die Balken: eine Balken-`div` mit `height: X%` braucht eine
 *  Elternbox mit einer DEFINIERTEN Höhe, damit der Prozentwert überhaupt etwas auflöst (CSS-Spec).
 *  Die direkte Elternbox hier ist eine Flex-Spalte (`flex flex-col`) in einer Flex-Zeile mit
 *  `items-end` — `items-end` schaltet das Standard-`stretch` ab, wodurch diese Spalte NIE eine
 *  definierte Höhe bekommt, sondern sich an ihrem Inhalt orientiert. Ergebnis: JEDE Prozent-Höhe
 *  darin löst zu "auto" (= 0) auf, und nur noch `minHeight` greift — alle Balken wurden dadurch
 *  gleich hoch dargestellt, unabhängig vom tatsächlichen Wert (siehe Screenshot vom 23.10.2026,
 *  wo weder "Beteiligung je Spieltag" noch "nach Uhrzeit/Wochentag" irgendeine Höhenvariation
 *  zeigten). Fix: Balkenbereich bekommt eine feste Höhe in px (`BAR_AREA_HEIGHT_PX`, nicht nur
 *  `h-20`), jeder Balken rechnet seine Höhe direkt in px dagegen — kein Prozentwert, der gegen
 *  eine unbestimmte Elternhöhe aufgelöst werden müsste. `showValue` zeigt die Zahl IMMER über dem
 *  Balken (nicht nur beim Hover) — auf Wunsch, nachdem reine Balkenhöhen ohne Beschriftung als zu
 *  schwer lesbar empfunden wurden. */
function VerticalBars<T>({
  data, valueFor, labelFor, tooltipFor, highlight, tickEvery = 1, showValue = false,
}: {
  data: T[]
  valueFor: (d: T) => number
  labelFor: (d: T) => string
  tooltipFor: (d: T) => string
  highlight?: (d: T) => boolean
  tickEvery?: number
  showValue?: boolean
}) {
  const maxValue = Math.max(1, ...data.map(valueFor))
  return (
    <div className="flex items-end gap-1" style={{ height: BAR_AREA_HEIGHT_PX + (showValue ? 16 : 0) }}>
      {data.map((d, i) => {
        const v = valueFor(d)
        const barPx = v > 0 ? Math.max(2, (v / maxValue) * BAR_AREA_HEIGHT_PX) : 0
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5" title={tooltipFor(d)}>
            {showValue && <span className="text-[10px] font-bold text-gray-700">{v}</span>}
            <div
              className={`w-full rounded-t ${highlight?.(d) ? 'bg-red-300' : 'bg-red-500'}`}
              style={{ height: barPx }}
            />
            <span className="text-[9px] text-gray-400">{i % tickEvery === 0 ? labelFor(d) : ''}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Horizontale Balkenliste — Label links, dünner Balken, Wert+Prozent rechts. Exakt das Muster
 *  aus SurveyTab.tsx (`Bar`/`SingleBlock`): dort ist die Balkenbreite prozentual, was — anders
 *  als eine Höhe — ganz normal gegen die Breite des `flex-1`-Elternelements auflöst (keine der
 *  Eigenheiten von `VerticalBars` oben). Für "wann wird getippt" deutlich leichter zu lesen als
 *  24 einzelne Spalten: jede Zeile nennt den Zeitraum und den Anteil direkt als Text. */
function HorizontalBars<T>({
  data, labelFor, valueFor, shareFor, highlight,
}: {
  data: T[]
  labelFor: (d: T) => string
  valueFor: (d: T) => number
  shareFor: (d: T) => number | null
  highlight?: (d: T) => boolean
}) {
  const maxValue = Math.max(1, ...data.map(valueFor))
  return (
    <div className="space-y-1.5">
      {data.map((d, i) => {
        const v = valueFor(d)
        const pct = Math.min(100, (v / maxValue) * 100)
        return (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-32 sm:w-40 flex-shrink-0 text-gray-600 truncate" title={labelFor(d)}>{labelFor(d)}</span>
            <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden flex-1">
              <div className={`h-full rounded-full ${highlight?.(d) ? 'bg-red-300' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="w-24 flex-shrink-0 text-right text-gray-500">{v} ({fmtPct(shareFor(d))})</span>
          </div>
        )
      })}
    </div>
  )
}

/** Automatisch erzeugter Kurzsatz aus den Top-Werten — beantwortet "wann wird getippt" in einem
 *  Satz, bevor man überhaupt einen Balken anschauen muss. */
function buildInsight(data: StatsData): string | null {
  const topDaypart = data.dayparts.reduce((best, d) => (d.count > best.count ? d : best), data.dayparts[0])
  if (!topDaypart || topDaypart.count === 0) return null
  const parts: string[] = [`Die meisten Tipps kommen ${topDaypart.label.toLowerCase()} (${fmtPct(topDaypart.share)} aller Platzierungen)`]
  if (data.topWeekday && data.topWeekday.count > 0) {
    parts.push(`vor allem ${WEEKDAY_LABEL_FULL[data.topWeekday.weekday]}s`)
  }
  if (data.weekdaySplit.weekendShare != null) {
    parts.push(`${fmtPct(data.weekdaySplit.weekendShare)} aller Tipps fallen aufs Wochenende (Sa+So)`)
  }
  return parts.join(', ') + '.'
}

/** Admin-Statistik "Beteiligung & Wettzeiten" — rein lesend (app/api/admin/stats/route.ts),
 *  Aggregation in lib/bettingActivityStats.ts, getestet in scripts/betting-activity-stats-check.ts.
 *  Beteiligung je Spieltag über die echte `buildEffectiveMatchdayIndex`-Logik, nicht die rohe
 *  BFV-Nummer — ein per BFV verschobener Spieltag erscheint also an derselben Stelle wie überall
 *  sonst in der App (Tipps-Seite, Rangliste). */
export function StatsTab({ onMessage }: { onMessage: (m: string | null) => void }) {
  const [data, setData] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/stats')
      const json = await res.json()
      if (res.ok) { setData(json); setLoadFailed(false) } else {
        onMessage(`Fehler: ${json.error ?? 'Laden fehlgeschlagen.'}`)
        setLoadFailed(true)
      }
    } catch {
      onMessage('Fehler: Netzwerkfehler.')
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [onMessage])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial async data fetch on mount, same pattern used throughout app/admin/page.tsx
    void load()
  }, [load])

  if (loading) return <LoadingBlock label="Statistik wird geladen …" />
  if (loadFailed || !data) return <EmptyNote>Statistik konnte nicht geladen werden.</EmptyNote>

  const recentParticipation = data.participation.slice(-8)
  const current = data.participation.find((p) => p.isCurrent) ?? null
  const delta = current && data.avgRecentParticipation != null ? Math.round((current.users - data.avgRecentParticipation) * 10) / 10 : null
  const insight = buildInsight(data)

  return (
    <div className="space-y-4">
      {insight && (
        <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-[13px] text-red-900 leading-snug">
          {insight}
        </div>
      )}

      <Section id="st-beteiligung" title="Beteiligung je Spieltag" subtitle="Eindeutige Nutzer mit mindestens einem Tipp" defaultOpen>
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Metric
              label="Aktueller Spieltag"
              value={current ? `Spieltag ${current.matchday}` : '—'}
              note={current ? `${current.users} von ${data.totalEligibleUsers} (${fmtPct(current.participationRate)}) bisher` : 'läuft noch nicht'}
            />
            <Metric
              label="Ø Nutzer, letzte 6 Spieltage"
              value={fmt1(data.avgRecentParticipation)}
              note={delta != null ? `${delta > 0 ? '+' : ''}${fmt1(delta)} ggü. Ø beim aktuellen Spieltag` : 'vollständig abgerechnet'}
            />
            <Metric
              label="Häufigste Uhrzeit"
              value={data.topHour ? `${String(data.topHour.hour).padStart(2, '0')} Uhr` : '—'}
              note={data.topHour ? `${data.topHour.count} von ${data.totalPlacementEvents} Platzierungen` : undefined}
            />
            <Metric
              label="Häufigster Wochentag"
              value={data.topWeekday ? WEEKDAY_LABEL[data.topWeekday.weekday] : '—'}
              note={data.topWeekday ? `${data.topWeekday.count} von ${data.totalPlacementEvents} Platzierungen` : undefined}
            />
          </div>

          {recentParticipation.length === 0 ? (
            <EmptyNote>Noch keine Wetten in der laufenden Saison.</EmptyNote>
          ) : (
            <>
              <VerticalBars
                data={recentParticipation}
                valueFor={(d) => d.users}
                labelFor={(d) => String(d.matchday)}
                tooltipFor={(d) => `Spieltag ${d.matchday}${d.isCurrent ? ' (läuft noch)' : ''}: ${d.users} von ${data.totalEligibleUsers} Nutzern (${fmtPct(d.participationRate)}), ${d.legs} Tipp-Legs`}
                highlight={(d) => d.isCurrent}
                showValue
              />
              <div className="flex items-center gap-3 text-[10px] text-gray-400">
                <span><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />abgeschlossen</span>
                <span><span className="inline-block w-2 h-2 rounded-full bg-red-300 mr-1" />läuft noch (unvollständig)</span>
              </div>
            </>
          )}
        </div>
      </Section>

      <Section id="st-tageszeit" title="Wann wird getippt?" subtitle={`${data.totalPlacementEvents} Platzierungs-Ereignisse · Europe/Berlin`} defaultOpen>
        {data.totalPlacementEvents === 0 ? (
          <EmptyNote>Keine Daten.</EmptyNote>
        ) : (
          <div className="space-y-4">
            <HorizontalBars
              data={data.dayparts}
              labelFor={(d) => d.label}
              valueFor={(d) => d.count}
              shareFor={(d) => d.share}
            />
            <details className="group">
              <summary className="cursor-pointer select-none list-none flex items-center gap-1.5 text-[12px] font-semibold text-gray-600">
                <svg className="w-3.5 h-3.5 text-gray-400 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                Stundengenau anzeigen
              </summary>
              <div className="mt-3">
                <VerticalBars
                  data={data.hours}
                  valueFor={(d) => d.count}
                  labelFor={(d) => String(d.hour).padStart(2, '0')}
                  tickEvery={2}
                  tooltipFor={(d) => `${String(d.hour).padStart(2, '0')}:00 Uhr: ${d.count} Platzierungen`}
                />
              </div>
            </details>
          </div>
        )}
      </Section>

      <Section id="st-wochentag" title="Platzierungen nach Wochentag" subtitle={`${data.totalPlacementEvents} Platzierungs-Ereignisse · Europe/Berlin`}>
        {data.totalPlacementEvents === 0 ? (
          <EmptyNote>Keine Daten.</EmptyNote>
        ) : (
          <div className="space-y-3">
            <HorizontalBars
              data={data.weekdays}
              labelFor={(d) => WEEKDAY_LABEL_FULL[d.weekday]}
              valueFor={(d) => d.count}
              shareFor={(d) => (data.totalPlacementEvents > 0 ? Math.round((d.count / data.totalPlacementEvents) * 1000) / 10 : null)}
              highlight={(d) => d.weekday === 5 || d.weekday === 6}
            />
            <div className="text-[11px] text-gray-500 border-t border-gray-100 pt-2">
              Werktag (Mo–Fr): <span className="font-semibold text-gray-700">{data.weekdaySplit.weekdayCount}</span> ({fmtPct(data.weekdaySplit.weekdayShare)})
              {' · '}
              Wochenende (Sa+So): <span className="font-semibold text-gray-700">{data.weekdaySplit.weekendCount}</span> ({fmtPct(data.weekdaySplit.weekendShare)})
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}
