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
 * 782-line component a whole new tab. 8 markets total, grouped into 3
 * visually distinct sections (see round-2 spec): 🏆 Pokal (5 markets, most
 * visual weight — the whole point of this fixture), ⚽ Spiel (2 markets,
 * normal-feeling), 🎯 Spieler (1 market). Reuses the same BetSlipContext /
 * normal Wettschein / normal Einsatzlimits as every other match — no
 * separate cup betting slip.
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
  const isToday = matchDate.toDateString() === now.toDateString()

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
    <div className="bg-gradient-to-br from-amber-100 via-amber-50 to-white dark:from-amber-900/30 dark:via-amber-900/10 dark:to-gray-800 rounded-2xl shadow-lg border-2 border-amber-400 dark:border-amber-600 overflow-hidden">
      {/* Header: explicit "POKAL-SPEZIAL" identity + competition context, per
          the round-2 example layout — makes this fixture read as clearly
          different from a normal league match before any odds are seen. */}
      <div className="px-4 py-3 bg-gradient-to-r from-amber-500 to-amber-600 dark:from-amber-700 dark:to-amber-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-white font-black text-sm tracking-wide">
            <span>🏆</span>
            <span>POKAL-SPEZIAL</span>
          </div>
          {isLive && (
            <div className="flex items-center gap-1 text-[10px] font-bold text-white bg-orange-600 rounded-full px-2 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> Live
            </div>
          )}
        </div>
        <div className="text-amber-50 text-[11px] mt-0.5">
          {match.competition_name ?? 'Sparkassen Fußball-Cup'}{match.competition_round ? ` · ${match.competition_round}` : ''}
        </div>
      </div>

      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col items-center gap-1 min-w-0 flex-1">
            <TeamLogo name={homeName} size="md" />
            <span className="font-bold text-gray-900 dark:text-gray-100 text-xs text-center truncate w-full">{homeName}</span>
          </div>
          {isFinished ? (
            <span className="font-black text-gray-900 dark:text-gray-100 text-xl flex-shrink-0 px-1">{match.home_score}:{match.away_score}</span>
          ) : (
            <span className="text-gray-400 text-[11px] flex-shrink-0 px-1">vs.</span>
          )}
          <div className="flex flex-col items-center gap-1 min-w-0 flex-1">
            <TeamLogo name={awayName} size="md" />
            <span className="font-bold text-gray-900 dark:text-gray-100 text-xs text-center truncate w-full">{awayName}</span>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
          <span>{isToday ? 'Heute' : dateStr} · {timeStr} Uhr</span>
        </div>
        <div className="mt-1 text-center text-[11px] font-semibold text-amber-700 dark:text-amber-400">
          Verlierer scheidet aus
        </div>
      </div>

      {blockMsg && (
        <div className="mx-4 mb-2 text-[11px] bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg px-2 py-1.5">
          Als Wildenroth-Spieler oder -Trainer darfst du nicht gegen dein eigenes Team wetten.
        </div>
      )}

      {odds ? (
        <div className="px-4 pb-4 space-y-4">
          {/* ---------- 🏆 POKAL: the 5 cup-only specials, given the most
              visual weight (amber panel) — the whole reason this fixture
              exists as its own card. ---------- */}
          <div className="bg-amber-50/80 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800 rounded-xl p-2.5 space-y-3">
            <div className="text-[11px] font-black text-amber-700 dark:text-amber-400 uppercase tracking-wide">🏆 Pokal</div>

            <div>
              <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">Wer kommt weiter?</div>
              <div className="flex gap-1.5">
                {renderOddsButton('cup_advance', 'Wer kommt weiter?', 'home', homeName, odds.cup_advance_home)}
                {renderOddsButton('cup_advance', 'Wer kommt weiter?', 'away', awayName, odds.cup_advance_away)}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">🧤 Wie fällt die Entscheidung?</div>
              <div className="flex gap-1.5">
                {renderOddsButton('cup_decision', 'Wie fällt die Entscheidung?', 'regulation', 'Nach 90 Minuten', odds.cup_decision_regulation)}
                {renderOddsButton('cup_decision', 'Wie fällt die Entscheidung?', 'shootout', 'Elfmeterschießen', odds.cup_decision_shootout)}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">
                🔥 {homeName} führt zur Halbzeit &amp; kommt weiter
              </div>
              <div className="flex gap-1.5">
                {renderOddsButton('cup_halftime_lead_advance', 'Wildenroth führt zur Halbzeit & kommt weiter', 'yes', 'Ja', odds.cup_halftime_lead_advance_yes)}
                {renderOddsButton('cup_halftime_lead_advance', 'Wildenroth führt zur Halbzeit & kommt weiter', 'no', 'Nein', odds.cup_halftime_lead_advance_no)}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">
                🔄 {awayName} führt – {homeName} kommt trotzdem weiter
              </div>
              <div className="flex gap-1.5">
                {renderOddsButton('cup_comeback_advance', 'Geiselbullach führt – Wildenroth kommt trotzdem weiter', 'yes', 'Ja', odds.cup_comeback_advance_yes)}
                {renderOddsButton('cup_comeback_advance', 'Geiselbullach führt – Wildenroth kommt trotzdem weiter', 'no', 'Nein', odds.cup_comeback_advance_no)}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">
                🎯 Elfmeterschießen – {homeName} kommt weiter
              </div>
              <div className="flex gap-1.5">
                {renderOddsButton('cup_shootout_advance', 'Elfmeterschießen – Wildenroth kommt weiter', 'yes', 'Ja', odds.cup_shootout_advance_yes)}
                {renderOddsButton('cup_shootout_advance', 'Elfmeterschießen – Wildenroth kommt weiter', 'no', 'Nein', odds.cup_shootout_advance_no)}
              </div>
            </div>
          </div>

          {/* ---------- ⚽ SPIEL: the 2 "normal-feeling" markets. ---------- */}
          <div className="space-y-2.5">
            <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">⚽ Spiel</div>
            <div>
              <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">Wer erzielt das erste Tor?</div>
              <div className="flex gap-1.5">
                {renderOddsButton('cup_first_goal', 'Wer erzielt das erste Tor?', 'home', homeName, odds.cup_first_goal_home)}
                {renderOddsButton('cup_first_goal', 'Wer erzielt das erste Tor?', 'away', awayName, odds.cup_first_goal_away)}
                {renderOddsButton('cup_first_goal', 'Wer erzielt das erste Tor?', 'none', 'Kein Tor', odds.cup_first_goal_none)}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">Beide Teams treffen</div>
              <div className="flex gap-1.5">
                {renderOddsButton('btts', 'Beide Teams treffen', 'yes', 'Ja', odds.btts_yes)}
                {renderOddsButton('btts', 'Beide Teams treffen', 'no', 'Nein', odds.btts_no)}
              </div>
            </div>
          </div>

          {/* ---------- 🎯 SPIELER: Wildenroth-Torschütze. ---------- */}
          {goalscorers && goalscorers.length > 0 && (
            <div className="space-y-2.5">
              <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">🎯 Spieler</div>
              <div>
                <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">Wildenroth-Torschütze</div>
                <div className="flex flex-wrap gap-1.5">
                  {goalscorers.filter(g => g.is_offered && g.status === 'available').map((g) =>
                    renderOddsButton('goalscorer', 'Torschütze', String(g.player_id), g.player_name, g.odds_score)
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed border-t border-amber-200 dark:border-amber-800 pt-2">
            Bei Remis nach 90 Minuten geht es direkt ins Elfmeterschießen (keine Verlängerung).
            &bdquo;Erstes Tor&ldquo;, &bdquo;Beide Teams treffen&ldquo; und &bdquo;Torschütze&ldquo; gelten nur für 90 Minuten
            inkl. Nachspielzeit — das Elfmeterschießen zählt dafür nicht.
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
