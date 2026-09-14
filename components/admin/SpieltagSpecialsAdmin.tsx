'use client'

import { useCallback, useEffect, useState } from 'react'

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
const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  active: 'bg-green-100 text-green-700',
  closed: 'bg-orange-100 text-orange-700',
  settled: 'bg-blue-100 text-blue-700',
  void: 'bg-red-100 text-red-700',
}

function fmtOdds(n: number) {
  return n.toFixed(2).replace('.', ',')
}

export function SpieltagSpecialsAdmin() {
  const [matchday, setMatchday] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
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
    setMessage(null)
    try {
      const res = await fetch(`/api/admin/matchday-specials?matchday=${matchday}`)
      const json = await res.json()
      if (res.ok) {
        setExisting(json.specials ?? [])
        setCandidates(json.candidates ?? [])
        setSuggested(json.suggested ?? [])
        setIncludedMatches(json.includedMatches ?? [])
      } else {
        setMessage(`Fehler: ${json.error ?? 'Laden fehlgeschlagen.'}`)
      }
    } catch {
      setMessage('Fehler: Netzwerkfehler.')
    } finally {
      setLoading(false)
    }
  }, [matchday])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- explicit reload on matchday change, same pattern used throughout app/admin/page.tsx
    if (matchday) void load()
  }, [matchday, load])

  async function createFromTemplate(templateKey: string) {
    setMessage(null)
    const res = await fetch('/api/admin/matchday-specials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchday: parseInt(matchday, 10), templateKey }),
    })
    const json = await res.json()
    if (res.ok) load()
    else setMessage(`Fehler: ${json.error}`)
  }

  async function setStatus(id: number, status: 'draft' | 'active') {
    setMessage(null)
    const res = await fetch(`/api/admin/matchday-specials/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    const json = await res.json()
    if (res.ok) load()
    else setMessage(`Fehler: ${json.error}`)
  }

  async function remove(id: number) {
    if (!confirm('Diesen Entwurf wirklich löschen?')) return
    const res = await fetch(`/api/admin/matchday-specials/${id}`, { method: 'DELETE' })
    const json = await res.json()
    if (res.ok) load()
    else setMessage(`Fehler: ${json.error}`)
  }

  async function voidSpecial(id: number) {
    if (!confirm('Dieses Special stornieren? Alle offenen Wetten/Kombis darauf werden zurückerstattet.')) return
    const res = await fetch(`/api/admin/matchday-specials/${id}/void`, { method: 'POST' })
    const json = await res.json()
    if (res.ok) {
      setMessage(`Storniert: ${json.refundedSingles} Einzelwette(n), ${json.refundedCombos} Kombi(s) erstattet.`)
      load()
    } else setMessage(`Fehler: ${json.error}`)
  }

  function startEdit(s: ExistingSpecial) {
    setEditingId(s.id)
    setEditLine(s.line != null ? String(s.line).replace('.', ',') : '')
    const odds: Record<string, string> = {}
    for (const o of s.options) odds[o.key] = String(o.final_odds).replace('.', ',')
    setEditOdds(odds)
  }

  async function saveEdit(s: ExistingSpecial) {
    setMessage(null)
    const line = editLine.trim() === '' ? null : parseFloat(editLine.replace(',', '.'))
    const options = s.options.map((o) => ({ ...o, final_odds: parseFloat((editOdds[o.key] ?? String(o.final_odds)).replace(',', '.')) }))
    if (options.some((o) => isNaN(o.final_odds) || o.final_odds < 1.01)) {
      setMessage('Fehler: Ungültige Quote (mindestens 1,01).')
      return
    }
    const res = await fetch(`/api/admin/matchday-specials/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line, options }),
    })
    const json = await res.json()
    if (res.ok) { setEditingId(null); load() }
    else setMessage(`Fehler: ${json.error}`)
  }

  const usedTemplateKeys = new Set(existing.map((s) => s.template_key))

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Spieltag-weite Wettmärkte mit Einsatz/Quote — separat vom einsatzlosen Bonus-Tipp-System.
        Neu erstellte Specials starten als Entwurf und müssen hier explizit auf „Aktiv“ gesetzt werden, bevor sie auf /tipps erscheinen.
      </p>

      <div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Spieltag:</label>
        <input
          type="number"
          min={1}
          value={matchday}
          onChange={(e) => setMatchday(e.target.value)}
          placeholder="z.B. 8"
          className="w-24 px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-900"
        />
        <button
          onClick={load}
          disabled={!matchday || loading}
          className="px-3 py-1.5 bg-gray-800 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
        >
          {loading ? 'Lädt…' : 'Laden'}
        </button>
      </div>

      {message && <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-800">{message}</div>}

      {matchday && includedMatches.length > 0 && (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          <button onClick={() => setShowMatches((v) => !v)} className="underline">
            Dieser Spieltag umfasst {includedMatches.length} Spiele {showMatches ? '▲' : '▼'}
          </button>
          {showMatches && (
            <ul className="mt-1 space-y-0.5 pl-3 list-disc">
              {includedMatches.map((m) => (
                <li key={m.id}>#{m.id} · {new Date(m.match_date).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {m.status}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {existing.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Bestehende Specials</div>
          {existing.map((s) => (
            <div key={s.id} className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{s.title}</div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${STATUS_COLOR[s.status]}`}>{STATUS_LABEL[s.status]}</span>
              </div>

              {editingId === s.id ? (
                <div className="space-y-2 bg-gray-50 dark:bg-gray-900/40 rounded-lg p-2">
                  {s.line != null && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500">Linie:</label>
                      <input value={editLine} onChange={(e) => setEditLine(e.target.value)} className="w-20 px-2 py-1 border rounded text-xs dark:bg-gray-900" />
                    </div>
                  )}
                  {s.options.map((o) => (
                    <div key={o.key} className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-32 truncate">{o.label}</span>
                      <input
                        value={editOdds[o.key] ?? ''}
                        onChange={(e) => setEditOdds((v) => ({ ...v, [o.key]: e.target.value }))}
                        className="w-20 px-2 py-1 border rounded text-xs dark:bg-gray-900"
                      />
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(s)} className="px-2 py-1 bg-red-700 text-white rounded text-xs font-semibold">Speichern</button>
                    <button onClick={() => setEditingId(null)} className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs">Abbrechen</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {s.options.map((o) => (
                    <span key={o.key} className="text-xs bg-gray-100 dark:bg-gray-900/60 rounded-full px-2 py-0.5">
                      {o.label} @{fmtOdds(o.final_odds)}{o.overridden ? ' *' : ''}
                    </span>
                  ))}
                </div>
              )}
              {s.status === 'settled' && s.settlement_result && (
                <div className="text-xs text-blue-700">Ergebnis: {s.settlement_result.finalStat} → {s.settlement_result.winningKey}</div>
              )}

              {editingId !== s.id && s.status !== 'settled' && s.status !== 'void' && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {s.status === 'draft' && (
                    <button onClick={() => setStatus(s.id, 'active')} className="px-2 py-1 bg-green-600 text-white rounded text-xs font-semibold">✓ Aktivieren</button>
                  )}
                  {s.status === 'active' && (
                    <button onClick={() => setStatus(s.id, 'draft')} className="px-2 py-1 bg-gray-500 text-white rounded text-xs font-semibold">Zurück zu Entwurf</button>
                  )}
                  <button onClick={() => startEdit(s)} className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs font-semibold">Linie/Quoten ändern</button>
                  {s.status === 'draft' ? (
                    <button onClick={() => remove(s.id)} className="px-2 py-1 bg-red-50 text-red-700 rounded text-xs font-semibold">Löschen</button>
                  ) : (
                    <button onClick={() => voidSpecial(s.id)} className="px-2 py-1 bg-red-50 text-red-700 rounded text-xs font-semibold">Stornieren</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {candidates.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
            Vorlagen-Pool ({candidates.length}) — vorgeschlagen: {suggested.length} verschiedene Kategorien
          </div>
          {candidates.map((c) => {
            const alreadyUsed = usedTemplateKeys.has(c.templateKey)
            const isSuggested = suggested.includes(c.templateKey)
            return (
              <div key={c.templateKey} className={`border rounded-xl p-3 flex items-center justify-between gap-2 ${isSuggested ? 'border-orange-300 bg-orange-50/50 dark:bg-orange-950/20' : 'border-gray-200 dark:border-gray-700'}`}>
                <div className="min-w-0">
                  <div className="text-xs text-gray-400 uppercase">{CATEGORY_LABEL[c.category]}{isSuggested ? ' · Vorschlag' : ''}</div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{c.title}</div>
                  <div className="text-xs text-gray-500 flex flex-wrap gap-1.5 mt-0.5">
                    {c.options.map((o) => (
                      <span key={o.key}>{o.label} @{fmtOdds(o.generated_odds)} (p={(o.probability * 100).toFixed(0)}%)</span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => createFromTemplate(c.templateKey)}
                  disabled={alreadyUsed}
                  className="flex-shrink-0 px-2.5 py-1.5 bg-gray-800 text-white rounded-lg text-xs font-semibold disabled:opacity-40"
                >
                  {alreadyUsed ? 'Bereits erstellt' : '+ Als Entwurf'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
