import { buildEffectiveMatchdayIndex, recapMatchdayOf } from '@/lib/season'
import { cappedPayout } from '@/lib/payout'
import { settleBet } from '@/lib/settleBet'
import type { Match } from '@/types'
import type { RecapBetRow, RecapComboRow, RecapMatchRow } from '@/lib/recap/slips'

/**
 * TEST-SIMULATION für die Vorschau des Hinrunden-Recaps (Preview-only).
 *
 * Zweck: das fertige Recap-Erlebnis schon ansehen, obwohl Spieltag 16 noch nicht gespielt ist. Alles geschieht
 * ausschließlich IM SPEICHER dieser einen Anfrage: es werden KEINE Daten geschrieben, nichts in der Datenbank
 * verändert, keine Einstellung gesetzt. Die Ergebnisse (Tore, Gewinn/Verlust der offenen Wetten) sind erfundene
 * Testwerte und werden in der Oberfläche eindeutig als solche gekennzeichnet.
 *
 * Wird NIE in Production aktiv (`isPreviewEnvironment`), und auch dort nur für Admins und nur mit ausdrücklichem
 * `?test=sim16`. Die reguläre Bereitschaftsprüfung (lib/recap/availability.ts) bleibt unverändert und läuft danach
 * auf den simulierten Daten – so sieht man dieselbe Logik, nur mit angenommenen Ergebnissen.
 */

/** Vercel setzt VERCEL_ENV selbst ('production' | 'preview' | 'development'); lokal gilt NODE_ENV=development. */
export function isPreviewEnvironment(): boolean {
  return process.env.VERCEL_ENV === 'preview' || (process.env.VERCEL_ENV == null && process.env.NODE_ENV === 'development')
}

/** Deterministische Zahl in [0,1) aus einer ID (stabile Testergebnisse bei jedem Neuladen). */
function unit(seed: number): number {
  let x = (seed * 2654435761) >>> 0
  x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13
  return (x >>> 0) / 4294967296
}

export interface SimulationResult {
  matches: RecapMatchRow[]
  bets: RecapBetRow[]
  combos: RecapComboRow[]
  simulatedMatchIds: number[]
  simulatedBetRows: number
}

export function simulateSpieltag(
  raw: { matches: RecapMatchRow[]; bets: RecapBetRow[]; combos: RecapComboRow[] }, matchday: number, season = '26/27',
): SimulationResult {
  const idx = buildEffectiveMatchdayIndex(raw.matches as unknown as Match[])
  const target = new Set(raw.matches.filter((m) => recapMatchdayOf(m as unknown as Match, idx) === matchday && m.status !== 'postponed' && m.status !== 'annulled').map((m) => m.id))
  const scores = new Map<number, [number, number]>()
  const matches = raw.matches.map((m) => {
    if (!target.has(m.id) || m.status === 'finished') return m
    const h = Math.floor(unit(m.id * 7 + 1) * 4), a = Math.floor(unit(m.id * 11 + 3) * 3)
    scores.set(m.id, [h, a])
    return { ...m, status: 'finished' as const, home_score: h, away_score: a }
  })
  const matchScore = new Map(matches.map((m) => [m.id, m]))

  const legWon = (b: RecapBetRow): boolean => {
    const m = b.match_id != null ? matchScore.get(b.match_id) : undefined
    const sim = b.match_id != null && scores.has(b.match_id)
    if (m && sim && m.home_score != null && m.away_score != null && ['1x2', 'double_chance', 'btts', 'over_under_2_5', 'over_under_3_5', 'over_under_5_5', 'over_9_5', 'handicap', 'exact_score'].includes(b.market_type)) {
      return settleBet(b.market_type, b.selection, m.home_score, m.away_score) === 'won'
    }
    // Torschützen u. Ä.: nicht aus dem Ergebnis ableitbar → deterministisch mit der Wahrscheinlichkeit ≈ 1/(Quote·Marge).
    return unit(b.id * 13 + 5) < 1 / (Number(b.odds_value) * 1.12)
  }
  const touched = (b: RecapBetRow) => b.season === season && b.status === 'pending' && b.match_id != null && scores.has(b.match_id)

  let simulatedBetRows = 0
  const legStatus = new Map<number, 'won' | 'lost'>()
  for (const b of raw.bets) if (touched(b)) legStatus.set(b.id, legWon(b) ? 'won' : 'lost')

  const bets = raw.bets.map((b) => {
    const st = legStatus.get(b.id)
    if (!st) return b
    simulatedBetRows++
    if (b.combo_id != null) return { ...b, status: st, payout: 0 }
    const stake = Number(b.stake ?? 0)
    return { ...b, status: st, payout: st === 'won' ? cappedPayout(stake, Number(b.odds_value), !!b.is_risky) : 0 }
  })
  const legsByCombo = new Map<number, RecapBetRow[]>()
  for (const b of bets) if (b.combo_id != null) (legsByCombo.get(b.combo_id) ?? legsByCombo.set(b.combo_id, []).get(b.combo_id)!).push(b)
  const combos = raw.combos.map((c) => {
    if (c.season !== season || c.status !== 'pending') return c
    const legs = (legsByCombo.get(c.id) ?? []).filter((l) => l.status !== 'neutralized' && l.status !== 'void')
    if (legs.length === 0 || legs.some((l) => l.status === 'pending')) return c
    const won = legs.every((l) => l.status === 'won')
    return { ...c, status: won ? ('won' as const) : ('lost' as const), payout: won ? cappedPayout(Number(c.stake), Number(c.total_odds), legs.some((l) => !!l.is_risky)) : 0 }
  })
  return { matches, bets, combos, simulatedMatchIds: [...scores.keys()], simulatedBetRows }
}
