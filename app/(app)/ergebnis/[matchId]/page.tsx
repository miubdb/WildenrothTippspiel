import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { fmtWildi } from '@/components/WildiIcon'

export const revalidate = 60

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
const MKT_LABEL: Record<string, string> = {
  '1x2': '1X2', double_chance: 'Doppelte Chance',
  over_under: 'Ü/U 2,5', over_under_3_5: 'Ü/U 3,5', over_under_5_5: 'Ü/U 5,5', over_under_7_5: 'Ü/U 7,5',
  btts: 'Beide treffen', exact_score: 'Ergebnis', handicap: 'Handicap',
  goalscorer: 'Torschütze', goalscorer_2plus: 'Mind. 2 Tore',
}

function selLabel(marketType: string, selection: string, players: Record<number, string>): string {
  if (marketType === 'exact_score') return selection
  if (marketType === 'goalscorer' || marketType === 'goalscorer_2plus') {
    const id = parseInt(selection, 10)
    const name = players[id] ?? `Spieler #${id}`
    return marketType === 'goalscorer_2plus' ? `${name} (mind. 2 Tore)` : name
  }
  return SEL_LABEL[marketType]?.[selection] ?? selection
}

function fmt(n: number) { return fmtWildi(n) }

export default async function ErgebnisPage({
  params,
}: {
  params: Promise<{ matchId: string }>
}) {
  const { matchId: matchIdStr } = await params
  const matchId = parseInt(matchIdStr, 10)
  if (isNaN(matchId)) notFound()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: matchRaw } = await supabase
    .from('matches')
    .select(`
      id, matchday, match_date, home_score, away_score, status,
      home_team:teams!matches_home_team_id_fkey(name),
      away_team:teams!matches_away_team_id_fkey(name)
    `)
    .eq('id', matchId)
    .single()

  if (!matchRaw) notFound()

  const match = {
    ...matchRaw,
    home_team: Array.isArray(matchRaw.home_team) ? matchRaw.home_team[0] : matchRaw.home_team,
    away_team: Array.isArray(matchRaw.away_team) ? matchRaw.away_team[0] : matchRaw.away_team,
  }

  const { data: betsRaw } = await supabase
    .from('bets')
    .select('id, market_type, selection, stake, odds_value, status, payout, combo_id, is_risky')
    .eq('match_id', matchId)
    .eq('user_id', user.id)

  const bets = betsRaw ?? []
  const singles = bets.filter(b => !b.combo_id)
  const comboIds = [...new Set(bets.filter(b => b.combo_id).map(b => String(b.combo_id)))]

  // Fetch combo metadata and all legs
  type ComboRow = { id: number; stake: number; total_odds: number; status: string; payout: number | null }
  type ComboLeg = {
    id: number; match_id: number; market_type: string; selection: string
    odds_value: number; status: string; combo_id: number
    matchName: { home: string | null; away: string | null }
  }
  const combos: ComboRow[] = []
  const comboLegsMap: Record<number, ComboLeg[]> = {}

  if (comboIds.length > 0) {
    const { data: cbRows } = await supabase
      .from('combo_bets')
      .select('id, stake, total_odds, status, payout')
      .in('id', comboIds)
    for (const cb of cbRows ?? []) combos.push(cb)

    // Fetch ALL legs of each combo (other matches too, for display)
    const { data: allLegsRaw } = await supabase
      .from('bets')
      .select(`id, match_id, market_type, selection, odds_value, status, combo_id,
               match:matches(home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name))`)
      .in('combo_id', comboIds.map(Number))
    for (const raw of allLegsRaw ?? []) {
      const cid = Number(raw.combo_id)
      if (!comboLegsMap[cid]) comboLegsMap[cid] = []
      const m = Array.isArray(raw.match) ? raw.match[0] : raw.match
      const hTeam = m ? (Array.isArray(m.home_team) ? m.home_team[0] : m.home_team) : null
      const aTeam = m ? (Array.isArray(m.away_team) ? m.away_team[0] : m.away_team) : null
      comboLegsMap[cid].push({
        id: raw.id,
        match_id: raw.match_id,
        market_type: raw.market_type,
        selection: raw.selection,
        odds_value: raw.odds_value,
        status: raw.status,
        combo_id: cid,
        matchName: { home: hTeam?.name ?? null, away: aTeam?.name ?? null },
      })
    }
  }

  // Player name map for goalscorer bets
  const players: Record<number, string> = {}
  const goalBets = bets.filter(b => b.market_type === 'goalscorer' || b.market_type === 'goalscorer_2plus')
  if (goalBets.length > 0) {
    const pids = [...new Set(goalBets.map(b => parseInt(b.selection, 10)).filter(n => !isNaN(n)))]
    const { data: pRows } = await supabase.from('wildenroth_players').select('id, name').in('id', pids)
    for (const p of pRows ?? []) players[p.id] = p.name
  }

  const homeName = match.home_team?.name ?? '?'
  const awayName = match.away_team?.name ?? '?'
  const isFinished = match.status === 'finished'
  const matchDate = new Date(match.match_date).toLocaleDateString('de-DE', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  })

  // Net result across all settled bets/combos for this match
  const netAmount = singles.reduce((acc, b) => {
    if (b.status === 'won') return acc + (b.payout ?? 0) - (b.stake ?? 0)
    if (b.status === 'lost') return acc - (b.stake ?? 0)
    return acc
  }, 0) + combos.reduce((acc, cb) => {
    if (cb.status === 'won') return acc + (cb.payout ?? 0) - cb.stake
    if (cb.status === 'lost') return acc - cb.stake
    return acc
  }, 0)

  const hasBets = singles.length > 0 || combos.length > 0

  return (
    <div className="px-4 py-4 space-y-4 max-w-lg mx-auto">
      {/* Match header */}
      <div className={`rounded-2xl px-5 py-5 text-white shadow-sm ${isFinished ? 'bg-gradient-to-br from-gray-700 to-gray-900' : 'bg-gradient-to-br from-red-700 to-red-900'}`}>
        <div className="text-xs text-white/60 mb-1">{matchDate}</div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 text-left">
            <div className="font-black text-lg leading-tight">{homeName}</div>
          </div>
          {isFinished && match.home_score != null ? (
            <div className="text-3xl font-black tabular-nums px-3">
              {match.home_score} : {match.away_score}
            </div>
          ) : (
            <div className="text-white/40 font-light text-2xl px-3">vs</div>
          )}
          <div className="flex-1 text-right">
            <div className="font-black text-lg leading-tight">{awayName}</div>
          </div>
        </div>
        {!isFinished && (
          <div className="mt-2 text-xs text-white/60 text-center">Spiel noch nicht abgeschlossen</div>
        )}
      </div>

      {/* Net result chip */}
      {hasBets && isFinished && (
        <div className={`rounded-2xl px-5 py-4 text-center shadow-sm border ${netAmount > 0 ? 'bg-green-50 border-green-200' : netAmount < 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
          <div className="text-xs text-gray-500 mb-1">Ergebnis dieses Spiels</div>
          <div className={`text-2xl font-black ${netAmount > 0 ? 'text-green-600' : netAmount < 0 ? 'text-red-600' : 'text-gray-600'}`}>
            {netAmount >= 0 ? '+' : ''}{fmt(netAmount)} Wildis
          </div>
        </div>
      )}

      {/* No bets */}
      {!hasBets && (
        <div className="text-center py-10 text-gray-400">
          <div className="text-3xl mb-2">🎯</div>
          <div className="text-sm">Keine Wetten auf dieses Spiel</div>
        </div>
      )}

      {/* Single bets */}
      {singles.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <h2 className="font-bold text-gray-900 dark:text-gray-100">Einzelwetten</h2>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {singles.map(bet => {
              const won = bet.status === 'won'
              const lost = bet.status === 'lost'
              const pending = bet.status === 'pending'
              const accentCls = won ? 'border-l-green-500' : lost ? 'border-l-red-400' : 'border-l-amber-400'
              return (
                <div key={bet.id} className={`border-l-4 ${accentCls} px-4 py-3`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {bet.is_risky && (
                        <span className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 mr-1">🎲 Risky</span>
                      )}
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">{MKT_LABEL[bet.market_type] ?? bet.market_type}</span>
                      <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                        {selLabel(bet.market_type, bet.selection, players)}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        @{bet.odds_value.toFixed(2).replace('.', ',')} · Einsatz: {fmt(bet.stake ?? 0)} Wildis
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {won && (
                        <>
                          <div className="text-[10px] font-semibold text-green-600 bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 rounded-full">Gewonnen</div>
                          <div className="font-black text-green-600 mt-1">+{fmt((bet.payout ?? 0) - (bet.stake ?? 0))} Wildis</div>
                        </>
                      )}
                      {lost && (
                        <>
                          <div className="text-[10px] font-semibold text-red-600 bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 rounded-full">Verloren</div>
                          <div className="font-black text-red-500 mt-1">–{fmt(bet.stake ?? 0)} Wildis</div>
                        </>
                      )}
                      {pending && (
                        <div className="text-[10px] font-semibold text-amber-600 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full">Offen</div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Combo bets */}
      {combos.map(cb => {
        const legs = comboLegsMap[cb.id] ?? []
        const won = cb.status === 'won'
        const lost = cb.status === 'lost'
        const pending = cb.status === 'pending'
        const accentCls = won ? 'border-l-green-500' : lost ? 'border-l-red-400' : 'border-l-blue-400'
        return (
          <div key={cb.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className={`border-l-4 ${accentCls} px-4 py-3 flex items-center justify-between gap-2`}>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold bg-blue-600 text-white rounded px-1.5 py-0.5">KOMBI</span>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">{legs.length} Tipps · @{cb.total_odds.toFixed(2).replace('.', ',')}</span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Einsatz: {fmt(cb.stake)} Wildis</div>
              </div>
              <div className="text-right flex-shrink-0">
                {won && (
                  <>
                    <div className="text-[10px] font-semibold text-green-600 bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 rounded-full">Gewonnen</div>
                    <div className="font-black text-green-600 mt-1">+{fmt((cb.payout ?? 0) - cb.stake)} Wildis</div>
                  </>
                )}
                {lost && (
                  <>
                    <div className="text-[10px] font-semibold text-red-600 bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 rounded-full">Verloren</div>
                    <div className="font-black text-red-500 mt-1">–{fmt(cb.stake)} Wildis</div>
                  </>
                )}
                {pending && (
                  <div className="text-[10px] font-semibold text-amber-600 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full">Offen</div>
                )}
              </div>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {legs.map(leg => {
                const lHome = leg.matchName.home
                const lAway = leg.matchName.away
                const dotCls = leg.status === 'won' ? 'bg-green-500' : leg.status === 'lost' ? 'bg-red-400' : 'bg-amber-400'
                const isThisMatch = leg.match_id === matchId
                return (
                  <div key={leg.id} className={`flex items-start gap-2 px-4 py-2.5 ${isThisMatch ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${dotCls}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-gray-400 dark:text-gray-500">
                        {lHome ?? '?'} – {lAway ?? '?'}
                        {isThisMatch && <span className="ml-1 text-blue-500">← dieses Spiel</span>}
                      </div>
                      <div className="text-xs font-medium text-gray-800 dark:text-gray-200">
                        {selLabel(leg.market_type, leg.selection, players)}
                      </div>
                    </div>
                    <span className="text-xs font-bold text-red-600 dark:text-red-400 flex-shrink-0">
                      @{leg.odds_value.toFixed(2).replace('.', ',')}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Navigation */}
      <div className="space-y-2 pt-1">
        <Link
          href={`/tipps?matchday=${match.matchday}`}
          className="block w-full py-3 bg-red-700 hover:bg-red-800 text-white font-bold text-center rounded-xl transition-colors text-sm"
        >
          Zurück zu Spieltag {match.matchday}
        </Link>
        <Link
          href="/profil"
          className="block w-full py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-semibold text-center rounded-xl transition-colors text-sm"
        >
          Mein Profil & Guthaben
        </Link>
      </div>
    </div>
  )
}
