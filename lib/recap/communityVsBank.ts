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
