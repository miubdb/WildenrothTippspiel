'use client'

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { BetSlipItem, MarketType } from '@/types'

type BetSlipMode = 'single' | 'combo'

interface StakeMap {
  [key: string]: number  // key: `${matchId}-${marketType}`
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
      // Replace if same match + market already in slip
      const existing = prev.findIndex(
        (s) => s.matchId === item.matchId && s.marketType === item.marketType
      )
      if (existing >= 0) {
        // If same selection, remove it (toggle off)
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
