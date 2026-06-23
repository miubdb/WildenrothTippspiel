'use client'

import { useState } from 'react'
import type { Match } from '@/types'
import type { OddsData } from '@/types'
import { useBetSlip } from '@/context/BetSlipContext'
import { getExactScoreOdds, getForm, getTeamRecord } from '@/lib/odds'
import { isAgainstWildenroth as checkAgainstWildenroth } from '@/lib/wildenroth'
import { crestPath } from '@/lib/teams'

type GoalscorerRow = {
  player_id: number
  player_name: string
  position: string | null
  odds_score: number
  odds_score_2plus: number
  is_offered: boolean
  is_offered_2plus: boolean
  status: string
}

interface BettingMatchCardProps {
  match: Match
  odds: OddsData | null
  allMatches: Match[]
  historyMatches?: Match[]
  positions?: Record<number, number>
  isWildenrothPlayer?: boolean
  wildenrothTeamId?: number | null
  goalscorers?: GoalscorerRow[] | null
}

type Tab = '1x2' | 'goals' | 'exact' | 'handicap' | 'goalscorer'

export function BettingMatchCard({ match, odds, allMatches, historyMatches, positions, isWildenrothPlayer, wildenrothTeamId, goalscorers }: BettingMatchCardProps) {
  const { selections, addSelection } = useBetSlip()
  const [activeTab, setActiveTab] = useState<Tab>('1x2')
  const [showDetail, setShowDetail] = useState(false)
  const [wildenrothBlockMsg, setWildenrothBlockMsg] = useState(false)
  const [replacedMsg, setReplacedMsg] = useState(false)

  const homeName = match.home_team?.name ?? 'Heim'
  const awayName = match.away_team?.name ?? 'Gast'
  const matchLabel = `${homeName} – ${awayName}`
  const matchDate = new Date(match.match_date)

  const dateStr = matchDate.toLocaleDateString('de-DE', {
    weekday: 'short', day: '2-digit', month: '2-digit',
  })
  const timeStr = matchDate.toLocaleTimeString('de-DE', {
    hour: '2-digit', minute: '2-digit',
  })

  const now = new Date()
  const kickoffPassed = matchDate <= now
  // Treat as locked if kickoff has passed, regardless of DB status (handles manual-status lag)
  const isScheduled = match.status === 'scheduled' && !kickoffPassed
  const isLive = match.status === 'live' || (match.status === 'scheduled' && kickoffPassed)
  const isFinished = match.status === 'finished'

  const matchInvolvesWildenroth = wildenrothTeamId != null &&
    (match.home_team_id === wildenrothTeamId || match.away_team_id === wildenrothTeamId)
  const wildenrothIsHome = match.home_team_id === wildenrothTeamId

  function isAgainstWildenroth(marketType: string, selection: string): boolean {
    return checkAgainstWildenroth(marketType, selection, {
      isWildenrothPlayer: !!isWildenrothPlayer,
      matchInvolvesWildenroth,
      wildenrothIsHome,
    })
  }

  function isSelected(marketType: string, selection: string) {
    return selections.some(
      (s) => s.matchId === match.id && s.marketType === marketType && s.selection === selection
    )
  }

  function add(marketType: string, marketLabel: string, selection: string, selectionLabel: string, oddsValue: number) {
    if (isAgainstWildenroth(marketType, selection)) {
      setWildenrothBlockMsg(true)
      setTimeout(() => setWildenrothBlockMsg(false), 8000)
      return
    }
    // Detect if any existing selection for this match will be replaced
    const existingForMatch = selections.find(s => s.matchId === match.id)
    const willReplace = existingForMatch != null &&
      !(existingForMatch.marketType === marketType && existingForMatch.selection === selection)
    addSelection({ matchId: match.id, matchLabel, marketType: marketType as never, marketLabel, selection, selectionLabel, oddsValue, homeTeam: homeName, awayTeam: awayName })
    if (willReplace) {
      setReplacedMsg(true)
      setTimeout(() => setReplacedMsg(false), 3000)
    }
  }

  // Exact score grid (calculated client-side)
  const exactScores = isScheduled && odds
    ? getExactScoreOdds(allMatches, match.home_team_id, match.away_team_id)
    : []

  // Detail stats
  const homeForm = getForm(allMatches, match.home_team_id, 5)
  const awayForm = getForm(allMatches, match.away_team_id, 5)
  const homeRecord = getTeamRecord(allMatches, match.home_team_id)
  const awayRecord = getTeamRecord(allMatches, match.away_team_id)

  // H2H: use full history if provided, otherwise fall back to season matches
  const h2hSource = historyMatches ?? allMatches
  const h2h = h2hSource
    .filter(
      (m) =>
        m.status === 'finished' &&
        ((m.home_team_id === match.home_team_id && m.away_team_id === match.away_team_id) ||
          (m.home_team_id === match.away_team_id && m.away_team_id === match.home_team_id))
    )
    .sort((a, b) => new Date(b.match_date).getTime() - new Date(a.match_date).getTime())
    .slice(0, 5)

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-2xl shadow-sm border overflow-hidden transition-opacity ${
      isLive
        ? 'border-orange-200 dark:border-orange-800 opacity-70'
        : isFinished
        ? 'border-gray-100 dark:border-gray-700 opacity-60'
        : 'border-gray-100 dark:border-gray-700'
    }`}>
      {/* Match Header */}
      <button
        className={`w-full px-4 py-2.5 flex items-center justify-between active:opacity-80 ${
          isLive
            ? 'bg-orange-50 dark:bg-orange-900/20'
            : 'bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-700'
        }`}
        onClick={() => setShowDetail((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{dateStr} · {timeStr} Uhr</span>
          {isLive && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/40 px-1.5 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
              Live
            </span>
          )}
          {match.match_category === 'wildenroth_ii' && (
            <span className="text-[10px] font-bold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded px-1.5 py-0.5">WILDENROTH II</span>
          )}
          {match.match_category === 'bklasse_topspiel' && (
            <span className="text-[10px] font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded px-1.5 py-0.5">B-KLASSE</span>
          )}
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-500">{showDetail ? '▲ Details' : '▼ Details'}</span>
      </button>

      {/* Teams Row */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center">
          <div className="flex-1 text-left">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={crestPath(homeName)} alt="" className="w-8 h-8 object-contain flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              <div>
                <div className="font-bold text-gray-900 dark:text-gray-100 text-sm leading-tight">{homeName}</div>
                <FormBadges form={homeForm} />
              </div>
            </div>
          </div>

          {match.status === 'finished' ? (
            <div className="mx-3 bg-gray-800 text-white text-base font-black px-3 py-1 rounded-lg tabular-nums">
              {match.home_score} : {match.away_score}
            </div>
          ) : (
            <div className="mx-3 text-gray-300 dark:text-gray-600 font-light text-lg">vs</div>
          )}

          <div className="flex-1 text-right">
            <div className="flex items-center gap-2 justify-end">
              <div>
                <div className="font-bold text-gray-900 dark:text-gray-100 text-sm leading-tight">{awayName}</div>
                <div className="flex justify-end">
                  <FormBadges form={awayForm} />
                </div>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={crestPath(awayName)} alt="" className="w-8 h-8 object-contain flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            </div>
          </div>
        </div>
        {(match.match_category === 'wildenroth_ii' || match.match_category === 'b_klasse') && (
          <div className="flex gap-1.5 mt-1">
            {match.match_category === 'wildenroth_ii' && (
              <span className="text-[10px] font-bold bg-red-100 text-red-700 rounded px-1.5 py-0.5">WILDENROTH II</span>
            )}
            {match.match_category === 'b_klasse' && (
              <span className="text-[10px] font-bold bg-blue-100 text-blue-700 rounded px-1.5 py-0.5">B-KLASSE</span>
            )}
          </div>
        )}
      </div>

      {/* Detail Panel */}
      {showDetail && (
        <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-700/30 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <TeamStat
              label={homeName}
              record={homeRecord}
              position={positions?.[match.home_team_id]}
            />
            <TeamStat
              label={awayName}
              record={awayRecord}
              position={positions?.[match.away_team_id]}
            />
          </div>
          {h2h.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                Direktvergleich (letzte {h2h.length})
              </div>
              <div className="space-y-1">
                {h2h.map((m) => {
                  const isHome = m.home_team_id === match.home_team_id
                  const hShort = m.home_team?.short_name ?? m.home_team?.name?.split(' ').slice(-1)[0] ?? '?'
                  const aShort = m.away_team?.short_name ?? m.away_team?.name?.split(' ').slice(-1)[0] ?? '?'
                  return (
                    <div key={m.id} className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 rounded-lg px-3 py-1.5">
                      <span className="text-gray-400 dark:text-gray-500">
                        {new Date(m.match_date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                      </span>
                      <span className="font-medium">
                        {isHome
                          ? `${hShort} ${m.home_score}:${m.away_score} ${aShort}`
                          : `${aShort} ${m.away_score}:${m.home_score} ${hShort}`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lock indicator when match has started but isn't finished (no score yet visible) */}
      {isLive && (
        <div className="px-4 pb-2.5 flex items-center gap-1.5 text-xs text-orange-600 dark:text-orange-400 font-medium">
          <span>🔒</span>
          <span>Tippschluss – Spiel läuft</span>
        </div>
      )}

      {/* Wildenroth conflict-of-interest toast */}
      {wildenrothBlockMsg && (
        <div className="border-t border-red-100 bg-red-50 px-4 py-3 flex items-start gap-2">
          <span className="text-lg flex-shrink-0">⚽🚫</span>
          <div className="text-xs text-red-700 leading-snug">
            <span className="font-bold">Befangenheit erkannt!</span> Als Wildenroth-Spieler oder -Trainer darfst du nicht gegen dein eigenes Team wetten – das wäre Wettbewerbsverzerrung! 😄 Nur Wildenroth-Siege tippen erlaubt!
          </div>
        </div>
      )}

      {/* Replacement hint — shown briefly when a prior selection for this match was swapped out */}
      {replacedMsg && (
        <div className="border-t border-blue-100 bg-blue-50 px-4 py-2 flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span className="text-xs text-blue-700">Tipp für dieses Spiel wurde ersetzt.</span>
        </div>
      )}

      {/* Betting Markets */}
      {isScheduled && odds && (
        <div className="border-t border-gray-100 dark:border-gray-700">
          {/* Tab Bar */}
          <div className="flex border-b border-gray-100 dark:border-gray-700 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {(matchInvolvesWildenroth && goalscorers && goalscorers.length > 0
              ? [['1x2', '1X2'], ['goals', 'Tore'], ['exact', 'Ergebnis'], ['handicap', 'Handicap'], ['goalscorer', 'Torschützen']] as [Tab, string][]
              : [['1x2', '1X2'], ['goals', 'Tore'], ['exact', 'Ergebnis'], ['handicap', 'Handicap']] as [Tab, string][]
            ).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                  activeTab === tab
                    ? 'text-red-700 dark:text-red-400 border-b-2 border-red-700 dark:border-red-400 -mb-px'
                    : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="px-4 py-3">
            {/* 1X2 */}
            {activeTab === '1x2' && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <OddsButton
                    label="1" sublabel="Heimsieg" odds={odds.home_win}
                    selected={isSelected('1x2', 'home')}
                    onClick={() => add('1x2', '1X2', 'home', 'Heimsieg', odds.home_win)}
                  />
                  <OddsButton
                    label="X" sublabel="Unentsch." odds={odds.draw}
                    selected={isSelected('1x2', 'draw')}
                    onClick={() => add('1x2', '1X2', 'draw', 'Unentschieden', odds.draw)}
                  />
                  <OddsButton
                    label="2" sublabel="Auswärts" odds={odds.away_win}
                    selected={isSelected('1x2', 'away')}
                    onClick={() => add('1x2', '1X2', 'away', 'Auswärtssieg', odds.away_win)}
                  />
                </div>
                <div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mb-1.5 font-medium">Doppelte Chance</div>
                  <div className="grid grid-cols-3 gap-2">
                    <OddsButton
                      label="1X" sublabel="Heim/Unent." odds={odds.odds_1x}
                      selected={isSelected('double_chance', '1x')}
                      onClick={() => add('double_chance', 'Doppelte Chance', '1x', '1X', odds.odds_1x)}
                    />
                    <OddsButton
                      label="12" sublabel="Kein Unent." odds={odds.odds_12}
                      selected={isSelected('double_chance', '12')}
                      onClick={() => add('double_chance', 'Doppelte Chance', '12', '12', odds.odds_12)}
                    />
                    <OddsButton
                      label="X2" sublabel="Unent./Ausw." odds={odds.odds_x2}
                      selected={isSelected('double_chance', 'x2')}
                      onClick={() => add('double_chance', 'Doppelte Chance', 'x2', 'X2', odds.odds_x2)}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Goals Markets */}
            {activeTab === 'goals' && (
              <div className="space-y-2">
                <div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mb-1.5 font-medium">Über/Unter 3,5 Tore</div>
                  <div className="grid grid-cols-2 gap-2">
                    <OddsButton
                      label="Über 3,5" odds={odds.over_3_5}
                      selected={isSelected('over_under_3_5', 'over_3.5')}
                      onClick={() => add('over_under_3_5', 'Über/Unter 3,5', 'over_3.5', 'Über 3,5', odds.over_3_5)}
                    />
                    <OddsButton
                      label="Unter 3,5" odds={odds.under_3_5}
                      selected={isSelected('over_under_3_5', 'under_3.5')}
                      onClick={() => add('over_under_3_5', 'Über/Unter 3,5', 'under_3.5', 'Unter 3,5', odds.under_3_5)}
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mb-1.5 font-medium">Über/Unter 5,5 Tore</div>
                  <div className="grid grid-cols-2 gap-2">
                    <OddsButton
                      label="Über 5,5" odds={odds.over_5_5}
                      selected={isSelected('over_under_5_5', 'over_5.5')}
                      onClick={() => add('over_under_5_5', 'Über/Unter 5,5', 'over_5.5', 'Über 5,5', odds.over_5_5)}
                    />
                    <OddsButton
                      label="Unter 5,5" odds={odds.under_5_5}
                      selected={isSelected('over_under_5_5', 'under_5.5')}
                      onClick={() => add('over_under_5_5', 'Über/Unter 5,5', 'under_5.5', 'Unter 5,5', odds.under_5_5)}
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mb-1.5 font-medium">Über/Unter 7,5 Tore</div>
                  <div className="grid grid-cols-2 gap-2">
                    <OddsButton
                      label="Über 7,5" odds={odds.over_7_5}
                      selected={isSelected('over_under_7_5', 'over_7.5')}
                      onClick={() => add('over_under_7_5', 'Über/Unter 7,5', 'over_7.5', 'Über 7,5', odds.over_7_5)}
                    />
                    <OddsButton
                      label="Unter 7,5" odds={odds.under_7_5}
                      selected={isSelected('over_under_7_5', 'under_7.5')}
                      onClick={() => add('over_under_7_5', 'Über/Unter 7,5', 'under_7.5', 'Unter 7,5', odds.under_7_5)}
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mb-1.5 font-medium">Beide Teams treffen</div>
                  <div className="grid grid-cols-2 gap-2">
                    <OddsButton
                      label="Ja" odds={odds.btts_yes}
                      selected={isSelected('btts', 'yes')}
                      onClick={() => add('btts', 'Beide treffen', 'yes', 'Beide treffen: Ja', odds.btts_yes)}
                    />
                    <OddsButton
                      label="Nein" odds={odds.btts_no}
                      selected={isSelected('btts', 'no')}
                      onClick={() => add('btts', 'Beide treffen', 'no', 'Beide treffen: Nein', odds.btts_no)}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Exact Score */}
            {activeTab === 'exact' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-gray-400 dark:text-gray-500 font-medium">Genaues Ergebnis</div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">
                    <span className="text-red-700 dark:text-red-400">{match.home_team?.short_name ?? homeName.split(' ').slice(-1)[0]}</span>
                    {' : '}
                    <span className="text-gray-500 dark:text-gray-400">{match.away_team?.short_name ?? awayName.split(' ').slice(-1)[0]}</span>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {exactScores.map(({ score, odds: o }) => (
                    <button
                      key={score}
                      onClick={() => add('exact_score', 'Genaues Ergebnis', score, score, o)}
                      className={`flex flex-col items-center py-2 px-1 rounded-lg border text-xs transition-all active:scale-95 ${
                        isSelected('exact_score', score)
                          ? 'bg-red-700 border-red-700 text-white'
                          : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-800 dark:text-gray-200 hover:border-red-300'
                      }`}
                    >
                      <span className="font-bold">{score}</span>
                      <span className={`text-xs mt-0.5 font-semibold ${isSelected('exact_score', score) ? 'text-red-100' : 'text-red-600'}`}>
                        {o.toFixed(1).replace('.', ',')}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 text-[10px] text-gray-400 dark:text-gray-500 text-center">
                  Nur Ergebnisse mit Quote ≤ 60 werden angezeigt
                </div>
              </div>
            )}

            {/* Handicap */}
            {activeTab === 'handicap' && (
              <div className="space-y-2">
                <div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mb-1.5 font-medium">Handicap –1,5 / +1,5</div>
                  <div className="grid grid-cols-2 gap-2">
                    <OddsButton
                      label="Heim –1,5"
                      sublabel="Sieg mit 2+ Toren"
                      odds={odds.hdp_home_minus_1_5}
                      selected={isSelected('handicap', 'home_minus_1_5')}
                      onClick={() => add('handicap', 'Handicap', 'home_minus_1_5', `${homeName} –1,5`, odds.hdp_home_minus_1_5)}
                    />
                    <OddsButton
                      label="Gast +1,5"
                      sublabel="Verliert nicht mit 2+"
                      odds={odds.hdp_away_plus_1_5}
                      selected={isSelected('handicap', 'away_plus_1_5')}
                      onClick={() => add('handicap', 'Handicap', 'away_plus_1_5', `${awayName} +1,5`, odds.hdp_away_plus_1_5)}
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mb-1.5 font-medium">Handicap –2,5 / +2,5</div>
                  <div className="grid grid-cols-2 gap-2">
                    <OddsButton
                      label="Heim –2,5"
                      sublabel="Sieg mit 3+ Toren"
                      odds={odds.hdp_home_minus_2_5}
                      selected={isSelected('handicap', 'home_minus_2_5')}
                      onClick={() => add('handicap', 'Handicap', 'home_minus_2_5', `${homeName} –2,5`, odds.hdp_home_minus_2_5)}
                    />
                    <OddsButton
                      label="Gast +2,5"
                      sublabel="Verliert nicht mit 3+"
                      odds={odds.hdp_away_plus_2_5}
                      selected={isSelected('handicap', 'away_plus_2_5')}
                      onClick={() => add('handicap', 'Handicap', 'away_plus_2_5', `${awayName} +2,5`, odds.hdp_away_plus_2_5)}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Goalscorer (Wildenroth only) */}
            {activeTab === 'goalscorer' && goalscorers && (
              <div className="space-y-2">
                <div className="text-xs text-gray-400 dark:text-gray-500 font-medium">
                  Torschützen – nur Wildenroth-Spieler
                </div>
                {goalscorers.filter(g => g.is_offered).length === 0 && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 italic py-2">
                    Keine Torschützen verfügbar.
                  </div>
                )}
                {goalscorers
                  .filter(g => g.is_offered)
                  .sort((a, b) => a.odds_score - b.odds_score)
                  .map(g => (
                    <div key={g.player_id} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{g.player_name}</div>
                        {g.position && (
                          <div className="text-[10px] text-gray-400 dark:text-gray-500">{g.position}</div>
                        )}
                      </div>
                      <button
                        onClick={() =>
                          add('goalscorer', 'Torschütze', String(g.player_id), `${g.player_name} trifft`, g.odds_score)
                        }
                        className={`flex flex-col items-center justify-center w-20 py-2 px-1 rounded-xl border transition-all active:scale-95 ${
                          isSelected('goalscorer', String(g.player_id))
                            ? 'bg-red-700 border-red-700 text-white shadow-md'
                            : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-800 dark:text-gray-200 hover:border-red-300'
                        }`}
                      >
                        <span className={`text-[10px] ${isSelected('goalscorer', String(g.player_id)) ? 'text-red-100' : 'text-gray-500 dark:text-gray-400'}`}>Trifft</span>
                        <span className={`text-sm font-black ${isSelected('goalscorer', String(g.player_id)) ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>
                          {g.odds_score.toFixed(2).replace('.', ',')}
                        </span>
                      </button>
                      {g.is_offered_2plus ? (
                        <button
                          onClick={() =>
                            add('goalscorer_2plus', 'Mindestens 2 Tore', String(g.player_id), `${g.player_name} (mind. 2 Tore)`, g.odds_score_2plus)
                          }
                          className={`flex flex-col items-center justify-center w-20 py-2 px-1 rounded-xl border transition-all active:scale-95 ${
                            isSelected('goalscorer_2plus', String(g.player_id))
                              ? 'bg-red-700 border-red-700 text-white shadow-md'
                              : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-800 dark:text-gray-200 hover:border-red-300'
                          }`}
                        >
                          <span className={`text-[10px] ${isSelected('goalscorer_2plus', String(g.player_id)) ? 'text-red-100' : 'text-gray-500 dark:text-gray-400'}`}>Mind. 2 Tore</span>
                          <span className={`text-sm font-black ${isSelected('goalscorer_2plus', String(g.player_id)) ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>
                            {g.odds_score_2plus.toFixed(2).replace('.', ',')}
                          </span>
                        </button>
                      ) : (
                        <div className="w-20 text-center text-[10px] text-gray-300 dark:text-gray-600">—</div>
                      )}
                    </div>
                  ))}
                <div className="text-[10px] text-gray-400 dark:text-gray-500 pt-1">
                  Eigentore zählen nicht.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!isScheduled && (
        <div className={`border-t px-4 py-2.5 flex items-center justify-center gap-1.5 ${
          isLive
            ? 'border-orange-100 dark:border-orange-900 bg-orange-50/60 dark:bg-orange-900/10'
            : 'border-gray-100 dark:border-gray-700'
        }`}>
          {isLive && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse flex-shrink-0" />}
          <span className={`text-xs font-medium ${isLive ? 'text-orange-600 dark:text-orange-400' : 'text-gray-400 dark:text-gray-500'}`}>
            {isLive ? 'Spiel läuft – keine Tipps mehr möglich' : 'Spiel beendet – Tippschluss abgelaufen'}
          </span>
        </div>
      )}
    </div>
  )
}

function FormBadges({ form }: { form: ('W' | 'D' | 'L')[] }) {
  if (form.length === 0) return null
  return (
    <div className="flex gap-0.5 mt-1">
      {form.map((r, i) => (
        <span
          key={i}
          className={`w-4 h-4 rounded-sm text-white text-[9px] font-bold flex items-center justify-center ${
            r === 'W' ? 'bg-green-500' : r === 'D' ? 'bg-yellow-400' : 'bg-red-500'
          }`}
        >
          {r}
        </span>
      ))}
    </div>
  )
}

function TeamStat({
  label,
  record,
  position,
}: {
  label: string
  record: ReturnType<typeof getTeamRecord>
  position?: number
}) {
  return (
    <div className="bg-white dark:bg-gray-700 rounded-xl p-2.5 text-xs">
      <div className="flex items-center gap-1 mb-1.5">
        {position && (
          <span className="w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-600 text-gray-500 dark:text-gray-300 font-bold text-[10px] flex items-center justify-center flex-shrink-0">
            {position}
          </span>
        )}
        <div className="font-semibold text-gray-700 dark:text-gray-200 truncate">{label}</div>
      </div>
      <div className="grid grid-cols-3 gap-1 text-center">
        <div>
          <div className="text-green-600 font-bold text-sm">{record.w}</div>
          <div className="text-gray-400 dark:text-gray-500">S</div>
        </div>
        <div>
          <div className="text-yellow-500 font-bold text-sm">{record.d}</div>
          <div className="text-gray-400 dark:text-gray-500">U</div>
        </div>
        <div>
          <div className="text-red-500 font-bold text-sm">{record.l}</div>
          <div className="text-gray-400 dark:text-gray-500">N</div>
        </div>
      </div>
      <div className="mt-1.5 text-center text-gray-500 dark:text-gray-400">
        {record.gf}:{record.ga} · <span className="font-semibold text-gray-800 dark:text-gray-200">{record.pts} Pkt</span>
      </div>
    </div>
  )
}

function OddsButton({
  label, sublabel, odds, selected, onClick,
}: {
  label: string
  sublabel?: string
  odds: number
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center py-2.5 px-1 rounded-xl border transition-all active:scale-95 ${
        selected
          ? 'bg-red-700 border-red-700 text-white shadow-md'
          : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-800 dark:text-gray-200 hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-900/20'
      }`}
    >
      {sublabel && (
        <span className={`text-[10px] mb-0.5 ${selected ? 'text-red-200' : 'text-gray-400 dark:text-gray-500'}`}>
          {sublabel}
        </span>
      )}
      <span className={`text-xs font-semibold ${selected ? 'text-red-100' : 'text-gray-500 dark:text-gray-400'}`}>
        {label}
      </span>
      <span className={`text-sm font-black mt-0.5 ${selected ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>
        {odds.toFixed(2).replace('.', ',')}
      </span>
    </button>
  )
}
