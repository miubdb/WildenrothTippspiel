'use client'

import { useState } from 'react'
import { StornoChampDetailSheet } from '@/components/StornoChampDetailSheet'

type Instance = { matchday: number; season: string; valueText: string | null; refBetId: number | null; refComboId: number | null }

/**
 * One Pokalschrank tile (app/(app)/spieler/[id]/page.tsx). Only Storno-Champ
 * instances carry a ref_bet_id/ref_combo_id — clicking one of those opens
 * the SAME shared StornoChampDetailSheet used everywhere else (see that
 * component's doc comment), instead of a separate Pokalschrank-only detail
 * view.
 */
export function PokalschrankAwardTile({
  icon, title, description, count, latestMatchday, latestSeason, latestValueText, instances,
}: {
  icon: string
  title: string
  description: string
  count: number
  latestMatchday: number
  latestSeason: string
  latestValueText: string | null
  instances: Instance[]
}) {
  const [openRef, setOpenRef] = useState<{ betId: number | null; comboId: number | null } | null>(null)
  const latest = instances[0]
  const latestClickable = count === 1 && (latest?.refBetId != null || latest?.refComboId != null)

  return (
    <div className="relative bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl px-3 py-2.5">
      {count > 1 && (
        <span className="absolute top-1.5 right-1.5 bg-red-600 text-white text-[10px] font-bold leading-none rounded-full px-1.5 py-0.5">
          {count}×
        </span>
      )}
      <div
        className={`flex items-center gap-2.5 ${latestClickable ? 'cursor-pointer' : ''}`}
        onClick={latestClickable ? () => setOpenRef({ betId: latest.refBetId, comboId: latest.refComboId }) : undefined}
        role={latestClickable ? 'button' : undefined}
      >
        <span className="text-2xl flex-shrink-0">{icon}</span>
        <div className={`flex-1 min-w-0 ${count > 1 ? 'pr-7' : ''}`}>
          <div className="font-bold text-xs text-gray-900 dark:text-gray-100 leading-tight">{title}</div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">{description}</div>
          {count === 1 && (
            <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
              Spieltag {latestMatchday} · {latestSeason}
              {latestValueText && <span className="ml-1 font-semibold text-amber-700 dark:text-amber-400">{latestValueText}</span>}
              {latestClickable && <span className="block font-semibold mt-0.5">Details ansehen →</span>}
            </div>
          )}
        </div>
      </div>
      {count > 1 && (
        <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800/50 space-y-1">
          {instances.map((inst, i) => {
            const clickable = inst.refBetId != null || inst.refComboId != null
            return (
              <div
                key={i}
                className={`text-[10px] text-gray-500 dark:text-gray-400 flex justify-between ${clickable ? 'cursor-pointer hover:text-amber-700 dark:hover:text-amber-400' : ''}`}
                onClick={clickable ? () => setOpenRef({ betId: inst.refBetId, comboId: inst.refComboId }) : undefined}
                role={clickable ? 'button' : undefined}
              >
                <span>Spieltag {inst.matchday} · {inst.season}{clickable && ' →'}</span>
                {inst.valueText && <span className="font-semibold text-amber-700 dark:text-amber-400">{inst.valueText}</span>}
              </div>
            )
          })}
        </div>
      )}
      {openRef && (
        <StornoChampDetailSheet
          betId={openRef.betId}
          comboId={openRef.comboId}
          onClose={() => setOpenRef(null)}
        />
      )}
    </div>
  )
}
