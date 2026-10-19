'use client'

import { useEffect, useState } from 'react'
import { cupSelectionLabel, oddsColorClass, specialMarketLabel, specialSelectionLabel, CUP_MARKET_LABEL, type SpecialDisplayInfo } from '@/lib/betDisplay'
import { cappedPayout } from '@/lib/payout'
import { effectiveMatchdayOf, type EffectiveMatchdayIndex } from '@/lib/season'
import { wl } from '@/components/admin/ui'
import type { Match } from '@/types'
import type { MatchRow } from '@/components/admin/types'

const MARKET_LABELS: Record<string, string> = {
  '1x2': '1X2', double_chance: 'Dopp. Chance', over_under: 'Ü/U 2,5',
  over_under_3_5: 'Ü/U 3,5', over_under_5_5: 'Ü/U 5,5', over_under_7_5: 'Ü/U 7,5',
  btts: 'Beide treffen', exact_score: 'Ergebnis', handicap: 'Handicap',
  goalscorer: 'Torschütze', goalscorer_2plus: 'Mind. 2 Tore',
}

/**
 * UNVERÄNDERT aus app/admin/page.tsx hierher verschoben (nicht neu geschrieben) — eigene
 * Datenabruf-Logik (/api/admin/bets) und Darstellung der Wettenlisten je Spieler bleiben wie
 * bisher, nur jetzt in einer eigenen Datei, damit SpieltagTabView sie importieren kann, ohne
 * dass app/admin/page.tsx von einer Komponente importiert oder umgekehrt ein Kreis entsteht.
 * ACHTUNG: entspricht NICHT der gleichnamigen Komponente im alten, verworfenen Admin-Redesign
 * (dort nur `matchday` als Prop, eigener unabhängiger Abruf) — das ist bewusst nicht die hier
 * verwendete Implementierung.
 */

const SELECTION_LABELS: Record<string, string> = {
  home: 'Heimsieg', draw: 'Unentschieden', away: 'Auswärtssieg',
  '1x': '1X', x2: 'X2', '12': '12',
  'over_2.5': 'Über 2,5', 'under_2.5': 'Unter 2,5',
  'over_3.5': 'Über 3,5', 'under_3.5': 'Unter 3,5',
  'over_5.5': 'Über 5,5', 'under_5.5': 'Unter 5,5',
  'over_7.5': 'Über 7,5', 'under_7.5': 'Unter 7,5',
  yes: 'Beide treffen', no: 'Nicht beide',
  home_minus_1_5: 'Heim –1,5', away_plus_1_5: 'Gast +1,5',
  home_minus_2_5: 'Heim –2,5', away_plus_2_5: 'Gast +2,5',
  away_minus_1_5: 'Gast –1,5', home_plus_1_5: 'Heim +1,5',
  away_minus_2_5: 'Gast –2,5', home_plus_2_5: 'Heim +2,5',
}

function selLabel(marketType: string, selection: string, players?: Record<number, string>): string {
  if (marketType === 'exact_score') return selection
  if (marketType === 'goalscorer' || marketType === 'goalscorer_2plus') {
    const id = parseInt(selection, 10)
    const name = players?.[id] ?? `Spieler #${id}`
    return marketType === 'goalscorer_2plus' ? `${name} (mind. 2 Tore)` : name
  }
  // matchday_special checked before SELECTION_LABELS (keyed by selection code
  // ALONE, not market_type) — a Special's plain 'yes'/'no' would otherwise
  // wrongly match btts's "Beide treffen"/"Nicht beide". Generic fallback only
  // (no title/line) — this admin listing doesn't join matchday_specials.
  if (marketType === 'matchday_special') {
    return { over: 'Über', under: 'Unter', yes: 'Ja', no: 'Nein' }[selection] ?? selection
  }
  // Cup markets checked first — SELECTION_LABELS is keyed by selection code
  // alone, so a cup_comeback_advance 'yes' would otherwise wrongly match
  // btts's "Beide treffen".
  return cupSelectionLabel(marketType, selection) ?? SELECTION_LABELS[selection] ?? selection
}

export function AdminBetsTab({ matches, mdIndex, currentMatchday }: { matches: MatchRow[]; mdIndex: EffectiveMatchdayIndex; currentMatchday: number | null }) {
  // Effective (not raw) matchday numbers — /api/admin/bets filters by
  // effectiveMatchdayOf, so the picker buttons and the fetched data must use
  // the same numbering, or a rescheduled match's raw matchday could pick a
  // button that silently fetches the wrong (or empty) Spieltag's bets.
  const allMatchdays = [...new Set(
    matches.map(m => effectiveMatchdayOf(m as unknown as Match, mdIndex)).filter((md): md is number => md !== null)
  )].sort((a, b) => a - b)
  // matches (and therefore currentMatchday) is still empty on this
  // component's very first render — the parent fetches it async and there's
  // no loading gate before <TippsAccordion> mounts — so a plain useState
  // initializer would freeze at the "1"/last-matchday fallback forever, even
  // once currentMatchday later becomes available. Same guarded-effect
  // pattern as the parent's mdFilter (B3): sync once when currentMatchday
  // first arrives, never again after that so a manual pick always wins.
  const [selectedMd, setSelectedMd] = useState<number>(currentMatchday ?? allMatchdays[allMatchdays.length - 1] ?? 1)
  const [selectedMdInitialized, setSelectedMdInitialized] = useState(currentMatchday != null)
  useEffect(() => {
    if (selectedMdInitialized || currentMatchday == null) return
    setSelectedMd(currentMatchday)
    setSelectedMdInitialized(true)
  }, [currentMatchday, selectedMdInitialized])
  const [bets, setBets] = useState<{ id: string; user_id: string; match_id: number; market_type: string; selection: string; odds_value: number; status: string; combo_id: string | null; is_risky: boolean; stake: number | null; special_id: number | null; created_at: string }[]>([])
  const [profiles, setProfiles] = useState<{ id: string; display_name: string | null; username: string }[]>([])
  const [matchMap, setMatchMap] = useState<Record<number, { home: string; away: string }>>({})
  const [playerMap, setPlayerMap] = useState<Record<number, string>>({})
  const [comboMap, setComboMap] = useState<Record<number, { stake: number; total_odds: number; status: string; payout: number | null }>>({})
  const [specialsById, setSpecialsById] = useState<Record<number, SpecialDisplayInfo>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/admin/bets?matchday=${selectedMd}`)
      .then(r => r.json())
      .then(data => {
        setBets(data.bets ?? []); setProfiles(data.profiles ?? [])
        setMatchMap(data.matchMap ?? {}); setPlayerMap(data.playerNameMap ?? {})
        setComboMap(data.comboMap ?? {}); setSpecialsById(data.specialsById ?? {})
      })
      .finally(() => setLoading(false))
  }, [selectedMd])

  // "Spieltag N · <Markt>" / "<Antwort>" for a matchday_special leg —
  // its match_id is only the representative_match_id (technical FK anchor),
  // so showing that match's team names would misrepresent what was bet on.
  const specialLegTitle = (leg: { special_id: number | null }): string => {
    const special = leg.special_id != null ? specialsById[leg.special_id] : undefined
    return special ? specialMarketLabel(special) : 'Spieltag-Special'
  }
  const specialLegSelection = (leg: { special_id: number | null; selection: string }): string => {
    const special = leg.special_id != null ? specialsById[leg.special_id] : undefined
    return special ? specialSelectionLabel(special, leg.selection) : selLabel('matchday_special', leg.selection)
  }

  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p.display_name || p.username]))
  // `bets` arrives newest-first (see /api/admin/bets's order by created_at
  // desc) — sort the user cards themselves by their most recent bet too, so
  // whoever just placed something bubbles to the top instead of sitting
  // wherever the profiles query happened to return them.
  const byUser = profiles
    .map(p => ({
      profile: p,
      bets: bets.filter(b => b.user_id === p.id),
    }))
    .sort((a, b) => {
      const at = a.bets[0]?.created_at ?? ''
      const bt = b.bets[0]?.created_at ?? ''
      return bt.localeCompare(at)
    })

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {allMatchdays.map(md => (
          <button key={md} onClick={() => setSelectedMd(md)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              md === selectedMd ? 'bg-red-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-red-300'
            }`}>
            ST {md}
          </button>
        ))}
      </div>

      {loading && <div className="text-center py-8 text-gray-400 text-sm">Lade Tipps…</div>}

      {!loading && byUser.length === 0 && (
        <div className="text-center py-8 text-gray-400 text-sm">Keine Tipps für Spieltag {selectedMd}</div>
      )}

      {!loading && byUser.map(({ profile, bets: userBets }) => {
        if (userBets.length === 0) return null
        const shownCombos = new Set<string>()
        return (
          <div key={profile.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center text-red-700 font-bold text-xs flex-shrink-0">
                {(profile.display_name || profile.username)[0].toUpperCase()}
              </span>
              <span className="font-semibold text-sm text-gray-900">{profileMap[profile.id]}</span>
              <span className="ml-auto text-xs text-gray-400">{userBets.filter(b => !b.combo_id).length} Einzel · {new Set(userBets.filter(b => b.combo_id).map(b => b.combo_id)).size} Kombi</span>
            </div>
            <div className="divide-y divide-gray-50">
              {userBets.map(bet => {
                if (bet.combo_id) {
                  if (shownCombos.has(bet.combo_id)) return null
                  shownCombos.add(bet.combo_id)
                  const legs = userBets.filter(b => b.combo_id === bet.combo_id)
                  // Prefer the stored total_odds (combo_bets, always the full,
                  // correct value) over recomputing from `legs` — `legs` here
                  // only ever holds whichever legs this Spieltag's /api/admin/bets
                  // call returned, so a product over it silently understates a
                  // combo whose fetch was incomplete for any reason.
                  const comboOdds = comboMap[Number(bet.combo_id)]?.total_odds ?? legs.reduce((acc, l) => acc * l.odds_value, 1)
                  // Compute effective combo status from legs — same logic as the app.
                  // 'void' (storniert) legs are neither 'lost' nor 'won', and must be
                  // checked before the 'pending' fallback — otherwise a cancelled
                  // combo (all legs 'void') silently reads as "Offen".
                  const effectiveComboStatus =
                    legs.some(l => l.status === 'lost') ? 'lost' :
                    legs.every(l => l.status === 'won') ? 'won' :
                    legs.every(l => l.status === 'void') ? 'void' :
                    'pending'
                  const comboStake = comboMap[Number(bet.combo_id)]?.stake
                  return (
                    <div key={bet.combo_id} className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded flex-shrink-0">
                          {bet.is_risky ? '🎲 RISKY' : '🔗 KOMBI'}
                        </span>
                        <span className="text-xs text-gray-500 truncate">
                          {legs.length} Tipps · <span className={`font-semibold ${oddsColorClass(effectiveComboStatus)}`}>@{comboOdds.toFixed(2).replace('.', ',')}</span>
                        </span>
                        <span className="ml-auto flex-shrink-0"><StatusChip status={effectiveComboStatus} /></span>
                      </div>
                      {comboStake != null && (
                        <div className="text-[10px] text-gray-400 mb-1.5 pl-0.5">
                          Einsatz {comboStake} {wl(comboStake)}
                          {' · '}
                          {effectiveComboStatus === 'won' && comboMap[Number(bet.combo_id)]?.payout != null
                            ? <span className="font-bold text-green-600">+{comboMap[Number(bet.combo_id)]!.payout!.toFixed(2)} {wl(comboMap[Number(bet.combo_id)]!.payout!)}</span>
                            : effectiveComboStatus === 'lost'
                              ? <span className="text-red-400 line-through">{cappedPayout(comboStake, comboOdds, bet.is_risky).toFixed(2)} {wl(cappedPayout(comboStake, comboOdds, bet.is_risky))}</span>
                              : <>mög. Gewinn <span className="font-semibold text-gray-600">{cappedPayout(comboStake, comboOdds, bet.is_risky).toFixed(2)} {wl(cappedPayout(comboStake, comboOdds, bet.is_risky))}</span></>
                          }
                        </div>
                      )}
                      {legs.map(leg => (
                        <div key={leg.id} className="flex items-center gap-1.5 text-xs text-gray-600 py-0.5 pl-2">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${leg.status === 'won' ? 'bg-green-500' : leg.status === 'lost' ? 'bg-red-500' : leg.status === 'void' ? 'bg-gray-300' : 'bg-yellow-400'}`} />
                          {leg.market_type === 'matchday_special' ? (
                            <>
                              <span className="text-gray-400 text-[10px]">{specialLegTitle(leg)}</span>
                              <span className="font-medium text-gray-800">{specialLegSelection(leg)}</span>
                            </>
                          ) : (
                            <>
                              <span className="text-gray-400 text-[10px]">{matchMap[leg.match_id]?.home}–{matchMap[leg.match_id]?.away}</span>
                              <span className="bg-gray-100 text-gray-600 px-1 rounded text-[10px]">{CUP_MARKET_LABEL[leg.market_type] ?? MARKET_LABELS[leg.market_type] ?? leg.market_type}</span>
                              <span className="font-medium text-gray-800">{selLabel(leg.market_type, leg.selection, playerMap)}</span>
                            </>
                          )}
                          <span className={`font-bold ml-auto ${oddsColorClass(leg.status)}`}>@{leg.odds_value.toFixed(2).replace('.', ',')}</span>
                        </div>
                      ))}
                    </div>
                  )
                }
                return (
                  <div key={bet.id} className="px-4 py-2.5">
                    <div className="flex items-start gap-1.5 text-xs flex-wrap">
                      {bet.market_type === 'matchday_special' ? (
                        <>
                          <span className="text-gray-400 text-[10px]">{specialLegTitle(bet)}</span>
                          <span className="font-medium text-gray-800">{specialLegSelection(bet)}</span>
                        </>
                      ) : (
                        <>
                          <span className="text-gray-400">{matchMap[bet.match_id]?.home}–{matchMap[bet.match_id]?.away}</span>
                          <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-[10px] flex-shrink-0">{CUP_MARKET_LABEL[bet.market_type] ?? MARKET_LABELS[bet.market_type] ?? bet.market_type}</span>
                          <span className="font-medium text-gray-800">{selLabel(bet.market_type, bet.selection, playerMap)}</span>
                        </>
                      )}
                      {bet.is_risky && <span className="text-[10px] font-bold text-purple-700 flex-shrink-0">🎲</span>}
                      <span className={`font-bold ml-auto flex-shrink-0 ${oddsColorClass(bet.status)}`}>@{bet.odds_value.toFixed(2).replace('.', ',')}</span>
                      <StatusChip status={bet.status} />
                    </div>
                    {bet.stake != null && (
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        Einsatz {bet.stake} {wl(bet.stake)}
                        {' · '}
                        {bet.status === 'won'
                          ? <span className="font-bold text-green-600">+{cappedPayout(bet.stake, bet.odds_value, bet.is_risky).toFixed(2)} {wl(cappedPayout(bet.stake, bet.odds_value, bet.is_risky))}</span>
                          : bet.status === 'lost'
                            ? <span className="text-red-400 line-through">{cappedPayout(bet.stake, bet.odds_value, bet.is_risky).toFixed(2)} {wl(cappedPayout(bet.stake, bet.odds_value, bet.is_risky))}</span>
                            : <>mög. Gewinn <span className="font-semibold text-gray-600">{cappedPayout(bet.stake, bet.odds_value, bet.is_risky).toFixed(2)} {wl(cappedPayout(bet.stake, bet.odds_value, bet.is_risky))}</span></>
                        }
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
      status === 'won' ? 'bg-green-100 text-green-700' :
      status === 'lost' ? 'bg-red-100 text-red-600' :
      status === 'void' ? 'bg-gray-100 text-gray-500' : 'bg-yellow-50 text-yellow-700'
    }`}>
      {status === 'won' ? 'Gewonnen' : status === 'lost' ? 'Verloren' : status === 'void' ? 'Storniert' : 'Offen'}
    </span>
  )
}
