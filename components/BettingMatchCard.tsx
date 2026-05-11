'use client'

import { useState } from 'react'
import type { Match, Odds } from '@/types'
import { useBetSlip } from '@/context/BetSlipContext'

interface BettingMatchCardProps {
  match: Match
  odds: Odds | null
}

export function BettingMatchCard({ match, odds }: BettingMatchCardProps) {
  const { selections, addSelection } = useBetSlip()
  const [exactHome, setExactHome] = useState('')
  const [exactAway, setExactAway] = useState('')

  const homeName = match.home_team?.name ?? 'Heim'
  const awayName = match.away_team?.name ?? 'Gast'
  const homeShort = match.home_team?.short_name ?? 'HEI'
  const awayShort = match.away_team?.short_name ?? 'GAS'

  const matchLabel = `${homeName} – ${awayName}`

  const matchDate = new Date(match.match_date)
  const dateStr = matchDate.toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  })
  const timeStr = matchDate.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  })

  function isSelected(marketType: string, selection: string) {
    return selections.some(
      (s) => s.matchId === match.id && s.marketType === marketType && s.selection === selection
    )
  }

  function select1X2(selection: 'home' | 'draw' | 'away') {
    if (!odds) return
    const oddsValue =
      selection === 'home' ? odds.home_win : selection === 'draw' ? odds.draw : odds.away_win
    const selectionLabel =
      selection === 'home' ? 'Heimsieg' : selection === 'draw' ? 'Unentschieden' : 'Auswärtssieg'
    addSelection({
      matchId: match.id,
      matchLabel,
      marketType: '1x2',
      marketLabel: '1X2',
      selection,
      selectionLabel,
      oddsValue,
    })
  }

  function selectOverUnder(selection: 'over' | 'under') {
    if (!odds) return
    const oddsValue = selection === 'over' ? odds.over_2_5 : odds.under_2_5
    const selectionLabel = selection === 'over' ? 'Über 2,5' : 'Unter 2,5'
    addSelection({
      matchId: match.id,
      matchLabel,
      marketType: 'over_under',
      marketLabel: 'Über/Unter 2,5',
      selection,
      selectionLabel,
      oddsValue,
    })
  }

  function selectBtts(selection: 'yes' | 'no') {
    if (!odds) return
    const oddsValue = selection === 'yes' ? odds.btts_yes : odds.btts_no
    const selectionLabel = selection === 'yes' ? 'Beide treffen' : 'Nicht beide'
    addSelection({
      matchId: match.id,
      matchLabel,
      marketType: 'btts',
      marketLabel: 'Beide treffen',
      selection,
      selectionLabel,
      oddsValue,
    })
  }

  function selectExactScore() {
    const h = parseInt(exactHome)
    const a = parseInt(exactAway)
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) return
    const scoreStr = `${h}:${a}`
    // Use a simple Poisson-based estimation if no specific exact score odds stored
    // Fallback: use 1x2 odds as rough proxy scaled
    const baseOdds = odds ? (odds.home_win + odds.draw + odds.away_win) / 3 : 5
    const approxOdds = Math.min(15, Math.max(1.1, baseOdds * (1 + (h + a) * 0.5)))
    addSelection({
      matchId: match.id,
      matchLabel,
      marketType: 'exact_score',
      marketLabel: 'Genaues Ergebnis',
      selection: scoreStr,
      selectionLabel: scoreStr,
      oddsValue: Math.round(approxOdds * 100) / 100,
    })
  }

  const isDeadlinePassed = match.status !== 'scheduled'

  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden ${isDeadlinePassed ? 'opacity-75' : ''}`}>
      {/* Match Header */}
      <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="text-xs text-gray-500 font-medium">
          Spieltag {match.matchday} · Spiel {match.match_number}
        </div>
        <div className="text-xs text-gray-600 font-semibold">
          {dateStr} · {timeStr} Uhr
        </div>
      </div>

      {/* Teams */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex-1 text-center">
            <div className="font-bold text-gray-900 text-sm leading-tight">{homeName}</div>
            <div className="text-xs text-gray-400 mt-0.5">{homeShort}</div>
          </div>
          <div className="mx-3 text-gray-300 font-light text-xl">vs</div>
          <div className="flex-1 text-center">
            <div className="font-bold text-gray-900 text-sm leading-tight">{awayName}</div>
            <div className="text-xs text-gray-400 mt-0.5">{awayShort}</div>
          </div>
        </div>

        {match.status === 'finished' && match.home_score !== null && (
          <div className="text-center mt-2">
            <span className="inline-block bg-gray-800 text-white text-sm font-bold px-3 py-1 rounded-lg">
              {match.home_score} : {match.away_score}
            </span>
            <span className="ml-2 text-xs text-gray-500">Endstand</span>
          </div>
        )}
      </div>

      {!isDeadlinePassed && odds && (
        <div className="px-4 pb-4 space-y-3">
          {/* 1X2 */}
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              1X2
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <OddsButton
                label="1"
                sublabel="Heimsieg"
                odds={odds.home_win}
                selected={isSelected('1x2', 'home')}
                onClick={() => select1X2('home')}
              />
              <OddsButton
                label="X"
                sublabel="Unentschieden"
                odds={odds.draw}
                selected={isSelected('1x2', 'draw')}
                onClick={() => select1X2('draw')}
              />
              <OddsButton
                label="2"
                sublabel="Auswärtssieg"
                odds={odds.away_win}
                selected={isSelected('1x2', 'away')}
                onClick={() => select1X2('away')}
              />
            </div>
          </div>

          {/* Over/Under */}
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Über/Unter 2,5 Tore
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <OddsButton
                label="Über 2,5"
                odds={odds.over_2_5}
                selected={isSelected('over_under', 'over')}
                onClick={() => selectOverUnder('over')}
              />
              <OddsButton
                label="Unter 2,5"
                odds={odds.under_2_5}
                selected={isSelected('over_under', 'under')}
                onClick={() => selectOverUnder('under')}
              />
            </div>
          </div>

          {/* BTTS */}
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Beide Teams treffen
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <OddsButton
                label="Ja"
                odds={odds.btts_yes}
                selected={isSelected('btts', 'yes')}
                onClick={() => selectBtts('yes')}
              />
              <OddsButton
                label="Nein"
                odds={odds.btts_no}
                selected={isSelected('btts', 'no')}
                onClick={() => selectBtts('no')}
              />
            </div>
          </div>

          {/* Exact Score */}
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Genaues Ergebnis
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="20"
                value={exactHome}
                onChange={(e) => setExactHome(e.target.value)}
                className="w-14 text-center py-2.5 px-1 border border-gray-200 rounded-lg text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="0"
              />
              <span className="text-gray-400 font-bold text-lg">:</span>
              <input
                type="number"
                min="0"
                max="20"
                value={exactAway}
                onChange={(e) => setExactAway(e.target.value)}
                className="w-14 text-center py-2.5 px-1 border border-gray-200 rounded-lg text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="0"
              />
              <button
                onClick={selectExactScore}
                disabled={exactHome === '' || exactAway === ''}
                className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-semibold transition-colors ${
                  isSelected('exact_score', `${exactHome}:${exactAway}`)
                    ? 'bg-red-700 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed'
                }`}
              >
                {isSelected('exact_score', `${exactHome}:${exactAway}`)
                  ? '✓ Getippt'
                  : 'Tippen'}
              </button>
            </div>
            {selections.find(
              (s) => s.matchId === match.id && s.marketType === 'exact_score'
            ) && (
              <div className="mt-1 text-xs text-red-700 font-medium">
                Tipp:{' '}
                {selections.find(
                  (s) => s.matchId === match.id && s.marketType === 'exact_score'
                )?.selectionLabel}{' '}
                @{' '}
                {selections.find(
                  (s) => s.matchId === match.id && s.marketType === 'exact_score'
                )?.oddsValue}
              </div>
            )}
          </div>
        </div>
      )}

      {isDeadlinePassed && (
        <div className="px-4 pb-4">
          <div className="text-center text-sm text-gray-500 py-2 bg-gray-50 rounded-lg">
            {match.status === 'finished' ? 'Spiel beendet' : 'Annahmeschluss erreicht'}
          </div>
        </div>
      )}
    </div>
  )
}

function OddsButton({
  label,
  sublabel,
  odds,
  selected,
  onClick,
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
      className={`relative flex flex-col items-center justify-center py-2 px-1 rounded-lg border transition-all active:scale-95 ${
        selected
          ? 'bg-red-700 border-red-700 text-white shadow-md'
          : 'bg-white border-gray-200 text-gray-800 hover:border-red-300 hover:bg-red-50'
      }`}
    >
      {sublabel && (
        <span className={`text-xs mb-0.5 ${selected ? 'text-red-100' : 'text-gray-400'}`}>
          {sublabel}
        </span>
      )}
      <span className={`text-xs font-semibold ${selected ? 'text-red-100' : 'text-gray-500'}`}>
        {label}
      </span>
      <span className={`text-sm font-bold mt-0.5 ${selected ? 'text-white' : 'text-gray-900'}`}>
        {odds.toFixed(2)}
      </span>
      {selected && (
        <span className="absolute top-1 right-1 w-2 h-2 bg-white rounded-full opacity-80" />
      )}
    </button>
  )
}
