'use client'

import { useCallback, useEffect, useState } from 'react'
import { Btn, LoadingBlock, Notice, Pill, Section, useConfirm, type Tone } from '@/components/admin/ui'

/**
 * Admin 3.0, Punkt 6+7: Spieltag-Cockpit mit Checkliste und Wettfreigabe-Editor. Erscheint ganz
 * oben im Spieltag-Tab (`sp-cockpit`). Holt den Status ausschließlich über
 * `/api/admin/matchday-checklist` (technische Prüfungen + manuelle Bestätigungen) und
 * `/api/admin/betting-window` (Wettfreigabe lesen/schreiben) — keine eigene Fachlogik, nur
 * Darstellung + die beiden schon vorhandenen Admin-APIs.
 */

type CheckStatus = 'erledigt' | 'handlungsbedarf' | 'nicht_geprueft' | 'nicht_erforderlich'
interface Check { status: CheckStatus; detail: string }
interface ChecklistResponse {
  matchday: number
  checks: {
    schedule: Check; odds: Check; anomalies: Check; goalscorerMarket: Check
    availability: Check; bonusTips: Check; specials: Check
    bettingWindow: Check; bettingTimeConfirmed: Check; settlement: Check
  }
  openAt: string | null
  manual: { bonusTipsNotPlanned?: boolean; specialsNotPlanned?: boolean }
}

const STATUS_PILL: Record<CheckStatus, { tone: Tone; label: string }> = {
  erledigt: { tone: 'success', label: 'Erledigt' },
  handlungsbedarf: { tone: 'critical', label: 'Handlungsbedarf' },
  nicht_geprueft: { tone: 'open', label: 'Nicht geprüft' },
  nicht_erforderlich: { tone: 'done', label: 'Nicht erforderlich' },
}

function CheckRow({ label, check, anchor }: { label: string; check: Check; anchor?: string }) {
  const p = STATUS_PILL[check.status]
  const content = (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-gray-900">{label}</div>
        <div className="text-[13px] text-gray-600">{check.detail}</div>
      </div>
      <Pill tone={p.tone} className="shrink-0">{p.label}</Pill>
    </div>
  )
  if (!anchor) return content
  return (
    <a href={`#${anchor}`} className="block rounded-lg hover:bg-gray-50" onClick={(e) => {
      // Lässt den Browser zum Anker scrollen UND klappt ein <details> dort auf, falls zu — dieselbe
      // jumpTo()-Logik wie die Sidebar, hier aber immer verfügbar (auch ohne AdminShellNav-Klick).
      const el = document.getElementById(anchor)
      if (el instanceof HTMLDetailsElement) { el.open = true; e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
    }}>
      {content}
    </a>
  )
}

export function SpieltagCockpit({ matchday, topspiel, dayMatchCount, onMessage }: {
  matchday: number | null
  topspiel: { current: boolean; hasCandidates: boolean }
  dayMatchCount: number
  onMessage: (m: string | null) => void
}) {
  const confirm = useConfirm()
  const [data, setData] = useState<ChecklistResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editingWindow, setEditingWindow] = useState(false)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')

  const load = useCallback(async () => {
    if (matchday == null) { setData(null); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/matchday-checklist?matchday=${matchday}`)
      const json = await res.json()
      if (res.ok) setData(json)
      else onMessage(`Fehler: ${json.error ?? 'Checkliste konnte nicht geladen werden.'}`)
    } catch {
      onMessage('Fehler: Netzwerkfehler beim Laden der Checkliste.')
    } finally {
      setLoading(false)
    }
  }, [matchday, onMessage])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload when the central matchday selection changes, same pattern used throughout
    void load()
  }, [load])

  async function patchManual(patch: Record<string, boolean>) {
    if (matchday == null) return
    setBusy(true)
    const res = await fetch('/api/admin/matchday-checklist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchday, ...patch }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok) load()
    else onMessage(`Fehler: ${json.error ?? 'Bestätigung fehlgeschlagen'}`)
  }

  async function saveWindow(openNow: boolean) {
    if (matchday == null) return
    if (openNow) {
      const ok = await confirm({
        title: 'Spieltag jetzt freigeben?',
        message: 'Das Wettfenster öffnet sofort — Wetten auf diesen Spieltag werden dadurch öffentlich verfügbar.',
        confirmLabel: 'Jetzt freigeben', tone: 'danger',
      })
      if (!ok) return
    }
    setBusy(true)
    const res = await fetch('/api/admin/betting-window', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: openNow ? JSON.stringify({ matchday, openNow: true }) : JSON.stringify({ matchday, date, time }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok) { setEditingWindow(false); onMessage('Wettfreigabe gespeichert.'); load() }
    else onMessage(`Fehler: ${json.error ?? 'Wettfreigabe konnte nicht gespeichert werden.'}`)
  }

  if (matchday == null) return null
  if (loading && !data) return <Section id="sp-cockpit" title="Spieltag-Cockpit" defaultOpen><LoadingBlock label="Cockpit wird geladen …" /></Section>
  if (!data) return null

  const { checks } = data
  const topspielCheck: Check = !topspiel.hasCandidates
    ? { status: 'nicht_erforderlich', detail: 'Kein B-Klasse-Spiel in der Nähe dieses Spieltags.' }
    : topspiel.current
      ? { status: 'erledigt', detail: 'Topspiel ausgewählt.' }
      : { status: 'handlungsbedarf', detail: 'Noch kein Topspiel ausgewählt.' }
  const scheduleCheck: Check = dayMatchCount > 0 ? { status: 'erledigt', detail: `${dayMatchCount} Spiel(e).` } : { status: 'handlungsbedarf', detail: 'Keine Spiele hinterlegt.' }

  const openCount = [checks.schedule, topspielCheck, checks.odds, checks.anomalies, checks.goalscorerMarket, checks.availability, checks.bonusTips, checks.specials, checks.settlement]
    .filter((c) => c.status === 'handlungsbedarf').length

  return (
    <Section id="sp-cockpit" title="Spieltag-Cockpit" subtitle="Ist dieser Spieltag vollständig vorbereitet?" defaultOpen
      badge={openCount > 0 ? <Pill tone="critical">{openCount} offen</Pill> : <Pill tone="success">bereit</Pill>}>
      <div className="divide-y divide-gray-100">
        <CheckRow label="Spielplan" check={scheduleCheck} anchor="sp-spiele" />
        <CheckRow label="B-Klasse-Topspiel" check={topspielCheck} anchor="sp-topspiel" />
        <CheckRow label="Quoten" check={checks.odds} anchor="qu-vorschau" />
        <CheckRow label="Auffällige Quoten" check={checks.anomalies} anchor="qu-warnungen" />
        <CheckRow label="Torschützenmarkt" check={checks.goalscorerMarket} anchor="sp-torschuetzen" />
        <CheckRow label="Bonus-Tipps" check={checks.bonusTips} anchor="sp-bonus" />
        <CheckRow label="Spieltag-Specials" check={checks.specials} anchor="sp-specials" />
        <CheckRow label="Offene Abrechnungen" check={checks.settlement} />

        <div className="py-2">
          <CheckRow label="Spieler-Verfügbarkeiten geprüft" check={checks.availability} />
          {checks.availability.status !== 'nicht_erforderlich' && checks.availability.status !== 'erledigt' && (
            <Btn size="sm" variant="secondary" loading={busy} onClick={() => patchManual({ confirmAvailability: true })}>Verfügbarkeiten bestätigen</Btn>
          )}
        </div>

        {checks.bonusTips.status === 'nicht_geprueft' && (
          <div className="py-2">
            <Btn size="sm" variant="ghost" loading={busy} onClick={() => patchManual({ bonusTipsNotPlanned: true })}>Bonus-Tipps bewusst nicht vorgesehen</Btn>
          </div>
        )}
        {checks.specials.status === 'nicht_geprueft' && (
          <div className="py-2">
            <Btn size="sm" variant="ghost" loading={busy} onClick={() => patchManual({ specialsNotPlanned: true })}>Specials bewusst nicht vorgesehen</Btn>
          </div>
        )}

        <div className="py-2">
          <CheckRow label="Wettfenster" check={checks.bettingWindow} />
          <CheckRow label="Wettfreigabezeit bestätigt" check={checks.bettingTimeConfirmed} />
          {!editingWindow ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Btn size="sm" variant="secondary" onClick={() => {
                const d = data.openAt ? new Date(data.openAt) : new Date()
                setDate(d.toLocaleDateString('sv', { timeZone: 'Europe/Berlin' }))
                setTime(d.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }))
                setEditingWindow(true)
              }}>Zeit ändern</Btn>
              {checks.bettingTimeConfirmed.status !== 'erledigt' && (
                <Btn size="sm" variant="secondary" loading={busy} onClick={() => patchManual({ confirmBettingTime: true })}>Zeit bestätigen</Btn>
              )}
              {checks.bettingWindow.status !== 'erledigt' && (
                <Btn size="sm" variant="danger" loading={busy} onClick={() => saveWindow(true)}>Jetzt freigeben</Btn>
              )}
            </div>
          ) : (
            <div className="mt-2 space-y-2 rounded-xl bg-gray-50 p-3">
              <div className="flex gap-2">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="min-h-[44px] flex-1 rounded-xl border-2 border-gray-300 px-3 text-[16px]" />
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="min-h-[44px] w-28 rounded-xl border-2 border-gray-300 px-3 text-[16px]" />
              </div>
              <p className="text-[12px] text-gray-500">Europe/Berlin — Sommer-/Winterzeit wird automatisch berücksichtigt.</p>
              <div className="flex gap-2">
                <Btn size="sm" variant="primary" loading={busy} onClick={() => saveWindow(false)}>Speichern</Btn>
                <Btn size="sm" variant="secondary" onClick={() => setEditingWindow(false)}>Abbrechen</Btn>
              </div>
            </div>
          )}
          {!editingWindow && <Notice tone="info">Schreibt ausschließlich app_settings.betting_open_md_{matchday} — keine Quote wird dabei verändert.</Notice>}
        </div>
      </div>
    </Section>
  )
}
