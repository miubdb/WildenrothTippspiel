'use client'

import { useEffect, useState } from 'react'
import { fmtWildi } from '@/components/WildiIcon'

export interface StornoChampLegDetail {
  matchName: string
  market: string
  selection: string
  odds: number
  finalScore: string | null
}

export interface StornoChampWetteDetail {
  isCombo: boolean
  stake: number
  odds: number
  theoreticalPayout: number
  net: number
  matchName?: string
  market?: string
  selection?: string
  finalScore?: string | null
  legs?: StornoChampLegDetail[]
}

function fmtOdds(n: number) { return `@${n.toFixed(2).replace('.', ',')}` }

/**
 * The ONE shared Storno-Champ detail view — a bottom sheet fetching from
 * app/api/awards/storno-champ-detail (which in turn calls the single
 * lib/awards.ts#getStornoChampWetteDetail implementation). Used identically
 * from the live recap preview (components/MatchdayRecap.tsx), the persisted
 * /recap/[matchday] page, and the Pokalschrank — no separate per-page detail
 * logic. `betId`/`comboId` must be the EXACT reference the award itself was
 * computed from (ref_bet_id/ref_combo_id on the persisted row, or the same
 * ids computeStornoChamp() returned live) — never re-derived.
 */
export function StornoChampDetailSheet({
  betId,
  comboId,
  onClose,
}: {
  betId: number | null
  comboId: number | null
  onClose: () => void
}) {
  const [detail, setDetail] = useState<StornoChampWetteDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount/prop change, same pattern used throughout app/admin/page.tsx
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (betId != null) params.set('betId', String(betId))
    if (comboId != null) params.set('comboId', String(comboId))
    fetch(`/api/awards/storno-champ-detail?${params.toString()}`)
      .then(async (res) => {
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) { setError(json.error ?? 'Fehler beim Laden.'); return }
        setDetail(json.detail)
      })
      .catch(() => { if (!cancelled) setError('Netzwerkfehler.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [betId, comboId])

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-800">
          <div>
            <h3 className="font-bold text-gray-900 dark:text-gray-100">🏆 Storno-Champ — Details</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Die stornierte Wette, die aufgegangen wäre</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none px-1">×</button>
        </div>

        <div className="px-4 py-4">
          {loading && <p className="text-sm text-gray-400 text-center py-6">Lade Details…</p>}
          {!loading && error && (
            <div className="text-center py-6">
              <p className="text-sm text-gray-500 dark:text-gray-400">{error}</p>
            </div>
          )}
          {!loading && !error && detail && !detail.isCombo && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded-full px-2 py-0.5">Storniert</span>
                {detail.finalScore && <span className="text-sm font-black text-gray-900 dark:text-gray-100">{detail.finalScore}</span>}
              </div>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{detail.matchName}</div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">{detail.market}: <span className="font-semibold text-gray-800 dark:text-gray-200">{detail.selection}</span></span>
                <span className="font-bold text-green-600">{fmtOdds(detail.odds)}</span>
              </div>
              <DetailFooter stake={detail.stake} payout={detail.theoreticalPayout} net={detail.net} />
            </div>
          )}
          {!loading && !error && detail && detail.isCombo && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded-full px-2 py-0.5">Storniert · Kombi ({detail.legs?.length ?? 0} Tipps)</span>
                <span className="font-bold text-green-600 text-sm">{fmtOdds(detail.odds)}</span>
              </div>
              <div className="space-y-2">
                {(detail.legs ?? []).map((leg, i) => (
                  <div key={i} className="bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-800 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{leg.matchName}</span>
                      {leg.finalScore && <span className="text-xs font-black text-gray-700 dark:text-gray-200">{leg.finalScore}</span>}
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-xs text-gray-500 dark:text-gray-400">{leg.market}: <span className="font-medium text-gray-700 dark:text-gray-300">{leg.selection}</span></span>
                      <span className="text-xs font-bold text-green-600">{fmtOdds(leg.odds)} ✓</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 italic">Alle Tipps dieser Kombi wären nach den tatsächlichen Ergebnissen aufgegangen.</p>
              <DetailFooter stake={detail.stake} payout={detail.theoreticalPayout} net={detail.net} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailFooter({ stake, payout, net }: { stake: number; payout: number; net: number }) {
  return (
    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-100 dark:border-gray-700 text-center">
      <div>
        <div className="text-[10px] text-gray-400 dark:text-gray-500">Einsatz</div>
        <div className="text-sm font-bold text-gray-800 dark:text-gray-200">{fmtWildi(stake)}</div>
      </div>
      <div>
        <div className="text-[10px] text-gray-400 dark:text-gray-500">Theor. Auszahlung</div>
        <div className="text-sm font-bold text-gray-800 dark:text-gray-200">{fmtWildi(payout)}</div>
      </div>
      <div>
        <div className="text-[10px] text-gray-400 dark:text-gray-500">Entgangen</div>
        <div className="text-sm font-black text-orange-600">+{fmtWildi(net)}</div>
      </div>
    </div>
  )
}
