import type { RecapMatchRow, Slip } from '@/lib/recap/slips'

/**
 * „Bank vs. Community“ – eine kleine Geschichte, kein Statistikblock:
 * Wie oft lag die MEHRHEIT der Community beim Spielausgang (1X2) richtig – und wie oft der Quoten-Favorit der „Bank“
 * (die Auswahl mit der niedrigsten Quote)? Gezählt werden nur beendete Spiele mit mindestens `MIN_TIPPERS` verschiedenen
 * Tippern, deren drei Quoten (Heim/Unentschieden/Gast) aus den Tipps bekannt sind und bei denen weder die Mehrheit noch
 * der Favorit ein Gleichstand ist. Pro Person und Spiel zählt eine Auswahl (wer widersprüchlich getippt hat, wird für dieses
 * Spiel nicht gezählt).
 */
export const CROWD_MIN_TIPPERS = 5
export const SURPRISE_MIN_TIPPERS = 8
export type Outcome = 'home' | 'draw' | 'away'
export interface CrowdSurprise { matchId: number; share: number; tippers: number; majority: Outcome; actual: Outcome; score: string }
export interface CrowdVsBank { matches: number; communityRight: number; bankRight: number; minTippers: number; surprise: CrowdSurprise | null }

const OUT: Outcome[] = ['home', 'draw', 'away']

export function computeCrowdVsBank(slips: Slip[], matches: RecapMatchRow[], excluded: Set<string> = new Set()): CrowdVsBank {
  const mt = new Map(matches.map((m) => [m.id, m]))
  const picks = new Map<number, Map<string, Set<Outcome>>>()
  const odds = new Map<number, Partial<Record<Outcome, number>>>()
  for (const s of slips) {
    if (excluded.has(s.userId) || s.status === 'void' || s.status === 'neutralized') continue
    for (const l of s.legs) {
      if (l.matchId == null || l.marketType !== '1x2' || l.status === 'neutralized' || l.status === 'void') continue
      if (!OUT.includes(l.selection as Outcome)) continue
      const sel = l.selection as Outcome
      const m = mt.get(l.matchId)
      if (!m || m.status !== 'finished' || m.home_score == null || m.away_score == null || m.matchday >= 900) continue
      const byUser = picks.get(l.matchId) ?? picks.set(l.matchId, new Map()).get(l.matchId)!
      ;(byUser.get(s.userId) ?? byUser.set(s.userId, new Set()).get(s.userId)!).add(sel)
      const o = odds.get(l.matchId) ?? odds.set(l.matchId, {}).get(l.matchId)!
      if (o[sel] == null) o[sel] = l.odds
    }
  }
  let n = 0, crowd = 0, bank = 0
  let surprise: CrowdSurprise | null = null
  for (const [matchId, byUser] of picks) {
    const m = mt.get(matchId)!
    const count: Record<Outcome, number> = { home: 0, draw: 0, away: 0 }
    let tippers = 0
    for (const set of byUser.values()) { if (set.size !== 1) continue; count[[...set][0]]++; tippers++ }
    if (tippers < CROWD_MIN_TIPPERS) continue
    const o = odds.get(matchId)
    if (!o || o.home == null || o.draw == null || o.away == null) continue
    const byCount = [...OUT].sort((a, b) => count[b] - count[a])
    if (count[byCount[0]] === count[byCount[1]]) continue
    const byOdds = [...OUT].sort((a, b) => o[a]! - o[b]!)
    if (o[byOdds[0]] === o[byOdds[1]]) continue
    const hs = m.home_score as number, as = m.away_score as number
    const actual: Outcome = hs > as ? 'home' : hs === as ? 'draw' : 'away'
    n++
    if (byCount[0] === actual) crowd++
    if (byOdds[0] === actual) bank++
    const share = count[byCount[0]] / tippers
    if (byCount[0] !== actual && tippers >= SURPRISE_MIN_TIPPERS && (!surprise || share > surprise.share)) surprise = { matchId, share, tippers, majority: byCount[0], actual, score: `${hs}:${as}` }
  }
  return { matches: n, communityRight: crowd, bankRight: bank, minTippers: CROWD_MIN_TIPPERS, surprise }
}

/**
 * Wildi-Bilanz der Community gegen die „Bank“ – aus den tatsächlich abgerechneten Scheinen (gewonnen/verloren), also exakt
 * derselben Basis wie die Kennzahl „Wildis gesetzt“ (`computeOverview`). Kombis zählen mit EINEM Einsatz und EINER Auszahlung
 * (Slip-Ebene, nicht pro Leg); offene, stornierte und komplett neutralisierte Scheine sind nicht abgerechnet und zählen nicht;
 * teil-neutralisierte Kombis zählen mit ihren tatsächlich abgerechneten Werten; Pokal-Bonus-Tipps zählen wie überall im Recap.
 * Die Bank ist die rechnerische Gegenseite (−Community-Netto), kein echter Buchmacher mit Kontostand.
 */
export interface CommunityBank {
  slips: number
  stake: number
  payout: number
  /** Auszahlung − Einsatz der Community. */
  net: number
  /** Rechnerische Gegenseite: −net (wird nicht mehr extra angezeigt). */
  bankNet: number
  /** Rendite in Prozent: (Auszahlung − Einsatz) / Einsatz × 100 (0 bei Einsatz 0). */
  returnPct: number
  /** Effektive Auszahlungsquote: Auszahlung / Einsatz – NICHT mit Wettquoten zu verwechseln (0 bei Einsatz 0). */
  payoutRatio: number
  single: { slips: number; stake: number; payout: number; net: number }
  combo: { slips: number; stake: number; payout: number; net: number }
}

export function computeCommunityBank(slips: Slip[]): CommunityBank {
  const z = () => ({ slips: 0, stake: 0, payout: 0, net: 0 })
  const single = z(), combo = z()
  for (const s of slips) {
    if (s.status !== 'won' && s.status !== 'lost') continue
    const t = s.kind === 'combo' ? combo : single
    const payout = s.status === 'won' ? (s.payout ?? s.stake + s.net) : 0
    t.slips++; t.stake += s.stake; t.payout += payout; t.net += payout - s.stake
  }
  const stake = single.stake + combo.stake, payout = single.payout + combo.payout, net = payout - stake
  return { slips: single.slips + combo.slips, stake, payout, net, bankNet: -net, returnPct: stake > 0 ? (net / stake) * 100 : 0, payoutRatio: stake > 0 ? payout / stake : 0, single, combo }
}
