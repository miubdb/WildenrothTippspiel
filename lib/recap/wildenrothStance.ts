import type { Slip, SlipLeg, RecapMatchRow } from '@/lib/recap/slips'

/**
 * Hall der Ehre / Hall der Schande — Haltung jedes Tipps zu SpVgg Wildenroth.
 *
 * Gewertet wird pro Tipp bzw. Kombi-Leg (nicht nur reine Wildenroth-Kombis) auf Spielen mit
 * Wildenroth I (Team 14) oder II (Team 40). Die Haltung hängt vom MARKT ab:
 *
 *  win         Tipp zahlt nur bei Wildenroth-SIEG: 1X2 auf Wildenroth, Handicap „Wildenroth −1,5/−2,5",
 *              Ergebnistipp mit Wildenroth-Sieg.
 *  supportive  positive, aber kein Siegtipp: Torschützen-Wetten (Wildenroth-Spieler trifft),
 *              Doppelte Chance mit Wildenroth (Sieg ODER Remis).
 *  draw        Unentschieden-Tipp (1X2 „X", Ergebnistipp mit Remis) — nicht für, nicht gegen.
 *  against     Tipp zahlt NUR, wenn Wildenroth nicht gewinnt: Gegner-Sieg (1X2), Doppelte Chance
 *              ohne Wildenroth-Sieg (Remis oder Gegner), Handicap „Gegner −N", Ergebnistipp mit
 *              Gegner-Sieg.
 *  neutral     Tore gesamt, BTTS, Über/Unter, Plus-Handicaps, Doppelte Chance „12", Cup-Zusatzmärkte.
 *              Eine neutrale Torwette ist KEINE Gegenwette.
 *
 * Kombis: Der Gewinn wird nie komplett einem Leg zugeschrieben. Anteil des Legs =
 * ln(Quote_leg) / Σ ln(Quote aktiver Legs) (Quoten multiplizieren sich, also teilen sich die
 * Logarithmen den Gewinn). Zugerechnet wird
 *   · bei GEWONNENEN Kombis: Anteil × (Auszahlung − Einsatz),
 *   · bei VERLORENEN Kombis: nur für Legs, die selbst verloren haben, Einsatz / Anzahl verlorener Legs
 *     (ein gewonnenes Gegen-Leg in einer an anderer Stelle gescheiterten Kombi wird nicht bestraft).
 * Diese Werte sind „rechnerisch zugeordnet", keine echten Geldflüsse, und werden so beschriftet.
 */

export const WILDENROTH_TEAM_I = 14
export const WILDENROTH_TEAM_II = 40
export type WildenrothSide = 'I' | 'II'
export type Stance = 'win' | 'supportive' | 'draw' | 'against' | 'neutral'

/** Haltung einer Auswahl, aus Sicht von Wildenroth (`wHome` = Wildenroth ist Heimteam). */
export function classifyStance(marketType: string, selection: string, wHome: boolean): Stance {
  const sel = selection.toLowerCase()
  switch (marketType) {
    case '1x2':
      if (sel === 'draw') return 'draw'
      return (sel === 'home') === wHome ? 'win' : 'against'
    case 'cup_advance':
      return (sel === 'home') === wHome ? 'win' : 'against'
    case 'double_chance':
      if (sel === '12') return 'neutral'
      if (sel === '1x') return wHome ? 'supportive' : 'against'
      if (sel === 'x2') return wHome ? 'against' : 'supportive'
      return 'neutral'
    case 'handicap': {
      if (sel.startsWith('home_minus')) return wHome ? 'win' : 'against'
      if (sel.startsWith('away_minus')) return wHome ? 'against' : 'win'
      return 'neutral'
    }
    case 'exact_score': {
      const [h, a] = sel.split(':').map(Number)
      if (!Number.isFinite(h) || !Number.isFinite(a)) return 'neutral'
      if (h === a) return 'draw'
      return (h > a) === wHome ? 'win' : 'against'
    }
    case 'goalscorer':
    case 'goalscorer_2plus':
      return 'supportive'
    default:
      return 'neutral'
  }
}

export interface WildenrothBucket {
  /** Tipps (Legs), die für diese Haltung gewertet wurden (abgerechnet, nicht storniert). */
  legs: number
  legsHit: number
  /** Verschiedene Wildenroth-Spiele, auf denen es solche Tipps gab. */
  matches: number
  /** Direkt aus Einzelwetten: Nettoergebnis (Gewinn − Einsatz, Verluste negativ). */
  directNet: number
  /** Rechnerisch zugerechnet aus Kombis (siehe Kopfkommentar); NICHT echtes Geld. */
  attributedComboNet: number
}
const emptyBucket = (): WildenrothBucket => ({ legs: 0, legsHit: 0, matches: 0, directNet: 0, attributedComboNet: 0 })

export interface WildenrothUserRecord {
  userId: string
  win: WildenrothBucket
  supportive: WildenrothBucket
  against: WildenrothBucket
  draw: WildenrothBucket
  neutralLegs: number
  /** Wildenroth-Spiele, auf denen der Tipper sowohl für als auch gegen Wildenroth gesetzt hat. */
  matchesBothSides: number
  /** Gesamtsaldo Gegenwetten = directNet + attributedComboNet (inkl. erfolgloser). */
  againstBalance: number
  /** Gesamtsaldo Siegtipps. */
  winBalance: number
}

export type WildenrothScope = 'I' | 'II' | 'all'

function logShare(leg: SlipLeg, active: SlipLeg[]): number {
  const total = active.reduce((a, l) => a + Math.log(Math.max(l.odds, 1.0001)), 0)
  return total > 0 ? Math.log(Math.max(leg.odds, 1.0001)) / total : 1 / active.length
}

export function computeWildenrothRecords(
  slips: Slip[], matches: RecapMatchRow[], scope: WildenrothScope = 'all',
): Map<string, WildenrothUserRecord> {
  const matchById = new Map(matches.map((m) => [m.id, m]))
  const sideOf = (m: RecapMatchRow): { side: WildenrothSide; wHome: boolean } | null => {
    if (m.home_team_id === WILDENROTH_TEAM_I) return { side: 'I', wHome: true }
    if (m.away_team_id === WILDENROTH_TEAM_I) return { side: 'I', wHome: false }
    if (m.home_team_id === WILDENROTH_TEAM_II) return { side: 'II', wHome: true }
    if (m.away_team_id === WILDENROTH_TEAM_II) return { side: 'II', wHome: false }
    return null
  }
  const out = new Map<string, WildenrothUserRecord>()
  const matchSets = new Map<string, Record<'win' | 'supportive' | 'against' | 'draw', Set<number>>>()
  const get = (u: string) => {
    let r = out.get(u)
    if (!r) {
      r = { userId: u, win: emptyBucket(), supportive: emptyBucket(), against: emptyBucket(), draw: emptyBucket(), neutralLegs: 0, matchesBothSides: 0, againstBalance: 0, winBalance: 0 }
      out.set(u, r)
      matchSets.set(u, { win: new Set(), supportive: new Set(), against: new Set(), draw: new Set() })
    }
    return { r, sets: matchSets.get(u)! }
  }

  for (const s of slips) {
    if (s.status !== 'won' && s.status !== 'lost') continue
    const active = s.legs.filter((l) => l.status !== 'neutralized' && l.status !== 'void')
    if (active.length === 0) continue
    const lostLegs = active.filter((l) => l.status === 'lost')
    for (const leg of active) {
      if (leg.matchId == null) continue
      const m = matchById.get(leg.matchId)
      const ctx = m ? sideOf(m) : null
      if (!ctx) continue
      if (scope !== 'all' && ctx.side !== scope) continue
      const stance = classifyStance(leg.marketType, leg.selection, ctx.wHome)
      const { r, sets } = get(s.userId)
      if (stance === 'neutral') { r.neutralLegs++; continue }
      const b = r[stance]
      b.legs++
      if (leg.status === 'won') b.legsHit++
      sets[stance].add(leg.matchId)
      if (s.kind === 'single') {
        b.directNet += s.net
      } else if (s.status === 'won') {
        b.attributedComboNet += logShare(leg, active) * s.net
      } else if (leg.status === 'lost' && lostLegs.length > 0) {
        b.attributedComboNet -= s.stake / lostLegs.length
      }
    }
  }
  for (const [u, r] of out) {
    const sets = matchSets.get(u)!
    for (const k of ['win', 'supportive', 'against', 'draw'] as const) r[k].matches = sets[k].size
    r.matchesBothSides = [...sets.win].filter((id) => sets.against.has(id)).length
    r.againstBalance = r.against.directNet + r.against.attributedComboNet
    r.winBalance = r.win.directNet + r.win.attributedComboNet
  }
  return out
}
