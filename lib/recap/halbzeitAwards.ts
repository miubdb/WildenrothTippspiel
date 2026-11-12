import { isSettled, isExcludedBonus, type Slip, type RecapMatchRow } from '@/lib/recap/slips'
import type { TipperIqResult } from '@/lib/recap/tipperIq'
import { computeOptimists, computeWildenrothRecords } from '@/lib/recap/wildenrothStance'
import {
  bestComebacks, computeTrajectories, findBetTwins, findCancelRegrets, findCleverHits, findNearMisses,
  lastMinuteWins, lateBloomers, mondayMorningStats, biggestNetLosers, latestSlips, findIdenticalWins, winlessComboStreakers, leadTimeStats, longestStreaks, nightOwlStats, rateBestTips, type MatchdayRange,
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

export interface AwardEntry { userId: string; value: string; detail?: string; /** Gleichstands-Schlüssel, falls mehr als der angezeigte Wert zählt (sonst `value`). */ rankKey?: string }
export interface AwardResult {
  key: string
  title: string
  icon: string
  kind: 'main' | 'fun'
  /** Eine Zeile, was der Award misst (sichtbar in der UI, damit niemand rätseln muss). */
  rule: string
  /** Gewinner zuerst, danach bis zu zwei Plätze dahinter. */
  entries: AwardEntry[]
  /** Normale Leitfrage in Alltagssprache (steht in der Oberfläche statt der technischen `rule`). */
  question?: string
  /** Kombi-Pech: der bitterste einzelne Schein (nur ein Tipp fehlte, höchster entgangener Nettogewinn). */
  bitterest?: { userId: string; slipKey: string; legs: number; odds: number; stake: number; missedNet: number; matchday: number | null }
  /** Zweite Perspektive im selben Award (Hall der Schande: Häufigkeit statt Gewinn). */
  second?: { title: string; question: string; entries: AwardEntry[] }
  /** true = erscheint im öffentlichen Winter-Recap; false = wird nur intern berechnet (Video, Feier, andere Recaps). */
  public?: boolean
}

/** Öffentliche Auswahl des Winter-Recaps in Anzeigereihenfolge. Alles andere bleibt intern verfügbar. */
export const PUBLIC_AWARD_KEYS = ['wildi_magnet', 'hall_der_ehre', 'hall_der_schande', 'senkrechtstarter', 'einzelwetten_meister', 'aussenseiter_jaeger', 'kombi_pech'] as const
export const AWARD_QUESTIONS: Record<string, string> = {
  wildi_magnet: 'Wer hat mit seinen Wetten am meisten Wildis verdient?',
  hall_der_ehre: 'Wer hat die meisten Wildenroth-Spiele auf Sieg getippt – und nie gegen den Verein gewettet?',
  hall_der_schande: 'Wer hat mit Wetten gegen Wildenroth am meisten gewonnen?',
  senkrechtstarter: 'Wer ist in der Rangliste am stärksten nach oben geklettert?',
  einzelwetten_meister: 'Wer hat mit Einzelwetten am meisten verdient?',
  aussenseiter_jaeger: 'Wer hat am häufigsten schwierige Quoten (5,00 und höher) getroffen?',
  kombi_pech: 'Wen hat es mit Kombis am häufigsten um einen einzigen Tipp erwischt?',
}

const wildi = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString('de-DE', { maximumFractionDigits: 0 })} Wildis`
const n0 = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 0 })
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
  /** Top n – bei Gleichstand auf dem letzten Platz kommen alle Gleichplatzierten dazu (höchstens 6), damit nicht zufällig
   *  einer von mehreren gleich guten Tippern „unter den Tisch" fällt. */
  const top = <T,>(arr: T[], n: number, f: (x: T) => AwardEntry): AwardEntry[] => {
    const all = arr.slice(0, 12).map(f)
    if (all.length <= n) return all
    const key = (e: AwardEntry) => e.rankKey ?? e.value
    const out = all.slice(0, n)
    for (let i = n; i < all.length && out.length < 6 && key(all[i]) === key(all[n - 1]); i++) out.push(all[i])
    return out
  }

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
  add({ key: 'jackpot_koenig', title: 'Jackpot-König', icon: '👑', kind: 'main', rule: 'Bester gewonnener Kombischein nach Gesamtwertung (Mittel der Perzentile aus Quote, Nettogewinn, Außenseiter-Anteil und Legs) – nicht automatisch der höchste Gewinn',
    entries: top(tips.combo, 3, (t) => ({ userId: t.slip.userId, value: `Quote ${t.slip.odds.toFixed(2).replace('.', ',')}`, detail: `${t.slip.legs} Legs · ${wildi(t.slip.net)} · Spieltag ${t.slip.matchday}` })) })

  // 4 Einzelwetten-König – bestes Netto aus Einzelwetten (mind. 8 abgerechnete Einzelwetten)
  const singleNet = new Map<string, { n: number; net: number }>()
  for (const s of settled.filter((x) => x.kind === 'single')) { const e = singleNet.get(s.userId) ?? { n: 0, net: 0 }; e.n++; e.net += s.net; singleNet.set(s.userId, e) }
  const sk = [...singleNet.entries()].filter(([, e]) => e.n >= 8 && e.net > 0).sort((a, b) => b[1].net - a[1].net)
  const bigSingles0 = settled.filter((x) => x.kind === 'single' && x.status === 'won' && !isExcludedBonus(x) && !x.legs.some((l) => l.marketType === 'matchday_special'))
  const bestSingleOf = (u: string) => bigSingles0.filter((x) => x.userId === u).sort((a, b) => b.net - a.net)[0]
  add({ key: 'einzelwetten_meister', title: 'Einzelwetten-Meister', icon: '🎯', kind: 'main', rule: 'Höchstes GESAMT-Netto aus allen abgerechneten Einzelwetten zusammen (Summe, nicht ein einzelner Schein; mind. 8 Einzelwetten). Der beste einzelne Schein des Siegers steht als Zusatz dabei; der größte Einzelwetten-Treffer der Community wird separat berechnet.',
    entries: top(sk, 3, ([userId, e]) => { const b = bestSingleOf(userId); return { userId, value: wildi(e.net), detail: `aus ${e.n} Einzelwetten${b ? ` · bester Schein ${wildi(b.net)} (Quote ${b.odds.toFixed(2).replace('.', ',')})` : ''}` } }) })
  const bigSingles = settled.filter((x) => x.kind === 'single' && x.status === 'won' && !isExcludedBonus(x) && !x.legs.some((l) => l.marketType === 'matchday_special')).sort((a, b) => b.net - a.net)
  add({ key: 'groesster_einzeltreffer', title: 'Größter Einzelwetten-Treffer', icon: '💎', kind: 'fun', rule: 'Höchster Nettogewinn EINES gewonnenen Einzelwettscheins (Auszahlung − Einsatz)',
    entries: top(bigSingles, 3, (x) => ({ userId: x.userId, value: wildi(x.net), detail: `Quote ${x.odds.toFixed(2).replace('.', ',')} · Einsatz ${n0(x.stake)} · Spieltag ${x.ownerMatchday}` })) })

  const bigCombos = settled.filter((x) => x.kind === 'combo' && x.status === 'won' && !isExcludedBonus(x) && !x.legs.some((l) => l.marketType === 'matchday_special')).sort((a, b) => b.net - a.net)
  add({ key: 'groesster_kombitreffer', title: 'Größter Kombi-Treffer', icon: '🏆', kind: 'fun', rule: 'Höchster Nettogewinn EINES gewonnenen Kombischeins (Auszahlung − Einsatz). Der Jackpot-König bewertet dagegen die Gesamtleistung eines Kombischeins und kann davon abweichen.',
    entries: top(bigCombos, 3, (x) => ({ userId: x.userId, value: wildi(x.net), detail: `${x.legs.length} Legs · Quote ${x.odds.toFixed(2).replace('.', ',')} · Einsatz ${n0(x.stake)} · Spieltag ${x.ownerMatchday}` })) })

  // 5 Senkrechtstarter – größte Rangverbesserung seit dem frühen Abschnitt
  const traj = computeTrajectories(settled, excluded)
  const early = Math.max(2, Math.ceil((range.to - range.from + 1) / 3))
  const lb = lateBloomers(traj, early)
  add({ key: 'senkrechtstarter', title: 'Senkrechtstarter', icon: '🚀', kind: 'main', rule: `Größte Rangverbesserung (kumulatives Netto) vom Ende von Spieltag ${traj.matchdays[Math.min(early, traj.matchdays.length) - 1] ?? '?'} bis zum Endstand`,
    entries: top(lb, 3, (x) => ({ userId: x.userId, value: `Platz ${x.earlyRank} → ${x.finalRank}`, detail: `+${x.gain} Plätze` })) })

  // 6/7 Hall der Ehre / Schande
  const wr = computeWildenrothRecords(settled, matches, 'all')
  const wMatchIds = new Set<number>()
  for (const x of settled) for (const l of x.legs) { if (l.matchId == null) continue; const m = matches.find((mm) => mm.id === l.matchId); if (m && [14, 40].some((t) => m.home_team_id === t || m.away_team_id === t)) wMatchIds.add(l.matchId) }
  const loyal = [...wr.values()].filter((r) => r.win.matches >= 5 && r.against.legs === 0)
    .sort((a, b) => b.win.matches - a.win.matches || b.win.legsHit - a.win.legsHit)
  add({ key: 'hall_der_ehre', title: 'Hall der Ehre', icon: '💚', kind: 'main', rule: 'Meiste VERSCHIEDENE Wildenroth-Spiele (I + II) mit mind. einem Siegtipp (Einzelwette oder Kombi-Leg), ohne je eine Gegenwette; wiederholte gleiche Tipps zählen nicht mehrfach (mind. 5 Spiele). Die Zahl aller Siegtipps steht daneben.',
    entries: top(loyal, 3, (r) => ({ userId: r.userId, rankKey: `${r.win.matches}|${r.win.legsHit}`, value: `${r.win.matches} verschiedene Spiele`, detail: `auf Sieg getippt (insgesamt ${r.win.legs} Siegtipps, ${r.win.legsHit} davon aufgegangen) · von ${wMatchIds.size} Wildenroth-Spielen · dazu ${r.supportive.legs} weitere Pro-Tipps wie Torschützen` })) })
  const traitors = [...wr.values()].filter((r) => r.against.legsHit >= 1 && r.againstBalance > 0).sort((a, b) => b.againstBalance - a.againstBalance)
  add({ key: 'hall_der_schande', title: 'Hall der Schande', icon: '😈', kind: 'main', rule: 'Höchster Gesamtsaldo aus Wetten GEGEN Wildenroth I/II (Gegner-Sieg, Doppelte Chance ohne Wildenroth-Sieg, Gegner-Handicap, Ergebnis mit Gegner-Sieg), inkl. erfolgloser Gegenwetten; mind. ein aufgegangener Gegen-Tipp. Unentschieden und neutrale Torwetten zählen nicht. Kombi-Anteile sind rechnerisch zugeordnet.',
    entries: top(traitors, 3, (r) => ({ userId: r.userId, value: wildi(r.againstBalance), detail: `direkt (Einzelwetten) ${wildi(r.against.directNet)} · rechnerisch aus Kombis zugeordnet ${wildi(r.against.attributedComboNet)} · ${r.against.legsHit} von ${r.against.legs} Gegen-Tipps aufgegangen` })),
    second: { title: 'Die meisten Gegenwetten', question: 'Wer hat am häufigsten gegen Wildenroth gewettet?',
      entries: [...wr.values()].filter((r) => r.against.legs > 0).sort((a, b) => b.against.legs - a.against.legs || b.against.matches - a.against.matches || b.againstBalance - a.againstBalance).slice(0, 3).map((r) => ({ userId: r.userId, rankKey: `${r.against.legs}|${r.against.matches}`, value: `${r.against.legs} Gegen-Tipps`, detail: `auf ${r.against.matches} verschiedene Spiele · ${r.against.legsHit} aufgegangen · Saldo ${wildi(r.againstBalance)} (direkt ${wildi(r.against.directNet)}, aus Kombis zugeordnet ${wildi(r.against.attributedComboNet)})` })) } })

  // 8 Kombi-Fluch – meiste „nur ein Tipp falsch"-Kombis (≥ 3 Legs)
  const nm = findNearMisses(slips)
  const curse = new Map<string, { n: number; potential: number }>()
  for (const m of nm) { const e = curse.get(m.slip.userId) ?? { n: 0, potential: 0 }; e.n++; e.potential += m.potentialNet; curse.set(m.slip.userId, e) }
  const cl = [...curse.entries()].filter(([, e]) => e.n >= 3).sort((a, b) => b[1].n - a[1].n || b[1].potential - a[1].potential)
  const bitter = nm.filter((m) => !excluded.has(m.slip.userId))[0]
  add({ key: 'kombi_pech', title: 'Kombi-Pech', icon: '💔', kind: 'main', rule: 'Meiste verlorene Kombis (≥ 3 Legs), bei denen genau EIN Tipp gefehlt hat und alle anderen aufgingen (mind. 3). Zusatz: der bitterste einzelne Schein (höchster entgangener Nettogewinn). Die „Kombi-Flaute" (Kombis ohne einen Gewinn) wird intern separat berechnet.',
    entries: top(cl, 3, ([userId, e]) => ({ userId, value: `${e.n}× knapp daneben`, detail: `dabei ${n0(e.potential)} Wildis Nettogewinn verpasst` })),
    bitterest: bitter ? { userId: bitter.slip.userId, slipKey: bitter.slip.key, legs: bitter.legsTotal, odds: bitter.slip.odds, stake: bitter.slip.stake, missedNet: bitter.potentialNet, matchday: bitter.slip.matchday } : undefined })
  const flaute = winlessComboStreakers(settled, excluded)
  add({ key: 'kombi_flaute', title: 'Kombi-Flaute', icon: '🥶', kind: 'fun', rule: 'Meiste verlorene Kombis OHNE einen einzigen Kombi-Gewinn (mind. 10 abgerechnete Kombis) – eigenständig vom Kombi-Fluch: dort zählt das knappe Scheitern, hier die Dauerflaute',
    entries: top(flaute, 3, (x) => ({ userId: x.userId, value: `${x.lost} Kombis, 0 gewonnen`, detail: `${n0(x.stakeLost)} Wildis Kombi-Einsatz verloren` })) })

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
  add({ key: 'fruehbucher', title: 'Frühbucher', icon: '🗓️', kind: 'fun', rule: 'Längster typischer (Median) Abstand zwischen Abgabe und Anstoß über alle abgegebenen Scheine, auch später stornierte (mind. 10)',
    entries: top(lead, 3, (l) => ({ userId: l.userId, value: dur(l.medianLeadSeconds), detail: `${l.slips} Scheine` })) })
  add({ key: 'letzter_druecker', title: 'Auf den letzten Drücker', icon: '⏱️', kind: 'fun', rule: 'TYPISCHE Abgabezeit: kürzester MEDIAN-Abstand zwischen Abgabe und Anstoß über alle abgegebenen Scheine, auch später stornierte (mind. 10). Bewertet die Gewohnheit, nicht den einzelnen Schein – dafür gibt es „Spätester Schein" und „Bester Last-Minute-Gewinntipp".',
    entries: top([...lead].reverse(), 3, (l) => ({ userId: l.userId, value: `typisch ${dur(l.medianLeadSeconds)} vor Anstoß`, detail: `Median über ${l.slips} Scheine` })) })
  const latest = latestSlips(slips, excluded)
  add({ key: 'spaetester_schein', title: 'Spätester Schein', icon: '🏁', kind: 'fun', rule: 'Der einzelne Schein mit dem kürzesten Abstand zwischen Abgabe und Anstoß – egal ob gewonnen, verloren oder später storniert',
    entries: top(latest, 3, (x) => ({ userId: x.userId, value: `${(x.leadSeconds).toFixed(1).replace('.', ',')} Sekunden vor Anstoß`, detail: `${x.status === 'won' ? 'gewonnen' : x.status === 'lost' ? 'verloren' : x.status === 'void' ? 'storniert' : 'offen'} · Quote ${x.odds.toFixed(2).replace('.', ',')} · Spieltag ${x.matchday}` })) })
  const lm = lastMinuteWins(settled, excluded)
  add({ key: 'last_minute_gewinntipp', title: 'Bester Last-Minute-Gewinntipp', icon: '⚡', kind: 'fun', rule: 'GEWONNENER Schein mit dem kürzesten Abstand zwischen Abgabe und Anstoß (gleiche Idee wie der Spieltags-Pokal, über die ganze Hinrunde)',
    entries: top(lm, 3, (w) => ({ userId: w.userId, value: `${w.leadSeconds.toFixed(1).replace('.', ',')} Sekunden vor Anstoß`, detail: `Quote ${w.odds.toFixed(2).replace('.', ',')} · ${wildi(w.net)} · Spieltag ${w.matchday}` })) })
  const owl = nightOwlStats(slips, excluded).filter((o) => o.nightSlips >= 5)
  add({ key: 'nachteule', title: 'Nachteule', icon: '🦉', kind: 'fun', rule: 'Meiste abgegebene Scheine zwischen 0:00 und 5:59 Uhr (Europe/Berlin), auch später stornierte (Bonus-Tipps ausgenommen; mind. 5)',
    entries: top(owl, 3, (o) => ({ userId: o.userId, value: `${o.nightSlips} Nachtscheine`, detail: `von ${o.slips}` })) })
  const hunter = new Map<string, number>()
  for (const s of settled) if (s.status === 'won' && s.odds >= 5) hunter.set(s.userId, (hunter.get(s.userId) ?? 0) + 1)
  add({ key: 'aussenseiter_jaeger', title: 'Außenseiter-Jäger', icon: '🏹', kind: 'fun', rule: 'Meiste gewonnene Scheine mit Quote ≥ 5,00 (mind. 3)',
    entries: top([...hunter.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]), 3, ([userId, n]) => ({ userId, value: `${n} Scheine ≥ 5,00` })) })
  const regrets = findCancelRegrets(allSlips.filter((s) => s.ownerMatchday != null && s.ownerMatchday >= range.from && s.ownerMatchday <= range.to), matches, excluded)
  add({ key: 'storno_fehler', title: 'Größter Storno-Fehler', icon: '🙈', kind: 'fun', rule: 'Selbst stornierter Schein, der gewonnen hätte – gerankt nach entgangenem NETTOgewinn (mögliche Auszahlung − Einsatz); nur Märkte, die sich aus dem Endergebnis ergeben',
    entries: top(regrets, 3, (r) => ({ userId: r.userId, value: `${n0(r.potentialNet)} Wildis Nettogewinn entgangen`, detail: `Einsatz ${n0(r.stake)} · Quote ${r.odds.toFixed(2).replace('.', ',')} · mögliche Auszahlung ${n0(r.potentialPayout)}` })) })
  const st = longestStreaks(slips, excluded)
  add({ key: 'verlustserie', title: 'Längste Verlustserie', icon: '🌧️', kind: 'fun', rule: 'Meiste verlorene Scheine in Folge (nach Anstoß geordnet; mind. 6)',
    entries: top(st.loss.filter((s) => s.length >= 6), 3, (s) => ({ userId: s.userId, value: `${s.length} in Folge` })) })
  add({ key: 'gewinnserie', title: 'Längste Gewinnserie', icon: '🔥', kind: 'fun', rule: 'Meiste gewonnene Scheine in Folge (nach Anstoß geordnet; mind. 3)',
    entries: top(st.win.filter((s) => s.length >= 3), 3, (s) => ({ userId: s.userId, value: `${s.length} in Folge` })) })
  const tw = findBetTwins(slips, excluded)
  if (tw.length) out.push({ key: 'wett_zwillinge', title: 'Wett-Zwillinge', icon: '👯', kind: 'fun', rule: 'Paar mit der höchsten prozentualen Übereinstimmung seiner Tipps (gleiches Spiel + Markt + Auswahl; Anteil gemeinsamer an allen verschiedenen Tipps beider; mind. 20 Tipps je Tipper und 15 gemeinsame). Misst Ähnlichkeit, nicht Erfolg.',
    entries: [{ userId: tw[0].a, value: `${Math.round(tw[0].jaccard * 100)} % Übereinstimmung`, detail: `${tw[0].shared} identische Tipps` }, { userId: tw[0].b, value: `${Math.round(tw[0].jaccard * 100)} % Übereinstimmung`, detail: `${tw[0].shared} identische Tipps${tw.length > 1 ? ' · knapp dahinter: ' + tw.slice(1, 3).map((t) => `${(t.jaccard * 100).toFixed(1).replace('.', ',')} % (${t.shared} gemeinsame)`).join(', ') : ''}` }] })
  const iw = findIdenticalWins(slips, excluded)
  if (iw.length) out.push({ key: 'zwillings_treffer', title: 'Zwillings-Treffer', icon: '🎴', kind: 'fun', rule: 'Identischer GEWONNENER Kombischein (exakt dieselben Spiele, Märkte und Auswahlen, ≥ 2 Legs) bei mind. 2 Tippern – unabhängig von der Gesamtähnlichkeit',
    entries: iw[0].users.slice(0, 3).map((u) => ({ userId: u.userId, value: `${iw[0].legs}er-Kombi @${iw[0].odds.toFixed(2).replace('.', ',')}`, detail: `${wildi(u.net)} · gleicher Gewinnschein bei ${iw[0].users.length} Tippern` })) })
  const mon = mondayMorningStats(slips, excluded).filter((x) => x.mondayMorningSlips >= 4).sort((a, b) => b.mondayMorningSlips - a.mondayMorningSlips || b.mondayMorningSlips / b.slips - a.mondayMorningSlips / a.slips)
  add({ key: 'montagmorgen_manager', title: 'Montagmorgen-Manager', icon: '☕', kind: 'fun', rule: 'Meiste abgegebene Scheine montags 6:00–11:59 Uhr (Europe/Berlin), auch später stornierte (mind. 4)',
    entries: top(mon, 3, (x) => ({ userId: x.userId, value: `${x.mondayMorningSlips} Montagmorgen-Scheine`, detail: `von ${x.slips}` })) })
  const losers = biggestNetLosers(settled, excluded).filter((x) => x.net < 0)
  add({ key: 'wildi_vernichter', title: 'Wildi-Vernichter', icon: '🔥', kind: 'fun', rule: 'Größter tatsächlicher Nettoverlust aus ALLEN abgerechneten Scheinen (Summe Auszahlung − Einsatz, inkl. Bonus-Tipps mit echtem Einsatz – dieselbe Basis wie Wildi-Magnet, nur umgekehrt)',
    entries: top(losers, 3, (x) => ({ userId: x.userId, value: wildi(x.net), detail: `${x.settled} abgerechnete Scheine` })) })
  const opt = computeOptimists(settled, matches).filter((x) => x.lostWinTipMatches >= 3 && excluded.has(x.userId) === false)
  add({ key: 'ewiger_optimist', title: 'Ewiger Optimist', icon: '🌈', kind: 'fun', rule: 'Meiste Wildenroth-Spiele (I + II), in denen jeder Siegtipp des Tippers danebenging; danach: wie oft er nach einem solchen Reinfall wieder auf einen Wildenroth-Sieg setzte (mind. 3)',
    entries: top(opt, 3, (x) => ({ userId: x.userId, value: `${x.lostWinTipMatches} von ${x.winTipMatches} Siegtipp-Spielen verfehlt`, detail: `${x.backedAfterLoss}× danach erneut auf Wildenroth gesetzt` })) })
  const tragic = nm
  add({ key: 'tragischster_beinahe_gewinn', title: 'Tragischster Beinahe-Gewinn', icon: '😭', kind: 'fun', rule: 'Verlorene Kombi (≥ 3 Legs) mit nur einem falschen Tipp und dem höchsten entgangenen NETTOgewinn (gedeckelte Auszahlung − Einsatz)',
    entries: top(tragic, 3, (m) => ({ userId: m.slip.userId, value: `${n0(m.potentialNet)} Wildis Nettogewinn verpasst`, detail: `${m.legsTotal} Legs · Einsatz ${n0(m.slip.stake)} · Quote ${m.slip.odds.toFixed(2).replace('.', ',')} · mögliche Auszahlung ${n0(m.potentialPayout)} · Spieltag ${m.slip.matchday}` })) })
  for (const a of out) { a.public = (PUBLIC_AWARD_KEYS as readonly string[]).includes(a.key); a.question = AWARD_QUESTIONS[a.key] }
  return out
}

export { rateBestTips, findCleverHits, findNearMisses }
