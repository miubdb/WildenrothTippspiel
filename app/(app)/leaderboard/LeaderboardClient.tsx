'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { MatchdayScroller } from '@/components/MatchdayScroller'
import { WetteCard, type WetteData, type WetteStatus, type WetteSocial } from '@/components/WetteCard'
import type { CommentData } from '@/components/CommentSection'
import { MatchdayRecap, type RecapData } from '@/components/MatchdayRecap'

const STARTING_BALANCE = 1000

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

function selLabel(marketType: string, selection: string, players?: Record<number, string>) {
  if (marketType === 'exact_score') return selection
  if (marketType === 'goalscorer' || marketType === 'goalscorer_2plus') {
    const id = parseInt(selection, 10)
    const name = players?.[id] ?? `Spieler #${id}`
    return marketType === 'goalscorer_2plus' ? `${name} (mind. 2 Tore)` : name
  }
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

// ── Shared helpers ─────────────────────────────────────────────────────

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

type ReactionData = { target_type: string; target_id: number; emoji: string; user_id: string }

function UserBets({ bets, combos, noDataLabel, reactions, comments, currentUserId, currentUserName, isAdmin, isOwnBets, isDeadlinePassed, onCancel, cancellingId: cancelId, players }: {
  bets: BetRow[]; combos: Record<string, ComboMeta>; noDataLabel: string
  reactions: ReactionData[]; comments: CommentData[]; currentUserId: string | null
  currentUserName: string; isAdmin?: boolean
  isOwnBets?: boolean; isDeadlinePassed?: boolean
  onCancel?: (betId?: number, comboId?: number) => void
  cancellingId?: string | null
  players?: Record<number, string>
}) {
  if (bets.length === 0) return <p className="text-xs text-gray-400 italic py-1">{noDataLabel}</p>

  // Build normalized WetteData[]
  const wetten: WetteData[] = []
  const seen = new Set<number>()

  for (const b of bets) {
    if (!b.combo_id) {
      const m = b.match
      const score = m?.home_score != null ? `${m.home_score}:${m.away_score}` : null
      wetten.push({
        id: `bet-${b.id}`,
        type: 'single',
        totalOdds: b.odds_value,
        stake: b.stake,
        payout: b.payout,
        status: b.status as WetteStatus,
        betId: b.id,
        legs: [{
          id: b.id,
          matchName: m ? `${m.home_team.name} – ${m.away_team.name}` : '—',
          market: b.market_type,
          selection: selLabel(b.market_type, b.selection, players),
          odds: b.odds_value,
          status: b.status as WetteStatus,
          score,
        }],
      })
    } else if (!seen.has(b.combo_id)) {
      seen.add(b.combo_id)
      const comboLegs = bets.filter(x => x.combo_id === b.combo_id)
      const cb = combos[b.combo_id]
      const totalOdds = cb?.total_odds ?? comboLegs.reduce((acc, l) => acc * l.odds_value, 1)
      const dbStatus = (cb?.status ?? 'pending') as WetteStatus
      // Override stale 'pending' DB status when legs already prove the outcome
      const effectiveStatus: WetteStatus =
        (dbStatus === 'won' || dbStatus === 'lost') ? dbStatus
        : comboLegs.some(l => l.status === 'lost') ? 'lost'
        : comboLegs.every(l => l.status === 'won') ? 'won'
        : 'pending'
      wetten.push({
        id: `combo-${b.combo_id}`,
        type: 'combo',
        totalOdds,
        stake: cb?.stake ?? 0,
        payout: cb?.payout,
        status: effectiveStatus,
        comboId: b.combo_id,
        legs: comboLegs.map(leg => {
          const lm = leg.match
          const lscore = lm?.home_score != null ? `${lm.home_score}:${lm.away_score}` : null
          return {
            id: leg.id,
            matchName: lm ? `${lm.home_team.name} – ${lm.away_team.name}` : '—',
            market: leg.market_type,
            selection: selLabel(leg.market_type, leg.selection, players),
            odds: leg.odds_value,
            status: leg.status as WetteStatus,
            score: lscore,
          }
        }),
      })
    }
  }

  return (
    <div className="space-y-2">
      {wetten.map(wette => {
        const targetType = wette.type === 'single' ? 'bet' as const : 'combo' as const
        const targetId = wette.type === 'single' ? (wette.betId ?? 0) : (wette.comboId ?? 0)
        const social: WetteSocial | undefined = currentUserId ? {
          reactions: reactions.filter(r => r.target_type === targetType && r.target_id === targetId),
          comments: comments.filter(c => c.target_type === targetType && c.target_id === targetId),
          currentUserId,
          currentUserName,
          isAdmin,
          targetType,
          targetId,
        } : undefined
        return (
          <WetteCard
            key={wette.id}
            wette={wette}
            onCancel={isOwnBets && !isDeadlinePassed ? onCancel : undefined}
            cancellingId={cancelId}
            isDeadlinePassed={isDeadlinePassed}
            social={social}
          />
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

function ProfileModal({ profile, onClose, players }: { profile: Profile; onClose: () => void; players?: Record<number, string> }) {
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
      <div className="bg-white dark:bg-gray-800 rounded-t-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-red-700 text-white flex items-center justify-center font-bold">
            {(profile.display_name || profile.username)[0].toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="font-bold text-gray-900 dark:text-gray-100">{profile.display_name || profile.username}</div>
            <div className="text-xs text-gray-400 dark:text-gray-500">@{profile.username}</div>
          </div>
          <div className="text-right">
            <div className="font-black text-gray-900 dark:text-gray-100 text-sm">{profile.balance.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })}</div>
            <div className={`text-xs font-semibold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{profit >= 0 ? '+' : ''}{profit.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</div>
          </div>
          <button onClick={onClose} className="ml-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        {/* Body */}
        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-2">
          {loading && <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">Lade Wetthistorie…</div>}
          {!loading && bets?.length === 0 && <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">Noch keine abgeschlossenen Wetten.</div>}
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
                const bgColor = b.status === 'won' ? 'bg-green-50 dark:bg-green-900/20' : b.status === 'lost' ? 'bg-red-50/40 dark:bg-red-900/20' : 'bg-gray-50 dark:bg-gray-700/40'
                return (
                  <div key={b.id} className={`flex items-center gap-2.5 py-2 px-3 border-l-4 ${borderColor} ${bgColor} rounded-r-lg`}>
                    <StatusIcon status={b.status} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-gray-400 dark:text-gray-500 truncate">{ml}{b.match?.matchday ? ` · ST ${b.match.matchday}` : ''}</div>
                      <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">{selLabel(b.market_type, b.selection, players)}</div>
                      {score && <div className="text-xs text-gray-400 dark:text-gray-500">Ergebnis: <span className="font-semibold text-gray-600 dark:text-gray-300">{score}</span></div>}
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
              const dbStatus2 = cb?.status ?? 'pending'
              const status = (dbStatus2 === 'won' || dbStatus2 === 'lost') ? dbStatus2
                : item.legs.some(l => l.status === 'lost') ? 'lost'
                : item.legs.every(l => l.status === 'won') ? 'won'
                : 'pending'
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
                        <span className="font-medium text-gray-700 flex-shrink-0">{selLabel(leg.market_type, leg.selection, players)}</span>
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
  isDeadlinePassed, weeklyWinners, streaks, mdStats, initialReactions, initialComments, initialRecap, playerNameMap,
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
  initialRecap: RecapData | null
  playerNameMap?: Record<number, string>
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
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-xl p-1">
        <button onClick={() => setActiveTab('rangliste')} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'rangliste' ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
          Rangliste
        </button>
        <button onClick={() => setActiveTab('spieltag')} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'spieltag' ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
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
                <div key={profile.id} className={`rounded-xl border overflow-hidden transition-all ${isMe ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 shadow-sm' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700'}`}>
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
                      <div className="font-semibold text-gray-900 dark:text-gray-100 truncate text-sm flex items-center gap-1 flex-wrap">
                        {profile.display_name || profile.username}
                        {isMe && <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">Du</span>}
                        {streak >= 2 && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium" title={`${streak} Spieltage in Folge im Plus`}>🔥 {streak}</span>}
                        {wWins >= 1 && <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-medium" title={`${wWins}× Spieltagsbester`}>🏅 {wWins}×</span>}
                      </div>
                      <div className="text-xs text-gray-400 dark:text-gray-500">@{profile.username}</div>
                    </div>
                    {/* Balance */}
                    <div className="text-right flex-shrink-0 mr-1">
                      <div className="font-black text-gray-900 dark:text-gray-100 text-base tabular-nums">{fmtAmt(profile.balance)} €</div>
                      <div className={`text-xs font-bold tabular-nums ${profit > 0 ? 'text-green-600' : profit < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {profit >= 0 ? '+' : ''}{fmtAmt(profit)} €
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
                    <div className="px-4 pb-3 border-t border-gray-100 dark:border-gray-700 pt-2">
                      {!isDeadlinePassed && !isMe ? (
                        <p className="text-xs text-gray-400 dark:text-gray-500 italic">Tipps werden nach Annahmeschluss sichtbar</p>
                      ) : (
                        <UserBets bets={userBets} combos={combos} noDataLabel="Keine Tipps für diesen Spieltag" reactions={initialReactions} comments={initialComments} currentUserId={currentUserId} currentUserName={currentUserName} isAdmin={isAdmin} isOwnBets={isMe} isDeadlinePassed={isDeadlinePassed} onCancel={isMe ? cancelBet : undefined} cancellingId={cancellingId} players={playerNameMap} />
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

          {/* Recap */}
          {initialRecap && <MatchdayRecap data={initialRecap} matchday={matchdayNumber ?? 0} />}

          {/* Matchday selector — auto-scrolls to active matchday */}
          {allMatchdays.length > 1 && (
            <MatchdayScroller activeIndex={allMatchdays.indexOf(matchdayNumber ?? allMatchdays[0])}>
              {allMatchdays.map(md => (
                <button
                  key={md}
                  onClick={() => router.push(`/leaderboard?spieltag=${md}`)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${md === matchdayNumber ? 'bg-red-700 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                >
                  ST {md}
                </button>
              ))}
            </MatchdayScroller>
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

          <div className="text-sm text-gray-500 dark:text-gray-400 font-medium px-1">
            Alle Tipps — {matchdayNumber}. Spieltag
            {!isDeadlinePassed && <span className="ml-2 text-xs text-yellow-600">· sichtbar nach Annahmeschluss</span>}
          </div>

          {profiles.map(profile => {
            const isMe = profile.id === currentUserId
            const userBets = matchdayBets.filter(b => b.user_id === profile.id)
            const pnl = mdStats[profile.id]
            if (!isDeadlinePassed && !isMe) return null
            return (
              <div key={profile.id} className={`rounded-xl border overflow-hidden ${isMe ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700'}`}>
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-gray-700">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 ${isMe ? 'bg-red-700 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
                    {(profile.display_name || profile.username || '?')[0].toUpperCase()}
                  </div>
                  <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 flex items-center gap-1">
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
                  <UserBets bets={userBets} combos={combos} noDataLabel="Keine Tipps für diesen Spieltag" reactions={initialReactions} comments={initialComments} currentUserId={currentUserId} currentUserName={currentUserName} isAdmin={isAdmin} isOwnBets={isMe} isDeadlinePassed={isDeadlinePassed} onCancel={isMe ? cancelBet : undefined} cancellingId={cancellingId} players={playerNameMap} />
                </div>
              </div>
            )
          })}

          {!isDeadlinePassed && (
            <p className="text-center text-xs text-gray-400 dark:text-gray-500 py-4">Die Tipps der anderen werden nach Annahmeschluss sichtbar.</p>
          )}
        </div>
      )}

      {/* Profile History Modal */}
      {profileModal && <ProfileModal profile={profileModal} onClose={() => setProfileModal(null)} players={playerNameMap} />}
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
        <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate max-w-20">{profile.display_name || profile.username}</div>
        <div className="font-black text-gray-900 dark:text-gray-100 text-sm tabular-nums leading-tight">{fmtAmt(profile.balance)} €</div>
        <div className={`text-xs font-semibold tabular-nums leading-tight ${profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>{profit >= 0 ? '+' : ''}{profit.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €</div>
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
