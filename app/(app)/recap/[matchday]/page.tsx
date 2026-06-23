import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 300

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
}

function fmtAmt(n: number) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function RecapPage({
  params,
}: {
  params: Promise<{ matchday: string }>
}) {
  const { matchday: matchdayStr } = await params
  const matchday = parseInt(matchdayStr, 10)
  if (isNaN(matchday) || matchday < 1) notFound()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch matches for this matchday (current season only — matchday numbers
  // repeat across seasons, so filter by season start date like the rest of the app)
  const SEASON_START = '2026-08-01'
  const { data: matchRows } = await supabase
    .from('matches')
    .select(
      `id, match_date, home_score, away_score, status,
       home_team:teams!matches_home_team_id_fkey(name),
       away_team:teams!matches_away_team_id_fkey(name)`
    )
    .eq('matchday', matchday)
    .gte('match_date', SEASON_START)
    .order('match_date', { ascending: true })

  if (!matchRows || matchRows.length === 0) notFound()

  const matches = matchRows.map((m) => ({
    ...m,
    home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
    away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
  }))

  const matchIds = matches.map((m) => m.id)

  // Date range header
  const dates = matches.map((m) => new Date(m.match_date))
  const minDate = new Date(Math.min(...dates.map((d) => d.getTime())))
  const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())))
  const dateRange =
    minDate.toDateString() === maxDate.toDateString()
      ? minDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : `${minDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – ${maxDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`

  // Fetch all bets for these matches (all users), current season only
  const { data: betRows } = await supabase
    .from('bets')
    .select(`id, user_id, match_id, stake, payout, status, combo_id`)
    .in('match_id', matchIds)
    .eq('season', '26/27')
    .not('status', 'eq', 'pending')

  // Fetch combo_bets for combos that have at least one leg in this matchday
  const comboIds = [
    ...new Set(
      (betRows ?? [])
        .filter((b) => b.combo_id !== null)
        .map((b) => b.combo_id as number)
    ),
  ]

  type ComboBetRow = { id: number; user_id: string; stake: number; payout: number | null; status: string }
  let comboBetRows: ComboBetRow[] = []
  if (comboIds.length > 0) {
    const { data: cbData } = await supabase
      .from('combo_bets')
      .select('id, user_id, stake, payout, status')
      .in('id', comboIds)
      .not('status', 'eq', 'pending')
    comboBetRows = (cbData ?? []) as ComboBetRow[]
  }

  // Fetch profiles for display names
  const { data: profileRows } = await supabase
    .from('profiles')
    .select('id, display_name, username')

  const profileMap = new Map<string, { display_name: string | null; username: string }>(
    (profileRows ?? []).map((p) => [p.id, { display_name: p.display_name, username: p.username }])
  )

  function displayName(userId: string) {
    const p = profileMap.get(userId)
    if (!p) return 'Unbekannt'
    return p.display_name || p.username
  }

  // Per-user matchday P&L:
  // Singles: payout - stake for each bet whose match_id is in this matchday
  // Combos: only count a combo once — if it has ALL legs in this matchday
  // A combo that spans matchdays gets counted fully here (simplification)
  const singleBets = (betRows ?? []).filter((b) => b.combo_id === null)

  // Build per-user P&L map
  const userPnl = new Map<string, { staked: number; payout: number }>()

  for (const b of singleBets) {
    const cur = userPnl.get(b.user_id) ?? { staked: 0, payout: 0 }
    cur.staked += Number(b.stake ?? 0)
    if (b.status === 'won') cur.payout += Number(b.payout ?? 0)
    userPnl.set(b.user_id, cur)
  }

  // Count settled combo bets that have legs in this matchday
  const processedCombos = new Set<number>()
  for (const b of (betRows ?? []).filter((b) => b.combo_id !== null)) {
    if (processedCombos.has(b.combo_id as number)) continue
    processedCombos.add(b.combo_id as number)
    const cb = comboBetRows.find((c) => c.id === b.combo_id)
    if (!cb) continue
    const cur = userPnl.get(cb.user_id) ?? { staked: 0, payout: 0 }
    cur.staked += Number(cb.stake ?? 0)
    if (cb.status === 'won') cur.payout += Number(cb.payout ?? 0)
    userPnl.set(cb.user_id, cur)
  }

  // Sort by profit descending
  const leaderboard = [...userPnl.entries()]
    .map(([userId, { staked, payout }]) => ({
      userId,
      name: displayName(userId),
      staked,
      payout,
      profit: payout - staked,
    }))
    .sort((a, b) => b.profit - a.profit)

  // Current user's stats
  const myStats = userPnl.get(user.id)
  const myProfit = myStats ? myStats.payout - myStats.staked : null

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-br from-red-700 to-red-900 text-white rounded-2xl px-5 py-5 shadow-sm">
        <h1 className="text-xl font-black">Spieltag {matchday} – Recap</h1>
        <p className="text-red-200 text-sm mt-1">{dateRange}</p>
      </div>

      {/* Current user highlight */}
      {myStats && (
        <div
          className={`rounded-2xl border shadow-sm overflow-hidden ${
            myProfit !== null && myProfit >= 0
              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700'
              : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700'
          }`}
        >
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <h2 className="font-bold text-gray-900 dark:text-gray-100">Dein Spieltag</h2>
          </div>
          <div className="grid grid-cols-3 divide-x divide-gray-100 dark:divide-gray-700">
            <div className="px-3 py-3 text-center">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Eingesetzt</div>
              <div className="font-bold text-gray-900 dark:text-gray-100 text-sm">
                {fmtAmt(myStats.staked)} Wildis
              </div>
            </div>
            <div className="px-3 py-3 text-center">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Ausgezahlt</div>
              <div className="font-bold text-green-600 text-sm">{fmtAmt(myStats.payout)} Wildis</div>
            </div>
            <div className="px-3 py-3 text-center">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Ergebnis</div>
              <div
                className={`font-black text-sm ${
                  myProfit !== null && myProfit >= 0 ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {myProfit !== null && myProfit >= 0 ? '+' : ''}
                {fmtAmt(myProfit ?? 0)} Wildis
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ergebnisse */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-gray-100">Ergebnisse</h2>
        </div>
        <div className="divide-y divide-gray-50 dark:divide-gray-700">
          {matches.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">
                  {fmtDate(m.match_date)}
                </div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                  {m.home_team?.name ?? '?'} – {m.away_team?.name ?? '?'}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                {m.status === 'finished' && m.home_score !== null ? (
                  <span className="text-base font-black text-gray-900 dark:text-gray-100">
                    {m.home_score}:{m.away_score}
                  </span>
                ) : m.status === 'postponed' ? (
                  <span className="text-xs text-yellow-600 font-semibold px-2 py-0.5 bg-yellow-50 dark:bg-yellow-900/30 rounded-full">
                    Verschoben
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">–</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Rangliste */}
      {leaderboard.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-700">
            <h2 className="font-bold text-gray-900 dark:text-gray-100">Rangliste</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Spieltag {matchday}</p>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {leaderboard.map((entry, idx) => {
              const isMe = entry.userId === user.id
              return (
                <div
                  key={entry.userId}
                  className={`flex items-center gap-3 px-4 py-3 ${isMe ? 'bg-red-50 dark:bg-red-900/10' : ''}`}
                >
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${
                      idx === 0
                        ? 'bg-yellow-400 text-white'
                        : idx === 1
                        ? 'bg-gray-300 text-gray-700'
                        : idx === 2
                        ? 'bg-amber-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300'
                    }`}
                  >
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5">
                      {entry.name}
                      {isMe && (
                        <span className="text-[10px] bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded font-bold">
                          Du
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">
                      Eingesetzt: {fmtAmt(entry.staked)} Wildis · Ausgezahlt: {fmtAmt(entry.payout)} Wildis
                    </div>
                  </div>
                  <div
                    className={`text-sm font-black flex-shrink-0 ${
                      entry.profit >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {entry.profit >= 0 ? '+' : ''}
                    {fmtAmt(entry.profit)} Wildis
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {leaderboard.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm py-10 text-center">
          <div className="text-3xl mb-2">🎯</div>
          <div className="text-sm text-gray-400 dark:text-gray-500">Keine abgeschlossenen Wetten für diesen Spieltag.</div>
        </div>
      )}
    </div>
  )
}
