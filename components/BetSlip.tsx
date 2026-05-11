'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useBetSlip } from '@/context/BetSlipContext'
import type { MarketType } from '@/types'

export function BetSlip() {
  const router = useRouter()
  const {
    selections,
    mode,
    stakes,
    comboStake,
    setMode,
    setStake,
    setComboStake,
    removeSelection,
    clearSlip,
    totalComboOdds,
    potentialPayout,
  } = useBetSlip()

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const count = selections.length

  if (count === 0) return null

  function slipKey(matchId: number, marketType: MarketType) {
    return `${matchId}-${marketType}`
  }

  function getStake(matchId: number, marketType: MarketType): number {
    return stakes[slipKey(matchId, marketType)] ?? 10
  }

  const totalSingleStake = selections.reduce(
    (acc, s) => acc + getStake(s.matchId, s.marketType),
    0
  )

  async function placebet() {
    setError(null)
    setSuccess(null)
    setLoading(true)

    const payload = {
      selections: selections.map((s) => ({
        matchId: s.matchId,
        marketType: s.marketType,
        selection: s.selection,
        oddsValue: s.oddsValue,
        stake: getStake(s.matchId, s.marketType),
      })),
      mode,
      comboStake,
    }

    try {
      const res = await fetch('/api/bets/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Fehler beim Platzieren der Wette.')
        setLoading(false)
        return
      }

      const newBalStr = data.newBalance?.toLocaleString('de-DE', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
      })
      setSuccess(`Wette platziert! Neues Guthaben: ${newBalStr}`)
      clearSlip()
      setOpen(false)
      router.refresh()
    } catch {
      setError('Netzwerkfehler. Bitte erneut versuchen.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Success Toast */}
      {success && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white px-5 py-3 rounded-xl shadow-xl text-sm font-medium max-w-xs text-center">
          {success}
          <button
            onClick={() => setSuccess(null)}
            className="ml-3 text-green-200 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Floating Button / Collapsed State */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-4 z-40 bg-red-700 text-white rounded-full shadow-2xl flex items-center gap-2 px-4 py-3 font-semibold text-sm active:scale-95 transition-transform"
        >
          <span className="w-6 h-6 bg-white text-red-700 rounded-full flex items-center justify-center font-bold text-xs">
            {count}
          </span>
          {mode === 'combo' ? 'Kombiwette' : 'Wettschein'}
        </button>
      )}

      {/* Expanded Bottom Sheet */}
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />

          {/* Sheet */}
          <div className="relative bg-white rounded-t-3xl shadow-2xl slide-up max-h-[85vh] flex flex-col">
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-gray-300 rounded-full" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div>
                <h2 className="font-bold text-gray-900 text-lg">Wettschein</h2>
                <p className="text-gray-500 text-xs">
                  {count} {count === 1 ? 'Auswahl' : 'Auswahlen'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={clearSlip}
                  className="text-xs text-gray-400 hover:text-red-700 transition-colors px-2 py-1 rounded-lg hover:bg-red-50"
                >
                  Leeren
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Mode Toggle */}
            <div className="px-5 py-3">
              <div className="flex bg-gray-100 rounded-xl p-1">
                <button
                  onClick={() => setMode('single')}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                    mode === 'single'
                      ? 'bg-white shadow text-gray-900'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Einzelwetten
                </button>
                <button
                  onClick={() => setMode('combo')}
                  disabled={count < 2}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 ${
                    mode === 'combo'
                      ? 'bg-white shadow text-gray-900'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Kombiwette
                </button>
              </div>
            </div>

            {/* Selections List */}
            <div className="flex-1 overflow-y-auto px-5 space-y-2 pb-2">
              {selections.map((s) => (
                <div
                  key={`${s.matchId}-${s.marketType}`}
                  className="bg-gray-50 rounded-xl p-3 border border-gray-100"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-gray-500 truncate">{s.matchLabel}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">
                          {s.marketLabel}
                        </span>
                        <span className="text-sm font-semibold text-gray-900">
                          {s.selectionLabel}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-red-700 font-bold text-sm">
                        {s.oddsValue.toFixed(2)}
                      </span>
                      <button
                        onClick={() => removeSelection(s.matchId, s.marketType)}
                        className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-red-700 rounded-full hover:bg-red-50 transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Stake Input (Single Mode) */}
                  {mode === 'single' && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-gray-500">Einsatz:</span>
                      <div className="flex items-center gap-1">
                        {[5, 10, 25, 50].map((amt) => (
                          <button
                            key={amt}
                            onClick={() => setStake(s.matchId, s.marketType, amt)}
                            className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${
                              getStake(s.matchId, s.marketType) === amt
                                ? 'bg-red-700 text-white'
                                : 'bg-white border border-gray-200 text-gray-600 hover:border-red-300'
                            }`}
                          >
                            {amt}€
                          </button>
                        ))}
                        <input
                          type="number"
                          min="1"
                          max="500"
                          value={getStake(s.matchId, s.marketType)}
                          onChange={(e) =>
                            setStake(s.matchId, s.marketType, parseFloat(e.target.value) || 1)
                          }
                          className="w-16 text-center py-1 px-1 border border-gray-200 rounded-lg text-xs font-medium text-gray-900 focus:outline-none focus:ring-1 focus:ring-red-500"
                        />
                      </div>
                      <span className="text-xs text-gray-500 ml-auto">
                        Gewinn:{' '}
                        <span className="text-green-600 font-semibold">
                          {(getStake(s.matchId, s.marketType) * s.oddsValue).toFixed(2)}€
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Combo Stake or Summary */}
            <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 rounded-b-3xl safe-bottom">
              {mode === 'combo' && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-gray-600">Gesamtquote</span>
                    <span className="font-bold text-red-700 text-lg">
                      {totalComboOdds.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-sm text-gray-600 whitespace-nowrap">Einsatz:</span>
                    <div className="flex items-center gap-1">
                      {[5, 10, 25, 50].map((amt) => (
                        <button
                          key={amt}
                          onClick={() => setComboStake(amt)}
                          className={`text-xs px-2 py-1.5 rounded-lg font-medium transition-colors ${
                            comboStake === amt
                              ? 'bg-red-700 text-white'
                              : 'bg-white border border-gray-200 text-gray-600 hover:border-red-300'
                          }`}
                        >
                          {amt}€
                        </button>
                      ))}
                      <input
                        type="number"
                        min="1"
                        max="500"
                        value={comboStake}
                        onChange={(e) => setComboStake(parseFloat(e.target.value) || 1)}
                        className="w-16 text-center py-1.5 px-1 border border-gray-200 rounded-lg text-xs font-medium text-gray-900 focus:outline-none focus:ring-1 focus:ring-red-500 bg-white"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-gray-600">Möglicher Gewinn</span>
                    <span className="font-bold text-green-600 text-lg">
                      {potentialPayout.toFixed(2)}€
                    </span>
                  </div>
                </>
              )}

              {mode === 'single' && (
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-xs text-gray-500">Gesamteinsatz</div>
                    <div className="font-semibold text-gray-900">{totalSingleStake.toFixed(2)}€</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Möglicher Gewinn</div>
                    <div className="font-bold text-green-600">{potentialPayout.toFixed(2)}€</div>
                  </div>
                </div>
              )}

              {error && (
                <div className="mb-3 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-lg border border-red-100">
                  {error}
                </div>
              )}

              <button
                onClick={placebet}
                disabled={loading || count === 0}
                className="w-full py-4 bg-red-700 hover:bg-red-800 disabled:bg-red-300 text-white font-bold rounded-xl transition-colors text-base flex items-center justify-center gap-2 active:scale-95"
              >
                {loading ? (
                  <>
                    <span className="animate-spin inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                    Wird platziert...
                  </>
                ) : (
                  <>
                    Wette platzieren
                    <span className="ml-1 text-red-200 text-sm font-normal">
                      ({mode === 'combo' ? `${comboStake}€` : `${totalSingleStake}€`})
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
