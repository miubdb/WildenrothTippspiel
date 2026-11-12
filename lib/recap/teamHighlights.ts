import type { RecapMatchRow, Slip } from '@/lib/recap/slips'
import type { ComboKillerMatch } from '@/lib/recap/hinrundeStats'

/**
 * Team-Highlights für den Winter-Recap (rein, ohne Datenbank). Bewusst nur wenige, leicht verständliche Zahlen:
 *  – meistgewettete Teams (Wettscheine mit mindestens einem Tipp auf ein Spiel des Teams)
 *  – schlechtestes Team zum Wetten (geringste Trefferquote bei Siegtipps ab einer Mindestzahl)
 *  – Wildenroth I/II: Siegtipps und Gegentipps mit Trefferquote
 * Gezählt werden nur wirksame Legs (nicht neutralisiert/storniert) abgerechneter bzw. offener Scheine; Siegtipps = 1X2 Heim/Gast.
 */
export interface TeamCount { teamId: number; name: string; slips: number }
export interface TeamHitRate { teamId: number; name: string; tips: number; hit: number; rate: number }
export interface WildenrothTeamStat { teamId: number; name: string; winTips: number; winHit: number; againstTips: number; againstHit: number; tippers: number }
export interface TeamHighlights {
  mostBet: TeamCount[]
  worstToBet: TeamHitRate | null
  wildenroth: WildenrothTeamStat[]
  /** Mindestzahl an Siegtipps für „schlechtestes Team zum Wetten“. */
  minTipsForWorst: number
}

export const MIN_TIPS_FOR_WORST = 20
export const WILDENROTH_TEAM_IDS: [number, number] = [14, 40]

export function computeTeamHighlights(slips: Slip[], matches: RecapMatchRow[], teamName: (id: number) => string, excluded: Set<string> = new Set()): TeamHighlights {
  const mt = new Map(matches.map((m) => [m.id, m]))
  const perTeamSlips = new Map<number, Set<string>>()
  const win = new Map<number, { tips: number; hit: number }>()
  const wAgainst = new Map<number, { tips: number; hit: number }>()
  const wTippers = new Map<number, Set<string>>()
  const seen = new Set<string>()
  for (const s of slips) {
    if (excluded.has(s.userId) || s.status === 'void' || s.status === 'neutralized') continue
    for (const l of s.legs) {
      if (l.matchId == null || l.status === 'neutralized' || l.status === 'void') continue
      const m = mt.get(l.matchId)
      if (!m || m.matchday >= 900) continue
      for (const t of [m.home_team_id, m.away_team_id]) (perTeamSlips.get(t) ?? perTeamSlips.set(t, new Set()).get(t)!).add(s.key)
      if (l.marketType !== '1x2' || (l.selection !== 'home' && l.selection !== 'away')) continue
      if (l.status !== 'won' && l.status !== 'lost') continue
      const k = `${s.userId}|${l.matchId}|${l.selection}`
      if (seen.has(k)) continue // gleiche Person, gleiches Spiel, gleicher Tipp zählt einmal
      seen.add(k)
      const backed = l.selection === 'home' ? m.home_team_id : m.away_team_id
      const other = l.selection === 'home' ? m.away_team_id : m.home_team_id
      const hit = l.status === 'won' ? 1 : 0
      const w = win.get(backed) ?? { tips: 0, hit: 0 }; w.tips++; w.hit += hit; win.set(backed, w)
      if (WILDENROTH_TEAM_IDS.includes(other)) { const a = wAgainst.get(other) ?? { tips: 0, hit: 0 }; a.tips++; a.hit += hit; wAgainst.set(other, a) }
      for (const t of WILDENROTH_TEAM_IDS) if (backed === t || other === t) (wTippers.get(t) ?? wTippers.set(t, new Set()).get(t)!).add(s.userId)
    }
  }
  const mostBet = [...perTeamSlips.entries()].map(([teamId, set]) => ({ teamId, name: teamName(teamId), slips: set.size })).sort((a, b) => b.slips - a.slips || a.name.localeCompare(b.name)).slice(0, 3)
  const worst = [...win.entries()].filter(([, v]) => v.tips >= MIN_TIPS_FOR_WORST).map(([teamId, v]) => ({ teamId, name: teamName(teamId), tips: v.tips, hit: v.hit, rate: v.hit / v.tips })).sort((a, b) => a.rate - b.rate || b.tips - a.tips)[0] ?? null
  const wildenroth = WILDENROTH_TEAM_IDS.map((teamId) => ({ teamId, name: teamName(teamId), winTips: win.get(teamId)?.tips ?? 0, winHit: win.get(teamId)?.hit ?? 0, againstTips: wAgainst.get(teamId)?.tips ?? 0, againstHit: wAgainst.get(teamId)?.hit ?? 0, tippers: wTippers.get(teamId)?.size ?? 0 })).filter((x) => x.winTips + x.againstTips > 0)
  return { mostBet, worstToBet: worst, wildenroth, minTipsForWorst: MIN_TIPS_FOR_WORST }
}

/** „Teuerstes Spiel“ = Spiel, an dem die meisten Nettogewinne verpasst wurden; „Kombi-Killer“ = Spiel mit den meisten gescheiterten Kombis. */
export function pickKillerMatches(byMatch: ComboKillerMatch[]): { killer: ComboKillerMatch | null; priciest: ComboKillerMatch | null } {
  const killer = byMatch[0] ?? null
  const priciest = [...byMatch].sort((a, b) => b.potentialNet - a.potentialNet)[0] ?? null
  return { killer, priciest }
}
