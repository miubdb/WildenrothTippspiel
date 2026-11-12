import type { RecapReport } from '@/lib/recap/report'
import type { PersonalTips, TipCard } from '@/lib/recap/bestTips'
import type { AwardResult } from '@/lib/recap/halbzeitAwards'
import { PUBLIC_AWARD_KEYS } from '@/lib/recap/halbzeitAwards'
import { explainIq, IQ_MIN_MATCHDAYS, IQ_MIN_SLIPS, type TipperIqResult } from '@/lib/recap/tipperIq'
import { BestTipTabs } from '@/components/recap/BestTipTabs'

const f0 = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 0 })
const f2 = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sgn = (n: number) => `${n >= 0 ? '+' : '−'}${f0(Math.abs(n))}`
const card = 'bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden'

function Avatar({ name, url, size = 28 }: { name: string; url: string | null; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (url) return <img src={url} alt="" width={size} height={size} className="rounded-full object-cover flex-shrink-0" style={{ width: size, height: size }} />
  return <span className="rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-200 font-black flex items-center justify-center flex-shrink-0" style={{ width: size, height: size, fontSize: size * 0.42 }}>{name.slice(0, 1).toUpperCase()}</span>
}

function Section({ title, sub, children, accent }: { title: string; sub?: React.ReactNode; children: React.ReactNode; accent?: boolean }) {
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

type Person = (id: string) => { name: string; avatarUrl: string | null }

function TipCardView({ c, label, person, mine }: { c: TipCard; label: string; person?: Person; mine?: boolean }) {
  const p = person && !mine ? person(c.userId) : null
  return (
    <div className="p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-red-700 dark:text-red-300">{label}</div>
      <div className="flex items-center gap-2 mt-1.5 min-w-0">
        {p && <Avatar name={p.name} url={p.avatarUrl} size={28} />}
        <div className="min-w-0">
          {p && <div className="font-bold text-gray-900 dark:text-gray-100 truncate">{p.name}</div>}
          <div className="text-xs text-gray-500 dark:text-gray-400">{c.kind === 'combo' ? `${c.legs.length}er-Kombi` : 'Einzelwette'}{c.matchday != null ? ` · Spieltag ${c.matchday}` : ''}</div>
        </div>
      </div>
      {c.kind === 'single' && c.legs[0] && (
        <div className="mt-2 text-sm text-gray-800 dark:text-gray-100"><span className="text-gray-500 dark:text-gray-400">{c.legs[0].match}</span><br /><b>{c.legs[0].market}: {c.legs[0].selection}</b></div>
      )}
      {c.kind === 'combo' && (
        <details className="mt-2 group">
          <summary className="cursor-pointer text-sm font-semibold text-red-700 dark:text-red-300 list-none">▸ {c.legs.length} Tipps anzeigen</summary>
          <ul className="mt-1.5 space-y-1">{c.legs.map((l, i) => (
            <li key={i} className={`text-xs ${l.highlight ? 'font-bold text-gray-900 dark:text-gray-50' : 'text-gray-600 dark:text-gray-300'}`}>· {l.match}: {l.market} – <b>{l.selection}</b> <span className="text-gray-400">@{f2(l.odds)}</span>{l.highlight ? ' ← der mutige Tipp' : ''}</li>
          ))}</ul>
        </details>
      )}
      <div className="mt-3 grid grid-cols-4 gap-1.5 text-center">
        {([['Quote', f2(c.odds)], ['Einsatz', f0(c.stake)], ['Auszahlung', c.payout > 0 ? f0(c.payout) : '–'], ['Netto', c.payout > 0 ? sgn(c.net) : '–']] as const).map(([l, v]) => (
          <div key={l} className="rounded-lg bg-gray-50 dark:bg-gray-900/40 py-1.5"><div className="text-sm font-black text-gray-900 dark:text-gray-100">{v}</div><div className="text-[10px] text-gray-500 dark:text-gray-400">{l}</div></div>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">{c.why}</p>
    </div>
  )
}

function IqSection({ r, myId }: { r: RecapReport; myId: string }) {
  const rated = r.iq.filter((x) => x.eligible)
  const unrated = r.iq.filter((x) => !x.eligible)
  const me = r.iq.find((x) => x.userId === myId)
  const nm = (id: string) => r.people[id]?.name ?? 'Unbekannt'
  const missing = (x: TipperIqResult) => [x.slipsConsidered < IQ_MIN_SLIPS ? `${IQ_MIN_SLIPS - x.slipsConsidered} abgerechnete Wettscheine` : null, x.activeMatchdays < IQ_MIN_MATCHDAYS ? `${IQ_MIN_MATCHDAYS - x.activeMatchdays} aktive Spieltage` : null].filter(Boolean).join(' und ')
  const row = (x: TipperIqResult) => (
    <details key={x.userId} className={x.userId === myId ? 'bg-red-50 dark:bg-red-900/10' : ''}>
      <summary className="list-none cursor-pointer flex items-center gap-3 px-4 py-3">
        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${x.rank === 1 ? 'bg-yellow-400 text-white' : x.rank === 2 ? 'bg-gray-300 text-gray-700' : x.rank === 3 ? 'bg-amber-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300'}`}>{x.rank}</span>
        <Avatar name={nm(x.userId)} url={r.people[x.userId]?.avatarUrl ?? null} size={28} />
        <span className="flex-1 min-w-0">
          <span className="flex flex-wrap items-center gap-x-1.5"><span className="truncate min-w-0 max-w-full text-sm font-semibold text-gray-900 dark:text-gray-100">{nm(x.userId)}</span>{x.userId === myId && <span className="text-[10px] bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded font-bold">Du</span>}{x.rank === 1 && <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">🧠 Quotenflüsterer</span>}</span>
          <span className="block text-[11px] text-gray-500 dark:text-gray-400">{x.wonSlips} von {x.slipsConsidered} Scheinen gewonnen · {x.activeMatchdays} Spieltage</span>
        </span>
        <span className="text-xl font-black text-red-700 dark:text-red-300">{x.iq.toFixed(1).replace('.', ',')}</span>
      </summary>
      <div className="px-4 pb-4 pl-[4.5rem] text-xs text-gray-600 dark:text-gray-300 space-y-1">
        <div className="font-bold text-gray-800 dark:text-gray-100">Warum dieser IQ?</div>
        <ul className="space-y-1">{explainIq(x).map((l) => <li key={l}>· {l}</li>)}</ul>
      </div>
    </details>
  )
  const top = rated.slice(0, 10)
  const rest = rated.slice(10)
  const meInRest = me && rest.some((x) => x.userId === me.userId)
  return (
    <Section title="Tipper-IQ" sub="Wer tippt am klügsten – nicht nur am glücklichsten?">
      <div className="px-4 pt-3 space-y-2">
        <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/40 px-3 py-2 text-sm font-semibold text-red-800 dark:text-red-200">
          Für die offizielle Rangliste brauchst du mindestens {IQ_MIN_SLIPS} abgerechnete Wettscheine und {IQ_MIN_MATCHDAYS} aktive Spieltage.
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-200">Der Tipper-IQ zeigt, wie gut du im Verhältnis zur Schwierigkeit deiner Wetten abschneidest. Nicht nur Gewinne zählen, sondern auch Konstanz, getroffene höhere Quoten – und ob du auch ohne deinen besten Spieltag noch gut dastehst.</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 italic">Ein spielerischer Qualitätsindex, kein wissenschaftliches Maß.</p>
        {me && !me.eligible && (
          <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 p-3 text-sm text-gray-700 dark:text-gray-200">
            <b>Dein Zwischenwert: {me.iq.toFixed(1).replace('.', ',')}</b> – noch ohne offiziellen Ranglistenplatz. Dir fehlen noch {missing(me)}.
          </div>
        )}
      </div>
      <div className="mt-2 divide-y divide-gray-50 dark:divide-gray-700 border-t border-gray-50 dark:border-gray-700">{top.map(row)}</div>
      {rest.length > 0 && (
        <details className="border-t border-gray-50 dark:border-gray-700" open={!!meInRest}>
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-red-700 dark:text-red-300">Alle {rated.length} gewerteten Tipper anzeigen</summary>
          <div className="divide-y divide-gray-50 dark:divide-gray-700">{rest.map(row)}</div>
        </details>
      )}
      {unrated.length > 0 && <div className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-50 dark:border-gray-700">{unrated.length} Tipper sind noch nicht für die offizielle Rangliste qualifiziert.</div>}
      <details className="border-t border-gray-50 dark:border-gray-700">
        <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">So wird der Tipper-IQ berechnet</summary>
        <div className="px-4 pb-4 text-xs text-gray-600 dark:text-gray-300 space-y-2">
          <p>Zu jedem abgerechneten Wettschein gehört eine Trefferchance aus der Quote (1 geteilt durch Quote). Der IQ vergleicht deine tatsächlichen Treffer mit dem, was nach diesen Chancen zu erwarten wäre – exakt gegen den Zufall gerechnet, damit wenige Glückstreffer allein nicht reichen. 50 Punkte heißen: genau so viel getroffen wie erwartet.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><b>45 %</b> Trefferqualität: wie weit du über der Erwartung liegst.</li>
            <li><b>20 %</b> Konstanz: an wie vielen Spieltagen du mindestens so viel getroffen hast wie erwartet.</li>
            <li><b>20 %</b> Schwere Treffer: Gewinnscheine mit Quote ab 3,00 und ab 5,00, je Spieltag einmal gezählt.</li>
            <li><b>15 %</b> Robustheit: dieselbe Trefferqualität, aber ohne deinen besten Spieltag.</li>
          </ul>
          <p>Gleiche Tipps in mehreren Scheinen zählen nur anteilig. Stornierte und offene Scheine zählen nicht; Spieltags-Specials zählen nicht. Das Pokalspiel (inklusive der Pokal-Bonus-Tipps) zählt wie jedes andere Spiel.</p>
        </div>
      </details>
    </Section>
  )
}

function AwardCard({ a, r }: { a: AwardResult; r: RecapReport }) {
  const nm = (id: string) => r.people[id]?.name ?? 'Unbekannt'
  const av = (id: string, s = 24) => <Avatar name={nm(id)} url={r.people[id]?.avatarUrl ?? null} size={s} />
  const [w, ...restAll] = a.entries
  const keyOf = (e: AwardResult['entries'][number]) => e.rankKey ?? e.value
  const tied = restAll.filter((e) => keyOf(e) === keyOf(w))
  const rest = restAll.filter((e) => keyOf(e) !== keyOf(w))
  const bl = a.bitterest ? r.slipLegs[a.bitterest.slipKey] : undefined
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none mt-0.5">{a.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wide text-red-700 dark:text-red-300">{a.title}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{a.question}</div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1.5">{av(w.userId)}<span className="font-bold text-gray-900 dark:text-gray-100 truncate min-w-0 max-w-full">{nm(w.userId)}</span><span className="ml-auto text-sm font-black text-gray-900 dark:text-gray-100">{w.value}</span></div>
          {w.detail && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{w.detail}</p>}
          {tied.length > 0 && <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mt-1">Gleichstand mit {tied.map((e) => nm(e.userId)).join(' · ')}</p>}
          {rest.length > 0 && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Dahinter: {rest.map((e) => `${nm(e.userId)} (${e.value})`).join(' · ')}</p>}
          {a.bitterest && (
            <div className="mt-2 rounded-lg bg-gray-50 dark:bg-gray-900/40 p-2.5 text-xs text-gray-700 dark:text-gray-200">
              <b>Bitterster Schein der Hinrunde:</b> {nm(a.bitterest.userId)} – {a.bitterest.legs}er-Kombi @{f2(a.bitterest.odds)}, nur ein Tipp fehlte. Dabei sind {f0(a.bitterest.missedNet)} Wildis Nettogewinn verpasst worden.
              {bl && <ul className="mt-1 space-y-0.5">{bl.map((l, i) => <li key={i} className={l.status === 'lost' ? 'font-bold' : ''}>{l.status === 'lost' ? '✗' : '✓'} {l.match}: {l.selection}</li>)}</ul>}
            </div>
          )}
          {a.second && a.second.entries.length > 0 && (
            <div className="mt-3 rounded-lg border border-red-100 dark:border-red-900/40 p-2.5">
              <div className="text-[11px] font-bold uppercase tracking-wide text-red-700 dark:text-red-300">{a.second.title}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{a.second.question}</div>
              <ul className="space-y-1.5">{a.second.entries.map((e) => (
                <li key={e.userId} className="text-sm">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">{av(e.userId, 20)}<span className="font-semibold text-gray-900 dark:text-gray-100 truncate min-w-0 max-w-full">{nm(e.userId)}</span><span className="ml-auto font-black text-gray-900 dark:text-gray-100">{e.value}</span></div>
                  {e.detail && <div className="ml-7 text-[11px] text-gray-500 dark:text-gray-400">{e.detail}</div>}
                </li>))}</ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function HinrundeView({ report, personal, myId, previewTo, simulation }: {
  report: RecapReport; personal: PersonalTips | null; myId: string; previewTo: number | null
  simulation: { matches: number; betRows: number; databaseRef: string } | null
}) {
  const r = report
  const b = r.breakdown
  const o = r.overview
  const person: Person = (id) => r.people[id] ?? { name: 'Unbekannt', avatarUrl: null }
  const nm = (id: string) => person(id).name
  const awards = PUBLIC_AWARD_KEYS.map((k) => r.awards.find((a) => a.key === k)).filter((a): a is AwardResult => !!a)
  const bt = r.bestTips
  const f = r.facts
  const cancelled = b.cancelledByUser + b.voidNoReason + b.voidAdminUnavailable + b.voidOther + b.neutralized

  const community = (
    <div className="divide-y divide-gray-50 dark:divide-gray-700">
      {bt.single && <TipCardView c={bt.single} label="🎯 Beste Einzelwette" person={person} />}
      {bt.combo && <TipCardView c={bt.combo} label="👑 Beste Kombi" person={person} />}
      {bt.bold && <TipCardView c={bt.bold} label="🧩 Mutigster Treffer" person={person} />}
      {!bt.single && !bt.combo && !bt.bold && <p className="p-4 text-sm text-gray-500">Noch keine gewonnenen Scheine.</p>}
    </div>
  )
  const mine = (
    <div>
      {!personal || !personal.best ? (
        <p className="p-4 text-sm text-gray-600 dark:text-gray-300">{personal && personal.settledSlips > 0 ? 'Du hattest in dieser Hinrunde noch keinen gewonnenen Wettschein – die Rückrunde kommt bestimmt. 🍀' : 'Du hast in dieser Hinrunde keine abgerechneten Wettscheine.'}</p>
      ) : (
        <div className="divide-y divide-gray-50 dark:divide-gray-700">
          <TipCardView c={personal.best} label="⭐ Dein bester Tipp der Hinrunde" mine />
          {personal.extras.map((e) => <TipCardView key={e.label} c={e.card} label={e.label} mine />)}
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      {simulation && (
        <div className="rounded-2xl border-2 border-amber-500 bg-amber-100 dark:bg-amber-900/30 p-4 text-amber-950 dark:text-amber-100">
          <div className="text-sm font-black uppercase tracking-wide">🧪 Testvorschau – nicht echt</div>
          <p className="text-sm mt-1">Spieltag {r.range.to} ist hier <b>simuliert</b>: {simulation.matches} Spiele mit erfundenen Ergebnissen, {simulation.betRows} offene Wettzeilen mit erfundenem Ausgang. Alles läuft nur im Speicher dieser Seite – es wird nichts gespeichert, verändert oder freigegeben.</p>
          <p className="text-xs mt-1 opacity-80">{simulation.databaseRef === 'fixtures' ? 'Datenquelle: eingebaute synthetische Testdaten – keine Datenbank, keine echten Personen, keine echten Wetten.' : <>Datenquelle (nur lesend): Supabase-Projekt <code>{simulation.databaseRef || '?'}</code>.</>}</p>
        </div>
      )}
      {!simulation && previewTo && <div className="rounded-xl bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100 text-xs font-semibold px-3 py-2">Admin-Zwischenstand – Daten nur bis Spieltag {previewTo}.</div>}

      {/* Hero + kompakte Gesamtstatistik */}
      <div className="rounded-3xl bg-gradient-to-br from-red-700 via-red-600 to-amber-500 text-white p-5 shadow-lg">
        <div className="text-xs font-bold uppercase tracking-widest text-red-100">Saison 2026/27</div>
        <h1 className="text-3xl font-black leading-tight mt-1">Winter-Recap</h1>
        <p className="text-sm text-red-50 mt-1">Die Hinrunde: Spieltag {r.range.from} bis {r.range.to}</p>
        <div className="grid grid-cols-3 gap-2 mt-4 text-center">
          <div className="rounded-xl bg-white/15 py-2"><div className="text-lg font-black">{f0(o.activeTippers)}</div><div className="text-[10px] uppercase text-red-100">Tipper</div></div>
          <div className="rounded-xl bg-white/15 py-2"><div className="text-lg font-black">{f0(b.total - cancelled)}</div><div className="text-[10px] uppercase text-red-100">Wettscheine</div></div>
          <div className="rounded-xl bg-white/15 py-2"><div className="text-lg font-black">{f0(o.settledStake)}</div><div className="text-[10px] uppercase text-red-100">Eingesetzt</div></div>
        </div>
        <p className="text-xs text-red-50 mt-3">{f0(b.won)} gewonnen · {f0(b.lost)} verloren{b.open > 0 ? ` · ${f0(b.open)} offen` : ''} · {f0(o.settledPayout)} Wildis ausgezahlt · Trefferquote {(b.won / Math.max(1, b.won + b.lost) * 100).toFixed(1).replace('.', ',')} %</p>
      </div>

      <Section title="Bester Tipp der Hinrunde" sub="Nicht nur nach Auszahlung bewertet: Quote, Gewinn und wie selten der Tipp gewählt wurde zählen gleichermaßen." accent>
        <BestTipTabs community={community} mine={mine} />
      </Section>

      <IqSection r={r} myId={myId} />

      <Section title="Die Awards" sub="Die wichtigsten Auszeichnungen der Hinrunde.">
        <div className="divide-y divide-gray-50 dark:divide-gray-700">{awards.map((a) => <AwardCard key={a.key} a={a} r={r} />)}</div>
      </Section>

      <Section title="Fun Facts" sub="Ein paar Kuriositäten – mehr gibt es zur Weihnachtsfeier. 🎄">
        <div className="p-4 space-y-4 text-sm text-gray-800 dark:text-gray-100">
          {f.comboKillers.singleBlockerCombos > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-red-700 dark:text-red-300">💥 Kombi-Killer</div>
              <p className="mt-0.5"><b>{f0(f.comboKillers.singleBlockerCombos)}</b> Kombis scheiterten an genau einem Tipp – bei <b>{f0(f.comboKillers.wildenrothCombos)}</b> davon war es ein Spiel mit Wildenroth I oder II.{f.comboKillers.topMatch && <> Das teuerste Spiel: <b>{r.matchLabels[f.comboKillers.topMatch.matchId]}</b> – es zerstörte {f0(f.comboKillers.topMatch.combos)} sonst richtige Kombis.</>}</p>
            </div>
          )}
          {f.oneGoalShort.total > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-red-700 dark:text-red-300">🥅 Ein Tor fehlte</div>
              <p className="mt-0.5">Bei <b>{f0(f.oneGoalShort.total)}</b> dieser Kombis hätte ein einziges Tor mehr oder weniger gereicht.{f.oneGoalShort.examples[0] && <> Beispiel: <b>{r.matchLabels[f.oneGoalShort.examples[0].matchId]}</b> ({f.oneGoalShort.examples[0].actual}) – {nm(f.oneGoalShort.examples[0].slip.userId)} hätte mit {f.oneGoalShort.examples[0].saver} {f0(f.oneGoalShort.examples[0].potentialNet)} Wildis Nettogewinn geholt.</>}</p>
            </div>
          )}
          {f.lastMinute && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-red-700 dark:text-red-300">⏱️ Last-Minute-Treffer</div>
              <p className="mt-0.5"><b>{nm(f.lastMinute.card.userId)}</b> gab den Schein {Math.round(f.lastMinute.leadSeconds)} Sekunden vor Anpfiff ab – Quote {f2(f.lastMinute.card.odds)}, {sgn(f.lastMinute.card.net)} Wildis Gewinn. {f.lastMinute.card.legs[0] ? <span className="text-gray-500 dark:text-gray-400">({f.lastMinute.card.legs[0].match}: {f.lastMinute.card.legs[0].selection})</span> : null}</p>
            </div>
          )}
        </div>
      </Section>

      <details className={`${card}`}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-600 dark:text-gray-300">So wurde gezählt – genaue Regeln</summary>
        <div className="px-4 pb-4 space-y-2 text-xs text-gray-600 dark:text-gray-300">
          <p>Gezählt werden alle abgerechneten Wettscheine der Spieltage {r.range.from}–{r.range.to} (Einzelwette = ein Schein, Kombi = ein Schein mit einmal gezähltem Einsatz). Stornierte und offene Scheine zählen nicht, Legs mit auf Quote 1,00 neutralisierten Spielen werden ignoriert. Das Pokalspiel zählt vollständig mit, auch die Pokal-Bonus-Tipps. Gelöschte Konten werden nicht genannt.</p>
          <ul className="space-y-1.5">{awards.map((a) => <li key={a.key}><b>{a.title}:</b> {a.rule}{a.second ? ` Zweite Wertung „${a.second.title}": Anzahl aller Gegen-Tipps (Gegen-Legs), danach Zahl verschiedener Spiele.` : ''}</li>)}</ul>
        </div>
      </details>
    </div>
  )
}
