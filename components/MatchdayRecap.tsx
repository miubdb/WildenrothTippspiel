export type RecapLegDetail = {
  matchName: string
  market: string
  selection: string
  odds: number
  status: 'won' | 'lost' | 'pending'
}

export type RecapData = {
  mvp: { name: string; profit: number } | null
  bestOdds: { name: string; odds: number; stake: number; payout: number; isCombo: boolean; legs?: number } | null
  unluckyBastard: {
    name: string; odds: number; stake: number; legs: number; wouldHavePayout: number
    legDetails: RecapLegDetail[]
  } | null
  biggestLoss: { name: string; loss: number; isCombo: boolean } | null
  safestTip: { name: string; odds: number; stake: number; payout: number } | null
  bestCombo: { name: string; odds: number; stake: number; payout: number; legs: number } | null
  riskyHit: { name: string; odds: number; stake: number; payout: number; isCombo: boolean } | null
  wildenrothOptimist?: { name: string; stake: number; odds: number } | null
  craziestBet?: { name: string; odds: number; stake: number; isCombo: boolean; won: boolean } | null
  safestBanker?: { name: string; odds: number; stake: number; payout: number; isCombo: boolean } | null
}

// Simple template texts per category — deterministic pick by name hash so the
// same person always gets the same style, but variety across people.
function nameHash(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h
}
function pickTemplate(templates: string[], name: string): string {
  return templates[nameHash(name) % templates.length]
}
const TEMPLATES = {
  mvp: ['{name} räumt heute richtig ab.', '{name} lacht sich ins Fäustchen.'],
  pechvogel: ['{name} hatte heute kein Glück.', 'Heute ist nicht {name}s Tag.'],
  riskyHit: ['{name} hat Nerven aus Stahl — Quote {odds} gecasht.'],
  craziestBet: ['{name} ist mit Quote {odds} ins Risiko gegangen.'],
  wildenrothOptimist: ['{name} glaubt an die Truppe.'],
  safestBanker: ['{name} spielt auf Sicherheit — und behält Recht.'],
}
function tpl(category: keyof typeof TEMPLATES, name: string, odds?: number): string {
  return pickTemplate(TEMPLATES[category], name)
    .replace('{name}', name)
    .replace('{odds}', odds != null ? fmtOdds(odds) : '')
}

function fmtAmt(n: number) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtOdds(n: number) {
  return n.toFixed(2).replace('.', ',')
}

function HighlightCard({
  emoji, title, name, value, detail, sub,
  accentBg, accentBorder, accentText,
}: {
  emoji: string; title: string; name: string; value: string; detail?: string; sub?: string
  accentBg: string; accentBorder: string; accentText: string
}) {
  return (
    <div className={`rounded-2xl border ${accentBorder} ${accentBg} dark:bg-gray-800 dark:border-gray-700 px-4 py-3`}>
      <div className="text-xl mb-1.5">{emoji}</div>
      <div className="text-[10px] text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wide">{title}</div>
      <div className="font-bold text-gray-900 dark:text-gray-100 text-sm mt-0.5 truncate">{name}</div>
      <div className={`font-black text-xl mt-1 ${accentText}`}>{value}</div>
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
        <span className="text-2xl">😬</span>
        <div>
          <div className="font-bold text-gray-900 dark:text-gray-100 text-sm">Unlucky Bastard</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Nur 1 Tipp daneben – beinahe der Hit des Spieltags</div>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Header: name + combo info */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-bold text-gray-900 dark:text-gray-100">{ub.name}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {ub.legs}er-Kombi · @{fmtOdds(ub.odds)}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-[10px] text-gray-400 uppercase tracking-wide">Einsatz</div>
            <div className="font-bold text-gray-800 dark:text-gray-200 text-sm">{fmtAmt(ub.stake)} €</div>
          </div>
        </div>

        {/* Leg breakdown */}
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

        {/* Would-have payout */}
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900/30 rounded-xl px-3 py-2.5 flex items-center gap-3">
          <span className="text-2xl">😭</span>
          <div className="flex-1">
            <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">Wäre geworden</div>
            <div className="font-black text-green-600 dark:text-green-400 text-lg">+{fmtAmt(wouldHaveGained)} €</div>
          </div>
          <div className="text-right text-xs text-gray-400 dark:text-gray-500">
            <div>Auszahlung</div>
            <div className="font-semibold">{fmtAmt(ub.wouldHavePayout)} €</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function MatchdayRecap({ data, matchday }: { data: RecapData; matchday: number }) {
  const { mvp, bestOdds, unluckyBastard, biggestLoss, safestTip, bestCombo, riskyHit } = data
  const wildenrothOptimist = data.wildenrothOptimist ?? null
  const craziestBet = data.craziestBet ?? null
  const safestBanker = data.safestBanker ?? null
  if (!mvp && !bestOdds && !unluckyBastard && !biggestLoss && !safestTip && !bestCombo && !riskyHit
    && !wildenrothOptimist && !craziestBet && !safestBanker) return null

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="bg-red-700 text-white rounded-2xl px-5 py-4 shadow-sm">
        <div className="text-red-200 text-xs font-medium uppercase tracking-wide">{matchday}. Spieltag</div>
        <div className="text-2xl font-black mt-0.5">Spieltags-Recap</div>
        <div className="text-red-200 text-sm mt-1">Die Highlights des Spieltags</div>
      </div>

      {/* Spieltags-König + Mutigster Treffer */}
      {(mvp || bestOdds) && (
        <div className={`grid gap-3 ${mvp && bestOdds ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {mvp && (
            <HighlightCard
              emoji="🏆"
              title="Spieltags-König"
              name={mvp.name}
              value={`+${fmtAmt(mvp.profit)} €`}
              detail={tpl('mvp', mvp.name)}
              accentBg="bg-green-50"
              accentBorder="border-green-200"
              accentText="text-green-600"
            />
          )}
          {bestOdds && (
            <HighlightCard
              emoji="🎯"
              title="Mutigster Treffer"
              name={bestOdds.name}
              value={`@${fmtOdds(bestOdds.odds)}`}
              detail={`Einsatz ${fmtAmt(bestOdds.stake)} € → +${fmtAmt(bestOdds.payout - bestOdds.stake)} €${bestOdds.isCombo ? ` · ${bestOdds.legs ?? ''}er-Kombi` : ' · Einzelwette'}`}
              accentBg="bg-purple-50"
              accentBorder="border-purple-200"
              accentText="text-purple-700"
            />
          )}
        </div>
      )}

      {/* Unlucky Bastard */}
      {unluckyBastard && <UnluckyBastardCard ub={unluckyBastard} />}

      {/* Beste Kombi + Risky-Hit */}
      {(bestCombo || riskyHit) && (
        <div className={`grid gap-3 ${bestCombo && riskyHit ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {bestCombo && (
            <HighlightCard
              emoji="🔗"
              title="Beste Kombi"
              name={bestCombo.name}
              value={`@${fmtOdds(bestCombo.odds)}`}
              detail={`${bestCombo.legs} Tipps · Einsatz ${fmtAmt(bestCombo.stake)} € → +${fmtAmt(bestCombo.payout - bestCombo.stake)} €`}
              accentBg="bg-blue-50"
              accentBorder="border-blue-200"
              accentText="text-blue-700"
            />
          )}
          {riskyHit && (
            <HighlightCard
              emoji="🎲"
              title="Risky-Hit"
              name={riskyHit.name}
              value={`@${fmtOdds(riskyHit.odds)}`}
              detail={`Einsatz ${fmtAmt(riskyHit.stake)} € → +${fmtAmt(riskyHit.payout - riskyHit.stake)} €${riskyHit.isCombo ? ' · Kombi' : ''}`}
              accentBg="bg-amber-50"
              accentBorder="border-amber-200"
              accentText="text-amber-700"
            />
          )}
        </div>
      )}

      {/* Größter Verlust + Sicherster Treffer */}
      {(biggestLoss || safestTip) && (
        <div className={`grid gap-3 ${biggestLoss && safestTip ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {biggestLoss && (
            <HighlightCard
              emoji="💸"
              title="Größter Verlust"
              name={biggestLoss.name}
              value={`-${fmtAmt(biggestLoss.loss)} €`}
              detail={tpl('pechvogel', biggestLoss.name)}
              accentBg="bg-red-50"
              accentBorder="border-red-200"
              accentText="text-red-600"
            />
          )}
          {safestTip && (
            <HighlightCard
              emoji="🧠"
              title="Sicherster Treffer"
              name={safestTip.name}
              value={`@${fmtOdds(safestTip.odds)}`}
              detail={`Einsatz ${fmtAmt(safestTip.stake)} € → +${fmtAmt(safestTip.payout - safestTip.stake)} €`}
              accentBg="bg-teal-50"
              accentBorder="border-teal-200"
              accentText="text-teal-700"
            />
          )}
        </div>
      )}

      {/* Wildenroth-Optimist + Craziest Bet */}
      {(wildenrothOptimist || craziestBet) && (
        <div className={`grid gap-3 ${wildenrothOptimist && craziestBet ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {wildenrothOptimist && (
            <HighlightCard
              emoji="❤️"
              title="Wildenroth-Optimist"
              name={wildenrothOptimist.name}
              value={`${fmtAmt(wildenrothOptimist.stake)} €`}
              detail={tpl('wildenrothOptimist', wildenrothOptimist.name)}
              sub={`Quote @${fmtOdds(wildenrothOptimist.odds)} auf den Sieg`}
              accentBg="bg-rose-50"
              accentBorder="border-rose-200"
              accentText="text-rose-700"
            />
          )}
          {craziestBet && (
            <HighlightCard
              emoji="🤪"
              title="Verrückteste Wette"
              name={craziestBet.name}
              value={`@${fmtOdds(craziestBet.odds)}`}
              detail={tpl('craziestBet', craziestBet.name, craziestBet.odds)}
              sub={`Einsatz ${fmtAmt(craziestBet.stake)} € · ${craziestBet.isCombo ? 'Kombi' : 'Einzel'} · ${craziestBet.won ? 'getroffen ✅' : 'daneben ❌'}`}
              accentBg="bg-fuchsia-50"
              accentBorder="border-fuchsia-200"
              accentText="text-fuchsia-700"
            />
          )}
        </div>
      )}

      {/* Safest Banker */}
      {safestBanker && (
        <HighlightCard
          emoji="🛡️"
          title="Safest Banker"
          name={safestBanker.name}
          value={`@${fmtOdds(safestBanker.odds)}`}
          detail={tpl('safestBanker', safestBanker.name)}
          sub={`Einsatz ${fmtAmt(safestBanker.stake)} € → +${fmtAmt(safestBanker.payout - safestBanker.stake)} €${safestBanker.isCombo ? ' · Kombi' : ''}`}
          accentBg="bg-emerald-50"
          accentBorder="border-emerald-200"
          accentText="text-emerald-700"
        />
      )}
    </div>
  )
}
