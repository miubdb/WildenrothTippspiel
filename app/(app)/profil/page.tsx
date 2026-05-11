import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 60

export default async function ProfilPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  // Fetch bets with match info
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
    .limit(50)

  const bets = betsRaw ?? []

  // Stats
  const totalBets = bets.filter((b) => b.combo_id === null).length
  const wonBets = bets.filter((b) => b.status === 'won' && b.combo_id === null).length
  const lostBets = bets.filter((b) => b.status === 'lost' && b.combo_id === null).length
  const pendingBets = bets.filter((b) => b.status === 'pending' && b.combo_id === null).length

  const totalStaked = bets
    .filter((b) => b.combo_id === null && b.status !== 'void')
    .reduce((acc, b) => acc + (b.stake ?? 0), 0)
  const totalPayout = bets
    .filter((b) => b.status === 'won')
    .reduce((acc, b) => acc + (b.payout ?? 0), 0)

  const profit = profile.balance - 1000

  const STARTING_BALANCE = 1000

  const marketLabels: Record<string, string> = {
    '1x2': '1X2',
    over_under: 'Über/Unter',
    btts: 'Beide treffen',
    exact_score: 'Genaues Ergebnis',
  }

  const selectionLabels: Record<string, string> = {
    home: 'Heimsieg',
    draw: 'Unentschieden',
    away: 'Auswärtssieg',
    over: 'Über 2,5',
    under: 'Unter 2,5',
    yes: 'Beide treffen',
    no: 'Nicht beide',
  }

  const statusLabels: Record<string, string> = {
    pending: 'Offen',
    won: 'Gewonnen',
    lost: 'Verloren',
    void: 'Ungültig',
  }

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    won: 'bg-green-100 text-green-800',
    lost: 'bg-red-100 text-red-800',
    void: 'bg-gray-100 text-gray-600',
  }

  async function handleSignOut() {
    'use server'
    // Sign out handled client-side
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

      {/* Balance Card */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
          <div className="text-xs text-gray-500 mb-1">Guthaben</div>
          <div className="text-xl font-black text-gray-900">
            {profile.balance.toLocaleString('de-DE', {
              style: 'currency',
              currency: 'EUR',
              minimumFractionDigits: 2,
            })}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
          <div className="text-xs text-gray-500 mb-1">Gewinn/Verlust</div>
          <div
            className={`text-xl font-black ${
              profit > 0 ? 'text-green-600' : profit < 0 ? 'text-red-600' : 'text-gray-900'
            }`}
          >
            {profit >= 0 ? '+' : ''}
            {profit.toLocaleString('de-DE', {
              style: 'currency',
              currency: 'EUR',
              minimumFractionDigits: 2,
            })}
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
            <div className="font-bold text-gray-900 text-sm">
              {totalStaked.toFixed(2)}€
            </div>
          </div>
          <div className="px-4 py-3 text-center">
            <div className="text-xs text-gray-500 mb-1">Ausgezahlt</div>
            <div className="font-bold text-green-600 text-sm">
              {totalPayout.toFixed(2)}€
            </div>
          </div>
        </div>
      </div>

      {/* Bet History */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50">
          <h2 className="font-bold text-gray-900">Wetthistorie</h2>
          <p className="text-xs text-gray-400 mt-0.5">Letzte 50 Wetten</p>
        </div>

        {bets.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <div className="text-3xl mb-2">🎯</div>
            <div className="text-sm">Noch keine Wetten platziert</div>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {bets.map((bet) => {
              const matchData = Array.isArray(bet.match) ? bet.match[0] : bet.match
              const homeTeam = Array.isArray(matchData?.home_team)
                ? matchData.home_team[0]
                : matchData?.home_team
              const awayTeam = Array.isArray(matchData?.away_team)
                ? matchData.away_team[0]
                : matchData?.away_team

              const matchLabel = homeTeam && awayTeam
                ? `${homeTeam.short_name ?? homeTeam.name} – ${awayTeam.short_name ?? awayTeam.name}`
                : 'Unbekanntes Spiel'

              const selLabel =
                selectionLabels[bet.selection] ?? bet.selection

              return (
                <div key={bet.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">
                          {marketLabels[bet.market_type] ?? bet.market_type}
                        </span>
                        {bet.combo_id && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                            Kombi
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-semibold text-gray-900 truncate">
                        {selLabel}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 truncate">{matchLabel}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span
                        className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${
                          statusColors[bet.status]
                        }`}
                      >
                        {statusLabels[bet.status]}
                      </span>
                      <div className="text-xs text-gray-500 mt-1">
                        {bet.stake?.toFixed(2)}€ @ {bet.odds_value?.toFixed(2)}
                      </div>
                      {bet.payout !== null && bet.status === 'won' && (
                        <div className="text-xs text-green-600 font-semibold mt-0.5">
                          +{bet.payout.toFixed(2)}€
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Sign Out */}
      <SignOutButton />
    </div>
  )
}

function StatCell({
  label,
  value,
  color = 'text-gray-900',
}: {
  label: string
  value: number
  color?: string
}) {
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
