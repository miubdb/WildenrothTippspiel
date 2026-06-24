'use client'

import React, { useState } from 'react'
import { ShareCard, type ShareCardData } from './ShareCard'
import { WildiIcon, fmtWildi } from '@/components/WildiIcon'

export type RecapLegDetail = {
  matchName: string
  market: string
  selection: string
  odds: number
  status: 'won' | 'lost' | 'pending'
}

export type RecapData = {
  spieltagskoenig: { name: string; profit: number } | null
  eierAusStahl: { name: string; odds: number; stake: number; payout: number; isCombo: boolean; legs?: number } | null
  unluckyBastard: {
    name: string; odds: number; stake: number; legs: number; wouldHavePayout: number
    legDetails: RecapLegDetail[]
  } | null
  ergebnisOrakel: { name: string; score: string; stake: number } | null
  griffInsKlo: { name: string; loss: number; isCombo: boolean } | null
  betonmischer: { name: string; odds: number; stake: number; payout: number; isCombo: boolean } | null
  onFire: { name: string; count: number; pnl: number } | null
}

function fmtAmt(n: number) { return fmtWildi(n) }
function fmtOdds(n: number) { return n.toFixed(2).replace('.', ',') }

function nameHash(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h
}
function pickTpl(tpls: string[], name: string, odds?: number): string {
  return tpls[nameHash(name) % tpls.length]
    .replace('{name}', name)
    .replace('{odds}', odds != null ? fmtOdds(odds) : '')
}

function HighlightCard({
  emoji, title, name, value, detail, sub,
  accentBg, accentBorder, accentText, onShare,
}: {
  emoji: string; title: string; name: string; value: React.ReactNode; detail?: string; sub?: string
  accentBg: string; accentBorder: string; accentText: string; onShare?: () => void
}) {
  return (
    <div className={`relative rounded-2xl border ${accentBorder} ${accentBg} dark:bg-gray-800 dark:border-gray-700 px-4 py-3`}>
      {onShare && <ShareButton onClick={onShare} />}
      <div className="text-xl mb-1.5">{emoji}</div>
      <div className="text-[10px] text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wide">{title}</div>
      <div className="font-bold text-gray-900 dark:text-gray-100 text-sm mt-0.5 truncate">{name}</div>
      <div className={`font-black text-xl mt-1 flex items-center gap-1 ${accentText}`}>{value}</div>
      {detail && <div className="text-xs text-gray-600 dark:text-gray-300 font-medium mt-1 leading-snug">{detail}</div>}
      {sub && <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function UnluckyBastardCard({ ub }: { ub: NonNullable<RecapData['unluckyBastard']> }) {
  const wouldHaveGained = ub.wouldHavePayout - ub.stake
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-orange-200 dark:border-orange-900/50 overflow-hidden">
      <div className="px-4 py-3 bg-orange-50 dark:bg-orange-900/20 border-b border-orange-100 dark:border-orange-900/30 flex items-center gap-2.5">
        <span className="text-2xl">😭</span>
        <div>
          <div className="font-bold text-gray-900 dark:text-gray-100 text-sm">Unlucky Bastard</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Nur 1 Tipp daneben – beinahe der Hit des Spieltags</div>
        </div>
      </div>
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-bold text-gray-900 dark:text-gray-100">{ub.name}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {ub.legs}er-Kombi · @{fmtOdds(ub.odds)}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-[10px] text-gray-400 uppercase tracking-wide">Einsatz</div>
            <div className="font-bold text-gray-800 dark:text-gray-200 text-sm">{fmtAmt(ub.stake)} Wildis</div>
          </div>
        </div>
        {ub.legDetails.length > 0 && (
          <div className="space-y-1.5">
            {ub.legDetails.map((leg, i) => (
              <div
                key={i}
                className={`flex items-start gap-2.5 rounded-xl px-3 py-2 text-xs ${
                  leg.status === 'won'
                    ? 'bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900/30'
                    : 'bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30'
                }`}
              >
                <span className="text-sm flex-shrink-0 mt-0.5">{leg.status === 'won' ? '✅' : '❌'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-gray-400 dark:text-gray-500 truncate text-[10px]">{leg.matchName}</div>
                  <div className={`font-semibold truncate ${leg.status === 'won' ? 'text-green-800 dark:text-green-300' : 'text-red-700 dark:text-red-400'}`}>
                    {leg.market}: {leg.selection}
                  </div>
                </div>
                <div className={`font-bold flex-shrink-0 ${leg.status === 'won' ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  @{fmtOdds(leg.odds)}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900/30 rounded-xl px-3 py-2.5 flex items-center gap-3">
          <span className="text-2xl">😭</span>
          <div className="flex-1">
            <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">Wäre geworden</div>
            <div className="font-black text-green-600 dark:text-green-400 text-lg">+{fmtAmt(wouldHaveGained)} Wildis</div>
          </div>
          <div className="text-right text-xs text-gray-400 dark:text-gray-500">
            <div>Auszahlung</div>
            <div className="font-semibold">{fmtAmt(ub.wouldHavePayout)} Wildis</div>
          </div>
        </div>
      </div>
    </div>
  )
}

type ShareState = { type: 'mvp' | 'risky' | 'pechvogel' | 'ranking'; data: ShareCardData } | null

function ShareButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Teilen"
      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/80 dark:bg-gray-700/80 flex items-center justify-center text-sm shadow-sm hover:scale-110 transition"
    >
      📤
    </button>
  )
}

function ShareModal({ share, onClose }: { share: NonNullable<ShareState>; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="flex flex-col items-center gap-3" onClick={e => e.stopPropagation()}>
        <ShareCard type={share.type} data={share.data} />
        <p className="text-white text-xs text-center">Screenshot machen und teilen 📱</p>
        <button
          type="button"
          onClick={onClose}
          className="px-5 py-2 rounded-full bg-white text-gray-900 font-semibold text-sm"
        >
          Schließen
        </button>
      </div>
    </div>
  )
}

export function MatchdayRecap({ data, matchday }: { data: RecapData; matchday: number }) {
  const [share, setShare] = useState<ShareState>(null)
  const { spieltagskoenig, eierAusStahl, unluckyBastard, ergebnisOrakel, griffInsKlo, betonmischer, onFire } = data

  const hasAny = spieltagskoenig || eierAusStahl || unluckyBastard || ergebnisOrakel || griffInsKlo || betonmischer || onFire
  if (!hasAny) return null

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="bg-red-700 text-white rounded-2xl px-5 py-4 shadow-sm">
        <div className="text-red-200 text-xs font-medium uppercase tracking-wide">{matchday}. Spieltag</div>
        <div className="text-2xl font-black mt-0.5">Pokale des Spieltags</div>
        <div className="text-red-200 text-sm mt-1">Die Helden (und Pechvögel) der Woche</div>
      </div>

      {/* Row 1: Spieltagskönig + Eier aus Stahl */}
      {(spieltagskoenig || eierAusStahl) && (
        <div className={`grid gap-3 ${spieltagskoenig && eierAusStahl ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {spieltagskoenig && (
            <HighlightCard
              emoji="🏆"
              title="Spieltagskönig"
              name={spieltagskoenig.name}
              value={<>+{fmtAmt(spieltagskoenig.profit)} <WildiIcon size={20} /></>}
              detail={pickTpl(['{name} räumt heute richtig ab.', '{name} lacht sich ins Fäustchen.'], spieltagskoenig.name)}
              onShare={() => setShare({ type: 'mvp', data: { matchday, name: spieltagskoenig.name, value: `+${fmtAmt(spieltagskoenig.profit)} Wildis`, subtitle: `${spieltagskoenig.name} ist Spieltagskönig` } })}
              accentBg="bg-yellow-50"
              accentBorder="border-yellow-200"
              accentText="text-yellow-600"
            />
          )}
          {eierAusStahl && (
            <HighlightCard
              emoji="🥚"
              title="Eier aus Stahl"
              name={eierAusStahl.name}
              value={`@${fmtOdds(eierAusStahl.odds)}`}
              detail={`Einsatz ${fmtAmt(eierAusStahl.stake)} Wildis → +${fmtAmt(eierAusStahl.payout - eierAusStahl.stake)} Wildis${eierAusStahl.isCombo && eierAusStahl.legs ? ` · ${eierAusStahl.legs}er-Kombi` : ''}`}
              onShare={() => setShare({ type: 'risky', data: { matchday, name: eierAusStahl.name, value: `@${fmtOdds(eierAusStahl.odds)}`, subtitle: `${eierAusStahl.name} hatte Eier aus Stahl` } })}
              accentBg="bg-purple-50"
              accentBorder="border-purple-200"
              accentText="text-purple-700"
            />
          )}
        </div>
      )}

      {/* Unlucky Bastard */}
      {unluckyBastard && <UnluckyBastardCard ub={unluckyBastard} />}

      {/* Row 2: On Fire + Ergebnis-Orakel */}
      {(onFire || ergebnisOrakel) && (
        <div className={`grid gap-3 ${onFire && ergebnisOrakel ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {onFire && (
            <HighlightCard
              emoji="🔥"
              title="On Fire"
              name={onFire.name}
              value={`${onFire.count}x gewonnen`}
              detail={`Spieltagssaldo: ${onFire.pnl >= 0 ? '+' : ''}${fmtAmt(onFire.pnl)} Wildis`}
              accentBg="bg-orange-50"
              accentBorder="border-orange-200"
              accentText="text-orange-600"
            />
          )}
          {ergebnisOrakel && (
            <HighlightCard
              emoji="🔮"
              title="Ergebnis-Orakel"
              name={ergebnisOrakel.name}
              value={ergebnisOrakel.score}
              detail={`Einsatz ${fmtAmt(ergebnisOrakel.stake)} Wildis · Exaktes Ergebnis`}
              accentBg="bg-indigo-50"
              accentBorder="border-indigo-200"
              accentText="text-indigo-700"
            />
          )}
        </div>
      )}

      {/* Row 3: Griff ins Klo + Betonmischer */}
      {(griffInsKlo || betonmischer) && (
        <div className={`grid gap-3 ${griffInsKlo && betonmischer ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {griffInsKlo && (
            <HighlightCard
              emoji="🚽"
              title="Griff ins Klo"
              name={griffInsKlo.name}
              value={<>-{fmtAmt(griffInsKlo.loss)} <WildiIcon size={20} /></>}
              detail={pickTpl(['{name} greift daneben.', 'Heute ist nicht {name}s Tag.'], griffInsKlo.name)}
              onShare={() => setShare({ type: 'pechvogel', data: { matchday, name: griffInsKlo.name, value: `-${fmtAmt(griffInsKlo.loss)} Wildis`, subtitle: `${griffInsKlo.name} greift ins Klo` } })}
              accentBg="bg-red-50"
              accentBorder="border-red-200"
              accentText="text-red-600"
            />
          )}
          {betonmischer && (
            <HighlightCard
              emoji="🧱"
              title="Betonmischer"
              name={betonmischer.name}
              value={`@${fmtOdds(betonmischer.odds)}`}
              detail={`Einsatz ${fmtAmt(betonmischer.stake)} Wildis → +${fmtAmt(betonmischer.payout - betonmischer.stake)} Wildis`}
              accentBg="bg-stone-50"
              accentBorder="border-stone-200"
              accentText="text-stone-600"
            />
          )}
        </div>
      )}

      {share && <ShareModal share={share} onClose={() => setShare(null)} />}
    </div>
  )
}
