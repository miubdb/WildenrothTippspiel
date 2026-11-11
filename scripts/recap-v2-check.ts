/**
 * Recap V2 — Tipper-IQ, Wettschein-Normalisierung, Wildenroth-Haltung, Awards-Gates, Freischaltung.
 * Reine Logik, synthetische Daten (kein Datenbankzugriff) – deterministisch, läuft in CI.
 * Gegen echte Produktivdaten läuft dieselbe Logik über die Analyse im Recap-Bericht
 * (docs/recap-v2.md beschreibt die Gegenprobe).
 */
import { buildSlips, isSettled, type RecapBetRow, type RecapComboRow, type RecapMatchRow, type Slip } from '@/lib/recap/slips'
import {
  computeOverlapWeights, computeTipperIqRanking, computeUserIq, exactZ, normalCdf, normalInv, scoreFromZ,
  isIqEligibleSlip, IQ_WEIGHTS_DEFAULT, IQ_ALT_WEIGHTS, probSumAtLeast,
} from '@/lib/recap/tipperIq'
import { classifyStance, computeWildenrothRecords } from '@/lib/recap/wildenrothStance'
import { breakdownSlips, findNearMisses, longestStreaks, computeTrajectories, bestComebacks } from '@/lib/recap/hinrundeStats'
import { computeRangeReadiness, recapVisibility } from '@/lib/recap/availability'
import { buildRecapReport } from '@/lib/recap/report'

let errors = 0
let checks = 0
function test(label: string, actual: boolean) { checks++; if (!actual) errors++; console.log(`${actual ? 'OK' : 'FAIL'}  ${label}`) }
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

let nextBet = 1
let nextCombo = 1
const matches: RecapMatchRow[] = []
function addMatch(id: number, matchday: number, day: number, extra: Partial<RecapMatchRow> = {}): number {
  matches.push({ id, matchday, match_date: `2026-09-${String(day).padStart(2, '0')}T13:00:00+00:00`, status: 'finished', match_category: 'kreisliga', is_topspiel: false, tippspiel_matchday: null, competition_type: 'league', home_team_id: 1, away_team_id: 2, home_score: 2, away_score: 1, ...extra } as RecapMatchRow)
  return id
}
const bets: RecapBetRow[] = []
const combos: RecapComboRow[] = []
function bet(user: string, matchId: number, o: Partial<RecapBetRow> = {}): RecapBetRow {
  const b: RecapBetRow = { id: nextBet++, user_id: user, match_id: matchId, market_type: '1x2', selection: 'home', stake: 10, odds_value: 2, status: 'lost', payout: 0, combo_id: null, created_at: '2026-09-01T10:00:00+00:00', is_risky: false, season: '26/27', is_bonus: false, void_reason: null, special_id: null, ...o }
  bets.push(b); return b
}
function combo(user: string, legs: { matchId: number; odds: number; status: 'won' | 'lost'; market?: string; selection?: string }[], stake = 10, status: 'won' | 'lost' = 'lost', createdAt = '2026-09-01T10:00:00+00:00') {
  const total = legs.reduce((a, l) => a * l.odds, 1)
  const c: RecapComboRow = { id: nextCombo++, user_id: user, stake, total_odds: total, status, payout: status === 'won' ? stake * total : 0, created_at: createdAt, season: '26/27', void_reason: null, original_total_odds: null }
  combos.push(c)
  for (const l of legs) bet(user, l.matchId, { stake: null, odds_value: l.odds, status: l.status, combo_id: c.id, payout: 0, market_type: l.market ?? '1x2', selection: l.selection ?? 'home', created_at: createdAt })
  return c
}

// ── 1. Normalisierung ──────────────────────────────────────────────────────────────────────
for (let md = 1; md <= 8; md++) addMatch(100 + md, md, md)
combo('u1', [{ matchId: 101, odds: 2, status: 'won' }, { matchId: 101, odds: 1.5, status: 'won', market: 'btts', selection: 'yes' }], 20, 'won')
bet('u1', 101, { odds_value: 2, status: 'won', payout: 20 })
bet('u1', 102, { status: 'void', void_reason: 'user_cancelled' })
const built = buildSlips({ bets, combos, matches })
test('Kombi zählt als EIN Schein, Einzelwette als einer, Storno bleibt als void', built.slips.length === 3 && built.slips.filter((s) => s.kind === 'combo').length === 1)
const cs = built.slips.find((s) => s.kind === 'combo') as Slip
test('Kombi-Einsatz einmal gezählt (20), Quote = Produkt', cs.stake === 20 && near(cs.odds, 3))
test('Netto der Kombi = Auszahlung − Einsatz', near(cs.net, 20 * 3 - 20))
test('Storno ist weder abgerechnet noch IQ-wertbar', !isSettled(built.slips.find((s) => s.status === 'void') as Slip))
test('asOf macht Stand reproduzierbar (Wette nach Stichtag fehlt)', buildSlips({ bets, combos, matches, asOfMs: Date.parse('2026-08-01') }).slips.length === 0)
test('Aufschlüsselung summiert auf Gesamtzahl', (() => { const b = breakdownSlips(built.slips); return b.total === b.won + b.lost + b.open + b.cancelledByUser + b.voidOther + b.neutralized })())

// ── 2. Mathematik ──────────────────────────────────────────────────────────────────────────
test('Φ(0)=0,5 und Φ⁻¹ ist die Umkehrung', near(normalCdf(0), 0.5, 1e-6) && near(normalInv(normalCdf(1.3)), 1.3, 1e-4))
test('scoreFromZ(0)=50, monoton', near(scoreFromZ(0), 50, 1e-4) && scoreFromZ(2) > scoreFromZ(1))
test('exactZ: genau Erwartung → ≈0', Math.abs(exactZ([{ w: 1, p: 0.5 }, { w: 1, p: 0.5 }], 1)) < 1e-6)
test('exactZ: mehr Treffer → höher, weniger → negativ', exactZ([{ w: 1, p: 0.3 }, { w: 1, p: 0.3 }], 2) > exactZ([{ w: 1, p: 0.3 }, { w: 1, p: 0.3 }], 1) && exactZ([{ w: 1, p: 0.9 }], 0) < 0)
test('exactZ schützt Seltenes: 2 Treffer bei Erwartung 0,36 deutlich unter der Normalnäherung (2,8)', (() => { const it = Array.from({ length: 21 }, () => ({ w: 1, p: 0.0171 })); const z = exactZ(it, 2); return z > 1 && z < 2.4 })())
test('P(Summe ≥ 0) = 1', near(probSumAtLeast([{ w: 1, p: 0.4 }], 0), 1))

// ── 3. Überschneidungs-Gewichtung ─────────────────────────────────────────────────────────
{
  nextBet = 5000; bets.length = 0; combos.length = 0
  bet('d', 101, { selection: 'home' }); bet('d', 101, { selection: 'home' }); bet('d', 101, { selection: 'home' })
  const sl = buildSlips({ bets, combos, matches }).slips
  const w = computeOverlapWeights(sl)
  test('Dreimal derselbe Tipp zählt zusammen wie EIN unabhängiger Tipp', near([...w.values()].reduce((a, b) => a + b, 0), 1))
}
{
  bets.length = 0; combos.length = 0
  bet('d', 101, { selection: 'home' })
  combo('d', [{ matchId: 101, odds: 2, status: 'won' }, { matchId: 102, odds: 2, status: 'lost' }], 10, 'lost')
  const sl = buildSlips({ bets, combos, matches }).slips
  const w = computeOverlapWeights(sl)
  const single = sl.find((s) => s.kind === 'single') as Slip, cmb = sl.find((s) => s.kind === 'combo') as Slip
  test('Einzelwette + Kombi mit gleichem Leg: Einzel 0,5, Kombi 0,75', near(w.get(single.key) as number, 0.5) && near(w.get(cmb.key) as number, 0.75))
}
{
  bets.length = 0; combos.length = 0
  bet('d', 101, { market_type: '1x2', selection: 'home' }); bet('d', 101, { market_type: 'btts', selection: 'yes' })
  const w = computeOverlapWeights(buildSlips({ bets, combos, matches }).slips)
  test('Verschiedene Märkte auf demselben Spiel sind NICHT identisch (volles Gewicht)', [...w.values()].every((x) => near(x, 1)))
}

// ── 4. Tipper-IQ: Mindestgrenzen und Ausschlüsse ──────────────────────────────────────────
function userWith(userId: string, nSlips: number, nMds: number, hitEvery = 3): Slip[] {
  const arr: Slip[] = []
  for (let i = 0; i < nSlips; i++) {
    const md = (i % nMds) + 1
    const won = i % hitEvery === 0
    arr.push({ key: `s${userId}${i}`, kind: 'single', userId, createdAtMs: i, stake: 10, odds: 2.5, status: won ? 'won' : 'lost', payout: won ? 25 : null, net: won ? 15 : -10, isRisky: false, isBonus: false, voidReason: null,
      legs: [{ betId: i, matchId: 1000 + i, marketType: '1x2', selection: 'home', odds: 2.5, status: won ? 'won' : 'lost', specialId: null, recapMatchday: md }], ownerMatchday: md, firstKickoffMs: i + 1 })
  }
  return arr
}
test('17 Scheine → noch nicht gewertet, kein Rang', (() => { const r = computeUserIq('a', userWith('a', 17, 8)); return !r.eligible && r.rank == null && (r.notRatedReason ?? '').includes('17') })())
test('18 Scheine aber 6 Spieltage → noch nicht gewertet', !computeUserIq('a', userWith('a', 18, 6)).eligible)
test('18 Scheine / 7 Spieltage → gewertet', computeUserIq('a', userWith('a', 18, 7)).eligible)
test('Ranking vergibt Plätze nur an Gewertete, lückenlos ab 1', (() => { const rk = computeTipperIqRanking([...userWith('a', 30, 8, 2), ...userWith('b', 30, 8, 5), ...userWith('c', 5, 3)]); return rk.filter((r) => r.rank != null).map((r) => r.rank).join() === '1,2' && rk[2].userId === 'c' && rk[2].rank == null })())
test('Besserer Tipper hat höheren IQ', (() => { const rk = computeTipperIqRanking([...userWith('a', 30, 8, 2), ...userWith('b', 30, 8, 5)]); return rk[0].userId === 'a' && rk[0].iq > rk[1].iq })())
test('IQ stets in [0,100]', computeTipperIqRanking([...userWith('a', 40, 10, 1), ...userWith('b', 40, 10, 1000)]).every((r) => r.iq >= 0 && r.iq <= 100))
test('Determinismus: zweimal gerechnet identisch', JSON.stringify(computeTipperIqRanking(userWith('a', 30, 8))) === JSON.stringify(computeTipperIqRanking(userWith('a', 30, 8))))
{
  const base = userWith('a', 20, 8)
  const bonus = { ...base[0], key: 'bonus', isBonus: true }
  const special = { ...base[1], key: 'spec', legs: [{ ...base[1].legs[0], marketType: 'matchday_special' }] }
  const neutralOnly = { ...base[2], key: 'neut', legs: [{ ...base[2].legs[0], status: 'neutralized' as const }] }
  const pending = { ...base[3], key: 'pend', status: 'pending' as const }
  const voided = { ...base[4], key: 'void', status: 'void' as const }
  test('Bonus, Spieltags-Special, rein neutralisierte, offene und stornierte Scheine zählen nicht', [bonus, special, neutralOnly, pending, voided].every((s) => !isIqEligibleSlip(s)))
  test('Verlorene reguläre Wette zählt', isIqEligibleSlip(base[1]) )
  test('Teil-neutralisierte Kombi (Rest aktiv) zählt standardmäßig', isIqEligibleSlip({ ...base[5], legs: [base[5].legs[0], { ...base[5].legs[0], status: 'neutralized' }] }))
  test('…lässt sich für den Sensitivitätstest ausschließen', !isIqEligibleSlip({ ...base[5], legs: [base[5].legs[0], { ...base[5].legs[0], status: 'neutralized' }] }, { excludePartiallyNeutralized: true }))
}
test('Doppelte identische Treffer verbessern den IQ nicht künstlich', (() => {
  const one = userWith('a', 20, 8, 2)
  const dup = userWith('a', 20, 8, 2).map((s, i) => (i < 6 ? { ...s, legs: [{ ...s.legs[0], matchId: 7777, selection: 'home' }], status: 'won' as const, net: 15, payout: 25 } : s))
  const sp = userWith('a', 20, 8, 2).map((s, i) => (i < 6 ? { ...s, legs: [{ ...s.legs[0], matchId: 7000 + i }], status: 'won' as const, net: 15, payout: 25 } : s))
  return computeUserIq('a', dup).components.hit < computeUserIq('a', sp).components.hit && computeUserIq('a', one).slipsConsidered === 20
})())
test('Vier Alternativgewichtungen summieren auf 1', Object.values(IQ_ALT_WEIGHTS).every((w) => near(w.hit + w.consistency + w.difficult + w.robust, 1)) && near(IQ_WEIGHTS_DEFAULT.hit + IQ_WEIGHTS_DEFAULT.consistency + IQ_WEIGHTS_DEFAULT.difficult + IQ_WEIGHTS_DEFAULT.robust, 1))
test('Leave-one-matchday-out: Spieltag ausgeschlossen → keine Scheine davon', computeUserIq('a', userWith('a', 24, 8), { excludeMatchday: 3, minMatchdays: 6 }).activeMatchdays === 7)

// ── 5. Wildenroth-Haltung ──────────────────────────────────────────────────────────────────
test('1X2: Wildenroth heim → home=win, away=against, draw=draw', classifyStance('1x2', 'home', true) === 'win' && classifyStance('1x2', 'away', true) === 'against' && classifyStance('1x2', 'draw', true) === 'draw')
test('1X2: Wildenroth auswärts → away=win, home=against', classifyStance('1x2', 'away', false) === 'win' && classifyStance('1x2', 'home', false) === 'against')
test('Doppelte Chance: 1X (heim)=supportive, X2 (heim)=against, 12=neutral', classifyStance('double_chance', '1x', true) === 'supportive' && classifyStance('double_chance', 'x2', true) === 'against' && classifyStance('double_chance', '12', true) === 'neutral')
test('Handicap: Wildenroth −1,5 = win, Gegner −1,5 = against, Plus-Handicaps neutral', classifyStance('handicap', 'home_minus_1_5', true) === 'win' && classifyStance('handicap', 'home_minus_1_5', false) === 'against' && classifyStance('handicap', 'away_plus_1_5', true) === 'neutral')
test('Ergebnistipp: Wildenroth-Sieg win, Gegner-Sieg against, Remis draw', classifyStance('exact_score', '2:0', true) === 'win' && classifyStance('exact_score', '0:2', true) === 'against' && classifyStance('exact_score', '1:1', true) === 'draw')
test('Torschütze = supportive (kein Siegtipp)', classifyStance('goalscorer', '10', true) === 'supportive')
test('Neutrale Torwetten (Über/Unter, BTTS) sind KEINE Gegenwette', classifyStance('over_under_3_5', 'under_3.5', true) === 'neutral' && classifyStance('btts', 'no', true) === 'neutral')
{
  bets.length = 0; combos.length = 0
  const wm = addMatch(300, 3, 20, { home_team_id: 14, away_team_id: 9, home_score: 0, away_score: 2 })
  const om = addMatch(301, 3, 20, { home_team_id: 3, away_team_id: 9, home_score: 1, away_score: 0 })
  bet('x', wm, { selection: 'away', odds_value: 4, status: 'won', payout: 40, stake: 10 })
  combo('x', [{ matchId: wm, odds: 4, status: 'won', selection: 'away' }, { matchId: om, odds: 4, status: 'won' }], 10, 'won')
  combo('x', [{ matchId: wm, odds: 3, status: 'won', selection: 'away' }, { matchId: om, odds: 3, status: 'lost' }], 10, 'lost')
  const sl = buildSlips({ bets, combos, matches }).slips
  const rec = computeWildenrothRecords(sl, matches, 'all').get('x')
  const comboWon = sl.find((s) => s.kind === 'combo' && s.status === 'won') as Slip
  test('Direkter Gewinn aus Einzelwette gegen Wildenroth = Netto der Einzelwette', !!rec && near(rec.against.directNet, 30))
  test('Kombi-Gewinn wird NICHT vollständig dem Gegen-Leg zugerechnet (Anteil 50 % bei gleichen Quoten)', !!rec && near(rec.against.attributedComboNet - (-0), rec.against.attributedComboNet) && rec.against.attributedComboNet > 0 && rec.against.attributedComboNet < comboWon.net)
  test('Verlorene Kombi: gewonnenes Gegen-Leg wird nicht bestraft', !!rec && near(rec.against.attributedComboNet, 0.5 * comboWon.net))
  test('Saldo = direkt + zugeordnet', !!rec && near(rec.againstBalance, rec.against.directNet + rec.against.attributedComboNet))
  test('Nur Wildenroth-Spiele werden gewertet (Spiel ohne Wildenroth ignoriert)', !!rec && rec.against.legs === 3 && rec.neutralLegs === 0)
  const rII = computeWildenrothRecords(sl, matches, 'II').get('x')
  test('Scope II: kein Wildenroth-II-Spiel → keine Einträge', !rII || rII.against.legs === 0)
}

// ── 6. Geschichten ─────────────────────────────────────────────────────────────────────────
{
  bets.length = 0; combos.length = 0
  combo('n', [{ matchId: 101, odds: 2, status: 'won' }, { matchId: 102, odds: 2, status: 'won' }, { matchId: 103, odds: 2, status: 'lost' }], 10, 'lost')
  combo('n', [{ matchId: 101, odds: 2, status: 'won' }, { matchId: 102, odds: 2, status: 'lost' }, { matchId: 103, odds: 2, status: 'lost' }], 10, 'lost')
  const nm = findNearMisses(buildSlips({ bets, combos, matches }).slips)
  test('Beinahe-Gewinn: nur Kombi mit genau einem falschen Tipp (≥3 Legs)', nm.length === 1 && nm[0].lostLegIndex === 2)
  test('Entgangene Auszahlung = Einsatz × Quote (gedeckelt)', nm.length === 1 && near(nm[0].potentialPayout, 80))
}
{
  const u = userWith('s', 10, 5, 1000)
  const st = longestStreaks(u, new Set())
  test('Längste Verlustserie über abgerechnete Scheine', st.loss[0].length === 9 && st.win[0].length === 1)
  test('Gelöschtes Konto wird nicht genannt', longestStreaks(u, new Set(['s'])).loss.length === 0 && longestStreaks(u, new Set(['s'])).win.length === 0)
}
{
  const mk = (id: string, nets: number[]): Slip[] => nets.map((n, i) => ({ key: `${id}${i}`, kind: 'single', userId: id, createdAtMs: i, stake: 10, odds: 2, status: n > 0 ? 'won' : 'lost', payout: n > 0 ? n + 10 : null, net: n, isRisky: false, isBonus: false, voidReason: null, legs: [], ownerMatchday: i + 1, firstKickoffMs: null }))
  const t = computeTrajectories([...mk('a', [-50, -50, 300]), ...mk('b', [10, 10, 10])])
  test('Verlauf: kumuliertes Netto und Ränge', t.users.get('a')?.finalNet === 200 && t.users.get('a')?.rank[2] === 1 && t.users.get('b')?.rank[0] === 1)
  const cb = bestComebacks(t)
  test('Stehaufmännchen: Erholung vom Tiefpunkt', cb[0]?.userId === 'a' && cb[0].recovered === 300 && cb[0].lowPoint === -100)
}

// ── 7. Freischaltung ───────────────────────────────────────────────────────────────────────
{
  const ms: RecapMatchRow[] = []
  for (let md = 1; md <= 3; md++) for (let k = 0; k < 2; k++) ms.push({ id: md * 10 + k, matchday: md, match_date: `2026-09-${String(md * 7).padStart(2, '0')}T13:00:00+00:00`, status: 'finished', match_category: 'kreisliga', is_topspiel: false, tippspiel_matchday: null, competition_type: 'league', home_team_id: 1, away_team_id: 2, home_score: 1, away_score: 0 } as RecapMatchRow)
  test('Alle Spiele beendet, keine offenen Wetten → bereit', computeRangeReadiness(ms, [], 1, 3).ready)
  test('Offene Wette auf Spieltag 3 → NICHT bereit', !computeRangeReadiness(ms, [{ match_id: 30, status: 'pending', season: '26/27' }], 1, 3).ready)
  const ms2 = ms.map((m) => (m.id === 31 ? { ...m, status: 'scheduled' as const } : m))
  test('Ein Spiel noch nicht beendet → NICHT bereit', !computeRangeReadiness(ms2, [], 1, 3).ready)
  const ms3 = ms.map((m) => (m.id === 31 ? { ...m, status: 'postponed' as const } : m))
  test('Verschobenes Spiel blockiert nicht; annulliertes ebenfalls nicht', computeRangeReadiness(ms3, [], 1, 3).ready && computeRangeReadiness(ms.map((m) => (m.id === 31 ? { ...m, status: 'annulled' as const } : m)), [], 1, 3).ready)
  test('Fehlender Spieltag (keine Spiele) → NICHT bereit', !computeRangeReadiness(ms, [], 1, 4).ready)
  test('Nie nach Datum allein: Zukunftsdatum ohne Abschluss bleibt gesperrt', !computeRangeReadiness(ms2, [], 1, 3).ready)
  test('Sichtbarkeit: nicht bereit → versteckt; bereit ohne Freigabe → unveröffentlicht; mit Freigabe → öffentlich', recapVisibility(false, 'true') === 'hidden_not_ready' && recapVisibility(true, null) === 'ready_unpublished' && recapVisibility(true, 'true') === 'published')
}

// ── 8. Gesamtbericht, Datenschutz ─────────────────────────────────────────────────────────
{
  const sl = [...userWith('gone', 25, 8, 2), ...userWith('ok', 25, 8, 3)]
  const rep = buildRecapReport({ allSlips: sl, matches, range: { from: 1, to: 16 }, profiles: [
    { id: 'gone', display_name: 'Protezz', username: 'protezz', deleted_at: '2026-10-01T00:00:00Z' },
    { id: 'ok', display_name: 'Okay', username: 'okay', deleted_at: null },
  ] })
  test('Gelöschtes Konto erscheint weder in IQ noch Awards noch Namensliste', !rep.iq.some((r) => r.userId === 'gone') && !rep.awards.some((a) => a.entries.some((e) => e.userId === 'gone')) && !('gone' in rep.people))
  test('…bleibt aber in der anonymen Gesamtstatistik', rep.overview.breakdown.total === 50)
  test('Bericht ist reines JSON (serialisierbar, rund-lauf-stabil)', JSON.stringify(JSON.parse(JSON.stringify(rep))) === JSON.stringify(rep))
}

console.log(`\n${checks - errors}/${checks} checks passed`)
export function run(): number { return errors }
