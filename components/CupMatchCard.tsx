'use client'

import { useState } from 'react'
import type { Match, OddsData } from '@/types'
import { useBetSlip } from '@/context/BetSlipContext'
import { isAgainstWildenroth as checkAgainstWildenroth } from '@/lib/wildenroth'
import { TeamLogo } from '@/components/TeamLogo'

type GoalscorerRow = {
  player_id: number
  player_name: string
  position: string | null
  odds_score: number
  is_offered: boolean
  status: string
}

/**
 * Pinned card for a one-off cup fixture ("Pokal-Spezial") — deliberately a
 * separate, simpler component from BettingMatchCard rather than teaching that
 * 782-line component a whole new tab: only 4 markets exist here (no
 * Doppelte Chance / Über-Unter / Handicap / Genaues Ergebnis), and none of
 * the correlated specials from a possible future pass. Reuses the same
 * BetSlipContext / normal Wettschein / normal Einsatzlimits as every other
 * match — no separate cup betting slip.
 */
export function CupMatchCard({
  match,
  odds,
  goalscorers,
  isWildenrothPlayer,
  wildenrothTeamId,
}: {
  match: Match
  odds: OddsData | null
  goalscorers: GoalscorerRow[] | null
  isWildenrothPlayer?: boolean
  wildenrothTeamId?: number | null
}) {
  const { selections, addSelection } = useBetSlip()
  const [blockMsg, setBlockMsg] = useState(false)

  const homeName = match.home_team?.name ?? 'Heim'
  const awayName = match.away_team?.name ?? 'Gast'
  const matchLabel = `${homeName} – ${awayName}`
  const matchDate = new Date(match.match_date)
  const dateStr = matchDate.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
  const timeStr = matchDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

  const now = new Date()
  const kickoffPassed = matchDate <= now
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
    return selections.some((s) => s.matchId === match.id && s.marketType === marketType && s.selection === selection)
  }

  function add(marketType: string, marketLabel: string, selection: string, selectionLabel: string, oddsValue: number) {
    if (isAgainstWildenroth(marketType, selection)) {
      setBlockMsg(true)
      setTimeout(() => setBlockMsg(false), 8000)
      return
    }
    addSelection({
      matchId: match.id, matchLabel, marketType: marketType as never, marketLabel,
      selection, selectionLabel, oddsValue, homeTeam: homeName, awayTeam: awayName,
    })
  }

  function renderOddsButton(marketType: string, marketLabel: string, selection: string, selectionLabel: string, oddsValue: number | undefined) {
    if (oddsValue == null) return null
    return (
      <OddsButton
        key={selection}
        selected={isSelected(marketType, selection)}
        disabled={!isScheduled}
        selectionLabel={selectionLabel}
        oddsValue={oddsValue}
        onClick={() => add(marketType, marketLabel, selection, selectionLabel, oddsValue)}
      />
    )
  }

  return (
    <div className="bg-gradient-to-br from-amber-50 to-white dark:from-amber-900/10 dark:to-gray-800 rounded-2xl shadow-md border-2 border-amber-300 dark:border-amber-700 overflow-hidden">
      <div className="px-4 py-2 bg-amber-500 dark:bg-amber-700 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-white font-bold text-xs">
          <span>🏆</span>
          <span>{match.competition_name ?? 'Pokal-Spezial'}{match.competition_round ? ` · ${match.competition_round}` : ''}</span>
        </div>
        <span className="text-amber-100 text-[11px]">{dateStr} · {timeStr} Uhr</span>
      </div>

      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <TeamLogo name={homeName} size="md" />
            <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate">{homeName}</span>
          </div>
          {isFinished ? (
            <span className="font-black text-gray-900 dark:text-gray-100 text-lg flex-shrink-0">{match.home_score}:{match.away_score}</span>
          ) : (
            <span className="text-gray-400 text-xs flex-shrink-0">vs</span>
          )}
          <div className="flex items-center gap-2 min-w-0 justify-end">
            <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate">{awayName}</span>
            <TeamLogo name={awayName} size="md" />
          </div>
        </div>
        {isLive && (
          <div className="mt-1.5 flex items-center justify-center gap-1 text-[10px] font-bold text-orange-600 dark:text-orange-400">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" /> Live
          </div>
        )}
      </div>

      {blockMsg && (
        <div className="mx-4 mb-2 text-[11px] bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg px-2 py-1.5">
          Als Wildenroth-Spieler oder -Trainer darfst du nicht gegen dein eigenes Team wetten.
        </div>
      )}

      {odds ? (
        <div className="px-4 pb-4 space-y-3">
          <div>
            <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">🏆 Wer kommt weiter?</div>
            <div className="flex gap-1.5">
              {renderOddsButton('cup_advance', 'Wer kommt weiter?', 'home', homeName, odds.cup_advance_home)}
              {renderOddsButton('cup_advance', 'Wer kommt weiter?', 'away', awayName, odds.cup_advance_away)}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">⚽ Wer erzielt das erste Tor?</div>
            <div className="flex gap-1.5">
              {renderOddsButton('cup_first_goal', 'Wer erzielt das erste Tor?', 'home', homeName, odds.cup_first_goal_home)}
              {renderOddsButton('cup_first_goal', 'Wer erzielt das erste Tor?', 'away', awayName, odds.cup_first_goal_away)}
              {renderOddsButton('cup_first_goal', 'Wer erzielt das erste Tor?', 'none', 'Kein Tor', odds.cup_first_goal_none)}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">🤝 Beide Teams treffen</div>
            <div className="flex gap-1.5">
              {renderOddsButton('btts', 'Beide Teams treffen', 'yes', 'Ja', odds.btts_yes)}
              {renderOddsButton('btts', 'Beide Teams treffen', 'no', 'Nein', odds.btts_no)}
            </div>
          </div>

          {goalscorers && goalscorers.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">🎯 Wildenroth-Torschütze</div>
              <div className="flex flex-wrap gap-1.5">
                {goalscorers.filter(g => g.is_offered && g.status === 'available').map((g) =>
                  renderOddsButton('goalscorer', 'Torschütze', String(g.player_id), g.player_name, g.odds_score)
                )}
              </div>
            </div>
          )}

          <div className="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed border-t border-amber-200 dark:border-amber-800 pt-2">
            Normale Märkte gelten für 90 Minuten inkl. Nachspielzeit. Bei Remis folgt direkt Elfmeterschießen.
            Der Markt &bdquo;Wer kommt weiter?&ldquo; berücksichtigt das Elfmeterschießen.
          </div>
        </div>
      ) : (
        <div className="px-4 pb-4 text-xs text-gray-400 dark:text-gray-500">Quoten noch nicht verfügbar.</div>
      )}
    </div>
  )
}

/** Declared at module scope (not inline in CupMatchCard) — a component
 *  defined during render is recreated every render, resetting its state. */
function OddsButton({ selected, disabled, selectionLabel, oddsValue, onClick }: {
  selected: boolean
  disabled: boolean
  selectionLabel: string
  oddsValue: number
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 min-w-0 rounded-lg border px-2 py-2 text-center transition-colors disabled:opacity-50 ${
        selected
          ? 'bg-red-700 border-red-700 text-white'
          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 hover:border-red-300'
      }`}
    >
      <div className={`text-[11px] truncate ${selected ? 'text-red-100' : 'text-gray-500 dark:text-gray-400'}`}>{selectionLabel}</div>
      <div className={`font-bold text-sm ${selected ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>{oddsValue.toFixed(2)}</div>
    </button>
  )
}
