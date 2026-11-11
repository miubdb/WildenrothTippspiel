import { isSettled, type Slip, type RecapMatchRow } from '@/lib/recap/slips'
import type { TipperIqResult } from '@/lib/recap/tipperIq'
import { computeOptimists, computeWildenrothRecords } from '@/lib/recap/wildenrothStance'
import {
  bestComebacks, computeTrajectories, findBetTwins, findCancelRegrets, findCleverHits, findNearMisses,
  lastMinuteWins, lateBloomers, mondayMorningStats, biggestNetLosers, leadTimeStats, longestStreaks, nightOwlStats, rateBestTips, type MatchdayRange,
} from '@/lib/recap/hinrundeStats'

/**
 * Halbzeit-Awards. Jeder Award wird ausschließlich aus echten Daten abgeleitet und nur vergeben,
 * wenn seine Mindest-Stichprobe erfüllt ist – sonst fehlt er (kein erfundener Gewinner).
 * Gelöschte Konten (`excluded`) werden weder genannt noch gewertet.
 *
 * Getrennte Kategorien (bewusst verschiedene Gewinner möglich):
 *  · bester Tipper      = Quotenflüsterer (Tipper-IQ)
 *  · größter Gewinner   = Wildi-Magnet (höchstes Netto)
 *  · bester einzelner Tipp = „Bester Tipp der Hinrunde" (eigener Block, kein Award)
 */

export interface AwardEntry { userId: string; value: string; detail?: string }
export interface AwardResult {
  key: string
  title: string
  icon: string
  kind: 'main' | 'fun'
  /** Eine Zeile, was der Award misst (sichtbar in der UI, damit niemand rätseln muss). */
  rule: string
  /** Gewinner zuerst, danach bis zu zwei Plätze dahinter. */
  entries: AwardEntry[]
}

const wildi = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString('de-DE', { maximumFractionDigits: 0 })} Wildis`
const dur = (sec: number) => (sec < 120 ? `${Math.round(sec)} Sekunden` : sec < 7200 ? `${Math.round(sec / 60)} Minuten` : sec < 172800 ? `${(sec / 3600).toFixed(1).replace('.', ',')} Stunden` : `${(sec / 86400).toFixed(1).replace('.', ',')} Tage`)

export interface AwardInput {
  rangeSlips: Slip[]
  allSlips: Slip[]
  matches: RecapMatchRow[]
  iq: TipperIqResult[]
  range: MatchdayRange
  excluded: Set<string>
}

export function computeHalbzeitAwards(inp: AwardInput): AwardResult[] {
  const { rangeSlips, allSlips, matches, iq, range, excluded } = inp
  const slips = rangeSlips.filter((s) => !excluded.has(s.userId))
  const settled = slips.filter(isSettled)
  const out: AwardResult[] = []
  const add = (a: AwardResult | null) => { if (a && a.entries.length) out.push(a) }
  const top = <T,>(arr: T[], n: number, f: (x: T) => AwardEntry): AwardEntry[] => arr.slice(0, n).map(f)

  // 1 Quotenflüsterer – bester Tipper nach Tipper-IQ (nur gewertete)
  const rated = iq.filter((r) => r.eligible && !excluded.has(r.userId))
  add({ key: 'quotenfluesterer', title: 'Quotenflüsterer', icon: '🧠', kind: 'main', rule: 'Höchster Tipper-IQ (mind. 18 abgerechnete Scheine, 10 aktive Spieltage)',
    entries: top(rated, 3, (r) => ({ userId: r.userId, value: `IQ ${r.iq.toFixed(1).replace('.', ',')}`, detail: `${r.wonSlips} Treffer, ${r.expectedHits.toFixed(1).replace('.', ',')} erwartet` })) })

  // 2 Wildi-Magnet – höchstes Netto
  const netBy = new Map<string, number>()
  for (const s of settled) netBy.set(s.userId, (netBy.get(s.userId) ?? 0) + s.net)
  const byNet = [...netBy.entries()].sort((a, b) => b[1] - a[1])
  add({ key: 'wildi_magnet', title: 'Wildi-Magnet', icon: '🧲', kind: 'main', rule: 'Höchstes Netto (Auszahlung − Einsatz) über alle abgerechneten Scheine',
    entries: byNet.slice(0, 3).filter(([, n]) => n > 0).map(([userId, n]) => ({ userId, value: wildi(n) })) })

  // 3 Jackpot-König – bester Kombi-Treffer
  const tips = rateBestTips(allSlips, rangeSlips, excluded)
  add({ key: 'jackpot_koenig', title: 'Jackpot-König', icon: '👑', kind: 'main', rule: 'Bester gewonnener Kombischein (Quote, Gewinn, Außenseiter-Anteil, Legs)',
    entries: top(tips.combo, 3, (t) => ({ userId: t.slip.userId, value: `Quote ${t.slip.odds.toFixed(2).replace('.', ',')}`, detail: `${t.slip.legs} Legs · ${wildi(t.slip.net)} · Spieltag ${t.slip.matchday}` })) })

  // 4 Einzelwetten-König – bestes Netto aus Einzelwetten (mind. 8 abgerechnete Einzelwetten)
  const singleNet = new Map<string, { n: number; net: number }>()
  for (const s of settled.filter((x) => x.kind === 'single')) { const e = singleNet.get(s.userId) ?? { n: 0, net: 0 }; e.n++; e.net += s.net; singleNet.set(s.userId, e) }
  const sk = [...singleNet.entries()].filter(([, e]) => e.n >= 8 && e.net > 0).sort((a, b) => b[1].net - a[1].net)
  add({ key: 'einzelwetten_koenig', title: 'Einzelwetten-König', icon: '🎯', kind: 'main', rule: 'Höchstes Netto nur aus Einzelwetten (mind. 8 abgerechnete)',
    entries: top(sk, 3, ([userId, e]) => ({ userId, value: wildi(e.net), detail: `${e.n} Einzelwetten` })) })

  // 5 Senkrechtstarter – größte Rangverbesserung seit dem frühen Abschnitt
  const traj = computeTrajectories(settled, excluded)
  const early = Math.max(2, Math.ceil((range.to - range.from + 1) / 3))
  const lb = lateBloomers(traj, early)
  add({ key: 'senkrechtstarter', title: 'Senkrechtstarter', icon: '🚀', kind: 'main', rule: `Größte Rangverbesserung (kumulatives Netto) vom Ende von Spieltag ${traj.matchdays[Math.min(early, traj.matchdays.length) - 1] ?? '?'} bis zum Endstand`,
    entries: top(lb, 3, (x) => ({ userId: x.userId, value: `Platz ${x.earlyRank} → ${x.finalRank}`, detail: `+${x.gain} Plätze` })) })

  // 6/7 Hall der Ehre / Schande
  const wr = computeWildenrothRecords(settled, matches, 'all')
  const loyal = [...wr.values()].filter((r) => r.win.matches >= 5 && r.against.legs === 0)
    .sort((a, b) => b.win.matches - a.win.matches || b.win.legsHit - a.win.legsHit)
  add({ key: 'hall_der_ehre', title: 'Hall der Ehre', icon: '💚', kind: 'main', rule: 'Meiste Wildenroth-Spiele (I + II) mit Siegtipp, ohne je eine Gegenwette (mind. 5 Spiele)',
    entries: top(loyal, 3, (r) => ({ userId: r.userId, value: `${r.win.matches} Siegtipps`, detail: `${r.win.legsHit} davon aufgegangen · ${r.supportive.legs} weitere Pro-Tipps (z. B. Torschützen)` })) })
  const traitors = [...wr.values()].filter((r) => r.against.legsHit >= 2 && r.againstBalance > 0).sort((a, b) => b.againstBalance - a.againstBalance)
  add({ key: 'hall_der_schande', title: 'Hall der Schande', icon: '😈', kind: 'main', rule: 'Erfolgreichste Wetten gegen Wildenroth I/II (Gesamtsaldo inkl. erfolgloser Gegenwetten; Kombi-Anteile rechnerisch zugeordnet; mind. 2 aufgegangene Gegen-Tipps)',
    entries: top(traitors, 3, (r) => ({ userId: r.userId, value: wildi(r.againstBalance), detail: `direkt (Einzelwetten) ${wildi(r.against.directNet)} · zugeordnet aus Kombis ${wildi(r.against.attributedComboNet)} · ${r.against.legsHit}/${r.against.legs} Gegen-Tipps aufgegangen` })) })

  // 8 Kombi-Fluch – meiste „nur ein Tipp falsch"-Kombis (≥ 3 Legs)
  const nm = findNearMisses(slips)
  const curse = new Map<string, { n: number; potential: number }>()
  for (const m of nm) { const e = curse.get(m.slip.userId) ?? { n: 0, potential: 0 }; e.n++; e.potential += m.potentialPayout; curse.set(m.slip.userId, e) }
  const cl = [...curse.entries()].filter(([, e]) => e.n >= 3).sort((a, b) => b[1].n - a[1].n || b[1].potential - a[1].potential)
  add({ key: 'kombi_fluch', title: 'Kombi-Fluch', icon: '💔', kind: 'main', rule: 'Meiste verlorene Kombis (≥ 3 Legs), bei denen genau ein Tipp gefehlt hat (mind. 3)',
    entries: top(cl, 3, ([userId, e]) => ({ userId, value: `${e.n}× knapp daneben`, detail: `entgangene Auszahlungen zusammen ${e.potential.toLocaleString('de-DE', { maximumFractionDigits: 0 })} Wildis (gedeckelt)` })) })

  // 9 Stehaufmännchen – größte Erholung vom Tiefpunkt
  const cb = bestComebacks(traj)
  add({ key: 'stehaufmaennchen', title: 'Stehaufmännchen', icon: '🪀', kind: 'main', rule: 'Größte Erholung vom tiefsten kumulativen Stand bis zum Endstand (Tiefpunkt im Minus)',
    entries: top(cb, 3, (c) => ({ userId: c.userId, value: wildi(c.recovered), detail: `Tiefpunkt ${wildi(c.lowPoint)} nach Spieltag ${c.lowMatchday}, Endstand ${wildi(c.finalNet)}` })) })

  // 10 Scharfschütze – meiste aufgegangene Präzisionstipps (Ergebnis, Torschütze)
  const prec = new Map<string, number>()
  for (const s of settled) for (const l of s.legs) if (l.status === 'won' && (l.marketType === 'exact_score' || l.marketType === 'goalscorer' || l.marketType === 'goalscorer_2plus')) prec.set(s.userId, (prec.get(s.userId) ?? 0) + 1)
  const pl = [...prec.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1])
  add({ key: 'scharfschuetze', title: 'Scharfschütze', icon: '🔭', kind: 'main', rule: 'Meiste aufgegangene Präzisionstipps (exaktes Ergebnis, Torschütze, 2+ Tore) – als Einzelwette oder Kombi-Leg (mind. 3)',
    entries: top(pl, 3, ([userId, n]) => ({ userId, value: `${n} Treffer` })) })

  // ── Spaß-Auszeichnungen ──
  const lead = leadTimeStats(slips, excluded).sort((a, b) => b.medianLeadSeconds - a.medianLeadSeconds)
  add({ key: 'fruehbucher', title: 'Frühbucher', icon: '🗓️', kind: 'fun', rule: 'Längster mittlerer (Median) Abstand zwischen Tipp und Anstoß (mind. 10 Scheine)',
    entries: top(lead, 3, (l) => ({ userId: l.userId, value: dur(l.medianLeadSeconds), detail: `${l.slips} Scheine` })) })
  add({ key: 'last_minute_tipper', title: 'Last-Minute-Tipper', icon: '⏱️', kind: 'fun', rule: 'Kürzester mittlerer (Median) Abstand zwischen Tipp und Anstoß (mind. 10 Scheine)',
    entries: top([...lead].reverse(), 3, (l) => ({ userId: l.userId, value: dur(l.medianLeadSeconds), detail: `${l.slips} Scheine` })) })
  const lm = lastMinuteWins(settled, excluded)
  add({ key: 'last_minute_gewinntipp', title: 'Bester Last-Minute-Gewinntipp', icon: '⚡', kind: 'fun', rule: 'Gewonnener Schein, der am kürzesten vor Anstoß abgegeben wurde',
    entries: top(lm, 3, (w) => ({ userId: w.userId, value: `${dur(w.leadSeconds)} vor Anstoß`, detail: `Quote ${w.odds.toFixed(2).replace('.', ',')} · Spieltag ${w.matchday}` })) })
  const owl = nightOwlStats(slips, excluded).filter((o) => o.nightSlips >= 5)
  add({ key: 'nachteule', title: 'Nachteule', icon: '🦉', kind: 'fun', rule: 'Meiste Scheine, abgegeben zwischen 0:00 und 5:00 Uhr (deutsche Zeit; mind. 5)',
    entries: top(owl, 3, (o) => ({ userId: o.userId, value: `${o.nightSlips} Nachtscheine`, detail: `von ${o.slips}` })) })
  const hunter = new Map<string, number>()
  for (const s of settled) if (s.status === 'won' && s.odds >= 5) hunter.set(s.userId, (hunter.get(s.userId) ?? 0) + 1)
  add({ key: 'aussenseiter_jaeger', title: 'Außenseiter-Jäger', icon: '🏹', kind: 'fun', rule: 'Meiste gewonnene Scheine mit Quote ≥ 5,00 (mind. 3)',
    entries: top([...hunter.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]), 3, ([userId, n]) => ({ userId, value: `${n} Scheine ≥ 5,00` })) })
  const regrets = findCancelRegrets(allSlips.filter((s) => s.ownerMatchday != null && s.ownerMatchday >= range.from && s.ownerMatchday <= range.to), matches, excluded)
  add({ key: 'storno_fehler', title: 'Größter Storno-Fehler', icon: '🙈', kind: 'fun', rule: 'Selbst stornierter Schein, der gewonnen hätte (nur Märkte, die sich aus dem Endergebnis ergeben)',
    entries: top(regrets, 3, (r) => ({ userId: r.userId, value: `${r.potentialPayout.toLocaleString('de-DE', { maximumFractionDigits: 0 })} Wildis entgangen`, detail: `Quote ${r.odds.toFixed(2).replace('.', ',')}, Einsatz ${r.stake.toLocaleString('de-DE', { maximumFractionDigits: 0 })}` })) })
  const st = longestStreaks(slips, excluded)
  add({ key: 'verlustserie', title: 'Längste Verlustserie', icon: '🌧️', kind: 'fun', rule: 'Meiste verlorene Scheine in Folge (nach Anstoß geordnet; mind. 6)',
    entries: top(st.loss.filter((s) => s.length >= 6), 3, (s) => ({ userId: s.userId, value: `${s.length} in Folge` })) })
  add({ key: 'gewinnserie', title: 'Längste Gewinnserie', icon: '🔥', kind: 'fun', rule: 'Meiste gewonnene Scheine in Folge (nach Anstoß geordnet; mind. 3)',
    entries: top(st.win.filter((s) => s.length >= 3), 3, (s) => ({ userId: s.userId, value: `${s.length} in Folge` })) })
  const tw = findBetTwins(slips, excluded)
  if (tw.length) out.push({ key: 'wett_zwillinge', title: 'Wett-Zwillinge', icon: '👯', kind: 'fun', rule: 'Paar mit den meisten identischen Tipps (gleiches Spiel, Markt, Auswahl; mind. 15 gemeinsame von je ≥ 20)',
    entries: [{ userId: tw[0].a, value: `${Math.round(tw[0].jaccard * 100)} % Übereinstimmung`, detail: `${tw[0].shared} identische Tipps` }, { userId: tw[0].b, value: `${Math.round(tw[0].jaccard * 100)} % Übereinstimmung`, detail: `${tw[0].shared} identische Tipps` }] })
  const mon = mondayMorningStats(slips, excluded).filter((x) => x.mondayMorningSlips >= 4).sort((a, b) => b.mondayMorningSlips - a.mondayMorningSlips || b.mondayMorningSlips / b.slips - a.mondayMorningSlips / a.slips)
  add({ key: 'montagmorgen_manager', title: 'Montagmorgen-Manager', icon: '☕', kind: 'fun', rule: 'Meiste Scheine, abgegeben montags 6:00–11:59 Uhr (Europe/Berlin; mind. 4)',
    entries: top(mon, 3, (x) => ({ userId: x.userId, value: `${x.mondayMorningSlips} Montagmorgen-Scheine`, detail: `von ${x.slips}` })) })
  const losers = biggestNetLosers(settled.filter((x) => !x.isBonus), excluded).filter((x) => x.net < 0)
  add({ key: 'wildi_vernichter', title: 'Wildi-Vernichter', icon: '🔥', kind: 'fun', rule: 'Größter tatsächlicher Nettoverlust aus abgerechneten Scheinen (Auszahlung − Einsatz)',
    entries: top(losers, 3, (x) => ({ userId: x.userId, value: wildi(x.net), detail: `${x.settled} abgerechnete Scheine` })) })
  const opt = computeOptimists(settled, matches).filter((x) => x.lostWinTipMatches >= 3 && excluded.has(x.userId) === false)
  add({ key: 'ewiger_optimist', title: 'Ewiger Optimist', icon: '🌈', kind: 'fun', rule: 'Meiste Wildenroth-Spiele (I + II), in denen jeder Siegtipp des Tippers danebenging; danach: wie oft er nach einem solchen Reinfall wieder auf einen Wildenroth-Sieg setzte (mind. 3)',
    entries: top(opt, 3, (x) => ({ userId: x.userId, value: `${x.lostWinTipMatches} von ${x.winTipMatches} Siegtipp-Spielen verfehlt`, detail: `${x.backedAfterLoss}× danach erneut auf Wildenroth gesetzt` })) })
  const tragic = nm
  add({ key: 'tragischster_beinahe_gewinn', title: 'Tragischster Beinahe-Gewinn', icon: '😭', kind: 'fun', rule: 'Verlorene Kombi (≥ 3 Legs) mit nur einem falschen Tipp und der höchsten (gedeckelten) entgangenen Auszahlung',
    entries: top(tragic, 3, (m) => ({ userId: m.slip.userId, value: `${m.potentialPayout.toLocaleString('de-DE', { maximumFractionDigits: 0 })} Wildis verpasst`, detail: `${m.legsTotal} Legs, Quote ${m.slip.odds.toFixed(2).replace('.', ',')}, Spieltag ${m.slip.matchday}` })) })
  return out
}

export { rateBestTips, findCleverHits, findNearMisses }
