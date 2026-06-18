'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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

export type Profile = { id: string; username: string; display_name: string | null; balance: number; avatar_url?: string | null }
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
    match_date: string
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

function fmtAmt(n: number) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function Avatar({ profile, size, isMe, className = '' }: { profile: Profile; size: 'sm' | 'md' | 'lg'; isMe: boolean; className?: string }) {
  const dim = size === 'lg' ? 'w-14 h-14 text-xl' : size === 'md' ? 'w-9 h-9 text-sm' : 'w-7 h-7 text-xs'
  const initial = (profile.display_name || profile.username || '?')[0].toUpperCase()
  if (profile.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={profile.avatar_url} alt={initial} className={`${dim} rounded-full object-cover flex-shrink-0 ${className}`} />
    )
  }
  return (
    <div className={`${dim} rounded-full flex items-center justify-center font-bold flex-shrink-0 ${isMe ? 'bg-red-700 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'} ${className}`}>
      {initial}
    </div>
  )
}

// Visibility: single bets after own game kickoff; combos once any leg has kicked off; cancelled = hidden
function isBetVisible(bet: BetRow, allMatchdayBets: BetRow[], now: Date): boolean {
  if (bet.status === 'cancelled') return false
  if (!bet.combo_id) {
    return !!bet.match && new Date(bet.match.match_date) <= now
  }
  const legs = allMatchdayBets.filter(b => b.combo_id === bet.combo_id)
  return legs.some(l => l.match && new Date(l.match.match_date) <= now)
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

// ── Main Export ────────────────────────────────────────────────────────

export function LeaderboardClient({
  profiles, currentUserId, currentUserName, isAdmin, matchdayBets, matchdayNumber, allMatchdays, combos,
  isDeadlinePassed, weeklyWinners, streaks, mdStats, initialReactions, initialComments, initialRecap, playerNameMap,
  pendingStakesPerUser, betCountsPerUser, defaultTabIsSpielTag,
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
  pendingStakesPerUser: Record<string, number>
  betCountsPerUser: Record<string, number>
  defaultTabIsSpielTag: boolean
}) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'rangliste' | 'spieltag'>(
    defaultTabIsSpielTag ? 'spieltag' : 'rangliste'
  )
  const [expanded, setExpanded] = useState<Set<string>>(new Set(currentUserId ? [currentUserId] : []))
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
        <div className="text-red-200 text-xs font-medium uppercase tracking-wide mb-1">Saison 2026/27</div>
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

          {!isDeadlinePassed && matchdayNumber && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3 text-xs text-blue-800 dark:text-blue-300">
              <div className="font-semibold mb-0.5">Stand vor Spieltag {matchdayNumber}</div>
              <div className="text-blue-600 dark:text-blue-400">Einzelwetten werden je Spiel nach dessen Anpfiff sichtbar. Kombiwetten sobald mindestens ein Leg angepfiffen wurde. Dein eigenes Guthaben kann davon abweichen.</div>
            </div>
          )}

          {top3.length >= 3 && (
            <div className="flex items-end justify-center gap-3 px-2">
              <PodiumCard rank={2} profile={top3[1]} isMe={top3[1].id === currentUserId} weeklyWins={weeklyWinCounts[top3[1].id] ?? 0} streak={streaks[top3[1].id] ?? 0} displayBalance={!isDeadlinePassed ? top3[1].balance + (pendingStakesPerUser[top3[1].id] ?? 0) : top3[1].balance} />
              <PodiumCard rank={1} profile={top3[0]} isMe={top3[0].id === currentUserId} weeklyWins={weeklyWinCounts[top3[0].id] ?? 0} streak={streaks[top3[0].id] ?? 0} featured displayBalance={!isDeadlinePassed ? top3[0].balance + (pendingStakesPerUser[top3[0].id] ?? 0) : top3[0].balance} />
              <PodiumCard rank={3} profile={top3[2]} isMe={top3[2].id === currentUserId} weeklyWins={weeklyWinCounts[top3[2].id] ?? 0} streak={streaks[top3[2].id] ?? 0} displayBalance={!isDeadlinePassed ? top3[2].balance + (pendingStakesPerUser[top3[2].id] ?? 0) : top3[2].balance} />
            </div>
          )}

          <div className="space-y-2">
            {profiles.map((profile, idx) => {
              const rank = idx + 1
              const displayBalance = !isDeadlinePassed
                ? profile.balance + (pendingStakesPerUser[profile.id] ?? 0)
                : profile.balance
              const profit = displayBalance - STARTING_BALANCE
              const isMe = profile.id === currentUserId
              const isOpen = expanded.has(profile.id)
              const userBets = matchdayBets.filter(b => b.user_id === profile.id)
              const now = new Date()
              const visibleBets = isMe ? userBets : userBets.filter(b => isBetVisible(b, matchdayBets, now))
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
                    {/* Avatar — links to public profile */}
                    <Link href={`/spieler/${profile.id}`} className="flex-shrink-0">
                      <Avatar profile={profile} size="md" isMe={isMe} className={isMe ? 'ring-2 ring-red-300' : 'hover:opacity-80'} />
                    </Link>
                    {/* Name + badges */}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 dark:text-gray-100 truncate text-sm flex items-center gap-1 flex-wrap">
                        <Link href={`/spieler/${profile.id}`} className="hover:underline">
                          {profile.display_name || profile.username}
                        </Link>
                        {isMe && <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">Du</span>}
                        {streak >= 2 && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium" title={`${streak} Spieltage in Folge im Plus`}>🔥 {streak}</span>}
                        {wWins >= 1 && <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-medium" title={`${wWins}× Spieltagsbester`}>🏅 {wWins}×</span>}
                      </div>
                      <div className="text-xs text-gray-400 dark:text-gray-500">@{profile.username}</div>
                    </div>
                    {/* Balance */}
                    <div className="text-right flex-shrink-0 mr-1">
                      <div className="font-black text-gray-900 dark:text-gray-100 text-base tabular-nums">{fmtAmt(displayBalance)} €</div>
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
                      {visibleBets.length === 0 && !isMe ? (
                        <p className="text-xs text-gray-400 dark:text-gray-500 italic">Tipps werden nach Anpfiff der jeweiligen Spiele sichtbar</p>
                      ) : (
                        <UserBets bets={visibleBets} combos={combos} noDataLabel="Keine Tipps für diesen Spieltag" reactions={initialReactions} comments={initialComments} currentUserId={currentUserId} currentUserName={currentUserName} isAdmin={isAdmin} isOwnBets={isMe} isDeadlinePassed={isDeadlinePassed} onCancel={isMe ? cancelBet : undefined} cancellingId={cancellingId} players={playerNameMap} />
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

          {/* Pre-reveal hint */}
          {!isDeadlinePassed && matchdayNumber && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3 text-xs text-blue-800 dark:text-blue-300">
              <div className="font-semibold mb-0.5">Rangliste: Stand vor Spieltag {matchdayNumber}</div>
              <div className="text-blue-600 dark:text-blue-400">Einzelwetten werden je Spiel nach dessen Anpfiff sichtbar. Kombiwetten sobald mindestens ein Leg angepfiffen wurde. Dein eigenes Guthaben kann davon abweichen.</div>
            </div>
          )}

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

          {/* ── Spieltag-Rangliste ── */}
          {isDeadlinePassed && matchdayNumber && (() => {
            const ranked = [...profiles]
              .map(p => ({ p, pnl: mdStats[p.id] ?? 0 }))
              .filter(x => x.pnl !== 0 || mdStats[x.p.id] !== null)
              .sort((a, b) => b.pnl - a.pnl)
            if (ranked.length === 0) return null
            return (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100">Spieltag {matchdayNumber} – Rangliste</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">(abgerechnete Wetten)</span>
                </div>
                {ranked.map(({ p, pnl }, idx) => {
                  const isMe = p.id === currentUserId
                  return (
                    <div key={p.id} className={`flex items-center gap-3 px-4 py-2 border-b border-gray-50 dark:border-gray-700/50 last:border-0 ${isMe ? 'bg-red-50 dark:bg-red-900/20' : ''}`}>
                      <span className="w-6 text-center text-xs font-bold text-gray-400 flex-shrink-0">
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                      </span>
                      <Avatar profile={p} size="sm" isMe={isMe} />
                      <div className="flex-1 min-w-0 text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {p.display_name || p.username}
                        {isMe && <span className="ml-1.5 text-xs bg-red-100 text-red-700 px-1 py-0.5 rounded">Du</span>}
                      </div>
                      <div className={`text-sm font-black tabular-nums flex-shrink-0 ${pnl > 0 ? 'text-green-600' : pnl < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {pnl >= 0 ? '+' : ''}{fmtAmt(pnl)} €
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}

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
            {!isDeadlinePassed && <span className="ml-2 text-xs text-yellow-600">· sichtbar je nach Anpfiff</span>}
          </div>

          {profiles.map(profile => {
            const isMe = profile.id === currentUserId
            const userBets = matchdayBets.filter(b => b.user_id === profile.id)
            const now = new Date()
            const visibleBets = isMe ? userBets : userBets.filter(b => isBetVisible(b, matchdayBets, now))
            const pnl = mdStats[profile.id]
            const displayBalancePre = profile.balance + (pendingStakesPerUser[profile.id] ?? 0)

            // Before any visible bets: show count placeholder for other users
            if (!isMe && visibleBets.length === 0) {
              const count = betCountsPerUser[profile.id] ?? 0
              if (count === 0) return null
              return (
                <div key={profile.id} className="rounded-xl border bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5">
                    <Avatar profile={profile} size="sm" isMe={false} />
                    <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                      {profile.display_name || profile.username}
                    </div>
                    <div className="ml-auto text-xs text-gray-400 dark:text-gray-500">
                      {count} Wettschein{count !== 1 ? 'e' : ''} platziert
                    </div>
                  </div>
                </div>
              )
            }

            return (
              <div key={profile.id} className={`rounded-xl border overflow-hidden ${isMe ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700'}`}>
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-gray-700">
                  <Avatar profile={profile} size="sm" isMe={isMe} />
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
                    const displayCount = !isDeadlinePassed && isMe
                      ? (betCountsPerUser[profile.id] ?? slipCount)
                      : slipCount
                    return (
                      <div className="ml-auto text-xs text-gray-400 dark:text-gray-500">
                        {!isDeadlinePassed && isMe && (
                          <span className="mr-1 text-gray-500 dark:text-gray-400 font-medium">
                            Stand vor ST {matchdayNumber}: {fmtAmt(displayBalancePre)} €
                          </span>
                        )}
                        {displayCount} Wettschein{displayCount !== 1 ? 'e' : ''}
                      </div>
                    )
                  })()}
                </div>
                <div className="px-4 py-2">
                  <UserBets bets={visibleBets} combos={combos} noDataLabel="Keine Tipps für diesen Spieltag" reactions={initialReactions} comments={initialComments} currentUserId={currentUserId} currentUserName={currentUserName} isAdmin={isAdmin} isOwnBets={isMe} isDeadlinePassed={isDeadlinePassed} onCancel={isMe ? cancelBet : undefined} cancellingId={cancellingId} players={playerNameMap} />
                </div>
              </div>
            )
          })}

          {!isDeadlinePassed && (
            <p className="text-center text-xs text-gray-400 dark:text-gray-500 py-4">Einzelwetten werden je Spiel nach dessen Anpfiff sichtbar. Kombiwetten sobald mindestens ein enthaltenes Spiel angepfiffen wurde.</p>
          )}
        </div>
      )}

    </div>
  )
}

function PodiumCard({ rank, profile, isMe, featured = false, weeklyWins, streak, displayBalance }: {
  rank: number; profile: Profile; isMe: boolean; featured?: boolean
  weeklyWins: number; streak: number; displayBalance: number
}) {
  const profit = displayBalance - STARTING_BALANCE
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'
  const heights = { 1: 'h-32', 2: 'h-24', 3: 'h-20' } as const
  const colors = { 1: 'bg-yellow-100 border-2 border-yellow-300', 2: 'bg-gray-100 border-2 border-gray-300', 3: 'bg-orange-50 border-2 border-orange-200' } as const

  return (
    <div className="flex-1 flex flex-col items-center">
      <Link href={`/spieler/${profile.id}`} className="mb-2 flex-shrink-0">
        <Avatar profile={profile} size="lg" isMe={isMe} className={`${featured ? 'w-14 h-14' : 'w-12 h-12'} ${isMe ? 'ring-2 ring-red-300' : 'hover:opacity-80'}`} />
      </Link>
      <div className="text-center mb-1">
        <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate max-w-20">{profile.display_name || profile.username}</div>
        <div className="font-black text-gray-900 dark:text-gray-100 text-sm tabular-nums leading-tight">{fmtAmt(displayBalance)} €</div>
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
