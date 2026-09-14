'use client'

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { BetSlipItem, MarketType } from '@/types'
import { cappedPayout, previewComboIsRisky, previewSingleIsRisky } from '@/lib/payout'

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
  removeSelection: (matchId: number, marketType: MarketType, selection?: string, specialId?: number) => void
  clearSlip: () => void
  setMode: (mode: BetSlipMode) => void
  setStake: (matchId: number, marketType: MarketType, stake: number, selection?: string, specialId?: number) => void
  setComboStake: (stake: number) => void
  totalComboOdds: number
  /** Preview payout, capped at the applicable max-payout limit (see
   *  lib/payout.ts) — this is what the user will actually see credited. */
  potentialPayout: number
  /** Uncapped stake × odds — compare against `potentialPayout` to know
   *  whether the cap is currently kicking in. */
  theoreticalPayout: number
  isComboValid: boolean
}

function isGoalscorerMarket(m: MarketType): boolean {
  return m === 'goalscorer' || m === 'goalscorer_2plus'
}

function isSpecialMarket(m: MarketType): boolean {
  return m === 'matchday_special'
}

/** Stable per-line key. Goalscorer lines key by player. Spieltag-Specials key
 *  by their own specialId — matchId is only a technical FK anchor (the
 *  Special's representative_match_id), and multiple Specials in the same
 *  Spieltag share that same anchor match, so keying by matchId+marketType
 *  alone would collide them (and collide their "over"/"under" selections
 *  too). All other markets key by match+market. */
export function bsKey(matchId: number, marketType: MarketType, selection: string, specialId?: number): string {
  if (isSpecialMarket(marketType)) return `special-${specialId}-${selection}`
  if (isGoalscorerMarket(marketType)) return `${matchId}-${marketType}-${selection}`
  return `${matchId}-${marketType}`
}

/** Identity used for combo-mode "same game" conflict detection. Two normal
 *  selections conflict when they share a match; two Specials conflict only
 *  when they're the literal same Special (different Specials sharing a
 *  representative match are independent markets and may coexist — and a
 *  Special legally combines with a normal bet on its anchor match too, per
 *  the same server-side exemption in app/api/bets/place/route.ts). */
function comboIdentity(s: BetSlipItem): string {
  return isSpecialMarket(s.marketType) ? `special-${s.specialId}` : `match-${s.matchId}`
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
      const newKey = bsKey(item.matchId, item.marketType, item.selection, item.specialId)
      // Toggle off on an exact repeat pick.
      const wasSelected = prev.some((s) => bsKey(s.matchId, s.marketType, s.selection, s.specialId) === newKey)
      if (wasSelected) {
        return prev.filter((s) => bsKey(s.matchId, s.marketType, s.selection, s.specialId) !== newKey)
      }
      // Combo mode: a same-game combo is never valid (see isComboValid below),
      // so a new pick for a match/Special already represented in the combo
      // replaces it outright — two legs from the same match (or the same
      // Special) would just be rejected.
      // Single mode: different markets on the same match (or, for Torschütze,
      // different players; or different Specials) are independent slips and
      // coexist; only a different selection within the SAME market/slot
      // replaces the previous choice there (changing your mind, e.g.
      // Heimsieg → Unentschieden).
      const withoutConflicting = mode === 'combo'
        ? prev.filter((s) => comboIdentity(s) !== comboIdentity(item))
        : prev.filter((s) => bsKey(s.matchId, s.marketType, s.selection, s.specialId) !== newKey)
      return [...withoutConflicting, item]
    })
  }, [mode])

  const removeSelection = useCallback((matchId: number, marketType: MarketType, selection?: string, specialId?: number) => {
    setSelections((prev) =>
      prev.filter((s) => {
        if (s.matchId !== matchId || s.marketType !== marketType) return true
        if (isSpecialMarket(marketType)) return s.specialId !== specialId
        if (isGoalscorerMarket(marketType)) return s.selection !== selection
        return false
      })
    )
    setStakes((prev) => {
      const next = { ...prev }
      delete next[bsKey(matchId, marketType, selection ?? '', specialId)]
      return next
    })
  }, [])

  const clearSlip = useCallback(() => {
    setSelections([])
    setStakes({})
    setComboStake(10)
  }, [])

  const setStake = useCallback((matchId: number, marketType: MarketType, stake: number, selection?: string, specialId?: number) => {
    setStakes((prev) => ({ ...prev, [bsKey(matchId, marketType, selection ?? '', specialId)]: stake }))
  }, [])

  // Combo is invalid if any two selections are from the same match/Special
  // (same-game-combo is never allowed), or if more than one Spieltag-Special
  // is in the combo (correlation risk — SPIELTAG-SPECIALS requirement 3).
  const specialCount = selections.filter((s) => isSpecialMarket(s.marketType)).length
  const isComboValid = mode !== 'combo' ||
    (!selections.some((a, i) => selections.slice(i + 1).some(b => comboIdentity(a) === comboIdentity(b)))
      && specialCount <= 1)

  const totalComboOdds = selections.reduce((acc, s) => acc * s.oddsValue, 1)

  // Combo mode: one slip, the cap applies once to comboStake × totalComboOdds.
  // Single mode: each selection is its OWN independent bet slip (placed and
  // settled separately) — the cap must apply per selection, then the capped
  // amounts are summed for display, not the other way round.
  const theoreticalPayout = mode === 'combo'
    ? comboStake * totalComboOdds
    : selections.reduce((acc, s) => {
        const stake = stakes[bsKey(s.matchId, s.marketType, s.selection)] ?? 10
        return acc + stake * s.oddsValue
      }, 0)
  const potentialPayout = mode === 'combo'
    ? cappedPayout(comboStake, totalComboOdds, previewComboIsRisky(totalComboOdds))
    : selections.reduce((acc, s) => {
        const stake = stakes[bsKey(s.matchId, s.marketType, s.selection)] ?? 10
        return acc + cappedPayout(stake, s.oddsValue, previewSingleIsRisky(selections.length, s.oddsValue))
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
        theoreticalPayout,
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
