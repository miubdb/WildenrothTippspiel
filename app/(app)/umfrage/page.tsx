'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  SURVEY_SECTIONS, visibleQuestionsForSection, isSectionComplete, isSurveyComplete, isRequired, surveyProgress,
  type Answers, type QuestionDef,
} from '@/lib/survey'
import { toggleMultiOption, stripHiddenAnswers, normalizeLegacySurveyAnswers, wouldReplaceSurveySelection } from '@/lib/surveyValidation'
import { questionPages, pageComplete } from '@/lib/surveyPresentation'
import { advanceSurveyActivity, freshActivityClock, noteSurveyInteraction, resumeSurveyActivity, SURVEY_HEARTBEAT_MS } from '@/lib/surveyActivity'

type LoadState = 'loading' | 'ready' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

// Keep the CURRENT numerical rule easily visible, but make detailed reasoning
// opt-in rather than placing a paragraph above every single question.
const RULE_SUMMARIES: Record<string, string> = {
  q3: 'Aktuell: Montagvormittag',
  q9: 'Was bedeutet „unrealistisch“?',
  q10: 'Aktuell: maximal 250 Wildis',
  q15_zero: 'Nur bei Abschaffung des Taschengelds',
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
  q4: 'Aktuell kostenlos · nur eine Interessenabfrage',
}

export default function UmfragePage() {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [surveyMode, setSurveyMode] = useState<string>('hidden')
  const [answers, setAnswers] = useState<Answers>({})
  const [submittedAt, setSubmittedAt] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [sectionIdx, setSectionIdx] = useState(0)
  const [pageIdx, setPageIdx] = useState(0)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const positionRef = useRef({ sectionIdx: 0, pageIdx: 0 })
  const scrollToQuestionRef = useRef<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null)
  const [justSubmitted, setJustSubmitted] = useState(false)
  const [paused, setPaused] = useState(false)
  const [pauseSaving, setPauseSaving] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Reopening a saved V2 answer may require new questions to be answered.
  // Never auto-write the migrated draft on GET (which could silently reset
  // a previous submitted timestamp before the participant touches anything).
  const saveEnabled = useRef(false)
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
  // This method belongs to the currently-active browser-tab session.
  // It is independent of answer autosaving and remains best-effort if
  // the user closes their tab while a request is in flight.
  const flushActiveTimeRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    fetch('/api/survey')
      .then((r) => r.json())
      .then((data) => {
        setSurveyMode(data.surveyMode ?? 'hidden')
        if (data.response) {
          const resumedAnswers = normalizeLegacySurveyAnswers(data.response.answers ?? {})
          answersRef.current = resumedAnswers
          setAnswers(resumedAnswers)
          const validSubmitted = isSurveyComplete(resumedAnswers) && !!data.response.submitted_at
          setSubmittedAt(validSubmitted ? data.response.submitted_at : null)
          if (validSubmitted) setJustSubmitted(true)
          const restoredSection = SURVEY_SECTIONS.findIndex((section) => section.id === data.response.last_section_id)
          if (restoredSection >= 0) {
            const pageCount = questionPages(visibleQuestionsForSection(SURVEY_SECTIONS[restoredSection], resumedAnswers)).length
            const requestedPage = Number.isInteger(data.response.last_page_idx) ? data.response.last_page_idx : 0
            const restoredPage = Math.max(0, Math.min(requestedPage, pageCount - 1))
            positionRef.current = { sectionIdx: restoredSection, pageIdx: restoredPage }
            setSectionIdx(restoredSection)
            setPageIdx(restoredPage)
          }
          setStarted(true)
        }
        setLoadState('ready')
      })
      .catch(() => setLoadState('error'))
  }, [])

  const save = useCallback((action: 'save' | 'submit', nextAnswers?: Answers, target?: { sectionId: number; pageIdx: number }) => {
    const run = async () => {
      setSaveState('saving')
      try {
        const res = await fetch('/api/survey', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, answers: nextAnswers ?? answersRef.current, lastSectionId: target?.sectionId ?? SURVEY_SECTIONS[positionRef.current.sectionIdx].id, lastPageIdx: target?.pageIdx ?? positionRef.current.pageIdx }),
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
    if (!started || !saveEnabled.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { save('save') }, 900)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, started])

  // Track ACTIVE survey time only, not elapsed time between first visit and
  // submission. A unique session id per mount makes resumed visits additive;
  // periodic cumulative reports are idempotent on the server.
  useEffect(() => {
    const tracking = loadState === 'ready' && started && !paused && surveyMode !== 'hidden' && !submittedAt && !justSubmitted
    if (!tracking) return

    const sessionId = crypto.randomUUID()
    // iOS PWA can report hasFocus() = false even while the visible page
    // is being used; the actual visibility/blur events handle backgrounding.
    let visible = document.visibilityState === 'visible'
    let clock = freshActivityClock(performance.now())
    let lastSentMs = 0

    const tick = () => {
      clock = advanceSurveyActivity(clock, performance.now(), visible)
    }
    const send = async (leaving = false): Promise<void> => {
      const activeMs = Math.floor(clock.activeMs / 1000) * 1000
      if (activeMs <= lastSentMs) return
      const previous = lastSentMs
      lastSentMs = activeMs
      const body = JSON.stringify({ sessionId, activeMs })
      if (leaving && navigator.sendBeacon) {
        const accepted = navigator.sendBeacon('/api/survey/activity', new Blob([body], { type: 'application/json' }))
        if (accepted) return
      }
      try {
        const response = await fetch('/api/survey/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          keepalive: leaving,
          body,
        })
        if (!response.ok) lastSentMs = Math.min(previous, lastSentMs)
      } catch {
        lastSentMs = Math.min(previous, lastSentMs)
      }
    }
    const interact = () => {
      if (visible) clock = noteSurveyInteraction(clock, performance.now(), true)
    }
    const hide = () => {
      tick()
      visible = false
      void send(true)
    }
    const resume = () => {
      visible = document.visibilityState === 'visible'
      clock = resumeSurveyActivity(clock, performance.now())
    }
    const visibility = () => {
      if (document.visibilityState === 'hidden') hide()
      else resume()
    }
    const focus = () => resume()
    const blur = () => hide()
    const pageHide = () => hide()
    const heartbeat = window.setInterval(() => {
      tick()
      if (visible) void send()
    }, SURVEY_HEARTBEAT_MS)

    window.addEventListener('pointerdown', interact, { passive: true })
    window.addEventListener('keydown', interact)
    window.addEventListener('scroll', interact, { passive: true, capture: true })
    window.addEventListener('touchstart', interact, { passive: true })
    window.addEventListener('focus', focus)
    window.addEventListener('blur', blur)
    window.addEventListener('pagehide', pageHide)
    document.addEventListener('visibilitychange', visibility)
    flushActiveTimeRef.current = async () => { tick(); await send() }

    return () => {
      window.clearInterval(heartbeat)
      window.removeEventListener('pointerdown', interact)
      window.removeEventListener('keydown', interact)
      window.removeEventListener('scroll', interact, true)
      window.removeEventListener('touchstart', interact)
      window.removeEventListener('focus', focus)
      window.removeEventListener('blur', blur)
      window.removeEventListener('pagehide', pageHide)
      document.removeEventListener('visibilitychange', visibility)
      tick()
      void send(true)
      flushActiveTimeRef.current = async () => {}
    }
  }, [loadState, started, paused, surveyMode, submittedAt, justSubmitted])

  // React navigation does not change the pathname, so the app's global
  // ScrollToTopOnNavigate never runs. Reset AFTER the next question page has
  // committed, rather than before setPageIdx/setSectionIdx takes effect.
  // iOS Safari/PWA can scroll either #app-main or the window; do both, and
  // reinforce after layout/paint to beat browser scroll anchoring.
  useLayoutEffect(() => {
    if (!started || loadState !== 'ready') return
    const reset = () => {
      const container = document.getElementById('app-main')
      if (container) {
        container.scrollTop = 0
        container.scrollTo({ top: 0, behavior: 'instant' })
      }
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
    reset()
    let second = 0
    const first = requestAnimationFrame(() => {
      reset()
      second = requestAnimationFrame(reset)
    })
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
  }, [loadState, started, sectionIdx, pageIdx, paused, justSubmitted])

  function setAnswer(id: string, value: Answers[string]) {
    saveEnabled.current = true
    // stripHiddenAnswers runs on every change (not just at save time) — a
    // trigger answer changing (q4, q12, q25, q29, q_motivation, q9, q19, q15, q10,
    // q20, q23, …) must immediately drop any now-hidden follow-up answer
    // from the ACTIVE in-memory state too, not just from what eventually
    // gets persisted, so the UI never shows (or silently keeps) a stale
    // value for a question that no longer applies.
    const nextAnswers = stripHiddenAnswers({ ...answersRef.current, [id]: value })
    answersRef.current = nextAnswers
    setAnswers(nextAnswers)
  }

  function handleStart() {
    saveEnabled.current = true
    setStarted(true)
  }

  // Save the destination together with answers so a reopened survey can
  // resume on the precise step, even on another device. Jumping does not
  // bypass server-side required-question validation on submission.
  async function goToPosition(targetSection: number, targetPage: number, questionId?: string) {
    if (targetSection < 0 || targetSection >= SURVEY_SECTIONS.length) return
    const targetPages = questionPages(visibleQuestionsForSection(SURVEY_SECTIONS[targetSection], answersRef.current))
    if (targetPage < 0 || targetPage >= targetPages.length) return
    if (targetSection === sectionIdx && targetPage === pageIdx) {
      setNavigationOpen(false)
      if (questionId) document.getElementById(`question-${questionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    const result = await save('save', undefined, { sectionId: SURVEY_SECTIONS[targetSection].id, pageIdx: targetPage })
    if (!result.ok) return
    void flushActiveTimeRef.current()
    positionRef.current = { sectionIdx: targetSection, pageIdx: targetPage }
    scrollToQuestionRef.current = questionId ?? null
    setSectionIdx(targetSection)
    setPageIdx(targetPage)
    setNavigationOpen(false)
  }

  useEffect(() => {
    const questionId = scrollToQuestionRef.current
    if (!questionId) return
    scrollToQuestionRef.current = null
    // The existing iOS scroll-reset effect runs over two paint frames.
    // Jump to the requested question after that reset settles.
    const timer = window.setTimeout(() => document.getElementById(`question-${questionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 180)
    return () => window.clearTimeout(timer)
  }, [sectionIdx, pageIdx])

  async function goNext() {
    const section = SURVEY_SECTIONS[sectionIdx]
    const blocks = questionPages(visibleQuestionsForSection(section, answers))
    const currentBlock = Math.min(pageIdx, blocks.length - 1)
    if (!pageComplete(blocks[currentBlock], answers)) return
    if (currentBlock + 1 < blocks.length) {
      await goToPosition(sectionIdx, currentBlock + 1)
    } else if (sectionIdx < SURVEY_SECTIONS.length - 1) {
      await goToPosition(sectionIdx + 1, 0)
    }
  }

  async function goBack() {
    if (pageIdx > 0) {
      await goToPosition(sectionIdx, pageIdx - 1)
    } else if (sectionIdx > 0) {
      const previousSection = SURVEY_SECTIONS[sectionIdx - 1]
      const previousPage = questionPages(visibleQuestionsForSection(previousSection, answers)).length - 1
      await goToPosition(sectionIdx - 1, previousPage)
    }
  }

  async function saveAndPause() {
    if (pauseSaving) return
    setPauseSaving(true)
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    await flushActiveTimeRef.current()
    // Saving is explicitly acknowledged only after the server confirms
    // the full answer set. Automatic background saves remain unchanged.
    const result = await save('save')
    if (result.ok) setPaused(true)
    setPauseSaving(false)
  }

  async function handleSubmit() {
    if (!isSurveyComplete(answers)) {
      for (let idx = 0; idx < SURVEY_SECTIONS.length; idx++) {
        const pages = questionPages(visibleQuestionsForSection(SURVEY_SECTIONS[idx], answers))
        const missingPage = pages.findIndex((questions) => !pageComplete(questions, answers))
        if (missingPage >= 0) {
          await goToPosition(idx, missingPage)
          return
        }
      }
      return
    }
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    // Record the last active seconds BEFORE submission stops the timer.
    await flushActiveTimeRef.current()
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
            onClick={() => { setJustSubmitted(false); setSectionIdx(0); setPageIdx(0); positionRef.current = { sectionIdx: 0, pageIdx: 0 } }}
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

  if (paused) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <div role="status" className="rounded-2xl border border-green-200 bg-green-50 px-5 py-6 text-center dark:border-green-800 dark:bg-green-950/30">
          <div className="mb-2 text-3xl" aria-hidden="true">✅</div>
          <h1 className="text-xl font-bold text-green-900 dark:text-green-200">Zwischenstand gespeichert!</h1>
          <p className="mt-2 text-sm leading-6 text-green-800 dark:text-green-300">
            Du kannst jederzeit weitermachen, auch wenn du die App jetzt schließt.
            {submittedAt ? 'Deine bereits abgegebene Umfrage bleibt gespeichert. Du kannst weitere Änderungen später fortsetzen.' : 'Deine Umfrage ist damit noch nicht abgeschickt.'}
          </p>
        </div>
        <button type="button" onClick={() => setPaused(false)}
          className="min-h-[48px] w-full rounded-xl bg-red-700 px-4 py-3 text-sm font-bold text-white hover:bg-red-800">
          Umfrage fortsetzen
        </button>
        <Link href="/anleitung"
          className="flex min-h-[48px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100">
          Zurück zur Hilfe
        </Link>
      </div>
    )
  }

  if (!started) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <span className="text-[12px] font-bold uppercase tracking-wide text-red-700 dark:text-red-400">Winterumfrage 2026</span>
          <h1 className="mt-2 text-[25px] font-black leading-8 text-gray-900 dark:text-white">Deine Meinung zählt.</h1>
          <p className="mt-2 text-[15px] leading-6 text-gray-600 dark:text-gray-300">
            Was macht Spaß, was nervt – und was sollten wir zur nächsten Saison verbessern?
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-[12px] font-medium text-gray-700 dark:text-gray-200">
            <span className="rounded-full bg-gray-100 px-3 py-1.5 dark:bg-gray-700">Ca. 10–15 Minuten</span>
            <span className="rounded-full bg-gray-100 px-3 py-1.5 dark:bg-gray-700">7 Themen</span>
            <span className="rounded-full bg-gray-100 px-3 py-1.5 dark:bg-gray-700">Zwischenspeichern möglich</span>
          </div>
        </div>
        <p className="px-1 text-[12px] leading-5 text-gray-500 dark:text-gray-400">
          Deine ehrliche Meinung hilft uns, das Tippspiel besser zu machen – Kritik ist ausdrücklich willkommen! 😉 Admins können deine Antworten deinem Benutzerkonto zuordnen.
        </p>
        <button
          type="button"
          onClick={handleStart}
          className="min-h-[52px] w-full rounded-xl bg-red-700 px-4 py-3 text-[15px] font-bold text-white transition-colors hover:bg-red-800"
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
  const progress = surveyProgress(answers)
  const progressPct = progress.percent

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-3 py-4 pb-8 sm:px-4">
      <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <div>
            <div className="text-[12px] text-gray-500 dark:text-gray-400">Bereich {sectionIdx + 1} von {SURVEY_SECTIONS.length}</div>
            <h1 className="mt-1 text-[18px] font-bold leading-6 text-gray-900 dark:text-gray-100">{section.title}</h1>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-lg font-black tabular-nums text-red-700 dark:text-red-300">{progressPct} %</div>
            <SaveIndicator state={saveState} />
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100} aria-label="Beantwortete Pflichtfragen">
          <div className="h-full rounded-full bg-red-600 transition-all dark:bg-red-500" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-gray-400">
          <span>Schritt {activeBlock + 1} von {blocks.length} · {progress.answered}/{progress.total} Pflichtfragen</span>
          <button type="button" aria-expanded={navigationOpen} aria-controls="survey-jump-navigation" onClick={() => setNavigationOpen((open) => !open)} className="font-bold text-red-700 dark:text-red-300">Bereiche & Fragen {navigationOpen ? '▲' : '▼'}</button>
        </div>
        {navigationOpen && (
          <nav id="survey-jump-navigation" aria-label="Umfrage-Navigation" className="mt-2 max-h-80 space-y-1 overflow-y-auto rounded-xl border border-gray-200 p-2 dark:border-gray-700">
            {SURVEY_SECTIONS.map((surveySection, idx) => {
              const sectionPages = questionPages(visibleQuestionsForSection(surveySection, answers))
              return (
                <div key={surveySection.id}>
                  <button type="button" onClick={() => goToPosition(idx, 0)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-xs ${idx === sectionIdx ? 'bg-red-50 font-bold text-red-800 dark:bg-red-900/20 dark:text-red-200' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700'}`}>
                    <span>{idx + 1}. {surveySection.title}</span><span className="shrink-0">{isSectionComplete(surveySection, answers) ? '✓' : 'Offen'}</span>
                  </button>
                  {idx === sectionIdx && sectionPages.map((questions, page) => (
                    <div key={page} className="ml-3 border-l-2 border-red-100 pl-2 dark:border-red-900/30">
                      <div className="py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Schritt {page + 1} von {sectionPages.length}</div>
                      {questions.map((question) => (
                        <button key={question.id} type="button" onClick={() => goToPosition(idx, page, question.id)} className={`block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-700 ${page === activeBlock ? 'text-red-700 dark:text-red-300' : 'text-gray-600 dark:text-gray-300'}`}>{question.text}</button>
                      ))}
                    </div>
                  ))}
                </div>
              )
            })}
          </nav>
        )}
      </div>

      {submittedAt && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
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
            className="flex-1 py-3 rounded-xl bg-red-700 hover:bg-red-800 disabled:opacity-40 text-white font-bold transition-colors"
          >
            Weiter
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            className="flex-1 py-3 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold transition-colors"
          >
            {!isSurveyComplete(answers) ? 'Offene Pflichtfragen finden' : submittedAt ? 'Änderungen absenden' : 'Absenden'}
          </button>
        )}
      </div>
      {!blockOk && (
        <p className="text-center text-xs text-gray-500 dark:text-gray-400">
          Bitte beantworte die Pflichtfragen auf dieser Seite, um fortzufahren.
        </p>
      )}

      <button type="button" onClick={saveAndPause} disabled={pauseSaving}
        className="min-h-[48px] w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-800 transition-colors hover:border-red-500 hover:bg-red-50 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
      >
        {pauseSaving ? 'Speichert…' : 'Speichern & später fortsetzen'}
      </button>
      <p className="text-center text-[12px] text-gray-500 dark:text-gray-400">
        Deine Antworten werden auch beim Ausfüllen automatisch gespeichert.
      </p>
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
  const collapsible = q.type === 'freetext' && ['q_technical_feedback', 'q26', 'q_features_text', 'q15_zero_text', 'q25_text'].includes(q.id)
  const forceExpanded = q.id === 'q15_zero_text' && answers.q15_zero === 'Andere Lösung'
  const [expanded, setExpanded] = useState(() => typeof value === 'string' && value.trim().length > 0)
  const hasText = typeof value === 'string' && value.trim().length > 0
  // A collapsed optional field should look like a small invitation, not like
  // another full unanswered question demanding the participant's attention.
  if (collapsible && !expanded && !forceExpanded) {
    return (
      <button type="button" onClick={() => setExpanded(true)} className="flex min-h-[48px] w-full items-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-left text-[13px] font-medium leading-5 text-gray-600 hover:border-red-400 hover:text-red-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300">
        <span className="text-lg leading-none text-red-700 dark:text-red-400" aria-hidden="true">+</span>
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
            <span className="mt-1 shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-400">{required ? 'Pflicht' : 'Optional'}</span>
          </div>
          {q.infoText && (
            <details className="group mt-2 rounded-lg bg-red-50/60 px-3 py-2 text-[12px] text-red-900 dark:bg-red-950/30 dark:text-red-200">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-1.5"><span aria-hidden="true">ⓘ</span>{RULE_SUMMARIES[q.id] ?? 'Hinweis zur Frage'}</span>
                <span className="shrink-0 text-[11px] text-red-700 group-open:hidden dark:text-red-300">Details</span>
                <span className="hidden shrink-0 text-[11px] text-red-700 group-open:inline dark:text-red-300">Schließen</span>
              </summary>
              <p className="mt-2 border-t border-red-100 pt-2 leading-5 dark:border-red-900">{q.infoText}</p>
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
          {q.type === 'freetext' && (q.inputMode === 'positive-integer'
            ? <PositiveStakeInput value={value as string | undefined} onChange={onChange} />
            : <FreetextInput q={q} value={value as string | undefined} onChange={onChange} />)}
          {collapsible && !forceExpanded && <button type="button" onClick={() => setExpanded(false)} className="mt-2 text-[12px] font-medium text-red-700 dark:text-red-400">Anmerkung einklappen</button>}
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
      {(q.scaleMinLabel || q.scaleMaxLabel) && (
        <div className="mb-3 grid grid-cols-2 gap-x-4 rounded-lg bg-gray-50 px-3 py-2.5 text-[13px] leading-5 text-gray-800 dark:bg-gray-700/50 dark:text-gray-100">
          <span><strong className="font-bold text-gray-950 dark:text-white">{min} = </strong>{q.scaleMinLabel}</span>
          <span className="text-right"><strong className="font-bold text-gray-950 dark:text-white">{max} = </strong>{q.scaleMaxLabel}</span>
        </div>
      )}
      <div className={`grid gap-1.5 ${nums.length > 5 ? 'grid-cols-5 sm:grid-cols-10' : 'grid-cols-5'}`}>
        {nums.map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            type="button"
            aria-pressed={value === n}
            className={`min-h-[42px] rounded-lg text-sm font-bold transition-colors ${
              value === n ? 'bg-red-700 text-white dark:bg-red-500 dark:text-gray-950' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {n}
          </button>
        ))}
      </div>

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
            ? 'border-red-600 bg-red-50 font-semibold text-red-950 dark:border-red-400 dark:bg-red-900/30 dark:text-red-100'
            : 'border-gray-200 bg-white text-gray-700 hover:border-red-300 dark:border-gray-600 dark:bg-gray-700/30 dark:text-gray-200'}`}
        >
          <span aria-hidden="true" className={`flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border-2 ${value === opt ? 'border-red-700 dark:border-red-400' : 'border-gray-300 dark:border-gray-500'}`}>
            {value === opt && <span className="h-[7px] w-[7px] rounded-full bg-red-700 dark:bg-red-400" />}
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
      ? 'border-red-600 bg-red-50 text-red-950 dark:border-red-400 dark:bg-red-900/30 dark:text-red-100'
      : 'border-gray-200 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-700/30 dark:text-gray-200'}`}>
      <div className="flex min-h-[46px] items-center">
        <button type="button" onClick={onClick} disabled={disabled} aria-pressed={checked}
          className="flex min-h-[46px] min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left text-[13px] leading-5 disabled:opacity-40">
          <span aria-hidden="true" className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border-2 ${checked ? 'border-red-700 bg-red-700 text-white dark:border-red-400 dark:bg-red-500 dark:text-gray-950' : 'border-gray-300 dark:border-gray-500'}`}>
            {checked && <span className="text-[12px] leading-none">✓</span>}
          </span>
          <span className={checked ? 'font-semibold' : ''}>{opt}</span>
        </button>
        {help && (
          <button type="button" aria-label={`Erklärung zu ${opt}`} aria-expanded={showHelp}
            onClick={() => setShowHelp((show) => !show)}
            className="mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[16px] font-bold text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/30">
            ⓘ
          </button>
        )}
      </div>
      {help && showHelp && <p className="border-t border-red-100 px-3 py-2 text-[12px] font-normal leading-5 text-gray-600 dark:border-gray-600 dark:text-gray-300">{help}</p>}
    </div>
  )
}

function MultiChoiceInput({ q, value, onChange }: { q: QuestionDef; value: string[] | undefined; onChange: (v: string[]) => void }) {
  const selected = value ?? []
  const exclusive = new Set(q.exclusiveOptions ?? [])
  const concreteSelectedCount = selected.filter((o) => !exclusive.has(o)).length
  const [activeGroup, setActiveGroup] = useState(q.optionGroups?.[0]?.label ?? '')
  const [pendingReplace, setPendingReplace] = useState<string | null>(null)
  const activeGroupIndex = q.optionGroups?.findIndex((group) => group.label === activeGroup) ?? 0

  function toggle(opt: string) {
    if (wouldReplaceSurveySelection(q, selected, opt)) {
      setPendingReplace(opt)
      return
    }
    setPendingReplace(null)
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
      {(q.maxSelect != null || q.id === 'q_features') && (
        <p className="mb-2 text-[12px] font-semibold text-gray-600 dark:text-gray-300">
          {q.id === 'q_features'
            ? `${concreteSelectedCount} Ideen ausgewählt · beliebig viele möglich`
            : `Bis zu ${q.maxSelect} auswählen`}
        </p>
      )}
      {pendingReplace && (
        <div role="alert" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[13px] leading-5 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          <p><strong>Auswahl ersetzen?</strong> „{pendingReplace}“ schließt deine bisherige Auswahl aus. Deine bisher gewählten Antworten würden entfernt.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setPendingReplace(null)}
              className="min-h-[42px] flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold text-amber-950 dark:border-amber-700 dark:bg-gray-800 dark:text-amber-100">Behalten</button>
            <button type="button" onClick={() => {
              onChange(toggleMultiOption(q, selected, pendingReplace))
              setPendingReplace(null)
            }} className="min-h-[42px] flex-1 rounded-lg bg-amber-800 px-3 py-2 font-bold text-white dark:bg-amber-600">Ersetzen</button>
          </div>
        </div>
      )}
      {q.optionGroups && q.optionGroups.length > 0 ? (
        <div>
          <div className="mb-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-[12px] font-semibold leading-5 text-gray-700 dark:border-gray-700 dark:bg-gray-700/30 dark:text-gray-200">
            Alle drei Kategorien ansehen · Kategorie {activeGroupIndex + 1} von {q.optionGroups.length}
          </div>
          <div className="mb-3 grid grid-cols-3 gap-1.5" role="group" aria-label="Feature-Kategorien">
            {q.optionGroups.map((g) => (
              <button key={g.label} type="button" aria-pressed={activeGroup === g.label}
                onClick={() => setActiveGroup(g.label)}
                className={`min-h-[48px] rounded-lg border px-2 py-2 text-center text-[11px] font-semibold leading-4 ${activeGroup === g.label
                  ? 'border-red-600 bg-red-50 text-red-900 dark:border-red-400 dark:bg-red-900/30 dark:text-red-100'
                  : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-700/30 dark:text-gray-300'}`}>
                {g.label}
                {selected.filter((o) => g.options.includes(o)).length > 0 && (
                  <span className="ml-1 text-red-700 dark:text-red-300">({selected.filter((o) => g.options.includes(o)).length})</span>
                )}
              </button>
            ))}
          </div>
          <div className="space-y-2">{(q.optionGroups.find((g) => g.label === activeGroup) ?? q.optionGroups[0]).options.map(renderOption)}</div>
          {ungrouped.length > 0 && (
            <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 dark:border-gray-700">{ungrouped.map(renderOption)}</div>
          )}
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-[12px] leading-4 text-gray-600 dark:text-gray-300">Auswahl aus allen Kategorien bleibt erhalten.</p>
            {activeGroupIndex < q.optionGroups.length - 1 && (
              <button type="button"
                onClick={() => setActiveGroup(q.optionGroups![activeGroupIndex + 1].label)}
                className="min-h-[44px] shrink-0 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[12px] font-bold text-red-800 hover:bg-red-100 dark:border-red-600 dark:bg-red-950/40 dark:text-red-200">
                Nächste Kategorie →
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">{(q.options ?? []).map(renderOption)}</div>
      )}
    </div>
  )
}

function PositiveStakeInput({ value, onChange }: { value: string | undefined; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          pattern="[1-9][0-9]*"
          autoComplete="off"
          aria-label="Eigener maximaler Einsatz in Wildis"
          value={value ?? ''}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^0-9]/g, '').replace(/^0+/, '')
            onChange(digits)
          }}
          placeholder="z. B. 400 oder 1000"
          className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 pr-16 text-[16px] font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] font-bold text-gray-500 dark:text-gray-300">Wildis</span>
      </div>
      <p className="text-[12px] text-gray-600 dark:text-gray-300">Beliebiger positiver Betrag in ganzen Wildis. Keine Obergrenze.</p>
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
        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[16px] text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-300 dark:border-gray-600 dark:bg-gray-700/40 dark:text-gray-200 dark:placeholder-gray-500 resize-y"
      />
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{q.helpText ?? 'Freiwillig'}</p>
    </div>
  )
}
