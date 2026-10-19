'use client'

import { useCallback, useEffect, useState } from 'react'
import { Btn, EmptyNote, Field, inputCls, Panel, Pill, useConfirm } from '@/components/admin/ui'

interface SpecialOption {
  key: string
  label: string
  probability: number
  generated_odds: number
  final_odds: number
  overridden: boolean
}

interface Candidate {
  templateKey: string
  category: 'volume' | 'structure' | 'extreme'
  title: string
  line: number | null
  options: SpecialOption[]
}

interface ExistingSpecial {
  id: number
  template_key: string
  title: string
  line: number | null
  options: SpecialOption[]
  status: 'draft' | 'active' | 'closed' | 'settled' | 'void'
  display_order: number
  included_match_ids: number[]
  settlement_result: { finalStat: number; winningKey: string } | null
}

interface IncludedMatch {
  id: number
  match_date: string
  status: string
  home_team_id: number
  away_team_id: number
}

const CATEGORY_LABEL: Record<string, string> = { volume: 'Torvolumen', structure: 'Ergebnisstruktur', extreme: 'Extremereignis' }
const STATUS_LABEL: Record<string, string> = { draft: 'Entwurf', active: 'Aktiv', closed: 'Geschlossen', settled: 'Abgerechnet', void: 'Storniert' }
const STATUS_TONE: Record<string, 'neutral' | 'success' | 'open' | 'info' | 'critical'> = {
  draft: 'neutral', active: 'success', closed: 'open', settled: 'info', void: 'critical',
}

function fmtOdds(n: number) {
  return n.toFixed(2).replace('.', ',')
}

/** `onMessage` ersetzt die frühere eigene `message`-Mini-Leiste (immer blau, egal ob Erfolg
 *  oder Fehler) — läuft jetzt über dieselbe globale Banner-Stelle wie überall sonst im Admin-
 *  Bereich. `remove()`/`voidSpecial()` nutzen jetzt `useConfirm()` statt des nativen `confirm()`
 *  (auf iPhone unzuverlässig/inkonsistent gestylt, wie an jeder anderen destruktiven Aktion im
 *  Admin-Bereich bereits behoben). */
export function SpieltagSpecialsAdmin({ onMessage }: { onMessage: (m: string | null) => void }) {
  const confirmDialog = useConfirm()
  const [matchday, setMatchday] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [existing, setExisting] = useState<ExistingSpecial[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [suggested, setSuggested] = useState<string[]>([])
  const [includedMatches, setIncludedMatches] = useState<IncludedMatch[]>([])
  const [showMatches, setShowMatches] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editLine, setEditLine] = useState<string>('')
  const [editOdds, setEditOdds] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!matchday) return
    setLoading(true)
    onMessage(null)
    try {
      const res = await fetch(`/api/admin/matchday-specials?matchday=${matchday}`)
      const json = await res.json()
      if (res.ok) {
        setExisting(json.specials ?? [])
        setCandidates(json.candidates ?? [])
        setSuggested(json.suggested ?? [])
        setIncludedMatches(json.includedMatches ?? [])
      } else {
        onMessage(`Fehler: ${json.error ?? 'Laden fehlgeschlagen.'}`)
      }
    } catch {
      onMessage('Fehler: Netzwerkfehler.')
    } finally {
      setLoading(false)
    }
  }, [matchday, onMessage])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- explicit reload on matchday change, same pattern used throughout app/admin/page.tsx
    if (matchday) void load()
  }, [matchday, load])

  async function createFromTemplate(templateKey: string) {
    onMessage(null)
    const res = await fetch('/api/admin/matchday-specials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchday: parseInt(matchday, 10), templateKey }),
    })
    const json = await res.json()
    if (res.ok) load()
    else onMessage(`Fehler: ${json.error}`)
  }

  async function setStatus(id: number, status: 'draft' | 'active') {
    onMessage(null)
    const res = await fetch(`/api/admin/matchday-specials/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    const json = await res.json()
    if (res.ok) load()
    else onMessage(`Fehler: ${json.error}`)
  }

  async function remove(id: number) {
    if (!(await confirmDialog({ title: 'Diesen Entwurf wirklich löschen?', confirmLabel: 'Löschen', tone: 'danger' }))) return
    const res = await fetch(`/api/admin/matchday-specials/${id}`, { method: 'DELETE' })
    const json = await res.json()
    if (res.ok) load()
    else onMessage(`Fehler: ${json.error}`)
  }

  async function voidSpecial(id: number) {
    if (!(await confirmDialog({
      title: 'Dieses Special stornieren?',
      message: 'Alle offenen Wetten/Kombis darauf werden zurückerstattet.',
      confirmLabel: 'Stornieren', tone: 'danger',
    }))) return
    const res = await fetch(`/api/admin/matchday-specials/${id}/void`, { method: 'POST' })
    const json = await res.json()
    if (res.ok) {
      onMessage(`Storniert: ${json.refundedSingles} Einzelwette(n), ${json.refundedCombos} Kombi(s) erstattet.`)
      load()
    } else onMessage(`Fehler: ${json.error}`)
  }

  function startEdit(s: ExistingSpecial) {
    setEditingId(s.id)
    setEditLine(s.line != null ? String(s.line).replace('.', ',') : '')
    const odds: Record<string, string> = {}
    for (const o of s.options) odds[o.key] = String(o.final_odds).replace('.', ',')
    setEditOdds(odds)
  }

  async function saveEdit(s: ExistingSpecial) {
    onMessage(null)
    const line = editLine.trim() === '' ? null : parseFloat(editLine.replace(',', '.'))
    const options = s.options.map((o) => ({ ...o, final_odds: parseFloat((editOdds[o.key] ?? String(o.final_odds)).replace(',', '.')) }))
    if (options.some((o) => isNaN(o.final_odds) || o.final_odds < 1.01)) {
      onMessage('Fehler: Ungültige Quote (mindestens 1,01).')
      return
    }
    const res = await fetch(`/api/admin/matchday-specials/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line, options }),
    })
    const json = await res.json()
    if (res.ok) { setEditingId(null); load() }
    else onMessage(`Fehler: ${json.error}`)
  }

  const usedTemplateKeys = new Set(existing.map((s) => s.template_key))

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-gray-600">
        Spieltag-weite Wettmärkte mit Einsatz/Quote — separat vom einsatzlosen Bonus-Tipp-System.
        Neu erstellte Specials starten als Entwurf und müssen hier explizit auf „Aktiv“ gesetzt werden, bevor sie auf /tipps erscheinen.
      </p>

      <div className="flex items-end gap-2">
        <Field label="Spieltag" className="w-28">
          <input type="number" min={1} value={matchday} onChange={(e) => setMatchday(e.target.value)} placeholder="z.B. 8" className={inputCls} />
        </Field>
        <Btn variant="secondary" disabled={!matchday || loading} onClick={load}>
          {loading ? 'Lädt …' : 'Laden'}
        </Btn>
      </div>

      {matchday && includedMatches.length > 0 && (
        <div className="text-[13px] text-gray-600">
          <button onClick={() => setShowMatches((v) => !v)} className="underline">
            Dieser Spieltag umfasst {includedMatches.length} Spiele {showMatches ? '▲' : '▼'}
          </button>
          {showMatches && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {includedMatches.map((m) => (
                <li key={m.id}>#{m.id} · {new Date(m.match_date).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {m.status}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {existing.length > 0 && (
        <div className="space-y-2">
          <div className="text-[12px] font-bold tracking-wide text-gray-500 uppercase">Bestehende Specials</div>
          {existing.map((s) => (
            <Panel key={s.id} className="space-y-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[14px] font-semibold text-gray-900">{s.title}</div>
                <Pill tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Pill>
              </div>

              {editingId === s.id ? (
                <div className="space-y-2 rounded-lg bg-gray-50 p-2">
                  {s.line != null && (
                    <div className="flex items-center gap-2">
                      <label className="text-[12px] text-gray-600">Linie:</label>
                      <input value={editLine} onChange={(e) => setEditLine(e.target.value)} className={`w-20 ${inputCls}`} />
                    </div>
                  )}
                  {s.options.map((o) => (
                    <div key={o.key} className="flex items-center gap-2">
                      <span className="w-32 truncate text-[12px] text-gray-600">{o.label}</span>
                      <input
                        value={editOdds[o.key] ?? ''}
                        onChange={(e) => setEditOdds((v) => ({ ...v, [o.key]: e.target.value }))}
                        className={`w-20 ${inputCls}`}
                      />
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Btn size="sm" variant="primary" onClick={() => saveEdit(s)}>Speichern</Btn>
                    <Btn size="sm" variant="secondary" onClick={() => setEditingId(null)}>Abbrechen</Btn>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {s.options.map((o) => (
                    <span key={o.key} className="rounded-full bg-gray-100 px-2 py-0.5 text-[12px]">
                      {o.label} @{fmtOdds(o.final_odds)}{o.overridden ? ' *' : ''}
                    </span>
                  ))}
                </div>
              )}
              {s.status === 'settled' && s.settlement_result && (
                <div className="text-[12px] text-sky-700">Ergebnis: {s.settlement_result.finalStat} → {s.settlement_result.winningKey}</div>
              )}

              {editingId !== s.id && s.status !== 'settled' && s.status !== 'void' && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {s.status === 'draft' && (
                    <Btn size="sm" variant="success" onClick={() => setStatus(s.id, 'active')}>✓ Aktivieren</Btn>
                  )}
                  {s.status === 'active' && (
                    <Btn size="sm" variant="secondary" onClick={() => setStatus(s.id, 'draft')}>Zurück zu Entwurf</Btn>
                  )}
                  <Btn size="sm" variant="secondary" onClick={() => startEdit(s)}>Linie/Quoten ändern</Btn>
                  {s.status === 'draft' ? (
                    <Btn size="sm" variant="danger" onClick={() => remove(s.id)}>Löschen</Btn>
                  ) : (
                    <Btn size="sm" variant="danger" onClick={() => voidSpecial(s.id)}>Stornieren</Btn>
                  )}
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}

      {candidates.length > 0 && (
        <div className="space-y-2">
          <div className="text-[12px] font-bold tracking-wide text-gray-500 uppercase">
            Vorlagen-Pool ({candidates.length}) — vorgeschlagen: {suggested.length} verschiedene Kategorien
          </div>
          {candidates.map((c) => {
            const alreadyUsed = usedTemplateKeys.has(c.templateKey)
            const isSuggested = suggested.includes(c.templateKey)
            return (
              <Panel key={c.templateKey} tone={isSuggested ? 'open' : undefined} className="flex items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <div className="text-[11px] text-gray-500 uppercase">{CATEGORY_LABEL[c.category]}{isSuggested ? ' · Vorschlag' : ''}</div>
                  <div className="truncate text-[14px] font-semibold text-gray-900">{c.title}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1.5 text-[12px] text-gray-600">
                    {c.options.map((o) => (
                      <span key={o.key}>{o.label} @{fmtOdds(o.generated_odds)} (p={(o.probability * 100).toFixed(0)}%)</span>
                    ))}
                  </div>
                </div>
                <Btn size="sm" variant="secondary" className="shrink-0" disabled={alreadyUsed} onClick={() => createFromTemplate(c.templateKey)}>
                  {alreadyUsed ? 'Bereits erstellt' : '+ Als Entwurf'}
                </Btn>
              </Panel>
            )
          })}
        </div>
      )}

      {existing.length === 0 && candidates.length === 0 && matchday && !loading && (
        <EmptyNote>Für diesen Spieltag sind keine Specials vorhanden.</EmptyNote>
      )}
    </div>
  )
}
