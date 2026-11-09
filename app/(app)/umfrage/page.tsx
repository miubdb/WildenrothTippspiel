'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  SURVEY_SECTIONS, visibleQuestionsForSection, isSurveyComplete, isRequired,
  type Answers, type QuestionDef,
} from '@/lib/survey'
import { toggleMultiOption, stripHiddenAnswers } from '@/lib/surveyValidation'

type LoadState = 'loading' | 'ready' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

// The participant UI uses small, focused blocks instead of rendering all 7–11
// questions in a section at once. The underlying section/answer IDs, API,
// validation rules and stored responses are unchanged.
const MAX_QUESTIONS_PER_PAGE = 3
function questionPages(questions: QuestionDef[]): QuestionDef[][] {
  const pages: QuestionDef[][] = []
  let page: QuestionDef[] = []
  const flush = () => { if (page.length) { pages.push(page); page = [] } }
  for (const question of questions) {
    // Long multi-option choices and the feature catalogue need their own
    // screen, so users never see two huge answer lists at once.
    const large = (question.options?.length ?? 0) >= 7 || question.id === 'q_features'
    if (large) flush()
    page.push(question)
    if (large || page.length >= MAX_QUESTIONS_PER_PAGE) flush()
  }
  flush()
  return pages.length ? pages : [[]]
}

function answered(q: QuestionDef, value: Answers[string]): boolean {
  if (q.type === 'multi') return Array.isArray(value) && value.length > 0
  if (q.type === 'scale') return typeof value === 'number' && Number.isFinite(value)
  return typeof value === 'string' && value.trim().length > 0
}

function pageComplete(questions: QuestionDef[], answers: Answers): boolean {
  return questions.every((q) => !isRequired(q, answers) || answered(q, answers[q.id]))
}

// Keep the CURRENT numerical rule easily visible, but make detailed reasoning
// opt-in rather than placing a paragraph above every single question.
const RULE_SUMMARIES: Record<string, string> = {
  q3: 'Aktuell: Montagvormittag',
  q9: 'Was bedeutet „unrealistisch“?',
  q10: 'Aktuell: maximal 250 Wildis',
  q11: 'Aktuell: 2 normale Wettscheine',
  q12: 'Aktuell: 1 Risky-Wette',
  q13: 'Aktuell: Mindestquote 20',
  q_payout_normal: 'Aktuell: Auszahlung bis 10.000 Wildis',
  q_payout_risky: 'Aktuell: Risky-Auszahlung bis 15.000 Wildis',
  q15: 'Aktuell: 10 Wildis Taschengeld',
  q16: 'Aktuell: 50 Wildis Abzug',
  q17: 'Aktuell: nicht gegen die eigene Mannschaft wetten',
  q27: 'Aktuell: alle Kreisliga-Spiele',
  q28: 'Aktuell: Wildenroth II + 1 weiteres Spiel',
  q22: 'Beispiele für Neuigkeiten',
  q23: 'Nur Statistiken in deinem eigenen Profil',
  q4: 'Aktuell kostenlos · Startgeld 2027/28 wird geprüft',
}

export default function UmfragePage() {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [surveyMode, setSurveyMode] = useState<string>('hidden')
  const [answers, setAnswers] = useState<Answers>({})
  const [submittedAt, setSubmittedAt] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [sectionIdx, setSectionIdx] = useState(0)
  const [pageIdx, setPageIdx] = useState(0)
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
    const blocks = questionPages(visibleQuestionsForSection(section, answers))
    const currentBlock = Math.min(pageIdx, blocks.length - 1)
    if (!pageComplete(blocks[currentBlock], answers)) return
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
    if (currentBlock + 1 < blocks.length) {
      setPageIdx(currentBlock + 1)
    } else if (sectionIdx < SURVEY_SECTIONS.length - 1) {
      setSectionIdx((i) => i + 1)
      setPageIdx(0)
    }
    scrollToTop()
  }

  function goBack() {
    if (pageIdx > 0) {
      setPageIdx((i) => i - 1)
    } else if (sectionIdx > 0) {
      const previousSection = SURVEY_SECTIONS[sectionIdx - 1]
      setSectionIdx((i) => i - 1)
      setPageIdx(questionPages(visibleQuestionsForSection(previousSection, answers)).length - 1)
    }
    scrollToTop()
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
            onClick={() => { setJustSubmitted(false); setSectionIdx(0); setPageIdx(0) }}
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
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <span className="text-[12px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-400">Winterumfrage 2026</span>
          <h1 className="mt-2 text-[25px] font-black leading-8 text-gray-900 dark:text-white">Deine Meinung zählt.</h1>
          <p className="mt-2 text-[15px] leading-6 text-gray-600 dark:text-gray-300">
            Was macht Spaß, was nervt – und was sollten wir zur nächsten Saison verbessern?
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-[12px] font-medium text-gray-700 dark:text-gray-200">
            <span className="rounded-full bg-gray-100 px-3 py-1.5 dark:bg-gray-700">Ca. 15 Minuten</span>
            <span className="rounded-full bg-gray-100 px-3 py-1.5 dark:bg-gray-700">7 Themen</span>
            <span className="rounded-full bg-gray-100 px-3 py-1.5 dark:bg-gray-700">Zwischenspeichern möglich</span>
          </div>
        </div>
        <p className="px-1 text-[12px] leading-5 text-gray-500 dark:text-gray-400">
          Die Umfrage ist nicht anonym: Administratoren können deine Antworten deinem Benutzerkonto zuordnen.
        </p>
        <button
          type="button"
          onClick={handleStart}
          className="min-h-[52px] w-full rounded-xl bg-sky-700 px-4 py-3 text-[15px] font-bold text-white transition-colors hover:bg-sky-800"
        >
          Umfrage starten
        </button>
      </div>
    )
  }

  const section = SURVEY_SECTIONS[sectionIdx]
  const visibleQuestions = visibleQuestionsForSection(section, answers)
  const blocks = questionPages(visibleQuestions)
  const activeBlock = Math.min(pageIdx, blocks.length - 1)
  const currentQuestions = blocks[activeBlock]
  const blockOk = pageComplete(currentQuestions, answers)
  const onLastBlock = activeBlock === blocks.length - 1
  const isLast = sectionIdx === SURVEY_SECTIONS.length - 1 && onLastBlock
  const progressPct = (sectionIdx + (activeBlock + 1) / blocks.length) / SURVEY_SECTIONS.length * 100

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-3 py-4 pb-8 sm:px-4">
      <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[12px] text-gray-500 dark:text-gray-400">
          <span>Bereich {sectionIdx + 1} von {SURVEY_SECTIONS.length}</span>
          <SaveIndicator state={saveState} />
        </div>
        <h1 className="mb-2 text-[18px] font-bold leading-6 text-gray-900 dark:text-gray-100">{section.title}</h1>
        <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700" role="progressbar" aria-valuenow={Math.round(progressPct)} aria-valuemin={0} aria-valuemax={100} aria-label="Umfragefortschritt">
          <div className="h-full rounded-full bg-sky-600 transition-all dark:bg-sky-500" style={{ width: `${progressPct}%` }} />
        </div>
        <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">Schritt {activeBlock + 1} von {blocks.length} in diesem Bereich</p>
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

      <div className="space-y-3">
        {currentQuestions.map((q) => (
          <QuestionCard key={q.id} q={q} answers={answers} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />
        ))}
      </div>

      <div className="flex gap-2 pt-2">
        {(sectionIdx > 0 || activeBlock > 0) && (
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
            disabled={!blockOk}
            className="flex-1 py-3 rounded-xl bg-sky-700 hover:bg-sky-800 disabled:opacity-40 text-white font-bold transition-colors"
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
      {!blockOk && (
        <p className="text-center text-xs text-gray-500 dark:text-gray-400">
          Bitte beantworte die Pflichtfragen auf dieser Seite, um fortzufahren.
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
  const collapsible = q.type === 'freetext' && ['q_technical_feedback', 'q26', 'q_features_text'].includes(q.id)
  const [expanded, setExpanded] = useState(() => typeof value === 'string' && value.trim().length > 0)
  const hasText = typeof value === 'string' && value.trim().length > 0
  // A collapsed optional field should look like a small invitation, not like
  // another full unanswered question demanding the participant's attention.
  if (collapsible && !expanded) {
    return (
      <button type="button" onClick={() => setExpanded(true)} className="flex min-h-[48px] w-full items-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-left text-[13px] font-medium leading-5 text-gray-600 hover:border-sky-400 hover:text-sky-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300">
        <span className="text-lg leading-none text-sky-700 dark:text-sky-400" aria-hidden="true">+</span>
        <span>{hasText ? 'Anmerkung bearbeiten' : q.text}</span>
        <span className="ml-auto shrink-0 text-[11px] text-gray-400">{hasText ? 'Gespeichert' : 'Optional'}</span>
      </button>
    )
  }
  return (
    <>
      {q.dividerBefore && (
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 pt-2 -mb-1">{q.dividerBefore}</h3>
      )}
      <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:px-5">
        <div className="mb-3">
          <div className="mb-1 flex items-start gap-2">
            <h2 id={`question-${q.id}`} className="min-w-0 flex-1 text-[16px] font-semibold leading-6 text-gray-900 dark:text-gray-100">{q.text}</h2>
            {!required && <span className="mt-1 shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-400">Optional</span>}
          </div>
          {q.infoText && (
            <details className="group mt-2 rounded-lg bg-sky-50/60 px-3 py-2 text-[12px] text-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-1.5"><span aria-hidden="true">ⓘ</span>{RULE_SUMMARIES[q.id] ?? 'Hinweis zur Frage'}</span>
                <span className="shrink-0 text-[11px] text-sky-700 group-open:hidden dark:text-sky-300">Details</span>
                <span className="hidden shrink-0 text-[11px] text-sky-700 group-open:inline dark:text-sky-300">Schließen</span>
              </summary>
              <p className="mt-2 border-t border-sky-100 pt-2 leading-5 dark:border-sky-900">{q.infoText}</p>
            </details>
          )}
          {q.helpText && q.type !== 'freetext' && (
            <p className="mt-2 text-[12px] leading-5 text-gray-500 dark:text-gray-400">{q.helpText}</p>
          )}
        </div>
        <div>
          {q.type === 'scale' && <ScaleInput q={q} value={value as number | undefined} onChange={onChange} />}
          {q.type === 'single' && <SingleChoiceInput q={q} value={value as string | undefined} onChange={onChange} />}
          {q.type === 'multi' && <MultiChoiceInput q={q} value={value as string[] | undefined} onChange={onChange} />}
          {q.type === 'freetext' && <FreetextInput q={q} value={value as string | undefined} onChange={onChange} />}
          {collapsible && <button type="button" onClick={() => setExpanded(false)} className="mt-2 text-[12px] font-medium text-sky-700 dark:text-sky-400">Anmerkung einklappen</button>}
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
      <div className={`grid gap-1.5 ${nums.length > 5 ? 'grid-cols-5 sm:grid-cols-10' : 'grid-cols-5'}`}>
        {nums.map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            type="button"
            aria-pressed={value === n}
            className={`min-h-[42px] rounded-lg text-sm font-bold transition-colors ${
              value === n ? 'bg-sky-700 text-white dark:bg-sky-500 dark:text-gray-950' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
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
  const compact = ['q5', 'q10', 'q11', 'q13', 'q15', 'q16', 'q_payout_normal', 'q_payout_risky'].includes(q.id)
  return (
    <div className={compact ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1 gap-2'}>
      {(q.options ?? []).map((opt) => (
        <button
          type="button"
          key={opt}
          aria-pressed={value === opt}
          onClick={() => onChange(opt)}
          className={`flex min-h-[46px] items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[13px] leading-5 transition-colors ${value === opt
            ? 'border-sky-600 bg-sky-50 font-semibold text-sky-950 dark:border-sky-400 dark:bg-sky-900/30 dark:text-sky-100'
            : 'border-gray-200 bg-white text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:bg-gray-700/30 dark:text-gray-200'}`}
        >
          <span aria-hidden="true" className={`flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border-2 ${value === opt ? 'border-sky-700 dark:border-sky-400' : 'border-gray-300 dark:border-gray-500'}`}>
            {value === opt && <span className="h-[7px] w-[7px] rounded-full bg-sky-700 dark:bg-sky-400" />}
          </span>
          <span>{opt}</span>
        </button>
      ))}
    </div>
  )
}

function OptionButton({ opt, checked, disabled, onClick, help }: { opt: string; checked: boolean; disabled: boolean; onClick: () => void; help?: string }) {
  const [showHelp, setShowHelp] = useState(false)
  return (
    <div className={`rounded-xl border transition-colors ${checked
      ? 'border-sky-600 bg-sky-50 text-sky-950 dark:border-sky-400 dark:bg-sky-900/30 dark:text-sky-100'
      : 'border-gray-200 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-700/30 dark:text-gray-200'}`}>
      <div className="flex min-h-[46px] items-center">
        <button type="button" onClick={onClick} disabled={disabled} aria-pressed={checked}
          className="flex min-h-[46px] min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left text-[13px] leading-5 disabled:opacity-40">
          <span aria-hidden="true" className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border-2 ${checked ? 'border-sky-700 bg-sky-700 text-white dark:border-sky-400 dark:bg-sky-500 dark:text-gray-950' : 'border-gray-300 dark:border-gray-500'}`}>
            {checked && <span className="text-[12px] leading-none">✓</span>}
          </span>
          <span className={checked ? 'font-semibold' : ''}>{opt}</span>
        </button>
        {help && (
          <button type="button" aria-label={`Erklärung zu ${opt}`} aria-expanded={showHelp}
            onClick={() => setShowHelp((show) => !show)}
            className="mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[16px] font-bold text-sky-700 hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-900/30">
            ⓘ
          </button>
        )}
      </div>
      {help && showHelp && <p className="border-t border-sky-100 px-3 py-2 text-[12px] font-normal leading-5 text-gray-600 dark:border-gray-600 dark:text-gray-300">{help}</p>}
    </div>
  )
}

function MultiChoiceInput({ q, value, onChange }: { q: QuestionDef; value: string[] | undefined; onChange: (v: string[]) => void }) {
  const selected = value ?? []
  const exclusive = new Set(q.exclusiveOptions ?? [])
  const concreteSelectedCount = selected.filter((o) => !exclusive.has(o)).length
  const [activeGroup, setActiveGroup] = useState(q.optionGroups?.[0]?.label ?? '')

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
        <p className="mb-2 text-[12px] font-semibold text-gray-600 dark:text-gray-300">
          {q.id === 'q_features'
            ? `${concreteSelectedCount} von ${q.maxSelect} Ideen ausgewählt`
            : `Bis zu ${q.maxSelect} auswählen`}
        </p>
      )}
      {q.optionGroups && q.optionGroups.length > 0 ? (
        <div>
          <div className="mb-3 grid grid-cols-3 gap-1.5" role="group" aria-label="Feature-Kategorien">
            {q.optionGroups.map((g) => (
              <button key={g.label} type="button" aria-pressed={activeGroup === g.label}
                onClick={() => setActiveGroup(g.label)}
                className={`min-h-[48px] rounded-lg border px-2 py-2 text-center text-[11px] font-semibold leading-4 ${activeGroup === g.label
                  ? 'border-sky-600 bg-sky-50 text-sky-900 dark:border-sky-400 dark:bg-sky-900/30 dark:text-sky-100'
                  : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-700/30 dark:text-gray-300'}`}>
                {g.label}
                {selected.filter((o) => g.options.includes(o)).length > 0 && (
                  <span className="ml-1 text-sky-700 dark:text-sky-300">({selected.filter((o) => g.options.includes(o)).length})</span>
                )}
              </button>
            ))}
          </div>
          <div className="space-y-2">{(q.optionGroups.find((g) => g.label === activeGroup) ?? q.optionGroups[0]).options.map(renderOption)}</div>
          {ungrouped.length > 0 && (
            <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 dark:border-gray-700">{ungrouped.map(renderOption)}</div>
          )}
          <p className="mt-2 text-[11px] leading-4 text-gray-500 dark:text-gray-400">Du kannst zwischen den Kategorien wechseln. Deine Auswahl bleibt erhalten.</p>
        </div>
      ) : (
        <div className="space-y-2">{(q.options ?? []).map(renderOption)}</div>
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
        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[16px] text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-300 dark:border-gray-600 dark:bg-gray-700/40 dark:text-gray-200 dark:placeholder-gray-500 resize-y"
      />
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{q.helpText ?? 'Freiwillig'}</p>
    </div>
  )
}
