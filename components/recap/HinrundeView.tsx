import type { RecapReport } from '@/lib/recap/report'
import type { PersonalTips, TipCard, TipLeg } from '@/lib/recap/bestTips'
import type { AwardEntry, AwardResult } from '@/lib/recap/halbzeitAwards'
import { PUBLIC_AWARD_KEYS } from '@/lib/recap/halbzeitAwards'
import { explainIq, IQ_MIN_MATCHDAYS, IQ_MIN_SLIPS, type TipperIqResult } from '@/lib/recap/tipperIq'
import { TeamLogo } from '@/components/TeamLogo'

/**
 * Winter-Recap: eigenständiger Winter-Look (Dunkelblau · Eisblau · Weiß, dezenter Schnee) NUR innerhalb dieser Ansicht –
 * der Rest der App behält sein Rot/Gold. Hell/Dunkel über die vorhandene `dark`-Klasse.
 * Leitlinie: pro Karte Titel, Gewinner, eine große Zahl, höchstens ein Satz – alles Weitere klappt auf.
 */

const f0 = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 0 })
const f2 = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sgn = (n: number) => `${n >= 0 ? '+' : '−'}${f0(Math.abs(n))}`
const firstSentence = (s: string) => (s.match(/^.*?[.!?](?=\s+[A-ZÄÖÜ„"]|$)/)?.[0] ?? s)

// Palette: navy #0b1f44 · tief #050f26 · eis #8fd3ff · frost #e3f1fc · linie #cfe3f4
const CARD = 'rc-card relative rounded-2xl border border-[#cfe3f4] bg-white/90 shadow-sm dark:border-white/10 dark:bg-white/[0.06]'
const MUTED = 'text-[#4d6a8a] dark:text-[#9db8d6]'
const ACCENT = 'text-[#1565a8] dark:text-[#8fd3ff]'
const CHIP = 'rounded-lg bg-[#e3f1fc] dark:bg-white/10'
const DIVIDE = 'divide-y divide-[#e3eef8] dark:divide-white/10'

const STYLE = `
@keyframes rc-fall{0%{transform:translate3d(0,-12%,0);opacity:0}10%{opacity:.9}100%{transform:translate3d(var(--dx,14px),112%,0);opacity:.15}}
@keyframes rc-twinkle{0%,100%{opacity:.35}50%{opacity:.9}}
.rc-flake{position:absolute;top:0;color:#fff;line-height:1;pointer-events:none;animation:rc-fall var(--d,12s) linear var(--s,0s) infinite;will-change:transform}
.rc-snowcap::before{content:"";position:absolute;left:10px;right:10px;top:-5px;height:9px;border-radius:9px 9px 6px 6px;background:linear-gradient(#fff,#f1f8ff);box-shadow:0 1px 2px rgba(11,31,68,.18)}
.dark .rc-snowcap::before{background:linear-gradient(#f4faff,#dcecfa);box-shadow:0 1px 3px rgba(0,0,0,.4)}
.rc-star{animation:rc-twinkle 3.6s ease-in-out infinite}
@keyframes rc-bob{0%{transform:translateY(0) rotate(-3deg)}100%{transform:translateY(-3px) rotate(3deg)}}
.rc-bob{animation:rc-bob 4.6s ease-in-out infinite alternate;transform-origin:50% 80%}
details>summary::-webkit-details-marker{display:none}
@media (prefers-reduced-motion:reduce){.rc-flake,.rc-star,.rc-bob{animation:none}.rc-flake{opacity:.6;top:var(--y,20%)}}
`
const FLAKES = Array.from({ length: 18 }, (_, i) => ({ left: (i * 37 + 7) % 100, size: i % 3 === 0 ? 9 + ((i * 5) % 8) : 6 + (i % 4), d: 9 + ((i * 3) % 8), s: -((i * 1.7) % 12), dx: ((i % 2) * 2 - 1) * (10 + (i % 4) * 6), y: (i * 13) % 80, ch: i % 3 === 0 ? '❄' : '•', op: 0.35 + ((i * 7) % 5) / 10 }))

function Snow({ n = 18 }: { n?: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {FLAKES.slice(0, n).map((x, i) => <span key={i} className="rc-flake" style={{ left: `${x.left}%`, fontSize: x.size, opacity: x.op, ['--d' as string]: `${x.d}s`, ['--s' as string]: `${x.s}s`, ['--dx' as string]: `${x.dx}px`, ['--y' as string]: `${x.y}%` }}>{x.ch}</span>)}
    </div>
  )
}

function Snowman({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 84" className={className} aria-hidden>
      <circle cx="32" cy="64" r="19" fill="#f6fbff" /><circle cx="32" cy="38" r="14" fill="#fff" />
      <path d="M17 33 Q32 14 47 33 Q32 28 17 33Z" fill="#2a7fc4" /><circle cx="32" cy="13" r="4.2" fill="#fff" />
      <path d="M19 33 H45" stroke="#e3f1fc" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="27.5" cy="38" r="1.5" fill="#0b1f44" /><circle cx="36.5" cy="38" r="1.5" fill="#0b1f44" />
      <path d="M32 41 L43 43.5 L32 44.5Z" fill="#ff8a3d" />
      <path d="M21 49 Q32 55 43 49" stroke="#8fd3ff" strokeWidth="4.5" fill="none" strokeLinecap="round" />
      <circle cx="32" cy="63" r="1.6" fill="#0b1f44" /><circle cx="32" cy="71" r="1.6" fill="#0b1f44" />
      <path d="M14 58 L5 50 M50 58 L59 50" stroke="#7a5a3a" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

export type CoinDeco = 'hat' | 'snowcap' | 'scarf'

/** Wildi-Coin (vorhandenes Design) mit winterlicher Dekoration: Weihnachtsmütze, Schneehaube oder Schal. */
function WildiCoin({ size = 30, deco = 'hat', bob = false, className = '' }: { size?: number; deco?: CoinDeco; bob?: boolean; className?: string }) {
  return (
    <span className={`relative inline-block flex-shrink-0 ${bob ? 'rc-bob' : ''} ${className}`} style={{ width: size, height: size }} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/wildi-coin.png" alt="" width={size} height={size} className="h-full w-full object-contain drop-shadow-sm" />
      {deco === 'hat' && (
        <svg viewBox="0 0 40 30" className="absolute" style={{ width: size * 0.72, left: -size * 0.12, top: -size * 0.34, transform: 'rotate(-18deg)' }}>
          <path d="M3 26 Q6 6 28 4 Q22 14 36 22 Q38 26 34 27 Z" fill="#d7263d" />
          <rect x="1.5" y="22.5" width="35" height="6" rx="3" fill="#fff" />
          <circle cx="29" cy="5" r="4" fill="#fff" />
        </svg>
      )}
      {deco === 'snowcap' && (
        <svg viewBox="0 0 40 20" className="absolute" style={{ width: size * 0.86, left: size * 0.07, top: -size * 0.22 }}>
          <path d="M3 17 Q5 3 20 2 Q35 3 37 17 Q33 12 29 17 Q25 11 21 17 Q17 11 13 17 Q9 12 3 17Z" fill="#fff" stroke="#bcd9ee" strokeWidth="0.8" />
          <circle cx="12" cy="8" r="1" fill="#cfe3f4" /><circle cx="26" cy="7" r="1.2" fill="#cfe3f4" />
        </svg>
      )}
      {deco === 'scarf' && (
        <svg viewBox="0 0 40 46" className="absolute" style={{ width: size * 0.92, left: size * 0.04, top: size * 0.52 }}>
          <path d="M2 4 Q20 16 38 4 L37 12 Q20 24 3 12Z" fill="#2a7fc4" />
          <path d="M9 8.5 L8.5 15.5 M17 11 L16.6 18 M25 11 L25.2 18 M32 8.5 L32.6 15.5" stroke="#e3f1fc" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M27 17 L35 15 L37 33 L29 35Z" fill="#2a7fc4" /><path d="M28.2 25 L36.2 23" stroke="#e3f1fc" strokeWidth="1.6" /><path d="M29 32 L37 30" stroke="#e3f1fc" strokeWidth="1.6" />
        </svg>
      )}
    </span>
  )
}

function Avatar({ name, url, size = 28 }: { name: string; url: string | null; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (url) return <img src={url} alt="" width={size} height={size} className="rounded-full object-cover flex-shrink-0 ring-2 ring-[#bfe3fb] dark:ring-white/20" style={{ width: size, height: size }} />
  return <span className="rounded-full bg-[#d7ebfa] text-[#0b3a6b] dark:bg-[#12315f] dark:text-[#bfe3fb] font-black flex items-center justify-center flex-shrink-0 ring-2 ring-[#bfe3fb] dark:ring-white/20" style={{ width: size, height: size, fontSize: size * 0.42 }}>{name.slice(0, 1).toUpperCase()}</span>
}

function Section({ title, sub, icon = '❄', deco, children }: { title: string; sub?: string; icon?: string; deco?: CoinDeco; children: React.ReactNode }) {
  return (
    <section className={`${CARD} rc-snowcap mt-1 pt-0.5`}>
      <div className={`px-4 pt-3.5 pb-1.5 ${deco ? 'pr-[4.2rem]' : ''}`}>
        {deco && <div className="pointer-events-none absolute right-3.5 top-4"><WildiCoin deco={deco} size={38} bob /></div>}
        <h2 className="font-display text-[1.6rem] font-bold uppercase leading-tight tracking-wide"><span className={`${ACCENT} mr-1.5`} aria-hidden>{icon}</span>{title}</h2>
        {sub && <p className={`text-xs ${MUTED}`}>{sub}</p>}
      </div>
      {children}
    </section>
  )
}

/** Eine Spielzeile mit Vereinslogos (ohne Logos fällt sie auf den Text zurück). */
function MatchRow({ leg, label }: { leg: Pick<TipLeg, 'teams'> & { match: string }; label?: string }) {
  if (!leg.teams) return <span className="text-xs font-semibold">{label ?? leg.match}</span>
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold">
      <span className="inline-flex items-center gap-1.5"><TeamLogo name={leg.teams.home} size="sm" />{leg.teams.home}</span>
      <span className={MUTED}>–</span>
      <span className="inline-flex items-center gap-1.5"><TeamLogo name={leg.teams.away} size="sm" />{leg.teams.away}</span>
    </span>
  )
}

function LegList({ legs }: { legs: TipLeg[] }) {
  return (
    <ul className="space-y-2">{legs.map((l, i) => (
      <li key={i} className={`rounded-lg px-2 py-1.5 ${l.highlight ? 'bg-[#e3f1fc] dark:bg-white/10' : ''}`}>
        <MatchRow leg={l} />
        <div className={`mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs ${l.highlight ? 'font-bold' : MUTED}`}>
          <span>{l.status === 'lost' ? '✗' : l.status === 'won' ? '✓' : '·'} {l.market}: <b>{l.selection}</b></span><span className="opacity-60">@{f2(l.odds)}</span>{l.highlight && <span className={ACCENT}>← der mutige Tipp</span>}
        </div>
      </li>
    ))}</ul>
  )
}

type Person = (id: string) => { name: string; avatarUrl: string | null }

/** Karte für einen Schein: Gewinn groß, Quote/Einsatz/Auszahlung klein, ein Satz, Details aufklappbar. */
function TipCardView({ c, label, person }: { c: TipCard; label: string; person?: Person }) {
  const p = person ? person(c.userId) : null
  const single = c.kind === 'single' ? c.legs[0] : null
  return (
    <div className="px-4 py-4">
      <div className={`text-[11px] font-bold uppercase tracking-widest ${ACCENT}`}>{label}</div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {p && <Avatar name={p.name} url={p.avatarUrl} size={30} />}
          <div className="min-w-0">
            {p && <div className="truncate font-bold leading-tight">{p.name}</div>}
            <div className={`text-xs ${MUTED}`}>{c.kind === 'combo' ? `${c.legs.length}er-Kombi` : 'Einzelwette'}{c.matchday != null ? ` · Spieltag ${c.matchday}` : ''}</div>
          </div>
        </div>
        <div className="text-right leading-none">
          <div className={`font-display text-[2.6rem] font-bold ${ACCENT}`}>{c.payout > 0 ? sgn(c.net) : '–'}</div>
          <div className={`text-[10px] uppercase tracking-wide ${MUTED}`}>Wildis Gewinn</div>
        </div>
      </div>
      {single && (
        <div className={`${CHIP} mt-2.5 px-2.5 py-2`}>
          <MatchRow leg={single} />
          <div className={`mt-0.5 text-xs ${MUTED}`}>{single.market}: <b>{single.selection}</b></div>
        </div>
      )}
      <p className={`mt-2 text-sm ${MUTED}`}>{firstSentence(c.why)}</p>
      <div className={`mt-1.5 text-[11px] ${MUTED}`}>Quote {f2(c.odds)} · Einsatz {f0(c.stake)}{c.payout > 0 ? ` · Auszahlung ${f0(c.payout)}` : ''}</div>
      {c.kind === 'combo' && (
        <details className="mt-1.5">
          <summary className={`cursor-pointer list-none text-xs font-semibold ${ACCENT}`}>▸ {c.legs.length} Tipps anzeigen</summary>
          <div className="mt-1.5"><LegList legs={c.legs} /></div>
        </details>
      )}
    </div>
  )
}

/** Kachel im persönlichen Bereich. */
function Tile({ label, big, unit, note, children, wide }: { label: string; big: React.ReactNode; unit?: string; note?: string; children?: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`${CHIP} p-3 ${wide ? 'col-span-2' : ''}`}>
      <div className={`text-[10px] font-bold uppercase tracking-widest ${ACCENT}`}>{label}</div>
      <div className={`mt-1 font-display text-4xl font-bold leading-none ${ACCENT}`}>{big}</div>
      {unit && <div className={`text-[10px] uppercase tracking-wide ${MUTED}`}>{unit}</div>}
      {note && <p className="mt-1 text-xs leading-snug">{note}</p>}
      {children}
    </div>
  )
}

function Personal({ r, personal, myId }: { r: RecapReport; personal: PersonalTips | null; myId: string }) {
  const me = r.people[myId]
  const iq = r.iq.find((x) => x.userId === myId)
  const name = me?.name ?? 'dir'
  const p = personal
  const has = !!(p && p.best)
  const same = !!(p?.best && p.biggestWin && p.best.slipKey === p.biggestWin.slipKey)
  const legsOf = (c: TipCard) => (
    <details className="mt-1.5"><summary className={`cursor-pointer list-none text-xs font-semibold ${ACCENT}`}>▸ {c.kind === 'combo' ? `${c.legs.length} Tipps` : 'Spiel'}</summary><div className="mt-1.5"><LegList legs={c.legs} /></div></details>
  )
  return (
    <section className={`${CARD} rc-snowcap mt-1 overflow-hidden border-[#8fd3ff] ring-1 ring-[#8fd3ff]/60 dark:border-[#8fd3ff]/40`}>
      <div className="bg-gradient-to-r from-[#e3f1fc] to-white px-4 pb-2.5 pt-4 dark:from-[#12315f]/60 dark:to-transparent">
        <h2 className="font-display text-[1.7rem] font-bold uppercase leading-tight tracking-wide"><span className={`${ACCENT} mr-1.5`} aria-hidden>⛄</span>Deine Winterpause</h2>
        <div className={`mt-0.5 flex items-center gap-1.5 text-sm ${MUTED}`}><Avatar name={name} url={me?.avatarUrl ?? null} size={22} /><span>{name} · nur für dich</span></div>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3">
        <Tile label="Dein Tipper-IQ" big={iq ? iq.iq.toFixed(1).replace('.', ',') : '–'} unit={iq?.eligible ? `Platz ${iq.rank} von ${r.iq.filter((x) => x.eligible).length}` : 'noch nicht gewertet'}
          note={iq && !iq.eligible ? `Dir fehlen ${[iq.slipsConsidered < IQ_MIN_SLIPS ? `${IQ_MIN_SLIPS - iq.slipsConsidered} Wettscheine` : null, iq.activeMatchdays < IQ_MIN_MATCHDAYS ? `${IQ_MIN_MATCHDAYS - iq.activeMatchdays} aktive Spieltage` : null].filter(Boolean).join(' und ')}.` : undefined} />
        {has && p!.best ? (
          <Tile label="Dein bester Tipp" big={sgn(p!.best.net)} unit="Wildis Gewinn" note={`Quote ${f2(p!.best.odds)}`}>{legsOf(p!.best)}</Tile>
        ) : <Tile label="Dein bester Tipp" big="–" note={p && p.settledSlips > 0 ? 'Noch kein Gewinnschein – die Rückrunde kommt. 🍀' : 'Keine abgerechneten Scheine.'} />}
        {p?.biggestWin && <Tile label="Dein größter Gewinn" big={sgn(p.biggestWin.net)} unit="Wildis" note={same ? 'Das war auch dein bester Tipp.' : `Quote ${f2(p.biggestWin.odds)}`}>{!same && legsOf(p.biggestWin)}</Tile>}
        {p?.nearMiss ? <Tile label="Knappster Beinahe-Treffer" big={f0(p.nearMiss.missedNet)} unit="Wildis entgangen" note="Nur ein Tipp fehlte.">{legsOf(p.nearMiss.card)}</Tile> : null}
        {p?.favoriteTeam && (
          <Tile wide label="Dein Lieblings-Team" big={<span className="flex items-center gap-2 text-3xl"><TeamLogo name={p.favoriteTeam.name} size="md" />{p.favoriteTeam.name}</span>} note={`Auf deren Sieg hast du am häufigsten getippt (${p.favoriteTeam.tips}×).`} />
        )}
      </div>
    </section>
  )
}

const AWARD_LINE: Record<string, string> = {
  wildi_magnet: 'Am meisten Wildis verdient.',
  hall_der_ehre: 'Wildenroth-Spiele auf Sieg getippt – nie dagegen.',
  hall_der_schande: 'Am meisten mit Wetten gegen Wildenroth gewonnen.',
  senkrechtstarter: 'Am weitesten in der Rangliste nach oben geklettert.',
  aussenseiter_jaeger: 'Am häufigsten Quote 5,00 oder höher getroffen.',
  kombi_pech: 'Kombis, bei denen nur ein einziger Tipp fehlte.',
}

/** „+14.421 Wildis“ → groß „+14.421“ + klein „Wildis“; „14 verschiedene Spiele“ → „14“ + „verschiedene Spiele“. */
function splitValue(v: string): { big: string; unit: string } {
  const pl = v.match(/^Platz (\d+ → \d+)$/)
  if (pl) return { big: pl[1], unit: 'Plätze' }
  const m = v.match(/^([+−-]?[\d.,]+×?)\s+(.*)$/) ?? v.match(/^([+−-]?[\d.,]+×)()$/)
  return m ? { big: m[1], unit: m[2] ?? '' } : { big: v, unit: '' }
}

/** Gleichstand: alle Einträge, die dieselbe ANGEZEIGTE Zahl wie der erste haben, sind gleichwertige Gewinner. */
const winnersOf = (entries: AwardEntry[]) => entries.filter((e) => e.value === entries[0].value)

function Winners({ r, winners }: { r: RecapReport; winners: AwardEntry[] }) {
  const nm = (id: string) => r.people[id]?.name ?? 'Unbekannt'
  return (
    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
      {winners.map((e) => (
        <div key={e.userId} className="flex min-w-0 items-center gap-1.5"><Avatar name={nm(e.userId)} url={r.people[e.userId]?.avatarUrl ?? null} size={winners.length > 1 ? 24 : 28} /><span className="truncate font-bold">{nm(e.userId)}</span></div>
      ))}
    </div>
  )
}

function AwardCard({ a, r, entries, title, icon, line, extra }: { a: AwardResult; r: RecapReport; entries: AwardEntry[]; title: string; icon: string; line: string; extra?: React.ReactNode }) {
  const nm = (id: string) => r.people[id]?.name ?? 'Unbekannt'
  const winners = winnersOf(entries)
  const rest = entries.filter((e) => e.value !== entries[0].value)
  const { big, unit } = splitValue(entries[0].value)
  const bl = a.bitterest && a.key === 'kombi_pech' ? r.slipLegs[a.bitterest.slipKey] : undefined
  const more = !!(entries[0].detail || rest.length || a.bitterest)
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#e3f1fc] text-xl dark:bg-white/10">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className={`text-[11px] font-bold uppercase tracking-widest ${ACCENT}`}>{title}{winners.length > 1 && <span className="ml-1.5 rounded bg-[#e3f1fc] px-1.5 py-0.5 text-[9px] tracking-wider dark:bg-white/10">Gleichstand</span>}</div>
          <Winners r={r} winners={winners} />
        </div>
        <div className="flex-shrink-0 text-right leading-none">
          <div className={`font-display text-[2rem] font-bold ${ACCENT}`}>{big}</div>
          {unit && <div className={`mt-0.5 max-w-[6.5rem] text-[10px] font-semibold leading-tight ${MUTED}`}>{unit}</div>}
        </div>
      </div>
      <p className={`mt-1.5 text-sm ${MUTED}`}>{line}</p>
      {extra}
      {more && (
        <details className="mt-1">
          <summary className={`cursor-pointer list-none text-xs font-semibold ${ACCENT}`}>▸ Mehr</summary>
          <div className={`mt-1.5 space-y-1.5 text-xs ${MUTED}`}>
            {entries[0].detail && <p>{entries[0].detail}</p>}
            {rest.length > 0 && <p>Dahinter: {rest.map((e) => `${nm(e.userId)} (${e.value})`).join(' · ')}</p>}
            {a.bitterest && (
              <div className={`${CHIP} p-2`}>
                <b>Bitterster Schein:</b> {nm(a.bitterest.userId)} – {a.bitterest.legs}er-Kombi @{f2(a.bitterest.odds)}, nur ein Tipp fehlte ({f0(a.bitterest.missedNet)} Wildis entgangen).
                {bl && <div className="mt-1"><LegList legs={bl.map((l) => ({ ...l }))} /></div>}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  )
}

function Awards({ r }: { r: RecapReport }) {
  const by = (k: string) => r.awards.find((a) => a.key === k)
  const cards: React.ReactNode[] = []
  for (const k of PUBLIC_AWARD_KEYS) {
    const a = by(k); if (!a || !a.entries.length) continue
    let line = AWARD_LINE[k] ?? a.question ?? ''
    if (k === 'senkrechtstarter' && a.period) { const m = a.entries[0].value.match(/Platz (\d+) → (\d+)/); if (m) line = `Von Platz ${m[1]} nach ${a.period} auf Platz ${m[2]} zur Winterpause.` }
    cards.push(<AwardCard key={k} a={a} r={r} entries={a.entries} title={a.title} icon={a.icon} line={line} />)
    if (k === 'hall_der_schande' && a.second && a.second.entries.length) cards.push(<AwardCard key="gegenwetten" a={a} r={r} entries={a.second.entries} title="Die meisten Gegenwetten" icon="🔁" line="Am häufigsten gegen Wildenroth gewettet – egal ob gewonnen oder verloren." />)
  }
  return <Section title="Die Awards" sub="Gleichstand? Dann stehen alle Gewinner gleichwertig da." deco="snowcap"><div className={DIVIDE}>{cards}</div></Section>
}

function KillerMatchCard({ r, id, label, line }: { r: RecapReport; id: number; label: string; line: string }) {
  return (
    <div className="px-4 py-3.5">
      <div className={`text-[11px] font-bold uppercase tracking-widest ${ACCENT}`}>{label}</div>
      <div className={`${CHIP} mt-1.5 px-2.5 py-2`}><MatchRow leg={{ match: r.matchLabels[id] ?? `Spiel #${id}`, teams: r.matchTeams[id] }} /></div>
      <p className="mt-1.5 text-sm">{line}</p>
    </div>
  )
}

function TeamHighlights({ r }: { r: RecapReport }) {
  const t = r.teams
  const maxSlips = t.mostBet[0]?.slips ?? 1
  const k = r.killers.killer, pr = r.killers.priciest
  const same = !!(k && pr && k.matchId === pr.matchId)
  return (
    <Section title="Team-Highlights" icon="🏔️" deco="scarf">
      <div className={DIVIDE}>
        {t.mostBet.length > 0 && (
          <div className="px-4 py-3.5">
            <div className={`text-[11px] font-bold uppercase tracking-widest ${ACCENT}`}>Meistgewettete Teams <span className="font-semibold normal-case tracking-normal opacity-70">· Wettscheine</span></div>
            <ul className="mt-2 space-y-2">{t.mostBet.map((x, i) => (
              <li key={x.teamId} className="flex items-center gap-2.5">
                <span className={`w-4 text-center font-display text-lg font-bold ${MUTED}`}>{i + 1}</span>
                <TeamLogo name={x.name} size="md" />
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{x.name}</div><div className="mt-0.5 h-1.5 rounded-full bg-[#e3f1fc] dark:bg-white/10"><div className="h-full rounded-full bg-[#2a7fc4] dark:bg-[#8fd3ff]" style={{ width: `${Math.max(8, (x.slips / maxSlips) * 100)}%` }} /></div></div>
                <span className={`font-display text-xl font-bold ${ACCENT}`}>{f0(x.slips)}</span>
              </li>))}</ul>
          </div>
        )}
        {t.worstToBet && (
          <div className="px-4 py-3.5">
            <div className={`text-[11px] font-bold uppercase tracking-widest ${ACCENT}`}>Schlechtestes Team zum Wetten</div>
            <div className="mt-1.5 flex items-center gap-3"><TeamLogo name={t.worstToBet.name} size="lg" /><div className="min-w-0"><div className="truncate font-bold">{t.worstToBet.name}</div><div className="flex items-baseline gap-1.5"><span className={`font-display text-4xl font-bold leading-none ${ACCENT}`}>{t.worstToBet.hit} von {t.worstToBet.tips}</span><span className={`text-sm ${MUTED}`}>Siegtipps gingen auf</span></div></div></div>
          </div>
        )}
        {k && <KillerMatchCard r={r} id={k.matchId} label={same ? 'Kombi-Killer & teuerstes Spiel' : 'Kombi-Killer-Spiel'} line={same ? `${k.combos} sonst richtige Kombis scheiterten hier – ${f0(k.potentialNet)} Wildis Gewinn entgangen.` : `${k.combos} sonst richtige Kombis scheiterten hier an genau diesem Tipp.`} />}
        {pr && !same && <KillerMatchCard r={r} id={pr.matchId} label="Teuerstes Spiel der Hinrunde" line={`${f0(pr.potentialNet)} Wildis Gewinn entgingen den Tippern hier.`} />}
        {t.wildenroth.length > 0 && (
          <div className="px-4 py-3.5">
            <div className={`text-[11px] font-bold uppercase tracking-widest ${ACCENT}`}>Wildenroth im Tippspiel</div>
            <div className="mt-2 grid grid-cols-2 gap-2">{t.wildenroth.map((w) => (
              <div key={w.teamId} className={`${CHIP} p-2.5`}>
                <div className="flex items-center gap-1.5"><TeamLogo name={w.name} size="sm" /><span className="truncate text-xs font-bold">{w.name.replace('SpVgg ', '')}</span></div>
                <div className={`mt-1.5 font-display text-3xl font-bold leading-none ${ACCENT}`}>{w.winTips > 0 ? Math.round((w.winHit / w.winTips) * 100) : 0} %</div>
                <div className={`text-[10px] ${MUTED}`}>der {f0(w.winTips)} Siegtipps gingen auf</div>
                {w.againstTips > 0 && <div className="mt-1 text-[11px]">Dagegen: {f0(w.againstTips)} Tipps, {Math.round((w.againstHit / w.againstTips) * 100)} % gingen auf</div>}
              </div>))}</div>
          </div>
        )}
      </div>
    </Section>
  )
}

function IqSection({ r, myId }: { r: RecapReport; myId: string }) {
  const rated = r.iq.filter((x) => x.eligible)
  const unrated = r.iq.filter((x) => !x.eligible)
  const me = r.iq.find((x) => x.userId === myId)
  const nm = (id: string) => r.people[id]?.name ?? 'Unbekannt'
  const max = Math.max(100, ...rated.map((x) => x.iq))
  const medal = (rank: number) => rank === 1 ? 'bg-[#ffd54a] text-[#4a3500]' : rank === 2 ? 'bg-[#dfe7ee] text-[#33475b]' : rank === 3 ? 'bg-[#e8b98a] text-[#4a2a0b]' : 'bg-[#e3f1fc] text-[#33567a] dark:bg-white/10 dark:text-[#bfe3fb]'
  const row = (x: TipperIqResult) => (
    <details key={x.userId} className={x.userId === myId ? 'bg-[#e3f1fc]/70 dark:bg-white/10' : ''}>
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-2.5">
        <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-black ${medal(x.rank ?? 99)}`}>{x.rank}</span>
        <Avatar name={nm(x.userId)} url={r.people[x.userId]?.avatarUrl ?? null} size={28} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5"><span className="min-w-0 max-w-full truncate text-sm font-semibold">{nm(x.userId)}</span>{x.userId === myId && <span className="rounded bg-[#1565a8] px-1.5 py-0.5 text-[10px] font-bold text-white">Du</span>}{x.rank === 1 && <span className="rounded bg-[#fff3c4] px-1.5 py-0.5 text-[10px] font-bold text-[#8a5a00] dark:bg-amber-300/20 dark:text-amber-200">🧠 Quotenflüsterer</span>}</span>
          <span className="mt-1 block h-1.5 rounded-full bg-[#e3f1fc] dark:bg-white/10"><span className="block h-full rounded-full bg-gradient-to-r from-[#2a7fc4] to-[#8fd3ff]" style={{ width: `${Math.max(6, (x.iq / max) * 100)}%` }} /></span>
        </span>
        <span className={`font-display text-3xl font-bold leading-none ${ACCENT}`}>{x.iq.toFixed(1).replace('.', ',')}</span>
      </summary>
      <div className={`px-4 pb-3 pl-[4.2rem] text-xs ${MUTED}`}><ul className="space-y-0.5">{explainIq(x).map((l) => <li key={l}>· {l}</li>)}</ul></div>
    </details>
  )
  const top = rated.slice(0, 5)
  const rest = rated.slice(5)
  const bar = (v: number, of: number) => <span className="mt-0.5 block h-1.5 rounded-full bg-white/70 dark:bg-white/10"><span className="block h-full rounded-full bg-[#2a7fc4] dark:bg-[#8fd3ff]" style={{ width: `${Math.min(100, (v / of) * 100)}%` }} /></span>
  return (
    <Section title="Tipper-IQ" sub="Wer tippt am klügsten – nicht nur am glücklichsten?" icon="🧠" deco="scarf">
      <div className="space-y-2.5 px-4 pb-3">
        <p className="text-sm leading-snug"><b>Was ist der Tipper-IQ?</b> Er misst, wie klug du tippst: Wie oft hast du getroffen – verglichen damit, wie oft das bei diesen Quoten zu erwarten war? 50 Punkte = genau so viel wie erwartet, mehr = besser als der Zufall. Dein <b>persönlicher Wert</b> steht gleich darunter in „Deine Winterpause“.</p>
        <div className="flex items-start gap-2 rounded-xl border border-[#9fd0f2] bg-[#e3f1fc] px-3 py-2.5 text-sm font-semibold text-[#0b3a6b] dark:border-[#8fd3ff]/30 dark:bg-[#8fd3ff]/10 dark:text-[#cfeaff]">
          <span aria-hidden>ℹ️</span><span>Offizielle Wertung ab {IQ_MIN_SLIPS} abgerechneten Wettscheinen und {IQ_MIN_MATCHDAYS} aktiven Spieltagen.</span>
        </div>
        {me && !me.eligible && (
          <div className="rounded-xl border border-[#8fd3ff] bg-gradient-to-br from-[#e3f1fc] to-white px-3 py-2 dark:from-[#12315f]/60 dark:to-transparent dark:border-[#8fd3ff]/40">
            <div className="flex items-center justify-between gap-3">
              <div><div className={`text-[10px] font-bold uppercase tracking-widest ${ACCENT}`}>Dein Tipper-IQ</div><div className={`text-xs ${MUTED}`}>{me.eligible ? `Platz ${me.rank} von ${rated.length}` : 'noch nicht gewertet'}</div></div>
              <div className={`font-display text-4xl font-bold leading-none ${ACCENT}`}>{me.iq.toFixed(1).replace('.', ',')}</div>
            </div>
            {!me.eligible && (
              <div className="mt-2 grid grid-cols-2 gap-3 text-[11px]">
                <div>Wettscheine {me.slipsConsidered}/{IQ_MIN_SLIPS}{bar(me.slipsConsidered, IQ_MIN_SLIPS)}</div>
                <div>Aktive Spieltage {me.activeMatchdays}/{IQ_MIN_MATCHDAYS}{bar(me.activeMatchdays, IQ_MIN_MATCHDAYS)}</div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className={`${DIVIDE} border-t border-[#e3eef8] dark:border-white/10`}>{top.map(row)}</div>
      {rest.length > 0 && (
        <details className="border-t border-[#e3eef8] dark:border-white/10" open={rest.some((x) => x.userId === myId)}>
          <summary className={`cursor-pointer px-4 py-3 text-sm font-semibold ${ACCENT}`}>Alle {rated.length} gewerteten Tipper anzeigen</summary>
          <div className={DIVIDE}>{rest.map(row)}</div>
        </details>
      )}
      {unrated.length > 0 && <p className={`border-t border-[#e3eef8] px-4 py-3 text-xs dark:border-white/10 ${MUTED}`}><b>{unrated.length} weitere Tipper</b> sind noch nicht gewertet: Ihnen fehlen noch Wettscheine oder aktive Spieltage.</p>}
      <details className="border-t border-[#e3eef8] dark:border-white/10">
        <summary className={`cursor-pointer px-4 py-3 text-xs font-semibold ${MUTED}`}>So wird der Tipper-IQ berechnet</summary>
        <div className={`space-y-2 px-4 pb-4 text-xs ${MUTED}`}>
          <p>Jeder abgerechnete Wettschein hat eine Trefferchance aus der Quote. Der IQ vergleicht deine Treffer mit dem, was dafür zu erwarten wäre – exakt gegen den Zufall gerechnet. 50 Punkte = genau so viel getroffen wie erwartet. <i>Ein spielerischer Qualitätsindex, kein wissenschaftliches Maß.</i></p>
          <ul className="list-disc space-y-0.5 pl-5">
            <li><b>45 %</b> Trefferqualität über der Erwartung</li><li><b>20 %</b> Konstanz über die Spieltage</li>
            <li><b>20 %</b> Schwere Treffer (Quote ab 3,00 und 5,00)</li><li><b>15 %</b> Robustheit ohne den besten Spieltag</li>
          </ul>
          <p>Gleiche Tipps in mehreren Scheinen zählen anteilig. Stornierte und offene Scheine zählen nicht. Das Pokalspiel zählt mit allen Tipps, auch den Pokal-Bonus-Tipps.</p>
        </div>
      </details>
    </Section>
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
  const bt = r.bestTips
  const cancelled = b.cancelledByUser + b.voidNoReason + b.voidAdminUnavailable + b.voidOther + b.neutralized
  const awardsForRules = PUBLIC_AWARD_KEYS.map((k) => r.awards.find((a) => a.key === k)).filter((a): a is AwardResult => !!a)

  return (
    <div className="space-y-3 rounded-3xl bg-gradient-to-b from-[#e2f0fb] via-[#f1f8fe] to-white p-3 text-[#0b1f44] dark:from-[#050f26] dark:via-[#081a3a] dark:to-[#0b2148] dark:text-[#eaf4ff]">
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      {simulation && (
        <div className="rounded-xl border border-amber-500 bg-amber-100 px-3 py-2 text-xs text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">
          <b>🧪 Testvorschau</b> · Spieltag {r.range.to} simuliert ({simulation.matches} Spiele, {simulation.betRows} Wettzeilen), nichts wird gespeichert.
          <div className="mt-0.5 opacity-80">{simulation.databaseRef === 'fixtures' ? 'Datenquelle: Musterdaten (erfundene Daten), keine Datenbank.' : simulation.databaseRef === 'snapshot' ? 'Datenquelle: Echte Wildenroth-Daten (schreibgeschützter Snapshot, Spieltag 1–15), keine Datenbankverbindung.' : <>Datenquelle (nur lesend): Projekt <code>{simulation.databaseRef || '?'}</code></>}</div>
        </div>
      )}
      {!simulation && previewTo && <div className="rounded-xl bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">Admin-Zwischenstand – Daten nur bis Spieltag {previewTo}.</div>}

      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl p-5 pb-6 text-white shadow-lg" style={{ backgroundImage: 'radial-gradient(ellipse at 85% 0%, rgba(143,211,255,.35), transparent 55%), linear-gradient(160deg,#071a3d 0%,#0e3270 55%,#2a7fc4 100%)' }}>
        <Snow />
        <span className="rc-star absolute right-16 top-4 text-sm text-white" aria-hidden>✦</span>
        <div className="relative">
          <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#bfe3fb]">Saison 2026/27 · Hinrunde</div>
          <h1 className="font-display mt-1 text-[3.4rem] font-bold uppercase leading-[0.95] tracking-wide">Winter-<wbr />Recap</h1>
          <Snowman className="absolute -top-1 right-0 h-[6.2rem] opacity-95" />
          <div className="mt-5 grid grid-cols-3 gap-2 text-center">
            {([[f0(o.activeTippers), 'Tipper', false], [f0(b.total - cancelled), 'Wettscheine', false], [f0(o.settledStake), 'Wildis gesetzt', true]] as const).map(([v, l, coin]) => (
              <div key={l} className="rounded-2xl py-2.5 backdrop-blur-sm" style={{ backgroundColor: 'rgba(255,255,255,.13)' }}>
                <div className="flex items-center justify-center gap-1">{coin && <WildiCoin size={22} />}<span className="font-display text-3xl font-bold leading-none">{v}</span></div>
                <div className="mt-1 text-[10px] uppercase tracking-wide text-[#cfeaff]">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <IqSection r={r} myId={myId} />

      <Personal r={r} personal={personal} myId={myId} />

      <Section title="Die besten Tipps der Hinrunde" sub="Für alle gleich – nicht nur nach Auszahlung bewertet." icon="🏆" deco="hat">
        <div className={DIVIDE}>
          {bt.single && <TipCardView c={bt.single} label="🎯 Beste Einzelwette" person={person} />}
          {bt.combo && <TipCardView c={bt.combo} label="👑 Beste Kombi" person={person} />}
          {bt.bold && <TipCardView c={bt.bold} label="🧩 Mutigster Treffer" person={person} />}
          {!bt.single && !bt.combo && !bt.bold && <p className="p-4 text-sm">Noch keine gewonnenen Scheine.</p>}
        </div>
      </Section>

      <Awards r={r} />
      <TeamHighlights r={r} />

      <details className={CARD}>
        <summary className={`cursor-pointer px-4 py-3 text-xs font-semibold ${MUTED}`}>Genaue Regeln</summary>
        <div className={`space-y-1.5 px-4 pb-4 text-xs ${MUTED}`}>
          <p>Gezählt werden alle abgerechneten Wettscheine der Spieltage {r.range.from}–{r.range.to}; Kombi-Einsätze einmal. Stornierte und offene Scheine zählen nicht, neutralisierte Legs werden ignoriert. Das Pokalspiel zählt vollständig. Gelöschte Konten werden nicht genannt.</p>
          <ul className="space-y-1">{awardsForRules.map((a) => <li key={a.key}><b>{a.title}:</b> {a.rule}</li>)}</ul>
        </div>
      </details>

      <div className="flex flex-col items-center gap-1.5 pb-2 pt-1" aria-hidden>
        <div className="flex items-end gap-4"><WildiCoin deco="snowcap" size={34} bob /><WildiCoin deco="hat" size={40} bob className="-mb-0.5" /><WildiCoin deco="scarf" size={34} bob /></div>
        <div className={`font-display text-sm uppercase tracking-[0.25em] ${MUTED}`}>Schöne Winterpause!</div>
      </div>
    </div>
  )
}
