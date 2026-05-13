'use client'

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { BetSlipItem, MarketType } from '@/types'

type BetSlipMode = 'single' | 'combo'

interface StakeMap {
  [key: string]: number
}

interface BetSlipContextValue {
  selections: BetSlipItem[]
  mode: BetSlipMode
  stakes: StakeMap
  comboStake: number
  addSelection: (item: BetSlipItem) => void
  removeSelection: (matchId: number, marketType: MarketType) => void
  clearSlip: () => void
  setMode: (mode: BetSlipMode) => void
  setStake: (matchId: number, marketType: MarketType, stake: number) => void
  setComboStake: (stake: number) => void
  totalComboOdds: number
  potentialPayout: number
  isComboValid: boolean
}

/** Returns true when two selections from the same match can never both win */
function hasContradiction(a: BetSlipItem, b: BetSlipItem): boolean {
  if (a.matchId !== b.matchId) return false
  if (a.marketType === b.marketType) return false

  const has = (m: string, s: string) =>
    (a.marketType === m && a.selection === s) || (b.marketType === m && b.selection === s)

  // 1X2 ↔ Double Chance
  if (has('1x2', 'home') && has('double_chance', 'x2')) return true
  if (has('1x2', 'away') && has('double_chance', '1x')) return true
  if (has('1x2', 'draw') && has('double_chance', '12')) return true

  // Exact score contradictions
  const exact = a.marketType === 'exact_score' ? a : b.marketType === 'exact_score' ? b : null
  if (exact) {
    const [hg, ag] = exact.selection.split(':').map(Number)
    const t = hg + ag
    const diff = hg - ag
    if (has('1x2', 'home') && ag > hg) return true
    if (has('1x2', 'away') && hg >= ag) return true
    if (has('1x2', 'draw') && hg !== ag) return true
    if (has('over_under_3_5', 'over_3.5') && t <= 3) return true
    if (has('over_under_3_5', 'under_3.5') && t >= 4) return true
    if (has('over_under_5_5', 'over_5.5') && t <= 5) return true
    if (has('over_under_5_5', 'under_5.5') && t >= 6) return true
    if (has('over_under_7_5', 'over_7.5') && t <= 7) return true
    if (has('over_under_7_5', 'under_7.5') && t >= 8) return true
    if (has('btts', 'yes') && (hg === 0 || ag === 0)) return true
    if (has('btts', 'no') && hg > 0 && ag > 0) return true
    if (has('handicap', 'home_minus_1_5') && diff < 2) return true
    if (has('handicap', 'away_plus_1_5') && diff >= 2) return true
    if (has('handicap', 'home_minus_2_5') && diff < 3) return true
    if (has('handicap', 'away_plus_2_5') && diff >= 3) return true
  }

  // Handicap vs 1X2 contradictions
  if (has('handicap', 'home_minus_1_5') && has('1x2', 'draw')) return true
  if (has('handicap', 'home_minus_1_5') && has('1x2', 'away')) return true
  if (has('handicap', 'home_minus_2_5') && has('1x2', 'draw')) return true
  if (has('handicap', 'home_minus_2_5') && has('1x2', 'away')) return true

  return false
}

const BetSlipContext = createContext<BetSlipContextValue | null>(null)

export function BetSlipProvider({ children }: { children: React.ReactNode }) {
  const [selections, setSelections] = useState<BetSlipItem[]>([])
  const [mode, setMode] = useState<BetSlipMode>('single')
  const [stakes, setStakes] = useState<StakeMap>({})
  const [comboStake, setComboStake] = useState<number>(10)
  const prevCountRef = useRef(0)

  useEffect(() => {
    const prev = prevCountRef.current
    const curr = selections.length
    if (curr >= 2 && prev < 2) setMode('combo')
    else if (curr <= 1 && prev > 1) setMode('single')
    prevCountRef.current = curr
  }, [selections.length])

  const slipKey = (matchId: number, marketType: MarketType) =>
    `${matchId}-${marketType}`

  const addSelection = useCallback((item: BetSlipItem) => {
    setSelections((prev) => {
      const existing = prev.findIndex(
        (s) => s.matchId === item.matchId && s.marketType === item.marketType
      )
      if (existing >= 0) {
        if (prev[existing].selection === item.selection) {
          return prev.filter((_, i) => i !== existing)
        }
        const next = [...prev]
        next[existing] = item
        return next
      }
      return [...prev, item]
    })
  }, [])

  const removeSelection = useCallback((matchId: number, marketType: MarketType) => {
    setSelections((prev) =>
      prev.filter((s) => !(s.matchId === matchId && s.marketType === marketType))
    )
    setStakes((prev) => {
      const next = { ...prev }
      delete next[slipKey(matchId, marketType)]
      return next
    })
  }, [])

  const clearSlip = useCallback(() => {
    setSelections([])
    setStakes({})
    setComboStake(10)
  }, [])

  const setStake = useCallback((matchId: number, marketType: MarketType, stake: number) => {
    setStakes((prev) => ({ ...prev, [slipKey(matchId, marketType)]: stake }))
  }, [])

  // Combo is invalid if any two selections are from the same match
  const isComboValid = mode !== 'combo' ||
    !selections.some((a, i) => selections.slice(i + 1).some(b => a.matchId === b.matchId))

  const totalComboOdds = selections.reduce((acc, s) => acc * s.oddsValue, 1)
  const potentialPayout = mode === 'combo'
    ? comboStake * totalComboOdds
    : selections.reduce((acc, s) => {
        const stake = stakes[slipKey(s.matchId, s.marketType)] ?? 10
        return acc + stake * s.oddsValue
      }, 0)

  return (
    <BetSlipContext.Provider
      value={{
        selections,
        mode,
        stakes,
        comboStake,
        addSelection,
        removeSelection,
        clearSlip,
        setMode,
        setStake,
        setComboStake,
        totalComboOdds,
        potentialPayout,
        isComboValid,
      }}
    >
      {children}
    </BetSlipContext.Provider>
  )
}

export function useBetSlip() {
  const ctx = useContext(BetSlipContext)
  if (!ctx) throw new Error('useBetSlip must be used within BetSlipProvider')
  return ctx
}
