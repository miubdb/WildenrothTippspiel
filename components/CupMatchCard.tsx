'use client'

import { useState } from 'react'
import type { Match, OddsData } from '@/types'
import { useBetSlip } from '@/context/BetSlipContext'
import { isAgainstWildenroth as checkAgainstWildenroth } from '@/lib/wildenroth'
import { TeamLogo } from '@/components/TeamLogo'
import { CUP_MARKET_LABEL, cupSelectionLabel } from '@/lib/betDisplay'

type GoalscorerRow = {
  player_id: number
  player_name: string
  position: string | null
  odds_score: number
  is_offered: boolean
  status: string
}

type CupTab = 'specials' | 'spiel'

/**
 * Pinned card for a one-off cup fixture ("Pokal-Spezial") — deliberately a
 * separate, simpler component from BettingMatchCard rather than teaching that
 * 782-line component a whole new tab. 8 markets total, split into 2 tabs:
 * 🏆 POKAL-SPECIALS (markets 1-5, cup-only) and ⚽ SPIEL & TORSCHÜTZEN
 * (markets 6-8: Erstes Tor, Beide Teams treffen, Wildenroth-Torschütze).
 * Reuses the same BetSlipContext / normal Wettschein / normal Einsatzlimits
 * as every other match — no separate cup betting slip, and the tab toggle is
 * purely local UI state, so switching tabs never touches (or resets)
 * BetSlipContext selections.
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
  const [tab, setTab] = useState<CupTab>('specials')

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

  // Shared display labels (lib/betDisplay.ts) — keeps the BetSlip pill text
  // identical to offene Wetten / Wetthistorie / Admin for the same market.
  const ml = (marketType: string) => CUP_MARKET_LABEL[marketType] ?? marketType
  const sl = (marketType: string, selection: string) => cupSelectionLabel(marketType, selection) ?? selection

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

  /** Single-outcome "Ja"-only prop button for the 3 cup specials — always
   *  submits selection='yes'. The 'no' side is still fully settleable (see
   *  app/api/admin/settle/route.ts) for any bet already placed before this
   *  became a single-outcome market; it's just not offered here anymore. */
  function renderCupPropButton(marketType: string, marketLabel: string, title: string, subtitle: string, oddsValue: number | undefined) {
    if (oddsValue == null) return null
    const selected = isSelected(marketType, 'yes')
    return (
      <button
        key={marketType}
        type="button"
        onClick={() => add(marketType, marketLabel, 'yes', 'Ja', oddsValue)}
        disabled={!isScheduled}
        className={`w-full flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:opacity-50 ${
          selected
            ? 'bg-red-700 border-red-700 text-white'
            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 hover:border-red-300'
        }`}
      >
        <div className="min-w-0">
          <div className={`text-[11px] font-semibold truncate ${selected ? 'text-white' : 'text-gray-700 dark:text-gray-200'}`}>{title}</div>
          <div className={`text-[10px] truncate ${selected ? 'text-red-100' : 'text-gray-500 dark:text-gray-400'}`}>{subtitle}</div>
        </div>
        <div className={`font-bold text-sm flex-shrink-0 ${selected ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>{oddsValue.toFixed(2)}</div>
      </button>
    )
  }

  const offeredScorers = (goalscorers ?? [])
    .filter(g => g.is_offered && g.status === 'available')
    .sort((a, b) => a.odds_score - b.odds_score)

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-l-4 border-l-amber-500 dark:border-l-amber-600 border-gray-100 dark:border-gray-700 overflow-hidden ${isFinished ? 'opacity-60' : ''}`}>
      {/* Header: a small badge (not a full-width colored banner) is enough to
          mark this as the one-off cup fixture — the card otherwise reads
          like a normal match card, so it doesn't dominate the Spieltag list
          it's pinned above. */}
      <div className="px-4 pt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-full px-2 py-0.5 flex-shrink-0">
            🏆 {match.competition_name ?? 'Sparkassen Fußball-Cup'}
          </span>
          {match.competition_round && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{match.competition_round}</span>
          )}
        </div>
        {isLive && (
          <div className="flex items-center gap-1 text-[10px] font-bold text-white bg-orange-600 rounded-full px-2 py-0.5 flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> Live
          </div>
        )}
      </div>
      {!isFinished && (
        <div className="px-4 pt-1 text-[10px] text-gray-400 dark:text-gray-500 leading-snug">
          Bei Remis nach 90 Minuten geht es direkt ins Elfmeterschießen – keine Verlängerung.
        </div>
      )}

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
      </div>

      {blockMsg && (
        <div className="mx-4 mb-2 text-[11px] bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg px-2 py-1.5">
          Als Wildenroth-Spieler oder -Trainer darfst du nicht gegen dein eigenes Team wetten.
        </div>
      )}

      {odds ? (
        <div className="px-4 pb-4">
          {/* Tabs: purely local UI state (useState above) — switching tabs
              only toggles which market groups are rendered, it never
              unmounts this component or touches BetSlipContext, so
              selections already made survive a tab switch untouched. */}
          <div className="flex gap-1.5 mb-3 bg-amber-100/70 dark:bg-amber-900/20 rounded-xl p-1">
            <button
              type="button"
              onClick={() => setTab('specials')}
              className={`flex-1 rounded-lg py-1.5 text-[11px] font-bold transition-colors ${
                tab === 'specials'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-amber-800 dark:text-amber-300 hover:bg-amber-200/60 dark:hover:bg-amber-800/30'
              }`}
            >
              🏆 Pokal-Specials
            </button>
            <button
              type="button"
              onClick={() => setTab('spiel')}
              className={`flex-1 rounded-lg py-1.5 text-[11px] font-bold transition-colors ${
                tab === 'spiel'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-amber-800 dark:text-amber-300 hover:bg-amber-200/60 dark:hover:bg-amber-800/30'
              }`}
            >
              ⚽ Spiel &amp; Torschützen
            </button>
          </div>

          {tab === 'specials' && (
            <div className="bg-amber-50/80 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800 rounded-xl p-2.5 space-y-3">
              <MarketBlock title="🏆 Wer kommt weiter?" subtitle="">
                {renderOddsButton('cup_advance', ml('cup_advance'), 'home', sl('cup_advance', 'home'), odds.cup_advance_home)}
                {renderOddsButton('cup_advance', ml('cup_advance'), 'away', sl('cup_advance', 'away'), odds.cup_advance_away)}
              </MarketBlock>

              <MarketBlock title="🧤 Wann fällt die Entscheidung?" subtitle="90 Min. oder Elfmeterschießen">
                {renderOddsButton('cup_decision', ml('cup_decision'), 'regulation', sl('cup_decision', 'regulation'), odds.cup_decision_regulation)}
                {renderOddsButton('cup_decision', ml('cup_decision'), 'shootout', sl('cup_decision', 'shootout'), odds.cup_decision_shootout)}
              </MarketBlock>

              {/* These 3 specials are deliberately offered as single-outcome
                  "Ja"-only props (product decision) — the "Nein" side still
                  exists in the odds/settlement model for any bet placed
                  before this change, it's just no longer a NEW-bet button
                  here. See renderCupPropButton below. */}
              {renderCupPropButton('cup_halftime_lead_advance', ml('cup_halftime_lead_advance'), '🔥 HZ-Führung & Weiter', sl('cup_halftime_lead_advance', 'yes'), odds.cup_halftime_lead_advance_yes)}
              {renderCupPropButton('cup_comeback_advance', ml('cup_comeback_advance'), '🔄 Comeback & Weiter', sl('cup_comeback_advance', 'yes'), odds.cup_comeback_advance_yes)}
              {renderCupPropButton('cup_shootout_advance', ml('cup_shootout_advance'), '🎯 Im Elfmeterschießen weiter', sl('cup_shootout_advance', 'yes'), odds.cup_shootout_advance_yes)}
              <MarketBlock title="⚡ Frühes Tor" subtitle="Erstes Tor in Min. 1–15">
                {renderOddsButton('cup_early_goal', ml('cup_early_goal'), 'yes', sl('cup_early_goal', 'yes'), odds.cup_early_goal_yes)}
                {renderOddsButton('cup_early_goal', ml('cup_early_goal'), 'no', sl('cup_early_goal', 'no'), odds.cup_early_goal_no)}
              </MarketBlock>

              <div className="text-[10px] text-amber-800/80 dark:text-amber-300/80 leading-snug pt-0.5">
                🏆 Pokal-Sonderregel: Das Pokalspiel könnt ihr entweder ganz normal in einen eurer
                Wettscheine/Kombis packen ODER zusätzlich als 4. Wettschein spielen. Der 4. Schein
                darf dann aber nur eine einzelne Pokalwette enthalten.
              </div>
            </div>
          )}

          {tab === 'spiel' && (
            <div className="space-y-3">
              <MarketBlock title="⚽ Erstes Tor" subtitle="Nur reguläre Spielzeit">
                {renderOddsButton('cup_first_goal', ml('cup_first_goal'), 'home', sl('cup_first_goal', 'home'), odds.cup_first_goal_home)}
                {renderOddsButton('cup_first_goal', ml('cup_first_goal'), 'away', sl('cup_first_goal', 'away'), odds.cup_first_goal_away)}
                {renderOddsButton('cup_first_goal', ml('cup_first_goal'), 'none', sl('cup_first_goal', 'none'), odds.cup_first_goal_none)}
              </MarketBlock>

              <MarketBlock title="🤝 Beide treffen" subtitle="Nur reguläre Spielzeit">
                {renderOddsButton('btts', 'Beide Teams treffen', 'yes', 'Ja', odds.btts_yes)}
                {renderOddsButton('btts', 'Beide Teams treffen', 'no', 'Nein', odds.btts_no)}
              </MarketBlock>

              <MarketBlock title="⏱️ In welcher Halbzeit fallen mehr Tore?" subtitle="Alle Tore beider Mannschaften zusammen">
                {renderOddsButton('cup_ht_more_goals', ml('cup_ht_more_goals'), 'h1', sl('cup_ht_more_goals', 'h1'), odds.cup_ht_more_goals_h1)}
                {renderOddsButton('cup_ht_more_goals', ml('cup_ht_more_goals'), 'h2', sl('cup_ht_more_goals', 'h2'), odds.cup_ht_more_goals_h2)}
                {renderOddsButton('cup_ht_more_goals', ml('cup_ht_more_goals'), 'equal', sl('cup_ht_more_goals', 'equal'), odds.cup_ht_more_goals_equal)}
              </MarketBlock>

              {offeredScorers.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                    🎯 Wildenroth-Torschütze
                  </div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-1.5 leading-snug">
                    Elfmeterschießen zählt nicht
                  </div>
                  <div className="space-y-1.5">
                    {offeredScorers.map((g) => (
                      <GoalscorerRow
                        key={g.player_id}
                        selected={isSelected('goalscorer', String(g.player_id))}
                        disabled={!isScheduled}
                        name={g.player_name}
                        position={g.position}
                        oddsValue={g.odds_score}
                        onClick={() => add('goalscorer', 'Wildenroth-Torschütze', String(g.player_id), g.player_name, g.odds_score)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : !isFinished ? (
        <div className="h-2" />
      ) : null}
    </div>
  )
}

/** One market group: heading, short inline rule subtitle, then its buttons. */
function MarketBlock({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">{title}</div>
      <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-1 leading-snug">{subtitle}</div>
      <div className="flex gap-1.5">{children}</div>
    </div>
  )
}

/**
 * Goalscorer selection row — mirrors the existing, already-correct
 * BettingMatchCard goalscorer list (name on the left, one fixed-width odds
 * button on the right, stacked vertically) instead of cramming a variable
 * number of long player names into equal-flexed OddsButtons inside a
 * flex-wrap row (which squeezed/truncated names once more than 2-3 players
 * were offered — the cause of the display bug on this card).
 */
function GoalscorerRow({ selected, disabled, name, position, oddsValue, onClick }: {
  selected: boolean
  disabled: boolean
  name: string
  position: string | null
  oddsValue: number
  onClick: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-gray-900 dark:text-gray-100 truncate">{name}</div>
        {position && (
          <div className="text-[10px] text-gray-400 dark:text-gray-500">{position}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`flex-shrink-0 flex flex-col items-center justify-center w-20 py-1.5 px-1 rounded-xl border transition-all active:scale-95 disabled:opacity-50 ${
          selected
            ? 'bg-red-700 border-red-700 text-white shadow-md'
            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 hover:border-red-300'
        }`}
      >
        <span className={`text-[10px] ${selected ? 'text-red-100' : 'text-gray-500 dark:text-gray-400'}`}>Trifft</span>
        <span className={`text-sm font-black ${selected ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>
          {oddsValue.toFixed(2)}
        </span>
      </button>
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
