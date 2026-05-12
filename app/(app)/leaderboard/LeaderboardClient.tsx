'use client'

import { useState } from 'react'

const STARTING_BALANCE = 1000

const MARKET_LABEL: Record<string, string> = {
  '1x2': 'Spielausgang',
  double_chance: 'Doppelte Chance',
  over_under_3_5: 'Über/Unter 3,5',
  btts: 'Beide treffen',
  exact_score: 'Genaues Ergebnis',
}

const SEL_LABEL: Record<string, Record<string, string>> = {
  '1x2': { home: 'Heimsieg (1)', draw: 'Unentschieden (X)', away: 'Auswärtssieg (2)' },
  double_chance: { '1x': '1X', x2: 'X2', '12': '12' },
  over_under_3_5: { 'over_3.5': 'Über 3,5', 'under_3.5': 'Unter 3,5' },
  btts: { yes: 'Ja', no: 'Nein' },
}

function selLabel(marketType: string, selection: string) {
  if (marketType === 'exact_score') return selection
  return SEL_LABEL[marketType]?.[selection] ?? selection
}

export type Profile = {
  id: string
  username: string
  display_name: string | null
  balance: number
}

export type BetRow = {
  id: string
  user_id: string
  market_type: string
  selection: string
  stake: number
  odds_value: number
  status: string
  payout: number | null
  combo_id: string | null
  match: {
    id: number
    home_score: number | null
    away_score: number | null
    status: string
    home_team: { name: string; short_name: string }
    away_team: { name: string; short_name: string }
  } | null
}

export type ComboMeta = {
  id: string
  stake: number
  total_odds: number
  status: string
  payout: number | null
}

function matchName(bet: BetRow) {
  if (!bet.match) return '—'
  return `${bet.match.home_team.short_name} – ${bet.match.away_team.short_name}`
}

function scoreStr(bet: BetRow) {
  if (bet.match?.home_score == null) return null
  return `${bet.match.home_score}:${bet.match.away_score}`
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'won') return (
    <div className="w-7 h-7 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
      <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </div>
  )
  if (status === 'lost') return (
    <div className="w-7 h-7 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
      <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
  )
  return (
    <div className="w-7 h-7 rounded-full bg-yellow-400 flex items-center justify-center flex-shrink-0">
      <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </div>
  )
}

function SingleBetMini({ bet }: { bet: BetRow }) {
  const score = scoreStr(bet)
  const potential = (bet.stake * bet.odds_value).toFixed(2)
  const borderColor = bet.status === 'won' ? 'border-l-green-500' : bet.status === 'lost' ? 'border-l-red-400' : 'border-l-yellow-400'
  const bgColor = bet.status === 'won' ? 'bg-green-50' : bet.status === 'lost' ? 'bg-red-50/40' : 'bg-white'

  return (
    <div className={`flex items-center gap-2.5 py-2 px-3 border-l-4 ${borderColor} ${bgColor} rounded-r-lg`}>
      <StatusIcon status={bet.status} />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-gray-400 truncate">{matchName(bet)}</div>
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          <span className="text-xs bg-gray-100 text-gray-500 px-1 py-0.5 rounded">{MARKET_LABEL[bet.market_type] ?? bet.market_type}</span>
          <span className="text-xs font-semibold text-gray-900">{selLabel(bet.market_type, bet.selection)}</span>
        </div>
        {score && <div className="text-xs text-gray-400 mt-0.5">Ergebnis: <span className="font-semibold text-gray-600">{score}</span></div>}
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-xs font-black text-red-700">@{bet.odds_value.toFixed(2)}</div>
        <div className="text-xs text-gray-400">{bet.stake.toFixed(0)} €</div>
        {bet.status === 'won' && bet.payout != null && <div className="text-xs font-bold text-green-600">+{bet.payout.toFixed(2)} €</div>}
        {bet.status === 'pending' && <div className="text-xs text-gray-400">→ {potential} €</div>}
        {bet.status === 'lost' && <div className="text-xs text-red-400 line-through">{bet.stake.toFixed(2)} €</div>}
      </div>
    </div>
  )
}

function ComboBetMini({ legs, cb }: { legs: BetRow[]; cb: ComboMeta | undefined }) {
  const status = cb?.status ?? 'pending'
  const stake = cb?.stake ?? 0
  const totalOdds = cb?.total_odds ?? legs.reduce((acc, l) => acc * l.odds_value, 1)
  const potential = (stake * totalOdds).toFixed(2)
  const borderColor = status === 'won' ? 'border-l-green-500' : status === 'lost' ? 'border-l-red-400' : 'border-l-blue-400'
  const bgColor = status === 'won' ? 'bg-green-50' : status === 'lost' ? 'bg-red-50/40' : 'bg-blue-50/30'

  return (
    <div className={`py-2 px-3 border-l-4 ${borderColor} ${bgColor} rounded-r-lg`}>
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-1.5">
        <StatusIcon status={status} />
        <div className="flex-1">
          <div className="text-xs font-bold text-gray-900 flex items-center gap-1">
            <span className="text-blue-600">🔗</span> Kombiwette · {legs.length} Tipps
          </div>
          <div className="text-xs text-gray-400">Quote {totalOdds.toFixed(2)} · Einsatz {stake.toFixed(0)} €</div>
        </div>
        <div className="text-right flex-shrink-0">
          {status === 'won' && cb?.payout != null && <div className="text-xs font-black text-green-600">+{cb.payout.toFixed(2)} €</div>}
          {status === 'pending' && <div className="text-xs text-gray-500">→ {potential} €</div>}
          {status === 'lost' && <div className="text-xs text-red-400 line-through">{stake.toFixed(2)} €</div>}
        </div>
      </div>
      {/* Legs */}
      <div className="pl-9 space-y-1">
        {legs.map(leg => {
          const score = scoreStr(leg)
          return (
            <div key={leg.id} className="flex items-center gap-1.5 text-xs">
              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${leg.status === 'won' ? 'bg-green-500' : leg.status === 'lost' ? 'bg-red-400' : 'bg-yellow-400'}`} />
              <span className="text-gray-500 truncate flex-1">{matchName(leg)}</span>
              <span className="font-medium text-gray-800">{selLabel(leg.market_type, leg.selection)}</span>
              {score && <span className="text-gray-400">({score})</span>}
              <span className="text-red-700 font-bold">@{leg.odds_value.toFixed(2)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function UserBets({
  bets,
  combos,
  noDataLabel,
}: {
  bets: BetRow[]
  combos: Record<string, ComboMeta>
  noDataLabel: string
}) {
  if (bets.length === 0) {
    return <p className="text-xs text-gray-400 italic py-1">{noDataLabel}</p>
  }

  type DisplayItem = { kind: 'single'; bet: BetRow } | { kind: 'combo'; legs: BetRow[]; cb: ComboMeta | undefined }
  const seen = new Set<string>()
  const items: DisplayItem[] = []
  for (const b of bets) {
    if (!b.combo_id) {
      items.push({ kind: 'single', bet: b })
    } else if (!seen.has(b.combo_id)) {
      seen.add(b.combo_id)
      items.push({ kind: 'combo', legs: bets.filter(x => x.combo_id === b.combo_id), cb: combos[b.combo_id] })
    }
  }

  return (
    <div className="space-y-2">
      {items.map((item, i) =>
        item.kind === 'single'
          ? <SingleBetMini key={item.bet.id} bet={item.bet} />
          : <ComboBetMini key={i} legs={item.legs} cb={item.cb} />
      )}
    </div>
  )
}

export function LeaderboardClient({
  profiles,
  currentUserId,
  matchdayBets,
  matchdayNumber,
  combos,
  isDeadlinePassed,
}: {
  profiles: Profile[]
  currentUserId: string | null
  matchdayBets: BetRow[]
  matchdayNumber: number | null
  combos: Record<string, ComboMeta>
  isDeadlinePassed: boolean
}) {
  const [activeTab, setActiveTab] = useState<'rangliste' | 'spieltag'>('rangliste')
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(currentUserId ? [currentUserId] : [])
  )

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const top3 = profiles.slice(0, 3)

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
        <button
          onClick={() => setActiveTab('rangliste')}
          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
            activeTab === 'rangliste' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          Rangliste
        </button>
        <button
          onClick={() => setActiveTab('spieltag')}
          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
            activeTab === 'spieltag' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          {matchdayNumber ? `Spieltag ${matchdayNumber}` : 'Spieltag'}
        </button>
      </div>

      {/* ── Rangliste Tab ── */}
      {activeTab === 'rangliste' && (
        <>
          {/* Top 3 Podium */}
          {top3.length >= 3 && (
            <div className="flex items-end justify-center gap-3 px-2">
              <PodiumCard rank={2} profile={top3[1]} isMe={top3[1].id === currentUserId} />
              <PodiumCard rank={1} profile={top3[0]} isMe={top3[0].id === currentUserId} featured />
              <PodiumCard rank={3} profile={top3[2]} isMe={top3[2].id === currentUserId} />
            </div>
          )}

          {/* Accordion list */}
          <div className="space-y-2">
            {profiles.map((profile, idx) => {
              const rank = idx + 1
              const profit = profile.balance - STARTING_BALANCE
              const isMe = profile.id === currentUserId
              const isOpen = expanded.has(profile.id)
              const userBets = matchdayBets.filter(b => b.user_id === profile.id)
              const hasBets = userBets.length > 0

              return (
                <div
                  key={profile.id}
                  className={`rounded-xl border overflow-hidden transition-all ${
                    isMe ? 'bg-red-50 border-red-200 shadow-sm' : 'bg-white border-gray-100'
                  }`}
                >
                  {/* Row header — clickable */}
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 text-left"
                    onClick={() => toggle(profile.id)}
                  >
                    {/* Rank */}
                    <div className="w-8 flex-shrink-0 text-center">
                      {rank <= 3 ? (
                        <span className="text-lg">{rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}</span>
                      ) : (
                        <span className="text-sm font-bold text-gray-400">{rank}</span>
                      )}
                    </div>
                    {/* Avatar */}
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm ${isMe ? 'bg-red-700 text-white' : 'bg-gray-100 text-gray-600'}`}>
                      {(profile.display_name || profile.username || '?')[0].toUpperCase()}
                    </div>
                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 truncate text-sm">
                        {profile.display_name || profile.username}
                        {isMe && <span className="ml-1.5 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">Du</span>}
                      </div>
                      <div className="text-xs text-gray-400">@{profile.username}</div>
                    </div>
                    {/* Balance */}
                    <div className="text-right flex-shrink-0 mr-1">
                      <div className="font-bold text-gray-900 text-sm">
                        {profile.balance.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })}
                      </div>
                      <div className={`text-xs font-medium ${profit > 0 ? 'text-green-600' : profit < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {profit >= 0 ? '+' : ''}{profit.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    {/* Chevron */}
                    <svg
                      className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Expanded bets */}
                  {isOpen && (
                    <div className="px-4 pb-3 border-t border-gray-100 pt-2">
                      {!isDeadlinePassed && !isMe ? (
                        <p className="text-xs text-gray-400 italic">Tipps werden nach Annahmeschluss sichtbar</p>
                      ) : !hasBets ? (
                        <p className="text-xs text-gray-400 italic">Keine Tipps für diesen Spieltag</p>
                      ) : (
                        <UserBets
                          bets={userBets}
                          combos={combos}
                          noDataLabel="Keine Tipps"
                        />
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
          {matchdayNumber && (
            <div className="text-sm text-gray-500 font-medium px-1">
              Alle Tipps — {matchdayNumber}. Spieltag
              {!isDeadlinePassed && (
                <span className="ml-2 text-xs text-yellow-600">· sichtbar nach Annahmeschluss</span>
              )}
            </div>
          )}
          {profiles.map(profile => {
            const isMe = profile.id === currentUserId
            const userBets = matchdayBets.filter(b => b.user_id === profile.id)
            if (!isDeadlinePassed && !isMe) return null
            return (
              <div key={profile.id} className={`rounded-xl border overflow-hidden ${isMe ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}>
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 ${isMe ? 'bg-red-700 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    {(profile.display_name || profile.username || '?')[0].toUpperCase()}
                  </div>
                  <div className="font-semibold text-sm text-gray-900">
                    {profile.display_name || profile.username}
                    {isMe && <span className="ml-1.5 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">Du</span>}
                  </div>
                  <div className="ml-auto text-xs text-gray-400">{userBets.length} Wette{userBets.length !== 1 ? 'n' : ''}</div>
                </div>
                <div className="px-4 py-2">
                  <UserBets
                    bets={userBets}
                    combos={combos}
                    noDataLabel="Keine Tipps für diesen Spieltag"
                  />
                </div>
              </div>
            )
          })}
          {!isDeadlinePassed && (
            <p className="text-center text-xs text-gray-400 py-4">
              Die Tipps der anderen werden nach Annahmeschluss sichtbar.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function PodiumCard({
  rank, profile, isMe, featured = false,
}: {
  rank: number
  profile: Profile
  isMe: boolean
  featured?: boolean
}) {
  const profit = profile.balance - STARTING_BALANCE
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'
  const heights = { 1: 'h-32', 2: 'h-24', 3: 'h-20' } as const
  const colors = {
    1: 'bg-yellow-100 border-2 border-yellow-300',
    2: 'bg-gray-100 border-2 border-gray-300',
    3: 'bg-orange-50 border-2 border-orange-200',
  } as const

  return (
    <div className="flex-1 flex flex-col items-center">
      <div className={`rounded-full flex items-center justify-center font-bold mb-2 ${featured ? 'w-14 h-14 text-xl' : 'w-12 h-12 text-lg'} ${isMe ? 'bg-red-700 text-white ring-2 ring-red-300' : 'bg-gray-200 text-gray-700'}`}>
        {(profile.display_name || profile.username || '?')[0].toUpperCase()}
      </div>
      <div className="text-center mb-1">
        <div className="text-xs font-semibold text-gray-800 truncate max-w-20">
          {profile.display_name || profile.username}
        </div>
        <div className={`text-xs font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {profit >= 0 ? '+' : ''}{profit.toFixed(0)} €
        </div>
      </div>
      <div className={`${heights[rank as 1 | 2 | 3]} w-full rounded-t-xl flex items-end justify-center pb-2 ${colors[rank as 1 | 2 | 3]}`}>
        <span className="text-2xl">{medal}</span>
      </div>
    </div>
  )
}
