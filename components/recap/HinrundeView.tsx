import type { RecapReport } from '@/lib/recap/report'
import { explainIq, IQ_MIN_MATCHDAYS, IQ_MIN_SLIPS } from '@/lib/recap/tipperIq'
import type { AwardResult } from '@/lib/recap/halbzeitAwards'
import { wildiLabel } from '@/components/WildiIcon'

const f0 = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 0 })
const f2 = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sgn = (n: number) => `${n >= 0 ? '+' : '−'}${f0(Math.abs(n))}`
const card = 'bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden'

function Avatar({ name, url, size = 32 }: { name: string; url: string | null; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (url) return <img src={url} alt="" width={size} height={size} className="rounded-full object-cover flex-shrink-0" style={{ width: size, height: size }} />
  return <span className="rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-200 font-black flex items-center justify-center flex-shrink-0" style={{ width: size, height: size, fontSize: size * 0.42 }}>{name.slice(0, 1).toUpperCase()}</span>
}

function SlipLegs({ legs, k }: { legs: RecapReport['slipLegs']; k: string }) {
  return (
    <ul className="mt-1.5 space-y-0.5">
      {(legs[k] ?? []).map((l, i) => <li key={i} className="text-xs text-gray-600 dark:text-gray-300">· {l.match}: {l.market} – <b>{l.selection}</b> <span className="text-gray-400">@{f2(l.odds)}</span></li>)}
    </ul>
  )
}

function Section({ title, sub, children, accent }: { title: string; sub?: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <section className={`${card} ${accent ? 'border-red-200 dark:border-red-900/60' : ''}`}>
      <div className={`px-4 py-3 border-b ${accent ? 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-900/40' : 'border-gray-50 dark:border-gray-700'}`}>
        <h2 className="font-bold text-gray-900 dark:text-gray-100">{title}</h2>
        {sub && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{sub}</p>}
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-gray-50 dark:bg-gray-900/40 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-lg font-black text-gray-900 dark:text-gray-100">{value}</div>
      {hint && <div className="text-[11px] text-gray-400">{hint}</div>}
    </div>
  )
}

export function HinrundeView({ report, myId, previewTo }: { report: RecapReport; myId: string; previewTo: number | null }) {
  const r = report
  const nm = (id: string) => r.people[id]?.name ?? 'Unbekannt'
  const av = (id: string, s = 32) => <Avatar name={nm(id)} url={r.people[id]?.avatarUrl ?? null} size={s} />
  const b = r.breakdown
  const o = r.overview
  const main = r.awards.filter((a) => a.kind === 'main')
  const fun = r.awards.filter((a) => a.kind === 'fun')
  const rated = r.iq.filter((x) => x.eligible)
  const unrated = r.iq.filter((x) => !x.eligible)
  const me = r.iq.find((x) => x.userId === myId)
  const marketName: Record<string, string> = { '1x2': 'Spielausgang', double_chance: 'Doppelte Chance', handicap: 'Handicap', over_under_3_5: 'Über/Unter 3,5', goalscorer: 'Torschütze', btts: 'Beide treffen', exact_score: 'Ergebnis', over_under_5_5: 'Über/Unter 5,5', goalscorer_2plus: 'Torschütze 2+', over_9_5: 'Über 9,5' }

  return (
    <div className="space-y-4">
      {previewTo && <div className="rounded-xl bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100 text-xs font-semibold px-3 py-2">Testansicht – Daten nur bis Spieltag {previewTo}. Noch nicht der endgültige Recap.</div>}

      {/* Hero */}
      <div className="rounded-3xl bg-gradient-to-br from-red-700 via-red-600 to-amber-500 text-white p-5 shadow-lg">
        <div className="text-xs font-bold uppercase tracking-widest text-red-100">Saison 2026/27</div>
        <h1 className="text-3xl font-black leading-tight mt-1">Hinrunden-Recap</h1>
        <p className="text-sm text-red-50 mt-1">Spieltag {r.range.from} bis {r.range.to} · {o.activeTippers} Tipper · {f0(b.total)} Wettscheine</p>
        <div className="grid grid-cols-3 gap-2 mt-4 text-center">
          <div className="rounded-xl bg-white/15 py-2"><div className="text-lg font-black">{f0(o.settledStake)}</div><div className="text-[10px] uppercase text-red-100">Eingesetzt</div></div>
          <div className="rounded-xl bg-white/15 py-2"><div className="text-lg font-black">{f0(o.settledPayout)}</div><div className="text-[10px] uppercase text-red-100">Ausgezahlt</div></div>
          <div className="rounded-xl bg-white/15 py-2"><div className="text-lg font-black">{sgn(o.settledNet)}</div><div className="text-[10px] uppercase text-red-100">Netto</div></div>
        </div>
      </div>

      {/* Zahlen */}
      <Section title="Die Hinrunde in Zahlen" sub="Eine Kombi zählt als ein Wettschein, ihr Einsatz einmal. Beträge nur für abgerechnete Scheine.">
        <div className="p-3 grid grid-cols-2 gap-2">
          <Stat label="Wettscheine gesamt" value={f0(b.total)} hint={`${f0(b.singles)} Einzel · ${f0(b.combos)} Kombi`} />
          <Stat label="Gewonnen / verloren" value={`${f0(b.won)} / ${f0(b.lost)}`} hint={`Trefferquote ${(b.won / Math.max(1, b.won + b.lost) * 100).toFixed(1).replace('.', ',')} %`} />
          <Stat label="Storniert / annulliert" value={f0(b.cancelledByUser + b.voidNoReason + b.voidAdminUnavailable + b.voidOther + b.neutralized)} hint={`${f0(b.cancelledByUser)} vom Nutzer · ${f0(b.neutralizedLegs)} Legs auf Quote 1,00`} />
          <Stat label="Noch offen" value={f0(b.open)} />
          <Stat label="Höchste Gewinnquote" value={o.highestOddsWon ? f2(o.highestOddsWon.odds) : '–'} hint={o.highestOddsWon ? nm(o.highestOddsWon.userId) : undefined} />
          <Stat label="Größter Einzelwetten-Gewinn" value={o.biggestSingleWin ? sgn(o.biggestSingleWin.net) : '–'} hint={o.biggestSingleWin ? nm(o.biggestSingleWin.userId) : undefined} />
          <Stat label="Größter Kombi-Gewinn" value={o.biggestComboWin ? sgn(o.biggestComboWin.net) : '–'} hint={o.biggestComboWin ? `${nm(o.biggestComboWin.userId)} · ${o.biggestComboWin.legs} Legs` : undefined} />
          <Stat label="Torschützen-Tipps" value={f0(o.goalscorerLegs)} hint="als Einzelwette oder Kombi-Leg" />
        </div>
        <div className="px-4 pb-4 text-xs text-gray-500 dark:text-gray-400">
          Beliebteste Märkte: {o.popularMarkets.slice(0, 4).map((m) => `${marketName[m.market] ?? m.market} (${f0(m.legs)})`).join(' · ')}
        </div>
      </Section>

      {/* Bester Tipp */}
      <Section title="Bester Tipp der Hinrunde" sub="Nicht nur nach Auszahlung: Quote, Gewinn und Außenseiter-Anteil (wie selten dieser Tipp gewählt wurde) fließen gleichberechtigt ein." accent>
        <div className="divide-y divide-gray-50 dark:divide-gray-700">
          {r.bestTips.single[0] && <div className="p-4"><div className="text-xs font-bold text-red-700 dark:text-red-300">🎯 BESTE EINZELWETTE</div>
            <div className="flex items-center gap-2 mt-1">{av(r.bestTips.single[0].slip.userId)}<div><div className="font-bold text-gray-900 dark:text-gray-100">{nm(r.bestTips.single[0].slip.userId)} · Quote {f2(r.bestTips.single[0].slip.odds)}</div><div className="text-xs text-gray-500">Spieltag {r.bestTips.single[0].slip.matchday} · {sgn(r.bestTips.single[0].slip.net)} {wildiLabel(r.bestTips.single[0].slip.net)}{r.bestTips.single[0].rarity != null ? ` · nur ${Math.round((1 - r.bestTips.single[0].rarity) * 100)} % der Tipper setzten darauf` : ''}</div></div></div><SlipLegs legs={r.slipLegs} k={r.bestTips.single[0].slip.key} /></div>}
          {r.bestTips.combo[0] && <div className="p-4"><div className="text-xs font-bold text-red-700 dark:text-red-300">👑 BESTE KOMBI</div>
            <div className="flex items-center gap-2 mt-1">{av(r.bestTips.combo[0].slip.userId)}<div><div className="font-bold text-gray-900 dark:text-gray-100">{nm(r.bestTips.combo[0].slip.userId)} · {r.bestTips.combo[0].slip.legs}er-Kombi @{f2(r.bestTips.combo[0].slip.odds)}</div><div className="text-xs text-gray-500">Spieltag {r.bestTips.combo[0].slip.matchday} · {sgn(r.bestTips.combo[0].slip.net)} {wildiLabel(r.bestTips.combo[0].slip.net)}</div></div></div><SlipLegs legs={r.slipLegs} k={r.bestTips.combo[0].slip.key} /></div>}
          {r.bestTips.clever[0] && <div className="p-4"><div className="text-xs font-bold text-red-700 dark:text-red-300">🧩 KLÜGSTER TREFFER</div>
            <div className="flex items-center gap-2 mt-1">{av(r.bestTips.clever[0].userId)}<div><div className="font-bold text-gray-900 dark:text-gray-100">{nm(r.bestTips.clever[0].userId)} @{f2(r.bestTips.clever[0].odds)}</div><div className="text-xs text-gray-500">{r.matchLabels[r.bestTips.clever[0].matchId]} – nur {Math.round(r.bestTips.clever[0].crowdShare * 100)} % von {r.bestTips.clever[0].tippers} Tippern wählten das</div></div></div></div>}
          {r.bestTips.tragic[0] && <div className="p-4"><div className="text-xs font-bold text-red-700 dark:text-red-300">😭 TRAGISCHSTER SCHEIN</div>
            <div className="flex items-center gap-2 mt-1">{av(r.bestTips.tragic[0].slip.userId)}<div><div className="font-bold text-gray-900 dark:text-gray-100">{nm(r.bestTips.tragic[0].slip.userId)} · {r.bestTips.tragic[0].legsTotal}er-Kombi, nur ein Tipp falsch</div><div className="text-xs text-gray-500">{f0(r.bestTips.tragic[0].potentialPayout)} Wildis verpasst (gedeckelt) · Spieltag {r.bestTips.tragic[0].slip.matchday}</div></div></div><SlipLegs legs={r.slipLegs} k={r.bestTips.tragic[0].slip.key} /></div>}
        </div>
      </Section>

      {/* Tipper-IQ */}
      <Section title="Tipper-IQ" sub="Ein spielerischer Qualitätsindex, kein wissenschaftliches Maß. 50 = so viel getroffen, wie die Quoten erwarten lassen.">
        {me && !me.eligible && <div className="mx-4 mt-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 p-3 text-xs text-gray-600 dark:text-gray-300"><b>{me.notRatedReason}.</b> Dein berechneter IQ: {me.iq.toFixed(1).replace('.', ',')} – ohne Ranglistenplatz.</div>}
        <div className="divide-y divide-gray-50 dark:divide-gray-700">
          {rated.map((x) => (
            <details key={x.userId} className={`group ${x.userId === myId ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
              <summary className="list-none cursor-pointer flex items-center gap-3 px-4 py-3">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${x.rank === 1 ? 'bg-yellow-400 text-white' : x.rank === 2 ? 'bg-gray-300 text-gray-700' : x.rank === 3 ? 'bg-amber-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300'}`}>{x.rank}</span>
                {av(x.userId, 28)}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{nm(x.userId)}{x.userId === myId && <span className="ml-1.5 text-[10px] bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded font-bold">Du</span>}</span>
                  <span className="block text-[11px] text-gray-500 dark:text-gray-400">{x.wonSlips} Treffer (erwartet {x.expectedHits.toFixed(1).replace('.', ',')}) · {x.slipsConsidered} Scheine · {x.activeMatchdays} Spieltage · {x.difficult3WonSlips}× ≥ 3,00</span>
                </span>
                <span className="text-xl font-black text-red-700 dark:text-red-300">{x.iq.toFixed(1).replace('.', ',')}</span>
              </summary>
              <div className="px-4 pb-4 pl-[4.5rem] text-xs text-gray-600 dark:text-gray-300 space-y-2">
                <div className="font-bold text-gray-800 dark:text-gray-100">Warum dieser IQ?</div>
                <ul className="space-y-1">{explainIq(x).map((l) => <li key={l}>· {l}</li>)}</ul>
                <div className="grid grid-cols-4 gap-1 text-center pt-1">
                  {([['Treffer-qualität', x.components.hit, '45 %'], ['Konstanz', x.components.consistency, '20 %'], ['Schwere Treffer', x.components.difficult, '20 %'], ['Robustheit', x.components.robust, '15 %']] as const).map(([l, v, w]) => (
                    <div key={l} className="rounded-lg bg-gray-50 dark:bg-gray-900/40 py-1.5"><div className="text-sm font-black text-gray-900 dark:text-gray-100">{v.toFixed(0)}</div><div className="text-[10px] leading-tight">{l}</div><div className="text-[10px] text-gray-400">{w}</div></div>
                  ))}
                </div>
              </div>
            </details>
          ))}
        </div>
        {unrated.length > 0 && <div className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-50 dark:border-gray-700">Noch nicht für die offizielle Rangliste qualifiziert ({unrated.length}): weniger als {IQ_MIN_SLIPS} abgerechnete Wettscheine oder weniger als {IQ_MIN_MATCHDAYS} aktive Spieltage. Den eigenen Zwischenwert siehst du oben.</div>}
        <div className="px-4 pb-4 text-[11px] text-gray-400">Berechnung: Treffer gegen die Erwartung aus den Quoten (1/Quote), exakt gegen den Zufall gemessen. Gleiche Tipps in mehreren Scheinen zählen nur anteilig. Bonus-Tipps, Spieltags-Specials, offene und stornierte Scheine zählen nicht.</div>
      </Section>

      {/* Awards */}
      <Section title="Halbzeit-Awards" sub="Nur vergeben, wenn die Daten es hergeben – ohne Mindest-Stichprobe gibt es keinen Gewinner." accent>
        <div className="divide-y divide-gray-50 dark:divide-gray-700">{main.map((a) => <AwardBlock key={a.key} a={a} nm={nm} av={av} />)}</div>
      </Section>

      {/* Wildenroth */}
      <WildenrothSection r={r} nm={nm} av={av} />


      {/* Fakten */}
      <Section title="Interessante Fakten" sub="Nachgerechnet aus den abgerechneten Kombis – ohne Award.">
        <div className="p-4 space-y-4 text-sm text-gray-800 dark:text-gray-100">
          <div>
            <div className="text-xs font-bold text-red-700 dark:text-red-300 mb-1">💥 KOMBI-KILLER</div>
            <p><b>{r.facts.comboKillers.singleBlockerCombos}</b> Kombis scheiterten an genau einem falschen Tipp – bei <b>{r.facts.comboKillers.wildenrothCombos}</b> davon war das ein Spiel mit Wildenroth I oder II.</p>
            <ul className="mt-2 space-y-1">{r.facts.comboKillers.byMatch.map((k) => <li key={k.matchId} className="text-xs text-gray-600 dark:text-gray-300">· {r.matchLabels[k.matchId]}: {k.combos} Kombis von {k.users} Tippern ({f0(k.potentialPayout)} Wildis verpasst, gedeckelt)</li>)}</ul>
          </div>
          <div>
            <div className="text-xs font-bold text-red-700 dark:text-red-300 mb-1">🥅 EIN TOR FEHLTE</div>
            <p><b>{r.facts.oneGoalShort.cases.length === 0 ? 0 : r.facts.oneGoalShort.cases.length}</b> von {r.facts.oneGoalShort.singleBlockerCombos} dieser Kombis wären mit einem einzigen zusätzlichen oder fehlenden Tor aufgegangen (berechnet für Spielausgang, Doppelte Chance, Handicap, Über/Unter, Beide treffen, Ergebnis). {r.facts.oneGoalShort.notComputable} Fälle (z. B. Torschützen) sind aus dem Endergebnis nicht berechenbar und bleiben außen vor.</p>
            <ul className="mt-2 space-y-1">{r.facts.oneGoalShort.cases.map((c) => <li key={c.slip.key} className="text-xs text-gray-600 dark:text-gray-300">· {nm(c.slip.userId)}: {r.matchLabels[c.matchId]} ({c.actual}) – mit {c.saver} wären {f0(c.potentialPayout)} Wildis drin gewesen</li>)}</ul>
          </div>
        </div>
      </Section>

      {fun.length > 0 && (
        <Section title="Sonderstatistiken" sub="Zum Schmunzeln – echte Zahlen, aber ohne Pokal.">
          <div className="divide-y divide-gray-50 dark:divide-gray-700">{fun.map((a) => <AwardBlock key={a.key} a={a} nm={nm} av={av} compact />)}</div>
        </Section>
      )}

      {(r.rankMoves.climb || r.rankMoves.crash) && (
        <Section title="Auf und Ab im Klassement" sub="Größte Rangsprünge zwischen zwei Spieltagen (kumulatives Netto).">
          <div className="p-4 space-y-2 text-sm text-gray-800 dark:text-gray-100">
            {r.rankMoves.climb && <div>📈 <b>{nm(r.rankMoves.climb.userId)}</b>: Platz {r.rankMoves.climb.fromRank} → {r.rankMoves.climb.toRank} nach Spieltag {r.rankMoves.climb.toMatchday}</div>}
            {r.rankMoves.crash && <div>📉 <b>{nm(r.rankMoves.crash.userId)}</b>: Platz {r.rankMoves.crash.fromRank} → {r.rankMoves.crash.toRank} nach Spieltag {r.rankMoves.crash.toMatchday}</div>}
          </div>
        </Section>
      )}
    </div>
  )
}

function AwardBlock({ a, nm, av, compact }: { a: AwardResult; nm: (id: string) => string; av: (id: string, s?: number) => React.ReactNode; compact?: boolean }) {
  const [w, ...restAll] = a.entries
  const tied = restAll.filter((e) => e.value === w.value)
  const rest = restAll.filter((e) => e.value !== w.value)
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="text-2xl">{a.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wide text-red-700 dark:text-red-300">{a.title}</div>
          <div className="flex items-center gap-2 mt-0.5">{av(w.userId, 24)}<span className="font-bold text-gray-900 dark:text-gray-100 truncate">{nm(w.userId)}</span></div>
        </div>
        <div className="text-right text-sm font-black text-gray-900 dark:text-gray-100">{w.value}</div>
      </div>
      {w.detail && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-9">{w.detail}</p>}
      {tied.length > 0 && <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mt-1 ml-9">Gleichstand mit {tied.map((e) => nm(e.userId)).join(' · ')}</p>}
      {!compact && rest.length > 0 && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-9">Dahinter: {rest.map((e) => `${nm(e.userId)} (${e.value})`).join(' · ')}</p>}
      <p className="text-[11px] text-gray-400 mt-1 ml-9">{a.rule}</p>
    </div>
  )
}

function WildenrothSection({ r, nm, av }: { r: RecapReport; nm: (id: string) => string; av: (id: string, s?: number) => React.ReactNode }) {
  const loyal = [...r.wildenroth.all].filter((x) => x.win.matches > 0).sort((a, b) => b.win.matches - a.win.matches || b.win.legsHit - a.win.legsHit).slice(0, 5)
  const against = [...r.wildenroth.all].filter((x) => x.against.legs > 0).sort((a, b) => b.againstBalance - a.againstBalance).slice(0, 5)
  if (loyal.length === 0 && against.length === 0) return null
  return (
    <Section title="Hall der Ehre & Hall der Schande" sub="Pro Tipp ausgewertet, SpVgg Wildenroth I und II zusammen. Torschützen-Wetten sind Unterstützung, aber kein Siegtipp; Torwetten ohne Seite sind neutral.">
      <div className="p-4 space-y-4">
        <div>
          <div className="text-xs font-bold text-green-700 dark:text-green-400 mb-1">💚 HALL DER EHRE – Siegtipps auf Wildenroth</div>
          {loyal.map((x) => (
            <div key={x.userId} className="py-1.5 text-sm">
              <div className="flex items-center gap-2">{av(x.userId, 22)}<span className="flex-1 truncate font-semibold text-gray-900 dark:text-gray-100">{nm(x.userId)}</span><span className="text-xs font-bold text-gray-700 dark:text-gray-200">{x.win.matches} Siegtipps</span></div>
              <div className="ml-7 text-[11px] text-gray-500">{x.win.legsHit}/{x.win.legs} aufgegangen · +{x.supportive.legs} weitere Pro-Tipps{x.against.legs > 0 ? ` · ${x.against.legs} Gegenwetten` : ''}</div>
            </div>
          ))}
        </div>
        <div>
          <div className="text-xs font-bold text-red-700 dark:text-red-400 mb-1">😈 HALL DER SCHANDE – Wetten gegen Wildenroth</div>
          {against.length === 0 ? <p className="text-xs text-gray-500">Niemand hat gegen Wildenroth gewettet.</p> : (
            <div className="space-y-2">{against.map((x) => (
              <div key={x.userId} className="text-sm">
                <div className="flex items-center gap-2">{av(x.userId, 22)}<span className="flex-1 truncate font-semibold text-gray-900 dark:text-gray-100">{nm(x.userId)}</span><span className={`font-black ${x.againstBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>{sgn(x.againstBalance)}</span></div>
                <div className="ml-7 text-[11px] text-gray-500">{x.against.legsHit}/{x.against.legs} Gegen-Tipps aufgegangen · direkt aus Einzelwetten {sgn(x.against.directNet)} · <i>rechnerisch</i> aus Kombis zugeordnet {sgn(x.against.attributedComboNet)}</div>
              </div>))}
            </div>
          )}
          <p className="text-[11px] text-gray-400 mt-2">Kombi-Anteile verteilen den Gewinn nach dem Logarithmus der Quoten; verloren zählt nur, was ein Gegen-Leg selbst verloren hat. Zugeordnete Werte sind kein echter Geldfluss.</p>
        </div>
      </div>
    </Section>
  )
}
