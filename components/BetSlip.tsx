'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useBetSlip, bsKey } from '@/context/BetSlipContext'
import type { MarketType } from '@/types'
import { crestPath } from '@/lib/teams'

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
    </svg>
  )
}

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
    isComboValid,
  } = useBetSlip()

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const [comboInputValue, setComboInputValue] = useState('10')

  const count = selections.length

  if (count === 0) return null

  function key(matchId: number, marketType: MarketType, selection: string) {
    return bsKey(matchId, marketType, selection)
  }

  function getStake(matchId: number, marketType: MarketType, selection: string): number {
    return stakes[key(matchId, marketType, selection)] ?? 10
  }

  function getInputValue(matchId: number, marketType: MarketType, selection: string): string {
    return inputValues[key(matchId, marketType, selection)] ?? String(getStake(matchId, marketType, selection))
  }

  function handleStakeButton(matchId: number, marketType: MarketType, selection: string, amt: number) {
    setStake(matchId, marketType, amt, selection)
    setInputValues((v) => ({ ...v, [key(matchId, marketType, selection)]: String(amt) }))
  }

  function handleStakeChange(matchId: number, marketType: MarketType, selection: string, raw: string) {
    setInputValues((v) => ({ ...v, [key(matchId, marketType, selection)]: raw }))
    const n = parseFloat(raw)
    if (!isNaN(n) && n >= 1) setStake(matchId, marketType, n, selection)
  }

  function handleStakeBlur(matchId: number, marketType: MarketType, selection: string) {
    const raw = inputValues[key(matchId, marketType, selection)] ?? ''
    const n = parseFloat(raw)
    const validated = !isNaN(n) && n >= 1 ? n : (getStake(matchId, marketType, selection) || 10)
    setStake(matchId, marketType, validated, selection)
    setInputValues((v) => ({ ...v, [key(matchId, marketType, selection)]: String(validated) }))
  }

  function handleComboStakeChange(raw: string) {
    setComboInputValue(raw)
    const n = parseFloat(raw)
    if (!isNaN(n) && n >= 1) setComboStake(n)
  }

  function handleComboStakeBlur() {
    const n = parseFloat(comboInputValue)
    const validated = !isNaN(n) && n >= 1 ? n : (comboStake || 10)
    setComboStake(validated)
    setComboInputValue(String(validated))
  }

  function handleComboButton(amt: number) {
    setComboStake(amt)
    setComboInputValue(String(amt))
  }

  // Clear all: reset local input state, close sheet, then clear context
  function handleClearSlip() {
    setOpen(false)
    setInputValues({})
    setComboInputValue('10')
    setError(null)
    clearSlip()
  }

  const totalSingleStake = selections.reduce(
    (acc, s) => acc + getStake(s.matchId, s.marketType, s.selection),
    0
  )

  const isRiskyEligible =
    (mode === 'single' && selections.length === 1 && selections[0].oddsValue > 20) ||
    (mode === 'combo' && isComboValid && totalComboOdds > 20)

  // Collapsed bar labels
  const showComboOdds = mode === 'combo' && isComboValid && count >= 2
  const comboOddsLabel = showComboOdds
    ? `@${totalComboOdds.toFixed(2).replace('.', ',')}`
    : null

  let barTitle: string
  let barSub: string
  if (mode === 'single') {
    barTitle = count === 1 ? 'Einzelwette' : `${count} Einzelwetten`
    barSub = count === 1
      ? `@${selections[0].oddsValue.toFixed(2).replace('.', ',')} · Zum Wettschein`
      : `Zum Wettschein`
  } else {
    barTitle = `Kombiwette · ${count} Tipps`
    barSub = isComboValid
      ? `Gesamtquote @${totalComboOdds.toFixed(2).replace('.', ',')} · Zum Wettschein`
      : 'Ungültige Kombination · Zum Wettschein'
  }

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
        stake: getStake(s.matchId, s.marketType, s.selection),
      })),
      mode,
      comboStake,
      isRisky: isRiskyEligible,
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

      const newBalStr = data.newBalance?.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      setSuccess(`Wette platziert! Neues Guthaben: ${newBalStr} WR`)
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

      {/* Collapsed Bottom Bar */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-20 left-3 right-3 z-40 bg-red-700 text-white rounded-2xl shadow-2xl flex items-center gap-3 px-4 py-3 active:scale-[0.985] transition-transform"
        >
          <span className="w-7 h-7 bg-white/20 text-white rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 border border-white/30">
            {count}
          </span>
          <div className="flex-1 min-w-0 text-left">
            <div className="font-bold text-sm leading-tight truncate">{barTitle}</div>
            <div className="text-red-200 text-xs mt-0.5 truncate">{barSub}</div>
          </div>
          <svg className="w-4 h-4 text-red-200 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 15l7-7 7 7" />
          </svg>
        </button>
      )}

      {/* Expanded Bottom Sheet */}
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          {/* Backdrop — closes sheet only */}
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
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-gray-900 text-lg">
                    {mode === 'combo' ? 'Kombiwette' : 'Wettschein'}
                  </h2>
                  {mode === 'combo' && comboOddsLabel && (
                    <span className="text-red-700 font-black text-lg">{comboOddsLabel}</span>
                  )}
                </div>
                <p className="text-gray-500 text-xs">
                  {count} {count === 1 ? 'Auswahl' : 'Auswahlen'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Trash: clears entire slip */}
                <button
                  onClick={handleClearSlip}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-red-700 hover:bg-red-50 transition-colors"
                  title="Wettschein leeren"
                  aria-label="Wettschein leeren"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
                {/* X: closes sheet only */}
                <button
                  onClick={() => setOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200"
                  title="Schließen"
                  aria-label="Wettschein schließen"
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
                  key={key(s.matchId, s.marketType, s.selection)}
                  className="bg-gray-50 rounded-xl p-3 border border-gray-100"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        {s.homeTeam && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={crestPath(s.homeTeam)} alt="" className="w-4 h-4 object-contain flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        )}
                        {s.awayTeam && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={crestPath(s.awayTeam)} alt="" className="w-4 h-4 object-contain flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        )}
                        <span className="truncate">{s.matchLabel}</span>
                      </div>
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
                        {s.oddsValue.toFixed(2).replace('.', ',')}
                      </span>
                      {/* Small X: removes only this selection */}
                      <button
                        onClick={() => removeSelection(s.matchId, s.marketType, s.selection)}
                        className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-red-700 rounded-full hover:bg-red-50 transition-colors"
                        aria-label="Tipp entfernen"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Stake Input (Single Mode) */}
                  {mode === 'single' && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-gray-500">Einsatz:</span>
                      <div className="flex flex-wrap items-center gap-1">
                        {[5, 10, 25, 50, 100, 250].map((amt) => (
                          <button
                            key={amt}
                            onClick={() => handleStakeButton(s.matchId, s.marketType, s.selection, amt)}
                            className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${
                              getStake(s.matchId, s.marketType, s.selection) === amt
                                ? 'bg-red-700 text-white'
                                : 'bg-white border border-gray-200 text-gray-600 hover:border-red-300'
                            }`}
                          >
                            {amt} WR
                          </button>
                        ))}
                        <input
                          type="number"
                          min="1"
                          max="250"
                          value={getInputValue(s.matchId, s.marketType, s.selection)}
                          onChange={(e) => handleStakeChange(s.matchId, s.marketType, s.selection, e.target.value)}
                          onBlur={() => handleStakeBlur(s.matchId, s.marketType, s.selection)}
                          className="w-16 text-center py-1 px-1 border border-gray-200 rounded-lg text-xs font-medium text-gray-900 focus:outline-none focus:ring-1 focus:ring-red-500"
                        />
                      </div>
                      <span className="text-xs text-gray-500 ml-auto">
                        Gewinn:{' '}
                        <span className="text-green-600 font-semibold">
                          {(getStake(s.matchId, s.marketType, s.selection) * s.oddsValue).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} WR
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
                      {totalComboOdds.toFixed(2).replace('.', ',')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-sm text-gray-600 whitespace-nowrap">Einsatz:</span>
                    <div className="flex flex-wrap items-center gap-1">
                      {[5, 10, 25, 50, 100, 250].map((amt) => (
                        <button
                          key={amt}
                          onClick={() => handleComboButton(amt)}
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
                        max="250"
                        value={comboInputValue}
                        onChange={(e) => handleComboStakeChange(e.target.value)}
                        onBlur={handleComboStakeBlur}
                        className="w-16 text-center py-1.5 px-1 border border-gray-200 rounded-lg text-xs font-medium text-gray-900 focus:outline-none focus:ring-1 focus:ring-red-500 bg-white"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-gray-600">Möglicher Gewinn</span>
                    <span className="font-bold text-green-600 text-lg">
                      {potentialPayout.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} WR
                    </span>
                  </div>
                </>
              )}

              {mode === 'single' && (
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-xs text-gray-500">Gesamteinsatz</div>
                    <div className="font-semibold text-gray-900">{totalSingleStake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} WR</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Möglicher Gewinn</div>
                    <div className="font-bold text-green-600">{potentialPayout.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} WR</div>
                  </div>
                </div>
              )}

              {isRiskyEligible && (
                <div className="mb-3 bg-purple-50 text-purple-700 text-xs px-3 py-2 rounded-lg border border-purple-200 font-bold flex items-center gap-2">
                  <span className="text-base">🎲</span>
                  <span>Hohe Quote – die Wette mit der höchsten Quote belegt den Risky-Slot (max. 1 je Spieltag).</span>
                </div>
              )}

              {mode === 'combo' && !isComboValid && (
                <div className="mb-3 bg-orange-50 text-orange-700 text-xs px-3 py-2 rounded-lg border border-orange-200 font-medium">
                  Ungültige Kombiwette — zwei Wetten vom selben Spiel können nicht kombiniert werden.
                </div>
              )}

              {error && (
                <div className="mb-3 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-lg border border-red-100">
                  {error}
                </div>
              )}

              <button
                onClick={placebet}
                disabled={loading || count === 0 || !isComboValid}
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
                      ({mode === 'combo'
                        ? `${comboStake.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} WR`
                        : `${totalSingleStake.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} WR`})
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
