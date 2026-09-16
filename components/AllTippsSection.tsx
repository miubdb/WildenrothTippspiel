'use client'

import { useMemo, useState } from 'react'
import { TeamLogo } from '@/components/TeamLogo'
import { wildiLabel } from '@/components/WildiIcon'
import { oddsColorClass, socialSelLabel, type SpecialDisplayInfo, specialMarketLabel, specialSelectionLabel } from '@/lib/betDisplay'
import type { Match } from '@/types'

type SocialBet = { id: string; market_type: string; selection: string; odds_value: number; status: string; combo_id: string | null; user_id: string; match_id: number; stake: number | null; special_id: number | null }
type SocialCombo = { id: number; stake: number; total_odds: number; status: string; payout: number | null }
type SocialProfile = { id: string; display_name: string | null; username: string; avatar_url: string | null }

/**
 * "Alle Tipps" — extracted from app/(app)/tipps/page.tsx (a Server Component)
 * into its own 'use client' component so the "Verlorene ausblenden" filter
 * toggle below can react instantly without a full page navigation/refetch.
 * All data is passed down already-fetched from the server; this component
 * does no data fetching of its own.
 */
export function AllTippsSection({
  matchdayMatches,
  betCountByMatch,
  specialBetCount = 0,
  socialBets,
  socialCombos,
  socialProfiles,
  playerNameMap,
  userId,
  specialsById,
}: {
  matchdayMatches: Match[]
  betCountByMatch: Record<number, number>
  specialBetCount?: number
  socialBets: SocialBet[]
  socialCombos: Record<string, SocialCombo>
  socialProfiles: SocialProfile[]
  playerNameMap: Record<number, string>
  userId: string
  specialsById?: Record<number, SpecialDisplayInfo>
}) {
  // "Spieltag-Special" label for a bet leg — falls back to the generic
  // socialSelLabel-style text if the Special row isn't joined for some
  // reason, but must NEVER fall through to the representative match's own
  // team names (see lib/betDisplay.ts's doc comment on why).
  const specialLegLabel = (leg: { special_id: number | null; selection: string }): string => {
    const special = leg.special_id != null ? specialsById?.[leg.special_id] : undefined
    return special ? specialSelectionLabel(special, leg.selection) : leg.selection
  }
  const specialLegTitle = (leg: { special_id: number | null }): string => {
    const special = leg.special_id != null ? specialsById?.[leg.special_id] : undefined
    return special ? specialMarketLabel(special) : 'Spieltag-Special'
  }
  const [onlyActive, setOnlyActive] = useState(false)
  const now = useMemo(() => new Date(), [])
  const matchMap = useMemo(() => new Map(matchdayMatches.map(m => [m.id, m])), [matchdayMatches])
  const profileMap = useMemo(() => new Map(socialProfiles.map(p => [p.id, p])), [socialProfiles])

  const nameOf = (uid: string) => {
    if (uid === userId) return 'Du'
    const p = profileMap.get(uid)
    return p ? (p.display_name || p.username) : 'Unbekannt'
  }
  const initialOf = (uid: string) => (uid === userId ? 'D' : (nameOf(uid)[0] ?? '?').toUpperCase())
  const avatarUrlOf = (uid: string) => profileMap.get(uid)?.avatar_url ?? null
  const renderAvatar = (uid: string, dim: 'w-4 h-4' | 'w-6 h-6', bgCls: string, textCls: string, textSize: string) => {
    const url = avatarUrlOf(uid)
    if (url) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className={`${dim} rounded-full object-cover flex-shrink-0`} />
      )
    }
    return (
      <span className={`${dim} rounded-full ${bgCls} flex items-center justify-center flex-shrink-0`}>
        <span className={`${textCls} font-bold ${textSize}`}>{initialOf(uid)}</span>
      </span>
    )
  }

  // Base visible set: never show storniert/void bets (unrelated to the new
  // filter — this was already the behaviour before the toggle existed).
  const nonVoidSocial = socialBets.filter(b => b.status !== 'void')

  // A combo's overall status — same fallback-from-legs logic used for the
  // combo card's own status further down, computed once here so the
  // "nur aktive Wetten" filter (and totalTippers below) can use it too.
  const comboStatusOf = (comboId: string): 'won' | 'lost' | 'pending' => {
    const legs = nonVoidSocial.filter(b => b.combo_id === comboId)
    const dbSt = socialCombos[comboId]?.status ?? 'pending'
    if (dbSt === 'won' || dbSt === 'lost') return dbSt
    if (legs.some(l => l.status === 'lost')) return 'lost'
    if (legs.length > 0 && legs.every(l => l.status === 'won')) return 'won'
    return 'pending'
  }

  const totalTippers = new Set(nonVoidSocial.map(b => b.user_id)).size

  // "Verlorene ausblenden": grün (gewonnen) + gelb (offen) bleiben, rot
  // (verloren) wird ausgeblendet — für Kombis anhand des GESAMTstatus des
  // Wettscheins, nicht pro Leg (ein einzelner falscher Leg macht die ganze
  // Kombi tot, auch wenn andere Legs schon "gewonnen" sind).
  const activeSocial = onlyActive
    ? nonVoidSocial.filter(b => (b.combo_id ? comboStatusOf(b.combo_id) !== 'lost' : b.status !== 'lost'))
    : nonVoidSocial

  const comboFirstMatchId = new Map<string, number>()
  for (const b of activeSocial) {
    // Never let a Spieltag-Special leg decide (or even count toward) which
    // match "hosts" a combo card — its match_id is only representative_match_id
    // (technical FK anchor), and a combo can hold at most one Special leg
    // alongside at least one real-match leg (see MatchdaySpecialsSection's
    // "max 1 Special pro Kombi" rule), so skipping it here always still
    // leaves a real match to anchor on.
    if (!b.combo_id || b.market_type === 'matchday_special') continue
    const cid = String(b.combo_id)
    if (!comboFirstMatchId.has(cid)) {
      comboFirstMatchId.set(cid, b.match_id)
    } else {
      const curMatchDate = new Date(matchMap.get(comboFirstMatchId.get(cid)!)?.match_date ?? '').getTime()
      const thisMatchDate = new Date(matchMap.get(b.match_id)?.match_date ?? '').getTime()
      if (thisMatchDate < curMatchDate) comboFirstMatchId.set(cid, b.match_id)
    }
  }

  // Single (non-combo) Spieltag-Special bets — rendered in their OWN section
  // below, never nested under a match card: a Special's match_id is only its
  // representative_match_id (technical FK anchor), so grouping it under that
  // match's header would wrongly read as a bet on that one game.
  const specialSingles = activeSocial
    .filter(b => !b.combo_id && b.market_type === 'matchday_special')
    .sort((a, b) => b.odds_value - a.odds_value)
  // Combos that hold a Spieltag-Special leg — same idea as specialSingles,
  // but for the combo case: a combo with a Special leg only ever showed up
  // under whichever REAL match hosts it (comboFirstMatchId, computed purely
  // from its real legs), buried behind "+N weitere Tipps" — there was no
  // place a Special-bet-at-a-glance view like specialSingles gets. Listed
  // here too (dedup by combo_id — the app only ever allows one Special leg
  // per combo, see MatchdaySpecialsSection's "max 1 pro Kombi" rule) so a
  // combo's Special pick is just as visible as a match's own bets are.
  const specialComboLegs = [
    ...new Map(
      activeSocial
        .filter(b => b.combo_id && b.market_type === 'matchday_special')
        .map(b => [b.combo_id as string, b])
    ).values(),
  ].sort((a, b) => b.odds_value - a.odds_value)
  const hasSpecialBets = nonVoidSocial.some(b => b.market_type === 'matchday_special')
  // specialBetCount (passed from the server, via an admin-client query not
  // gated behind "has any match kicked off yet") can be > 0 while
  // socialBets itself is still empty — before the Spieltag's first match
  // (the Specials' own representative_match_id) kicks off, RLS/the page's
  // own pre-check hides ALL social bets, Special ones included. Without
  // this, a Special with real bets on it showed no "🔒 N Wettscheine ·
  // sichtbar ab Anpfiff" placeholder at all — unlike every match's own
  // section — silently looking like nobody had bet on it yet.
  const specialsLocked = specialBetCount > 0 && !hasSpecialBets

  if (!Object.values(betCountByMatch).some(c => c > 0) && !hasSpecialBets && !specialsLocked) return null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-2">
        <div>
          <h2 className="font-bold text-gray-900 dark:text-gray-100">Alle Tipps</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            {totalTippers > 0 ? `${totalTippers} Spieler haben getippt` : 'Tipps sichtbar ab Anpfiff'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOnlyActive(v => !v)}
          aria-pressed={onlyActive}
          className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
            onlyActive
              ? 'bg-red-700 border-red-700 text-white'
              : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'
          }`}
        >
          Verlorene ausblenden
        </button>
      </div>

      {specialsLocked && (
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Spieltag-Specials</div>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            🔒 {specialBetCount} Wettschein{specialBetCount !== 1 ? 'e' : ''} · sichtbar ab Anpfiff
          </p>
        </div>
      )}

      {(specialSingles.length > 0 || specialComboLegs.length > 0) && (
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 space-y-2">
          <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Spieltag-Specials</div>
          {specialSingles.map(bet => {
            const stake = bet.stake ?? 0
            const potWin = Math.round(stake * bet.odds_value * 100) / 100
            const edgeCls = bet.status === 'won' ? 'border-l-green-500' : bet.status === 'lost' ? 'border-l-red-400' : 'border-l-yellow-400'
            return (
              <details key={bet.id} className={`group rounded-lg bg-gray-50 dark:bg-gray-700/40 border-l-4 ${edgeCls} overflow-hidden`}>
                <summary className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 cursor-pointer select-none list-none marker:hidden">
                  {renderAvatar(bet.user_id, 'w-4 h-4', 'bg-red-100 dark:bg-red-900/30', 'text-red-700 dark:text-red-400', 'text-[9px]')}
                  <span className="font-semibold text-gray-800 dark:text-gray-200 truncate flex-shrink-0 max-w-[9rem]">{nameOf(bet.user_id)}</span>
                  <span className="truncate flex-1 min-w-0 text-gray-600 dark:text-gray-300">
                    <span className="block text-[10px] text-gray-400 dark:text-gray-500 font-medium truncate">{specialLegTitle(bet)}</span>
                    {specialLegLabel(bet)}
                  </span>
                  <span className={`font-bold flex-shrink-0 ${oddsColorClass(bet.status)}`}>@{bet.odds_value.toFixed(2).replace('.', ',')}</span>
                  <span className="text-gray-400 dark:text-gray-500 text-[10px] flex-shrink-0 transition-transform group-open:rotate-180">▾</span>
                </summary>
                <div className="px-2.5 pb-2 pt-1 border-t border-black/5 dark:border-white/5 text-[11px] text-gray-500 dark:text-gray-400">
                  {bet.status === 'pending' && <span>Einsatz: {stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)} → <span className="font-bold text-gray-700 dark:text-gray-200">{potWin.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(potWin)}</span></span>}
                  {bet.status === 'won' && <span>Einsatz: {stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)} → <span className="font-bold text-green-600">+{potWin.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(potWin)}</span></span>}
                  {bet.status === 'lost' && <span>Einsatz: <span className="text-red-500 line-through">{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)}</span></span>}
                </div>
              </details>
            )
          })}
          {specialComboLegs.map(specialLeg => {
            const comboId = specialLeg.combo_id as string
            const legs = activeSocial.filter(b => b.combo_id === comboId)
            // Special leg rendered as just another leg at the bottom of the
            // list (see below), not spotlighted in the header — matches how
            // every other combo leg looks, keeps the header focused on the
            // combo itself rather than mixing in one leg's own answer/odds.
            const otherLegs = legs.filter(l => l.id !== specialLeg.id)
            const cb = socialCombos[comboId]
            const totalOdds = cb?.total_odds ?? legs.reduce((acc, l) => acc * l.odds_value, 1)
            const stake = cb?.stake ?? 0
            const potWin = Math.round(stake * totalOdds * 100) / 100
            const comboStatus = comboStatusOf(comboId)
            const edgeCls = comboStatus === 'won' ? 'border-l-green-500' : comboStatus === 'lost' ? 'border-l-red-400' : 'border-l-yellow-400'
            const legMoot = specialLeg.status === 'pending' && comboStatus === 'lost'
            return (
              <details key={comboId} className={`group rounded-lg bg-gray-50 dark:bg-gray-700/40 border-l-4 ${edgeCls} overflow-hidden`}>
                <summary className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 cursor-pointer select-none list-none marker:hidden">
                  {renderAvatar(specialLeg.user_id, 'w-4 h-4', 'bg-red-100 dark:bg-red-900/30', 'text-red-700 dark:text-red-400', 'text-[9px]')}
                  <span className="font-semibold text-gray-800 dark:text-gray-200 truncate flex-shrink-0 max-w-[9rem]">{nameOf(specialLeg.user_id)}</span>
                  <span className="text-[9px] font-bold bg-blue-600 text-white rounded px-1 py-0.5 flex-shrink-0">KOMBI</span>
                  <LegResultMark moot={legMoot} />
                  <span className={`truncate flex-1 min-w-0 ${legMoot ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300'}`}>
                    {specialLegTitle(specialLeg)}
                  </span>
                  <span className={`font-bold flex-shrink-0 ${oddsColorClass(specialLeg.status)}`}>@{specialLeg.odds_value.toFixed(2).replace('.', ',')}</span>
                  <span className="text-gray-400 dark:text-gray-500 text-[10px] flex-shrink-0 transition-transform group-open:rotate-180">▾</span>
                </summary>
                <div className="px-2.5 pb-2 pt-1 border-t border-black/5 dark:border-white/5 space-y-1.5">
                  {legMoot && (
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                      Dieser Tipp ist noch offen, aber die Kombi ist bereits an anderer Stelle verloren.
                    </p>
                  )}
                  <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
                    <span>{legs.length} Tipps · <span className={`font-bold ${oddsColorClass(comboStatus)}`}>@{totalOdds.toFixed(2).replace('.', ',')}</span></span>
                    {stake > 0 && comboStatus === 'pending' && <span>{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)} → <span className="font-bold text-gray-700 dark:text-gray-200">{potWin.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(potWin)}</span></span>}
                    {stake > 0 && comboStatus === 'won' && cb?.payout != null && <span>{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)} → <span className="font-bold text-green-600">+{cb.payout.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(cb.payout)}</span></span>}
                    {comboStatus === 'lost' && stake > 0 && <span className="text-red-500 line-through">{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)}</span>}
                  </div>
                  <div className="space-y-1">
                    {otherLegs.map(leg => {
                      const moot = leg.status === 'pending' && comboStatus === 'lost'
                      const lm = matchMap.get(leg.match_id)
                      const finished = lm?.status === 'finished' && lm.home_score != null
                      return (
                        <div key={leg.id} className={`flex items-start gap-1.5 text-xs py-0.5 ${moot ? 'opacity-50' : ''}`}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-1">
                              <span className="text-gray-400 dark:text-gray-500 text-[10px] truncate">{lm?.home_team?.short_name ?? lm?.home_team?.name ?? '?'} – {lm?.away_team?.short_name ?? lm?.away_team?.name ?? '?'}</span>
                              {finished && <span className="text-gray-400 dark:text-gray-500 text-[10px] font-bold flex-shrink-0">{lm!.home_score}:{lm!.away_score}</span>}
                            </div>
                            <div className="font-medium text-gray-800 dark:text-gray-200">{socialSelLabel(leg.market_type, leg.selection, playerNameMap)}</div>
                          </div>
                          <span className={`font-bold flex-shrink-0 ${oddsColorClass(leg.status)}`}>@{leg.odds_value.toFixed(2).replace('.', ',')}</span>
                        </div>
                      )
                    })}
                    {/* Special leg last, plain — same neutral row style as
                        every other leg above, no orange spotlighting. */}
                    <div className={`flex items-start gap-1.5 text-xs py-0.5 ${legMoot ? 'opacity-50' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <div className="text-gray-400 dark:text-gray-500 text-[10px] truncate">{specialLegTitle(specialLeg)}</div>
                        <div className="font-medium text-gray-800 dark:text-gray-200">{specialLegLabel(specialLeg)}</div>
                      </div>
                      <span className={`font-bold flex-shrink-0 ${oddsColorClass(specialLeg.status)}`}>@{specialLeg.odds_value.toFixed(2).replace('.', ',')}</span>
                    </div>
                  </div>
                </div>
              </details>
            )
          })}
        </div>
      )}

      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {matchdayMatches.map(match => {
          const matchKickedOff = new Date(match.match_date) <= now
          const count = betCountByMatch[match.id] ?? 0

          if (!matchKickedOff) {
            if (count === 0) return null
            return (
              <div key={match.id} className="px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">
                  <TeamLogo name={match.home_team?.name ?? '?'} size="sm" />
                  <span className="truncate">{match.home_team?.name ?? '?'}</span>
                  <span className="text-gray-400 dark:text-gray-500 text-xs">vs</span>
                  <span className="truncate">{match.away_team?.name ?? '?'}</span>
                  <TeamLogo name={match.away_team?.name ?? '?'} size="sm" />
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  🔒 {count} Wettschein{count !== 1 ? 'e' : ''} · sichtbar ab Anpfiff
                </p>
              </div>
            )
          }

          const singles = activeSocial
            .filter(b => !b.combo_id && b.match_id === match.id && b.market_type !== 'matchday_special')
            .sort((a, b) => b.odds_value - a.odds_value)
          const legsOnThisMatch = activeSocial.filter(b => b.combo_id && b.match_id === match.id && b.market_type !== 'matchday_special')
          const comboIdsHere = [...new Set(legsOnThisMatch.map(b => b.combo_id as string))]
            .sort((a, b) => {
              const oa = legsOnThisMatch.find(l => l.combo_id === a)?.odds_value ?? 0
              const ob = legsOnThisMatch.find(l => l.combo_id === b)?.odds_value ?? 0
              return ob - oa
            })
          if (singles.length === 0 && comboIdsHere.length === 0) return null

          return (
            <div key={match.id} className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-gray-100 flex-wrap">
                <TeamLogo name={match.home_team?.name ?? '?'} size="sm" />
                <span>{match.home_team?.name ?? '?'}</span>
                <span className="text-gray-400 dark:text-gray-500 text-xs flex-shrink-0">vs</span>
                <span>{match.away_team?.name ?? '?'}</span>
                <TeamLogo name={match.away_team?.name ?? '?'} size="sm" />
                {match.status === 'finished' && match.home_score != null && (
                  <span className="ml-auto text-xs font-black text-red-700 dark:text-red-400">{match.home_score}:{match.away_score}</span>
                )}
              </div>

              {singles.map(bet => {
                const stake = bet.stake ?? 0
                const potWin = Math.round(stake * bet.odds_value * 100) / 100
                const edgeCls = bet.status === 'won' ? 'border-l-green-500' : bet.status === 'lost' ? 'border-l-red-400' : 'border-l-yellow-400'
                return (
                  <details key={bet.id} className={`group rounded-lg bg-gray-50 dark:bg-gray-700/40 border-l-4 ${edgeCls} overflow-hidden`}>
                    <summary className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 cursor-pointer select-none list-none marker:hidden">
                      {renderAvatar(bet.user_id, 'w-4 h-4', 'bg-red-100 dark:bg-red-900/30', 'text-red-700 dark:text-red-400', 'text-[9px]')}
                      <span className="font-semibold text-gray-800 dark:text-gray-200 truncate flex-shrink-0 max-w-[9rem]">{nameOf(bet.user_id)}</span>
                      <span className="text-[9px] font-bold bg-gray-500 dark:bg-gray-600 text-white rounded px-1 py-0.5 flex-shrink-0">EINZEL</span>
                      <span className="truncate flex-1 min-w-0 text-gray-600 dark:text-gray-300">{socialSelLabel(bet.market_type, bet.selection, playerNameMap)}</span>
                      <span className={`font-bold flex-shrink-0 ${oddsColorClass(bet.status)}`}>@{bet.odds_value.toFixed(2).replace('.', ',')}</span>
                      <span className="text-gray-400 dark:text-gray-500 text-[10px] flex-shrink-0 transition-transform group-open:rotate-180">▾</span>
                    </summary>
                    <div className="px-2.5 pb-2 pt-1 border-t border-black/5 dark:border-white/5 text-[11px] text-gray-500 dark:text-gray-400">
                      {bet.status === 'pending' && <span>Einsatz: {stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)} → <span className="font-bold text-gray-700 dark:text-gray-200">{potWin.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(potWin)}</span></span>}
                      {bet.status === 'won' && <span>Einsatz: {stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)} → <span className="font-bold text-green-600">+{potWin.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(potWin)}</span></span>}
                      {bet.status === 'lost' && <span>Einsatz: <span className="text-red-500 line-through">{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)}</span></span>}
                    </div>
                  </details>
                )
              })}

              {comboIdsHere.map(comboId => {
                const legs = activeSocial.filter(b => b.combo_id === comboId)
                if (legs.length === 0) return null
                const owner = legs[0].user_id
                const cb = socialCombos[comboId]
                const totalOdds = cb?.total_odds ?? legs.reduce((acc, l) => acc * l.odds_value, 1)
                const stake = cb?.stake ?? 0
                const potWin = Math.round(stake * totalOdds * 100) / 100
                const comboStatus = comboStatusOf(comboId)
                const borderCls = comboStatus === 'won' ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20' : comboStatus === 'lost' ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20' : 'border-blue-100 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/10'
                const edgeCls = comboStatus === 'won' ? 'border-l-green-500' : comboStatus === 'lost' ? 'border-l-red-400' : 'border-l-yellow-400'
                // Prefer a REAL leg on this match over a Special leg that
                // happens to share the same match_id — a combo can contain
                // BOTH a genuine bet on the representative match itself AND
                // a Spieltag-Special leg (whose match_id is that same
                // representative match, purely as a technical FK anchor).
                // Picking the Special leg here would show its answer (e.g.
                // "Ja") as if it were this match's own tip.
                const ownLeg = legs.find(l => l.match_id === match.id && l.market_type !== 'matchday_special') ?? legs[0]
                const otherLegs = legs.filter(l => l.id !== ownLeg.id)
                const ownLegMoot = ownLeg.status === 'pending' && comboStatus === 'lost'
                const legWonButComboLost = ownLeg.status === 'won' && comboStatus === 'lost'

                const renderLeg = (leg: typeof ownLeg) => {
                  const moot = leg.status === 'pending' && comboStatus === 'lost'
                  // A Special leg's match_id is only its technical FK anchor — never
                  // show that match's teams for it, show the real Special instead.
                  if (leg.market_type === 'matchday_special') {
                    return (
                      <div key={leg.id} className={`flex items-start gap-1.5 text-xs py-0.5 ${moot ? 'opacity-50' : ''}`}>
                        <div className="flex-1 min-w-0">
                          <div className="text-gray-400 dark:text-gray-500 text-[10px] truncate">{specialLegTitle(leg)}</div>
                          <div className="font-medium text-gray-800 dark:text-gray-200">{specialLegLabel(leg)}</div>
                        </div>
                        <span className={`font-bold flex-shrink-0 ${oddsColorClass(leg.status)}`}>@{leg.odds_value.toFixed(2).replace('.', ',')}</span>
                      </div>
                    )
                  }
                  const lm = matchMap.get(leg.match_id)
                  const finished = lm?.status === 'finished' && lm.home_score != null
                  return (
                    <div key={leg.id} className={`flex items-start gap-1.5 text-xs py-0.5 ${moot ? 'opacity-50' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1">
                          <span className="text-gray-400 dark:text-gray-500 text-[10px] truncate">{lm?.home_team?.short_name ?? lm?.home_team?.name ?? '?'} – {lm?.away_team?.short_name ?? lm?.away_team?.name ?? '?'}</span>
                          {finished && <span className="text-gray-400 dark:text-gray-500 text-[10px] font-bold flex-shrink-0">{lm!.home_score}:{lm!.away_score}</span>}
                        </div>
                        <div className="font-medium text-gray-800 dark:text-gray-200">{socialSelLabel(leg.market_type, leg.selection, playerNameMap)}</div>
                      </div>
                      <span className={`font-bold flex-shrink-0 ${oddsColorClass(leg.status)}`}>@{leg.odds_value.toFixed(2).replace('.', ',')}</span>
                    </div>
                  )
                }

                if (comboFirstMatchId.get(comboId) !== match.id) {
                  return (
                    <details key={comboId} className={`group rounded-lg bg-gray-50 dark:bg-gray-700/40 border-l-4 ${edgeCls} overflow-hidden`}>
                      <summary className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 cursor-pointer select-none list-none marker:hidden">
                        {renderAvatar(owner, 'w-4 h-4', 'bg-blue-100 dark:bg-blue-900/30', 'text-blue-700 dark:text-blue-400', 'text-[9px]')}
                        <span className="font-semibold text-gray-800 dark:text-gray-200 truncate flex-shrink-0 max-w-[9rem]">{nameOf(owner)}</span>
                        <span className="text-[9px] font-bold bg-blue-600 text-white rounded px-1 py-0.5 flex-shrink-0">KOMBI</span>
                        <LegResultMark moot={ownLegMoot} />
                        <span className={`truncate flex-1 min-w-0 ${ownLegMoot ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300'}`}>
                          {ownLeg.market_type === 'matchday_special' ? specialLegLabel(ownLeg) : socialSelLabel(ownLeg.market_type, ownLeg.selection, playerNameMap)}
                        </span>
                        <span className={`font-bold flex-shrink-0 ${oddsColorClass(ownLeg.status)}`}>@{ownLeg.odds_value.toFixed(2).replace('.', ',')}</span>
                        <span className="text-gray-400 dark:text-gray-500 text-[10px] flex-shrink-0 transition-transform group-open:rotate-180">▾</span>
                      </summary>
                      <div className="px-2.5 pb-2 pt-1 border-t border-black/5 dark:border-white/5 space-y-1.5">
                        {ownLegMoot && (
                          <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                            Dieser Tipp ist noch offen, aber die Kombi ist bereits an anderer Stelle verloren.
                          </p>
                        )}
                        <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
                          <span>{legs.length} Tipps · <span className={`font-bold ${oddsColorClass(comboStatus)}`}>@{totalOdds.toFixed(2).replace('.', ',')}</span></span>
                          {stake > 0 && comboStatus === 'pending' && <span>{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)} → <span className="font-bold text-gray-700 dark:text-gray-200">{potWin.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(potWin)}</span></span>}
                          {stake > 0 && comboStatus === 'won' && cb?.payout != null && <span>{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)} → <span className="font-bold text-green-600">+{cb.payout.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(cb.payout)}</span></span>}
                          {comboStatus === 'lost' && stake > 0 && <span className="text-red-500 line-through">{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)}</span>}
                        </div>
                        <div className="space-y-1">
                          {legs.map(renderLeg)}
                        </div>
                      </div>
                    </details>
                  )
                }

                return (
                  <div key={comboId} className={`rounded-xl border overflow-hidden ${borderCls}`}>
                    <div className="flex items-center gap-2 px-3 pt-2">
                      {renderAvatar(owner, 'w-6 h-6', 'bg-blue-100 dark:bg-blue-900/30', 'text-blue-700 dark:text-blue-400', 'text-[10px]')}
                      <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate min-w-0 flex-1">{nameOf(owner)}</span>
                    </div>
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 px-3 pb-2 pt-0.5 text-[11px]">
                      <span className="text-gray-500 dark:text-gray-400">{legs.length} Tipps · <span className={`font-bold ${oddsColorClass(comboStatus)}`}>@{totalOdds.toFixed(2).replace('.', ',')}</span></span>
                      <div className="ml-auto text-right">
                        {stake > 0 && comboStatus === 'pending' && <span className="text-gray-500 dark:text-gray-400">{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)} → <span className="font-bold text-gray-700 dark:text-gray-200">{potWin.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(potWin)}</span></span>}
                        {stake > 0 && comboStatus === 'won' && cb?.payout != null && <span className="text-gray-500 dark:text-gray-400">{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)} → <span className="font-bold text-green-600">+{cb.payout.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(cb.payout)}</span></span>}
                        {comboStatus === 'lost' && stake > 0 && <span className="text-red-500 line-through">{stake.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {wildiLabel(stake)}</span>}
                      </div>
                    </div>
                    <div className="border-t border-black/5 dark:border-white/5 px-3 py-1.5">
                      {renderLeg(ownLeg)}
                      {legWonButComboLost && (
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 italic pl-4 pt-0.5">
                          Dieser Tipp war richtig, die Kombi ist aber an anderer Stelle verloren.
                        </p>
                      )}
                      {otherLegs.length > 0 && (
                        <details className="mt-0.5">
                          <summary className="text-[10px] text-blue-700 dark:text-blue-400 font-semibold cursor-pointer py-1 select-none">
                            +{otherLegs.length} weitere{otherLegs.length === 1 ? 'r' : ''} Tipp{otherLegs.length !== 1 ? 'e' : ''} in dieser Kombi
                          </summary>
                          <div className="space-y-1 pt-0.5">
                            {otherLegs.map(renderLeg)}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Deliberately NOT a colored dot — this marks the result of one leg inside a
// combo card. A plain colored dot here would duplicate the odds value's own
// color (oddsColorClass) shown right next to it in the same row — the
// redundant "double status dot" this component was extracted to remove. The
// one piece of information the odds color CAN'T carry on its own is "this
// leg is still open, but its combo already lost elsewhere" (a leg that's
// individually 'won' while the combo overall 'lost' is instead disambiguated
// via the italic caption next to it) — the neutral dash below covers that.
function LegResultMark({ moot }: { moot?: boolean }) {
  if (moot) return <span className="text-gray-400 dark:text-gray-500 font-bold text-[11px] leading-4 flex-shrink-0" aria-label="Nicht mehr relevant">–</span>
  return null
}
