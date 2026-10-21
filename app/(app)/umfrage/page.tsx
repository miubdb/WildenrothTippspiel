'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  SURVEY_SECTIONS, visibleQuestionsForSection, isSectionComplete, isSurveyComplete, isRequired,
  type Answers, type QuestionDef,
} from '@/lib/survey'
import { toggleMultiOption, stripHiddenAnswers } from '@/lib/surveyValidation'

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
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null)
  const [justSubmitted, setJustSubmitted] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const answersRef = useRef<Answers>({})
  useEffect(() => { answersRef.current = answers }, [answers])
  // Serializes save() calls so two requests (e.g. the 900ms debounce firing
  // right as a "Weiter"/"Absenden" click sends its own save) are never truly
  // concurrent — each call waits for the previous one to finish before it
  // even reads answersRef, so the request that reaches the server last also
  // started last and therefore carries the more current (or equally current)
  // answers. This is what actually prevents an in-flight older save from
  // landing after a newer one, not just goNext()'s "cancel the pending timer"
  // trick, which only covers one specific overlap case.
  const saveChain = useRef<Promise<unknown>>(Promise.resolve())

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

  const save = useCallback((action: 'save' | 'submit', nextAnswers?: Answers) => {
    const run = async () => {
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
          setSaveErrorMsg(typeof data.error === 'string' ? data.error : 'Die Antworten konnten gerade nicht gespeichert werden.')
          return { ok: false, error: data.error as string }
        }
        setSaveState('saved')
        // The server decides the ACTUAL resulting submitted-status (never
        // just echoes the requested action) — e.g. a `save` that edits an
        // already-submitted response into an incomplete state comes back
        // with submittedAt: null, and the UI must reflect that immediately,
        // not keep showing "bereits abgegeben" for a response that no
        // longer qualifies. See lib/surveyValidation.ts#nextSubmittedAt.
        setSubmittedAt(data.submittedAt ?? null)
        return { ok: true, submitted: !!data.submitted }
      } catch {
        setSaveState('error')
        setSaveErrorMsg('Netzwerkfehler.')
        return { ok: false, error: 'Netzwerkfehler.' }
      }
    }
    const result = saveChain.current.then(run)
    saveChain.current = result
    return result as Promise<{ ok: boolean; error?: string; submitted?: boolean }>
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
    // stripHiddenAnswers runs on every change (not just at save time) — a
    // trigger answer changing (q4, q12, q25, q29, q_motivation, q9, q19,
    // q20, q23, …) must immediately drop any now-hidden follow-up answer
    // from the ACTIVE in-memory state too, not just from what eventually
    // gets persisted, so the UI never shows (or silently keeps) a stale
    // value for a question that no longer applies.
    setAnswers((a) => stripHiddenAnswers({ ...a, [id]: value }))
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
    // two overlapping POSTs for the same row. (saveChain above additionally
    // guarantees that even if both still fired, they'd never race.)
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
    // submittedAt is already set by save() itself from the server's
    // response — a successful `submit` always comes back with it set
    // (the server re-validates completeness before stamping it).
    if (result.ok && result.submitted) {
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
          <p>Hilf mit, das Wildenroth-Wettspiel zu verbessern! ⚽</p>
          <p>
            Wir möchten wissen, was dir am Wettspiel gefällt, was wir verbessern können und welche
            neuen Funktionen dich interessieren. Die Umfrage dauert ungefähr 10–15 Minuten. Einige
            Fragen sind freiwillig, und je nach Antwort werden nicht alle Fragen angezeigt. Deine
            Rückmeldungen helfen uns bei der Planung der Rückrunde und der kommenden Saison 2027/28.
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700 pt-2">
            Hinweis: Deine Antworten sind für die Administratoren deiner Teilnahme zuordenbar; die
            Umfrage ist nicht anonym.
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
          <span>Bereich {sectionIdx + 1} von {SURVEY_SECTIONS.length} · {section.title}</span>
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
            {saveErrorMsg ?? 'Die Antworten konnten gerade nicht gespeichert werden.'} Bitte versuche es noch einmal.
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
          <QuestionCard key={q.id} q={q} answers={answers} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />
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

function QuestionCard({ q, answers, value, onChange }: { q: QuestionDef; answers: Answers; value: Answers[string]; onChange: (v: Answers[string]) => void }) {
  const required = isRequired(q, answers)
  return (
    <>
      {q.dividerBefore && (
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 pt-2 -mb-1">{q.dividerBefore}</h3>
      )}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm px-4 py-4">
        {q.infoText && (
          <div className="bg-gray-50 dark:bg-gray-700/40 border border-gray-100 dark:border-gray-700 rounded-xl px-3 py-2 mb-3 text-xs text-gray-500 dark:text-gray-400">
            {q.infoText}
          </div>
        )}
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1 flex items-start gap-1.5">
          <span>{q.text}</span>
          {required
            ? <span className="text-red-600 flex-shrink-0">*</span>
            : <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 rounded-full px-1.5 py-0.5 mt-0.5">Freiwillig</span>}
        </div>
        {q.helpText && q.type !== 'freetext' && (
          <p className="text-[12px] text-gray-400 dark:text-gray-500 mb-2.5">{q.helpText}</p>
        )}
        <div className={q.helpText && q.type !== 'freetext' ? '' : 'mt-3'}>
          {q.type === 'scale' && <ScaleInput q={q} value={value as number | undefined} onChange={onChange} />}
          {q.type === 'single' && <SingleChoiceInput q={q} value={value as string | undefined} onChange={onChange} />}
          {q.type === 'multi' && <MultiChoiceInput q={q} value={value as string[] | undefined} onChange={onChange} />}
          {q.type === 'freetext' && <FreetextInput q={q} value={value as string | undefined} onChange={onChange} />}
        </div>
      </div>
    </>
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

function OptionButton({ opt, checked, disabled, onClick, help }: { opt: string; checked: boolean; disabled: boolean; onClick: () => void; help?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-start gap-2.5 text-left px-3 py-2.5 rounded-xl text-sm border transition-colors disabled:opacity-40 ${
        checked
          ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-800 dark:text-red-300 font-semibold'
          : 'bg-gray-50 dark:bg-gray-700/40 border-transparent text-gray-700 dark:text-gray-300 hover:border-gray-200 dark:hover:border-gray-600'
      }`}
    >
      <span className={`w-4 h-4 mt-0.5 rounded flex-shrink-0 border-2 flex items-center justify-center ${checked ? 'bg-red-700 border-red-700' : 'border-gray-300 dark:border-gray-500'}`}>
        {checked && <span className="text-white text-[10px]">✓</span>}
      </span>
      <span>
        <span className="block">{opt}</span>
        {help && <span className="block text-[11px] font-normal text-gray-400 dark:text-gray-500 mt-0.5">{help}</span>}
      </span>
    </button>
  )
}

function MultiChoiceInput({ q, value, onChange }: { q: QuestionDef; value: string[] | undefined; onChange: (v: string[]) => void }) {
  const selected = value ?? []
  const exclusive = new Set(q.exclusiveOptions ?? [])
  const concreteSelectedCount = selected.filter((o) => !exclusive.has(o)).length

  function toggle(opt: string) {
    onChange(toggleMultiOption(q, selected, opt))
  }

  // disabled only ever applies to a NOT-yet-selected, NON-exclusive option
  // once maxSelect concrete picks are already made — an exclusive option
  // (e.g. "Keine dieser Funktionen") must always stay clickable, and
  // deselecting an already-picked option is always allowed.
  function isDisabled(opt: string): boolean {
    if (selected.includes(opt) || exclusive.has(opt)) return false
    return q.maxSelect != null && concreteSelectedCount >= q.maxSelect
  }

  const renderOption = (opt: string) => (
    <OptionButton key={opt} opt={opt} checked={selected.includes(opt)} disabled={isDisabled(opt)} onClick={() => toggle(opt)} help={q.optionHelp?.[opt]} />
  )

  const groupedOptions = new Set(q.optionGroups?.flatMap((g) => g.options) ?? [])
  const ungrouped = (q.options ?? []).filter((o) => !groupedOptions.has(o))

  return (
    <div>
      {q.maxSelect && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1.5">Max. {q.maxSelect} Auswahlmöglichkeiten</p>
      )}
      {q.optionGroups && q.optionGroups.length > 0 ? (
        <div className="space-y-3">
          {q.optionGroups.map((g) => (
            <div key={g.label}>
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1.5">{g.label}</div>
              <div className="space-y-1.5">{g.options.map(renderOption)}</div>
            </div>
          ))}
          {ungrouped.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-gray-100 dark:border-gray-700">{ungrouped.map(renderOption)}</div>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">{(q.options ?? []).map(renderOption)}</div>
      )}
    </div>
  )
}

function FreetextInput({ q, value, onChange }: { q: QuestionDef; value: string | undefined; onChange: (v: string) => void }) {
  return (
    <div>
      <textarea
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Optional…"
        rows={3}
        className="w-full text-sm rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40 px-3 py-2.5 text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
      />
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{q.helpText ?? 'Freiwillig'}</p>
    </div>
  )
}
