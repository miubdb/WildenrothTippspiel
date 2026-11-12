import type { Slip, RecapMatchRow } from '@/lib/recap/slips'
import { computeTipperIqRanking, filterSlipsByMatchdays, type TipperIqResult } from '@/lib/recap/tipperIq'
import {
  biggestRankMoves, breakdownSlips, findComboKillers, findOneGoalShort, validateSettleReproduction, type ComboKillerMatch, type OneGoalShort, computeOverview, computeTrajectories, lastMinuteWins,
  type HinrundeOverview, type MatchdayRange, type RankMove, type SlipBreakdown,
} from '@/lib/recap/hinrundeStats'
import { buildCommunityBestTips, type CommunityBestTips, type Labeler, type TipCard } from '@/lib/recap/bestTips'
import { computeHalbzeitAwards, type AwardResult } from '@/lib/recap/halbzeitAwards'
import { computeTeamHighlights, pickKillerMatches, type TeamHighlights } from '@/lib/recap/teamHighlights'
import { computeCommunityBank, computeCrowdVsBank, type CommunityBank, type CrowdVsBank } from '@/lib/recap/communityVsBank'
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
  /** Beste Tipps der gesamten Community (für alle gleich): beste Einzelwette, beste Kombi, mutigster Treffer. */
  bestTips: CommunityBestTips
  rankMoves: { climb: RankMove | null; crash: RankMove | null }
  wildenroth: { all: WildenrothUserRecord[]; I: WildenrothUserRecord[]; II: WildenrothUserRecord[] }
  /** Namen/Avatare nur für die in Rankings/Awards genannten, nicht gelöschten Tipper. */
  people: Record<string, { name: string; avatarUrl: string | null }>
  /** Wenige ausgewählte Fakten (kein Award). Gesamtzahlen sind IMMER vollständig; gezeigt werden nur wenige Beispiele. */
  facts: {
    comboKillers: { singleBlockerCombos: number; wildenrothCombos: number; topMatch: ComboKillerMatch | null }
    oneGoalShort: { total: number; ofSingleBlockerCombos: number; notComputable: number; examples: OneGoalShort[] }
    /** Gewonnener Schein, der in den letzten 2 Minuten vor Anpfiff abgegeben wurde (höchste Quote). */
    lastMinute: { card: TipCard; leadSeconds: number } | null
    /** Je Markt: Anzahl geprüfter Legs und Abweichungen zwischen settleBet und gespeichertem Status (muss 0 sein). */
    settleValidation: Record<string, { checked: number; mismatches: number }>
  }
  /** Lesbare Legs der in Highlights genannten Scheine (Schlüssel = Slip.key). */
  slipLegs: Record<string, { match: string; market: string; selection: string; odds: number; status: string; teams?: { home: string; away: string } }[]>
  /** Anzeigename je Spiel-ID für Klügster Treffer u. Ä. */
  matchLabels: Record<number, string>
  /** Heim/Gast der in Highlights genannten Spiele (für Vereinslogos). */
  matchTeams: Record<number, { home: string; away: string }>
  /** Team-Highlights: meistgewettet, schlechtestes Team zum Wetten, Wildenroth I/II. */
  teams: TeamHighlights
  /** „Bank vs. Community“: Wildi-Bilanz der Community (abgerechnete Scheine) und rechnerische Gegenseite. */
  bank: CommunityBank
  /** Nebenrechnung (nur unter „Mehr“): Mehrheit der Tipper vs. Quoten-Favorit beim Spielausgang. */
  crowd: CrowdVsBank
  /** Kombi-Killer-Spiel (meiste gescheiterte Kombis) und teuerstes Spiel (meiste verpasste Gewinne). */
  killers: { killer: ComboKillerMatch | null; priciest: ComboKillerMatch | null }
}

export interface ReportInput {
  allSlips: Slip[]
  matches: RecapMatchRow[]
  range: MatchdayRange
  /** Beschriftungen (optional – ohne sie bleiben die Legs leer). */
  labeler?: Labeler
  /** Teamname je ID (für Team-Highlights). */
  teamName?: (id: number) => string
  profiles: { id: string; display_name: string | null; username: string | null; avatar_url?: string | null; deleted_at: string | null }[]
}

export function buildRecapReport(inp: ReportInput): RecapReport {
  const { allSlips, matches, range, profiles } = inp
  const lab: Labeler = inp.labeler ?? { matchLabel: (id) => `Spiel #${id}`, marketLabel: (m) => m, selectionLabel: (_m, s) => s }
  const excluded = new Set(profiles.filter((p) => p.deleted_at).map((p) => p.id))
  const rangeSlips = filterSlipsByMatchdays(allSlips, range.from, range.to)
  const iq = computeTipperIqRanking(rangeSlips).filter((r) => !excluded.has(r.userId))
  const awards = computeHalbzeitAwards({ rangeSlips, allSlips, matches, iq, range, excluded })
  const rec = (scope: 'all' | 'I' | 'II') => [...computeWildenrothRecords(rangeSlips.filter((s) => !excluded.has(s.userId)), matches, scope).values()]
  const traj = computeTrajectories(rangeSlips, excluded)
  const bestTips = buildCommunityBestTips(allSlips, rangeSlips, excluded, lab)
  const moves = biggestRankMoves(traj)
  const overview = computeOverview(rangeSlips, matches)

  const killers = findComboKillers(rangeSlips, matches, excluded)
  const oneGoal = findOneGoalShort(rangeSlips, matches, excluded)
  const lm = lastMinuteWins(rangeSlips.filter((s) => s.status === 'won'), excluded).filter((w) => w.leadSeconds <= 120).sort((a, b) => b.odds - a.odds)[0]
  const lmSlip = lm ? rangeSlips.find((s) => s.key === lm.slipKey) : undefined
  const lmCard = lm && lmSlip ? { card: { slipKey: lmSlip.key, userId: lmSlip.userId, kind: lmSlip.kind, matchday: lmSlip.ownerMatchday, stake: lmSlip.stake, odds: lmSlip.odds, payout: lmSlip.payout ?? lmSlip.stake + lmSlip.net, net: lmSlip.net, legs: lmSlip.legs.filter((l) => l.status !== 'neutralized').map((l) => ({ match: l.matchId != null ? lab.matchLabel(l.matchId) : 'Spieltags-Special', market: lab.marketLabel(l.marketType), selection: lab.selectionLabel(l.marketType, l.selection), odds: l.odds, status: l.status })), why: `Abgegeben ${Math.round(lm.leadSeconds)} Sekunden vor Anpfiff – und gewonnen.` }, leadSeconds: lm.leadSeconds } : null

  // Kombi-Pech: bitterster Schein mit lesbaren Legs
  const kp = awards.find((a) => a.key === 'kombi_pech')
  const slipLegs: RecapReport['slipLegs'] = {}
  if (kp?.bitterest) {
    const bs = rangeSlips.find((s) => s.key === kp.bitterest!.slipKey)
    if (bs) slipLegs[bs.key] = bs.legs.filter((l) => l.status !== 'neutralized').map((l) => ({ match: l.matchId != null ? lab.matchLabel(l.matchId) : 'Spieltags-Special', market: lab.marketLabel(l.marketType), selection: lab.selectionLabel(l.marketType, l.selection), odds: l.odds, status: l.status }))
  }
  const matchLabels: RecapReport['matchLabels'] = {}
  const km = pickKillerMatches(killers.byMatch)
  for (const k of [km.killer, km.priciest]) if (k) matchLabels[k.matchId] = lab.matchLabel(k.matchId)
  const crowd = computeCrowdVsBank(rangeSlips, matches, excluded)
  const matchTeams: RecapReport['matchTeams'] = {}
  for (const id of Object.keys(matchLabels).map(Number)) { const t = lab.matchTeams?.(id); if (t) matchTeams[id] = t }
  for (const c of oneGoal.cases.slice(0, 2)) matchLabels[c.matchId] = lab.matchLabel(c.matchId)

  // Namen nur für sichtbar genannte, nicht gelöschte Tipper
  const named = new Set<string>()
  for (const r of iq) named.add(r.userId)
  for (const a of awards) if (a.public) { for (const e of a.entries) named.add(e.userId); for (const e of a.second?.entries ?? []) named.add(e.userId); if (a.bitterest) named.add(a.bitterest.userId) }
  for (const c of [bestTips.single, bestTips.bold, bestTips.combo]) if (c) named.add(c.userId)
  for (const w of rec('all')) if (w.win.matches > 0 || w.against.legs > 0) named.add(w.userId)
  for (const c of oneGoal.cases.slice(0, 2)) named.add(c.slip.userId)
  if (lmCard) named.add(lmCard.card.userId)
  if (overview.biggestComboWin) named.add(overview.biggestComboWin.userId)
  if (overview.biggestSingleWin) named.add(overview.biggestSingleWin.userId)
  if (overview.highestOddsWon) named.add(overview.highestOddsWon.userId)
  if (moves.climb) named.add(moves.climb.userId)
  if (moves.crash) named.add(moves.crash.userId)
  const people: RecapReport['people'] = {}
  for (const p of profiles) if (named.has(p.id) && !p.deleted_at) people[p.id] = { name: p.display_name || p.username || 'Unbekannt', avatarUrl: p.avatar_url ?? null }

  return {
    version: '1', range,
    dataAsOfMs: rangeSlips.reduce((m, s) => Math.max(m, s.createdAtMs), 0),
    overview,
    breakdown: breakdownSlips(rangeSlips),
    iq, awards, bestTips,
    rankMoves: moves,
    wildenroth: { all: rec('all'), I: rec('I'), II: rec('II') },
    people, slipLegs, matchLabels, matchTeams, killers: km, crowd, bank: computeCommunityBank(rangeSlips),
    teams: computeTeamHighlights(rangeSlips, matches, inp.teamName ?? ((id) => `Team ${id}`), excluded),
    facts: {
      comboKillers: { singleBlockerCombos: killers.singleBlockerCombos, wildenrothCombos: killers.wildenrothCombos, topMatch: killers.byMatch[0] ?? null },
      oneGoalShort: { total: oneGoal.cases.length, ofSingleBlockerCombos: oneGoal.singleBlockerCombos, notComputable: oneGoal.notComputable, examples: oneGoal.cases.slice(0, 2) },
      lastMinute: lmCard,
      settleValidation: validateSettleReproduction(rangeSlips, matches),
    },
  }
}
