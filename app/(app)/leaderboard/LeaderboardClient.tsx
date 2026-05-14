'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ReactionBar } from '@/components/ReactionBar'
import { CommentSection, type CommentData } from '@/components/CommentSection'

const STARTING_BALANCE = 1000

const MARKET_LABEL: Record<string, string> = {
  '1x2': 'Spielausgang',
  double_chance: 'Doppelte Chance',
  over_under: 'Ü/U 2,5',
  over_under_3_5: 'Ü/U 3,5',
  over_under_5_5: 'Ü/U 5,5',
  over_under_7_5: 'Ü/U 7,5',
  btts: 'Beide treffen',
  exact_score: 'Genaues Ergebnis',
  handicap: 'Handicap',
}

const SEL_LABEL: Record<string, Record<string, string>> = {
  '1x2': { home: 'Heimsieg', draw: 'Unentschieden', away: 'Auswärtssieg' },
  double_chance: { '1x': '1X', x2: 'X2', '12': '12' },
  over_under: { 'over_2.5': 'Über 2,5', 'under_2.5': 'Unter 2,5' },
  over_under_3_5: { 'over_3.5': 'Über 3,5', 'under_3.5': 'Unter 3,5' },
  over_under_5_5: { 'over_5.5': 'Über 5,5', 'under_5.5': 'Unter 5,5' },
  over_under_7_5: { 'over_7.5': 'Über 7,5', 'under_7.5': 'Unter 7,5' },
  btts: { yes: 'Beide treffen', no: 'Nicht beide' },
  handicap: { home_minus_1_5: 'Heim –1,5', away_plus_1_5: 'Gast +1,5', home_minus_2_5: 'Heim –2,5', away_plus_2_5: 'Gast +2,5' },
}

function selLabel(marketType: string, selection: string) {
  if (marketType === 'exact_score') return selection
  return SEL_LABEL[marketType]?.[selection] ?? selection
}

export type Profile = { id: string; username: string; display_name: string | null; balance: number }
export type BetRow = {
  id: number
  user_id: string
  market_type: string
  selection: string
  stake: number
  odds_value: number
  status: string
  payout: number | null
  combo_id: number | null
  match: {
    id: number
    home_score: number | null
    away_score: number | null
    status: string
    home_team: { name: string; short_name: string }
    away_team: { name: string; short_name: string }
  } | null
}
export type ComboMeta = { id: number; stake: number; total_odds: number; status: string; payout: number | null }
export type MatchdayStats = Record<string, number | null>

// ── Shared sub-components ──────────────────────────────────────────────

function matchName(bet: BetRow) {
  if (!bet.match) return '—'
  return `${bet.match.home_team.name} – ${bet.match.away_team.name}`
}

function scoreStr(bet: BetRow) {
  if (bet.match?.home_score == null) return null
  return `${bet.match.home_score}:${bet.match.away_score}`
}

function StatusIcon({ status, size = 'md' }: { status: string; size?: 'sm' | 'md' }) {
  const sz = size === 'sm' ? 'w-5 h-5' : 'w-7 h-7'
  const ico = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3.5 h-3.5'
  if (status === 'won') return (
    <div className={`${sz} rounded-full bg-green-500 flex items-center justify-center flex-shrink-0`}>
      <svg className={`${ico} text-white`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
    </div>
  )
  if (status === 'lost') return (
    <div className={`${sz} rounded-full bg-red-500 flex items-center justify-center flex-shrink-0`}>
      <svg className={`${ico} text-white`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
    </div>
  )
  return (
    <div className={`${sz} rounded-full bg-yellow-400 flex items-center justify-center flex-shrink-0`}>
      <svg className={`${ico} text-white`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    </div>
  )
}

function fmtAmt(n: number) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function SingleBetMini({ bet, onCancel, cancellingId }: { bet: BetRow; onCancel?: (betId?: number) => void; cancellingId?: string | null }) {
  const score = scoreStr(bet)
  const potential = fmtAmt(bet.stake * bet.odds_value)
  const borderColor = bet.status === 'won' ? 'border-l-green-500' : bet.status === 'lost' ? 'border-l-red-400' : 'border-l-yellow-400'
  const bgColor = bet.status === 'won' ? 'bg-green-50/60' : bet.status === 'lost' ? 'bg-red-50/30' : 'bg-white'
  return (
    <div className={`flex items-start gap-2 py-1.5 px-3 border-l-4 ${borderColor} ${bgColor} rounded-r-lg`}>
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="text-[11px] text-gray-400 truncate leading-tight">{matchName(bet)}</div>
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          <span className="text-[10px] bg-gray-100 text-gray-500 px-1 py-0.5 rounded leading-tight">{MARKET_LABEL[bet.market_type] ?? bet.market_type}</span>
          <span className="text-xs font-semibold text-gray-900">{selLabel(bet.market_type, bet.selection)}</span>
          {score && <span className="text-[11px] text-gray-400 ml-0.5">{score}</span>}
        </div>
      </div>
      <div className="text-right flex-shrink-0 pt-0.5 space-y-0.5">
        <div className="text-xs font-bold text-red-700">@{bet.odds_value.toFixed(2).replace('.', ',')}</div>
        <div className="text-[10px] text-gray-400 whitespace-nowrap">
          {fmtAmt(bet.stake)} €
          {bet.status === 'pending' && <span className="text-gray-400"> → {potential} €</span>}
        </div>
        {bet.status === 'won' && bet.payout != null && (
          <div className="text-[10px] font-semibold text-green-600">+{fmtAmt(bet.payout)} €</div>
        )}
        {bet.status === 'lost' && (
          <div className="text-[10px] text-red-400 line-through">{fmtAmt(bet.stake)} €</div>
        )}
        {onCancel && bet.status === 'pending' && (
          <button
            onClick={() => onCancel(bet.id)}
            disabled={cancellingId === `bet-${bet.id}`}
            className="text-[10px] px-1.5 py-0.5 border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-40 font-medium"
          >
            {cancellingId === `bet-${bet.id}` ? '…' : 'Storno'}
          </button>
        )}
      </div>
    </div>
  )
}

function ComboBetMini({ legs, cb, onCancel, cancellingId }: { legs: BetRow[]; cb: ComboMeta | undefined; onCancel?: (comboId?: number) => void; cancellingId?: string | null }) {
  const status = cb?.status ?? 'pending'
  const stake = cb?.stake ?? 0
  const totalOdds = cb?.total_odds ?? legs.reduce((acc, l) => acc * l.odds_value, 1)
  const potential = fmtAmt(stake * totalOdds)
  const borderColor = status === 'won' ? 'border-l-green-500' : status === 'lost' ? 'border-l-red-400' : 'border-l-yellow-400'
  const bgColor = status === 'won' ? 'bg-green-50/60' : status === 'lost' ? 'bg-red-50/30' : 'bg-white'
  return (
    <div className={`py-1.5 px-3 border-l-4 ${borderColor} ${bgColor} rounded-r-lg`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="text-[11px] text-gray-400 leading-tight truncate">🔗 Kombiwette · {legs.length} Tipps</div>
          <div className="space-y-0.5 mt-1">
            {legs.map(leg => {
              const score = scoreStr(leg)
              return (
                <div key={leg.id} className="flex items-center gap-1 text-[11px]">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-px ${leg.status === 'won' ? 'bg-green-500' : leg.status === 'lost' ? 'bg-red-400' : 'bg-yellow-400'}`} />
                  <span className="text-gray-500 truncate flex-1 min-w-0">{matchName(leg)}</span>
                  <span className="font-medium text-gray-800 flex-shrink-0 ml-1">{selLabel(leg.market_type, leg.selection)}</span>
                  {score && <span className="text-gray-400 flex-shrink-0">({score})</span>}
                  <span className="text-red-700 font-bold flex-shrink-0">@{leg.odds_value.toFixed(2).replace('.', ',')}</span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="text-right flex-shrink-0 pt-0.5 space-y-0.5">
          <div className="text-xs font-bold text-red-700">@{totalOdds.toFixed(2).replace('.', ',')}</div>
          <div className="text-[10px] text-gray-400 whitespace-nowrap">
            {fmtAmt(stake)} €
            {status === 'pending' && <span> → {potential} €</span>}
          </div>
          {status === 'won' && cb?.payout != null && (
            <div className="text-[10px] font-semibold text-green-600">+{fmtAmt(cb.payout)} €</div>
          )}
          {status === 'lost' && (
            <div className="text-[10px] text-red-400 line-through">{fmtAmt(stake)} €</div>
          )}
          {onCancel && status === 'pending' && (
            <button
              onClick={() => onCancel(cb?.id)}
              disabled={cancellingId === `combo-${cb?.id}`}
              className="text-[10px] px-1.5 py-0.5 border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-40 font-medium"
            >
              {cancellingId === `combo-${cb?.id}` ? '…' : 'Storno'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

type ReactionData = { target_type: string; target_id: number; emoji: string; user_id: string }

function UserBets({ bets, combos, noDataLabel, reactions, comments, currentUserId, currentUserName, isAdmin, isOwnBets, isDeadlinePassed, onCancel, cancellingId: cancelId }: {
  bets: BetRow[]; combos: Record<string, ComboMeta>; noDataLabel: string
  reactions: ReactionData[]; comments: CommentData[]; currentUserId: string | null
  currentUserName: string; isAdmin?: boolean
  isOwnBets?: boolean; isDeadlinePassed?: boolean
  onCancel?: (betId?: number, comboId?: number) => void
  cancellingId?: string | null
}) {
  if (bets.length === 0) return <p className="text-xs text-gray-400 italic py-1">{noDataLabel}</p>
  type Item = { kind: 'single'; bet: BetRow } | { kind: 'combo'; legs: BetRow[]; cb: ComboMeta | undefined }
  const seen = new Set<number>()
  const items: Item[] = []
  for (const b of bets) {
    if (!b.combo_id) {
      items.push({ kind: 'single', bet: b })
    } else if (!seen.has(b.combo_id)) {
      seen.add(b.combo_id)
      items.push({ kind: 'combo', legs: bets.filter(x => x.combo_id === b.combo_id), cb: combos[b.combo_id] })
    }
  }
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => {
        if (item.kind === 'single') {
          const betReactions = reactions.filter(r => r.target_type === 'bet' && r.target_id === item.bet.id)
          const betComments = comments.filter(c => c.target_type === 'bet' && c.target_id === item.bet.id)
          return (
            <div key={item.bet.id}>
              <SingleBetMini bet={item.bet} onCancel={isOwnBets && !isDeadlinePassed ? (betId) => onCancel?.(betId) : undefined} cancellingId={cancelId} />
              {currentUserId && (
                <CommentSection
                  targetType="bet"
                  targetId={item.bet.id}
                  currentUserId={currentUserId}
                  currentUserName={currentUserName}
                  initialComments={betComments}
                  isAdmin={isAdmin}
                  socialBarSlot={<ReactionBar targetType="bet" targetId={item.bet.id} currentUserId={currentUserId} initialReactions={betReactions} />}
                />
              )}
            </div>
          )
        }
        const comboId = item.legs[0]?.combo_id
        const comboReactions = comboId ? reactions.filter(r => r.target_type === 'combo' && r.target_id === comboId) : []
        const comboComments = comboId ? comments.filter(c => c.target_type === 'combo' && c.target_id === comboId) : []
        return (
          <div key={i}>
            <ComboBetMini legs={item.legs} cb={item.cb} onCancel={isOwnBets && !isDeadlinePassed ? (comboId) => onCancel?.(undefined, comboId) : undefined} cancellingId={cancelId} />
            {currentUserId && comboId && (
              <CommentSection
                targetType="combo"
                targetId={comboId}
                currentUserId={currentUserId}
                currentUserName={currentUserName}
                initialComments={comboComments}
                isAdmin={isAdmin}
                socialBarSlot={<ReactionBar targetType="combo" targetId={comboId} currentUserId={currentUserId} initialReactions={comboReactions} />}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Profile History Modal ──────────────────────────────────────────────

type HistoryBet = {
  id: number; market_type: string; selection: string; stake: number | null; odds_value: number
  status: string; payout: number | null; combo_id: number | null; created_at: string
  match: { matchday: number; home_score: number | null; away_score: number | null; status: string; home_team: { name: string }; away_team: { name: string } } | null
}
type HistoryCombo = { id: number; stake: number; total_odds: number; status: string; payout: number | null }

function ProfileModal({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const [bets, setBets] = useState<HistoryBet[] | null>(null)
  const [combos, setCombos] = useState<Record<number, HistoryCombo>>({})
  const [loading, setLoading] = useState(true)

  useState(() => {
    fetch(`/api/profiles/${profile.id}/bets`)
      .then(r => r.json())
      .then(data => {
        setBets(data.bets ?? [])
        const cm: Record<number, HistoryCombo> = {}
        for (const c of data.combos ?? []) cm[c.id] = c
        setCombos(cm)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  })

  const profit = profile.balance - STARTING_BALANCE

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-t-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-red-700 text-white flex items-center justify-center font-bold">
            {(profile.display_name || profile.username)[0].toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="font-bold text-gray-900">{profile.display_name || profile.username}</div>
            <div className="text-xs text-gray-400">@{profile.username}</div>
          </div>
          <div className="text-right">
            <div className="font-black text-gray-900 text-sm">{profile.balance.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })}</div>
            <div className={`text-xs font-semibold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{profit >= 0 ? '+' : ''}{profit.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</div>
          </div>
          <button onClick={onClose} className="ml-2 text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        {/* Body */}
        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-2">
          {loading && <div className="text-center py-10 text-gray-400 text-sm">Lade Wetthistorie…</div>}
          {!loading && bets?.length === 0 && <div className="text-center py-10 text-gray-400 text-sm">Noch keine abgeschlossenen Wetten.</div>}
          {!loading && bets && bets.length > 0 && (() => {
            type Item = { kind: 'single'; bet: HistoryBet } | { kind: 'combo'; legs: HistoryBet[]; cb: HistoryCombo | undefined }
            const seen = new Set<number>()
            const items: Item[] = []
            for (const b of bets) {
              if (!b.combo_id) items.push({ kind: 'single', bet: b })
              else if (!seen.has(b.combo_id)) {
                seen.add(b.combo_id)
                items.push({ kind: 'combo', legs: bets.filter(x => x.combo_id === b.combo_id), cb: combos[b.combo_id] })
              }
            }
            return items.map((item, i) => {
              if (item.kind === 'single') {
                const b = item.bet
                const ml = b.match ? `${b.match.home_team.name} – ${b.match.away_team.name}` : '—'
                const score = b.match?.home_score != null ? `${b.match.home_score}:${b.match.away_score}` : null
                const borderColor = b.status === 'won' ? 'border-l-green-500' : b.status === 'lost' ? 'border-l-red-400' : 'border-l-yellow-400'
                const bgColor = b.status === 'won' ? 'bg-green-50' : b.status === 'lost' ? 'bg-red-50/40' : 'bg-white'
                return (
                  <div key={b.id} className={`flex items-center gap-2.5 py-2 px-3 border-l-4 ${borderColor} ${bgColor} rounded-r-lg`}>
                    <StatusIcon status={b.status} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-gray-400 truncate">{ml}{b.match?.matchday ? ` · ST ${b.match.matchday}` : ''}</div>
                      <div className="text-xs font-semibold text-gray-900">{selLabel(b.market_type, b.selection)}</div>
                      {score && <div className="text-xs text-gray-400">Ergebnis: <span className="font-semibold text-gray-600">{score}</span></div>}
                    </div>
                    <div className="text-right flex-shrink-0 text-xs">
                      <div className="font-black text-red-700">@{b.odds_value.toFixed(2).replace('.', ',')}</div>
                      {b.status === 'won' && b.payout != null && <div className="font-bold text-green-600">+{b.payout.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</div>}
                      {b.status === 'lost' && <div className="text-red-400 line-through">{(b.stake ?? 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</div>}
                    </div>
                  </div>
                )
              }
              const cb = item.cb
              const status = cb?.status ?? 'pending'
              const totalOdds = cb?.total_odds ?? item.legs.reduce((a, l) => a * l.odds_value, 1)
              const borderColor = status === 'won' ? 'border-l-green-500' : status === 'lost' ? 'border-l-red-400' : 'border-l-yellow-400'
              const bgColor = status === 'won' ? 'bg-green-50' : status === 'lost' ? 'bg-red-50/40' : 'bg-white'
              return (
                <div key={i} className={`py-2 px-3 border-l-4 ${borderColor} ${bgColor} rounded-r-lg`}>
                  <div className="flex items-center gap-2 mb-1">
                    <StatusIcon status={status} size="sm" />
                    <div className="flex-1 text-xs">
                      <span className="font-bold text-blue-600">🔗 Kombi</span>
                      <span className="text-gray-400"> · Quote {totalOdds.toFixed(2).replace('.', ',')}</span>
                    </div>
                    {status === 'won' && cb?.payout != null && <div className="text-xs font-black text-green-600">+{cb.payout.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</div>}
                    {status === 'lost' && <div className="text-xs text-red-400 line-through">{(cb?.stake ?? 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</div>}
                  </div>
                  <div className="pl-7 space-y-0.5">
                    {item.legs.map(leg => (
                      <div key={leg.id} className="text-xs text-gray-500 flex gap-1">
                        <div className={`w-2 h-2 rounded-full mt-0.5 flex-shrink-0 ${leg.status === 'won' ? 'bg-green-500' : leg.status === 'lost' ? 'bg-red-400' : 'bg-yellow-400'}`} />
                        <span className="truncate">{leg.match ? `${leg.match.home_team.name} – ${leg.match.away_team.name}` : '—'}</span>
                        <span className="font-medium text-gray-700 flex-shrink-0">{selLabel(leg.market_type, leg.selection)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          })()}
        </div>
      </div>
    </div>
  )
}

// ── Main Export ────────────────────────────────────────────────────────

export function LeaderboardClient({
  profiles, currentUserId, currentUserName, isAdmin, matchdayBets, matchdayNumber, allMatchdays, combos,
  isDeadlinePassed, weeklyWinners, streaks, mdStats, initialReactions, initialComments,
}: {
  profiles: Profile[]
  currentUserId: string | null
  currentUserName: string
  isAdmin?: boolean
  matchdayBets: BetRow[]
  matchdayNumber: number | null
  allMatchdays: number[]
  combos: Record<string, ComboMeta>
  isDeadlinePassed: boolean
  weeklyWinners: Record<number, string>
  streaks: Record<string, number>
  mdStats: MatchdayStats
  initialReactions: { target_type: string; target_id: number; emoji: string; user_id: string }[]
  initialComments: CommentData[]
}) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'rangliste' | 'spieltag'>('rangliste')
  const [expanded, setExpanded] = useState<Set<string>>(new Set(currentUserId ? [currentUserId] : []))
  const [profileModal, setProfileModal] = useState<Profile | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)

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
    } catch { setCancelError('Netzwerkfehler.') }
    finally { setCancellingId(null) }
  }

  function toggle(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const openProfile = useCallback((profile: Profile) => {
    if (profile.id === currentUserId) return // own profile has its own page
    setProfileModal(profile)
  }, [currentUserId])

  const top3 = profiles.slice(0, 3)

  // Count weekly wins per user
  const weeklyWinCounts: Record<string, number> = {}
  for (const uid of Object.values(weeklyWinners)) {
    weeklyWinCounts[uid] = (weeklyWinCounts[uid] ?? 0) + 1
  }

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-br from-red-700 to-red-900 text-white rounded-2xl px-5 py-5 shadow-sm">
        <div className="text-red-200 text-xs font-medium uppercase tracking-wide mb-1">Saison 2025/26</div>
        <h1 className="text-2xl font-black">Rangliste</h1>
        <p className="text-red-200 text-sm mt-1">{profiles.length} Teilnehmer · Startkapital 1.000 €</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        <button onClick={() => setActiveTab('rangliste')} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'rangliste' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
          Rangliste
        </button>
        <button onClick={() => setActiveTab('spieltag')} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'spieltag' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
          {matchdayNumber ? `Spieltag ${matchdayNumber}` : 'Spieltag'}
        </button>
      </div>

      {/* ── Rangliste Tab ── */}
      {activeTab === 'rangliste' && (
        <>
          {cancelError && (
            <div className="px-4 py-2 bg-red-50 border border-red-100 rounded-xl text-xs text-red-700 flex items-center gap-2">
              <span className="flex-1">{cancelError}</span>
              <button onClick={() => setCancelError(null)}>✕</button>
            </div>
          )}

          {top3.length >= 3 && (
            <div className="flex items-end justify-center gap-3 px-2">
              <PodiumCard rank={2} profile={top3[1]} isMe={top3[1].id === currentUserId} weeklyWins={weeklyWinCounts[top3[1].id] ?? 0} streak={streaks[top3[1].id] ?? 0} onNameClick={openProfile} />
              <PodiumCard rank={1} profile={top3[0]} isMe={top3[0].id === currentUserId} weeklyWins={weeklyWinCounts[top3[0].id] ?? 0} streak={streaks[top3[0].id] ?? 0} featured onNameClick={openProfile} />
              <PodiumCard rank={3} profile={top3[2]} isMe={top3[2].id === currentUserId} weeklyWins={weeklyWinCounts[top3[2].id] ?? 0} streak={streaks[top3[2].id] ?? 0} onNameClick={openProfile} />
            </div>
          )}

          <div className="space-y-2">
            {profiles.map((profile, idx) => {
              const rank = idx + 1
              const profit = profile.balance - STARTING_BALANCE
              const isMe = profile.id === currentUserId
              const isOpen = expanded.has(profile.id)
              const userBets = matchdayBets.filter(b => b.user_id === profile.id)
              const streak = streaks[profile.id] ?? 0
              const wWins = weeklyWinCounts[profile.id] ?? 0
              const currentMdPnl = mdStats[profile.id]

              return (
                <div key={profile.id} className={`rounded-xl border overflow-hidden transition-all ${isMe ? 'bg-red-50 border-red-200 shadow-sm' : 'bg-white border-gray-100'}`}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* Rank */}
                    <div className="w-8 flex-shrink-0 text-center">
                      {rank <= 3 ? <span className="text-lg">{rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}</span> : <span className="text-sm font-bold text-gray-400">{rank}</span>}
                    </div>
                    {/* Avatar — click opens profile modal */}
                    <button
                      onClick={() => openProfile(profile)}
                      className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm ${isMe ? 'bg-red-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      {(profile.display_name || profile.username || '?')[0].toUpperCase()}
                    </button>
                    {/* Name + badges */}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 truncate text-sm flex items-center gap-1 flex-wrap">
                        {profile.display_name || profile.username}
                        {isMe && <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">Du</span>}
                        {streak >= 2 && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium" title={`${streak} Spieltage in Folge im Plus`}>🔥 {streak}</span>}
                        {wWins >= 1 && <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-medium" title={`${wWins}× Spieltagsbester`}>🏅 {wWins}×</span>}
                      </div>
                      <div className="text-xs text-gray-400">@{profile.username}</div>
                    </div>
                    {/* Balance */}
                    <div className="text-right flex-shrink-0 mr-1">
                      <div className="font-bold text-gray-900 text-sm">{profile.balance.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })}</div>
                      <div className={`text-xs font-medium ${profit > 0 ? 'text-green-600' : profit < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {profit >= 0 ? '+' : ''}{profit.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    {/* Expand chevron */}
                    <button onClick={() => toggle(profile.id)} className="p-1">
                      <svg className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>

                  {isOpen && (
                    <div className="px-4 pb-3 border-t border-gray-100 pt-2">
                      {!isDeadlinePassed && !isMe ? (
                        <p className="text-xs text-gray-400 italic">Tipps werden nach Annahmeschluss sichtbar</p>
                      ) : (
                        <UserBets bets={userBets} combos={combos} noDataLabel="Keine Tipps für diesen Spieltag" reactions={initialReactions} comments={initialComments} currentUserId={currentUserId} currentUserName={currentUserName} isAdmin={isAdmin} isOwnBets={isMe} isDeadlinePassed={isDeadlinePassed} onCancel={isMe ? cancelBet : undefined} cancellingId={cancellingId} />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {profiles.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <div className="text-4xl mb-3">🏆</div>
              <div className="font-medium">Noch keine Teilnehmer</div>
            </div>
          )}
        </>
      )}

      {/* ── Spieltag Tab ── */}
      {activeTab === 'spieltag' && (
        <div className="space-y-3">
          {cancelError && (
            <div className="px-4 py-2 bg-red-50 border border-red-100 rounded-xl text-xs text-red-700 flex items-center gap-2">
              <span className="flex-1">{cancelError}</span>
              <button onClick={() => setCancelError(null)}>✕</button>
            </div>
          )}

          {/* Matchday selector */}
          {allMatchdays.length > 1 && (
            <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
              {allMatchdays.map(md => (
                <button
                  key={md}
                  onClick={() => router.push(`/leaderboard?spieltag=${md}`)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${md === matchdayNumber ? 'bg-red-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  ST {md}
                </button>
              ))}
            </div>
          )}

          {/* Wochentippkönig banner */}
          {matchdayNumber && weeklyWinners[matchdayNumber] && (() => {
            const winner = profiles.find(p => p.id === weeklyWinners[matchdayNumber])
            const pnl = mdStats[weeklyWinners[matchdayNumber]]
            if (!winner || !pnl || pnl <= 0) return null
            return (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 flex items-center gap-3">
                <span className="text-2xl">🏅</span>
                <div>
                  <div className="text-xs text-yellow-700 font-semibold uppercase tracking-wide">Spieltagsbester</div>
                  <div className="font-bold text-gray-900 text-sm">{winner.display_name || winner.username}</div>
                  <div className="text-xs text-green-600 font-semibold">+{pnl.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</div>
                </div>
              </div>
            )
          })()}

          <div className="text-sm text-gray-500 font-medium px-1">
            Alle Tipps — {matchdayNumber}. Spieltag
            {!isDeadlinePassed && <span className="ml-2 text-xs text-yellow-600">· sichtbar nach Annahmeschluss</span>}
          </div>

          {profiles.map(profile => {
            const isMe = profile.id === currentUserId
            const userBets = matchdayBets.filter(b => b.user_id === profile.id)
            const pnl = mdStats[profile.id]
            if (!isDeadlinePassed && !isMe) return null
            return (
              <div key={profile.id} className={`rounded-xl border overflow-hidden ${isMe ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}>
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 ${isMe ? 'bg-red-700 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    {(profile.display_name || profile.username || '?')[0].toUpperCase()}
                  </div>
                  <div className="font-semibold text-sm text-gray-900 flex items-center gap-1">
                    {profile.display_name || profile.username}
                    {isMe && <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">Du</span>}
                    {matchdayNumber && weeklyWinners[matchdayNumber] === profile.id && pnl && pnl > 0 && (
                      <span className="text-xs">🏅</span>
                    )}
                  </div>
                  {pnl !== null && pnl !== undefined && isDeadlinePassed && (
                    <div className={`ml-auto text-xs font-bold ${pnl > 0 ? 'text-green-600' : pnl < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {pnl > 0 ? '+' : ''}{pnl.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                    </div>
                  )}
                  {(pnl === null || !isDeadlinePassed) && (() => {
                    const seenCombos = new Set<number>()
                    let slipCount = 0
                    for (const b of userBets) {
                      if (!b.combo_id) { slipCount++ }
                      else if (!seenCombos.has(b.combo_id)) { seenCombos.add(b.combo_id); slipCount++ }
                    }
                    return (
                      <div className="ml-auto text-xs text-gray-400">
                        {slipCount} Wettschein{slipCount !== 1 ? 'e' : ''}
                      </div>
                    )
                  })()}
                </div>
                <div className="px-4 py-2">
                  <UserBets bets={userBets} combos={combos} noDataLabel="Keine Tipps für diesen Spieltag" reactions={initialReactions} comments={initialComments} currentUserId={currentUserId} currentUserName={currentUserName} isAdmin={isAdmin} isOwnBets={isMe} isDeadlinePassed={isDeadlinePassed} onCancel={isMe ? cancelBet : undefined} cancellingId={cancellingId} />
                </div>
              </div>
            )
          })}

          {!isDeadlinePassed && (
            <p className="text-center text-xs text-gray-400 py-4">Die Tipps der anderen werden nach Annahmeschluss sichtbar.</p>
          )}
        </div>
      )}

      {/* Profile History Modal */}
      {profileModal && <ProfileModal profile={profileModal} onClose={() => setProfileModal(null)} />}
    </div>
  )
}

function PodiumCard({ rank, profile, isMe, featured = false, weeklyWins, streak, onNameClick }: {
  rank: number; profile: Profile; isMe: boolean; featured?: boolean
  weeklyWins: number; streak: number; onNameClick: (p: Profile) => void
}) {
  const profit = profile.balance - STARTING_BALANCE
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'
  const heights = { 1: 'h-32', 2: 'h-24', 3: 'h-20' } as const
  const colors = { 1: 'bg-yellow-100 border-2 border-yellow-300', 2: 'bg-gray-100 border-2 border-gray-300', 3: 'bg-orange-50 border-2 border-orange-200' } as const

  return (
    <div className="flex-1 flex flex-col items-center">
      <button onClick={() => onNameClick(profile)} className={`rounded-full flex items-center justify-center font-bold mb-2 ${featured ? 'w-14 h-14 text-xl' : 'w-12 h-12 text-lg'} ${isMe ? 'bg-red-700 text-white ring-2 ring-red-300' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
        {(profile.display_name || profile.username || '?')[0].toUpperCase()}
      </button>
      <div className="text-center mb-1">
        <div className="text-xs font-semibold text-gray-800 truncate max-w-20">{profile.display_name || profile.username}</div>
        <div className={`text-xs font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{profit >= 0 ? '+' : ''}{profit.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €</div>
        <div className="flex items-center justify-center gap-1 mt-0.5">
          {streak >= 2 && <span className="text-xs">🔥{streak}</span>}
          {weeklyWins >= 1 && <span className="text-xs">🏅{weeklyWins}×</span>}
        </div>
      </div>
      <div className={`${heights[rank as 1|2|3]} w-full rounded-t-xl flex items-end justify-center pb-2 ${colors[rank as 1|2|3]}`}>
        <span className="text-2xl">{medal}</span>
      </div>
    </div>
  )
}
