'use client'

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { BetSlipItem, MarketType } from '@/types'
import { cappedPayout, previewComboIsRisky, previewSingleIsRisky } from '@/lib/payout'
import { selectionsContradict } from '@/lib/betContradictions'

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

/** Whether `selections` could EVER form one valid combo: no match/Special
 *  repeated (a same-game combo is never allowed — see the server-side check
 *  in app/api/bets/place/route.ts) and at most one Spieltag-Special
 *  (correlation risk — SPIELTAG-SPECIALS requirement 3). Shared by the
 *  auto single/combo classification below AND `isComboValid` so the two can
 *  never drift apart — classifying a set of picks as "combo" that this
 *  function would call incapable is exactly the bug this guards against. */
function canFormCombo(selections: BetSlipItem[]): boolean {
  const identities = selections.map(comboIdentity)
  const noDuplicateMatch = new Set(identities).size === identities.length
  const specialCount = selections.filter((s) => isSpecialMarket(s.marketType)).length
  return identities.length >= 2 && noDuplicateMatch && specialCount <= 1
}

const BetSlipContext = createContext<BetSlipContextValue | null>(null)

export function BetSlipProvider({ children }: { children: React.ReactNode }) {
  const [selections, setSelections] = useState<BetSlipItem[]>([])
  const [mode, setMode] = useState<BetSlipMode>('single')
  const [stakes, setStakes] = useState<StakeMap>({})
  const [comboStake, setComboStake] = useState<number>(10)
  // Whether the current slip is capable of forming ONE combo (canFormCombo
  // above), not just whether it has 2+ selections — two compatible picks on
  // the SAME match (e.g. 1X2 + Torschütze) plus a pick on a second match is
  // 3 selections across 2 matches, but match A appears twice, so no combo
  // can ever be formed from it; auto-promoting to 'combo' there would
  // immediately show "Ungültige Kombination" for picks that were only ever
  // meant to be independent single bets. Same for 2+ Specials. The slip
  // stays/falls back to 'single' (every pick its own bet) whenever this is
  // false, and only promotes to 'combo' once the WHOLE set could actually
  // combine — exactly mirroring isComboValid's own criteria below, so the
  // automatic classification can never land somewhere the validity check
  // would then reject.
  const prevComboCapableRef = useRef(false)

  useEffect(() => {
    const capable = canFormCombo(selections)
    const prev = prevComboCapableRef.current
    if (capable && !prev) setMode('combo')
    else if (!capable && prev) setMode('single')
    prevComboCapableRef.current = capable
  }, [selections])

  const addSelection = useCallback((item: BetSlipItem) => {
    setSelections((prev) => {
      const newKey = bsKey(item.matchId, item.marketType, item.selection, item.specialId)
      // Toggle off on an exact repeat pick — same slot AND same selection
      // value. bsKey alone is not enough: it intentionally omits the
      // selection for regular markets (see bsKey's doc comment above), so
      // comparing it alone would also match "a different pick in the same
      // market", wrongly treating that as "the exact same pick again" and
      // just removing it instead of replacing it below.
      const exactRepeat = prev.find((s) => bsKey(s.matchId, s.marketType, s.selection, s.specialId) === newKey && s.selection === item.selection)
      if (exactRepeat) {
        return prev.filter((s) => s !== exactRepeat)
      }
      // A new pick always replaces: (a) anything already in the exact same
      // slot (same bsKey — a different choice in the same market/Special),
      // and (b) on the SAME match, anything it logically contradicts across
      // markets (lib/betContradictions.ts) — e.g. picking "1X" after "1"
      // replaces it instead of stacking alongside it, which would otherwise
      // only surface as an "Ungültige Kombination" once a second match makes
      // this a real combo. This holds regardless of the current `mode`: two
      // same-match legs can never be combined into one valid combo bet, so
      // the replace decision cannot depend on how many OTHER matches are
      // already in the slip. Goalscorer/Special picks are exempt from the
      // contradiction check — their `selection` is a player/Special id, not a
      // market outcome, so two different ones are independent, not opposing.
      // Genuinely independent, non-contradicting markets on the same match
      // (e.g. 1X2 + Torschütze, or 1X2 + a Handicap pair outside the
      // impossible combinations) still coexist as separate single bets — see
      // the mode-promotion effect above for why that no longer gets
      // misclassified as an invalid combo.
      const withoutConflicting = prev.filter((s) => {
        const sameSlot = bsKey(s.matchId, s.marketType, s.selection, s.specialId) === newKey
        const contradicts = s.matchId === item.matchId &&
          !isSpecialMarket(s.marketType) && !isSpecialMarket(item.marketType) &&
          !isGoalscorerMarket(s.marketType) && !isGoalscorerMarket(item.marketType) &&
          selectionsContradict(s, item)
        return !sameSlot && !contradicts
      })
      return [...withoutConflicting, item]
    })
  }, [])

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

  // Only reachable via the manual Einzel/Kombi-toggle now (see
  // canFormCombo/the promotion effect above) — the automatic classification
  // never lands in 'combo' when this would be false, so this stays purely as
  // the "you switched to Kombiwette by hand, but these picks can't combine"
  // guard it always was.
  const isComboValid = mode !== 'combo' || canFormCombo(selections)

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
