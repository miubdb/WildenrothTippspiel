export type RecapData = {
  mvp: { name: string; profit: number } | null
  bestOdds: { name: string; odds: number; payout: number; isCombo: boolean } | null
  unluckyBastard: { name: string; odds: number; stake: number; legs: number; wouldHavePayout: number } | null
  biggestLoss: { name: string; loss: number; isCombo: boolean } | null
  safestTip: { name: string; odds: number; payout: number } | null
}

function fmtAmt(n: number) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtOdds(n: number) {
  return n.toFixed(2).replace('.', ',')
}

function HighlightCard({
  emoji, title, name, value, sub,
  accentBg, accentBorder, accentText,
}: {
  emoji: string; title: string; name: string; value: string; sub: string
  accentBg: string; accentBorder: string; accentText: string
}) {
  return (
    <div className={`rounded-2xl border ${accentBorder} ${accentBg} dark:bg-gray-800 dark:border-gray-700 px-4 py-3`}>
      <div className="text-xl mb-1.5">{emoji}</div>
      <div className="text-[10px] text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wide">{title}</div>
      <div className="font-bold text-gray-900 dark:text-gray-100 text-sm mt-0.5 truncate">{name}</div>
      <div className={`font-black text-lg mt-1 ${accentText}`}>{value}</div>
      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{sub}</div>
    </div>
  )
}

export function MatchdayRecap({ data, matchday }: { data: RecapData; matchday: number }) {
  const { mvp, bestOdds, unluckyBastard, biggestLoss, safestTip } = data
  if (!mvp && !bestOdds && !unluckyBastard && !biggestLoss && !safestTip) return null

  const hasTopRow = mvp || bestOdds
  const hasBottomRow = biggestLoss || safestTip

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="bg-red-700 text-white rounded-2xl px-5 py-4 shadow-sm">
        <div className="text-red-200 text-xs font-medium uppercase tracking-wide">{matchday}. Spieltag</div>
        <div className="text-2xl font-black mt-0.5">Spieltags-Recap</div>
        <div className="text-red-200 text-sm mt-1">Die Highlights des Spieltags</div>
      </div>

      {/* MVP + Best Odds */}
      {hasTopRow && (
        <div className={`grid gap-3 ${mvp && bestOdds ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {mvp && (
            <HighlightCard
              emoji="🏆"
              title="Spieltags-König"
              name={mvp.name}
              value={`+${fmtAmt(mvp.profit)} €`}
              sub="Nettogewinn"
              accentBg="bg-green-50"
              accentBorder="border-green-100"
              accentText="text-green-600"
            />
          )}
          {bestOdds && (
            <HighlightCard
              emoji="🎯"
              title="Mutigster Tipp"
              name={bestOdds.name}
              value={`@${fmtOdds(bestOdds.odds)}`}
              sub={`+${fmtAmt(bestOdds.payout - (bestOdds.payout / bestOdds.odds))} €${bestOdds.isCombo ? ' · Kombi' : ''}`}
              accentBg="bg-purple-50"
              accentBorder="border-purple-100"
              accentText="text-purple-700"
            />
          )}
        </div>
      )}

      {/* Unlucky Bastard */}
      {unluckyBastard && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 bg-orange-50 dark:bg-orange-900/20 border-b border-orange-100 dark:border-orange-900/30 flex items-center gap-2">
            <span className="text-xl">😬</span>
            <div>
              <div className="font-bold text-gray-900 dark:text-gray-100 text-sm">Unlucky Bastard</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {unluckyBastard.legs}er-Kombi @{fmtOdds(unluckyBastard.odds)} – nur 1 Tipp falsch
              </div>
            </div>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <div>
              <div className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{unluckyBastard.name}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Einsatz {fmtAmt(unluckyBastard.stake)} € · Wäre{' '}
                <span className="text-green-600 font-semibold">
                  +{fmtAmt(unluckyBastard.wouldHavePayout - unluckyBastard.stake)} €
                </span>{' '}
                geworden
              </div>
            </div>
            <span className="text-3xl">😭</span>
          </div>
        </div>
      )}

      {/* Biggest Loss + Safest Tip */}
      {hasBottomRow && (
        <div className={`grid gap-3 ${biggestLoss && safestTip ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {biggestLoss && (
            <HighlightCard
              emoji="💸"
              title="Größter Verlust"
              name={biggestLoss.name}
              value={`-${fmtAmt(biggestLoss.loss)} €`}
              sub={biggestLoss.isCombo ? 'Kombiwette' : 'Einzelwette'}
              accentBg="bg-red-50"
              accentBorder="border-red-100"
              accentText="text-red-600"
            />
          )}
          {safestTip && (
            <HighlightCard
              emoji="🧠"
              title="Sicherster Treffer"
              name={safestTip.name}
              value={`@${fmtOdds(safestTip.odds)}`}
              sub={`+${fmtAmt(safestTip.payout - safestTip.payout / safestTip.odds)} €`}
              accentBg="bg-blue-50"
              accentBorder="border-blue-100"
              accentText="text-blue-700"
            />
          )}
        </div>
      )}
    </div>
  )
}
