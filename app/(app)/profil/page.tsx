import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 60

const MARKET_LABELS: Record<string, string> = {
  '1x2': '1X2',
  double_chance: 'Doppelte Chance',
  over_under: 'Über/Unter',
  over_under_3_5: 'Über/Unter 3,5',
  btts: 'Beide treffen',
  exact_score: 'Genaues Ergebnis',
}

const SELECTION_LABELS: Record<string, string> = {
  home: 'Heimsieg',
  draw: 'Unentschieden',
  away: 'Auswärtssieg',
  '1x': '1X',
  x2: 'X2',
  '12': '12',
  'over_3.5': 'Über 3,5',
  'under_3.5': 'Unter 3,5',
  yes: 'Beide treffen',
  no: 'Nicht beide',
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

  const { data: betsRaw } = await supabase
    .from('bets')
    .select(
      `id, market_type, selection, stake, odds_value, status, payout, created_at, combo_id,
       match:matches(id, matchday, match_date, home_score, away_score, status,
         home_team:teams!matches_home_team_id_fkey(name, short_name),
         away_team:teams!matches_away_team_id_fkey(name, short_name)
       )`
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(60)

  const bets = (betsRaw ?? []).map(b => ({
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

  // Fetch combo_bets metadata
  const comboIds = [...new Set(bets.filter(b => b.combo_id).map(b => b.combo_id as string))]
  const comboBetsMap = new Map<string, { id: string; stake: number; total_odds: number; status: string; payout: number | null }>()
  if (comboIds.length > 0) {
    const { data: cbData } = await supabase
      .from('combo_bets')
      .select('id, stake, total_odds, status, payout')
      .in('id', comboIds)
    for (const cb of cbData ?? []) comboBetsMap.set(cb.id, cb)
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

  // Stats (singles only)
  const singles = bets.filter(b => !b.combo_id)
  const totalBets = singles.length
  const wonBets = singles.filter(b => b.status === 'won').length
  const lostBets = singles.filter(b => b.status === 'lost').length
  const pendingBets = singles.filter(b => b.status === 'pending').length
  const totalStaked = singles.reduce((acc, b) => acc + (b.stake ?? 0), 0)
  const totalPayout = bets.filter(b => b.status === 'won').reduce((acc, b) => acc + (b.payout ?? 0), 0)
  const profit = profile.balance - 1000

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
        <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
          <div className="text-xs text-gray-500 mb-1">Guthaben</div>
          <div className="text-xl font-black text-gray-900">
            {profile.balance.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
          <div className="text-xs text-gray-500 mb-1">Gewinn/Verlust</div>
          <div className={`text-xl font-black ${profit > 0 ? 'text-green-600' : profit < 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {profit >= 0 ? '+' : ''}{profit.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50">
          <h2 className="font-bold text-gray-900">Statistiken</h2>
        </div>
        <div className="grid grid-cols-4 divide-x divide-gray-100">
          <StatCell label="Gesamt" value={totalBets} />
          <StatCell label="Gewonnen" value={wonBets} color="text-green-600" />
          <StatCell label="Verloren" value={lostBets} color="text-red-600" />
          <StatCell label="Offen" value={pendingBets} color="text-yellow-600" />
        </div>
        <div className="grid grid-cols-2 divide-x divide-gray-100 border-t border-gray-100">
          <div className="px-4 py-3 text-center">
            <div className="text-xs text-gray-500 mb-1">Eingesetzt</div>
            <div className="font-bold text-gray-900 text-sm">{totalStaked.toFixed(2)}€</div>
          </div>
          <div className="px-4 py-3 text-center">
            <div className="text-xs text-gray-500 mb-1">Ausgezahlt</div>
            <div className="font-bold text-green-600 text-sm">{totalPayout.toFixed(2)}€</div>
          </div>
        </div>
      </div>

      {/* Bet History */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50">
          <h2 className="font-bold text-gray-900">Wetthistorie</h2>
          <p className="text-xs text-gray-400 mt-0.5">Letzte {historyItems.length} Einträge</p>
        </div>

        {historyItems.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <div className="text-3xl mb-2">🎯</div>
            <div className="text-sm">Noch keine Wetten platziert</div>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {historyItems.map((item) => {
              if (item.kind === 'single') {
                return <SingleBetCard key={item.bet.id} bet={item.bet} />
              }
              return <ComboBetCard key={item.comboId} legs={item.legs} cb={item.cb as never} />
            })}
          </div>
        )}
      </div>

      <SignOutButton />
    </div>
  )
}

type BetRow = {
  id: string
  market_type: string
  selection: string
  stake: number | null
  odds_value: number | null
  status: string
  payout: number | null
  created_at: string
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

type ComboBetData = { id: string; stake: number; total_odds: number; status: string; payout: number | null }

function matchLabel(bet: BetRow) {
  const m = bet.match
  if (!m) return 'Unbekanntes Spiel'
  const h = m.home_team?.short_name ?? m.home_team?.name ?? '?'
  const a = m.away_team?.short_name ?? m.away_team?.name ?? '?'
  return `${h} – ${a}`
}

function scoreStr(bet: BetRow) {
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

function SingleBetCard({ bet }: { bet: BetRow }) {
  const score = scoreStr(bet)
  const potentialPayout = (bet.stake ?? 0) * (bet.odds_value ?? 1)

  const borderColor = bet.status === 'won' ? 'border-l-green-500' :
    bet.status === 'lost' ? 'border-l-red-400' : 'border-l-yellow-400'
  const bgColor = bet.status === 'won' ? 'bg-green-50' :
    bet.status === 'lost' ? 'bg-red-50/40' : 'bg-white'

  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-l-4 ${borderColor} ${bgColor}`}>
      <StatusIcon status={bet.status} />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-gray-400 truncate">{matchLabel(bet)}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">
            {MARKET_LABELS[bet.market_type] ?? bet.market_type}
          </span>
          <span className="text-sm font-semibold text-gray-900">
            {selLabel(bet.market_type, bet.selection)}
          </span>
        </div>
        {score && (
          <div className="text-xs text-gray-400 mt-0.5">Ergebnis: <span className="font-semibold text-gray-600">{score}</span></div>
        )}
      </div>
      <div className="text-right flex-shrink-0 space-y-0.5">
        <div className="text-sm font-black text-red-700">@{bet.odds_value?.toFixed(2)}</div>
        <div className="text-xs text-gray-400">{bet.stake?.toFixed(0)}€</div>
        {bet.status === 'won' && bet.payout !== null && (
          <div className="text-xs font-bold text-green-600">+{bet.payout.toFixed(2)}€</div>
        )}
        {bet.status === 'pending' && (
          <div className="text-xs text-gray-400">→ {potentialPayout.toFixed(2)}€</div>
        )}
        {bet.status === 'lost' && (
          <div className="text-xs text-red-400 line-through">{bet.stake?.toFixed(2)}€</div>
        )}
      </div>
    </div>
  )
}

function ComboBetCard({ legs, cb }: { legs: BetRow[]; cb: ComboBetData | undefined }) {
  const status = cb?.status ?? legs[0]?.status ?? 'pending'
  const stake = cb?.stake ?? 0
  const totalOdds = cb?.total_odds ?? legs.reduce((acc, l) => acc * (l.odds_value ?? 1), 1)
  const potentialPayout = stake * totalOdds

  const borderColor = status === 'won' ? 'border-l-green-500' :
    status === 'lost' ? 'border-l-red-400' : 'border-l-blue-400'
  const bgColor = status === 'won' ? 'bg-green-50' :
    status === 'lost' ? 'bg-red-50/40' : 'bg-blue-50/30'

  return (
    <div className={`px-4 py-3 border-l-4 ${borderColor} ${bgColor}`}>
      {/* Combo Header */}
      <div className="flex items-center gap-3 mb-2">
        <StatusIcon status={status} />
        <div className="flex-1">
          <div className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
            <span className="text-blue-600">🔗</span>
            Kombiwette · {legs.length} Tipps
          </div>
          <div className="text-xs text-gray-400">
            Quote {totalOdds.toFixed(2)} · Einsatz {stake.toFixed(0)}€
          </div>
        </div>
        <div className="text-right">
          {status === 'won' && cb?.payout !== null && cb?.payout !== undefined && (
            <div className="text-sm font-black text-green-600">+{cb.payout.toFixed(2)}€</div>
          )}
          {status === 'pending' && (
            <div className="text-xs text-gray-500">→ {potentialPayout.toFixed(2)}€</div>
          )}
          {status === 'lost' && (
            <div className="text-xs text-red-400 line-through">{stake.toFixed(2)}€</div>
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
              <span className="text-gray-500 truncate flex-1">{matchLabel(leg)}</span>
              <span className="font-medium text-gray-800">{selLabel(leg.market_type, leg.selection)}</span>
              {score && <span className="text-gray-400">({score})</span>}
              <span className="text-red-700 font-bold">@{leg.odds_value?.toFixed(2)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatCell({ label, value, color = 'text-gray-900' }: { label: string; value: number; color?: string }) {
  return (
    <div className="px-2 py-3 text-center">
      <div className={`text-lg font-black ${color}`}>{value}</div>
      <div className="text-xs text-gray-400">{label}</div>
    </div>
  )
}

function SignOutButton() {
  return (
    <form action="/api/auth/signout" method="POST">
      <button
        type="submit"
        className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition-colors text-sm"
      >
        Abmelden
      </button>
    </form>
  )
}
