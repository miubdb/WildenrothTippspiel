'use client'

import { useCallback, useEffect, useState } from 'react'
import { BONUS_TIP_TYPE_LABEL, isAutoEvaluable, type BonusTip, type BonusTipType, type BonusTipOption } from '@/lib/bonusTips'

interface AdminTip extends BonusTip {
  participant_count: number
  answer_distribution: Record<string, number>
  correct_answer_count: number | null
  wildis_paid_out: number
  answers: { user_id: string; answer_key: string; name: string }[]
}

type MatchOption = { id: number; home: string; away: string; match_date: string; status: string; home_score: number | null; away_score: number | null }

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function BonusTipsAdmin() {
  const [tips, setTips] = useState<AdminTip[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/bonus-tips')
      const json = await res.json()
      if (res.ok) setTips(json.tips)
      else setMessage(`Fehler: ${json.error ?? 'Laden fehlgeschlagen.'}`)
    } catch {
      setMessage('Fehler: Netzwerkfehler.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial async data fetch on mount, same pattern used throughout app/admin/page.tsx
    void load()
  }, [load])

  async function evaluate(id: number) {
    setMessage(null)
    try {
      const res = await fetch(`/api/admin/bonus-tips/${id}/evaluate`, { method: 'POST' })
      const json = await res.json()
      if (res.ok) {
        setMessage(`Ausgewertet: ${json.correctCount}/${json.totalAnswers} richtig, ${json.paidCount} Gutschrift(en) neu vergeben.`)
        load()
      } else {
        setMessage(`Fehler: ${json.error}`)
      }
    } catch {
      setMessage('Fehler: Netzwerkfehler.')
    }
  }

  async function setLongTermAnswer(id: number, key: string) {
    setMessage(null)
    const res = await fetch(`/api/admin/bonus-tips/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correct_option_keys: [key] }),
    })
    const json = await res.json()
    if (res.ok) load()
    else setMessage(`Fehler: ${json.error}`)
  }

  async function remove(id: number) {
    if (!confirm('Diesen Bonus-Tipp wirklich löschen?')) return
    const res = await fetch(`/api/admin/bonus-tips/${id}`, { method: 'DELETE' })
    const json = await res.json()
    if (res.ok) load()
    else setMessage(`Fehler: ${json.error}`)
  }

  if (loading) return <p className="text-sm text-gray-400">Lade Bonus-Tipps…</p>

  return (
    <div className="space-y-3">
      {message && <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-800">{message}</div>}

      <button
        onClick={() => setShowCreate(v => !v)}
        className="w-full py-2.5 bg-red-700 hover:bg-red-800 text-white font-semibold rounded-lg transition-colors text-sm"
      >
        {showCreate ? 'Formular schließen' : '+ Neuer Bonus-Tipp'}
      </button>

      {showCreate && <CreateForm onCreated={() => { setShowCreate(false); load() }} onError={setMessage} />}

      <div className="space-y-2">
        {(tips ?? []).length === 0 && <p className="text-xs text-gray-400">Noch keine Bonus-Tipps angelegt.</p>}
        {(tips ?? []).map(t => {
          const now = new Date()
          const isOpen = now >= new Date(t.opens_at) && now < new Date(t.closes_at)
          const isClosed = now >= new Date(t.closes_at) && !t.evaluated_at
          const auto = isAutoEvaluable(t.type)
          return (
            <div key={t.id} className="bg-gray-50 rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-gray-900 text-sm">{t.title}</div>
                  <div className="text-xs text-gray-500">{BONUS_TIP_TYPE_LABEL[t.type]} · Tippschluss {fmtDateTime(t.closes_at)}</div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full flex-shrink-0 ${
                  t.evaluated_at ? 'bg-green-100 text-green-700' : isOpen ? 'bg-amber-100 text-amber-700' : isClosed ? 'bg-gray-200 text-gray-600' : 'bg-gray-100 text-gray-400'
                }`}>
                  {t.evaluated_at ? 'Ausgewertet' : isOpen ? 'Offen' : isClosed ? 'Geschlossen' : 'Bevorstehend'}
                </span>
              </div>
              <p className="text-xs text-gray-600 mt-1">{t.description}</p>
              <div className="text-xs text-gray-500 mt-2">
                {t.participant_count} Teilnehmer · {t.reward_wildis} Wildis Belohnung
                {t.evaluated_at && <> · {t.correct_answer_count}/{t.participant_count} richtig · {t.wildis_paid_out} Wildis ausgeschüttet</>}
              </div>

              {!t.evaluated_at && !auto && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-500">Korrekte Antwort festlegen:</span>
                  {t.options.map(o => (
                    <button
                      key={o.key}
                      onClick={() => setLongTermAnswer(t.id, o.key)}
                      className={`text-xs px-2 py-1 rounded border ${
                        (t.correct_option_keys ?? []).includes(o.key) ? 'border-green-500 bg-green-50 text-green-700 font-semibold' : 'border-gray-300 text-gray-600'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex gap-2 mt-3">
                {!t.evaluated_at && (isClosed || !auto) && (
                  <button
                    onClick={() => evaluate(t.id)}
                    disabled={!isClosed}
                    className="text-xs px-3 py-1.5 bg-gray-900 disabled:bg-gray-300 text-white rounded-lg font-semibold"
                  >
                    Jetzt auswerten
                  </button>
                )}
                {!t.evaluated_at && (
                  <button onClick={() => remove(t.id)} className="text-xs px-3 py-1.5 border border-red-300 text-red-600 rounded-lg font-semibold">
                    Löschen
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CreateForm({ onCreated, onError }: { onCreated: () => void; onError: (m: string) => void }) {
  const [type, setType] = useState<BonusTipType>('total_goals_matchday')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [matchday, setMatchday] = useState('')
  const [matches, setMatches] = useState<MatchOption[] | null>(null)
  const [scopeMatchId, setScopeMatchId] = useState<number | null>(null)
  const [rangeOptions, setRangeOptions] = useState([{ label: '0–2 Tore', min: '0', max: '2' }, { label: '3–4 Tore', min: '3', max: '4' }, { label: '5+ Tore', min: '5', max: '' }])
  const [longTermOptions, setLongTermOptions] = useState(['', ''])
  const [closesAt, setClosesAt] = useState(() => toLocalInputValue(new Date(Date.now() + 3 * 24 * 3600 * 1000)))
  const [reward, setReward] = useState(100)
  const [groupKey, setGroupKey] = useState('')
  const [groupMax, setGroupMax] = useState('')
  const [saving, setSaving] = useState(false)

  const needsMatchday = type === 'total_goals_matchday' || type === 'highest_scoring_match' || type === 'biggest_win_matchday'
  const needsSingleMatch = type === 'match_goals'

  async function loadMatches(md: string) {
    setMatchday(md)
    setMatches(null)
    if (!md) return
    const res = await fetch(`/api/admin/bonus-tips/matches?matchday=${md}`)
    const json = await res.json()
    if (res.ok) setMatches(json.matches)
  }

  function buildOptions(): BonusTipOption[] {
    if (type === 'total_goals_matchday' || type === 'match_goals') {
      return rangeOptions
        .filter(r => r.label.trim())
        .map((r, i) => ({
          key: `opt${i}`, label: r.label,
          minGoals: r.min ? Number(r.min) : undefined,
          maxGoals: r.max ? Number(r.max) : undefined,
        }))
    }
    if (type === 'highest_scoring_match' || type === 'biggest_win_matchday') {
      return (matches ?? []).map(m => ({ key: String(m.id), label: `${m.home} – ${m.away}`, matchId: m.id }))
    }
    return longTermOptions.filter(o => o.trim()).map((o, i) => ({ key: `opt${i}`, label: o.trim() }))
  }

  async function submit() {
    if (!title.trim() || !description.trim()) { onError('Titel und Beschreibung erforderlich.'); return }
    const options = buildOptions()
    if (options.length < 2) { onError('Mindestens 2 Antwortmöglichkeiten erforderlich.'); return }
    if (needsSingleMatch && scopeMatchId == null) { onError('Bitte ein Spiel auswählen.'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/admin/bonus-tips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, description, type,
          scope_matchday: needsMatchday ? Number(matchday) : null,
          scope_match_id: needsSingleMatch ? scopeMatchId : null,
          options,
          closes_at: new Date(closesAt).toISOString(),
          reward_wildis: reward,
          group_key: groupKey.trim() || null,
          group_max_per_user: groupMax ? Number(groupMax) : null,
        }),
      })
      const json = await res.json()
      if (res.ok) onCreated()
      else onError(`Fehler: ${json.error}`)
    } catch {
      onError('Fehler: Netzwerkfehler.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3">
      <div>
        <label className="text-xs font-semibold text-gray-600">Typ</label>
        <select value={type} onChange={e => setType(e.target.value as BonusTipType)} className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5">
          {Object.entries(BONUS_TIP_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-600">Titel</label>
        <input value={title} onChange={e => setTitle(e.target.value)} className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5" placeholder='z.B. "Torreichstes Spiel Spieltag 9"' />
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-600">Frage/Beschreibung</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5" />
      </div>

      {(needsMatchday || needsSingleMatch) && (
        <div>
          <label className="text-xs font-semibold text-gray-600">Spieltag</label>
          <input value={matchday} onChange={e => loadMatches(e.target.value)} type="number" className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5" placeholder="z.B. 9" />
        </div>
      )}

      {needsSingleMatch && matches && (
        <div>
          <label className="text-xs font-semibold text-gray-600">Spiel</label>
          <select value={scopeMatchId ?? ''} onChange={e => setScopeMatchId(Number(e.target.value))} className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5">
            <option value="">— auswählen —</option>
            {matches.map(m => <option key={m.id} value={m.id}>{m.home} – {m.away}</option>)}
          </select>
        </div>
      )}

      {(type === 'highest_scoring_match' || type === 'biggest_win_matchday') && matches && (
        <p className="text-xs text-gray-500">{matches.length} Spiele dieses Spieltags werden automatisch als Antwortmöglichkeiten übernommen.</p>
      )}

      {(type === 'total_goals_matchday' || type === 'match_goals') && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-600">Antwortmöglichkeiten (Torintervalle)</label>
          {rangeOptions.map((r, i) => (
            <div key={i} className="flex gap-1.5">
              <input value={r.label} onChange={e => setRangeOptions(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="Label" className="flex-1 text-xs border border-gray-300 rounded px-2 py-1" />
              <input value={r.min} onChange={e => setRangeOptions(prev => prev.map((x, j) => j === i ? { ...x, min: e.target.value } : x))} placeholder="min" type="number" className="w-16 text-xs border border-gray-300 rounded px-2 py-1" />
              <input value={r.max} onChange={e => setRangeOptions(prev => prev.map((x, j) => j === i ? { ...x, max: e.target.value } : x))} placeholder="max" type="number" className="w-16 text-xs border border-gray-300 rounded px-2 py-1" />
            </div>
          ))}
          <button onClick={() => setRangeOptions(prev => [...prev, { label: '', min: '', max: '' }])} className="text-xs text-red-700 font-semibold">+ weitere Option</button>
        </div>
      )}

      {type === 'long_term' && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-600">Antwortmöglichkeiten</label>
          {longTermOptions.map((o, i) => (
            <input key={i} value={o} onChange={e => setLongTermOptions(prev => prev.map((x, j) => j === i ? e.target.value : x))} className="w-full text-xs border border-gray-300 rounded px-2 py-1" placeholder={`Option ${i + 1}`} />
          ))}
          <button onClick={() => setLongTermOptions(prev => [...prev, ''])} className="text-xs text-red-700 font-semibold">+ weitere Option</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-semibold text-gray-600">Tippschluss</label>
          <input type="datetime-local" value={closesAt} onChange={e => setClosesAt(e.target.value)} className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600">Belohnung (Wildis)</label>
          <input type="number" value={reward} onChange={e => setReward(Number(e.target.value))} className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-semibold text-gray-600">Gruppe (optional)</label>
          <input value={groupKey} onChange={e => setGroupKey(e.target.value)} className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5" placeholder="z.B. spieltag-9" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600">Max. Tipps/Nutzer in Gruppe</label>
          <input type="number" value={groupMax} onChange={e => setGroupMax(e.target.value)} className="w-full mt-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5" placeholder="ohne Limit" />
        </div>
      </div>

      <button onClick={submit} disabled={saving} className="w-full py-2.5 bg-red-700 hover:bg-red-800 disabled:bg-red-300 text-white font-semibold rounded-lg text-sm">
        {saving ? 'Wird erstellt…' : 'Bonus-Tipp erstellen'}
      </button>
    </div>
  )
}
