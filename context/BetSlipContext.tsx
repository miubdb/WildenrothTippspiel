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
  removeSelection: (matchId: number, marketType: MarketType, selection?: string) => void
  clearSlip: () => void
  setMode: (mode: BetSlipMode) => void
  setStake: (matchId: number, marketType: MarketType, stake: number, selection?: string) => void
  setComboStake: (stake: number) => void
  totalComboOdds: number
  potentialPayout: number
  isComboValid: boolean
}

function isGoalscorerMarket(m: MarketType): boolean {
  return m === 'goalscorer' || m === 'goalscorer_2plus'
}

/** Stable per-line key. Goalscorer lines key by player; all others by market. */
export function bsKey(matchId: number, marketType: MarketType, selection: string): string {
  if (isGoalscorerMarket(marketType)) return `${matchId}-${marketType}-${selection}`
  return `${matchId}-${marketType}`
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

  const addSelection = useCallback((item: BetSlipItem) => {
    setSelections((prev) => {
      const newKey = bsKey(item.matchId, item.marketType, item.selection)
      // Toggle off on an exact repeat pick.
      const wasSelected = prev.some(
        (s) => s.matchId === item.matchId && s.marketType === item.marketType && s.selection === item.selection
      )
      if (wasSelected) {
        return prev.filter((s) => bsKey(s.matchId, s.marketType, s.selection) !== newKey)
      }
      // Combo mode: a same-game combo is never valid (see isComboValid below),
      // so a new pick for a match already represented in the combo replaces
      // it outright — two legs from the same match would just be rejected.
      // Single mode: different markets on the same match (or, for Torschütze,
      // different players) are independent slips and coexist; only a
      // different selection within the SAME market/slot on the same match
      // replaces the previous choice there (changing your mind, e.g.
      // Heimsieg → Unentschieden).
      const withoutConflicting = mode === 'combo'
        ? prev.filter((s) => s.matchId !== item.matchId)
        : prev.filter((s) => bsKey(s.matchId, s.marketType, s.selection) !== newKey)
      return [...withoutConflicting, item]
    })
  }, [mode])

  const removeSelection = useCallback((matchId: number, marketType: MarketType, selection?: string) => {
    setSelections((prev) =>
      prev.filter((s) => {
        if (s.matchId !== matchId || s.marketType !== marketType) return true
        if (isGoalscorerMarket(marketType)) return s.selection !== selection
        return false
      })
    )
    setStakes((prev) => {
      const next = { ...prev }
      delete next[bsKey(matchId, marketType, selection ?? '')]
      return next
    })
  }, [])

  const clearSlip = useCallback(() => {
    setSelections([])
    setStakes({})
    setComboStake(10)
  }, [])

  const setStake = useCallback((matchId: number, marketType: MarketType, stake: number, selection?: string) => {
    setStakes((prev) => ({ ...prev, [bsKey(matchId, marketType, selection ?? '')]: stake }))
  }, [])

  // Combo is invalid if any two selections are from the same match (same-game-combo is never allowed).
  const isComboValid = mode !== 'combo' ||
    !selections.some((a, i) => selections.slice(i + 1).some(b => a.matchId === b.matchId))

  const totalComboOdds = selections.reduce((acc, s) => acc * s.oddsValue, 1)
  const potentialPayout = mode === 'combo'
    ? comboStake * totalComboOdds
    : selections.reduce((acc, s) => {
        const stake = stakes[bsKey(s.matchId, s.marketType, s.selection)] ?? 10
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
