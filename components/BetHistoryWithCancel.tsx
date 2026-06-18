'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

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

const MARKET_LABELS: Record<string, string> = {
  '1x2': '1X2',
  double_chance: 'Doppelte Chance',
  over_under: 'Ü/U 2,5',
  over_under_3_5: 'Ü/U 3,5',
  over_under_5_5: 'Ü/U 5,5',
  over_under_7_5: 'Ü/U 7,5',
  btts: 'Beide treffen',
  exact_score: 'Genaues Ergebnis',
  handicap: 'Handicap',
  goalscorer: 'Torschütze',
  goalscorer_2plus: 'Mindestens 2 Tore',
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

function fmtOdds(n: number): string {
  return n.toFixed(2).replace('.', ',')
}

function fmtAmt(n: number): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function matchLabel(bet: Bet) {
  const m = bet.match
  if (!m) return 'Unbekanntes Spiel'
  const h = m.home_team?.name ?? '?'
  const a = m.away_team?.name ?? '?'
  return `${h} – ${a}`
}

function scoreStr(bet: Bet) {
  const m = bet.match
  if (!m || m.home_score === null) return null
  return `${m.home_score}:${m.away_score}`
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'won') return (
    <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </div>
  )
  if (status === 'lost') return (
    <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
  )
  return (
    <div className="w-8 h-8 rounded-full bg-yellow-400 flex items-center justify-center flex-shrink-0">
      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </div>
  )
}

function SingleBetCard({
  bet,
  cancellable,
  onCancel,
  isCancelling,
  players,
  highlighted,
  highlightType,
  cardRef,
}: {
  bet: Bet
  players?: Record<number, string>
  cancellable: boolean
  onCancel: () => void
  isCancelling: boolean
  highlighted?: boolean
  highlightType?: 'won' | 'lost'
  cardRef?: React.RefObject<HTMLDivElement | null>
}) {
  const [faded, setFaded] = useState(false)

  useEffect(() => {
    if (!highlighted) return
    const timer = setTimeout(() => setFaded(true), 3000)
    return () => clearTimeout(timer)
  }, [highlighted])

  const score = scoreStr(bet)
  const potentialPayout = (bet.stake ?? 0) * (bet.odds_value ?? 1)

  const borderColor = bet.status === 'won' ? 'border-l-green-500' :
    bet.status === 'lost' ? 'border-l-red-400' : 'border-l-yellow-400'
  const bgColor = bet.status === 'won' ? 'bg-green-50 dark:bg-green-900/20' :
    bet.status === 'lost' ? 'bg-red-50/40 dark:bg-red-900/10' : 'bg-white dark:bg-gray-800'

  const highlightRing = highlighted && !faded
    ? highlightType === 'won'
      ? 'ring-2 ring-green-400 shadow-green-100 shadow-md'
      : 'ring-2 ring-red-400 shadow-red-100 shadow-md'
    : ''

  return (
    <div
      ref={cardRef}
      style={{ transition: 'box-shadow 0.8s ease, outline 0.8s ease', opacity: highlighted && faded ? 1 : undefined }}
      className={`flex items-center gap-3 px-4 py-3 border-l-4 ${borderColor} ${bgColor} ${highlightRing}`}
    >
      <StatusIcon status={bet.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {bet.match?.matchday && (
            <span className="text-[10px] bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-300 px-1.5 py-0.5 rounded font-semibold flex-shrink-0">
              ST {bet.match.matchday}
            </span>
          )}
          <div className="text-xs text-gray-400 dark:text-gray-500 truncate">{matchLabel(bet)}</div>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded font-medium">
            {MARKET_LABELS[bet.market_type] ?? bet.market_type}
          </span>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {selLabel(bet.market_type, bet.selection, players)}
          </span>
        </div>
        {score && (
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Ergebnis: <span className="font-semibold text-gray-600 dark:text-gray-300">{score}</span></div>
        )}
      </div>
      <div className="text-right flex-shrink-0 space-y-0.5">
        <div className="text-sm font-black text-red-700">@{bet.odds_value !== null ? fmtOdds(bet.odds_value) : '–'}</div>
        <div className="text-xs text-gray-400">{bet.stake !== null ? fmtAmt(bet.stake) : '–'}€</div>
        {bet.status === 'won' && bet.payout !== null && (
          <div className="text-xs font-bold text-green-600">+{fmtAmt(bet.payout)}€</div>
        )}
        {bet.status === 'pending' && (
          <div className="text-xs text-gray-400">→ {fmtAmt(potentialPayout)}€</div>
        )}
        {bet.status === 'lost' && (
          <div className="text-xs text-red-400 line-through">{bet.stake !== null ? fmtAmt(bet.stake) : '–'}€</div>
        )}
        {cancellable && bet.status === 'pending' && (
          <button
            onClick={onCancel}
            disabled={isCancelling}
            className="text-[10px] px-2 py-0.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-40 font-medium"
          >
            {isCancelling ? '…' : 'Stornieren'}
          </button>
        )}
      </div>
    </div>
  )
}

function ComboBetCard({
  legs,
  cb,
  cancellable,
  onCancel,
  isCancelling,
  players,
  highlighted,
  highlightType,
  cardRef,
}: {
  legs: Bet[]
  cb: ComboData | undefined
  cancellable: boolean
  onCancel: () => void
  isCancelling: boolean
  players?: Record<number, string>
  highlighted?: boolean
  highlightType?: 'won' | 'lost'
  cardRef?: React.RefObject<HTMLDivElement | null>
}) {
  const [faded, setFaded] = useState(false)

  useEffect(() => {
    if (!highlighted) return
    const timer = setTimeout(() => setFaded(true), 3000)
    return () => clearTimeout(timer)
  }, [highlighted])

  const dbSt = cb?.status ?? 'pending'
  const status = (dbSt === 'won' || dbSt === 'lost') ? dbSt
    : legs.some(l => l.status === 'lost') ? 'lost'
    : legs.every(l => l.status === 'won') ? 'won'
    : 'pending'
  const stake = cb?.stake ?? 0
  const totalOdds = cb?.total_odds ?? legs.reduce((acc, l) => acc * (l.odds_value ?? 1), 1)
  const potentialPayout = stake * totalOdds

  const borderColor = status === 'won' ? 'border-l-green-500' :
    status === 'lost' ? 'border-l-red-400' : 'border-l-yellow-400'
  const bgColor = status === 'won' ? 'bg-green-50 dark:bg-green-900/20' :
    status === 'lost' ? 'bg-red-50/40 dark:bg-red-900/10' : 'bg-white dark:bg-gray-800'

  const highlightRing = highlighted && !faded
    ? highlightType === 'won'
      ? 'ring-2 ring-green-400 shadow-green-100 shadow-md'
      : 'ring-2 ring-red-400 shadow-red-100 shadow-md'
    : ''

  return (
    <div
      ref={cardRef}
      style={{ transition: 'box-shadow 0.8s ease, outline 0.8s ease' }}
      className={`px-4 py-3 border-l-4 ${borderColor} ${bgColor} ${highlightRing}`}
    >
      {/* Combo Header */}
      <div className="flex items-center gap-3 mb-2">
        <StatusIcon status={status} />
        <div className="flex-1">
          <div className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
            <span className="text-blue-600">🔗</span>
            Kombiwette · {legs.length} Tipps
            {legs[0]?.match?.matchday && (
              <span className="text-[10px] bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-300 px-1.5 py-0.5 rounded font-semibold">
                ST {legs[0].match.matchday}
              </span>
            )}
          </div>
          <div className="text-xs text-gray-400 dark:text-gray-500">
            Quote {fmtOdds(totalOdds)} · Einsatz {fmtAmt(stake)}€
          </div>
        </div>
        <div className="text-right flex-shrink-0 space-y-0.5">
          {status === 'won' && cb?.payout !== null && cb?.payout !== undefined && (
            <div className="text-sm font-black text-green-600">+{fmtAmt(cb.payout)}€</div>
          )}
          {status === 'pending' && (
            <div className="text-xs text-gray-500 dark:text-gray-400">→ {fmtAmt(potentialPayout)}€</div>
          )}
          {status === 'lost' && (
            <div className="text-xs text-red-400 line-through">{fmtAmt(stake)}€</div>
          )}
          {cancellable && status === 'pending' && (
            <button
              onClick={onCancel}
              disabled={isCancelling}
              className="text-[10px] px-2 py-0.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-40 font-medium"
            >
              {isCancelling ? '…' : 'Stornieren'}
            </button>
          )}
        </div>
      </div>

      {/* Legs */}
      <div className="pl-11 space-y-1.5">
        {legs.map((leg) => {
          const score = scoreStr(leg)
          const legStatus = leg.status
          return (
            <div key={leg.id} className="flex items-center gap-2 text-xs">
              <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                legStatus === 'won' ? 'bg-green-500' :
                legStatus === 'lost' ? 'bg-red-400' : 'bg-yellow-400'
              }`} />
              <span className="text-gray-500 dark:text-gray-400 truncate flex-1">{matchLabel(leg)}</span>
              <span className="font-medium text-gray-800 dark:text-gray-200">{selLabel(leg.market_type, leg.selection, players)}</span>
              {score && <span className="text-gray-400 dark:text-gray-500">({score})</span>}
              <span className="text-red-700 font-bold">@{leg.odds_value !== null ? fmtOdds(leg.odds_value) : '–'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function BetHistoryWithCancel({ items, matchdayDeadlinesPassed, playerNameMap, highlightDedupeKey }: Props) {
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const router = useRouter()

  // Parse the dedupeKey to determine the highlighted match id and type
  // Format: "settlement-win-<userId>-<matchId>" or "settlement-loss-<userId>-<matchId>"
  const highlightMatchId = highlightDedupeKey
    ? parseInt(highlightDedupeKey.split('-').at(-1) ?? '', 10)
    : null
  const highlightType: 'won' | 'lost' | null = highlightDedupeKey?.includes('-win-')
    ? 'won'
    : highlightDedupeKey?.includes('-loss-')
    ? 'lost'
    : null

  const highlightRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightDedupeKey])

  async function cancelBet(betId?: string, comboId?: string) {
    const key = betId ? `bet-${betId}` : `combo-${comboId}`
    setCancellingId(key)
    setCancelError(null)
    try {
      const res = await fetch('/api/bets/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(betId ? { betId: parseInt(betId) } : { comboId: parseInt(comboId!) }),
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
      // Postponed = no actual kickoff yet; cancellable until kickoff of rescheduled game
      if (m.status === 'postponed') return true
      return new Date(m.match_date) > now
    }
    // Combo: locked as soon as any non-postponed leg's match has started
    for (const leg of item.legs) {
      const m = leg.match
      if (!m) continue
      if (m.status !== 'postponed' && new Date(m.match_date) <= now) return false
    }
    return item.legs.length > 0
  }

  return (
    <div className="divide-y divide-gray-50 dark:divide-gray-700">
      {cancelError && (
        <div className="px-4 py-2 bg-red-50 text-red-700 text-xs border-b border-red-100 flex items-center gap-2">
          <span className="flex-1">{cancelError}</span>
          <button onClick={() => setCancelError(null)}>✕</button>
        </div>
      )}
      {items.map((item) => {
        const cancellable = !cancellingId && canCancel(item)
        if (item.kind === 'single') {
          const matchId = item.bet.match?.id
          const isHighlighted = highlightMatchId !== null && !isNaN(highlightMatchId) && matchId === highlightMatchId
          return (
            <SingleBetCard
              key={item.bet.id}
              bet={item.bet}
              cancellable={cancellable}
              onCancel={() => cancelBet(item.bet.id)}
              isCancelling={cancellingId === `bet-${item.bet.id}`}
              players={playerNameMap}
              highlighted={isHighlighted}
              highlightType={highlightType ?? undefined}
              cardRef={isHighlighted ? highlightRef : undefined}
            />
          )
        }
        const comboMatchIds = item.legs.map(l => l.match?.id)
        const isHighlighted = highlightMatchId !== null && !isNaN(highlightMatchId) && comboMatchIds.includes(highlightMatchId)
        return (
          <ComboBetCard
            key={item.comboId}
            legs={item.legs}
            cb={item.cb}
            cancellable={cancellable}
            onCancel={() => cancelBet(undefined, item.comboId)}
            isCancelling={cancellingId === `combo-${item.comboId}`}
            players={playerNameMap}
            highlighted={isHighlighted}
            highlightType={highlightType ?? undefined}
            cardRef={isHighlighted ? highlightRef : undefined}
          />
        )
      })}
    </div>
  )
}
