'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  SURVEY_SECTIONS, visibleQuestionsForSection, isSectionComplete, isSurveyComplete,
  type Answers, type QuestionDef,
} from '@/lib/survey'

type LoadState = 'loading' | 'ready' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function UmfragePage() {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [surveyMode, setSurveyMode] = useState<string>('hidden')
  const [answers, setAnswers] = useState<Answers>({})
  const [submittedAt, setSubmittedAt] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [sectionIdx, setSectionIdx] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [justSubmitted, setJustSubmitted] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const answersRef = useRef<Answers>({})
  useEffect(() => { answersRef.current = answers }, [answers])

  useEffect(() => {
    fetch('/api/survey')
      .then((r) => r.json())
      .then((data) => {
        setSurveyMode(data.surveyMode ?? 'hidden')
        if (data.response) {
          setAnswers(data.response.answers ?? {})
          setSubmittedAt(data.response.submitted_at ?? null)
          setStarted(true)
        }
        setLoadState('ready')
      })
      .catch(() => setLoadState('error'))
  }, [])

  const save = useCallback(async (action: 'save' | 'submit', nextAnswers?: Answers) => {
    setSaveState('saving')
    try {
      const res = await fetch('/api/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, answers: nextAnswers ?? answersRef.current }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSaveState('error')
        return { ok: false, error: data.error as string }
      }
      setSaveState('saved')
      return { ok: true }
    } catch {
      setSaveState('error')
      return { ok: false, error: 'Netzwerkfehler.' }
    }
  }, [])

  // Debounced autosave on every answer change once the user has started —
  // "no data loss on navigating away" without needing an explicit save click
  // after every single field.
  useEffect(() => {
    if (!started) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { save('save') }, 900)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, started])

  function setAnswer(id: string, value: Answers[string]) {
    setAnswers((a) => ({ ...a, [id]: value }))
  }

  function handleStart() {
    setStarted(true)
  }

  // The app's actual scroll container is <main id="app-main"> (overflow-y-auto),
  // not necessarily window/document — on some engines a flex child with
  // overflow-y-auto doesn't get a bounded height and the window scrolls
  // instead. Reset every possible scroll container (same set as
  // components/ScrollToTopOnNavigate.tsx) so whichever one actually scrolled
  // snaps back to the top when moving between sections.
  function scrollToTop() {
    document.getElementById('app-main')?.scrollTo({ top: 0, behavior: 'smooth' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }

  async function goNext() {
    const section = SURVEY_SECTIONS[sectionIdx]
    if (!isSectionComplete(section, answers)) return
    // Cancel the debounced autosave before firing our own save for this
    // click — without this, a save() from THIS click and the pending
    // 900ms-later debounce timer can both fire (e.g. answering the last
    // question of a section, then clicking "Weiter" within 900ms), sending
    // two overlapping POSTs for the same row.
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    const result = await save('save')
    // Bug found during testing (section 7 → 8): this used to advance the
    // section unconditionally, discarding save()'s result — a failed save
    // (network blip, transient 5xx) silently dropped the user's answers
    // for that section while the UI moved on as if nothing happened. Now
    // the section only advances once the save is confirmed to have
    // succeeded; on failure the user stays put with their answers intact
    // and sees a retry affordance (see saveError below).
    if (!result.ok) return
    if (sectionIdx < SURVEY_SECTIONS.length - 1) {
      setSectionIdx((i) => i + 1)
      scrollToTop()
    }
  }

  function goBack() {
    if (sectionIdx > 0) {
      setSectionIdx((i) => i - 1)
      scrollToTop()
    }
  }

  async function handleSubmit() {
    if (!isSurveyComplete(answers)) return
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    const result = await save('submit')
    if (result.ok) {
      setSubmittedAt(new Date().toISOString())
      setJustSubmitted(true)
    }
    // On failure: stay on the last section with answers intact (state
    // already reflects this — save() only ever mutates saveState, never
    // answers), same as goNext. The error banner below covers retry.
  }

  if (loadState === 'loading') {
    return <div className="px-4 py-8 text-center text-sm text-gray-400">Lädt…</div>
  }
  if (loadState === 'error') {
    return <div className="px-4 py-8 text-center text-sm text-red-500">Umfrage konnte nicht geladen werden.</div>
  }
  if (surveyMode === 'hidden') {
    return (
      <div className="px-4 py-8 text-center text-sm text-gray-400">
        Die Umfrage ist aktuell nicht verfügbar.
      </div>
    )
  }

  if (justSubmitted) {
    return (
      <div className="px-4 py-6 space-y-4">
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-2xl px-5 py-6 text-center">
          <div className="text-3xl mb-2">✅</div>
          <div className="font-bold text-green-800 dark:text-green-300">Danke! Deine Antworten wurden gespeichert.</div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setJustSubmitted(false); setSectionIdx(0) }}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200"
          >
            Antworten ansehen / ändern
          </button>
          <Link
            href="/anleitung"
            className="flex-1 py-2.5 rounded-xl bg-red-700 text-white text-sm font-semibold text-center"
          >
            Zurück zur Hilfe
          </Link>
        </div>
      </div>
    )
  }

  if (!started) {
    return (
      <div className="px-4 py-6 space-y-4">
        <div className="bg-red-700 text-white rounded-2xl px-5 py-4">
          <div className="text-red-200 text-xs font-medium uppercase tracking-wide">SpVgg Wildenroth</div>
          <div className="text-2xl font-black mt-0.5">Umfrage</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm px-5 py-4 text-sm text-gray-600 dark:text-gray-300 space-y-2">
          <p>
            Deine Antworten werden ausschließlich zur Weiterentwicklung des Tippspiels verwendet und
            sind für andere Teilnehmer nicht sichtbar. Freitextangaben sind freiwillig. Die Umfrage
            dauert ungefähr 4–6 Minuten.
          </p>
        </div>
        <button
          onClick={handleStart}
          className="w-full py-3 rounded-xl bg-red-700 hover:bg-red-800 text-white font-bold transition-colors"
        >
          Umfrage starten
        </button>
      </div>
    )
  }

  const section = SURVEY_SECTIONS[sectionIdx]
  const visibleQuestions = visibleQuestionsForSection(section, answers)
  const sectionOk = isSectionComplete(section, answers)
  const isLast = sectionIdx === SURVEY_SECTIONS.length - 1
  const progressPct = ((sectionIdx + 1) / SURVEY_SECTIONS.length) * 100

  return (
    <div className="px-4 py-4 space-y-4 pb-8">
      <div>
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
          <span>Abschnitt {sectionIdx + 1} von {SURVEY_SECTIONS.length} · {section.title}</span>
          <SaveIndicator state={saveState} />
        </div>
        <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
          <div className="h-full bg-red-700 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {submittedAt && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
          Du bearbeitest deine bereits abgegebene Umfrage. Änderungen werden automatisch gespeichert.
        </div>
      )}

      {saveState === 'error' && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 space-y-2">
          <p className="text-sm text-red-700 dark:text-red-300">
            Die Antworten konnten gerade nicht gespeichert werden. Bitte versuche es noch einmal.
          </p>
          <button
            onClick={() => { isLast ? handleSubmit() : goNext() }}
            className="w-full py-2 rounded-lg bg-red-700 hover:bg-red-800 text-white text-sm font-bold transition-colors"
          >
            Erneut versuchen
          </button>
        </div>
      )}

      <div className="space-y-4">
        {visibleQuestions.map((q) => (
          <QuestionCard key={q.id} q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />
        ))}
      </div>

      <div className="flex gap-2 pt-2">
        {sectionIdx > 0 && (
          <button
            onClick={goBack}
            className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200"
          >
            Zurück
          </button>
        )}
        {!isLast ? (
          <button
            onClick={goNext}
            disabled={!sectionOk}
            className="flex-1 py-3 rounded-xl bg-red-700 hover:bg-red-800 disabled:opacity-40 text-white font-bold transition-colors"
          >
            Weiter
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!isSurveyComplete(answers)}
            className="flex-1 py-3 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white font-bold transition-colors"
          >
            {submittedAt ? 'Änderungen absenden' : 'Absenden'}
          </button>
        )}
      </div>
      {!sectionOk && (
        <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
          Bitte beantworte alle Pflichtfragen (*), um fortzufahren.
        </p>
      )}

      <button
        onClick={() => save('save')}
        className="w-full text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 py-1"
      >
        Zwischenspeichern
      </button>
    </div>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'saving') return <span className="text-gray-400">Speichert…</span>
  if (state === 'saved') return <span className="text-green-600 dark:text-green-400">Gespeichert</span>
  if (state === 'error') return <span className="text-red-500">Fehler beim Speichern</span>
  return null
}

function QuestionCard({ q, value, onChange }: { q: QuestionDef; value: Answers[string]; onChange: (v: Answers[string]) => void }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm px-4 py-4">
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
        {q.text}
        {q.required && q.type !== 'freetext' && <span className="text-red-600 ml-1">*</span>}
      </div>
      {q.type === 'scale' && <ScaleInput q={q} value={value as number | undefined} onChange={onChange} />}
      {q.type === 'single' && <SingleChoiceInput q={q} value={value as string | undefined} onChange={onChange} />}
      {q.type === 'multi' && <MultiChoiceInput q={q} value={value as string[] | undefined} onChange={onChange} />}
      {q.type === 'freetext' && <FreetextInput q={q} value={value as string | undefined} onChange={onChange} />}
    </div>
  )
}

function ScaleInput({ q, value, onChange }: { q: QuestionDef; value: number | undefined; onChange: (v: number) => void }) {
  const min = q.scaleMin ?? 1
  const max = q.scaleMax ?? 5
  const nums = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {nums.map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={`w-9 h-9 rounded-lg text-sm font-bold transition-colors ${
              value === n ? 'bg-red-700 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      {(q.scaleMinLabel || q.scaleMaxLabel) && (
        <div className="flex justify-between text-[11px] text-gray-400 dark:text-gray-500 mt-1.5">
          <span>{q.scaleMinLabel}</span>
          <span>{q.scaleMaxLabel}</span>
        </div>
      )}
    </div>
  )
}

function SingleChoiceInput({ q, value, onChange }: { q: QuestionDef; value: string | undefined; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      {(q.options ?? []).map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`w-full text-left px-3 py-2.5 rounded-xl text-sm border transition-colors ${
            value === opt
              ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-800 dark:text-red-300 font-semibold'
              : 'bg-gray-50 dark:bg-gray-700/40 border-transparent text-gray-700 dark:text-gray-300 hover:border-gray-200 dark:hover:border-gray-600'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

function MultiChoiceInput({ q, value, onChange }: { q: QuestionDef; value: string[] | undefined; onChange: (v: string[]) => void }) {
  const selected = value ?? []
  function toggle(opt: string) {
    if (selected.includes(opt)) {
      onChange(selected.filter((o) => o !== opt))
      return
    }
    // Exclusive option (e.g. "würde sich nichts ändern"): selecting it clears
    // every other selection; selecting anything else while it's active
    // drops it first — the two states can never coexist.
    if (q.exclusiveOption && opt === q.exclusiveOption) {
      onChange([opt])
      return
    }
    if (q.maxSelect && selected.length >= q.maxSelect) return
    const withoutExclusive = q.exclusiveOption ? selected.filter((o) => o !== q.exclusiveOption) : selected
    onChange([...withoutExclusive, opt])
  }
  return (
    <div>
      {q.maxSelect && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1.5">Max. {q.maxSelect} Auswahlmöglichkeiten</p>
      )}
      <div className="space-y-1.5">
        {(q.options ?? []).map((opt) => {
          const checked = selected.includes(opt)
          const disabled = !checked && !!q.maxSelect && selected.length >= q.maxSelect
          return (
            <button
              key={opt}
              onClick={() => toggle(opt)}
              disabled={disabled}
              className={`w-full flex items-center gap-2.5 text-left px-3 py-2.5 rounded-xl text-sm border transition-colors disabled:opacity-40 ${
                checked
                  ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-800 dark:text-red-300 font-semibold'
                  : 'bg-gray-50 dark:bg-gray-700/40 border-transparent text-gray-700 dark:text-gray-300 hover:border-gray-200 dark:hover:border-gray-600'
              }`}
            >
              <span className={`w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center ${checked ? 'bg-red-700 border-red-700' : 'border-gray-300 dark:border-gray-500'}`}>
                {checked && <span className="text-white text-[10px]">✓</span>}
              </span>
              {opt}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function FreetextInput({ value, onChange }: { q: QuestionDef; value: string | undefined; onChange: (v: string) => void }) {
  return (
    <div>
      <textarea
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Optional…"
        rows={3}
        className="w-full text-sm rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40 px-3 py-2.5 text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
      />
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Freiwillig</p>
    </div>
  )
}
