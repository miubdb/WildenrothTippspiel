'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtWildi } from '@/components/WildiIcon'
import { bonusTipStatus, type BonusTip } from '@/lib/bonusTips'

type MyAnswer = { bonus_tip_id: number; answer_key: string }
type MyPayout = { bonus_tip_id: number; amount: number }

/**
 * "Bonus-Tipps" — Prognosen ohne Einsatz (siehe lib/bonusTips.ts). Schreibt
 * die eigene Antwort direkt per Supabase-Browser-Client (kein eigener API-
 * Route nötig) — RLS (bonus_tip_answers_insert_own/update_own) erzwingt
 * serverseitig sowohl "nur die eigene Zeile" als auch "nur vor Tippschluss",
 * exakt dieselbe "RLS ist die echte Sicherheitsgrenze"-Architektur wie der
 * Rest der App.
 */
export function BonusTipsSection({
  tips,
  myAnswers,
  myPayouts,
  userId,
}: {
  tips: BonusTip[]
  myAnswers: MyAnswer[]
  myPayouts: MyPayout[]
  userId: string
}) {
  const answerMap = new Map(myAnswers.map(a => [a.bonus_tip_id, a.answer_key]))
  const payoutMap = new Map(myPayouts.map(p => [p.bonus_tip_id, p.amount]))

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <h2 className="font-bold text-gray-900 dark:text-gray-100">🎁 Bonus-Tipps</h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Sondertipps ohne Einsatz</p>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {tips.map(t => (
          <BonusTipCard
            key={t.id}
            tip={t}
            myAnswer={answerMap.get(t.id) ?? null}
            myPayout={payoutMap.get(t.id) ?? null}
            userId={userId}
          />
        ))}
      </div>
    </div>
  )
}

function BonusTipCard({ tip, myAnswer, myPayout, userId }: { tip: BonusTip; myAnswer: string | null; myPayout: number | null; userId: string }) {
  const [selected, setSelected] = useState(myAnswer)
  const [saving, setSaving] = useState(false)
  const [savedAnswer, setSavedAnswer] = useState(myAnswer)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const status = bonusTipStatus(tip)
  const isOpen = status === 'open'
  const isCorrect = status === 'evaluated' && savedAnswer != null && (tip.correct_option_keys ?? []).includes(savedAnswer)

  async function submit(key: string) {
    setSaving(true)
    setErrorMsg(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('bonus_tip_answers')
      .upsert({ bonus_tip_id: tip.id, user_id: userId, answer_key: key, updated_at: new Date().toISOString() }, { onConflict: 'bonus_tip_id,user_id' })
    setSaving(false)
    if (error) {
      setErrorMsg('Tippschluss erreicht oder Fehler beim Speichern.')
      return
    }
    setSelected(key)
    setSavedAnswer(key)
  }

  const statusBadge = {
    upcoming: { text: 'Startet bald', cls: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400' },
    open: { text: 'Offen', cls: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
    closed: { text: 'Wartet auf Auswertung', cls: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400' },
    evaluated: isCorrect
      ? { text: 'Richtig getippt', cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' }
      : { text: savedAnswer != null ? 'Falsch getippt' : 'Nicht getippt', cls: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
  }[status]

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{tip.title}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{tip.description}</div>
        </div>
        <span className={`text-[10px] font-bold px-2 py-1 rounded-full flex-shrink-0 ${statusBadge.cls}`}>{statusBadge.text}</span>
      </div>

      <div className="flex items-center justify-between mt-1.5 text-[10px] text-gray-400 dark:text-gray-500">
        <span>Kein Einsatz · +{fmtWildi(tip.reward_wildis)} Wildis bei richtigem Tipp</span>
        <span>
          {status === 'open' ? `Tippschluss: ${new Date(tip.closes_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : null}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-2">
        {tip.options.map(o => {
          const isSelected = selected === o.key
          const isCorrectOption = status === 'evaluated' && (tip.correct_option_keys ?? []).includes(o.key)
          let cls = 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'
          if (isCorrectOption) cls = 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 font-semibold'
          else if (isSelected && status === 'evaluated') cls = 'border-red-400 bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400'
          else if (isSelected) cls = 'border-red-700 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 font-semibold'

          return (
            <button
              key={o.key}
              type="button"
              disabled={!isOpen || saving}
              onClick={() => submit(o.key)}
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${cls} ${isOpen ? 'cursor-pointer hover:border-red-400' : 'cursor-default opacity-90'}`}
            >
              {o.label}
              {isSelected && ' ✓'}
            </button>
          )
        })}
      </div>

      {status === 'evaluated' && isCorrect && myPayout != null && (
        <p className="text-[11px] text-green-600 font-semibold mt-1.5">+{fmtWildi(myPayout)} Wildis erhalten</p>
      )}
      {errorMsg && <p className="text-[11px] text-red-500 mt-1.5">{errorMsg}</p>}
    </div>
  )
}
