'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { WetteCard, type WetteData, type WetteStatus } from '@/components/WetteCard'

type Bet = {
  id: string
  market_type: string
  selection: string
  stake: number | null
  odds_value: number | null
  status: string
  payout: number | null
  combo_id: string | null
  match: {
    id: number
    matchday: number
    match_date: string
    home_score: number | null
    away_score: number | null
    status: string
    home_team: { name: string; short_name: string | null } | null
    away_team: { name: string; short_name: string | null } | null
  } | null
}

type ComboData = { id: string; stake: number; total_odds: number; status: string; payout: number | null }

type HistoryItem =
  | { kind: 'single'; bet: Bet }
  | { kind: 'combo'; comboId: string; legs: Bet[]; cb: ComboData | undefined }

type Props = {
  items: HistoryItem[]
  matchdayDeadlinesPassed: Record<number, boolean>
  playerNameMap?: Record<number, string>
  highlightDedupeKey?: string
}

const SELECTION_LABELS: Record<string, string> = {
  home: 'Heimsieg',
  draw: 'Unentschieden',
  away: 'Auswärtssieg',
  '1x': '1X',
  x2: 'X2',
  '12': '12',
  'over_2.5': 'Über 2,5',
  'under_2.5': 'Unter 2,5',
  'over_3.5': 'Über 3,5',
  'under_3.5': 'Unter 3,5',
  'over_5.5': 'Über 5,5',
  'under_5.5': 'Unter 5,5',
  'over_7.5': 'Über 7,5',
  'under_7.5': 'Unter 7,5',
  yes: 'Beide treffen',
  no: 'Nicht beide',
  home_minus_1_5: 'Heim –1,5',
  away_plus_1_5: 'Gast +1,5',
  home_minus_2_5: 'Heim –2,5',
  away_plus_2_5: 'Gast +2,5',
}

function selLabel(marketType: string, sel: string, players?: Record<number, string>): string {
  if (marketType === 'exact_score') return sel
  if (marketType === 'goalscorer' || marketType === 'goalscorer_2plus') {
    const id = parseInt(sel, 10)
    const name = players?.[id] ?? `Spieler #${id}`
    return marketType === 'goalscorer_2plus' ? `${name} (mind. 2 Tore)` : name
  }
  return SELECTION_LABELS[sel] ?? sel
}

function betMatchName(bet: Bet): string {
  const m = bet.match
  if (!m) return 'Unbekanntes Spiel'
  return `${m.home_team?.name ?? '?'} – ${m.away_team?.name ?? '?'}`
}

function betScore(bet: Bet): string | null {
  const m = bet.match
  if (!m || m.home_score === null) return null
  return `${m.home_score}:${m.away_score}`
}

function toWetteData(item: HistoryItem, players?: Record<number, string>): WetteData {
  if (item.kind === 'single') {
    const b = item.bet
    return {
      id: `bet-${b.id}`,
      type: 'single',
      totalOdds: b.odds_value ?? 1,
      stake: b.stake ?? 0,
      payout: b.payout,
      status: b.status as WetteStatus,
      betId: parseInt(b.id),
      legs: [{
        id: parseInt(b.id),
        matchName: betMatchName(b),
        market: b.market_type,
        selection: selLabel(b.market_type, b.selection, players),
        odds: b.odds_value ?? 1,
        status: b.status as WetteStatus,
        score: betScore(b),
      }],
    }
  }

  const { legs, cb } = item
  const dbSt = cb?.status ?? 'pending'
  const status: WetteStatus =
    (dbSt === 'won' || dbSt === 'lost') ? dbSt as WetteStatus
    : legs.some(l => l.status === 'lost') ? 'lost'
    : legs.every(l => l.status === 'won') ? 'won'
    : 'pending'
  const totalOdds = cb?.total_odds ?? legs.reduce((acc, l) => acc * (l.odds_value ?? 1), 1)

  return {
    id: `combo-${item.comboId}`,
    type: 'combo',
    totalOdds,
    stake: cb?.stake ?? 0,
    payout: cb?.payout,
    status,
    comboId: parseInt(item.comboId),
    legs: legs.map(leg => ({
      id: parseInt(leg.id),
      matchName: betMatchName(leg),
      market: leg.market_type,
      selection: selLabel(leg.market_type, leg.selection, players),
      odds: leg.odds_value ?? 1,
      status: leg.status as WetteStatus,
      score: betScore(leg),
    })),
  }
}

export function BetHistoryWithCancel({ items, matchdayDeadlinesPassed, playerNameMap, highlightDedupeKey }: Props) {
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const router = useRouter()

  const highlightMatchId = highlightDedupeKey
    ? parseInt(highlightDedupeKey.split('-').at(-1) ?? '', 10)
    : null

  const highlightRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightDedupeKey])

  async function cancelBet(betId?: number, comboId?: number) {
    const key = betId ? `bet-${betId}` : `combo-${comboId}`
    setCancellingId(key)
    setCancelError(null)
    try {
      const res = await fetch('/api/bets/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(betId ? { betId } : { comboId }),
      })
      const data = await res.json()
      if (!res.ok) setCancelError(data.error ?? 'Stornierung fehlgeschlagen.')
      else router.refresh()
    } catch {
      setCancelError('Netzwerkfehler.')
    } finally {
      setCancellingId(null)
    }
  }

  function canCancel(item: HistoryItem): boolean {
    const now = new Date()
    if (item.kind === 'single') {
      const m = item.bet.match
      if (!m) return false
      if (m.status === 'postponed') return true
      return new Date(m.match_date) > now
    }
    for (const leg of item.legs) {
      const m = leg.match
      if (!m) continue
      if (m.status !== 'postponed' && new Date(m.match_date) <= now) return false
    }
    return item.legs.length > 0
  }

  function getHighlightRef(item: HistoryItem): React.RefObject<HTMLDivElement | null> | undefined {
    if (highlightMatchId === null || isNaN(highlightMatchId)) return undefined
    if (item.kind === 'single' && item.bet.match?.id === highlightMatchId) return highlightRef
    if (item.kind === 'combo' && item.legs.some(l => l.match?.id === highlightMatchId)) return highlightRef
    return undefined
  }

  return (
    <div className="space-y-2 px-4 py-2">
      {cancelError && (
        <div className="bg-red-50 text-red-700 text-xs px-3 py-2 rounded-xl border border-red-100 flex items-center gap-2">
          <span className="flex-1">{cancelError}</span>
          <button onClick={() => setCancelError(null)}>✕</button>
        </div>
      )}
      {items.map((item) => {
        const wette = toWetteData(item, playerNameMap)
        const cancellable = !cancellingId && canCancel(item)
        const ref = getHighlightRef(item)
        return (
          <div key={wette.id} ref={ref}>
            <WetteCard
              wette={wette}
              onCancel={cancellable ? cancelBet : undefined}
              cancellingId={cancellingId}
              isDeadlinePassed={!cancellable}
            />
          </div>
        )
      })}
    </div>
  )
}
