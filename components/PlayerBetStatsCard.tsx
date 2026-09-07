import { fmtWildi } from '@/components/WildiIcon'
import type { BalancePoint, UserBetStats } from '@/lib/betStats'
import { MIN_SETTLED_FOR_STATS_CARD } from '@/lib/betStats'

/**
 * Öffentliche Wett-Statistiken eines Spielers — dieselbe Komponente für das
 * eigene Profil UND ein fremdes Profil über die Rangliste (Aufgabe: "UI
 * möglichst dieselbe Komponente verwenden wie im eigenen Profil"). Zeigt
 * ausschließlich Wett-Kennzahlen, die ohnehin über "Alle Tipps" öffentlich
 * einsehbar sind — keine privaten Kontodaten wie Guthaben oder E-Mail.
 */
export function PlayerBetSummary({ stats }: { stats: UserBetStats }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-700">
        <h2 className="font-bold text-gray-900 dark:text-gray-100">Statistiken</h2>
      </div>
      <div className="grid grid-cols-4 divide-x divide-gray-100 dark:divide-gray-700">
        <StatCell label="Gesamt" value={stats.totalSlips} />
        <StatCell label="Gewonnen" value={stats.won} color="text-green-600" />
        <StatCell label="Verloren" value={stats.lost} color="text-red-600" />
        <StatCell label="Offen" value={stats.pending} color="text-yellow-600" />
      </div>
      <div className="grid grid-cols-2 divide-x divide-gray-100 dark:divide-gray-700 border-t border-gray-100 dark:border-gray-700">
        <div className="px-4 py-3 text-center">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Eingesetzt</div>
          <div className="font-bold text-gray-900 dark:text-gray-100 text-sm">{fmtWildi(stats.totalStaked)} Wildis</div>
        </div>
        <div className="px-4 py-3 text-center">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Ausgezahlt</div>
          <div className="font-bold text-green-600 text-sm">{fmtWildi(stats.totalPayout)} Wildis</div>
        </div>
      </div>
    </div>
  )
}

/** Realisierte Bilanz (nur abgeschlossene Scheine) getrennt von aktuell
 *  gebundenem Einsatz und möglicher Auszahlung offener Scheine — offene
 *  Wetten zählen bewusst nicht als Verlust (siehe lib/betStats.ts). */
export function PlayerRealizedBalance({ stats }: { stats: UserBetStats }) {
  if (stats.settledCount === 0 && stats.pending === 0) return null
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-700">
        <h2 className="font-bold text-gray-900 dark:text-gray-100">Wettbilanz</h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Nur abgeschlossene Wettscheine — offene zählen nicht als Verlust</p>
      </div>
      <div className="px-4 py-3 flex items-center justify-between">
        <span className="text-sm text-gray-600 dark:text-gray-300">Realisierte Bilanz ({stats.settledCount} Scheine)</span>
        <span className={`text-lg font-black ${stats.realizedNet > 0 ? 'text-green-600' : stats.realizedNet < 0 ? 'text-red-600' : 'text-gray-900 dark:text-gray-100'}`}>
          {stats.realizedNet >= 0 ? '+' : ''}{fmtWildi(stats.realizedNet)} Wildis
        </span>
      </div>
      {stats.roi != null && (
        <div className="px-4 pb-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>ROI</span>
          <span className={stats.roi >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
            {stats.roi >= 0 ? '+' : ''}{stats.roi.toFixed(1).replace('.', ',')} %
          </span>
        </div>
      )}
      {stats.pending > 0 && (
        <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-700 grid grid-cols-2 gap-2 bg-amber-50/50 dark:bg-amber-900/10">
          <div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">Gebunden in {stats.pending} offenen Scheinen</div>
            <div className="text-sm font-bold text-gray-800 dark:text-gray-100">{fmtWildi(stats.pendingStaked)} Wildis</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-gray-500 dark:text-gray-400">Mögliche Auszahlung</div>
            <div className="text-sm font-bold text-amber-700 dark:text-amber-400">{fmtWildi(stats.pendingPossiblePayout)} Wildis</div>
          </div>
        </div>
      )}
    </div>
  )
}

export function PlayerStatsTiles({ stats }: { stats: UserBetStats }) {
  if (stats.settledCount < MIN_SETTLED_FOR_STATS_CARD) return null
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-700">
        <h2 className="font-bold text-gray-900 dark:text-gray-100">Spieler-Stats</h2>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-gray-100 dark:divide-gray-700">
        {stats.hitRate !== null && (
          <StatTile
            emoji="🎯"
            label="Trefferquote"
            value={`${stats.hitRate} %`}
            sub={`${stats.won}/${stats.settledCount} Wetten`}
            color={stats.hitRate >= 55 ? 'text-green-600' : stats.hitRate >= 40 ? 'text-amber-600' : 'text-red-600'}
          />
        )}
        {stats.bestWinAmount != null && (
          <StatTile
            emoji="🏅"
            label="Bester Gewinn"
            value={`+${fmtWildi(stats.bestWinAmount)} Wildis`}
            sub={stats.bestWinType === 'combo' ? 'Kombiwette' : 'Einzelwette'}
            color="text-green-600"
          />
        )}
        {stats.favoriteMarket && (
          <StatTile
            emoji="📊"
            label="Lieblingsmarkt"
            value={stats.favoriteMarket.label}
            sub={`${stats.favoriteMarket.ticks}× getippt`}
            color="text-blue-700"
          />
        )}
        {stats.comboRate !== null && (
          <StatTile
            emoji="🔗"
            label="Kombi-Anteil"
            value={`${stats.comboRate} %`}
            sub={`${stats.comboSlips} Kombischeine`}
            color="text-purple-700"
          />
        )}
        {stats.riskyWon + stats.riskyLost > 0 && (
          <StatTile
            emoji="🎲"
            label="Risky-Bilanz"
            value={`${stats.riskyWon}W / ${stats.riskyLost}V`}
            sub="Risky-Slot des Spieltags"
            color={stats.riskyWon > stats.riskyLost ? 'text-green-600' : 'text-red-600'}
          />
        )}
        {stats.avgOdds != null && (
          <StatTile emoji="📈" label="Ø Quote" value={`@${stats.avgOdds.toFixed(2).replace('.', ',')}`} sub="abgeschlossene Scheine" color="text-gray-700 dark:text-gray-200" />
        )}
        {stats.highestWonOdds != null && (
          <StatTile emoji="⚡" label="Höchste gewonnene Quote" value={`@${stats.highestWonOdds.toFixed(2).replace('.', ',')}`} sub={stats.avgWinningOdds != null ? `Ø Gewinnquote @${stats.avgWinningOdds.toFixed(2).replace('.', ',')}` : ''} color="text-gray-700 dark:text-gray-200" />
        )}
        {stats.longestWinStreak.length >= 2 && (
          <StatTile emoji="🔥" label="Längste Siegesserie" value={`${stats.longestWinStreak.length}×`} sub="in Folge gewonnen" color="text-green-600" />
        )}
        {stats.longestLossStreak.length >= 2 && (
          <StatTile emoji="🥶" label="Längste Verlustserie" value={`${stats.longestLossStreak.length}×`} sub="in Folge verloren" color="text-red-600" />
        )}
      </div>
      {stats.recentForm.length >= 3 && (
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">Form (letzte {stats.recentForm.length})</span>
          <div className="flex gap-1 ml-auto">
            {stats.recentForm.map((r, i) => (
              <span key={i} className={`w-2 h-2 rounded-full ${r === 'won' ? 'bg-green-500' : 'bg-red-400'}`} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** "Mehr Statistiken" — aufklappbar, Markt-Performance mit Mindeststichprobe. */
export function PlayerMoreStats({ stats }: { stats: UserBetStats }) {
  const qualifying = stats.marketBreakdown.filter(m => m.won + m.lost >= 5)
  const bestMarket = [...qualifying].sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1))[0] ?? null
  const worstMarket = qualifying.length > 1
    ? [...qualifying].sort((a, b) => (a.hitRate ?? 101) - (b.hitRate ?? 101))[0]
    : null

  if (stats.marketBreakdown.length === 0) return null

  return (
    <details className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
      <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-gray-700 dark:text-gray-200 list-none flex items-center justify-between">
        <span>Mehr Statistiken</span>
        <span className="text-xs text-gray-400">▼</span>
      </summary>
      <div className="px-4 pb-4 pt-1 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Einzel-ROI" value={stats.singlePerformance.roi} sub={`${stats.singlePerformance.won}/${stats.singlePerformance.settled} Einzel`} />
          <MiniStat label="Kombi-ROI" value={stats.comboPerformance.roi} sub={`${stats.comboPerformance.won}/${stats.comboPerformance.settled} Kombis`} />
        </div>

        {bestMarket ? (
          <MiniStat label="Bester Markt" value={bestMarket.hitRate} sub={`${bestMarket.label} · ${bestMarket.won}/${bestMarket.won + bestMarket.lost}`} isRate />
        ) : (
          <p className="text-[11px] text-gray-400 dark:text-gray-500">Bester Markt: noch nicht genügend Daten (mind. 5 abgeschlossene Tipps pro Markt nötig).</p>
        )}
        {worstMarket && (
          <MiniStat label="Schwächster Markt" value={worstMarket.hitRate} sub={`${worstMarket.label} · ${worstMarket.won}/${worstMarket.won + worstMarket.lost}`} isRate />
        )}

        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Alle Märkte (Tipps, jedes Kombi-Bein zählt einzeln)</div>
          <div className="space-y-1">
            {stats.marketBreakdown.map(m => (
              <div key={m.marketType} className="flex items-center justify-between text-xs">
                <span className="text-gray-700 dark:text-gray-300">{m.label}</span>
                <span className="text-gray-400 dark:text-gray-500">
                  {m.ticks}× {m.hitRate != null && <span className="ml-1">· {m.hitRate}% ({m.won}/{m.won + m.lost})</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </details>
  )
}

function MiniStat({ label, value, sub, isRate }: { label: string; value: number | null; sub: string; isRate?: boolean }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-700/40 rounded-xl px-3 py-2">
      <div className="text-[10px] text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-sm font-black ${value == null ? 'text-gray-400' : value >= 0 ? 'text-green-600' : 'text-red-600'}`}>
        {value == null ? '—' : isRate ? `${value} %` : `${value >= 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')} %`}
      </div>
      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{sub}</div>
    </div>
  )
}

function StatTile({ emoji, label, value, sub, color }: { emoji: string; label: string; value: string; sub: string; color: string }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-base">{emoji}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      </div>
      <div className={`text-sm font-black ${color}`}>{value}</div>
      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{sub}</div>
    </div>
  )
}

function StatCell({ label, value, color = 'text-gray-900 dark:text-gray-100' }: { label: string; value: number; color?: string }) {
  return (
    <div className="px-2 py-3 text-center">
      <div className={`text-lg font-black ${color}`}>{value}</div>
      <div className="text-xs text-gray-400 dark:text-gray-500">{label}</div>
    </div>
  )
}

export function BalanceHistoryChart({ points, currentLabel }: { points: BalancePoint[]; currentLabel: string }) {
  if (points.length < 2) return null
  const W = 320
  const H = 72
  const pad = 4
  const values = points.map(p => p.balance)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const xs = points.map((_, i) => pad + (i / (points.length - 1)) * (W - 2 * pad))
  const ys = values.map(v => H - pad - ((v - min) / range) * (H - 2 * pad))

  const pathD = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')
  const fillD = `${pathD} L${xs[xs.length - 1].toFixed(1)},${H} L${xs[0].toFixed(1)},${H} Z`

  const start = values[0]
  const end = values[values.length - 1]
  const isUp = end >= start
  const color = isUp ? '#16a34a' : '#dc2626'
  const fillColor = isUp ? '#dcfce7' : '#fee2e2'
  const baseline = H - pad - ((start - min) / range) * (H - 2 * pad)

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        <line x1={pad} y1={baseline.toFixed(1)} x2={W - pad} y2={baseline.toFixed(1)} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4,3" />
        <path d={fillD} fill={fillColor} opacity="0.5" />
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={xs[xs.length - 1].toFixed(1)} cy={ys[ys.length - 1].toFixed(1)} r="3" fill={color} />
      </svg>
      <div className="flex justify-between text-xs text-gray-400 mt-1 px-1">
        <span>Start: {fmtWildi(start)} Wildis</span>
        <span className={isUp ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
          {currentLabel}: {fmtWildi(end)} Wildis
        </span>
      </div>
    </div>
  )
}
