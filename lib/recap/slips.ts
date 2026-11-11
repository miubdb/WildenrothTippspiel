import {
  buildEffectiveMatchdayIndex, recapMatchdayOf, type EffectiveMatchdayIndex,
} from '@/lib/season'
import type { Match } from '@/types'

/**
 * Recap V2 — Wettschein-Normalisierung.
 *
 * Alle Recap-Auswertungen (Hinrunden-Recap, Tipper-IQ, Halbzeit-Awards, spätere
 * Monats-/Persönlich-/Team-Recaps) rechnen auf EINER gemeinsamen Datenbasis: einer Liste von
 * `Slip`s — ein Wettschein ist entweder eine Einzelwette (eine Zeile in `bets` ohne combo_id)
 * oder eine Kombi (eine Zeile in `combo_bets` plus ihre Leg-Zeilen in `bets`). Das ist exakt
 * dieselbe Zählweise wie lib/betStats.ts/lib/awards.ts; sie hier einmal zentral abzubilden
 * verhindert, dass jede neue Auswertung die Kombi-Einsätze wieder anders (oder mehrfach) zählt.
 *
 * Reine Funktionen, keine Datenbankzugriffe — die Daten kommen als Parameter (testbar, und ein
 * historischer Stand lässt sich reproduzieren, indem man `asOf` setzt, siehe buildSlips).
 */

export const RECAP_SEASON = '26/27'

/** Hausmargen des Quotenmodells (lib/odds.ts HOUSE_MARGIN, lib/goalscorer.ts HOUSE_MARGIN).
 *  Dort: odds = 1 / (prob × (1 + margin)) — also ist prob = 1 / (odds × (1 + margin)). */
export const MARGIN_MAIN_MARKETS = 0.12
export const MARGIN_GOALSCORER = 0.15

export interface RecapBetRow {
  id: number
  user_id: string
  match_id: number | null
  market_type: string
  selection: string
  stake: number | null
  odds_value: number
  status: 'pending' | 'won' | 'lost' | 'void' | 'neutralized'
  payout: number | null
  combo_id: number | null
  created_at: string
  is_risky: boolean | null
  season: string | null
  is_bonus: boolean | null
  void_reason: string | null
  special_id: number | null
  neutralized_reason?: string | null
}

export interface RecapComboRow {
  id: number
  user_id: string
  stake: number
  total_odds: number
  status: 'pending' | 'won' | 'lost' | 'void' | 'neutralized'
  payout: number | null
  created_at: string
  season: string | null
  void_reason: string | null
  original_total_odds: number | null
}

export type RecapMatchRow = Pick<
  Match,
  'id' | 'matchday' | 'match_date' | 'status' | 'match_category' | 'is_topspiel' | 'tippspiel_matchday'
  | 'home_team_id' | 'away_team_id' | 'home_score' | 'away_score' | 'competition_type'
>

export interface SlipLeg {
  betId: number
  matchId: number | null
  marketType: string
  selection: string
  odds: number
  status: RecapBetRow['status']
  specialId: number | null
  /** Recap-Spieltag dieses Legs (recapMatchdayOf) — null, wenn das Spiel unbekannt/Testspieltag ist. */
  recapMatchday: number | null
}

export type SlipStatus = 'pending' | 'won' | 'lost' | 'void' | 'neutralized'

export interface Slip {
  /** Eindeutig über Einzelwetten und Kombis hinweg: `s<betId>` bzw. `c<comboId>`. */
  key: string
  kind: 'single' | 'combo'
  userId: string
  /** Zeitstempel der Platzierung (ms). */
  createdAtMs: number
  stake: number
  /** Wirksame Quote: bei Kombis `combo_bets.total_odds` (bei Teil-Annullierung bereits aus den
   *  verbleibenden Legs neu berechnet, siehe docs/spielannullierung-regelwerk.md). */
  odds: number
  status: SlipStatus
  /** Nur für 'won' gesetzt (gespeicherter, bereits gedeckelter Wert aus der Abrechnung). */
  payout: number | null
  /** Netto (payout − stake) für won/lost, sonst 0. Offene/stornierte/neutralisierte Scheine
   *  sind weder Gewinn noch Verlust. */
  net: number
  isRisky: boolean
  isBonus: boolean
  legs: SlipLeg[]
  /** Spieltag, dem der Schein für alle Auswertungen zugeordnet wird: der früheste Recap-Spieltag
   *  seiner Legs — dieselbe Regel wie lib/awards.ts#computeAndPersistMatchdayAwards und
   *  app/(app)/recap/[matchday]/page.tsx, damit Recap-Summen und Pokale nie auseinanderlaufen. */
  ownerMatchday: number | null
  /** Früheste Anstoßzeit aller Legs (ms) — für Zeitabstands-Auswertungen. null bei reinen
   *  Special-Scheinen ohne eigenes Spiel. */
  firstKickoffMs: number | null
}

export interface SlipBuildInput {
  bets: RecapBetRow[]
  combos: RecapComboRow[]
  matches: RecapMatchRow[]
  /** Nur Wetten, die bis einschließlich dieses Zeitpunkts platziert wurden — macht historische
   *  Stände reproduzierbar, ohne später hinzugekommene Wetten einzubeziehen. */
  asOfMs?: number
  season?: string
}

function marketMargin(marketType: string): number {
  return marketType === 'goalscorer' || marketType === 'goalscorer_2plus' ? MARGIN_GOALSCORER : MARGIN_MAIN_MARKETS
}

/**
 * Modell-Wahrscheinlichkeit eines Scheins aus den Leg-Quoten, bereinigt um die bekannte Hausmarge:
 * p = Π 1 / (odds_i × (1 + margin_i)). Neutralisierte Legs (Quote 1,00 per Regelwerk) zählen nicht.
 * Gedeckelt auf [0, 0,995], damit eine 1,01er-Quote nie p ≥ 1 ergibt.
 */
export function modelProbability(slip: Pick<Slip, 'legs' | 'odds' | 'kind'>): number {
  const active = slip.legs.filter((l) => l.status !== 'neutralized' && l.status !== 'void')
  if (active.length === 0) return 0
  let p = 1
  for (const l of active) p *= 1 / (l.odds * (1 + marketMargin(l.marketType)))
  return Math.min(p, 0.995)
}

export function buildSlips(input: SlipBuildInput): { slips: Slip[]; mdIndex: EffectiveMatchdayIndex } {
  const season = input.season ?? RECAP_SEASON
  const asOfMs = input.asOfMs ?? Number.POSITIVE_INFINITY
  const mdIndex = buildEffectiveMatchdayIndex(input.matches as unknown as Match[])
  const matchById = new Map(input.matches.map((m) => [m.id, m]))
  const recapMd = new Map<number, number | null>(
    input.matches.map((m) => [m.id, recapMatchdayOf(m as unknown as Match, mdIndex)]),
  )

  const seasonBets = input.bets.filter((b) => b.season === season && new Date(b.created_at).getTime() <= asOfMs)
  const legRowsByCombo = new Map<number, RecapBetRow[]>()
  for (const b of seasonBets) {
    if (b.combo_id == null) continue
    const arr = legRowsByCombo.get(b.combo_id)
    if (arr) arr.push(b)
    else legRowsByCombo.set(b.combo_id, [b])
  }

  const toLeg = (b: RecapBetRow): SlipLeg => ({
    betId: b.id,
    matchId: b.match_id,
    marketType: b.market_type,
    selection: b.selection,
    odds: Number(b.odds_value),
    status: b.status,
    specialId: b.special_id,
    recapMatchday: b.match_id != null ? (recapMd.get(b.match_id) ?? null) : null,
  })

  const finish = (partial: Omit<Slip, 'ownerMatchday' | 'firstKickoffMs'>): Slip | null => {
    const mds = partial.legs.map((l) => l.recapMatchday).filter((x): x is number => x != null)
    // Wett-Scheine auf dem Testspieltag (999) gehören in keine Auswertung.
    if (mds.some((md) => md >= 900)) return null
    const kicks = partial.legs
      .map((l) => (l.matchId != null ? matchById.get(l.matchId)?.match_date : undefined))
      .filter((d): d is string => !!d)
      .map((d) => new Date(d).getTime())
    return {
      ...partial,
      ownerMatchday: mds.length > 0 ? Math.min(...mds) : null,
      firstKickoffMs: kicks.length > 0 ? Math.min(...kicks) : null,
    }
  }

  const slips: Slip[] = []

  for (const b of seasonBets) {
    if (b.combo_id != null) continue
    const stake = Number(b.stake ?? 0)
    const status = b.status
    const payout = status === 'won' ? Number(b.payout ?? 0) : null
    const s = finish({
      key: `s${b.id}`,
      kind: 'single',
      userId: b.user_id,
      createdAtMs: new Date(b.created_at).getTime(),
      stake,
      odds: Number(b.odds_value),
      status,
      payout,
      net: status === 'won' ? Number(b.payout ?? 0) - stake : status === 'lost' ? -stake : 0,
      isRisky: !!b.is_risky,
      isBonus: !!b.is_bonus,
      legs: [toLeg(b)],
    })
    if (s) slips.push(s)
  }

  for (const c of input.combos) {
    if (c.season !== season || new Date(c.created_at).getTime() > asOfMs) continue
    const legRows = legRowsByCombo.get(c.id) ?? []
    if (legRows.length === 0) continue
    const stake = Number(c.stake)
    const s = finish({
      key: `c${c.id}`,
      kind: 'combo',
      userId: c.user_id,
      createdAtMs: new Date(c.created_at).getTime(),
      stake,
      odds: Number(c.total_odds),
      status: c.status,
      payout: c.status === 'won' ? Number(c.payout ?? 0) : null,
      net: c.status === 'won' ? Number(c.payout ?? 0) - stake : c.status === 'lost' ? -stake : 0,
      // combo_bets hat keine eigene is_risky-Spalte — jedes Leg trägt denselben Wert (lib/risky.ts).
      isRisky: legRows.some((l) => !!l.is_risky),
      isBonus: legRows.some((l) => !!l.is_bonus),
      legs: legRows.map(toLeg),
    })
    if (s) slips.push(s)
  }

  slips.sort((a, b) => a.createdAtMs - b.createdAtMs || a.key.localeCompare(b.key))
  return { slips, mdIndex }
}

export const isSettled = (s: Pick<Slip, 'status'>): boolean => s.status === 'won' || s.status === 'lost'
