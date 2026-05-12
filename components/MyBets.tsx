'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Leg = {
  id: number
  match_id: number
  market_type: string
  selection: string
  odds_value: number
  stake: number | null
  status: string
  combo_id: number | null
  is_risky: boolean
}

type ComboData = {
  id: number
  stake: number
  status: string
  legs: Leg[]
}

interface MyBetsProps {
  singles: Leg[]
  combos: ComboData[]
  matchMap: Record<number, { home: string; away: string }>
  isDeadlinePassed: boolean
}

const SEL_LABELS: Record<string, Record<string, string>> = {
  '1x2': { home: 'Heimsieg', draw: 'Unentschieden', away: 'Auswärtssieg' },
  double_chance: { '1x': '1X', x2: 'X2', '12': '12' },
  over_under: { 'over_2.5': 'Über 2,5', 'under_2.5': 'Unter 2,5' },
  over_under_3_5: { 'over_3.5': 'Über 3,5', 'under_3.5': 'Unter 3,5' },
  over_under_5_5: { 'over_5.5': 'Über 5,5', 'under_5.5': 'Unter 5,5' },
  over_under_7_5: { 'over_7.5': 'Über 7,5', 'under_7.5': 'Unter 7,5' },
  btts: { yes: 'Beide treffen', no: 'Nicht beide' },
  handicap: {
    home_minus_1_5: '–1,5',
    away_plus_1_5: '+1,5',
    home_minus_2_5: '–2,5',
    away_plus_2_5: '+2,5',
  },
}

const MARKET_LABEL: Record<string, string> = {
  '1x2': '1X2', double_chance: 'Doppelte Chance', over_under: 'Ü/U 2,5',
  over_under_3_5: 'Ü/U 3,5', over_under_5_5: 'Ü/U 5,5', over_under_7_5: 'Ü/U 7,5',
  btts: 'Beide treffen', exact_score: 'Ergebnis', handicap: 'Handicap',
}

function selLabel(marketType: string, selection: string): string {
  if (marketType === 'exact_score') return selection
  return SEL_LABELS[marketType]?.[selection] ?? selection
}

function fmtOdds(n: number): string {
  return n.toFixed(2).replace('.', ',')
}

function fmtAmount(n: number): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${
      status === 'won' ? 'bg-green-100 text-green-700' :
      status === 'lost' ? 'bg-red-100 text-red-600' : 'bg-yellow-50 text-yellow-700'
    }`}>
      {status === 'won' ? 'Gewonnen' : status === 'lost' ? 'Verloren' : 'Offen'}
    </span>
  )
}

export function MyBets({ singles, combos, matchMap, isDeadlinePassed }: MyBetsProps) {
  const router = useRouter()
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (singles.length === 0 && combos.length === 0) return null

  // Risky bet = the single bet or combo with the highest effective odds (if > 20).
  const comboEffOdds = new Map(combos.map(c => [c.id, c.legs.reduce((acc, l) => acc * l.odds_value, 1)]))
  const allUnits = [
    ...singles.map(b => ({ kind: 'single' as const, id: b.id, odds: b.odds_value })),
    ...combos.map(c => ({ kind: 'combo' as const, id: c.id, odds: comboEffOdds.get(c.id) ?? 0 })),
  ]
  const maxOdds = allUnits.reduce((m, u) => Math.max(m, u.odds), 0)
  const riskyUnit = maxOdds > 20 ? (allUnits.find(u => u.odds === maxOdds) ?? null) : null
  const riskyBetId = riskyUnit?.kind === 'single' ? riskyUnit.id : null
  const riskyComboId = riskyUnit?.kind === 'combo' ? riskyUnit.id : null

  async function cancelBet(betId?: number, comboId?: number) {
    const key = betId ? `bet-${betId}` : `combo-${comboId}`
    setCancellingId(key)
    setError(null)
    try {
      const res = await fetch('/api/bets/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(betId ? { betId } : { comboId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Stornierung fehlgeschlagen.')
      } else {
        router.refresh()
      }
    } catch {
      setError('Netzwerkfehler.')
    } finally {
      setCancellingId(null)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="font-bold text-gray-900">Meine Wetten</h2>
        {!isDeadlinePassed && (
          <p className="text-xs text-gray-400 mt-0.5">Stornierung bis zum ersten Anpfiff möglich</p>
        )}
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-50 text-red-700 text-xs border-b border-red-100 flex items-center gap-2">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      <div className="divide-y divide-gray-50">
        {singles.map(bet => {
          const m = matchMap[bet.match_id]
          const key = `bet-${bet.id}`
          const isCancelling = cancellingId === key
          const stake = bet.stake ?? 0
          const potentialWin = stake * bet.odds_value
          return (
            <div key={bet.id} className={`px-4 py-3 ${
              bet.status === 'won' ? 'bg-green-50/50' : bet.status === 'lost' ? 'bg-red-50/30' : ''
            }`}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                    <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">
                      {MARKET_LABEL[bet.market_type] ?? bet.market_type}
                    </span>
                    {bet.id === riskyBetId && <span className="text-[10px] text-purple-700 font-bold">🎲</span>}
                    <span className="text-xs font-semibold text-gray-900">{selLabel(bet.market_type, bet.selection)}</span>
                    <span className="text-xs text-red-600 font-bold">@{fmtOdds(bet.odds_value)}</span>
                  </div>
                  <div className="text-[10px] text-gray-400">{m ? `${m.home} – ${m.away}` : ''}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    Einsatz <span className="font-semibold">{fmtAmount(stake)} €</span>
                    {' · '}Gewinn <span className="font-semibold text-green-600">{fmtAmount(potentialWin)} €</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                  <StatusChip status={bet.status} />
                  {!isDeadlinePassed && bet.status === 'pending' && (
                    <button
                      onClick={() => cancelBet(bet.id)}
                      disabled={!!cancellingId}
                      className="text-[10px] px-2 py-1 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-40 font-medium transition-colors"
                    >
                      {isCancelling ? '…' : 'Storno'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {combos.map(combo => {
          const key = `combo-${combo.id}`
          const isCancelling = cancellingId === key
          const comboOdds = combo.legs.reduce((acc, l) => acc * l.odds_value, 1)
          const potentialWin = combo.stake * comboOdds
          return (
            <div key={combo.id} className={`px-4 py-3 ${
              combo.status === 'won' ? 'bg-green-50/50' : combo.status === 'lost' ? 'bg-red-50/30' : ''
            }`}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded">
                  {combo.id === riskyComboId ? '🎲 RISKY' : '🔗 KOMBI'}
                </span>
                <span className="text-xs text-gray-500">{combo.legs.length} Tipps</span>
                <span className="text-xs text-red-600 font-bold">@{fmtOdds(comboOdds)}</span>
                <StatusChip status={combo.status} />
                {!isDeadlinePassed && combo.status === 'pending' && (
                  <button
                    onClick={() => cancelBet(undefined, combo.id)}
                    disabled={!!cancellingId}
                    className="ml-auto text-[10px] px-2 py-1 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-40 font-medium transition-colors"
                  >
                    {isCancelling ? '…' : 'Storno'}
                  </button>
                )}
              </div>
              {combo.legs.map(leg => {
                const m = matchMap[leg.match_id]
                return (
                  <div key={leg.id} className="flex items-center gap-1.5 text-xs text-gray-600 py-0.5 pl-2">
                    <span className="text-gray-400 text-[10px]">{m ? `${m.home} – ${m.away}` : ''}</span>
                    <span className="bg-gray-100 text-gray-600 px-1 rounded text-[10px]">{MARKET_LABEL[leg.market_type] ?? leg.market_type}</span>
                    <span className="font-medium text-gray-800">{selLabel(leg.market_type, leg.selection)}</span>
                    <span className="text-red-600 font-bold ml-auto">@{fmtOdds(leg.odds_value)}</span>
                  </div>
                )
              })}
              <div className="mt-1 pl-2 text-[10px] text-gray-500">
                Einsatz <span className="font-semibold">{fmtAmount(combo.stake)} €</span>
                {' · '}Gewinn <span className="font-semibold text-green-600">{fmtAmount(potentialWin)} €</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
