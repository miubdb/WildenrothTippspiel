import { fmtWildi } from '@/components/WildiIcon'
import type { BalancePoint, UserBetStats } from '@/lib/betStats'
import { MIN_SETTLED_FOR_STATS_CARD } from '@/lib/betStats'

/**
 * Öffentliche Wett-Statistiken eines Spielers — dieselbe Komponente für das
 * eigene Profil UND ein fremdes Profil über die Rangliste (Aufgabe: "UI
 * möglichst dieselbe Komponente verwenden wie im eigenen Profil"). Zeigt
 * ausschließlich Wett-Kennzahlen, die ohnehin über "Alle Tipps" öffentlich
 * einsehbar sind — keine privaten Kontodaten wie Guthaben oder E-Mail.
 *
 * `isOwnProfile` blendet auf einem fremden Profil alles aus, woraus sich
 * ableiten ließe, wie viel jemand aktuell in noch offenen (nicht
 * angepfiffenen) Scheinen gebunden hat: die "Offen"-Kachel entfällt und
 * "Eingesetzt" zeigt nur den Einsatz bereits abgeschlossener Scheine, nicht
 * `totalStaked` (das offene Einsätze mit einrechnet). Historische,
 * abgeschlossene Zahlen (Gewonnen/Verloren/Ausgezahlt) bleiben unverändert
 * sichtbar — die sind über "Alle Tipps" ohnehin öffentlich.
 */
export function PlayerBetSummary({ stats, isOwnProfile }: { stats: UserBetStats; isOwnProfile: boolean }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-700">
        <h2 className="font-bold text-gray-900 dark:text-gray-100">Statistiken</h2>
      </div>
      <div className={`grid ${isOwnProfile ? 'grid-cols-4' : 'grid-cols-3'} divide-x divide-gray-100 dark:divide-gray-700`}>
        <StatCell label="Gesamt" value={isOwnProfile ? stats.totalSlips : stats.settledCount} />
        <StatCell label="Gewonnen" value={stats.won} color="text-green-600" />
        <StatCell label="Verloren" value={stats.lost} color="text-red-600" />
        {isOwnProfile && <StatCell label="Offen" value={stats.pending} color="text-yellow-600" />}
      </div>
      <div className="grid grid-cols-2 divide-x divide-gray-100 dark:divide-gray-700 border-t border-gray-100 dark:border-gray-700">
        <div className="px-4 py-3 text-center">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Eingesetzt</div>
          <div className="font-bold text-gray-900 dark:text-gray-100 text-sm">{fmtWildi(isOwnProfile ? stats.totalStaked : stats.settledStaked)} Wildis</div>
        </div>
        <div className="px-4 py-3 text-center">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Ausgezahlt</div>
          <div className="font-bold text-green-600 text-sm">{fmtWildi(stats.totalPayout)} Wildis</div>
        </div>
      </div>
    </div>
  )
}

/**
 * ROI-Karte (nur abgeschlossene Scheine) — die Netto-Wettbilanz selbst wird
 * hier bewusst NICHT nochmal angezeigt, die steht schon prominent oben auf
 * der Profil-/Spielerseite ("Wettbilanz"-Kachel); eine zweite Darstellung
 * derselben Zahl wäre reine Wiederholung.
 *
 * Gebundener Einsatz und mögliche Auszahlung offener Scheine sind PRIVAT:
 * bis zum Anpfiff darf niemand außer dem Spieler selbst ableiten können, wie
 * viel er aktuell gewettet hat. `isOwnProfile` steuert das zentral — kein
 * zweiter Berechnungspfad, dieselbe Komponente für beide Fälle.
 */
export function PlayerRealizedBalance({ stats, isOwnProfile }: { stats: UserBetStats; isOwnProfile: boolean }) {
  if (stats.roi == null && (!isOwnProfile || stats.pending === 0)) return null
  const roiAmount = stats.roi != null ? Math.abs(stats.roi).toFixed(1).replace('.', ',') : null
  const roiMeaning = stats.roi != null
    ? stats.roi >= 0
      ? `Pro 100 eingesetzten Wildis hast du bei abgeschlossenen Wetten im Schnitt ${roiAmount} Wildis Gewinn erzielt.`
      : `Pro 100 eingesetzten Wildis hast du bei abgeschlossenen Wetten im Schnitt ${roiAmount} Wildis verloren.`
    : null
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
      {stats.roi != null && (
        <details className="px-4 py-3 group">
          <summary className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-300 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-1.5 font-bold text-gray-900 dark:text-gray-100">
              ROI
              <span className="w-3.5 h-3.5 rounded-full bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-300 text-[9px] font-bold flex items-center justify-center">i</span>
            </span>
            <span className={`text-lg font-black ${stats.roi >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {stats.roi >= 0 ? '+' : ''}{stats.roi.toFixed(1).replace('.', ',')} %
            </span>
          </summary>
          <div className="mt-2 bg-gray-50 dark:bg-gray-700/40 rounded-lg px-3 py-2 text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed">
            <span className="font-semibold">Dein ROI beträgt {stats.roi >= 0 ? '+' : ''}{stats.roi.toFixed(1).replace('.', ',')} %.</span> Das bedeutet: {roiMeaning}
            <br /><br />
            Formel: (Auszahlung − Einsatz) ÷ Einsatz × 100 — nur abgeschlossene Wetten zählen, offene Wetten gehen nicht als Verlust ein. ROI ist nicht dasselbe wie die Trefferquote.
          </div>
        </details>
      )}
      {isOwnProfile && stats.pending > 0 && (
        <div className={`px-4 py-2.5 grid grid-cols-2 gap-2 bg-amber-50/50 dark:bg-amber-900/10 ${stats.roi != null ? 'border-t border-gray-100 dark:border-gray-700' : ''}`}>
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
          <StatTile emoji="⚡" label="Höchste gewonnene Quote" value={`@${stats.highestWonOdds.toFixed(2).replace('.', ',')}`} sub="bisher bester Treffer" color="text-gray-700 dark:text-gray-200" />
        )}
        {stats.avgWinningOdds != null && (
          <StatTile emoji="📐" label="Ø Gewinnquote" value={`@${stats.avgWinningOdds.toFixed(2).replace('.', ',')}`} sub="Ø Quote gewonnener Scheine" color="text-gray-700 dark:text-gray-200" />
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
  const H = 84
  const pad = 4
  const chartH = 60 // Platz für die Spieltag-Beschriftung unter der Kurve lassen
  const values = points.map(p => p.balance)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const xs = points.map((_, i) => pad + (i / (points.length - 1)) * (W - 2 * pad))
  const ys = values.map(v => chartH - pad - ((v - min) / range) * (chartH - 2 * pad))

  const pathD = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')
  const fillD = `${pathD} L${xs[xs.length - 1].toFixed(1)},${chartH} L${xs[0].toFixed(1)},${chartH} Z`

  const start = values[0]
  const end = values[values.length - 1]
  const isUp = end >= start
  const color = isUp ? '#16a34a' : '#dc2626'
  const fillColor = isUp ? '#dcfce7' : '#fee2e2'
  const baseline = chartH - pad - ((start - min) / range) * (chartH - 2 * pad)

  // Punkt-Label: "ST N" für Spieltage, "Start"/"Sonstiges" ausgeschrieben nur
  // wenn Platz ist (wenige Punkte), sonst kompakt nur die Zahl.
  const compact = points.length > 6
  const pointLabel = (p: BalancePoint) => {
    if (p.matchday != null) return compact ? String(p.matchday) : `ST ${p.matchday}`
    if (p.label === 'Start') return compact ? '' : 'Start'
    return compact ? '±' : 'Sonst.'
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        <line x1={pad} y1={baseline.toFixed(1)} x2={W - pad} y2={baseline.toFixed(1)} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4,3" />
        <path d={fillD} fill={fillColor} opacity="0.5" />
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {xs.map((x, i) => (
          <circle key={i} cx={x.toFixed(1)} cy={ys[i].toFixed(1)} r={i === xs.length - 1 ? 3 : 1.5} fill={i === xs.length - 1 ? color : '#9ca3af'} />
        ))}
        {points.map((p, i) => (
          <text key={i} x={xs[i].toFixed(1)} y={chartH + 12} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className="fill-gray-400 dark:fill-gray-500" style={{ fontSize: 8 }}>
            {pointLabel(p)}
          </text>
        ))}
      </svg>
      <div className="flex justify-between text-xs text-gray-400 mt-0.5 px-1">
        <span>Start: {fmtWildi(start)} Wildis</span>
        <span className={isUp ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
          {currentLabel}: {fmtWildi(end)} Wildis
        </span>
      </div>
    </div>
  )
}
