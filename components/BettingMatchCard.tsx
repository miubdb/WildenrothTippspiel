'use client'

import { useState } from 'react'
import type { Match } from '@/types'
import type { OddsData } from '@/types'
import { useBetSlip } from '@/context/BetSlipContext'
import { getExactScoreOdds, getForm, getTeamRecord } from '@/lib/odds'

interface BettingMatchCardProps {
  match: Match
  odds: OddsData | null
  allMatches: Match[]
  historyMatches?: Match[]
  positions?: Record<number, number>
  isWildenrothPlayer?: boolean
  wildenrothTeamId?: number | null
}

type Tab = '1x2' | 'goals' | 'exact' | 'detail'

export function BettingMatchCard({ match, odds, allMatches, historyMatches, positions, isWildenrothPlayer, wildenrothTeamId }: BettingMatchCardProps) {
  const { selections, addSelection } = useBetSlip()
  const [activeTab, setActiveTab] = useState<Tab>('1x2')
  const [showDetail, setShowDetail] = useState(false)
  const [wildenrothBlockMsg, setWildenrothBlockMsg] = useState(false)

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

  const isScheduled = match.status === 'scheduled'

  const matchInvolvesWildenroth = wildenrothTeamId != null &&
    (match.home_team_id === wildenrothTeamId || match.away_team_id === wildenrothTeamId)
  const wildenrothIsHome = match.home_team_id === wildenrothTeamId

  /** Returns true when this selection would bet against Wildenroth winning */
  function isAgainstWildenroth(marketType: string, selection: string): boolean {
    if (!isWildenrothPlayer || !matchInvolvesWildenroth) return false
    if (marketType === '1x2') {
      // Block only the opponent's direct win; draws are allowed
      return wildenrothIsHome ? selection === 'away' : selection === 'home'
    }
    if (marketType === 'double_chance') {
      // Block DC options that exclude a Wildenroth win entirely:
      // - x2 (draw or away win) when Wildenroth is home → Wildenroth can't win
      // - 1x (home or draw) when Wildenroth is away → Wildenroth can't win
      // - 12 covers both wins → Wildenroth win IS possible → allowed
      return wildenrothIsHome ? selection === 'x2' : selection === '1x'
    }
    if (marketType === 'exact_score') {
      const [h, a] = selection.split(':').map(Number)
      // Block exact scores where opponent wins
      return wildenrothIsHome ? a > h : h > a
    }
    return false
  }

  function isSelected(marketType: string, selection: string) {
    return selections.some(
      (s) => s.matchId === match.id && s.marketType === marketType && s.selection === selection
    )
  }

  function add(marketType: string, marketLabel: string, selection: string, selectionLabel: string, oddsValue: number) {
    if (isAgainstWildenroth(marketType, selection)) {
      setWildenrothBlockMsg(true)
      setTimeout(() => setWildenrothBlockMsg(false), 3500)
      return
    }
    addSelection({ matchId: match.id, matchLabel, marketType: marketType as never, marketLabel, selection, selectionLabel, oddsValue })
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
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Match Header */}
      <button
        className="w-full bg-gradient-to-r from-gray-50 to-gray-100 px-4 py-2.5 flex items-center justify-between active:bg-gray-200"
        onClick={() => setShowDetail((v) => !v)}
      >
        <span className="text-xs text-gray-500 font-medium">{dateStr} · {timeStr} Uhr</span>
        <span className="text-xs text-gray-400">{showDetail ? '▲ Details' : '▼ Details'}</span>
      </button>

      {/* Teams Row */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center">
          <div className="flex-1 text-left">
            <div className="font-bold text-gray-900 text-sm leading-tight">{homeName}</div>
            <FormBadges form={homeForm} />
          </div>

          {match.status === 'finished' ? (
            <div className="mx-3 bg-gray-800 text-white text-base font-black px-3 py-1 rounded-lg tabular-nums">
              {match.home_score} : {match.away_score}
            </div>
          ) : (
            <div className="mx-3 text-gray-300 font-light text-lg">vs</div>
          )}

          <div className="flex-1 text-right">
            <div className="font-bold text-gray-900 text-sm leading-tight">{awayName}</div>
            <div className="flex justify-end">
              <FormBadges form={awayForm} />
            </div>
          </div>
        </div>
      </div>

      {/* Detail Panel */}
      {showDetail && (
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-3">
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
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Direktvergleich (letzte {h2h.length})
              </div>
              <div className="space-y-1">
                {h2h.map((m) => {
                  const isHome = m.home_team_id === match.home_team_id
                  const hShort = m.home_team?.short_name ?? m.home_team?.name?.split(' ').slice(-1)[0] ?? '?'
                  const aShort = m.away_team?.short_name ?? m.away_team?.name?.split(' ').slice(-1)[0] ?? '?'
                  return (
                    <div key={m.id} className="flex items-center justify-between text-xs text-gray-600 bg-white rounded-lg px-3 py-1.5">
                      <span className="text-gray-400">
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

      {/* Wildenroth conflict-of-interest toast (shown when a blocked selection is tapped) */}
      {wildenrothBlockMsg && (
        <div className="border-t border-red-100 bg-red-50 px-4 py-3 flex items-start gap-2">
          <span className="text-lg flex-shrink-0">⚽🚫</span>
          <div className="text-xs text-red-700 leading-snug">
            <span className="font-bold">Befangenheit erkannt!</span> Als Wildenroth-Spieler darfst du nicht gegen dein eigenes Team wetten – das wäre Wettbewerbsverzerrung! 😄 Nur Wildenroth-Siege tippen erlaubt!
          </div>
        </div>
      )}

      {/* Betting Markets */}
      {isScheduled && odds && (
        <div className="border-t border-gray-100">
          {/* Tab Bar */}
          <div className="flex border-b border-gray-100">
            {([['1x2', '1X2'], ['goals', 'Tore'], ['exact', 'Ergebnis']] as [Tab, string][]).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                  activeTab === tab
                    ? 'text-red-700 border-b-2 border-red-700 -mb-px'
                    : 'text-gray-400 hover:text-gray-600'
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
                  <div className="text-xs text-gray-400 mb-1.5 font-medium">Doppelte Chance</div>
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
                  <div className="text-xs text-gray-400 mb-1.5 font-medium">Über/Unter 3,5 Tore</div>
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
                  <div className="text-xs text-gray-400 mb-1.5 font-medium">Beide Teams treffen</div>
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
                  <div className="text-xs text-gray-400 font-medium">Genaues Ergebnis</div>
                  <div className="text-[10px] text-gray-400 font-medium">
                    <span className="text-red-700">{match.home_team?.short_name ?? homeName.split(' ').slice(-1)[0]}</span>
                    {' : '}
                    <span className="text-gray-500">{match.away_team?.short_name ?? awayName.split(' ').slice(-1)[0]}</span>
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
                          : 'bg-white border-gray-200 text-gray-800 hover:border-red-300'
                      }`}
                    >
                      <span className="font-bold">{score}</span>
                      <span className={`text-xs mt-0.5 font-semibold ${isSelected('exact_score', score) ? 'text-red-100' : 'text-red-600'}`}>
                        {o.toFixed(1)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!isScheduled && (
        <div className="border-t border-gray-100 px-4 py-2">
          <div className="text-center text-xs text-gray-400">
            {match.status === 'finished' ? 'Spiel beendet' : 'Annahmeschluss überschritten'}
          </div>
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
    <div className="bg-white rounded-xl p-2.5 text-xs">
      <div className="flex items-center gap-1 mb-1.5">
        {position && (
          <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 font-bold text-[10px] flex items-center justify-center flex-shrink-0">
            {position}
          </span>
        )}
        <div className="font-semibold text-gray-700 truncate">{label}</div>
      </div>
      <div className="grid grid-cols-3 gap-1 text-center">
        <div>
          <div className="text-green-600 font-bold text-sm">{record.w}</div>
          <div className="text-gray-400">S</div>
        </div>
        <div>
          <div className="text-yellow-500 font-bold text-sm">{record.d}</div>
          <div className="text-gray-400">U</div>
        </div>
        <div>
          <div className="text-red-500 font-bold text-sm">{record.l}</div>
          <div className="text-gray-400">N</div>
        </div>
      </div>
      <div className="mt-1.5 text-center text-gray-500">
        {record.gf}:{record.ga} · <span className="font-semibold text-gray-800">{record.pts} Pkt</span>
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
          : 'bg-white border-gray-200 text-gray-800 hover:border-red-300 hover:bg-red-50'
      }`}
    >
      {sublabel && (
        <span className={`text-[10px] mb-0.5 ${selected ? 'text-red-200' : 'text-gray-400'}`}>
          {sublabel}
        </span>
      )}
      <span className={`text-xs font-semibold ${selected ? 'text-red-100' : 'text-gray-500'}`}>
        {label}
      </span>
      <span className={`text-sm font-black mt-0.5 ${selected ? 'text-white' : 'text-gray-900'}`}>
        {odds.toFixed(2)}
      </span>
    </button>
  )
}
