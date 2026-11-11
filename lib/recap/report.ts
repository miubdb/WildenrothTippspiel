import type { Slip, RecapMatchRow } from '@/lib/recap/slips'
import { computeTipperIqRanking, filterSlipsByMatchdays, type TipperIqResult } from '@/lib/recap/tipperIq'
import {
  biggestRankMoves, breakdownSlips, findComboKillers, findOneGoalShort, validateSettleReproduction, type ComboKillers, type OneGoalShortResult, computeOverview, computeTrajectories, findCleverHits, findNearMisses, rateBestTips,
  type CleverHit, type HinrundeOverview, type MatchdayRange, type NearMiss, type RankMove, type RatedTip, type SlipBreakdown,
} from '@/lib/recap/hinrundeStats'
import { computeHalbzeitAwards, type AwardResult } from '@/lib/recap/halbzeitAwards'
import { computeWildenrothRecords, type WildenrothUserRecord } from '@/lib/recap/wildenrothStance'

/**
 * Gesamtbericht für einen Recap-Zeitraum (V1: Hinrunde = Spieltag 1–16). Rein, ohne Datenbank –
 * für Rückrunde, Saison oder Monat reicht ein anderer `range` bzw. eine andere Scheinliste.
 * Der Bericht ist reines JSON (serialisierbar), die UI rechnet nichts nach.
 */
export interface RecapReport {
  version: '1'
  range: MatchdayRange
  /** Stand der Daten (ms): neuester Platzierungszeitpunkt eines einbezogenen Scheins. */
  dataAsOfMs: number
  overview: HinrundeOverview
  /** Aufschlüsselung inkl. offener/stornierter/neutralisierter Scheine. */
  breakdown: SlipBreakdown
  iq: TipperIqResult[]
  awards: AwardResult[]
  bestTips: { single: RatedTip[]; combo: RatedTip[]; clever: CleverHit[]; tragic: NearMiss[] }
  rankMoves: { climb: RankMove | null; crash: RankMove | null }
  wildenroth: { all: WildenrothUserRecord[]; I: WildenrothUserRecord[]; II: WildenrothUserRecord[] }
  /** Namen/Avatare nur für die in Rankings/Awards genannten, nicht gelöschten Tipper. */
  people: Record<string, { name: string; avatarUrl: string | null }>
  /** Zusätzliche Fakten (kein Award): Kombi-Killer-Spiele, „Ein Tor fehlte". */
  facts: {
    comboKillers: ComboKillers
    oneGoalShort: OneGoalShortResult
    /** Je Markt: Anzahl geprüfter Legs und Abweichungen zwischen settleBet und gespeichertem Status (muss 0 sein). */
    settleValidation: Record<string, { checked: number; mismatches: number }>
  }
  /** Lesbare Legs der in Highlights genannten Scheine (Schlüssel = Slip.key). */
  slipLegs: Record<string, { match: string; market: string; selection: string; odds: number; status: string }[]>
  /** Anzeigename je Spiel-ID für Klügster Treffer u. Ä. */
  matchLabels: Record<number, string>
}

export interface ReportInput {
  allSlips: Slip[]
  matches: RecapMatchRow[]
  range: MatchdayRange
  /** Beschriftungen (optional – ohne sie bleiben die Legs leer). */
  labeler?: { matchLabel: (matchId: number) => string; marketLabel: (market: string) => string; selectionLabel: (market: string, selection: string) => string }
  profiles: { id: string; display_name: string | null; username: string | null; avatar_url?: string | null; deleted_at: string | null }[]
}

export function buildRecapReport(inp: ReportInput): RecapReport {
  const { allSlips, matches, range, profiles } = inp
  const excluded = new Set(profiles.filter((p) => p.deleted_at).map((p) => p.id))
  const rangeSlips = filterSlipsByMatchdays(allSlips, range.from, range.to)
  const iq = computeTipperIqRanking(rangeSlips).filter((r) => !excluded.has(r.userId))
  const awards = computeHalbzeitAwards({ rangeSlips, allSlips, matches, iq, range, excluded })
  const tips = rateBestTips(allSlips, rangeSlips, excluded)
  const rec = (scope: 'all' | 'I' | 'II') => [...computeWildenrothRecords(rangeSlips.filter((s) => !excluded.has(s.userId)), matches, scope).values()]
  const traj = computeTrajectories(rangeSlips, excluded)
  const named = new Set<string>()
  for (const r of iq) named.add(r.userId)
  for (const a of awards) for (const e of a.entries) named.add(e.userId)
  for (const t of [...tips.single.slice(0, 3), ...tips.combo.slice(0, 3)]) named.add(t.slip.userId)
  const nm = findNearMisses(rangeSlips).filter((m) => !excluded.has(m.slip.userId)).slice(0, 5)
  const clever = findCleverHits(allSlips, rangeSlips, excluded).slice(0, 5)
  const moves = biggestRankMoves(traj)
  for (const x of [...nm.map((m) => m.slip.userId), ...clever.map((c) => c.userId), moves.climb?.userId, moves.crash?.userId]) if (x) named.add(x)
  for (const w of rec('all')) if (w.win.matches > 0 || w.against.legs > 0) named.add(w.userId)
  const overview = computeOverview(rangeSlips, matches)
  const refKeys = new Set<string>()
  for (const t of [...tips.single.slice(0, 3), ...tips.combo.slice(0, 3)]) refKeys.add(t.slip.key)
  for (const m of nm) refKeys.add(m.slip.key)
  for (const r of [overview.highestOddsWon, overview.biggestSingleWin, overview.biggestComboWin]) if (r) refKeys.add(r.key)
  const slipLegs: RecapReport['slipLegs'] = {}
  const matchLabels: RecapReport['matchLabels'] = {}
  const lab = inp.labeler
  if (lab) {
    for (const s of rangeSlips) if (refKeys.has(s.key)) {
      slipLegs[s.key] = s.legs.filter((l) => l.status !== 'neutralized').map((l) => ({ match: l.matchId != null ? lab.matchLabel(l.matchId) : 'Spieltags-Special', market: lab.marketLabel(l.marketType), selection: lab.selectionLabel(l.marketType, l.selection), odds: l.odds, status: l.status }))
    }
    for (const c of clever) matchLabels[c.matchId] = lab.matchLabel(c.matchId)
    for (const m of nm) if (m.lostLeg.matchId != null) matchLabels[m.lostLeg.matchId] = lab.matchLabel(m.lostLeg.matchId)
  }
  const comboKillers = findComboKillers(rangeSlips, matches, excluded)
  comboKillers.byMatch = comboKillers.byMatch.slice(0, 5)
  const oneGoalShort = findOneGoalShort(rangeSlips, matches, excluded)
  oneGoalShort.cases = oneGoalShort.cases.slice(0, 5)
  if (lab) {
    for (const k of comboKillers.byMatch) matchLabels[k.matchId] = lab.matchLabel(k.matchId)
    for (const c of oneGoalShort.cases) matchLabels[c.matchId] = lab.matchLabel(c.matchId)
  }
  for (const c of oneGoalShort.cases) named.add(c.slip.userId)
  const peopleOut: RecapReport['people'] = {}
  for (const p of profiles) if (named.has(p.id) && !p.deleted_at) peopleOut[p.id] = { name: p.display_name || p.username || 'Unbekannt', avatarUrl: p.avatar_url ?? null }
  return {
    version: '1', range,
    dataAsOfMs: rangeSlips.reduce((m, s) => Math.max(m, s.createdAtMs), 0),
    overview,
    breakdown: breakdownSlips(rangeSlips),
    iq, awards,
    bestTips: { single: tips.single.slice(0, 5), combo: tips.combo.slice(0, 5), clever, tragic: nm },
    rankMoves: moves,
    wildenroth: { all: rec('all'), I: rec('I'), II: rec('II') },
    people: peopleOut, slipLegs, matchLabels,
    facts: { comboKillers, oneGoalShort, settleValidation: validateSettleReproduction(rangeSlips, matches) },
  }
}
