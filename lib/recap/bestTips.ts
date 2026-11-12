import type { Slip } from '@/lib/recap/slips'
import { computeCrowdShares, findCleverHits, findNearMisses, rateBestTips } from '@/lib/recap/hinrundeStats'

/**
 * „Bester Tipp der Hinrunde" (Community, für alle gleich) und „Mein bester Tipp" (persönlich).
 * Beide nutzen DIESELBEN Bewertungsfunktionen (hinrundeStats.rateBestTips/findCleverHits/findNearMisses) –
 * persönlich = dieselbe Rangliste, nur auf die eigenen Scheine gefiltert. Es wird nichts pro Wettzeile nachgeladen:
 * alles rechnet auf der einmal geladenen Scheinliste.
 */

export interface TeamPair { home: string; away: string }
export interface TipLeg { match: string; market: string; selection: string; odds: number; status: string; highlight?: boolean; /** Heim/Gast für Vereinslogos (optional). */ teams?: TeamPair }
export interface TipCard {
  slipKey: string
  userId: string
  kind: 'single' | 'combo'
  matchday: number | null
  stake: number
  odds: number
  /** Auszahlung inkl. Einsatz (nur bei gewonnenen Scheinen), sonst 0. */
  payout: number
  /** Nettogewinn (gewonnen) bzw. 0. */
  net: number
  legs: TipLeg[]
  /** Kurze, verständliche Begründung, warum dieser Schein besonders ist. */
  why: string
}
export interface Labeler { matchLabel: (matchId: number) => string; marketLabel: (market: string) => string; selectionLabel: (market: string, selection: string) => string; matchTeams?: (matchId: number) => TeamPair | null }

const d2 = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const d0 = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 0 })

function legsOf(s: Slip, lab: Labeler, highlightLegBetId?: number): TipLeg[] {
  return s.legs.filter((l) => l.status !== 'neutralized').map((l) => ({
    match: l.matchId != null ? lab.matchLabel(l.matchId) : 'Spieltags-Special',
    market: lab.marketLabel(l.marketType), selection: lab.selectionLabel(l.marketType, l.selection), odds: l.odds, status: l.status,
    highlight: highlightLegBetId != null && l.betId === highlightLegBetId,
    teams: (l.matchId != null ? lab.matchTeams?.(l.matchId) : null) ?? undefined,
  }))
}

function card(s: Slip, lab: Labeler, why: string, highlightLegBetId?: number): TipCard {
  return { slipKey: s.key, userId: s.userId, kind: s.kind, matchday: s.ownerMatchday, stake: s.stake, odds: s.odds, payout: s.status === 'won' ? (s.payout ?? s.stake + s.net) : 0, net: s.status === 'won' ? s.net : 0, legs: legsOf(s, lab, highlightLegBetId), why }
}

/** Erklärung für Einzelwetten: Seltenheit (Anteil der Tipper auf demselben Spiel) und Quote. */
function whySingle(s: Slip, share: number | null, tippers: number, _lab: Labeler): string {
  const rare = share != null && tippers >= 5 && share <= 0.25 ? ` Nur ${Math.round(share * 100)} % der Tipper wählten das.` : ''
  return `${s.odds >= 3 ? 'Ein seltener Treffer.' : 'Einfach richtig gelegen.'}${rare}`
}
function whyCombo(s: Slip): string {
  const n = s.legs.filter((l) => l.status !== 'neutralized').length
  return `${n} Tipps in einem Schein – alle richtig.`
}

export interface CommunityBestTips { single: TipCard | null; combo: TipCard | null; bold: TipCard | null }

export function buildCommunityBestTips(allSlips: Slip[], rangeSlips: Slip[], excluded: Set<string>, lab: Labeler): CommunityBestTips {
  const byKey = new Map(rangeSlips.map((s) => [s.key, s]))
  const rated = rateBestTips(allSlips, rangeSlips, excluded)
  const crowd = computeCrowdShares(allSlips)
  const bs = rated.single[0] ? byKey.get(rated.single[0].slip.key) : undefined
  const bc = rated.combo[0] ? byKey.get(rated.combo[0].slip.key) : undefined
  const single = bs ? (() => { const l = bs.legs[0]; const sh = l.matchId != null ? crowd.share(l.matchId, l.marketType, l.selection) : null; return card(bs, lab, whySingle(bs, sh, l.matchId != null ? crowd.tippersOnMatch(l.matchId) : 0, lab)) })() : null
  const combo = bc ? card(bc, lab, whyCombo(bc)) : null
  // Mutigster Treffer: seltenes Leg eines gewonnenen Scheins – aber NIE derselbe Schein wie oben (keine doppelte Geschichte).
  const used = new Set([single?.slipKey, combo?.slipKey])
  const hit = findCleverHits(allSlips, rangeSlips, excluded).find((h) => !used.has(h.slipKey))
  const hs = hit ? byKey.get(hit.slipKey) : undefined
  const bold = hit && hs ? (() => {
    const leg = hs.legs.find((l) => l.matchId === hit.matchId && l.marketType === hit.marketType && l.selection === hit.selection)
    return card(hs, lab, `Nur ${Math.round(hit.crowdShare * 100)} % der Tipper auf dieses Spiel setzten darauf – und es ging auf.`, leg?.betId)
  })() : null
  return { single, combo, bold }
}

export interface PersonalTips {
  /** Beste eigene gewonnene Wette nach derselben Bewertung wie in der Community. */
  best: TipCard | null
  /** Weitere, nur wenn sie sich vom besten Schein unterscheiden und es genug Daten gibt. */
  extras: { label: string; card: TipCard; missedNet?: number }[]
  wonSlips: number
  settledSlips: number
  /** Größter eigener Nettogewinn (ein Schein). */
  biggestWin: TipCard | null
  /** Knappster Beinahe-Treffer: Kombi, bei der nur ein Tipp fehlte (höchster entgangener Nettogewinn). */
  nearMiss: { card: TipCard; missedNet: number } | null
  /** Team, auf dessen Sieg am häufigsten getippt wurde. */
  favoriteTeam: { name: string; tips: number } | null
}

export function buildPersonalTips(allSlips: Slip[], rangeSlips: Slip[], userId: string, lab: Labeler): PersonalTips {
  const mine = rangeSlips.filter((s) => s.userId === userId)
  const settled = mine.filter((s) => s.status === 'won' || s.status === 'lost')
  const won = mine.filter((s) => s.status === 'won' && !s.legs.some((l) => l.marketType === 'matchday_special'))
  const byKey = new Map(mine.map((s) => [s.key, s]))
  const rated = rateBestTips(allSlips, rangeSlips, new Set())
  const crowd = computeCrowdShares(allSlips)
  const mineSingle = rated.single.find((t) => t.slip.userId === userId)
  const mineCombo = rated.combo.find((t) => t.slip.userId === userId)
  const cs = mineSingle ? byKey.get(mineSingle.slip.key) : undefined
  const cc = mineCombo ? byKey.get(mineCombo.slip.key) : undefined
  const singleCard = cs ? (() => { const l = cs.legs[0]; const sh = l.matchId != null ? crowd.share(l.matchId, l.marketType, l.selection) : null; return card(cs, lab, whySingle(cs, sh, l.matchId != null ? crowd.tippersOnMatch(l.matchId) : 0, lab)) })() : null
  const comboCard = cc ? card(cc, lab, whyCombo(cc)) : null
  const best = mineSingle && mineCombo ? (mineSingle.score >= mineCombo.score ? singleCard : comboCard) : (singleCard ?? comboCard)
  const extras: PersonalTips['extras'] = []
  const seen = new Set([best?.slipKey])
  const add = (label: string, c: TipCard | null, missedNet?: number) => { if (c && !seen.has(c.slipKey)) { seen.add(c.slipKey); extras.push({ label, card: c, missedNet }) } }
  add('Deine beste Einzelwette', singleCard)
  add('Deine beste Kombi', comboCard)
  const hi = [...won].sort((a, b) => b.odds - a.odds)[0]
  if (hi) add('Deine höchste getroffene Quote', card(hi, lab, `Quote ${d2(hi.odds)} – deine höchste gewonnene Quote der Hinrunde.`))
  const miss = findNearMisses(mine)[0]
  if (miss) { const ms = byKey.get(miss.slip.key); if (ms) { const miss2 = card(ms, lab, `Nur ein Tipp fehlte zum Gewinn – dir sind ${d0(miss.potentialNet)} Wildis Nettogewinn entgangen.`); miss2.legs = legsOf(ms, lab).map((l) => ({ ...l, highlight: l.status === 'lost' })); add('Dein knappster verpasster Gewinn', miss2, miss.potentialNet) } }
  const bw = [...won].sort((a, b) => b.net - a.net)[0]
  const biggestWin = bw ? card(bw, lab, `Aus ${d0(bw.stake)} Einsatz wurden ${d0(bw.net + bw.stake)} Wildis.`) : null
  let nearMiss: PersonalTips['nearMiss'] = null
  if (miss) { const ms = byKey.get(miss.slip.key); if (ms) { const c = card(ms, lab, ''); c.legs = legsOf(ms, lab).map((l) => ({ ...l, highlight: l.status === 'lost' })); nearMiss = { card: c, missedNet: miss.potentialNet } } }
  // Lieblings-Team: auf wessen Sieg (1X2 Heim/Gast) hat die Person am häufigsten getippt – je Spiel einmal.
  const fav = new Map<string, number>()
  if (lab.matchTeams) {
    const seenPick = new Set<string>()
    for (const s of mine) for (const l of s.legs) {
      if (l.marketType !== '1x2' || l.matchId == null || (l.selection !== 'home' && l.selection !== 'away') || l.status === 'neutralized' || s.status === 'void') continue
      const k = `${l.matchId}|${l.selection}`; if (seenPick.has(k)) continue; seenPick.add(k)
      const t = lab.matchTeams(l.matchId); if (!t) continue
      const name = l.selection === 'home' ? t.home : t.away
      fav.set(name, (fav.get(name) ?? 0) + 1)
    }
  }
  const top = [...fav.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  return { best, extras, wonSlips: won.length, settledSlips: settled.length, biggestWin, nearMiss, favoriteTeam: top ? { name: top[0], tips: top[1] } : null }
}
