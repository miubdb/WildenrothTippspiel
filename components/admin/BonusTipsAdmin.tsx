'use client'

import { useCallback, useEffect, useState } from 'react'
import { BONUS_TIP_TYPE_LABEL, isAutoEvaluable, type BonusTip, type BonusTipType, type BonusTipOption } from '@/lib/bonusTips'
import { Btn, EmptyNote, Field, inputCls, LoadingBlock, Panel, Pill, selectCls, useConfirm } from '@/components/admin/ui'

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

/** `onMessage` ersetzt die frühere eigene `message`-Mini-Leiste (immer blau, egal ob Erfolg
 *  oder Fehler) — läuft jetzt über dieselbe globale Banner-Stelle wie überall sonst im Admin-
 *  Bereich. `remove()` nutzt jetzt `useConfirm()` statt des nativen `confirm()` (auf iPhone
 *  unzuverlässig/inkonsistent gestylt, wie an jeder anderen destruktiven Aktion im Admin-
 *  Bereich bereits behoben). */
export function BonusTipsAdmin({ defaultMatchday, onMessage }: { defaultMatchday?: number | null; onMessage: (m: string | null) => void }) {
  const confirmDialog = useConfirm()
  const [tips, setTips] = useState<AdminTip[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/bonus-tips')
      const json = await res.json()
      if (res.ok) setTips(json.tips)
      else onMessage(`Fehler: ${json.error ?? 'Laden fehlgeschlagen.'}`)
    } catch {
      onMessage('Fehler: Netzwerkfehler.')
    } finally {
      setLoading(false)
    }
  }, [onMessage])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial async data fetch on mount, same pattern used throughout app/admin/page.tsx
    void load()
  }, [load])

  async function evaluate(id: number) {
    onMessage(null)
    try {
      const res = await fetch(`/api/admin/bonus-tips/${id}/evaluate`, { method: 'POST' })
      const json = await res.json()
      if (res.ok) {
        onMessage(`Ausgewertet: ${json.correctCount}/${json.totalAnswers} richtig, ${json.paidCount} Gutschrift(en) neu vergeben.`)
        load()
      } else {
        onMessage(`Fehler: ${json.error}`)
      }
    } catch {
      onMessage('Fehler: Netzwerkfehler.')
    }
  }

  async function setLongTermAnswer(id: number, key: string) {
    onMessage(null)
    const res = await fetch(`/api/admin/bonus-tips/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correct_option_keys: [key] }),
    })
    const json = await res.json()
    if (res.ok) load()
    else onMessage(`Fehler: ${json.error}`)
  }

  async function remove(id: number) {
    if (!(await confirmDialog({ title: 'Diesen Bonus-Tipp wirklich löschen?', confirmLabel: 'Löschen', tone: 'danger' }))) return
    const res = await fetch(`/api/admin/bonus-tips/${id}`, { method: 'DELETE' })
    const json = await res.json()
    if (res.ok) load()
    else onMessage(`Fehler: ${json.error}`)
  }

  if (loading) return <LoadingBlock label="Bonus-Tipps werden geladen …" />

  return (
    <div className="space-y-3">
      <Btn variant="primary" block onClick={() => setShowCreate(v => !v)}>
        {showCreate ? 'Formular schließen' : '+ Neuer Bonus-Tipp'}
      </Btn>

      {showCreate && <CreateForm defaultMatchday={defaultMatchday} onCreated={() => { setShowCreate(false); load() }} onError={onMessage} />}

      <div className="space-y-2">
        {(tips ?? []).length === 0 && <EmptyNote>Noch keine Bonus-Tipps angelegt.</EmptyNote>}
        {(tips ?? []).map(t => {
          const now = new Date()
          const isOpen = now >= new Date(t.opens_at) && now < new Date(t.closes_at)
          const isClosed = now >= new Date(t.closes_at) && !t.evaluated_at
          const auto = isAutoEvaluable(t.type)
          return (
            <Panel key={t.id} className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[15px] font-bold text-gray-900">{t.title}</div>
                  <div className="text-[12px] text-gray-500">{BONUS_TIP_TYPE_LABEL[t.type]} · Tippschluss {fmtDateTime(t.closes_at)}</div>
                </div>
                <Pill tone={t.evaluated_at ? 'success' : isOpen ? 'open' : isClosed ? 'done' : 'info'} className="shrink-0">
                  {t.evaluated_at ? 'Ausgewertet' : isOpen ? 'Offen' : isClosed ? 'Geschlossen' : 'Bevorstehend'}
                </Pill>
              </div>
              <p className="text-[13px] text-gray-600">{t.description}</p>
              <div className="text-[12px] text-gray-500">
                {t.participant_count} Teilnehmer · {t.reward_wildis} Wildis Belohnung
                {t.evaluated_at && <> · {t.correct_answer_count}/{t.participant_count} richtig · {t.wildis_paid_out} Wildis ausgeschüttet</>}
              </div>

              {!t.evaluated_at && !auto && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-[12px] text-gray-500">Korrekte Antwort festlegen:</span>
                  {t.options.map(o => (
                    <button
                      key={o.key}
                      onClick={() => setLongTermAnswer(t.id, o.key)}
                      className={`rounded border px-2 py-1 text-[12px] ${
                        (t.correct_option_keys ?? []).includes(o.key) ? 'border-green-500 bg-green-50 font-semibold text-green-700' : 'border-gray-300 text-gray-600'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                {!t.evaluated_at && (isClosed || !auto) && (
                  <Btn size="sm" variant="primary" disabled={!isClosed} onClick={() => evaluate(t.id)}>
                    Jetzt auswerten
                  </Btn>
                )}
                {!t.evaluated_at && (
                  <Btn size="sm" variant="danger" onClick={() => remove(t.id)}>
                    Löschen
                  </Btn>
                )}
              </div>
            </Panel>
          )
        })}
      </div>
    </div>
  )
}

/** `defaultMatchday` (Admin 3.0): vorbelegt das Spieltag-Feld mit der zentralen Spieltagsauswahl
 *  des Spieltag-Tabs — reiner Komfort-Default, der Admin kann ihn weiterhin ändern. Lädt beim
 *  Öffnen des Formulars direkt die passenden Spiele, wenn der Typ ohnehin einen Spieltag braucht. */
function CreateForm({ defaultMatchday, onCreated, onError }: { defaultMatchday?: number | null; onCreated: () => void; onError: (m: string) => void }) {
  const [type, setType] = useState<BonusTipType>('total_goals_matchday')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [matchday, setMatchday] = useState(defaultMatchday != null ? String(defaultMatchday) : '')
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch for the prefilled default matchday, same pattern used throughout
    if (defaultMatchday != null) void loadMatches(String(defaultMatchday))
    // Nur beim ersten Rendern mit dem Default befüllen — ein manueller Wechsel der
    // Spieltagszahl im Formular läuft weiterhin über loadMatches() direkt im onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    <Panel className="space-y-3 p-4">
      <Field label="Typ">
        <select value={type} onChange={e => setType(e.target.value as BonusTipType)} className={selectCls}>
          {Object.entries(BONUS_TIP_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Titel">
        <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder='z.B. "Torreichstes Spiel Spieltag 9"' />
      </Field>
      <Field label="Frage/Beschreibung">
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className={inputCls} />
      </Field>

      {(needsMatchday || needsSingleMatch) && (
        <Field label="Spieltag">
          <input value={matchday} onChange={e => loadMatches(e.target.value)} type="number" className={inputCls} placeholder="z.B. 9" />
        </Field>
      )}

      {needsSingleMatch && matches && (
        <Field label="Spiel">
          <select value={scopeMatchId ?? ''} onChange={e => setScopeMatchId(Number(e.target.value))} className={selectCls}>
            <option value="">— auswählen —</option>
            {matches.map(m => <option key={m.id} value={m.id}>{m.home} – {m.away}</option>)}
          </select>
        </Field>
      )}

      {(type === 'highest_scoring_match' || type === 'biggest_win_matchday') && matches && (
        <p className="text-[13px] text-gray-600">{matches.length} Spiele dieses Spieltags werden automatisch als Antwortmöglichkeiten übernommen.</p>
      )}

      {(type === 'total_goals_matchday' || type === 'match_goals') && (
        <div className="space-y-1.5">
          <span className="block text-[13px] font-semibold text-gray-700">Antwortmöglichkeiten (Torintervalle)</span>
          {rangeOptions.map((r, i) => (
            <div key={i} className="flex gap-1.5">
              <input value={r.label} onChange={e => setRangeOptions(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="Label" className={`flex-1 ${inputCls}`} />
              <input value={r.min} onChange={e => setRangeOptions(prev => prev.map((x, j) => j === i ? { ...x, min: e.target.value } : x))} placeholder="min" type="number" className={`w-16 ${inputCls}`} />
              <input value={r.max} onChange={e => setRangeOptions(prev => prev.map((x, j) => j === i ? { ...x, max: e.target.value } : x))} placeholder="max" type="number" className={`w-16 ${inputCls}`} />
            </div>
          ))}
          <Btn size="sm" variant="ghost" onClick={() => setRangeOptions(prev => [...prev, { label: '', min: '', max: '' }])}>+ weitere Option</Btn>
        </div>
      )}

      {type === 'long_term' && (
        <div className="space-y-1.5">
          <span className="block text-[13px] font-semibold text-gray-700">Antwortmöglichkeiten</span>
          {longTermOptions.map((o, i) => (
            <input key={i} value={o} onChange={e => setLongTermOptions(prev => prev.map((x, j) => j === i ? e.target.value : x))} className={inputCls} placeholder={`Option ${i + 1}`} />
          ))}
          <Btn size="sm" variant="ghost" onClick={() => setLongTermOptions(prev => [...prev, ''])}>+ weitere Option</Btn>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label="Tippschluss">
          <input type="datetime-local" value={closesAt} onChange={e => setClosesAt(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Belohnung (Wildis)">
          <input type="number" value={reward} onChange={e => setReward(Number(e.target.value))} className={inputCls} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Gruppe (optional)">
          <input value={groupKey} onChange={e => setGroupKey(e.target.value)} className={inputCls} placeholder="z.B. spieltag-9" />
        </Field>
        <Field label="Max. Tipps/Nutzer in Gruppe">
          <input type="number" value={groupMax} onChange={e => setGroupMax(e.target.value)} className={inputCls} placeholder="ohne Limit" />
        </Field>
      </div>

      <Btn variant="primary" block loading={saving} onClick={submit}>
        {saving ? 'Wird erstellt …' : 'Bonus-Tipp erstellen'}
      </Btn>
    </Panel>
  )
}
