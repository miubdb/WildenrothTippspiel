'use client'

import React, { useState } from 'react'
import { ShareCard, type ShareCardData } from './ShareCard'
import { WildiIcon, fmtWildi, wildiLabel } from '@/components/WildiIcon'
import { oddsColorClass } from '@/lib/betDisplay'
import { StornoChampDetailSheet } from '@/components/StornoChampDetailSheet'

export type RecapLegDetail = {
  matchName: string
  market: string
  selection: string
  odds: number
  status: 'won' | 'lost' | 'pending'
}

/** The concrete match + market + selection behind a single-bet award — only
 *  set when the award resolved to a single (non-combo) bet, since a combo's
 *  "one match" framing doesn't make sense (see UnluckyBastardCard's own
 *  per-leg breakdown for the combo case instead). */
export type RecapBetDetail = { matchName: string; market: string; selection: string }

export type RecapData = {
  spieltagskoenig: { name: string; profit: number } | null
  eierAusStahl: { name: string; odds: number; stake: number; payout: number; isCombo: boolean; legs?: number; bet?: RecapBetDetail } | null
  unluckyBastard: {
    name: string; odds: number; stake: number; legs: number; wouldHavePayout: number
    legDetails: RecapLegDetail[]
  } | null
  ergebnisOrakel: { name: string; score: string; stake: number; matchName?: string } | null
  griffInsKlo: { name: string; loss: number } | null
  betonmischer: { name: string; odds: number; stake: number; payout: number; isCombo: boolean; bet?: RecapBetDetail } | null
  onFire: { name: string; count: number; pnl: number } | null
  // Einzelwette-only (see lib/awards.ts) — never a combo, so no isCombo flag.
  grosserWurf: { name: string; amount: number; bet?: RecapBetDetail } | null
  torschuetzenKoenig: { name: string; count: number; playerName?: string } | null
  lastMinuteTipper: {
    name: string; gapMin: number; gapSec: number; matchName?: string
    /** Set for a single-bet win — the concrete market/selection, same
     *  formatting as every other award's bet detail (see RecapBetDetail). */
    bet?: RecapBetDetail
    /** The single bet's own odds — RecapBetDetail itself carries no odds
     *  (every other award already shows odds separately alongside it), but
     *  the whole point of this card is showing the concrete price too. */
    betOdds?: number
    /** Set for a combo win instead of `bet` — a combo has no single "match",
     *  so it's shown as "Ner-Kombi @X,XX" with its legs, like UnluckyBastard. */
    isCombo?: boolean
    comboOdds?: number
    comboLegs?: RecapLegDetail[]
  } | null
  stornoChamp: { name: string; net: number; label: string; betId: number | null; comboId: number | null } | null
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
  accentBg, accentBorder, accentText, onShare, onClick,
}: {
  emoji: string; title: string; name: string; value: React.ReactNode; detail?: string; sub?: string
  accentBg: string; accentBorder: string; accentText: string; onShare?: () => void; onClick?: () => void
}) {
  return (
    <div
      className={`relative rounded-2xl border ${accentBorder} ${accentBg} dark:bg-gray-800 dark:border-gray-700 px-4 py-3 ${onClick ? 'cursor-pointer hover:brightness-95 dark:hover:brightness-110 transition' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      {onShare && <ShareButton onClick={onShare} />}
      <div className="text-xl mb-1.5">{emoji}</div>
      <div className="text-[10px] text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wide">{title}</div>
      <div className="font-bold text-gray-900 dark:text-gray-100 text-sm mt-0.5 truncate">{name}</div>
      <div className={`font-black text-xl mt-1 flex items-center gap-1 ${accentText}`}>{value}</div>
      {detail && <div className="text-xs text-gray-600 dark:text-gray-300 font-medium mt-1 leading-snug">{detail}</div>}
      {sub && <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{sub}</div>}
      {onClick && <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 mt-1.5">Details ansehen →</div>}
    </div>
  )
}

function LastMinuteTipperCard({ lm }: { lm: NonNullable<RecapData['lastMinuteTipper']> }) {
  const gap = lm.gapSec < 60 ? `${lm.gapSec} Sek.` : `${lm.gapMin} Min.`
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-fuchsia-200 dark:border-fuchsia-900/50 overflow-hidden">
      <div className="px-4 py-3 bg-fuchsia-50 dark:bg-fuchsia-900/20 border-b border-fuchsia-100 dark:border-fuchsia-900/30 flex items-center gap-2.5">
        <span className="text-2xl">⏱️</span>
        <div>
          <div className="font-bold text-gray-900 dark:text-gray-100 text-sm">Last-Minute-Tipper: {lm.name}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{gap} vor Anpfiff · gewonnen</div>
        </div>
      </div>
      <div className="px-4 py-3">
        {lm.isCombo ? (
          <>
            <div className="font-bold text-gray-900 dark:text-gray-100 text-sm mb-2">
              {lm.comboLegs?.length ?? '?'}er-Kombi @{fmtOdds(lm.comboOdds ?? 0)}
            </div>
            <ul className="space-y-1">
              {(lm.comboLegs ?? []).map((l, i) => (
                <li key={i} className="text-xs text-gray-600 dark:text-gray-300">
                  · {l.matchName}: {l.market} – {l.selection}
                </li>
              ))}
            </ul>
          </>
        ) : lm.bet ? (
          <div className="text-sm">
            <div className="text-gray-500 dark:text-gray-400 text-xs">{lm.bet.matchName}</div>
            <div className="font-bold text-gray-900 dark:text-gray-100">
              {lm.bet.market}: {lm.bet.selection} <span className="text-fuchsia-600">@{fmtOdds(lm.betOdds ?? 0)}</span>
            </div>
          </div>
        ) : (
          lm.matchName && <div className="text-xs text-gray-500 dark:text-gray-400">{lm.matchName}</div>
        )}
      </div>
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
              {ub.legs}er-Kombi · <span className={`font-semibold ${oddsColorClass('lost')}`}>@{fmtOdds(ub.odds)}</span>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-[10px] text-gray-400 uppercase tracking-wide">Einsatz</div>
            <div className="font-bold text-gray-800 dark:text-gray-200 text-sm">{fmtAmt(ub.stake)} {wildiLabel(ub.stake)}</div>
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
                <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${leg.status === 'won' ? 'bg-green-500' : 'bg-red-400'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-gray-400 dark:text-gray-500 truncate text-[10px]">{leg.matchName}</div>
                  <div className={`font-semibold truncate ${leg.status === 'won' ? 'text-green-800 dark:text-green-300' : 'text-red-700 dark:text-red-400'}`}>
                    {leg.market}: {leg.selection}
                  </div>
                </div>
                <div className={`font-bold flex-shrink-0 ${oddsColorClass(leg.status)}`}>
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
            <div className="font-black text-green-600 dark:text-green-400 text-lg">+{fmtAmt(wouldHaveGained)} {wildiLabel(wouldHaveGained)}</div>
          </div>
          <div className="text-right text-xs text-gray-400 dark:text-gray-500">
            <div>Auszahlung</div>
            <div className="font-semibold">{fmtAmt(ub.wouldHavePayout)} {wildiLabel(ub.wouldHavePayout)}</div>
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
  const [stornoDetailOpen, setStornoDetailOpen] = useState(false)
  const { spieltagskoenig, eierAusStahl, unluckyBastard, ergebnisOrakel, griffInsKlo, betonmischer, onFire, grosserWurf, torschuetzenKoenig, lastMinuteTipper, stornoChamp } = data

  const hasAny = spieltagskoenig || eierAusStahl || unluckyBastard || ergebnisOrakel || griffInsKlo || betonmischer || onFire || grosserWurf || torschuetzenKoenig || lastMinuteTipper || stornoChamp
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
              onShare={() => setShare({ type: 'mvp', data: { matchday, name: spieltagskoenig.name, value: `+${fmtAmt(spieltagskoenig.profit)} ${wildiLabel(spieltagskoenig.profit)}`, subtitle: `${spieltagskoenig.name} ist Spieltagskönig` } })}
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
              detail={`Einsatz ${fmtAmt(eierAusStahl.stake)} ${wildiLabel(eierAusStahl.stake)} → +${fmtAmt(eierAusStahl.payout - eierAusStahl.stake)} ${wildiLabel(eierAusStahl.payout - eierAusStahl.stake)}${eierAusStahl.isCombo && eierAusStahl.legs ? ` · ${eierAusStahl.legs}er-Kombi` : ''}`}
              sub={eierAusStahl.bet ? `${eierAusStahl.bet.matchName} · ${eierAusStahl.bet.market}: ${eierAusStahl.bet.selection}` : undefined}
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
              emoji="🎯"
              title="Mehrfachtreffer"
              name={onFire.name}
              value={`${onFire.count} gewonnene Scheine · ${onFire.pnl >= 0 ? '+' : ''}${fmtAmt(onFire.pnl)} Wildis`}
              detail="Meiste Treffer am Spieltag"
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
              detail={`Einsatz ${fmtAmt(ergebnisOrakel.stake)} ${wildiLabel(ergebnisOrakel.stake)} · Exaktes Ergebnis`}
              sub={ergebnisOrakel.matchName}
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
              onShare={() => setShare({ type: 'pechvogel', data: { matchday, name: griffInsKlo.name, value: `-${fmtAmt(griffInsKlo.loss)} ${wildiLabel(griffInsKlo.loss)}`, subtitle: `${griffInsKlo.name} greift ins Klo` } })}
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
              detail={`Einsatz ${fmtAmt(betonmischer.stake)} ${wildiLabel(betonmischer.stake)} → +${fmtAmt(betonmischer.payout - betonmischer.stake)} ${wildiLabel(betonmischer.payout - betonmischer.stake)}`}
              sub={betonmischer.bet ? `${betonmischer.bet.matchName} · ${betonmischer.bet.market}: ${betonmischer.bet.selection}` : undefined}
              accentBg="bg-stone-50"
              accentBorder="border-stone-200"
              accentText="text-stone-600"
            />
          )}
        </div>
      )}

      {/* Row 4: Volltreffer + Torschützen-König */}
      {(grosserWurf || torschuetzenKoenig) && (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {grosserWurf && (
            <HighlightCard
              emoji="🎯"
              title="Volltreffer"
              name={grosserWurf.name}
              value={<>+{fmtAmt(grosserWurf.amount)} <WildiIcon size={20} /></>}
              detail="Höchster Gewinn mit einer Einzelwette am Spieltag"
              sub={grosserWurf.bet ? `${grosserWurf.bet.matchName} · ${grosserWurf.bet.market}: ${grosserWurf.bet.selection}` : undefined}
              accentBg="bg-emerald-50"
              accentBorder="border-emerald-200"
              accentText="text-emerald-600"
            />
          )}
          {torschuetzenKoenig && (
            <HighlightCard
              emoji="⚽"
              title="Torschützen-König"
              name={torschuetzenKoenig.name}
              value={`${torschuetzenKoenig.count}x`}
              detail={`${torschuetzenKoenig.count} richtige${torschuetzenKoenig.count === 1 ? 'r Torschützen-Tipp' : ' Torschützen-Tipps'}`}
              sub={torschuetzenKoenig.playerName}
              accentBg="bg-sky-50"
              accentBorder="border-sky-200"
              accentText="text-sky-600"
            />
          )}
        </div>
      )}

      {/* Row 4b: Last-Minute-Tipper — own full-width card so the actual bet
          (single market+selection+odds, or every combo leg) is fully
          readable instead of squeezed into the 2-column HighlightCard grid. */}
      {lastMinuteTipper && <LastMinuteTipperCard lm={lastMinuteTipper} />}

      {/* Row 5: Storno-Champ */}
      {stornoChamp && (
        <div className="grid gap-3 grid-cols-1">
          <HighlightCard
            emoji="🏆"
            title="Storno-Champ"
            name={stornoChamp.name}
            value={<>+{fmtAmt(stornoChamp.net)} <WildiIcon size={20} /> verschenkt</>}
            detail="Diese stornierte Wette wäre aufgegangen"
            sub={stornoChamp.label}
            accentBg="bg-orange-50"
            accentBorder="border-orange-200"
            accentText="text-orange-600"
            onClick={(stornoChamp.betId != null || stornoChamp.comboId != null) ? () => setStornoDetailOpen(true) : undefined}
          />
        </div>
      )}

      {share && <ShareModal share={share} onClose={() => setShare(null)} />}
      {stornoDetailOpen && stornoChamp && (
        <StornoChampDetailSheet
          betId={stornoChamp.betId}
          comboId={stornoChamp.comboId}
          onClose={() => setStornoDetailOpen(false)}
        />
      )}
    </div>
  )
}
