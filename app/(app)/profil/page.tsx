import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PushSubscribeButton } from '@/components/PushSubscribeButton'
import { ProfileEditForm } from '@/components/ProfileEditForm'
import { BetHistoryWithCancel } from '@/components/BetHistoryWithCancel'
import { ThemeToggle } from '@/components/ThemeToggle'

export const revalidate = 60

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
  goalscorer_2plus: 'Torschütze 2+',
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

function selLabel(marketType: string, selection: string): string {
  if (marketType === 'exact_score') return selection
  return SELECTION_LABELS[selection] ?? selection
}

export default async function ProfilPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/login')

  const CURRENT_SEASON = '26/27'
  const PREV_SEASON = '25/26'

  const { data: betsRaw } = await supabase
    .from('bets')
    .select(
      `id, market_type, selection, stake, odds_value, status, payout, created_at, combo_id, season,
       match:matches(id, matchday, match_date, home_score, away_score, status,
         home_team:teams!matches_home_team_id_fkey(name, short_name),
         away_team:teams!matches_away_team_id_fkey(name, short_name)
       )`
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(120)

  const allBets = (betsRaw ?? []).map(b => ({
    ...b,
    match: (() => {
      const m = Array.isArray(b.match) ? b.match[0] : b.match
      if (!m) return null
      return {
        ...m,
        home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
        away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
      }
    })(),
  }))

  // Split by season: current = '26/27' (or unknown), prev = '25/26'
  const bets = allBets.filter(b => !b.season || b.season === CURRENT_SEASON)
  const prevBets = allBets.filter(b => b.season === PREV_SEASON)

  // Fetch combo_bets metadata — current season
  const comboIds = [...new Set(bets.filter(b => b.combo_id).map(b => b.combo_id as string))]
  const comboBetsMap = new Map<string, { id: string; stake: number; total_odds: number; status: string; payout: number | null }>()
  if (comboIds.length > 0) {
    const { data: cbData } = await supabase
      .from('combo_bets')
      .select('id, stake, total_odds, status, payout')
      .in('id', comboIds)
    for (const cb of cbData ?? []) comboBetsMap.set(cb.id, cb)
  }

  // Fetch combo_bets metadata — previous season
  const prevComboIds = [...new Set(prevBets.filter(b => b.combo_id).map(b => b.combo_id as string))]
  const prevComboBetsMap = new Map<string, { id: string; stake: number; total_odds: number; status: string; payout: number | null }>()
  if (prevComboIds.length > 0) {
    const { data: pcbData } = await supabase
      .from('combo_bets')
      .select('id, stake, total_odds, status, payout')
      .in('id', prevComboIds)
    for (const cb of pcbData ?? []) prevComboBetsMap.set(cb.id, cb)
  }

  // Wildenroth roster for goalscorer bet labels
  const { data: rosterRows } = await supabase
    .from('wildenroth_players')
    .select('id, name')
  const playerNameMap: Record<number, string> = Object.fromEntries((rosterRows ?? []).map(r => [r.id, r.name]))

  // Determine per-matchday deadline for cancel eligibility
  const betMatchdays = [...new Set(bets.filter(b => b.match?.matchday).map(b => b.match!.matchday))]
  const matchdayDeadlinesPassed: Record<number, boolean> = {}
  if (betMatchdays.length > 0) {
    const { data: scheduledFirst } = await supabase
      .from('matches')
      .select('matchday, match_date')
      .eq('status', 'scheduled')
      .in('matchday', betMatchdays)
      .order('match_date', { ascending: true })
    const firstByMd = new Map<number, string>()
    for (const m of scheduledFirst ?? []) {
      if (!firstByMd.has(m.matchday)) firstByMd.set(m.matchday, m.match_date)
    }
    for (const md of betMatchdays) {
      const firstDate = firstByMd.get(md)
      matchdayDeadlinesPassed[md] = !firstDate || new Date(firstDate) <= new Date()
    }
  }

  // Build ordered display items (singles in order; combos inserted at position of their first leg)
  type SingleItem = { kind: 'single'; bet: typeof bets[0] }
  type ComboItem = { kind: 'combo'; comboId: string; legs: typeof bets[0][]; cb: typeof comboBetsMap extends Map<string, infer V> ? V : never | undefined }
  type HistoryItem = SingleItem | ComboItem

  const seenCombos = new Set<string>()
  const historyItems: HistoryItem[] = []
  for (const bet of bets) {
    if (!bet.combo_id) {
      historyItems.push({ kind: 'single', bet })
    } else if (!seenCombos.has(bet.combo_id)) {
      seenCombos.add(bet.combo_id)
      const legs = bets.filter(b => b.combo_id === bet.combo_id)
      historyItems.push({ kind: 'combo', comboId: bet.combo_id, legs, cb: comboBetsMap.get(bet.combo_id) as never })
    }
  }

  // Stats (all bets; combo counted as one bet via combo_bets)
  const singleBets = bets.filter(b => !b.combo_id)
  const totalBets = singleBets.length + comboBetsMap.size
  const wonBets = singleBets.filter(b => b.status === 'won').length +
    [...comboBetsMap.values()].filter(cb => cb.status === 'won').length
  const lostBets = singleBets.filter(b => b.status === 'lost').length +
    [...comboBetsMap.values()].filter(cb => cb.status === 'lost').length
  const pendingBets = singleBets.filter(b => b.status === 'pending').length +
    [...comboBetsMap.values()].filter(cb => cb.status === 'pending').length
  const totalStaked = singleBets.reduce((acc, b) => acc + (b.stake ?? 0), 0) +
    [...comboBetsMap.values()].reduce((acc, cb) => acc + cb.stake, 0)
  const totalPayout = singleBets.filter(b => b.status === 'won').reduce((acc, b) => acc + (b.payout ?? 0), 0) +
    [...comboBetsMap.values()].filter(cb => cb.status === 'won').reduce((acc, cb) => acc + (cb.payout ?? 0), 0)
  const profit = profile.balance - (profile.season_start_balance ?? 1000)

  // Previous season quick stats (singles + combos)
  const prevSingleBets = prevBets.filter(b => !b.combo_id)
  const prevSingleWon = prevSingleBets.filter(b => b.status === 'won').length
  const prevSingleLost = prevSingleBets.filter(b => b.status === 'lost').length
  const prevComboWon = [...prevComboBetsMap.values()].filter(cb => cb.status === 'won').length
  const prevComboLost = [...prevComboBetsMap.values()].filter(cb => cb.status === 'lost').length
  const prevWon = prevSingleWon + prevComboWon
  const prevLost = prevSingleLost + prevComboLost
  const prevTotalBets = prevSingleBets.length + prevComboBetsMap.size
  const prevStaked = prevSingleBets.reduce((acc, b) => acc + (b.stake ?? 0), 0)
    + [...prevComboBetsMap.values()].reduce((acc, cb) => acc + cb.stake, 0)
  const prevPayout = prevSingleBets.filter(b => b.status === 'won').reduce((acc, b) => acc + (b.payout ?? 0), 0)
    + [...prevComboBetsMap.values()].filter(cb => cb.status === 'won').reduce((acc, cb) => acc + (cb.payout ?? 0), 0)
  const prevProfit = prevPayout - prevStaked

  // Extended stats
  const settledCount = wonBets + lostBets
  const hitRate = settledCount > 0 ? Math.round((wonBets / settledCount) * 100) : null

  // Best single win
  const bestSingleWin = singleBets
    .filter(b => b.status === 'won' && b.payout != null)
    .sort((a, b) => (b.payout ?? 0) - b.stake - ((a.payout ?? 0) - a.stake))[0] ?? null
  const bestSingleProfit = bestSingleWin ? (bestSingleWin.payout ?? 0) - (bestSingleWin.stake ?? 0) : null

  // Best combo win
  const bestComboWin = [...comboBetsMap.values()]
    .filter(cb => cb.status === 'won' && cb.payout != null)
    .sort((a, b) => (b.payout ?? 0) - b.stake - ((a.payout ?? 0) - a.stake))[0] ?? null
  const bestComboProfit = bestComboWin ? (bestComboWin.payout ?? 0) - bestComboWin.stake : null
  const bestWinProfit = Math.max(bestSingleProfit ?? 0, bestComboProfit ?? 0)
  const hasBestWin = bestWinProfit > 0

  // Favorite market
  const marketCounts: Record<string, number> = {}
  for (const b of singleBets.filter(b => b.status !== 'pending')) {
    marketCounts[b.market_type] = (marketCounts[b.market_type] ?? 0) + 1
  }
  const favoriteMarketEntry = Object.entries(marketCounts).sort((a, b) => b[1] - a[1])[0]
  const favoriteMarket = favoriteMarketEntry ? MARKET_LABELS[favoriteMarketEntry[0]] ?? favoriteMarketEntry[0] : null

  // Combo rate
  const comboCount = [...comboBetsMap.values()].filter(cb => cb.status !== 'pending').length
  const comboRate = settledCount + comboCount > 0 ? Math.round((comboCount / (settledCount + comboCount)) * 100) : null

  // Risky bets (odds > 20 for singles, total_odds > 20 for combos)
  const riskyWon = singleBets.filter(b => b.odds_value > 20 && b.status === 'won').length +
    [...comboBetsMap.values()].filter(cb => (cb.total_odds ?? 0) > 20 && cb.status === 'won').length
  const riskyLost = singleBets.filter(b => b.odds_value > 20 && b.status === 'lost').length +
    [...comboBetsMap.values()].filter(cb => (cb.total_odds ?? 0) > 20 && cb.status === 'lost').length
  const riskyTotal = riskyWon + riskyLost

  // Balance history: reconstruct from settled bets ordered by match date
  const settledBets = [...bets]
    .filter(b => b.status !== 'pending' && b.match?.match_date)
    .sort((a, b) => new Date(a.match!.match_date).getTime() - new Date(b.match!.match_date).getTime())

  // Also fetch combo_bets settled for chart
  const comboSettled = [...comboBetsMap.values()].filter(cb => cb.status !== 'pending')

  // Combine events: single bet placements/settlements and combo settlements
  type BalanceEvent = { date: string; delta: number }
  const events: BalanceEvent[] = []
  const processedCombos = new Set<string>()

  for (const b of settledBets) {
    if (!b.match?.match_date) continue
    if (b.combo_id) {
      if (!processedCombos.has(b.combo_id)) {
        processedCombos.add(b.combo_id)
        const cb = comboBetsMap.get(b.combo_id)
        if (cb && cb.status !== 'pending') {
          // stake deducted at placement (not tracked here), payout added on win
          events.push({ date: b.match.match_date, delta: cb.status === 'won' ? (cb.payout ?? 0) - cb.stake : -cb.stake })
        }
      }
    } else {
      const stake = b.stake ?? 0
      const payout = b.payout ?? 0
      events.push({ date: b.match.match_date, delta: b.status === 'won' ? payout - stake : -stake })
    }
  }

  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  const balancePoints: number[] = [1000]
  for (const e of events) {
    balancePoints.push(balancePoints[balancePoints.length - 1] + e.delta)
  }

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Profile Header */}
      <div className="bg-gradient-to-br from-red-700 to-red-900 text-white rounded-2xl px-5 py-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center flex-shrink-0">
            <span className="text-red-700 font-black text-2xl">
              {(profile.display_name || profile.username || '?')[0].toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-black truncate">
              {profile.display_name || profile.username}
            </h1>
            <p className="text-red-200 text-sm">@{profile.username}</p>
            <p className="text-red-200 text-xs mt-0.5">{user.email}</p>
          </div>
        </div>
      </div>

      {/* Balance */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 shadow-sm">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Guthaben <span className="text-[10px]">26/27</span></div>
          <div className="text-xl font-black text-gray-900 dark:text-gray-100">
            {profile.balance.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 shadow-sm">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Gewinn/Verlust <span className="text-[10px]">26/27</span></div>
          <div className={`text-xl font-black ${profit > 0 ? 'text-green-600' : profit < 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {profit >= 0 ? '+' : ''}{profit.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-gray-100">Statistiken</h2>
        </div>
        <div className="grid grid-cols-4 divide-x divide-gray-100 dark:divide-gray-700">
          <StatCell label="Gesamt" value={totalBets} />
          <StatCell label="Gewonnen" value={wonBets} color="text-green-600" />
          <StatCell label="Verloren" value={lostBets} color="text-red-600" />
          <StatCell label="Offen" value={pendingBets} color="text-yellow-600" />
        </div>
        <div className="grid grid-cols-2 divide-x divide-gray-100 dark:divide-gray-700 border-t border-gray-100 dark:border-gray-700">
          <div className="px-4 py-3 text-center">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Eingesetzt</div>
            <div className="font-bold text-gray-900 dark:text-gray-100 text-sm">{totalStaked.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })}</div>
          </div>
          <div className="px-4 py-3 text-center">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Ausgezahlt</div>
            <div className="font-bold text-green-600 text-sm">{totalPayout.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })}</div>
          </div>
        </div>
      </div>

      {/* Extended Stats */}
      {settledCount >= 3 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-700">
            <h2 className="font-bold text-gray-900 dark:text-gray-100">Spieler-Stats</h2>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-gray-100 dark:divide-gray-700">
            {hitRate !== null && (
              <StatTile
                emoji="🎯"
                label="Trefferquote"
                value={`${hitRate} %`}
                sub={`${wonBets}/${settledCount} Wetten`}
                color={hitRate >= 55 ? 'text-green-600' : hitRate >= 40 ? 'text-amber-600' : 'text-red-600'}
              />
            )}
            {hasBestWin && (
              <StatTile
                emoji="🏅"
                label="Bester Gewinn"
                value={`+${bestWinProfit.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`}
                sub={bestComboProfit != null && bestComboProfit >= (bestSingleProfit ?? 0) ? 'Kombiwette' : 'Einzelwette'}
                color="text-green-600"
              />
            )}
            {favoriteMarket && favoriteMarketEntry && (
              <StatTile
                emoji="📊"
                label="Lieblingsmarkt"
                value={favoriteMarket}
                sub={`${favoriteMarketEntry[1]}× getippt`}
                color="text-blue-700"
              />
            )}
            {comboRate !== null && (
              <StatTile
                emoji="🔗"
                label="Kombi-Anteil"
                value={`${comboRate} %`}
                sub={`${comboCount} Kombis`}
                color="text-purple-700"
              />
            )}
            {riskyTotal > 0 && (
              <StatTile
                emoji="🎲"
                label="Risky-Bilanz"
                value={`${riskyWon}W / ${riskyLost}V`}
                sub="Wetten mit Quote >20"
                color={riskyWon > riskyLost ? 'text-green-600' : 'text-red-600'}
              />
            )}
          </div>
        </div>
      )}

      {/* Balance Chart */}
      {balancePoints.length >= 2 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-700 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-gray-900 dark:text-gray-100">Guthaben-Verlauf</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Stand nach abgeschlossenen Spieltagen</p>
            </div>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${profit >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
              {profit >= 0 ? '+' : ''}{profit.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €
            </span>
          </div>
          <div className="px-4 py-3">
            <BalanceSparkline points={balancePoints} />
          </div>
        </div>
      )}

      {/* Theme Toggle */}
      <ThemeToggle />

      {/* Push Notifications */}
      <PushSubscribeButton />

      {/* Bet History */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-gray-100">Wetthistorie</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Letzte {historyItems.length} Einträge</p>
        </div>

        {historyItems.length === 0 ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500">
            <div className="text-3xl mb-2">🎯</div>
            <div className="text-sm">Noch keine Wetten platziert</div>
          </div>
        ) : (
          <BetHistoryWithCancel items={historyItems as never} matchdayDeadlinesPassed={matchdayDeadlinesPassed} playerNameMap={playerNameMap} />
        )}
      </div>

      {/* Profile Edit */}
      <ProfileEditForm
        displayName={profile.display_name || profile.username}
        username={profile.username}
      />

      {/* Previous season summary — at the bottom, collapsed by default */}
      {prevBets.length > 0 && (
        <details className="bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-gray-600 dark:text-gray-300 list-none flex items-center justify-between">
            <span>Letzte Saison 25/26</span>
            <span className="text-xs text-gray-400">{prevTotalBets} Wetten ▼</span>
          </summary>
          <div className="px-4 pb-4 pt-1 grid grid-cols-2 gap-3">
            <div className="bg-white dark:bg-gray-700 rounded-xl p-3 text-center">
              <div className="text-xs text-gray-400 mb-1">Gewonnen / Verloren</div>
              <div className="font-black text-sm text-gray-800 dark:text-gray-100">{prevWon}W / {prevLost}V</div>
            </div>
            <div className="bg-white dark:bg-gray-700 rounded-xl p-3 text-center">
              <div className="text-xs text-gray-400 mb-1">Ergebnis 25/26</div>
              <div className={`font-black text-sm ${prevProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {prevProfit >= 0 ? '+' : ''}{prevProfit.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="col-span-2 bg-white dark:bg-gray-700 rounded-xl p-3 text-center">
              <div className="text-xs text-gray-400 mb-1">Eingesetzt / Ausgezahlt</div>
              <div className="font-bold text-sm text-gray-800 dark:text-gray-100">
                {prevStaked.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })} / {prevPayout.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </details>
      )}

      <SignOutButton />
    </div>
  )
}

function StatTile({ emoji, label, value, sub, color }: { emoji: string; label: string; value: string; sub: string; color: string }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-base">{emoji}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      </div>
      <div className={`text-sm font-black ${color}`}>{value}</div>
      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{sub}</div>
    </div>
  )
}

function StatCell({ label, value, color = 'text-gray-900 dark:text-gray-100' }: { label: string; value: number; color?: string }) {
  return (
    <div className="px-2 py-3 text-center">
      <div className={`text-lg font-black ${color}`}>{value}</div>
      <div className="text-xs text-gray-400 dark:text-gray-500">{label}</div>
    </div>
  )
}

function SignOutButton() {
  return (
    <form action="/api/auth/signout" method="POST">
      <button
        type="submit"
        className="w-full py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-xl transition-colors text-sm"
      >
        Abmelden
      </button>
    </form>
  )
}

function BalanceSparkline({ points }: { points: number[] }) {
  const W = 320
  const H = 72
  const pad = 4
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1

  const xs = points.map((_, i) => pad + (i / (points.length - 1)) * (W - 2 * pad))
  const ys = points.map((v) => H - pad - ((v - min) / range) * (H - 2 * pad))

  const pathD = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')
  const fillD = `${pathD} L${xs[xs.length - 1].toFixed(1)},${H} L${xs[0].toFixed(1)},${H} Z`

  const isUp = points[points.length - 1] >= points[0]
  const color = isUp ? '#16a34a' : '#dc2626'
  const fillColor = isUp ? '#dcfce7' : '#fee2e2'

  const baseline = H - pad - ((1000 - min) / range) * (H - 2 * pad)

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        {/* Baseline at 1000 */}
        <line x1={pad} y1={baseline.toFixed(1)} x2={W - pad} y2={baseline.toFixed(1)} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4,3" />
        {/* Fill */}
        <path d={fillD} fill={fillColor} opacity="0.5" />
        {/* Line */}
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Last point dot */}
        <circle cx={xs[xs.length - 1].toFixed(1)} cy={ys[ys.length - 1].toFixed(1)} r="3" fill={color} />
      </svg>
      <div className="flex justify-between text-xs text-gray-400 mt-1 px-1">
        <span>Start: 1.000 €</span>
        <span className={isUp ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
          Aktuell: {points[points.length - 1].toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €
        </span>
      </div>
    </div>
  )
}
