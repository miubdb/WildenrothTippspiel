import Link from 'next/link'
import type { Answers } from '@/lib/survey'
import { surveyProgress } from '@/lib/survey'

type SurveyResponse = { answers?: Answers | null; submitted_at?: string | null } | null

/** Shared status logic with independent homepage and Winter-Recap styles. */
export function SurveyInvitation({ variant, response }: { variant: 'home' | 'winter'; response: SurveyResponse }) {
  const submitted = !!response?.submitted_at
  const started = !!response
  const progress = surveyProgress(response?.answers ?? {})

  if (variant === 'winter') {
    return (
      <section aria-label="Tippspiel-Umfrage" className="rc-snowcap relative overflow-hidden rounded-2xl border border-[#b8dff7]/30 bg-gradient-to-br from-[#071a3d] via-[#103568] to-[#2a7fc4] px-5 py-5 text-white shadow-lg">
        <span className="pointer-events-none absolute -right-3 -top-6 text-8xl opacity-15" aria-hidden>❄</span>
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#bfe3fb]">❄ Dein Feedback zur Halbzeit</span>
        <h2 className="font-display mt-2 text-2xl font-bold leading-tight">{submitted ? 'Danke fürs Mitmachen!' : 'Nach dem Rückblick bist du dran!'}</h2>
        <p className="relative mt-2 text-sm leading-relaxed text-[#e3f1fc]">
          {submitted
            ? 'Deine Antworten sind angekommen. Danke, dass du das Wildenroth-Tippspiel mitgestaltest!'
            : 'Was lief gut, was nervt und was wünschst du dir für die Rückrunde? Mit deiner Meinung machen wir unser Tippspiel gemeinsam noch besser.'}
        </p>
        {!submitted && (
          <>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#cfeaff]">
              <span>◷ Ca. 10–15 Minuten</span><span>✓ Jederzeit speichern & später fortsetzen</span>
            </div>
            {started && <p className="mt-2 text-xs text-[#cfeaff]">Dein Fortschritt: {progress.percent} %</p>}
            <Link href="/umfrage" className="relative mt-4 block rounded-xl bg-[#d5efff] px-4 py-3 text-center text-sm font-bold text-[#0b1f44] transition-colors hover:bg-white">
              {started ? 'Umfrage fortsetzen' : 'Zur Tippspiel-Umfrage'} →
            </Link>
          </>
        )}
      </section>
    )
  }

  return (
    <section aria-label="Tippspiel-Umfrage" className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="text-[11px] font-bold uppercase tracking-widest text-red-700 dark:text-red-300">Deine Meinung zählt</div>
      <h2 className="mt-1 text-lg font-black text-gray-900 dark:text-gray-100">{submitted ? 'Danke für deine Teilnahme! ⚽' : 'Mach unser Tippspiel noch besser! ⚽'}</h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
        {submitted
          ? 'Danke für dein Feedback! Damit hilfst du uns, das Tippspiel für die Rückrunde und die nächste Saison weiterzuentwickeln.'
          : 'Was gefällt dir, was können wir verbessern und welche Funktionen wünschst du dir? Dein Feedback hilft uns, das Tippspiel gemeinsam weiterzuentwickeln.'}
      </p>
      {!submitted && (
        <>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            <span>◷ Ca. 10–15 Minuten</span><span>✓ Jederzeit speichern & später fortsetzen</span>
          </div>
          {started && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Dein Fortschritt: {progress.percent} %</p>}
          <Link href="/umfrage" className="mt-4 block rounded-xl bg-red-700 px-4 py-3 text-center text-sm font-bold text-white transition-colors hover:bg-red-800">
            {started ? 'Umfrage fortsetzen' : 'Umfrage starten'} →
          </Link>
        </>
      )}
    </section>
  )
}
