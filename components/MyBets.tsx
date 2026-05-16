'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { WetteCard, type WetteData, type WetteStatus, type WetteLeg } from '@/components/WetteCard'

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
  playerNameMap?: Record<number, string>
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

function selLabel(marketType: string, selection: string, players?: Record<number, string>): string {
  if (marketType === 'exact_score') return selection
  if (marketType === 'goalscorer' || marketType === 'goalscorer_2plus') {
    const id = parseInt(selection, 10)
    const name = players?.[id] ?? `Spieler #${id}`
    return marketType === 'goalscorer_2plus' ? `${name} (mind. 2 Tore)` : name
  }
  return SEL_LABELS[marketType]?.[selection] ?? selection
}

function legToWetteLeg(leg: Leg, matchMap: Record<number, { home: string; away: string }>, players?: Record<number, string>): WetteLeg {
  const m = matchMap[leg.match_id]
  return {
    id: leg.id,
    matchName: m ? `${m.home} – ${m.away}` : '—',
    market: leg.market_type,
    selection: selLabel(leg.market_type, leg.selection, players),
    odds: leg.odds_value,
    status: leg.status as WetteStatus,
  }
}

export function MyBets({ singles, combos, matchMap, isDeadlinePassed, playerNameMap }: MyBetsProps) {
  const router = useRouter()
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (singles.length === 0 && combos.length === 0) return null

  // Determine risky unit (single bet or combo with highest effective odds > 20)
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
      if (!res.ok) setError(data.error ?? 'Stornierung fehlgeschlagen.')
      else router.refresh()
    } catch {
      setError('Netzwerkfehler.')
    } finally {
      setCancellingId(null)
    }
  }

  const wetten: WetteData[] = [
    ...singles.map(leg => ({
      id: `bet-${leg.id}`,
      type: 'single' as const,
      isRisky: leg.id === riskyBetId,
      totalOdds: leg.odds_value,
      stake: leg.stake ?? 0,
      status: leg.status as WetteStatus,
      betId: leg.id,
      legs: [legToWetteLeg(leg, matchMap, playerNameMap)],
    })),
    ...combos.map(combo => ({
      id: `combo-${combo.id}`,
      type: 'combo' as const,
      isRisky: combo.id === riskyComboId,
      totalOdds: comboEffOdds.get(combo.id) ?? 1,
      stake: combo.stake,
      status: combo.status as WetteStatus,
      comboId: combo.id,
      legs: combo.legs.map(l => legToWetteLeg(l, matchMap, playerNameMap)),
    })),
  ]

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

      <div className="p-3 space-y-2">
        {wetten.map(wette => (
          <WetteCard
            key={wette.id}
            wette={wette}
            onCancel={cancelBet}
            cancellingId={cancellingId}
            isDeadlinePassed={isDeadlinePassed}
          />
        ))}
      </div>
    </div>
  )
}
