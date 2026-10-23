'use client'

import { useCallback, useEffect, useState } from 'react'
import { EmptyNote, LoadingBlock, Section } from '@/components/admin/ui'

interface MatchdayParticipation { matchday: number; users: number; legs: number; isCurrent: boolean }
interface Bucket { count: number }
interface HourBucket extends Bucket { hour: number }
interface WeekdayBucket extends Bucket { weekday: number }

interface StatsData {
  currentMatchday: number | null
  participation: MatchdayParticipation[]
  avgRecentParticipation: number | null
  totalPlacementEvents: number
  hours: HourBucket[]
  weekdays: WeekdayBucket[]
  topHour: HourBucket | null
  topWeekday: WeekdayBucket | null
}

const WEEKDAY_LABEL = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

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
const BAR_AREA_HEIGHT_PX = 80

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
 *  eine unbestimmte Elternhöhe aufgelöst werden müsste. */
function VerticalBars<T>({
  data, valueFor, labelFor, tooltipFor, highlight, tickEvery = 1,
}: {
  data: T[]
  valueFor: (d: T) => number
  labelFor: (d: T) => string
  tooltipFor: (d: T) => string
  highlight?: (d: T) => boolean
  tickEvery?: number
}) {
  const maxValue = Math.max(1, ...data.map(valueFor))
  return (
    <div className="flex items-end gap-1" style={{ height: BAR_AREA_HEIGHT_PX }}>
      {data.map((d, i) => {
        const v = valueFor(d)
        const barPx = v > 0 ? Math.max(2, (v / maxValue) * BAR_AREA_HEIGHT_PX) : 0
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5" title={tooltipFor(d)}>
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

  return (
    <div className="space-y-4">
      <Section id="st-beteiligung" title="Beteiligung je Spieltag" subtitle="Eindeutige Nutzer mit mindestens einem Tipp" defaultOpen>
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Metric
              label="Aktueller Spieltag"
              value={current ? `Spieltag ${current.matchday}` : '—'}
              note={current ? `${current.users} Nutzer bisher` : 'läuft noch nicht'}
            />
            <Metric
              label="Ø Nutzer, letzte 6 Spieltage"
              value={data.avgRecentParticipation != null ? data.avgRecentParticipation.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'}
              note="vollständig abgerechnet"
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
                tooltipFor={(d) => `Spieltag ${d.matchday}${d.isCurrent ? ' (läuft noch)' : ''}: ${d.users} Nutzer, ${d.legs} Tipp-Legs`}
                highlight={(d) => d.isCurrent}
              />
              <div className="flex items-center gap-3 text-[10px] text-gray-400">
                <span><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />abgeschlossen</span>
                <span><span className="inline-block w-2 h-2 rounded-full bg-red-300 mr-1" />läuft noch (unvollständig)</span>
              </div>
            </>
          )}
        </div>
      </Section>

      <Section id="st-uhrzeit" title="Platzierungen nach Uhrzeit" subtitle={`${data.totalPlacementEvents} Platzierungs-Ereignisse · Europe/Berlin`}>
        {data.totalPlacementEvents === 0 ? (
          <EmptyNote>Keine Daten.</EmptyNote>
        ) : (
          <VerticalBars
            data={data.hours}
            valueFor={(d) => d.count}
            labelFor={(d) => String(d.hour).padStart(2, '0')}
            tickEvery={2}
            tooltipFor={(d) => `${String(d.hour).padStart(2, '0')}:00 Uhr: ${d.count} Platzierungen`}
          />
        )}
      </Section>

      <Section id="st-wochentag" title="Platzierungen nach Wochentag" subtitle={`${data.totalPlacementEvents} Platzierungs-Ereignisse · Europe/Berlin`}>
        {data.totalPlacementEvents === 0 ? (
          <EmptyNote>Keine Daten.</EmptyNote>
        ) : (
          <VerticalBars
            data={data.weekdays}
            valueFor={(d) => d.count}
            labelFor={(d) => WEEKDAY_LABEL[d.weekday]}
            tooltipFor={(d) => `${WEEKDAY_LABEL[d.weekday]}: ${d.count} Platzierungen`}
          />
        )}
      </Section>
    </div>
  )
}
