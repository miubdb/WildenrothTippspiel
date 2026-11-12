import { settleBet } from '@/lib/settleBet'
import { cappedPayout } from '@/lib/payout'
import type { RecapBetRow, RecapComboRow, RecapMatchRow } from '@/lib/recap/slips'

/**
 * Synthetische Testdaten für die isolierte Recap-Demo (app/recap-demo/*). KEINE echten Personen, Wetten oder Ergebnisse:
 * erfundene Tipper, deterministisch aus einem festen Seed erzeugt. Dient dazu, den Winter-Recap in einer Umgebung ohne
 * Datenbank vollständig zu zeigen (inkl. Pokalspiel, Pokal-Bonus-Tipps, Stornos, neutralisiertem Leg, gelöschtem Konto
 * und offenem Spieltag 16, den `simulateSpieltag` anschließend im Speicher „abschließt").
 */

function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const pois = (r: () => number, mu: number) => { const L = Math.exp(-mu); let k = 0, p = 1; do { k++; p *= r() } while (p > L && k < 12); return k - 1 }

export const FIXTURE_TEAM_NAMES: Record<number, string> = { 14: 'SpVgg Wildenroth', 40: 'SpVgg Wildenroth II', 1: 'SV Beispielheim', 2: 'FC Testdorf', 3: 'TSV Musterau', 4: 'SC Probstadt', 5: 'SG Demohausen', 6: 'FC Fixturen', 7: 'TSV Platzhalter', 8: 'SV Mockingen', 9: 'TSV Geiselbullach (Demo)', 10: 'FC Stubbach', 11: 'SC Attrappe', 12: 'SV Dummelfeld', 13: 'TSV Nullacher' }
export const FIXTURE_PLAYERS: Record<number, string> = { 1: 'Max Mustermann', 2: 'Lukas Beispiel', 3: 'Jonas Testmann', 4: 'Felix Demo', 5: 'Tim Platzhalter', 6: 'Paul Fixture', 7: 'Ben Attrappe', 8: 'Noah Dummy' }
const NAMES = ['Anna Test', 'Ben Muster', 'Clara Demo', 'David Fix', 'Emma Probe', 'Finn Beispiel', 'Greta Attrappe', 'Hannes Dummy', 'Ida Platzhalter', 'Jonas Mock', 'Karla Stub', 'Leon Test', 'Mia Muster', 'Nico Demo', 'Olga Fix', 'Paul Probe', 'Quirin Beispiel', 'Rosa Attrappe', 'Sepp Dummy', 'Tina Platzhalter', 'Uwe Mock', 'Vera Stub', 'Willi Test', 'Xenia Muster']

export interface FixtureData {
  matches: RecapMatchRow[]
  bets: RecapBetRow[]
  combos: RecapComboRow[]
  profiles: { id: string; display_name: string | null; username: string | null; avatar_url: string | null; deleted_at: string | null; is_admin: boolean | null }[]
  teams: Map<number, string>
  players: Record<number, string>
}

export function buildFixtureData(): FixtureData {
  const r = rng(20261112)
  const matches: RecapMatchRow[] = []
  const meta = new Map<number, { muH: number; muA: number }>()
  let mid = 1000
  const kick = (md: number, k: number) => new Date(Date.UTC(2026, 7, 15 + (md - 1) * 7, 13 + (k % 3), 0, 0)).toISOString()
  for (let md = 1; md <= 16; md++) {
    const pairs: [number, number][] = [[14, 1 + (md % 6)], [7 + (md % 4), 11 + (md % 3)], [2, 5], [3, 8 + (md % 2)], [4, 6], [40, 9 + (md % 3)]]
    pairs.forEach(([h, a], i) => {
      const id = ++mid
      const home = md % 2 === 0 && i === 0 ? a : h, away = md % 2 === 0 && i === 0 ? h : a
      const muH = home === 14 ? 2.0 : 1.5, muA = away === 14 ? 1.4 : 1.2
      meta.set(id, { muH, muA })
      const done = md < 16
      matches.push({ id, matchday: md, match_date: kick(md, i), status: done ? 'finished' : 'scheduled', match_category: i === 5 ? 'wildenroth_ii' : 'kreisliga', is_topspiel: false, tippspiel_matchday: null, home_team_id: home, away_team_id: away, home_score: done ? pois(r, muH) : null, away_score: done ? pois(r, muA) : null, competition_type: 'league' } as RecapMatchRow)
    })
    if (md === 7) { // Pokalspiel
      const id = ++mid
      meta.set(id, { muH: 1.2, muA: 1.6 })
      matches.push({ id, matchday: 7, match_date: new Date(Date.UTC(2026, 8, 9, 17, 0, 0)).toISOString(), status: 'finished', match_category: 'kreisliga', is_topspiel: false, tippspiel_matchday: null, home_team_id: 14, away_team_id: 9, home_score: 1, away_score: 4, competition_type: 'cup' } as RecapMatchRow)
    }
  }
  const byMd = new Map<number, RecapMatchRow[]>()
  for (const m of matches) (byMd.get(m.matchday) ?? byMd.set(m.matchday, []).get(m.matchday)!).push(m)
  const cupId = matches.find((m) => m.competition_type === 'cup')!.id

  // Wahrscheinlichkeit eines Marktes (Poisson-Matrix) → Quote mit 12 % Marge
  const prob = (mt: string, sel: string, id: number): number => {
    const { muH, muA } = meta.get(id) ?? { muH: 1.5, muA: 1.2 }
    const pm = (mu: number, k: number) => Math.exp(-mu) * Math.pow(mu, k) / [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800, 39916800, 479001600][k]
    let p = 0
    for (let h = 0; h <= 12; h++) for (let a = 0; a <= 12; a++) {
      const w = pm(muH, h) * pm(muA, a)
      const hit = mt === '1x2' ? sel === (h > a ? 'home' : h < a ? 'away' : 'draw')
        : mt === 'double_chance' ? (sel === '1x' ? h >= a : sel === 'x2' ? h <= a : h !== a)
        : mt === 'btts' ? (sel === 'yes') === (h > 0 && a > 0)
        : mt === 'over_under_3_5' ? (sel === 'over_3.5') === (h + a > 3.5)
        : mt === 'handicap' ? (h - a > 1.5) : mt === 'exact_score' ? sel === `${h}:${a}` : false
      if (hit) p += w
    }
    return p
  }
  const MK: [string, string[]][] = [['1x2', ['home', 'draw', 'away']], ['double_chance', ['1x', 'x2', '12']], ['btts', ['yes', 'no']], ['over_under_3_5', ['over_3.5', 'under_3.5']], ['handicap', ['home_minus_1_5']], ['exact_score', ['1:0', '2:1', '1:1', '0:1', '2:0']], ['goalscorer', ['1', '2', '3', '4', '5', '6', '7', '8']]]
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const mkLeg = (m: RecapMatchRow) => {
    const [mt, sels] = pick(MK)
    const sel = pick(sels)
    const p = mt === 'goalscorer' ? 0.12 + r() * 0.35 : Math.max(0.02, prob(mt, sel, m.id))
    const odds = Math.round(Math.min(100, Math.max(1.05, 1 / (p * (mt === 'goalscorer' ? 1.15 : 1.12)))) * 100) / 100
    return { m, mt, sel, p, odds }
  }
  const legWon = (m: RecapMatchRow, mt: string, sel: string, p: number): boolean | null => {
    if (m.status !== 'finished' || m.home_score == null || m.away_score == null) return null
    if (mt === 'goalscorer') return r() < p
    return settleBet(mt, sel, m.home_score, m.away_score) === 'won'
  }

  const profiles = NAMES.map((n, i) => ({ id: `fx-u${String(i + 1).padStart(2, '0')}`, display_name: n, username: n.toLowerCase().replace(/ /g, '_'), avatar_url: null, deleted_at: null as string | null, is_admin: i === 0 }))
  profiles.push({ id: 'fx-gone', display_name: 'Gelöschtes Konto', username: 'geloescht', avatar_url: null, deleted_at: '2026-10-01T00:00:00Z', is_admin: false })

  const bets: RecapBetRow[] = []
  const combos: RecapComboRow[] = []
  let bid = 5000, cid = 900
  for (const pr of profiles) {
    const act = pr.id === 'fx-gone' ? 0.5 : 0.55 + r() * 0.4
    for (let md = 1; md <= 16; md++) {
      if (r() > act) continue
      const ms = byMd.get(md) ?? []
      const nSlips = 1 + Math.floor(r() * 3)
      for (let s = 0; s < nSlips; s++) {
        const created = new Date(new Date(ms[0].match_date).getTime() - (2 + r() * 120) * 3600_000).toISOString()
        const cancelled = r() < 0.06
        const isCombo = r() < 0.65
        const stake = pick([10, 20, 25, 50, 100, 200])
        const legsM = isCombo ? [...ms].sort(() => r() - 0.5).slice(0, 2 + Math.floor(r() * 3)) : [pick(ms)]
        const legs = legsM.map((m) => mkLeg(m))
        // Ausgang deterministisch aus dem Ergebnis (Torschützen: Zufall mit Wahrscheinlichkeit ≈ 1/Quote)
        const real = legs.map((l) => legWon(l.m, l.mt, l.sel, l.p))
        const open = legs.some((l) => l.m.status !== 'finished')
        const allWon = real.every((x) => x === true)
        const status: RecapBetRow['status'] = cancelled ? 'void' : open ? 'pending' : allWon ? 'won' : 'lost'
        const risky = isCombo && legs.reduce((a, l) => a * l.odds, 1) >= 20
        if (!isCombo) {
          const l = legs[0]
          bets.push({ id: ++bid, user_id: pr.id, match_id: l.m.id, market_type: l.mt, selection: l.sel, stake, odds_value: l.odds, status, payout: status === 'won' ? cappedPayout(stake, l.odds, false) : status === 'lost' ? 0 : null, combo_id: null, created_at: created, is_risky: false, season: '26/27', is_bonus: false, void_reason: cancelled ? 'user_cancelled' : null, special_id: null })
        } else {
          const total = Math.round(legs.reduce((a, l) => a * l.odds, 1) * 100) / 100
          const id = ++cid
          combos.push({ id, user_id: pr.id, stake, total_odds: total, status, payout: status === 'won' ? cappedPayout(stake, total, risky) : status === 'lost' ? 0 : null, created_at: created, season: '26/27', void_reason: cancelled ? 'user_cancelled' : null, original_total_odds: null })
          legs.forEach((l, i) => bets.push({ id: ++bid, user_id: pr.id, match_id: l.m.id, market_type: l.mt, selection: l.sel, stake: null, odds_value: l.odds, status: cancelled ? 'void' : open && l.m.status !== 'finished' ? 'pending' : open ? 'pending' : real[i] ? 'won' : 'lost', payout: 0, combo_id: id, created_at: created, is_risky: risky, season: '26/27', is_bonus: false, void_reason: cancelled ? 'user_cancelled' : null, special_id: null }))
        }
      }
    }
  }
  // Pokalspiel: normale Wetten + Pokal-Bonus-Tipps (is_bonus, echter Einsatz)
  const cup = matches.find((m) => m.id === cupId)!
  const cupBets: [string, string, string, number, number, boolean][] = [['fx-u02', 'cup_early_goal', 'yes', 1.7, 50, true], ['fx-u03', 'cup_ht_more_goals', 'h2', 1.8, 100, true], ['fx-u04', 'btts', 'yes', 1.23, 250, true], ['fx-u05', 'cup_early_goal', 'no', 1.9, 14, false], ['fx-u06', 'goalscorer', '3', 2.05, 30, false], ['fx-u07', 'btts', 'yes', 1.23, 250, false]]
  for (const [u, mt, sel, odds, stake, bonus] of cupBets) {
    const won = mt === 'cup_early_goal' ? (sel === 'yes') === true : mt === 'cup_ht_more_goals' ? sel === 'h2' ? false : false : mt === 'btts' ? true : false
    bets.push({ id: ++bid, user_id: u, match_id: cup.id, market_type: mt, selection: sel, stake, odds_value: odds, status: won ? 'won' : 'lost', payout: won ? Math.round(stake * odds * 100) / 100 : 0, combo_id: null, created_at: '2026-09-09T12:00:00Z', is_risky: false, season: '26/27', is_bonus: bonus, void_reason: null, special_id: null })
  }
  // Gezielte Geschichten: Last-Minute-Treffer (40 s vor Anpfiff) und mehrere Außenseiter-Treffer (Quote ≥ 5)
  const winSel = (m: RecapMatchRow) => (m.home_score! > m.away_score! ? 'home' : m.home_score! < m.away_score! ? 'away' : 'draw')
  const addWin = (u: string, m: RecapMatchRow, odds: number, stake: number, leadSec: number) => bets.push({ id: ++bid, user_id: u, match_id: m.id, market_type: '1x2', selection: winSel(m), stake, odds_value: odds, status: 'won', payout: cappedPayout(stake, odds, false), combo_id: null, created_at: new Date(new Date(m.match_date).getTime() - leadSec * 1000).toISOString(), is_risky: false, season: '26/27', is_bonus: false, void_reason: null, special_id: null })
  const fin = matches.filter((m) => m.status === 'finished' && m.competition_type === 'league' && m.id !== byMd.get(13)![3].id)
  addWin('fx-u09', fin[20], 6.8, 50, 40)
  fin.slice(30, 34).forEach((m, i) => addWin('fx-u10', m, 5.2 + i * 0.7, 20 + i * 10, 3600 * (6 + i)))
  // Annulliertes Spiel + neutralisiertes Leg (Quote 1,00, Kombi bleibt aktiv)
  const ann = byMd.get(13)![3]
  ann.status = 'annulled'; ann.home_score = null; ann.away_score = null
  for (const b of bets) if (b.match_id === ann.id && b.status !== 'void') { b.status = 'neutralized' }
  return { matches, bets, combos, profiles, teams: new Map(Object.entries(FIXTURE_TEAM_NAMES).map(([k, v]) => [Number(k), v])), players: FIXTURE_PLAYERS }
}
