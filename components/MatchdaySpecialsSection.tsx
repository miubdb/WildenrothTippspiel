'use client'

import { useBetSlip } from '@/context/BetSlipContext'

interface SpecialOption {
  key: string
  label: string
  final_odds: number
}

export interface MatchdaySpecialForDisplay {
  id: number
  matchday: number
  title: string
  line: number | null
  options: SpecialOption[]
  representative_match_id: number
}

/**
 * "🔥 SPIELTAG-SPECIALS" — normal, stake/odds-bearing bets whose outcome
 * spans the whole Spieltag rather than one match (see lib/matchdaySpecials.ts
 * for the engine). Rendered after the last normal match card on /tipps.
 * `representative_match_id` is only a technical FK anchor for the shared
 * `bets` table — BetSlipContext's bsKey/comboIdentity key these by
 * `specialId` instead, so multiple Specials sharing that anchor (every
 * Special of a Spieltag does, by construction) stay independent slip lines.
 */
export function MatchdaySpecialsSection({ specials }: { specials: MatchdaySpecialForDisplay[] }) {
  const { selections, mode, addSelection } = useBetSlip()
  if (specials.length === 0) return null

  const hasSpecialInSlip = selections.some((s) => s.marketType === 'matchday_special')

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-2 pt-1">
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        <span className="text-xs text-orange-500 font-bold uppercase tracking-wide">🔥 Spieltag-Specials</span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
      </div>

      {mode === 'combo' && hasSpecialInSlip && (
        <div className="text-xs text-orange-700 bg-orange-50 dark:bg-orange-950/40 dark:text-orange-300 rounded-xl px-3 py-2 font-medium">
          Pro Kombi ist maximal ein Spieltag-Special möglich.
        </div>
      )}

      {specials.map((special) => (
        <div
          key={special.id}
          className="bg-white dark:bg-gray-800 rounded-2xl border border-orange-200 dark:border-orange-900/60 shadow-sm p-4"
        >
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300 px-1.5 py-0.5 rounded font-bold">
              🔥 SPECIAL
            </span>
            <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{special.title}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {special.options.map((opt) => {
              const isSelected = selections.some(
                (s) => s.marketType === 'matchday_special' && s.specialId === special.id && s.selection === opt.key
              )
              return (
                <button
                  key={opt.key}
                  onClick={() =>
                    addSelection({
                      matchId: special.representative_match_id,
                      matchLabel: `Spieltag ${special.matchday} · Specials`,
                      marketType: 'matchday_special',
                      marketLabel: special.title,
                      selection: opt.key,
                      selectionLabel: opt.label,
                      oddsValue: opt.final_odds,
                      specialId: special.id,
                    })
                  }
                  className={`rounded-xl py-2.5 px-3 text-left border transition-colors ${
                    isSelected
                      ? 'bg-red-700 border-red-700 text-white'
                      : 'bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-red-300'
                  }`}
                >
                  <div className="text-sm font-semibold">{opt.label}</div>
                  <div className={`text-sm font-bold ${isSelected ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>
                    {opt.final_odds.toFixed(2).replace('.', ',')}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
