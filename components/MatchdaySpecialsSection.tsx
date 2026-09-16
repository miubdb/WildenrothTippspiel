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
  /** True once closes_at has passed — mirrors BettingMatchCard's own
   *  kickoff-passed treatment (grayed out, "keine Tipps mehr möglich") rather
   *  than vanishing outright, so a Special stays visible/checkable the same
   *  way a normal match card does after its own kickoff. */
  closed?: boolean
}

/**
 * "SPIELTAG-SPECIALS" — normal, stake/odds-bearing bets whose outcome
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
    <div className="space-y-2.5 pt-2">
      <div className="flex items-center gap-2 pt-1">
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        <span className="text-xs text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wide">Spieltag-Specials</span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
      </div>

      {mode === 'combo' && hasSpecialInSlip && (
        <div className="text-xs text-gray-600 bg-gray-100 dark:bg-gray-800 dark:text-gray-300 rounded-xl px-3 py-2 font-medium">
          Pro Kombi ist maximal ein Spieltag-Special möglich.
        </div>
      )}

      {specials.map((special) => (
        <div
          key={special.id}
          className={`bg-white dark:bg-gray-800 rounded-2xl border shadow-sm px-3.5 py-3 ${
            special.closed ? 'border-gray-200 dark:border-gray-700 opacity-60' : 'border-gray-200 dark:border-gray-700'
          }`}
        >
          <div className="flex flex-col items-center text-center gap-1 mb-2.5">
            <span className="text-[10px] bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 px-2 py-px rounded-full font-bold tracking-wide">
              SPECIAL
            </span>
            <span className="text-sm font-bold text-gray-900 dark:text-gray-100 leading-snug max-w-xs">{special.title}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {special.options.map((opt) => {
              const isSelected = selections.some(
                (s) => s.marketType === 'matchday_special' && s.specialId === special.id && s.selection === opt.key
              )
              return (
                <button
                  key={opt.key}
                  disabled={special.closed}
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
                  className={`rounded-xl py-2 px-2.5 text-center border transition-colors ${
                    special.closed
                      ? 'bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                      : isSelected
                        ? 'bg-red-700 border-red-700 text-white'
                        : 'bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-red-300'
                  }`}
                >
                  <div className="text-[13px] font-semibold leading-snug">{opt.label}</div>
                  <div className={`text-sm font-bold ${!special.closed && isSelected ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>
                    {opt.final_odds.toFixed(2).replace('.', ',')}
                  </div>
                </button>
              )
            })}
          </div>
          {special.closed && (
            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
              <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500">Wettschluss erreicht – keine Tipps mehr möglich</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
