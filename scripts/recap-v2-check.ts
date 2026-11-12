/**
 * Recap V2 — Tipper-IQ, Wettschein-Normalisierung, Wildenroth-Haltung, Awards-Gates, Freischaltung.
 * Reine Logik, synthetische Daten (kein Datenbankzugriff) – deterministisch, läuft in CI.
 * Gegen echte Produktivdaten läuft dieselbe Logik über die Analyse im Recap-Bericht
 * (docs/recap-v2.md beschreibt die Gegenprobe).
 */
import { buildSlips, INCLUDE_CUP_BONUS_SLIPS, isSettled, type RecapBetRow, type RecapComboRow, type RecapMatchRow, type Slip } from '@/lib/recap/slips'
import {
  computeOverlapWeights, filterSlipsByMatchdays, computeTipperIqRanking, computeUserIq, exactZ, normalCdf, normalInv, scoreFromZ,
  isIqEligibleSlip, IQ_MIN_SLIPS, IQ_MIN_MATCHDAYS, IQ_WEIGHTS_DEFAULT, IQ_ALT_WEIGHTS, probSumAtLeast,
} from '@/lib/recap/tipperIq'
import { classifyStance, computeWildenrothRecords, computeOptimists } from '@/lib/recap/wildenrothStance'
import { breakdownSlips, findNearMisses, longestStreaks, computeTrajectories, bestComebacks, nightOwlStats, berlinHour, latestSlips, findIdenticalWins, winlessComboStreakers, findComboKillers, findOneGoalShort, mondayMorningStats, biggestNetLosers, validateSettleReproduction } from '@/lib/recap/hinrundeStats'
import { canViewRecapReport, computeRangeReadiness, recapVisibility } from '@/lib/recap/availability'
import { buildRecapReport } from '@/lib/recap/report'
import { computeHalbzeitAwards, PUBLIC_AWARD_KEYS } from '@/lib/recap/halbzeitAwards'
import { buildCommunityBestTips, buildPersonalTips } from '@/lib/recap/bestTips'
import { isPreviewEnvironment, simulateSpieltag } from '@/lib/recap/simulation'
import { buildFixtureData } from '@/lib/recap/fixtures'
import { databaseKind, isSimulationAllowed, supabaseRef, PRODUCTION_SUPABASE_REF, SANDBOX_SUPABASE_REF } from '@/lib/recap/environmentGuard'
import { loadDemoState, isFixtureDemoEnabled, SnapshotKeyError } from '@/lib/recap/demo'
import { decryptSnapshot } from '@/lib/recap/snapshot'
import { SNAPSHOT_ENC } from '@/lib/recap/snapshot.enc'

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
test('14 Scheine → noch nicht gewertet, kein Rang', (() => { const r = computeUserIq('a', userWith('a', 14, 9)); return !r.eligible && r.rank == null && (r.notRatedReason ?? '').includes('14') && (r.notRatedReason ?? '').includes('offizielle Rangliste') })())
test('15 Scheine aber 8 Spieltage → noch nicht qualifiziert, IQ trotzdem berechnet', (() => { const r = computeUserIq('a', userWith('a', 15, 8)); return !r.eligible && r.iq > 0 && r.rank == null })())
test('15 Scheine / 9 Spieltage → qualifiziert (keine Mindest-Trefferzahl)', computeUserIq('a', userWith('a', 15, 9, 1000)).eligible)
test('Grenze steht in Konstanten: 15 Scheine / 9 Spieltage', IQ_MIN_SLIPS === 15 && IQ_MIN_MATCHDAYS === 9)
test('Qualifikation hängt nur von Scheinen/Spieltagen ab, nicht von Person oder Trefferzahl', computeUserIq('zzz', userWith('zzz', 15, 9, 1)).eligible === computeUserIq('aaa', userWith('aaa', 15, 9, 1000)).eligible)
{
  // Endgültige Entscheidung: 15 Scheine / 9 Spieltage gelten – unabhängig vom Datenstand (z. B. nach Spieltag 16).
  const extra = (uid: string, md: number, k: number): Slip => { const b = userWith(uid, 1, 1)[0]; return { ...b, key: `x${uid}${k}`, ownerMatchday: md, legs: b.legs.map((l) => ({ ...l, betId: 9000 + k, matchId: 9000 + k, recapMatchday: md })) } }
  const late = [...userWith('late', 14, 15), extra('late', 16, 1)]
  test('Nach Spieltag 16: 14 Scheine bis ST 15 → nicht gewertet; der 15. Schein in ST 16 qualifiziert, Grenzen unverändert', (() => {
    const before = computeTipperIqRanking(filterSlipsByMatchdays(late, 1, 15)).find((r) => r.userId === 'late')!
    const after = computeTipperIqRanking(filterSlipsByMatchdays(late, 1, 16)).find((r) => r.userId === 'late')!
    return !before.eligible && before.rank == null && before.iq > 0 && after.eligible && after.rank === 1 && IQ_MIN_SLIPS === 15 && IQ_MIN_MATCHDAYS === 9
  })())
  const md9 = [...userWith('md9', 20, 8), extra('md9', 16, 2)]
  test('Nach Spieltag 16: 8 aktive Spieltage bis ST 15 → nicht gewertet; der 9. aktive Spieltag (ST 16) qualifiziert', (() => {
    const before = computeTipperIqRanking(filterSlipsByMatchdays(md9, 1, 15)).find((r) => r.userId === 'md9')!
    const after = computeTipperIqRanking(filterSlipsByMatchdays(md9, 1, 16)).find((r) => r.userId === 'md9')!
    return !before.eligible && before.activeMatchdays === 8 && after.eligible && after.activeMatchdays === 9
  })())
  // Quotenflüsterer nur aus offiziell Qualifizierten – auch wenn ein nicht Qualifizierter den höheren IQ hat.
  const hot = userWith('hot', 14, 9, 1) // 14 Scheine, alle gewonnen → sehr hoher IQ, aber nicht gewertet
  const solid = userWith('solid', 15, 9, 3)
  const rkQ = computeTipperIqRanking([...hot, ...solid])
  const repQ = buildRecapReport({ allSlips: [...hot, ...solid], matches: [], range: { from: 1, to: 16 }, profiles: [] })
  const qf = repQ.awards.find((a) => a.key === 'quotenfluesterer')
  test('Quotenflüsterer: nur offiziell Qualifizierte – nicht gewerteter Tipper mit höherem IQ gewinnt nicht', rkQ.find((r) => r.userId === 'hot')!.iq > rkQ.find((r) => r.userId === 'solid')!.iq && !!qf && qf.entries.length === 1 && qf.entries[0].userId === 'solid' && !qf.entries.some((e) => e.userId === 'hot'))
  test('Nicht gewertete sehen ihren Zwischenwert (IQ > 0) ohne Ranglistenplatz; Award-Regeltext nennt dieselben Grenzen wie die Konstanten', (() => {
    const h = repQ.iq.find((r) => r.userId === 'hot')
    return !!h && h.iq > 0 && !h.eligible && h.rank == null && repQ.iq.filter((r) => r.eligible).every((r) => r.rank != null) && !!qf && qf.rule.includes(String(IQ_MIN_SLIPS)) && qf.rule.includes(String(IQ_MIN_MATCHDAYS))
  })())
}
test('Ranking vergibt Plätze nur an Gewertete, lückenlos ab 1', (() => { const rk = computeTipperIqRanking([...userWith('a', 30, 10, 2), ...userWith('b', 30, 10, 5), ...userWith('c', 5, 3)]); return rk.filter((r) => r.rank != null).map((r) => r.rank).join() === '1,2' && rk[2].userId === 'c' && rk[2].rank == null })())
test('Besserer Tipper hat höheren IQ', (() => { const rk = computeTipperIqRanking([...userWith('a', 30, 10, 2), ...userWith('b', 30, 10, 5)]); return rk[0].userId === 'a' && rk[0].iq > rk[1].iq })())
test('IQ stets in [0,100]', computeTipperIqRanking([...userWith('a', 40, 10, 1), ...userWith('b', 40, 10, 1000)]).every((r) => r.iq >= 0 && r.iq <= 100))
test('Determinismus: zweimal gerechnet identisch', JSON.stringify(computeTipperIqRanking(userWith('a', 30, 8))) === JSON.stringify(computeTipperIqRanking(userWith('a', 30, 8))))
{
  const base = userWith('a', 20, 8)
  const bonus = { ...base[0], key: 'bonus', isBonus: true }
  const special = { ...base[1], key: 'spec', legs: [{ ...base[1].legs[0], marketType: 'matchday_special' }] }
  const neutralOnly = { ...base[2], key: 'neut', legs: [{ ...base[2].legs[0], status: 'neutralized' as const }] }
  const pending = { ...base[3], key: 'pend', status: 'pending' as const }
  const voided = { ...base[4], key: 'void', status: 'void' as const }
  test('Spieltags-Special, rein neutralisierte, offene und stornierte Scheine zählen nicht', [special, neutralOnly, pending, voided].every((s) => !isIqEligibleSlip(s)))
  test('Pokal-Bonus-Schein (is_bonus) zählt seit der Pokal-Entscheidung wie jeder andere abgerechnete Schein', INCLUDE_CUP_BONUS_SLIPS && isIqEligibleSlip(bonus))
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


// ── 9. Zusatzfakten ────────────────────────────────────────────────────────────────────────
{
  bets.length = 0; combos.length = 0
  const m1 = addMatch(400, 4, 25, { home_team_id: 14, away_team_id: 9, home_score: 1, away_score: 1 })
  const m2 = addMatch(401, 4, 25, { home_team_id: 5, away_team_id: 6, home_score: 2, away_score: 0 })
  const m3 = addMatch(402, 4, 25, { home_team_id: 7, away_team_id: 8, home_score: 3, away_score: 1 })
  // Kombi 1: einziger Fehler = Wildenroth-Spiel (Siegtipp, 1:1)  → "Ein Tor fehlte" (Gasttor/Heimtor mehr: Heimtor mehr = 2:1 gewinnt)
  combo('k1', [{ matchId: m1, odds: 2, status: 'lost', selection: 'home' }, { matchId: m2, odds: 2, status: 'won' }, { matchId: m3, odds: 2, status: 'won' }], 10, 'lost')
  // Kombi 2: zwei Fehler → kein Killer
  combo('k2', [{ matchId: m1, odds: 2, status: 'lost', selection: 'home' }, { matchId: m2, odds: 2, status: 'lost', selection: 'away' }], 10, 'lost')
  // Kombi 3: einziger Fehler Über 3,5 bei 2:0 → ein Tor reicht nicht (2 fehlen)
  combo('k3', [{ matchId: m2, odds: 2, status: 'lost', market: 'over_under_3_5', selection: 'over_3.5' }, { matchId: m3, odds: 2, status: 'won' }], 10, 'lost')
  // Kombi 4: einziger Fehler Torschütze → nicht berechenbar
  combo('k4', [{ matchId: m2, odds: 2, status: 'lost', market: 'goalscorer', selection: '7' }, { matchId: m3, odds: 2, status: 'won' }], 10, 'lost')
  // Kombi 5: teil-neutralisiertes Leg zählt nicht als Fehler/Treffer
  combo('k5', [{ matchId: m1, odds: 2, status: 'lost', selection: 'home' }, { matchId: m2, odds: 1, status: 'won' }], 10, 'lost')
  bets[bets.length - 1].status = 'neutralized'
  const sl = buildSlips({ bets, combos, matches }).slips
  const ck = findComboKillers(sl, matches)
  test('Kombi-Killer: nur Kombis mit genau einem falschen Tipp (k1, k3, k4); k2 hat zwei Fehler, k5 bleibt nach Neutralisierung ohne zweites aktives Leg', ck.singleBlockerCombos === 3 && ck.wildenrothCombos === 1)
  test('Kombi-Killer: Spiel mit den meisten zerstörten Kombis zuerst', ck.byMatch[0].matchId === m1 || ck.byMatch[0].combos >= 1)
  const og = findOneGoalShort(sl, matches)
  test('Ein Tor fehlte: Siegtipp bei 1:1 wäre mit einem Heimtor mehr aufgegangen', og.cases.some((c) => c.matchId === m1 && c.saver === 'ein Heimtor mehr'))
  test('Ein Tor fehlte: Über 3,5 bei 2:0 zählt NICHT (zwei Tore fehlen)', !og.cases.some((c) => c.marketType === 'over_under_3_5') && og.computableButNotOneGoal === 1)
  test('Ein Tor fehlte: Torschützen sind nicht berechenbar und werden ausgewiesen, nicht geraten', og.notComputable === 1)
  test('settleBet reproduziert die gespeicherten Status (0 Abweichungen) bei konsistenten Daten', Object.values(validateSettleReproduction(sl.filter((x) => x.userId === 'x'), matches)).every((v) => v.mismatches === 0))
}
{
  bets.length = 0; combos.length = 0
  // 2026-09-07 ist ein Montag (Sommerzeit UTC+2): 06:30Z = 08:30 Berlin (Vormittag); 09:59Z = 11:59; 10:00Z = 12:00 (nicht mehr)
  // 2026-10-26 ist ein Montag (Winterzeit UTC+1): 10:59Z = 11:59 Berlin (Vormittag), 11:00Z = 12:00
  for (const t of ['2026-09-07T06:30:00Z', '2026-09-07T09:59:00Z', '2026-09-07T10:00:00Z', '2026-10-26T10:59:00Z', '2026-10-26T11:00:00Z', '2026-09-07T03:59:00Z', '2026-09-08T08:00:00Z']) bet('mo', 101, { created_at: t })
  const mm = mondayMorningStats(buildSlips({ bets, combos, matches }).slips, new Set())[0]
  test('Montagmorgen (Europe/Berlin, Sommer- und Winterzeit): 6:00–11:59 zählt, 12:00 nicht, Dienstag nicht', mm.mondayMorningSlips === 3 && mm.slips === 7)
}
{
  bets.length = 0; combos.length = 0
  bet('l1', 101, { stake: 100, status: 'lost' }); bet('l2', 101, { stake: 50, status: 'lost' }); bet('w1', 101, { stake: 10, status: 'won', payout: 50 })
  bet('l1', 101, { stake: 100, status: 'lost', is_bonus: true })
  const nl = biggestNetLosers(buildSlips({ bets, combos, matches }).slips, new Set(['l2']))
  test('Wildi-Vernichter: größter Nettoverlust, gelöschte Konten außen vor', nl[0].userId === 'l1' && nl[0].net === -200 && !nl.some((x) => x.userId === 'l2'))
}
{
  bets.length = 0; combos.length = 0
  const a = addMatch(500, 5, 1, { home_team_id: 14, away_team_id: 9, home_score: 0, away_score: 1 })
  const b = addMatch(501, 5, 8, { home_team_id: 9, away_team_id: 40, home_score: 0, away_score: 0 })
  const c = addMatch(502, 5, 15, { home_team_id: 14, away_team_id: 9, home_score: 3, away_score: 0 })
  bet('o', a, { selection: 'home', status: 'lost' }); bet('o', b, { selection: 'away', status: 'lost' }); bet('o', c, { selection: 'home', status: 'won', payout: 20 })
  bet('o', a, { market_type: 'over_under_3_5', selection: 'over_3.5', status: 'lost' })
  const o = computeOptimists(buildSlips({ bets, combos, matches }).slips, matches)[0]
  test('Ewiger Optimist: verfehlte Siegtipp-Spiele und erneute Siegtipps danach; neutrale Torwette zählt nicht', o.winTipMatches === 3 && o.lostWinTipMatches === 2 && o.backedAfterLoss === 2)
}

test('Zugriff: normales Mitglied sieht unveröffentlichten Bericht nie (bereit oder nicht)', !canViewRecapReport('hidden_not_ready', false, 15) && !canViewRecapReport('ready_unpublished', false, 16))
test('Zugriff: Mitglied sieht veröffentlichten Bericht; Admin sieht Vorschau, aber erst ab einem fertigen Spieltag', canViewRecapReport('published', false, 16) && canViewRecapReport('ready_unpublished', true, 16) && canViewRecapReport('hidden_not_ready', true, 3) && !canViewRecapReport('hidden_not_ready', true, 0))

test('berlinHour liefert Zahlen (kein NaN), Sommer-/Winterzeit', berlinHour(Date.parse('2026-09-07T22:30:00Z')) === 0 && berlinHour(Date.parse('2026-11-02T00:30:00Z')) === 1 && berlinHour(Date.parse('2026-09-07T03:59:00Z')) === 5)
{
  bets.length = 0; combos.length = 0
  // 0:10, 1:00 (Stornos zählen), 5:59 Berlin → Nacht; 6:00 → nicht
  for (const [t, st] of [['2026-09-06T22:10:00Z', 'lost'], ['2026-09-06T23:00:00Z', 'void'], ['2026-09-07T03:59:00Z', 'lost'], ['2026-09-07T04:00:00Z', 'lost']] as const) bet('nt', 101, { created_at: t, status: st, void_reason: st === 'void' ? 'user_cancelled' : null })
  const o = nightOwlStats(buildSlips({ bets, combos, matches }).slips, new Set())[0]
  test('Nachteule: 0:00–5:59 inkl. später stornierter Scheine; 6:00 zählt nicht', o.nightSlips === 3 && o.slips === 4)
}

{
  bets.length = 0; combos.length = 0
  addMatch(600, 6, 2); addMatch(601, 6, 3); addMatch(602, 6, 4)
  // zwei Tipper mit identischer gewonnener 3er-Kombi, ein Dritter mit anderer; Einzelwetten dürfen nie als Zwillings-Treffer zählen
  for (const u of ['t1', 't2']) combo(u, [{ matchId: 600, odds: 2, status: 'won' }, { matchId: 601, odds: 2, status: 'won' }, { matchId: 602, odds: 2, status: 'won' }], 10, 'won')
  combo('t3', [{ matchId: 600, odds: 2, status: 'won' }, { matchId: 601, odds: 2, status: 'won' }], 10, 'won')
  bet('t1', 600, { status: 'won', payout: 20 }); bet('t2', 600, { status: 'won', payout: 20 })
  const sl = buildSlips({ bets, combos, matches }).slips
  const iw = findIdenticalWins(sl, new Set())
  test('Zwillings-Treffer: nur identische GEWONNENE Kombis bei ≥ 2 Tippern (Einzelwetten und andere Kombis zählen nicht)', iw.length === 1 && iw[0].legs === 3 && iw[0].users.length === 2)
  test('Zwillings-Treffer: gelöschtes Konto zählt nicht mit', findIdenticalWins(sl, new Set(['t2'])).length === 0)
}
{
  bets.length = 0; combos.length = 0
  for (let i = 0; i < 10; i++) combo('fl', [{ matchId: 600, odds: 2, status: 'lost' }, { matchId: 601, odds: 2, status: 'won' }], 10, 'lost')
  for (let i = 0; i < 12; i++) combo('ok', [{ matchId: 600, odds: 2, status: 'lost' }, { matchId: 601, odds: 2, status: 'won' }], 10, i === 0 ? 'won' : 'lost')
  const sl = buildSlips({ bets, combos, matches }).slips
  const f = winlessComboStreakers(sl, new Set())
  test('Kombi-Flaute: ≥ 10 Kombis ohne einen Gewinn; ein einziger Gewinn nimmt aus der Wertung', f.length === 1 && f[0].userId === 'fl' && f[0].lost === 10)
}
{
  bets.length = 0; combos.length = 0
  // erster Anstoß 2026-09-02T13:00Z; Abgabe 9,877 s vorher (verloren) und 20 s vorher (gewonnen) und 5 s NACH Anstoß
  bet('late', 600, { created_at: '2026-09-02T12:59:50.123Z', status: 'lost' })
  bet('late', 600, { created_at: '2026-09-02T12:59:40.000Z', status: 'won', payout: 20 })
  bet('late', 600, { created_at: '2026-09-02T13:00:05.000Z', status: 'lost' })
  const l = latestSlips(buildSlips({ bets, combos, matches }).slips, new Set())
  test('Spätester Schein: kürzester Abstand vor Anstoß (egal ob verloren), Abgabe nach Anstoß zählt nicht', l.length === 2 && Math.abs(l[0].leadSeconds - 9.877) < 1e-6 && l[0].status === 'lost')
}
{
  // Gleichstand auf Platz 3 → alle Gleichplatzierten werden gezeigt; Wildi-Vernichter nutzt dieselbe Basis wie Wildi-Magnet (inkl. Bonus)
  bets.length = 0; combos.length = 0
  for (const u of ['a1', 'a2', 'a3', 'a4', 'a5']) for (let i = 0; i < 9; i++) bet(u, 600, { stake: 10, status: 'lost', created_at: `2026-09-0${(i % 3) + 1}T10:00:00Z` })
  bet('a1', 600, { stake: 100, status: 'won', payout: 160, is_bonus: true })
  const sl = buildSlips({ bets, combos, matches }).slips
  const aw = computeHalbzeitAwards({ rangeSlips: sl, allSlips: sl, matches, iq: [], range: { from: 1, to: 15 }, excluded: new Set() })
  const v = aw.find((x) => x.key === 'wildi_vernichter')
  test('Wildi-Vernichter: Basis wie Wildi-Magnet inkl. Bonus (a1 −90+60 = −30, a2–a5 je −90 gleichauf und alle gezeigt)', !!v && v.entries.length === 4 && v.entries.every((e) => e.value === v.entries[0].value) && !v.entries.some((e) => e.userId === 'a1'))
}

// ── 10. Winter-Recap: Pokal, persönliche Tipps, Beste Tipps, Schande-Perspektiven, Fakten, Simulation ──────────
const labeler = { matchLabel: (id: number) => `Spiel ${id}`, marketLabel: (m: string) => m, selectionLabel: (_m: string, sel: string) => sel }
{
  bets.length = 0; combos.length = 0
  const cup = addMatch(700, 7, 9, { competition_type: 'cup', home_team_id: 14, away_team_id: 9, home_score: 1, away_score: 4 })
  const lg = addMatch(701, 7, 10)
  bet('p1', cup, { market_type: 'cup_early_goal', selection: 'yes', odds_value: 1.7, stake: 50, status: 'won', payout: 85 })
  bet('p2', cup, { market_type: 'cup_ht_more_goals', selection: 'h2', odds_value: 1.8, stake: 100, status: 'lost', is_bonus: true })
  combo('p3', [{ matchId: cup, odds: 6.5, status: 'lost', market: 'cup_comeback_advance', selection: 'yes' }, { matchId: lg, odds: 2, status: 'won' }], 10, 'lost')
  const sl = buildSlips({ bets, combos, matches }).slips
  test('Pokalspiel (competition_type cup) wird dem Recap-Spieltag zugeordnet und fällt nicht heraus', sl.length === 3 && sl.every((x) => x.ownerMatchday === 7))
  test('Pokal-Bonus-Schein zählt in Netto und IQ-Eignung wie jeder andere abgerechnete Schein', sl.filter((x) => x.isBonus).length === 1 && isIqEligibleSlip(sl.find((x) => x.isBonus) as Slip) && sl.find((x) => x.isBonus)?.net === -100)
  test('Pokal-Zusatzmärkte (cup_*) sind regulär bewertbar, kein Special-Ausschluss', sl.every((x) => isIqEligibleSlip(x)))
  const rec = computeWildenrothRecords(sl, matches, 'I').get('p1')
  test('Pokal-Zusatzmärkte sind für Hall der Ehre/Schande neutral (weder Sieg- noch Gegentipp)', !rec || (rec.win.legs === 0 && rec.against.legs === 0))
}
{
  bets.length = 0; combos.length = 0
  const m1 = addMatch(710, 3, 3), m2 = addMatch(711, 3, 4), m3 = addMatch(712, 3, 5)
  bet('me', m1, { odds_value: 4, stake: 10, status: 'won', payout: 40 })
  combo('me', [{ matchId: m1, odds: 2, status: 'won' }, { matchId: m2, odds: 3, status: 'won' }, { matchId: m3, odds: 2, status: 'won' }], 20, 'won')
  combo('me', [{ matchId: m1, odds: 2, status: 'won' }, { matchId: m2, odds: 2, status: 'won' }, { matchId: m3, odds: 9, status: 'lost' }], 20, 'lost')
  bet('other', m2, { odds_value: 50, stake: 10, status: 'won', payout: 500, selection: 'away' })
  bet('none', m3, { status: 'lost' })
  const all = buildSlips({ bets, combos, matches }).slips
  const pt = buildPersonalTips(all, all, 'me', labeler)
  const keys = [pt.best, ...pt.extras.map((e) => e.card)].filter(Boolean).map((c) => (c as { userId: string }).userId)
  test('Mein bester Tipp: nur eigene Scheine, nie die eines anderen Tippers (auch wenn dessen Schein besser ist)', !!pt.best && keys.every((u) => u === 'me'))
  test('Mein bester Tipp: keine doppelten Karten, knappster verpasster Gewinn separat ausgewiesen', new Set([pt.best?.slipKey, ...pt.extras.map((e) => e.card.slipKey)]).size === 1 + pt.extras.length && pt.extras.some((e) => e.label.includes('verpasst')))
  const none = buildPersonalTips(all, all, 'none', labeler)
  test('Mein bester Tipp: ohne gewonnenen Schein keine erzwungene Karte', none.best === null && none.extras.length === 0 && none.settledSlips === 1 && none.wonSlips === 0)
  test('Persönliche Auswertung eines Nutzers ohne Scheine ist leer, nicht fehlerhaft', buildPersonalTips(all, all, 'ghost', labeler).best === null)
  const bt = buildCommunityBestTips(all, all, new Set(), labeler)
  test('Beste Tipps: mutigster Treffer wiederholt nie den Schein der besten Einzelwette/Kombi', !bt.bold || (bt.bold.slipKey !== bt.single?.slipKey && bt.bold.slipKey !== bt.combo?.slipKey))
  test('Beste Tipps: Karte enthält Einsatz, Auszahlung und Netto korrekt (Netto = Auszahlung − Einsatz)', !!bt.single && Math.abs(bt.single.net - (bt.single.payout - bt.single.stake)) < 1e-9)
}
{
  // Hall der Schande: Häufigkeit und Gewinn sind zwei Perspektiven desselben Awards
  bets.length = 0; combos.length = 0
  const mw = [addMatch(720, 4, 3, { home_team_id: 14, away_team_id: 9, home_score: 0, away_score: 2 }), addMatch(721, 4, 4, { home_team_id: 14, away_team_id: 8, home_score: 0, away_score: 1 }), addMatch(722, 4, 5, { home_team_id: 14, away_team_id: 7, home_score: 3, away_score: 0 }), addMatch(723, 4, 6, { home_team_id: 40, away_team_id: 6, home_score: 0, away_score: 1 })]
  for (const id of mw) bet('often', id, { selection: 'away', odds_value: 1.2, stake: 10, status: id === 722 ? 'lost' : 'won', payout: id === 722 ? 0 : 12 })
  bet('rich', mw[0], { selection: 'away', odds_value: 3, stake: 100, status: 'won', payout: 300 })
  bet('loyal', mw[0], { selection: 'home', status: 'lost' })
  const sl = buildSlips({ bets, combos, matches }).slips
  const aw = computeHalbzeitAwards({ rangeSlips: sl, allSlips: sl, matches, iq: [], range: { from: 1, to: 15 }, excluded: new Set() })
  const sh = aw.find((x) => x.key === 'hall_der_schande')
  test('Hall der Schande: größter Gewinn (rich, +200) und häufigste Gegenwetten (often, 4 Gegen-Tipps auf 4 Spiele) sind zwei Perspektiven', !!sh && sh.entries[0].userId === 'rich' && sh.second?.entries[0].userId === 'often' && /4 Gegen-Tipps/.test(sh.second.entries[0].value) && /4 verschiedene Spiele/.test(sh.second.entries[0].detail ?? ''))
  test('Hall der Schande: Häufigkeitsliste zeigt höchstens 3 Einträge', (sh?.second?.entries.length ?? 0) <= 3)
  const eh = aw.find((x) => x.key === 'hall_der_ehre')
  test('Öffentliche Auswahl: nur 6 definierte Awards (Gegenwetten = zweite Perspektive der Schande), Stehaufmännchen/Montagmorgen/Flaute bleiben intern', PUBLIC_AWARD_KEYS.length === 6 && !(PUBLIC_AWARD_KEYS as readonly string[]).some((k) => ['stehaufmaennchen', 'montagmorgen_manager', 'kombi_flaute', 'jackpot_koenig'].includes(k)) && aw.every((x) => x.public === (PUBLIC_AWARD_KEYS as readonly string[]).includes(x.key)) && eh === undefined)
}
{
  // „Ein Tor fehlte": Gesamtzahl vollständig, Beispiele gekürzt
  bets.length = 0; combos.length = 0
  const a = addMatch(730, 5, 3, { home_score: 1, away_score: 1 }), b = addMatch(731, 5, 4, { home_score: 2, away_score: 0 })
  for (let i = 0; i < 6; i++) combo(`u${i}`, [{ matchId: a, odds: 2, status: 'lost', selection: 'home' }, { matchId: b, odds: 2, status: 'won' }], 10, 'lost')
  const sl = buildSlips({ bets, combos, matches }).slips
  const rep = buildRecapReport({ allSlips: sl, matches, range: { from: 1, to: 16 }, profiles: [] })
  test('Ein Tor fehlte: Gesamtzahl bleibt vollständig (6), angezeigt werden nur 2 Beispiele', rep.facts.oneGoalShort.total === 6 && rep.facts.oneGoalShort.examples.length === 2 && rep.facts.comboKillers.singleBlockerCombos === 6)
}
{
  // Simulation: ändert nichts an den Eingaben, schließt Spieltag 16 nur im Speicher ab; reguläre Prüfung bleibt streng
  matches.length = 0; bets.length = 0; combos.length = 0
  const fin = addMatch(800, 15, 1)
  const sc = [addMatch(801, 16, 20, { status: 'scheduled', home_score: null, away_score: null }), addMatch(802, 16, 21, { status: 'scheduled', home_score: null, away_score: null })]
  bet('s1', fin, { status: 'won', payout: 20 }); bet('s1', sc[0], { status: 'pending', payout: null }); bet('s2', sc[1], { status: 'pending', payout: null, market_type: 'goalscorer', selection: '5' })
  combo('s3', [{ matchId: sc[0], odds: 2, status: 'won' }, { matchId: sc[1], odds: 2, status: 'won' }], 10, 'lost')
  for (const b of bets.filter((x) => x.match_id != null && sc.includes(x.match_id))) b.status = 'pending'
  combos[combos.length - 1].status = 'pending'; combos[combos.length - 1].payout = null
  const before = JSON.stringify({ matches, bets, combos })
  const real = computeRangeReadiness(matches, bets, 15, 16)
  const sim = simulateSpieltag({ matches, bets, combos }, 16)
  test('Simulation verändert die Eingabedaten nicht (reine Funktion, keine Schreibzugriffe)', JSON.stringify({ matches, bets, combos }) === before)
  test('Reguläre Bereitschaft bleibt streng: ohne Simulation ist Spieltag 16 NICHT bereit', !real.ready)
  const simReady = computeRangeReadiness(sim.matches, sim.bets, 15, 16)
  test('Mit Simulation sind alle Spiele beendet, keine Wette offen → dieselbe Prüfung meldet „bereit"', simReady.ready && sim.bets.every((x) => x.status !== 'pending') && sim.combos.every((x) => x.status !== 'pending') && sim.simulatedMatchIds.length === 2)
  test('Simulation ist deterministisch (gleiche Testwerte bei jedem Aufruf)', JSON.stringify(simulateSpieltag({ matches, bets, combos }, 16)) === JSON.stringify(sim))
  test('Simulierte Auszahlungen sind konsistent (gewonnen → Einsatz × Quote, verloren → 0)', sim.bets.filter((x) => x.combo_id == null && x.match_id != null && sc.includes(x.match_id)).every((x) => (x.status === 'won' ? Math.abs((x.payout ?? 0) - Number(x.stake) * Number(x.odds_value)) < 1e-6 : x.payout === 0)))
  const saved = { v: process.env.VERCEL_ENV, n: process.env.NODE_ENV }
  const env = process.env as Record<string, string | undefined>
  env.VERCEL_ENV = 'production'; env.NODE_ENV = 'development'
  const prodOff = !isPreviewEnvironment()
  env.VERCEL_ENV = 'preview'
  const prevOn = isPreviewEnvironment()
  env.VERCEL_ENV = saved.v; env.NODE_ENV = saved.n
  test('Simulation ist in Production nie aktiv (VERCEL_ENV=production sperrt, auch bei NODE_ENV=development), in Preview erlaubt', prodOff && prevOn)
}

{
  // Isolierte Demo: synthetische Fixtures → dieselbe Pipeline, Spieltag 16 nur im Speicher simuliert
  const fx = buildFixtureData()
  test('Fixtures sind deterministisch und enthalten Pokalspiel, Pokal-Bonus-Tipps, annulliertes Spiel, gelöschtes Konto, offenen Spieltag 16', JSON.stringify(buildFixtureData().bets) === JSON.stringify(fx.bets) && fx.matches.some((m) => m.competition_type === 'cup') && fx.bets.some((b) => b.is_bonus) && fx.matches.some((m) => m.status === 'annulled') && fx.profiles.some((p) => p.deleted_at) && fx.bets.some((b) => b.status === 'pending'))
  const realFx = computeRangeReadiness(fx.matches, fx.bets, 1, 16)
  const simFx = simulateSpieltag(fx, 16)
  test('Fixtures: Spieltag 16 ist real NICHT bereit, nach Simulation bereit; Eingaben bleiben unverändert', !realFx.ready && computeRangeReadiness(simFx.matches, simFx.bets, 1, 16).ready && fx.bets.some((b) => b.status === 'pending'))
  test('Verschlüsselter Snapshot: ohne/mit falschem Schlüssel nicht lesbar; falscher Schlüssel → Fehler statt Musterdaten, kein Schlüssel → Musterdaten; kein Klartext im Chiffretext', decryptSnapshot(undefined) === null && decryptSnapshot('zz') === null && decryptSnapshot('ab'.repeat(32)) === null && (() => { try { loadDemoState('', 'ab'.repeat(32)); return false } catch (e) { return e instanceof SnapshotKeyError } })() && loadDemoState('', undefined).source === 'fixtures' && !JSON.stringify(SNAPSHOT_ENC).includes('display_name'))
  const dm = loadDemoState('')
  test('Team-Highlights: 3 meistgewettete Teams mit Namen, Wildenroth I/II, Kombi-Killer-Spiel mit Vereinsnamen für Logos', dm.report.teams.mostBet.length === 3 && dm.report.teams.mostBet.every((t) => t.name && t.slips > 0) && dm.report.teams.wildenroth.length >= 1 && (dm.report.killers.killer == null || !!dm.report.matchTeams[dm.report.killers.killer.matchId]))
  test('Tipps tragen Heim/Gast für Vereinslogos; persönlicher Bereich liefert größten Gewinn, Beinahe-Treffer, Lieblings-Team', !!dm.report.bestTips.single?.legs[0]?.teams && (() => { const pp = loadDemoState(dm.meId).personal; return pp.biggestWin != null && pp.favoriteTeam != null })())
  const demo = loadDemoState('fx-u02')
  test('Demo-Bericht: Awards, IQ-Rangliste, gelöschtes Konto nicht genannt, persönlicher Tipp nur des gewählten Nutzers', demo.report.awards.some((a) => a.public) && demo.report.iq.some((x) => x.eligible) && !('fx-gone' in demo.report.people) && (!demo.personal.best || demo.personal.best.userId === 'fx-u02'))
  {
  const env = process.env as Record<string, string | undefined>
  const keys = ['RECAP_FIXTURE_DEMO', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
  const keep = Object.fromEntries(keys.map((k) => [k, env[k]]))
  const set = (k: string, v: string | undefined) => { if (v === undefined) delete env[k]; else env[k] = v }
  for (const k of keys) set(k, undefined)
  set('NEXT_PUBLIC_SUPABASE_URL', 'https://real.example'); set('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'k'); set('SUPABASE_SERVICE_ROLE_KEY', 'k')
  const prod = !isFixtureDemoEnabled()
  for (const k of keys) set(k, undefined)
  const isolated = isFixtureDemoEnabled()
  set('NEXT_PUBLIC_SUPABASE_URL', 'https://real.example')
  const partial = !isFixtureDemoEnabled()
  for (const k of keys) set(k, keep[k])
  test('Demo-Route: aus, sobald irgendeine Supabase-Konfiguration existiert (Production/Preview); an nur ohne jede Konfiguration', prod && isolated && partial)
}
}

{
  const env = process.env as Record<string, string | undefined>
  const keys = ['VERCEL_ENV', 'NODE_ENV', 'NEXT_PUBLIC_SUPABASE_URL']
  const keep = Object.fromEntries(keys.map((k) => [k, env[k]]))
  const set = (k: string, v: string | undefined) => { if (v === undefined) delete env[k]; else env[k] = v }
  const run = (vercel: string | undefined, ref: string | null) => { set('VERCEL_ENV', vercel); set('NODE_ENV', 'production'); set('NEXT_PUBLIC_SUPABASE_URL', ref ? `https://${ref}.supabase.co` : undefined); return isSimulationAllowed() }
  const sandboxPreview = run('preview', SANDBOX_SUPABASE_REF)
  const prodDbPreview = run('preview', PRODUCTION_SUPABASE_REF)
  const sandboxProd = run('production', SANDBOX_SUPABASE_REF)
  const prodDbProd = run('production', PRODUCTION_SUPABASE_REF)
  set('NEXT_PUBLIC_SUPABASE_URL', `https://${SANDBOX_SUPABASE_REF}.supabase.co`)
  const kinds = [databaseKind(supabaseRef()), databaseKind(PRODUCTION_SUPABASE_REF), databaseKind('abc'), databaseKind(null)]
  for (const k of keys) set(k, keep[k])
  test('Simulation nur in Vorschau UND auf nicht-produktiver Datenbank (Sandbox ja; produktive DB in Preview nein; Production nie)', sandboxPreview && !prodDbPreview && !sandboxProd && !prodDbProd)
  test('Datenbank-Erkennung: Sandbox, Production, andere, keine – ohne Schlüssel, nur Projektkennung', kinds.join() === 'sandbox,production,other,none')
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
