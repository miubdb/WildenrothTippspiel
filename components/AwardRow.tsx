'use client'

import { useState } from 'react'
import { StornoChampDetailSheet } from '@/components/StornoChampDetailSheet'

/**
 * One row in a "Pokale des Spieltags"/Pokalschrank-style award list.
 * Storno-Champ (the only award type with a ref_bet_id/ref_combo_id today)
 * becomes clickable and opens the SAME shared StornoChampDetailSheet used
 * by the live recap preview (components/MatchdayRecap.tsx) — see that
 * component's doc comment for why this stays a single shared piece instead
 * of separate per-page detail logic.
 */
export function AwardRow({
  icon, title, name, valueText, valueNumber,
  refBetId, refComboId,
}: {
  icon: string
  title: string
  name: string
  valueText: string | null
  valueNumber: number | null
  refBetId?: number | null
  refComboId?: number | null
}) {
  const [open, setOpen] = useState(false)
  const clickable = refBetId != null || refComboId != null

  return (
    <>
      <div
        className={`flex items-center gap-3 px-4 py-3 ${clickable ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors' : ''}`}
        onClick={clickable ? () => setOpen(true) : undefined}
        role={clickable ? 'button' : undefined}
      >
        <div className="text-2xl flex-shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide font-semibold">{title}</div>
          <div className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{name}</div>
          {valueText && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{valueText}</div>}
          {clickable && <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 mt-1">Details ansehen →</div>}
        </div>
        {valueNumber != null && !valueText && (
          <div className="text-sm font-black text-gray-700 dark:text-gray-300 flex-shrink-0">
            {valueNumber.toLocaleString('de-DE', { maximumFractionDigits: 2 })}
          </div>
        )}
      </div>
      {open && (
        <StornoChampDetailSheet
          betId={refBetId ?? null}
          comboId={refComboId ?? null}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
