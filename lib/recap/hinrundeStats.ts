import { settleBet } from '@/lib/settleBet'
import { payoutCap } from '@/lib/payout'
import { isSettled, isExcludedBonus, type Slip, type RecapMatchRow } from '@/lib/recap/slips'

/**
 * Recap V2 — Kennzahlen und Geschichten über mehrere Spieltage (Hinrunde, später Rückrunde/
 * Saison/Monat: einfach andere `slips` + `range` übergeben). Reine Funktionen auf `Slip`s.
 *
 * Begriffe (immer so benannt, damit Zahlen nicht verwechselt werden):
 *  · Wettschein = Einzelwette ODER Kombi (eine Kombi zählt einmal, ihr Einsatz einmal).
 *  · Leg = einzelne Auswahl einer Kombi (Einzelwette hat genau ein Leg).
 *  · abgerechnet = gewonnen/verloren. offen = noch nicht entschieden. storniert = vom Nutzer
 *    storniert (void). neutralisiert = komplett annullierte Einzelwette (Einsatz zurück).
 *  Einsatz/Auszahlung/Netto beziehen sich nur auf abgerechnete Scheine.
 */

export interface MatchdayRange { from: number; to: number }
export const inRange = (s: Slip, r: MatchdayRange): boolean => s.ownerMatchday != null && s.ownerMatchday >= r.from && s.ownerMatchday <= r.to

export interface SlipBreakdown {
  /** Alle Wettscheine im Zeitraum, egal welcher Status. */
  total: number
  singles: number
  combos: number
  won: number
  lost: number
  open: number
  cancelledByUser: number
  /** Storniert, aber ohne gespeicherten Grund (ältere Stornos) – vermutlich vom Nutzer, nicht belegt. */
  voidNoReason: number
  /** Vom System storniert, weil der Torschütze nicht verfügbar war. */
  voidAdminUnavailable: number
  voidOther: number
  neutralized: number
  /** Legs aller NICHT stornierten Scheine. */
  activeLegs: number
  /** Legs, die per Regelwerk auf Quote 1,00 neutralisiert wurden (Kombis bleiben aktiv). */
  neutralizedLegs: number
  bonusSlips: number
  riskySlips: number
}

export function breakdownSlips(slips: Slip[]): SlipBreakdown {
  const b: SlipBreakdown = { total: slips.length, singles: 0, combos: 0, won: 0, lost: 0, open: 0, cancelledByUser: 0, voidNoReason: 0, voidAdminUnavailable: 0, voidOther: 0, neutralized: 0, activeLegs: 0, neutralizedLegs: 0, bonusSlips: 0, riskySlips: 0 }
  for (const s of slips) {
    if (s.kind === 'single') b.singles++; else b.combos++
    if (s.status === 'won') b.won++
    else if (s.status === 'lost') b.lost++
    else if (s.status === 'pending') b.open++
    else if (s.status === 'neutralized') b.neutralized++
    else if (s.voidReason === 'user_cancelled') b.cancelledByUser++
    else if (s.voidReason == null) b.voidNoReason++
    else if (s.voidReason === 'admin_goalscorer_unavailable') b.voidAdminUnavailable++
    else b.voidOther++
    if (s.status !== 'void') {
      b.activeLegs += s.legs.filter((l) => l.status !== 'neutralized').length
      b.neutralizedLegs += s.legs.filter((l) => l.status === 'neutralized').length
    }
    if (s.isBonus) b.bonusSlips++
    if (s.isRisky) b.riskySlips++
  }
  return b
}

export interface SlipRef { key: string; userId: string; kind: 'single' | 'combo'; stake: number; odds: number; payout: number | null; net: number; matchday: number | null; legs: number }
const ref = (s: Slip): SlipRef => ({ key: s.key, userId: s.userId, kind: s.kind, stake: s.stake, odds: s.odds, payout: s.payout, net: s.net, matchday: s.ownerMatchday, legs: s.legs.filter((l) => l.status !== 'neutralized').length })

export interface HinrundeOverview {
  breakdown: SlipBreakdown
  activeTippers: number
  settledStake: number
  settledPayout: number
  settledNet: number
  avgOddsSettled: number
  avgOddsWon: number
  highestOddsWon: SlipRef | null
  biggestSingleWin: SlipRef | null
  biggestComboWin: SlipRef | null
  popularMarkets: { market: string; legs: number }[]
  popularTeams: { teamId: number; legs: number }[]
  goalscorerLegs: number
  perMatchday: { matchday: number; settledSlips: number; stake: number; net: number; tippers: number }[]
}

export function computeOverview(slips: Slip[], matches: RecapMatchRow[]): HinrundeOverview {
  const settled = slips.filter(isSettled)
  const won = settled.filter((s) => s.status === 'won')
  const activeSlips = slips.filter((s) => s.status !== 'void')
  const best = (arr: Slip[], f: (s: Slip) => number): SlipRef | null => arr.length ? ref(arr.reduce((a, b) => (f(b) > f(a) ? b : a))) : null
  const marketCount = new Map<string, number>()
  const teamCount = new Map<number, number>()
  const matchById = new Map(matches.map((m) => [m.id, m]))
  let goalscorerLegs = 0
  for (const s of activeSlips) for (const l of s.legs) {
    if (l.status === 'neutralized') continue
    marketCount.set(l.marketType, (marketCount.get(l.marketType) ?? 0) + 1)
    if (l.marketType === 'goalscorer' || l.marketType === 'goalscorer_2plus') goalscorerLegs++
    const m = l.matchId != null ? matchById.get(l.matchId) : undefined
    if (m) for (const t of [m.home_team_id, m.away_team_id]) teamCount.set(t, (teamCount.get(t) ?? 0) + 1)
  }
  const mds = [...new Set(slips.map((s) => s.ownerMatchday).filter((x): x is number => x != null))].sort((a, b) => a - b)
  const sum = (a: Slip[], f: (s: Slip) => number) => a.reduce((x, s) => x + f(s), 0)
  return {
    breakdown: breakdownSlips(slips),
    activeTippers: new Set(activeSlips.map((s) => s.userId)).size,
    settledStake: sum(settled, (s) => s.stake),
    settledPayout: sum(won, (s) => s.payout ?? 0),
    settledNet: sum(settled, (s) => s.net),
    avgOddsSettled: settled.length ? sum(settled, (s) => s.odds) / settled.length : 0,
    avgOddsWon: won.length ? sum(won, (s) => s.odds) / won.length : 0,
    highestOddsWon: best(won, (s) => s.odds),
    biggestSingleWin: best(won.filter((s) => s.kind === 'single'), (s) => s.net),
    biggestComboWin: best(won.filter((s) => s.kind === 'combo'), (s) => s.net),
    popularMarkets: [...marketCount.entries()].map(([market, legs]) => ({ market, legs })).sort((a, b) => b.legs - a.legs),
    popularTeams: [...teamCount.entries()].map(([teamId, legs]) => ({ teamId, legs })).sort((a, b) => b.legs - a.legs).slice(0, 8),
    goalscorerLegs,
    perMatchday: mds.map((md) => {
      const st = settled.filter((s) => s.ownerMatchday === md)
      return { matchday: md, settledSlips: st.length, stake: sum(st, (s) => s.stake), net: sum(st, (s) => s.net), tippers: new Set(slips.filter((s) => s.ownerMatchday === md && s.status !== 'void').map((s) => s.userId)).size }
    }),
  }
}

// ── Verlauf & Ränge ────────────────────────────────────────────────────────────────────────

export interface UserTrajectory { userId: string; cumNet: number[]; rank: (number | null)[]; finalNet: number }
export interface Trajectories { matchdays: number[]; users: Map<string, UserTrajectory> }

/** Kumulatives Netto je Spieltag und Rang unter allen, die bis dahin mindestens einen abgerechneten
 *  Schein hatten. */
export function computeTrajectories(slips: Slip[], excluded: Set<string> = new Set()): Trajectories {
  const settled = slips.filter(isSettled).filter((s) => !excluded.has(s.userId))
  const matchdays = [...new Set(settled.map((s) => s.ownerMatchday as number))].sort((a, b) => a - b)
  const net = new Map<string, Map<number, number>>()
  for (const s of settled) {
    let m = net.get(s.userId)
    if (!m) { m = new Map(); net.set(s.userId, m) }
    m.set(s.ownerMatchday as number, (m.get(s.ownerMatchday as number) ?? 0) + s.net)
  }
  const users = new Map<string, UserTrajectory>()
  for (const [u, m] of net) {
    let c = 0
    users.set(u, { userId: u, cumNet: matchdays.map((md) => (c += m.get(md) ?? 0)), rank: [], finalNet: c })
  }
  const firstIdx = new Map<string, number>()
  for (const [u, m] of net) firstIdx.set(u, matchdays.findIndex((md) => m.has(md)))
  matchdays.forEach((_, i) => {
    const present = [...users.values()].filter((t) => (firstIdx.get(t.userId) ?? 99) <= i).sort((a, b) => b.cumNet[i] - a.cumNet[i] || a.userId.localeCompare(b.userId))
    const ranks = new Map(present.map((t, k) => [t.userId, k + 1]))
    for (const t of users.values()) t.rank[i] = ranks.get(t.userId) ?? null
  })
  return { matchdays, users }
}

export interface RankMove { userId: string; fromMatchday: number; toMatchday: number; fromRank: number; toRank: number; delta: number }

/** Größter Rangsprung zwischen zwei aufeinanderfolgenden Spieltagen (up = besser). */
export function biggestRankMoves(t: Trajectories, minParticipants = 8): { climb: RankMove | null; crash: RankMove | null } {
  let climb: RankMove | null = null, crash: RankMove | null = null
  for (const u of t.users.values()) for (let i = 1; i < t.matchdays.length; i++) {
    const a = u.rank[i - 1], b = u.rank[i]
    if (a == null || b == null) continue
    const participants = [...t.users.values()].filter((x) => x.rank[i] != null).length
    if (participants < minParticipants) continue
    const m: RankMove = { userId: u.userId, fromMatchday: t.matchdays[i - 1], toMatchday: t.matchdays[i], fromRank: a, toRank: b, delta: a - b }
    if (!climb || m.delta > climb.delta) climb = m
    if (!crash || m.delta < crash.delta) crash = m
  }
  return { climb: climb && climb.delta > 0 ? climb : null, crash: crash && crash.delta < 0 ? crash : null }
}

export interface Comeback { userId: string; lowPoint: number; lowMatchday: number; finalNet: number; recovered: number }
/** Größte Erholung: vom tiefsten kumulativen Stand (vor dem letzten Spieltag) bis zum Endstand. */
export function bestComebacks(t: Trajectories): Comeback[] {
  const out: Comeback[] = []
  for (const u of t.users.values()) {
    let lowIdx = 0
    u.cumNet.forEach((v, i) => { if (i < u.cumNet.length - 1 && v < u.cumNet[lowIdx]) lowIdx = i })
    const rec = u.finalNet - u.cumNet[lowIdx]
    if (u.cumNet.length > 1 && u.cumNet[lowIdx] < 0 && rec > 0) out.push({ userId: u.userId, lowPoint: u.cumNet[lowIdx], lowMatchday: t.matchdays[lowIdx], finalNet: u.finalNet, recovered: rec })
  }
  return out.sort((a, b) => b.recovered - a.recovered)
}

/** Rangverbesserung vom Ende des frühen Abschnitts (erste `earlyCount` Spieltage) bis zum Ende. */
export function lateBloomers(t: Trajectories, earlyCount: number, minParticipants = 8): { userId: string; earlyRank: number; finalRank: number; gain: number }[] {
  const idx = Math.min(earlyCount, t.matchdays.length) - 1
  if (idx < 0) return []
  const last = t.matchdays.length - 1
  const part = [...t.users.values()].filter((u) => u.rank[idx] != null).length
  if (part < minParticipants) return []
  return [...t.users.values()]
    .filter((u) => u.rank[idx] != null && u.rank[last] != null)
    .map((u) => ({ userId: u.userId, earlyRank: u.rank[idx] as number, finalRank: u.rank[last] as number, gain: (u.rank[idx] as number) - (u.rank[last] as number) }))
    .filter((x) => x.gain > 0).sort((a, b) => b.gain - a.gain)
}

// ── Serien ─────────────────────────────────────────────────────────────────────────────────

export interface Streak { userId: string; length: number; fromMs: number; toMs: number }
/** Längste Gewinn-/Verlustserie je Tipper über abgerechnete Scheine in zeitlicher Reihenfolge der Platzierung. */
export function longestStreaks(slips: Slip[], excluded: Set<string> = new Set()): { win: Streak[]; loss: Streak[] } {
  const by = new Map<string, Slip[]>()
  for (const s of slips.filter(isSettled)) if (!excluded.has(s.userId) && !isExcludedBonus(s)) (by.get(s.userId) ?? by.set(s.userId, []).get(s.userId)!).push(s)
  const win: Streak[] = [], loss: Streak[] = []
  for (const [u, arr] of by) {
    // Reihenfolge nach Anstoß des ersten Spiels (Ergebnis-Reihenfolge), Platzierungszeit als Fallback.
    arr.sort((a, b) => (a.firstKickoffMs ?? a.createdAtMs) - (b.firstKickoffMs ?? b.createdAtMs) || a.createdAtMs - b.createdAtMs)
    for (const [want, list] of [['won', win], ['lost', loss]] as const) {
      let best: Streak | null = null, cur = 0, start = 0
      arr.forEach((s, i) => {
        if (s.status === want) { if (cur === 0) start = i; cur++; if (!best || cur > best.length) best = { userId: u, length: cur, fromMs: arr[start].firstKickoffMs ?? arr[start].createdAtMs, toMs: s.firstKickoffMs ?? s.createdAtMs } } else cur = 0
      })
      if (best) list.push(best)
    }
  }
  win.sort((a, b) => b.length - a.length || a.fromMs - b.fromMs)
  loss.sort((a, b) => b.length - a.length || a.fromMs - b.fromMs)
  return { win, loss }
}

// ── Beinahe-Treffer ────────────────────────────────────────────────────────────────────────

export interface NearMiss { slip: SlipRef; legsTotal: number; lostLegIndex: number; potentialPayout: number; /** entgangener Nettogewinn = mögliche Auszahlung − Einsatz */ potentialNet: number; lostLeg: { matchId: number | null; marketType: string; selection: string; odds: number } }
/** Verlorene Kombis (≥ 3 aktive Legs), bei denen genau EIN Leg verloren hat. Mögliche Auszahlung gedeckelt. */
export function findNearMisses(slips: Slip[]): NearMiss[] {
  const out: NearMiss[] = []
  for (const s of slips) {
    if (s.kind !== 'combo' || s.status !== 'lost') continue
    const act = s.legs.filter((l) => l.status !== 'neutralized' && l.status !== 'void')
    const lost = act.filter((l) => l.status === 'lost')
    if (act.length < 3 || lost.length !== 1 || act.filter((l) => l.status === 'won').length !== act.length - 1) continue
    const l = lost[0]
    out.push({ slip: ref(s), legsTotal: act.length, lostLegIndex: act.indexOf(l), potentialPayout: Math.min(s.stake * s.odds, payoutCap(s.isRisky)), potentialNet: Math.min(s.stake * s.odds, payoutCap(s.isRisky)) - s.stake, lostLeg: { matchId: l.matchId, marketType: l.marketType, selection: l.selection, odds: l.odds } })
  }
  return out.sort((a, b) => b.potentialNet - a.potentialNet)
}

// ── Bester Tipp ────────────────────────────────────────────────────────────────────────────

/** Anteil der Tipper auf einem Spiel, die dieses Ereignis (Markt+Auswahl) getippt haben. */
export function computeCrowdShares(slips: Slip[]): { share: (matchId: number, market: string, selection: string) => number | null; tippersOnMatch: (matchId: number) => number } {
  const onMatch = new Map<number, Set<string>>()
  const onEvent = new Map<string, Set<string>>()
  for (const s of slips) {
    if (s.status === 'void') continue
    for (const l of s.legs) {
      if (l.matchId == null || l.status === 'neutralized') continue
      ;(onMatch.get(l.matchId) ?? onMatch.set(l.matchId, new Set()).get(l.matchId)!).add(s.userId)
      const k = `${l.matchId}|${l.marketType}|${l.selection}`
      ;(onEvent.get(k) ?? onEvent.set(k, new Set()).get(k)!).add(s.userId)
    }
  }
  return {
    share: (matchId, market, selection) => {
      const total = onMatch.get(matchId)?.size ?? 0
      return total > 0 ? (onEvent.get(`${matchId}|${market}|${selection}`)?.size ?? 0) / total : null
    },
    tippersOnMatch: (matchId) => onMatch.get(matchId)?.size ?? 0,
  }
}

export interface RatedTip { slip: SlipRef; score: number; criteria: Record<string, number>; rarity: number | null }

const percentile = (values: number[], v: number): number => {
  if (values.length <= 1) return 1
  return values.filter((x) => x < v).length / (values.length - 1)
}

/** Bester Tipp NICHT allein nach Auszahlung: Mittel der Perzentile aus Quote (ln), Nettogewinn und
 *  Außenseiter-Faktor (1 − Anteil der Tipper, die dasselbe tippten). Kombis zusätzlich Anzahl Legs. */
export function rateBestTips(allSlips: Slip[], rangeSlips: Slip[], excluded: Set<string> = new Set()): { single: RatedTip[]; combo: RatedTip[] } {
  const crowd = computeCrowdShares(allSlips)
  const cand = rangeSlips.filter((s) => s.status === 'won' && !isExcludedBonus(s) && !excluded.has(s.userId) && !s.legs.some((l) => l.marketType === 'matchday_special'))
  const rarityOf = (s: Slip): number | null => {
    const rs = s.legs.filter((l) => l.matchId != null && l.status !== 'neutralized').map((l) => crowd.share(l.matchId as number, l.marketType, l.selection)).filter((x): x is number => x != null)
    return rs.length ? rs.reduce((a, r) => a + (1 - r), 0) / rs.length : null
  }
  const rate = (kind: 'single' | 'combo'): RatedTip[] => {
    const arr = cand.filter((s) => s.kind === kind)
    const rar = arr.map((s) => rarityOf(s) ?? 0)
    const lnO = arr.map((s) => Math.log(s.odds)), nets = arr.map((s) => s.net), legs = arr.map((s) => s.legs.length)
    return arr.map((s, i) => {
      const criteria: Record<string, number> = { quote: percentile(lnO, lnO[i]), gewinn: percentile(nets, nets[i]), aussenseiter: percentile(rar, rar[i]) }
      if (kind === 'combo') criteria.legs = percentile(legs, legs[i])
      const vals = Object.values(criteria)
      return { slip: ref(s), score: vals.reduce((a, b) => a + b, 0) / vals.length, criteria, rarity: rarityOf(s) }
    }).sort((a, b) => b.score - a.score || b.slip.odds - a.slip.odds)
  }
  return { single: rate('single'), combo: rate('combo') }
}

export interface CleverHit { userId: string; slipKey: string; matchId: number; marketType: string; selection: string; odds: number; crowdShare: number; tippers: number; surprise: number }
/** „Klügster Treffer": Gewonnenes Leg mit Quote ≥ 2,00, das von sehr wenigen der Tipper auf diesem Spiel
 *  gewählt wurde (mind. 5 Tipper am Spiel, sonst keine belastbare Vergleichsbasis). */
export function findCleverHits(allSlips: Slip[], rangeSlips: Slip[], excluded: Set<string> = new Set()): CleverHit[] {
  const crowd = computeCrowdShares(allSlips)
  const out: CleverHit[] = []
  for (const s of rangeSlips) {
    if (s.status !== 'won' || isExcludedBonus(s) || excluded.has(s.userId)) continue
    for (const l of s.legs) {
      if (l.matchId == null || l.status !== 'won' || l.odds < 2) continue
      const sh = crowd.share(l.matchId, l.marketType, l.selection)
      const n = crowd.tippersOnMatch(l.matchId)
      if (sh == null || n < 5) continue
      out.push({ userId: s.userId, slipKey: s.key, matchId: l.matchId, marketType: l.marketType, selection: l.selection, odds: l.odds, crowdShare: sh, tippers: n, surprise: -Math.log(sh) })
    }
  }
  return out.sort((a, b) => b.surprise - a.surprise || b.odds - a.odds)
}

// ── Spaß-Statistiken ───────────────────────────────────────────────────────────────────────

const berlinHourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: 'numeric', hour12: false })
/** Stunde (0–23) in deutscher Zeit. Bewusst en-GB: de-DE liefert „01 Uhr" (→ NaN). */
export const berlinHour = (ms: number): number => Number(berlinHourFmt.format(new Date(ms))) % 24

export interface LeadTimeStat { userId: string; medianLeadSeconds: number; slips: number }
export function leadTimeStats(slips: Slip[], excluded: Set<string>, minSlips = 10): LeadTimeStat[] {
  const by = new Map<string, number[]>()
  for (const s of slips) {
    if (isExcludedBonus(s) || excluded.has(s.userId) || s.firstKickoffMs == null) continue
    const lead = (s.firstKickoffMs - s.createdAtMs) / 1000
    if (lead <= 0) continue
    ;(by.get(s.userId) ?? by.set(s.userId, []).get(s.userId)!).push(lead)
  }
  return [...by.entries()].filter(([, a]) => a.length >= minSlips).map(([userId, a]) => {
    const v = [...a].sort((x, y) => x - y)
    const mid = Math.floor(v.length / 2)
    return { userId, medianLeadSeconds: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, slips: v.length }
  })
}

export function nightOwlStats(slips: Slip[], excluded: Set<string>): { userId: string; nightSlips: number; slips: number }[] {
  const by = new Map<string, { n: number; t: number }>()
  for (const s of slips) {
    if (isExcludedBonus(s) || excluded.has(s.userId)) continue
    const e = by.get(s.userId) ?? { n: 0, t: 0 }
    e.t++
    if (berlinHour(s.createdAtMs) < 6) e.n++
    by.set(s.userId, e)
  }
  return [...by.entries()].map(([userId, e]) => ({ userId, nightSlips: e.n, slips: e.t })).sort((a, b) => b.nightSlips - a.nightSlips)
}

export interface LastMinuteWin { userId: string; slipKey: string; leadSeconds: number; odds: number; net: number; matchday: number | null }
export function lastMinuteWins(slips: Slip[], excluded: Set<string>): LastMinuteWin[] {
  return slips.filter((s) => s.status === 'won' && !isExcludedBonus(s) && !excluded.has(s.userId) && s.firstKickoffMs != null && s.firstKickoffMs > s.createdAtMs)
    .map((s) => ({ userId: s.userId, slipKey: s.key, leadSeconds: ((s.firstKickoffMs as number) - s.createdAtMs) / 1000, odds: s.odds, net: s.net, matchday: s.ownerMatchday }))
    .sort((a, b) => a.leadSeconds - b.leadSeconds)
}

export interface BetTwins { a: string; b: string; shared: number; jaccard: number; eventsA: number; eventsB: number }
/** Wett-Zwillinge: Paar mit der größten Übereinstimmung identischer Ereignisse (Spiel+Markt+Auswahl). */
export function findBetTwins(slips: Slip[], excluded: Set<string>, minEvents = 20, minShared = 15): BetTwins[] {
  const ev = new Map<string, Set<string>>()
  for (const s of slips) {
    if (s.status === 'void' || excluded.has(s.userId)) continue
    for (const l of s.legs) {
      if (l.matchId == null || l.status === 'neutralized') continue
      ;(ev.get(s.userId) ?? ev.set(s.userId, new Set()).get(s.userId)!).add(`${l.matchId}|${l.marketType}|${l.selection}`)
    }
  }
  const users = [...ev.keys()].filter((u) => (ev.get(u) as Set<string>).size >= minEvents).sort()
  const out: BetTwins[] = []
  for (let i = 0; i < users.length; i++) for (let j = i + 1; j < users.length; j++) {
    const A = ev.get(users[i]) as Set<string>, B = ev.get(users[j]) as Set<string>
    let shared = 0
    for (const k of A) if (B.has(k)) shared++
    if (shared >= minShared) out.push({ a: users[i], b: users[j], shared, jaccard: shared / (A.size + B.size - shared), eventsA: A.size, eventsB: B.size })
  }
  return out.sort((x, y) => y.jaccard - x.jaccard)
}

export interface CancelRegret { userId: string; slipKey: string; odds: number; stake: number; /** mögliche Auszahlung inkl. Einsatz (gedeckelt) */ potentialPayout: number; /** entgangener Nettogewinn = Auszahlung − Einsatz */ potentialNet: number; matchday: number | null }
/** Vom Nutzer stornierte Scheine, die ausgewertet GEWONNEN hätten (nur Märkte, die sich allein aus dem
 *  Endergebnis bestimmen lassen – Torschützen/Cup/Specials werden bewusst nicht geraten). */
export function findCancelRegrets(slips: Slip[], matches: RecapMatchRow[], excluded: Set<string>): CancelRegret[] {
  const m = new Map(matches.map((x) => [x.id, x]))
  const simple = new Set(['1x2', 'double_chance', 'btts', 'over_under_2_5', 'over_under_3_5', 'over_under_5_5', 'over_9_5', 'handicap', 'exact_score'])
  const out: CancelRegret[] = []
  for (const s of slips) {
    if (s.status !== 'void' || s.voidReason !== 'user_cancelled' || excluded.has(s.userId) || isExcludedBonus(s)) continue
    let allWon = s.legs.length > 0
    for (const l of s.legs) {
      const mt = l.matchId != null ? m.get(l.matchId) : undefined
      if (!mt || mt.status !== 'finished' || mt.home_score == null || mt.away_score == null || !simple.has(l.marketType)) { allWon = false; break }
      if (settleBet(l.marketType, l.selection, mt.home_score, mt.away_score) !== 'won') { allWon = false; break }
    }
    if (allWon) out.push({ userId: s.userId, slipKey: s.key, odds: s.odds, stake: s.stake, potentialPayout: Math.min(s.stake * s.odds, payoutCap(s.isRisky)), potentialNet: Math.min(s.stake * s.odds, payoutCap(s.isRisky)) - s.stake, matchday: s.ownerMatchday })
  }
  return out.sort((a, b) => b.potentialNet - a.potentialNet)
}

// ── Zusätzliche Fakten: Kombi-Killer, „Ein Tor fehlte", Montagmorgen, Verlierer ──────────────

/** Märkte, deren Ergebnis sich allein aus dem Endergebnis ableiten lässt (siehe lib/settleBet.ts). Vor der
 *  Verwendung wird gegen die gespeicherten Leg-Status validiert (`validateSettleReproduction`). */
export const SCORE_COMPUTABLE_MARKETS = new Set(['1x2', 'double_chance', 'btts', 'over_under_2_5', 'over_under_3_5', 'over_under_5_5', 'over_9_5', 'handicap', 'exact_score'])

/** Reproduziert settleBet die in der Datenbank gespeicherten Leg-Status? Liefert Trefferzahlen je Markt –
 *  nur Märkte mit 100 % Übereinstimmung dürfen für „Ein Tor fehlte" genutzt werden. */
export function validateSettleReproduction(slips: Slip[], matches: RecapMatchRow[]): Record<string, { checked: number; mismatches: number }> {
  const m = new Map(matches.map((x) => [x.id, x]))
  const out: Record<string, { checked: number; mismatches: number }> = {}
  for (const s of slips) for (const l of s.legs) {
    if (!SCORE_COMPUTABLE_MARKETS.has(l.marketType) || (l.status !== 'won' && l.status !== 'lost') || l.matchId == null) continue
    const mt = m.get(l.matchId)
    if (!mt || mt.status !== 'finished' || mt.home_score == null || mt.away_score == null) continue
    const e = out[l.marketType] ?? (out[l.marketType] = { checked: 0, mismatches: 0 })
    e.checked++
    if (settleBet(l.marketType, l.selection, mt.home_score, mt.away_score) !== l.status) e.mismatches++
  }
  return out
}

export interface ComboKillerMatch { matchId: number; combos: number; users: number; potentialPayout: number; potentialNet: number; wildenroth: boolean }
export interface ComboKillers {
  /** Verlorene Kombis (≥ 2 aktive Legs), bei denen genau EIN Leg verloren hat und alle übrigen gewonnen haben. */
  singleBlockerCombos: number
  byMatch: ComboKillerMatch[]
  /** Davon Kombis, deren einziger falscher Tipp ein Spiel mit Wildenroth I oder II war. */
  wildenrothCombos: number
}
export function findComboKillers(slips: Slip[], matches: RecapMatchRow[], excluded: Set<string> = new Set()): ComboKillers {
  const mt = new Map(matches.map((x) => [x.id, x]))
  const isW = (id: number) => { const m = mt.get(id); return !!m && [14, 40].some((t) => m.home_team_id === t || m.away_team_id === t) }
  const by = new Map<number, { combos: number; users: Set<string>; pot: number; net: number }>()
  let total = 0, w = 0
  for (const s of slips) {
    if (s.kind !== 'combo' || s.status !== 'lost' || excluded.has(s.userId)) continue
    const act = s.legs.filter((l) => l.status !== 'neutralized' && l.status !== 'void')
    const lost = act.filter((l) => l.status === 'lost')
    if (act.length < 2 || lost.length !== 1 || lost[0].matchId == null) continue
    if (act.filter((l) => l.status === 'won').length !== act.length - 1) continue
    total++
    if (isW(lost[0].matchId)) w++
    const e = by.get(lost[0].matchId) ?? { combos: 0, users: new Set<string>(), pot: 0, net: 0 }
    const pay = Math.min(s.stake * s.odds, payoutCap(s.isRisky))
    e.combos++; e.users.add(s.userId); e.pot += pay; e.net += pay - s.stake
    by.set(lost[0].matchId, e)
  }
  return {
    singleBlockerCombos: total, wildenrothCombos: w,
    byMatch: [...by.entries()].map(([matchId, e]) => ({ matchId, combos: e.combos, users: e.users.size, potentialPayout: e.pot, potentialNet: e.net, wildenroth: isW(matchId) })).sort((a, b) => b.combos - a.combos || b.potentialNet - a.potentialNet),
  }
}

export interface OneGoalShort { slip: SlipRef; matchId: number; marketType: string; selection: string; actual: string; /** was ein einzelnes Tor geändert hätte */ saver: string; potentialPayout: number; potentialNet: number }
export interface OneGoalShortResult {
  cases: OneGoalShort[]
  /** Verlorene Kombis mit genau einem falschen Leg (alle anderen richtig), egal ob berechenbar. */
  singleBlockerCombos: number
  /** Davon nicht aus dem Endergebnis berechenbar (Torschützen, Cup, Specials) – bewusst nicht geraten. */
  notComputable: number
  computableButNotOneGoal: number
}
/** „Ein Tor fehlte": einziger falscher Tipp einer sonst richtigen Kombi, den EIN zusätzliches oder fehlendes Tor
 *  (±1 bei Heim oder Gast) gewonnen hätte. Nur bei berechenbaren Märkten und beendeten Spielen. */
export function findOneGoalShort(slips: Slip[], matches: RecapMatchRow[], excluded: Set<string> = new Set()): OneGoalShortResult {
  const mt = new Map(matches.map((x) => [x.id, x]))
  const res: OneGoalShortResult = { cases: [], singleBlockerCombos: 0, notComputable: 0, computableButNotOneGoal: 0 }
  for (const s of slips) {
    if (s.kind !== 'combo' || s.status !== 'lost' || excluded.has(s.userId)) continue
    const act = s.legs.filter((l) => l.status !== 'neutralized' && l.status !== 'void')
    const lost = act.filter((l) => l.status === 'lost')
    if (act.length < 2 || lost.length !== 1 || act.filter((l) => l.status === 'won').length !== act.length - 1) continue
    res.singleBlockerCombos++
    const l = lost[0]
    const m = l.matchId != null ? mt.get(l.matchId) : undefined
    if (!m || m.status !== 'finished' || m.home_score == null || m.away_score == null || !SCORE_COMPUTABLE_MARKETS.has(l.marketType)) { res.notComputable++; continue }
    const h = m.home_score, a = m.away_score
    const variants: [number, number, string][] = [[h + 1, a, 'ein Heimtor mehr'], [h, a + 1, 'ein Gasttor mehr'], [h - 1, a, 'ein Heimtor weniger'], [h, a - 1, 'ein Gasttor weniger']]
    const hit = variants.find(([vh, va]) => vh >= 0 && va >= 0 && settleBet(l.marketType, l.selection, vh, va) === 'won')
    if (!hit) { res.computableButNotOneGoal++; continue }
    res.cases.push({ slip: ref(s), matchId: m.id, marketType: l.marketType, selection: l.selection, actual: `${h}:${a}`, saver: hit[2], potentialPayout: Math.min(s.stake * s.odds, payoutCap(s.isRisky)), potentialNet: Math.min(s.stake * s.odds, payoutCap(s.isRisky)) - s.stake })
  }
  res.cases.sort((x, y) => y.potentialNet - x.potentialNet)
  return res
}

/** Alle abgegebenen Scheine (auch später stornierte, Bonus ausgenommen), montags 06:00–11:59 deutscher Zeit (Europe/Berlin, inkl. Sommer-/Winterzeit). */
export function mondayMorningStats(slips: Slip[], excluded: Set<string>): { userId: string; mondayMorningSlips: number; slips: number }[] {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', weekday: 'short', hour: 'numeric', hour12: false })
  const by = new Map<string, { n: number; t: number }>()
  for (const s of slips) {
    if (isExcludedBonus(s) || excluded.has(s.userId)) continue
    const parts = Object.fromEntries(fmt.formatToParts(new Date(s.createdAtMs)).map((p) => [p.type, p.value]))
    const e = by.get(s.userId) ?? { n: 0, t: 0 }
    e.t++
    if (parts.weekday === 'Mon' && Number(parts.hour) % 24 >= 6 && Number(parts.hour) % 24 < 12) e.n++
    by.set(s.userId, e)
  }
  return [...by.entries()].map(([userId, e]) => ({ userId, mondayMorningSlips: e.n, slips: e.t })).sort((a, b) => b.mondayMorningSlips - a.mondayMorningSlips)
}

/** Größter tatsächlicher Nettoverlust aus abgerechneten Scheinen – inkl. Bonus-Tipps (echter Einsatz, echte Auszahlung). */
export function biggestNetLosers(slips: Slip[], excluded: Set<string>): { userId: string; net: number; settled: number }[] {
  const by = new Map<string, { net: number; n: number }>()
  for (const s of slips) {
    if (!isSettled(s) || excluded.has(s.userId)) continue
    const e = by.get(s.userId) ?? { net: 0, n: 0 }
    e.net += s.net; e.n++
    by.set(s.userId, e)
  }
  return [...by.entries()].map(([userId, e]) => ({ userId, net: e.net, settled: e.n })).sort((a, b) => a.net - b.net)
}

export interface LatestSlip { userId: string; slipKey: string; leadSeconds: number; status: string; odds: number; matchday: number | null }
/** Spätester Schein: kürzester Abstand zwischen Abgabe und erstem Anstoß, egal ob gewonnen, verloren oder später storniert
 *  (aber vor Anstoß abgegeben). Bonus-Tipps ausgenommen. */
export function latestSlips(slips: Slip[], excluded: Set<string>): LatestSlip[] {
  return slips.filter((s) => !isExcludedBonus(s) && !excluded.has(s.userId) && s.firstKickoffMs != null && s.firstKickoffMs > s.createdAtMs)
    .map((s) => ({ userId: s.userId, slipKey: s.key, leadSeconds: ((s.firstKickoffMs as number) - s.createdAtMs) / 1000, status: s.status, odds: s.odds, matchday: s.ownerMatchday }))
    .sort((a, b) => a.leadSeconds - b.leadSeconds)
}

export interface IdenticalWin { signature: string; legs: number; odds: number; users: { userId: string; slipKey: string; net: number }[] }
/** Identische gewonnene Kombischeine (gleiche Menge aus Spiel+Markt+Auswahl, ≥ 2 Legs) bei ≥ 2 verschiedenen Tippern. */
export function findIdenticalWins(slips: Slip[], excluded: Set<string>): IdenticalWin[] {
  const g = new Map<string, IdenticalWin>()
  for (const s of slips) {
    if (s.kind !== 'combo' || s.status !== 'won' || isExcludedBonus(s) || excluded.has(s.userId)) continue
    const act = s.legs.filter((l) => l.status !== 'neutralized' && l.status !== 'void' && l.matchId != null)
    if (act.length < 2) continue
    const sig = act.map((l) => `${l.matchId}|${l.marketType}|${l.selection}`).sort().join(';')
    const e = g.get(sig) ?? { signature: sig, legs: act.length, odds: s.odds, users: [] }
    e.users.push({ userId: s.userId, slipKey: s.key, net: s.net })
    g.set(sig, e)
  }
  return [...g.values()].filter((e) => new Set(e.users.map((u) => u.userId)).size >= 2).sort((a, b) => b.legs - a.legs || b.odds - a.odds)
}

/** Kombi-Flaute: Tipper mit vielen abgerechneten Kombis, aber KEINEM Kombi-Gewinn. */
export function winlessComboStreakers(slips: Slip[], excluded: Set<string>, minCombos = 10): { userId: string; lost: number; stakeLost: number }[] {
  const by = new Map<string, { won: number; lost: number; stake: number }>()
  for (const s of slips) {
    if (s.kind !== 'combo' || !isSettled(s) || isExcludedBonus(s) || excluded.has(s.userId)) continue
    const e = by.get(s.userId) ?? { won: 0, lost: 0, stake: 0 }
    if (s.status === 'won') e.won++; else { e.lost++; e.stake += s.stake }
    by.set(s.userId, e)
  }
  return [...by.entries()].filter(([, e]) => e.won === 0 && e.lost >= minCombos).map(([userId, e]) => ({ userId, lost: e.lost, stakeLost: e.stake })).sort((a, b) => b.lost - a.lost || b.stakeLost - a.stakeLost)
}
