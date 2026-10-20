'use client'

import { useMemo, useState } from 'react'
import { AdminBetsTab } from '@/components/admin/AdminBetsTab'
import { BonusTipsAdmin } from '@/components/admin/BonusTipsAdmin'
import { GoalscorersTab } from '@/components/admin/GoalscorersTab'
import { MatchdayPicker } from '@/components/admin/MatchdayPicker'
import { CATEGORY_LABEL } from '@/components/admin/ResultCards'
import { SpieltagCockpit } from '@/components/admin/SpieltagCockpit'
import { SpieltagSpecialsAdmin } from '@/components/admin/SpieltagSpecialsAdmin'
import { EmptyNote, Notice, Panel, Pill, Section, type Tone } from '@/components/admin/ui'
import type { MatchRow } from '@/components/admin/types'
import type { EffectiveMatchdayIndex } from '@/lib/season'

/**
 * Visuelle Übernahme aus dem alten, verworfenen Admin-Redesign (dort components/admin/
 * SpieltagTab.tsx) — wie bei Ergebnisse OHNE dessen eigene Datenabruf-/Schreiblogik:
 *  - `toggleTopspiel` ruft weiterhin GENAU den bestehenden Handler aus AdminPage auf (nicht die
 *    eigene `createClient().from('matches').update(...)`-Kopie des alten Redesigns).
 *  - `AdminBetsTab` ist HIER die bestehende, bereits auf schon geladenen `matches` arbeitende
 *    Komponente aus app/admin/page.tsx (eigener Spieltag-Umschalter, eigener /api/admin/bets-
 *    Abruf) — NICHT die gleichnamige, aber anders gebaute Komponente aus dem alten Redesign
 *    (dort nur `matchday` als Prop, eigener Abruf). Nur in die neue Section-Hülle gelegt, ihr
 *    Innenleben (Wettenlisten je Spieler) bleibt in diesem Schritt unangetastet.
 *  - Torschützen (`GoalscorersTab`) zieht von Quoten HIERHIN um — entspricht sowohl dem alten
 *    Redesign als auch der eigenen Aufgabenbeschreibung ("Torschützen und Verfügbarkeit" unter
 *    Spieltag) und dem bereits bestehenden `sp-torschuetzen`-Sprungziel in AdminShellNav. Folgt
 *    jetzt dem eigenen Spieltag-Umschalter dieser Ansicht statt `previewMd` aus dem Quoten-Tab —
 *    reine Navigations-Umstellung, GoalscorersTab selbst unverändert.
 */

const STATUS_PILL: Record<string, { tone: Tone; label: string }> = {
  scheduled: { tone: 'info', label: 'Geplant' },
  live: { tone: 'open', label: 'Läuft' },
  finished: { tone: 'success', label: 'Abgerechnet' },
  postponed: { tone: 'open', label: 'Verschoben' },
  cancelled: { tone: 'done', label: 'Abgesagt' },
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

export function SpieltagTabView({
  matches, mdIndex, currentMatchday, pendingByMatch, matchdayForFilter, onToggleTopspiel, onMessage,
}: {
  matches: MatchRow[]
  mdIndex: EffectiveMatchdayIndex
  currentMatchday: number | null
  pendingByMatch: Record<number, number>
  matchdayForFilter: (m: MatchRow) => number | null
  onToggleTopspiel: (matchId: number, value: boolean) => void
  onMessage: (m: string | null) => void
}) {
  const [choice, setChoice] = useState<number | null>(null)
  const matchday = choice ?? currentMatchday

  const options = useMemo(
    () => [...mdIndex.kreisligaMatchdaysDisplayOrder, ...(matches.some((m) => m.matchday === 999) ? [999] : [])],
    [mdIndex, matches],
  )
  // Gleiche Regel wie bisher im Spieltag-Tab: normale B-Klasse-Spiele (ohne Topspiel-Flag)
  // laufen unter keinem eigenen Kreisliga-Spieltag und werden hier nicht als "Spiel dieses
  // Spieltags" gezählt (sie erscheinen stattdessen unten im Topspiel-Abschnitt).
  const dayMatches = useMemo(
    () => matches.filter((m) => matchday != null && matchdayForFilter(m) === matchday && (m.match_category !== 'b-klasse' || m.is_topspiel)),
    [matches, matchday, matchdayForFilter],
  )

  // Kandidaten für das B-Klasse-Topspiel: wie bisher ±7 Tage um den Anpfiff-Schwerpunkt DIESES
  // Spieltags (nicht mehr zwingend des aktuellen) — exakt dieselbe Fensterregel, nur jetzt an
  // den eigenen Spieltag-Umschalter dieser Ansicht gekoppelt statt immer an currentMatchday.
  const topspiel = useMemo(() => {
    const now = new Date()
    const anchor = matchday != null ? mdIndex.matchdayAnchorDate.get(matchday) : null
    const windowMs = 7 * 24 * 60 * 60 * 1000
    const candidates = matches
      .filter((m) => m.match_category === 'b-klasse' && m.status === 'scheduled' && new Date(m.match_date) >= now)
      .filter((m) => anchor == null || Math.abs(new Date(m.match_date).getTime() - anchor) <= windowMs)
      .sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime())
    const current = matches.find((m) => m.match_category === 'b-klasse' && m.is_topspiel && m.status === 'scheduled')
    const list = current && !candidates.some((m) => m.id === current.id) ? [current, ...candidates] : candidates
    return { list, current }
  }, [matches, matchday, mdIndex])

  const totalPending = dayMatches.reduce((a, m) => a + (pendingByMatch[m.id] ?? 0), 0)

  return (
    <div className="space-y-4">
      <Panel className="space-y-3 p-4">
        <MatchdayPicker value={matchday} options={options} current={currentMatchday} onChange={(v) => setChoice(v === 'all' ? currentMatchday : v)} />
        {matchday != null && (
          <p className="text-[14px] text-gray-700">
            <b>{dayMatches.length}</b> {dayMatches.length === 1 ? 'Spiel' : 'Spiele'} · <b>{dayMatches.filter((m) => m.status === 'finished').length}</b> abgerechnet · <b>{totalPending}</b> offene {totalPending === 1 ? 'Wette' : 'Wetten'}
          </p>
        )}
      </Panel>

      <SpieltagCockpit
        matchday={matchday}
        topspiel={{ current: !!topspiel.current, hasCandidates: topspiel.list.length > 0 }}
        dayMatchCount={dayMatches.length}
        onMessage={onMessage}
      />

      <Section id="sp-spiele" title="Spiele dieses Spieltags" subtitle="Status und offene Wetten je Spiel" defaultOpen badge={<Pill tone="neutral">{dayMatches.length}</Pill>}>
        {dayMatches.length === 0 ? <EmptyNote>Für diesen Spieltag sind keine Spiele hinterlegt.</EmptyNote> : (
          <ul className="divide-y divide-gray-200">
            {dayMatches.map((m) => {
              const st = STATUS_PILL[m.status] ?? { tone: 'neutral' as Tone, label: m.status }
              const pending = pendingByMatch[m.id] ?? 0
              return (
                <li key={m.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-[15px] font-bold leading-snug text-gray-900">{m.home_team?.name ?? '?'} – {m.away_team?.name ?? '?'}</div>
                    <div className="text-[13px] text-gray-600">{CATEGORY_LABEL[m.match_category ?? 'kreisliga']} · {fmtDay(m.match_date)} {fmtTime(m.match_date)} Uhr{pending > 0 && <> · <b className="text-sky-800">{pending} offen</b></>}</div>
                  </div>
                  {m.home_score != null && m.away_score != null && (
                    <span className="shrink-0 rounded-lg bg-gray-900 px-2.5 py-1 font-display text-[20px] font-extrabold leading-none tabular-nums text-white">{m.home_score}:{m.away_score}</span>
                  )}
                  <Pill tone={st.tone}>{st.label}</Pill>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section id="sp-tipps" title="Tipps der Spieler" subtitle="Wer hat was getippt — nach Spieler sortiert" defaultOpen>
        <AdminBetsTab matches={matches} mdIndex={mdIndex} currentMatchday={currentMatchday} />
      </Section>

      {topspiel.list.length > 0 && (
        <Section id="sp-topspiel" title="B-Klasse-Topspiel der Woche" subtitle="Genau ein B-Klasse-Spiel pro Woche kann als wettbares Topspiel markiert werden"
          defaultOpen={!!topspiel.current}
          badge={topspiel.current ? <Pill tone="success">⭐ gewählt</Pill> : <Pill tone="open">nicht gewählt</Pill>}>
          <div className="space-y-2">
            {topspiel.list.map((m) => (
              <label key={m.id} className={`flex min-h-[56px] cursor-pointer items-center gap-3 rounded-xl border-2 px-3 py-2.5 ${m.is_topspiel ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white'}`}>
                <input type="checkbox" checked={m.is_topspiel} onChange={(e) => onToggleTopspiel(m.id, e.target.checked)} className="h-6 w-6 shrink-0 accent-red-700" />
                <div className="min-w-0 flex-1">
                  <div className="break-words text-[15px] font-semibold leading-snug text-gray-900">{m.home_team?.name ?? '?'} – {m.away_team?.name ?? '?'}</div>
                  <div className="text-[13px] text-gray-600">{fmtDay(m.match_date)} {fmtTime(m.match_date)} Uhr</div>
                </div>
                {m.is_topspiel && <span aria-hidden>⭐</span>}
              </label>
            ))}
          </div>
          {topspiel.list.filter((m) => m.is_topspiel).length > 1 && <div className="mt-3"><Notice tone="open">Mehr als ein Topspiel markiert — vorgesehen ist genau eines pro Woche.</Notice></div>}
        </Section>
      )}

      <Section id="sp-torschuetzen" title="Torschützen & Verfügbarkeit" subtitle="Torschützen-Quoten, Verfügbarkeit der Spieler, Torschützen eintragen (geht auch direkt beim Ergebnis)">
        <GoalscorersTab matches={matches} onMessage={onMessage} matchday={matchday} mdIndex={mdIndex} />
      </Section>

      {/* Admin 3.0, Punkt 4: aus der alten "Verwaltung" hierher umgezogen — gehören fachlich zur
          Spieltagsvorbereitung, nicht zur allgemeinen Benutzerverwaltung. Folgen jetzt der
          zentralen Spieltagsauswahl dieser Ansicht (SpieltagSpecialsAdmin lädt automatisch neu,
          BonusTipsAdmin schlägt den Spieltag im Erstellen-Formular nur als Default vor). */}
      <Section id="sp-bonus" title="Bonus-Tipps" subtitle="Sondertipps ohne Einsatz: erstellen, verwalten, auswerten">
        <BonusTipsAdmin defaultMatchday={matchday} onMessage={onMessage} />
      </Section>

      <Section id="sp-specials" title="Spieltag-Specials" subtitle="Spieltag-weite Wettmärkte mit Einsatz/Quote: vorschlagen, aktivieren, verwalten">
        <SpieltagSpecialsAdmin matchday={matchday} onMessage={onMessage} />
      </Section>
    </div>
  )
}
