import type { RecapReport } from '@/lib/recap/report'
import type { PersonalTips, TipCard } from '@/lib/recap/bestTips'
import type { AwardResult } from '@/lib/recap/halbzeitAwards'
import { PUBLIC_AWARD_KEYS } from '@/lib/recap/halbzeitAwards'
import { explainIq, IQ_MIN_MATCHDAYS, IQ_MIN_SLIPS, type TipperIqResult } from '@/lib/recap/tipperIq'
import { BestTipTabs } from '@/components/recap/BestTipTabs'

/**
 * Winter-Recap: eigenständiger Winter-Look (Dunkelblau · Eisblau · Weiß, dezente Schneeflocken) NUR innerhalb dieser
 * Ansicht – der Rest der App behält sein Rot/Gold. Hell- und Dunkelmodus über die vorhandene `dark`-Klasse.
 * Inhalt bewusst knapp: Titel, Gewinner, eine große Zahl, höchstens ein Satz – Details klappen auf.
 */

const f0 = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 0 })
const f2 = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sgn = (n: number) => `${n >= 0 ? '+' : '−'}${f0(Math.abs(n))}`

// Palette: navy #0b1f44 · tief #050f26 · eis #8fd3ff · frost #e3f1fc · linie #cfe3f4
const SNOW = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cg fill='none' stroke='%23fff' stroke-opacity='.32' stroke-width='1.2' stroke-linecap='round'%3E%3Cpath d='M32 22v16M24 30h16M26 24l12 12M38 24L26 36'/%3E%3Cpath d='M124 96v12M118 102h12M120 98l8 8M128 98l-8 8'/%3E%3Cpath d='M150 26v8M146 30h8'/%3E%3C/g%3E%3Cg fill='%23fff'%3E%3Ccircle cx='84' cy='44' r='1.7' fill-opacity='.4'/%3E%3Ccircle cx='160' cy='70' r='1.2' fill-opacity='.3'/%3E%3Ccircle cx='56' cy='128' r='1.5' fill-opacity='.35'/%3E%3Ccircle cx='150' cy='150' r='1.9' fill-opacity='.3'/%3E%3Ccircle cx='96' cy='168' r='1.1' fill-opacity='.3'/%3E%3C/g%3E%3C/svg%3E")`
const CARD = 'rounded-2xl border border-[#cfe3f4] bg-white/90 shadow-sm dark:border-white/10 dark:bg-white/[0.06]'
const MUTED = 'text-[#4d6a8a] dark:text-[#9db8d6]'
const ACCENT = 'text-[#1565a8] dark:text-[#8fd3ff]'
const CHIP = 'rounded-lg bg-[#e3f1fc] dark:bg-white/10'

function Avatar({ name, url, size = 28 }: { name: string; url: string | null; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (url) return <img src={url} alt="" width={size} height={size} className="rounded-full object-cover flex-shrink-0 ring-2 ring-[#bfe3fb] dark:ring-white/20" style={{ width: size, height: size }} />
  return <span className="rounded-full bg-[#d7ebfa] text-[#0b3a6b] dark:bg-[#12315f] dark:text-[#bfe3fb] font-black flex items-center justify-center flex-shrink-0 ring-2 ring-[#bfe3fb] dark:ring-white/20" style={{ width: size, height: size, fontSize: size * 0.42 }}>{name.slice(0, 1).toUpperCase()}</span>
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className={`${CARD} overflow-hidden`}>
      <div className="px-4 pt-4 pb-2">
        <h2 className="font-display text-2xl font-bold uppercase tracking-wide"><span className={`${ACCENT} mr-1.5`} aria-hidden>❄</span>{title}</h2>
        {sub && <p className={`text-xs ${MUTED}`}>{sub}</p>}
      </div>
      {children}
    </section>
  )
}

type Person = (id: string) => { name: string; avatarUrl: string | null }
const firstSentence = (s: string) => (s.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s)

function TipCardView({ c, label, person, mine }: { c: TipCard; label: string; person?: Person; mine?: boolean }) {
  const p = person && !mine ? person(c.userId) : null
  return (
    <div className="px-4 py-3.5">
      <div className={`text-[11px] font-bold uppercase tracking-widest ${ACCENT}`}>{label}</div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {p && <Avatar name={p.name} url={p.avatarUrl} />}
          <div className="min-w-0">
            {p && <div className="truncate font-bold leading-tight">{p.name}</div>}
            <div className={`text-xs ${MUTED}`}>{c.kind === 'combo' ? `${c.legs.length}er-Kombi` : 'Einzelwette'}{c.matchday != null ? ` · ST ${c.matchday}` : ''}</div>
          </div>
        </div>
        <div className="text-right leading-none">
          <div className={`font-display text-4xl font-bold ${ACCENT}`}>{c.payout > 0 ? sgn(c.net) : '–'}</div>
          <div className={`text-[10px] uppercase tracking-wide ${MUTED}`}>Wildis Gewinn</div>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs">
        <span className={`${CHIP} px-2 py-1`}>Quote <b>{f2(c.odds)}</b></span>
        <span className={`${CHIP} px-2 py-1`}>Einsatz <b>{f0(c.stake)}</b></span>
        {c.payout > 0 && <span className={`${CHIP} px-2 py-1`}>Auszahlung <b>{f0(c.payout)}</b></span>}
      </div>
      <p className={`mt-2 text-sm ${MUTED}`}>{firstSentence(c.why)}</p>
      <details className="mt-1.5">
        <summary className={`cursor-pointer list-none text-xs font-semibold ${ACCENT}`}>▸ {c.kind === 'combo' ? `${c.legs.length} Tipps anzeigen` : 'Spiel anzeigen'}</summary>
        <ul className="mt-1.5 space-y-1">{c.legs.map((l, i) => (
          <li key={i} className={`text-xs ${l.highlight ? 'font-bold' : MUTED}`}>· {l.match}: {l.market} – <b>{l.selection}</b> <span className="opacity-60">@{f2(l.odds)}</span>{l.highlight ? ' ← der mutige Tipp' : ''}</li>
        ))}</ul>
      </details>
    </div>
  )
}

const AWARD_LINE: Record<string, string> = {
  wildi_magnet: 'Am meisten Wildis verdient.',
  hall_der_ehre: 'Die meisten Wildenroth-Spiele auf Sieg getippt – nie dagegen.',
  hall_der_schande: 'Am meisten mit Wetten gegen Wildenroth gewonnen.',
  senkrechtstarter: 'In der Rangliste am weitesten nach oben geklettert.',
  einzelwetten_meister: 'Am meisten mit Einzelwetten verdient.',
  aussenseiter_jaeger: 'Am häufigsten schwierige Quoten getroffen.',
  kombi_pech: 'Am häufigsten mit einem einzigen falschen Tipp gescheitert.',
}

function AwardCard({ a, r }: { a: AwardResult; r: RecapReport }) {
  const nm = (id: string) => r.people[id]?.name ?? 'Unbekannt'
  const av = (id: string, s = 22) => <Avatar name={nm(id)} url={r.people[id]?.avatarUrl ?? null} size={s} />
  const [w, ...restAll] = a.entries
  const keyOf = (e: AwardResult['entries'][number]) => e.rankKey ?? e.value
  const tied = restAll.filter((e) => keyOf(e) === keyOf(w))
  const rest = restAll.filter((e) => keyOf(e) !== keyOf(w))
  const bl = a.bitterest ? r.slipLegs[a.bitterest.slipKey] : undefined
  const top2 = a.second?.entries[0]
  const hasMore = !!(w.detail || tied.length || rest.length || a.bitterest || (a.second && a.second.entries.length))
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#e3f1fc] text-2xl dark:bg-white/10">{a.icon}</span>
        <div className="min-w-0 flex-1">
          <div className={`text-[11px] font-bold uppercase tracking-widest ${ACCENT}`}>{a.title}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">{av(w.userId)}<span className="truncate font-bold">{nm(w.userId)}</span></div>
        </div>
      </div>
      <div className={`mt-1.5 font-display text-4xl font-bold leading-none ${ACCENT}`}>{w.value}</div>
      <p className={`mt-1.5 text-sm ${MUTED}`}>{AWARD_LINE[a.key] ?? a.question}{tied.length > 0 && <span className="font-semibold text-[#b45309] dark:text-amber-300"> Gleichstand mit {tied.map((e) => nm(e.userId)).join(', ')}.</span>}</p>
      {top2 && <p className="mt-1 text-sm">🔁 Die meisten Gegenwetten: <b>{nm(top2.userId)}</b> <span className={MUTED}>({top2.value})</span></p>}
      {hasMore && (
        <details className="mt-1.5">
          <summary className={`cursor-pointer list-none text-xs font-semibold ${ACCENT}`}>▸ Mehr</summary>
          <div className={`mt-1.5 space-y-1.5 text-xs ${MUTED}`}>
            {w.detail && <p>{w.detail}</p>}
            {rest.length > 0 && <p>Dahinter: {rest.map((e) => `${nm(e.userId)} (${e.value})`).join(' · ')}</p>}
            {a.bitterest && (
              <div className={`${CHIP} p-2`}>
                <b>Bitterster Schein:</b> {nm(a.bitterest.userId)} – {a.bitterest.legs}er-Kombi @{f2(a.bitterest.odds)}, nur ein Tipp fehlte ({f0(a.bitterest.missedNet)} Wildis verpasst).
                {bl && <ul className="mt-1 space-y-0.5">{bl.map((l, i) => <li key={i} className={l.status === 'lost' ? 'font-bold' : ''}>{l.status === 'lost' ? '✗' : '✓'} {l.match}: {l.selection}</li>)}</ul>}
              </div>
            )}
            {a.second && a.second.entries.length > 0 && (
              <ul className="space-y-1">{a.second.entries.map((e) => <li key={e.userId}><b>{nm(e.userId)}</b> – {e.value}{e.detail ? <span className="opacity-80"> · {e.detail}</span> : null}</li>)}</ul>
            )}
          </div>
        </details>
      )}
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
    <details key={x.userId} className={x.userId === myId ? 'bg-[#e3f1fc]/70 dark:bg-white/10' : ''}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5">
        <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-black ${x.rank === 1 ? 'bg-[#ffd54a] text-[#4a3500]' : x.rank === 2 ? 'bg-[#dfe7ee] text-[#33475b]' : x.rank === 3 ? 'bg-[#e8b98a] text-[#4a2a0b]' : 'bg-[#e3f1fc] text-[#33567a] dark:bg-white/10 dark:text-[#bfe3fb]'}`}>{x.rank}</span>
        <Avatar name={nm(x.userId)} url={r.people[x.userId]?.avatarUrl ?? null} size={26} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5"><span className="min-w-0 max-w-full truncate text-sm font-semibold">{nm(x.userId)}</span>{x.userId === myId && <span className="rounded bg-[#1565a8] px-1.5 py-0.5 text-[10px] font-bold text-white">Du</span>}{x.rank === 1 && <span className="text-[10px] font-bold text-[#b45309] dark:text-amber-300">🧠 Quotenflüsterer</span>}</span>
        </span>
        <span className={`font-display text-2xl font-bold ${ACCENT}`}>{x.iq.toFixed(1).replace('.', ',')}</span>
      </summary>
      <div className={`px-4 pb-3 pl-[4.4rem] text-xs ${MUTED}`}>
        <ul className="space-y-0.5">{explainIq(x).map((l) => <li key={l}>· {l}</li>)}</ul>
      </div>
    </details>
  )
  const top = rated.slice(0, 5)
  const rest = rated.slice(5)
  return (
    <Section title="Tipper-IQ" sub="Wer tippt am klügsten – nicht nur am glücklichsten?">
      <div className="space-y-2 px-4 pb-3">
        <div className="rounded-xl border border-[#9fd0f2] bg-[#e3f1fc] px-3 py-2 text-sm font-semibold text-[#0b3a6b] dark:border-[#8fd3ff]/30 dark:bg-[#8fd3ff]/10 dark:text-[#cfeaff]">
          Offizielle Rangliste: mindestens {IQ_MIN_SLIPS} abgerechnete Wettscheine und {IQ_MIN_MATCHDAYS} aktive Spieltage.
        </div>
        <p className="text-sm">Der Tipper-IQ zeigt, wie gut du im Verhältnis zur Schwierigkeit deiner Wetten abschneidest – nicht nur, wie viel du gewinnst. <span className={`italic ${MUTED}`}>Ein spielerischer Qualitätsindex, kein wissenschaftliches Maß.</span></p>
        {me && !me.eligible && (
          <div className={`${CHIP} p-3 text-sm`}><b>Dein Zwischenwert: {me.iq.toFixed(1).replace('.', ',')}</b> – noch ohne Ranglistenplatz, dir fehlen {missing(me)}.</div>
        )}
      </div>
      <div className="divide-y divide-[#e3eef8] border-t border-[#e3eef8] dark:divide-white/10 dark:border-white/10">{top.map(row)}</div>
      {rest.length > 0 && (
        <details className="border-t border-[#e3eef8] dark:border-white/10" open={rest.some((x) => x.userId === myId)}>
          <summary className={`cursor-pointer px-4 py-3 text-sm font-semibold ${ACCENT}`}>Alle {rated.length} Tipper anzeigen</summary>
          <div className="divide-y divide-[#e3eef8] dark:divide-white/10">{rest.map(row)}</div>
        </details>
      )}
      <details className="border-t border-[#e3eef8] dark:border-white/10">
        <summary className={`cursor-pointer px-4 py-3 text-xs font-semibold ${MUTED}`}>So wird der Tipper-IQ berechnet{unrated.length > 0 ? ` · ${unrated.length} Tipper noch ohne Wertung` : ''}</summary>
        <div className={`space-y-2 px-4 pb-4 text-xs ${MUTED}`}>
          <p>Jeder abgerechnete Wettschein hat eine Trefferchance aus der Quote. Der IQ vergleicht deine Treffer mit dem, was dafür zu erwarten wäre – exakt gegen den Zufall gerechnet. 50 Punkte = genau so viel getroffen wie erwartet.</p>
          <ul className="list-disc space-y-0.5 pl-5">
            <li><b>45 %</b> Trefferqualität über der Erwartung</li>
            <li><b>20 %</b> Konstanz über die Spieltage</li>
            <li><b>20 %</b> Schwere Treffer (Quote ab 3,00 und 5,00)</li>
            <li><b>15 %</b> Robustheit ohne den besten Spieltag</li>
          </ul>
          <p>Gleiche Tipps in mehreren Scheinen zählen anteilig. Stornierte und offene Scheine zählen nicht. Das Pokalspiel zählt mit allen Tipps, auch den Pokal-Bonus-Tipps.</p>
        </div>
      </details>
    </Section>
  )
}

function Big({ n, caption, sub, icon }: { n: string; caption: string; sub?: string; icon: string }) {
  return (
    <div className={`${CARD} flex flex-col p-3.5`}>
      <div className="text-xl leading-none" aria-hidden>{icon}</div>
      <div className={`mt-2 font-display text-5xl font-bold leading-none ${ACCENT}`}>{n}</div>
      <div className="mt-1 text-sm font-semibold leading-snug">{caption}</div>
      {sub && <div className={`mt-0.5 text-xs ${MUTED}`}>{sub}</div>}
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
    <div className="divide-y divide-[#e3eef8] dark:divide-white/10">
      {bt.single && <TipCardView c={bt.single} label="🎯 Beste Einzelwette" person={person} />}
      {bt.combo && <TipCardView c={bt.combo} label="👑 Beste Kombi" person={person} />}
      {bt.bold && <TipCardView c={bt.bold} label="🧩 Mutigster Treffer" person={person} />}
      {!bt.single && !bt.combo && !bt.bold && <p className="p-4 text-sm">Noch keine gewonnenen Scheine.</p>}
    </div>
  )
  const mine = (
    <div>
      {!personal || !personal.best ? (
        <p className="p-4 text-sm">{personal && personal.settledSlips > 0 ? 'Noch kein gewonnener Wettschein in der Hinrunde – die Rückrunde kommt bestimmt. 🍀' : 'Du hast in dieser Hinrunde keine abgerechneten Wettscheine.'}</p>
      ) : (
        <div className="divide-y divide-[#e3eef8] dark:divide-white/10">
          <TipCardView c={personal.best} label="⭐ Dein bester Tipp" mine />
          {personal.extras.map((e) => <TipCardView key={e.label} c={e.card} label={e.label} mine />)}
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-3 rounded-3xl bg-gradient-to-b from-[#e2f0fb] via-[#f1f8fe] to-white p-3 text-[#0b1f44] dark:from-[#050f26] dark:via-[#081a3a] dark:to-[#0b2148] dark:text-[#eaf4ff]">
      {simulation && (
        <div className="rounded-2xl border-2 border-amber-500 bg-amber-100 p-3 text-sm text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">
          <b>🧪 Testvorschau</b> – Spieltag {r.range.to} ist simuliert ({simulation.matches} Spiele, {simulation.betRows} Wettzeilen mit erfundenem Ausgang). Nichts wird gespeichert.
          <div className="mt-0.5 text-xs opacity-80">{simulation.databaseRef === 'fixtures' ? 'Datenquelle: eingebaute Testdaten, keine Datenbank.' : <>Datenquelle (nur lesend): Projekt <code>{simulation.databaseRef || '?'}</code></>}</div>
        </div>
      )}
      {!simulation && previewTo && <div className="rounded-xl bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">Admin-Zwischenstand – Daten nur bis Spieltag {previewTo}.</div>}

      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b2a5b] via-[#103a7a] to-[#2a7fc4] p-5 text-white shadow-lg" style={{ backgroundImage: `${SNOW}, linear-gradient(135deg,#0b2a5b 0%,#103a7a 55%,#2a7fc4 100%)` }}>
        <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#bfe3fb]">Saison 2026/27 · Hinrunde</div>
        <h1 className="font-display mt-1 text-5xl font-bold uppercase leading-none tracking-wide">Winter-<wbr />Recap</h1>
        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          {([[f0(o.activeTippers), 'Tipper'], [f0(b.total - cancelled), 'Wettscheine'], [f0(o.settledStake), 'Wildis gesetzt']] as const).map(([v, l]) => (
            <div key={l} className="rounded-2xl bg-white/12 py-2.5 backdrop-blur-sm" style={{ backgroundColor: 'rgba(255,255,255,.12)' }}>
              <div className="font-display text-3xl font-bold leading-none">{v}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-[#cfeaff]">{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Zahlen & Geschichten */}
      <div className="grid grid-cols-2 gap-3">
        {f.comboKillers.singleBlockerCombos > 0 && <Big icon="💥" n={f0(f.comboKillers.singleBlockerCombos)} caption="Kombis an genau einem Tipp gescheitert" sub={`${f0(f.comboKillers.wildenrothCombos)}× war Wildenroth der Killer`} />}
        {f.oneGoalShort.total > 0 && <Big icon="🥅" n={f0(f.oneGoalShort.total)} caption="Kombis, die ein einziges Tor gerettet hätte" sub={`von ${f0(f.oneGoalShort.ofSingleBlockerCombos)} knapp Gescheiterten`} />}
        {f.lastMinute && <div className="col-span-2"><Big icon="⏱️" n={`${f0(f.lastMinute.leadSeconds)} Sek.`} caption={`${nm(f.lastMinute.card.userId)}: abgegeben vor Anpfiff – und gewonnen`} sub={`Quote ${f2(f.lastMinute.card.odds)} · ${sgn(f.lastMinute.card.net)} Wildis`} /></div>}
      </div>
      {f.comboKillers.topMatch && (
        <details className={`${CARD} px-4 py-2.5`}>
          <summary className={`cursor-pointer list-none text-xs font-semibold ${ACCENT}`}>▸ Das teuerste Spiel der Hinrunde</summary>
          <p className="mt-1 text-sm"><b>{r.matchLabels[f.comboKillers.topMatch.matchId]}</b> zerstörte {f0(f.comboKillers.topMatch.combos)} sonst richtige Kombis.{f.oneGoalShort.examples[0] && <> Beispiel „ein Tor fehlte“: {r.matchLabels[f.oneGoalShort.examples[0].matchId]} ({f.oneGoalShort.examples[0].actual}).</>}</p>
        </details>
      )}

      <Section title="Bester Tipp" sub="Nicht nur nach Auszahlung bewertet.">
        <BestTipTabs community={community} mine={mine} />
      </Section>

      <Section title="Die Awards">
        <div className="divide-y divide-[#e3eef8] dark:divide-white/10">{awards.map((a) => <AwardCard key={a.key} a={a} r={r} />)}</div>
      </Section>

      <IqSection r={r} myId={myId} />

      <details className={`${CARD}`}>
        <summary className={`cursor-pointer px-4 py-3 text-xs font-semibold ${MUTED}`}>Genaue Regeln</summary>
        <div className={`space-y-1.5 px-4 pb-4 text-xs ${MUTED}`}>
          <p>Gezählt werden alle abgerechneten Wettscheine der Spieltage {r.range.from}–{r.range.to}; Kombi-Einsätze einmal. Stornierte und offene Scheine zählen nicht, neutralisierte Legs werden ignoriert. Das Pokalspiel zählt vollständig. Gelöschte Konten werden nicht genannt.</p>
          <ul className="space-y-1">{awards.map((a) => <li key={a.key}><b>{a.title}:</b> {a.rule}</li>)}</ul>
        </div>
      </details>
    </div>
  )
}
