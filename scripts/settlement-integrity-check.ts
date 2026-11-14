/**
 * Regression suite for goalscorer settlement (lib/goalscorerSettlement.ts) and the survey reward
 * (lib/surveyReward.ts), run against an in-memory fake of the Supabase client whose RPCs reproduce the
 * semantics of the SQL functions settle_bet / settle_combo / grant_survey_reward (row lock + status check +
 * credit in one step; failure injection rolls the whole step back). The SQL functions themselves are covered
 * by scripts/placed-matchday-migration-test.mjs (PGlite) and the sandbox notebook.
 *
 *   node --experimental-strip-types scripts/run-settlement-integrity-check.mjs
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  validateScorerReport, wildenrothSideOf, goalscorerBetResult, settleGoalscorerMarket, resolveWildenrothGoals,
} from '@/lib/goalscorerSettlement'
import {
  isEligibleForSurveyReward, rewardStateFromRpc, grantSurveyRewardIfEligible, SURVEY_REWARD_AMOUNT,
} from '@/lib/surveyReward'
import { SURVEY_VERSION_PRODUCTION, SURVEY_VERSION_PREVIEW } from '@/lib/surveyMode'
import { ALL_QUESTIONS, isSurveyComplete, type Answers } from '@/lib/survey'
import { readFileSync } from 'node:fs'
import path from 'node:path'

let total = 0, failed = 0
const check = (name: string, ok: boolean) => { total++; if (!ok) failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`) }

// ───────────────────────── in-memory fake Supabase ─────────────────────────
type Row = Record<string, unknown>
class FakeDb {
  tables: Record<string, Row[]> = {}
  balances = new Map<string, number>()
  failCreditFor = new Set<string>()
  rpcCalls = 0
  nextId = 10000
  credit(user: string, amount: number) {
    if (this.failCreditFor.has(user)) throw new Error('credit boom')
    this.balances.set(user, (this.balances.get(user) ?? 0) + amount)
  }
  client(): SupabaseClient {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const db = this
    const from = (table: string) => new Query(db, table)
    const rpc = async (name: string, args: Record<string, unknown>) => {
      db.rpcCalls++
      await Promise.resolve() // yield: lets concurrent callers interleave like real requests
      try { return { data: db.runRpc(name, args), error: null } } catch (e) { return { data: null, error: { message: (e as Error).message } } }
    }
    return { from, rpc } as unknown as SupabaseClient
  }
  runRpc(name: string, a: Record<string, unknown>): unknown {
    if (name === 'settle_bet' || name === 'settle_combo') {
      const t = name === 'settle_bet' ? 'bets' : 'combo_bets'
      const row = (this.tables[t] ?? []).find((r) => r.id === a[name === 'settle_bet' ? 'p_bet_id' : 'p_combo_id'])
      if (!row || row.status !== 'pending') return false
      const status = a.p_status as string
      const pay = status === 'won' ? Number(a.p_payout) : 0
      const credits = status === 'won' && pay > 0 && (t === 'combo_bets' || row.combo_id == null)
      if (credits) this.credit(row.user_id as string, pay) // throws BEFORE the status flip -> nothing changes (rollback)
      row.status = status; row.payout = pay
      return true
    }
    if (name === 'grant_survey_reward') {
      if (a.p_survey_version !== SURVEY_VERSION_PRODUCTION) throw new Error('SURVEY_VERSION_NOT_REWARDED')
      const resp = (this.tables.survey_responses ?? []).find((r) => r.user_id === a.p_user_id && r.survey_version === a.p_survey_version && r.submitted_at)
      if (!resp) return { granted: false, reason: 'NOT_SUBMITTED' }
      const journal = (this.tables.balance_transactions ??= [])
      if (journal.some((j) => j.user_id === a.p_user_id && j.kind === 'survey_reward' && j.ref === a.p_survey_version)) return { granted: false, reason: 'ALREADY_GRANTED' }
      this.credit(a.p_user_id as string, 100) // throws -> no journal row either
      journal.push({ id: this.nextId++, user_id: a.p_user_id, kind: 'survey_reward', ref: a.p_survey_version, amount: 100 })
      return { granted: true, reason: 'GRANTED' }
    }
    throw new Error(`unknown rpc ${name}`)
  }
}
class Query {
  filters: ((r: Row) => boolean)[] = []
  single_ = false; maybe_ = false; head = false; countMode = false
  db: FakeDb; table: string
  constructor(db: FakeDb, table: string) { this.db = db; this.table = table }
  select(_cols?: string, opts?: { count?: string; head?: boolean }) { if (opts?.count) this.countMode = true; if (opts?.head) this.head = true; return this }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this }
  not(c: string, op: string, v: unknown) { if (op === 'is' && v === null) this.filters.push((r) => r[c] != null); return this }
  order() { return this }
  range() { return this }
  limit() { return this }
  single() { this.single_ = true; return this }
  maybeSingle() { this.maybe_ = true; return this }
  then<T>(resolve: (v: { data: unknown; error: unknown; count?: number }) => T) {
    const rows = (this.db.tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r))).map((r) => ({ ...r }))
    if (this.single_) return Promise.resolve(resolve(rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'not single' } }))
    if (this.maybe_) return Promise.resolve(resolve({ data: rows[0] ?? null, error: null }))
    return Promise.resolve(resolve({ data: this.head ? null : rows, error: null, count: this.countMode ? rows.length : undefined }))
  }
}

const W1 = 14, W2 = 40, OPP = 21
function world(opts: { home: number; away: number; hs: number; as: number; status?: string }) {
  const db = new FakeDb()
  db.tables.teams = [{ id: W1, name: 'SpVgg Wildenroth' }, { id: W2, name: 'SpVgg Wildenroth II' }, { id: OPP, name: 'TSV Landsberg II' }]
  db.tables.matches = [{ id: 1, status: opts.status ?? 'finished', home_team_id: opts.home, away_team_id: opts.away, home_score: opts.hs, away_score: opts.as }]
  db.tables.bets = []
  db.tables.combo_bets = []
  return db
}
let betId = 1
function bet(db: FakeDb, user: string, market: 'goalscorer' | 'goalscorer_2plus', player: number, opts: { stake?: number; odds?: number; combo?: number; status?: string; matchId?: number } = {}) {
  const row = { id: betId++, user_id: user, match_id: opts.matchId ?? 1, market_type: market, selection: String(player), stake: opts.combo ? null : (opts.stake ?? 10), odds_value: opts.odds ?? 3, combo_id: opts.combo ?? null, is_risky: false, status: opts.status ?? 'pending', payout: null }
  db.tables.bets.push(row); return row
}
function combo(db: FakeDb, id: number, user: string, stake: number, odds: number, status = 'pending') {
  db.tables.combo_bets.push({ id, user_id: user, stake, total_odds: odds, status, payout: null })
}
function otherLeg(db: FakeDb, comboId: number, user: string, status: string) {
  db.tables.bets.push({ id: betId++, user_id: user, match_id: 99, market_type: '1x2', selection: 'home', stake: null, odds_value: 2, combo_id: comboId, is_risky: false, status, payout: null })
}
const bal = (db: FakeDb, u: string) => db.balances.get(u) ?? 0
const st = (db: FakeDb, id: number) => db.tables.bets.find((b) => b.id === id)?.status

export async function run(): Promise<number> {
  // ───── pure rules ─────
  check('Seite: Wildenroth I auswärts / II daheim / kein Wildenroth / I gegen II',
    wildenrothSideOf({ home_team_id: OPP, away_team_id: W1 }, [W1, W2]) === 'away' &&
    wildenrothSideOf({ home_team_id: W2, away_team_id: OPP }, [W1, W2]) === 'home' &&
    wildenrothSideOf({ home_team_id: OPP, away_team_id: 77 }, [W1, W2]) === null &&
    wildenrothSideOf({ home_team_id: W1, away_team_id: W2 }, [W1, W2]) === 'both')
  check('0 Tore + leere Liste ist vollständig', validateScorerReport(0, []).ok)
  check('3 Tore + leere Liste wird abgelehnt (nie als "0 Tore" gelesen)', !validateScorerReport(3, []).ok)
  check('3 Tore + unvollständige Liste (2) wird abgelehnt', !validateScorerReport(3, [{ playerId: 7, goals: 2 }]).ok)
  check('3 Tore + zu viele (4) wird abgelehnt', !validateScorerReport(3, [{ playerId: 7, goals: 4 }]).ok)
  const og = validateScorerReport(3, [{ playerId: 7, goals: 2 }, { playerId: 9, goals: 1, isOwnGoal: true }])
  check('Eigentor zählt zur Teamsumme, nicht für den Spieler', og.ok && og.goalsByPlayer.get(7) === 2 && !og.goalsByPlayer.has(9) && og.ownGoals === 1)
  check('0 Tore aber Torschütze eingetragen wird abgelehnt', !validateScorerReport(0, [{ playerId: 7, goals: 1 }]).ok)
  const m = new Map([[7, 2], [8, 1]])
  check('Märkte: 1+ bei 1 Tor gewonnen, 2+ bei 1 Tor verloren, 2+ bei 2 Toren gewonnen, ohne Tor verloren',
    goalscorerBetResult('goalscorer', 8, m) === 'won' && goalscorerBetResult('goalscorer_2plus', 8, m) === 'lost' &&
    goalscorerBetResult('goalscorer_2plus', 7, m) === 'won' && goalscorerBetResult('goalscorer', 5, m) === 'lost')

  // ───── 0:5 (Match 413): Wildenroth I auswärts ohne Tor ─────
  {
    const db = world({ home: OPP, away: W1, hs: 5, as: 0 })
    const a = bet(db, 'u1', 'goalscorer', 7), b = bet(db, 'u2', 'goalscorer_2plus', 8)
    combo(db, 500, 'u3', 10, 6); const c = bet(db, 'u3', 'goalscorer', 7, { combo: 500 }); otherLeg(db, 500, 'u3', 'pending')
    combo(db, 501, 'u4', 10, 6, 'lost'); const d = bet(db, 'u4', 'goalscorer', 9, { combo: 501 }) // bereits verlorene Kombi
    const r = await settleGoalscorerMarket(db.client(), 1, null)
    check('0:5 auswärts: automatische Abrechnung ohne Liste – alle Torschützenwetten verloren', r.ok && [a, b, c, d].every((x) => st(db, x.id) === 'lost'))
    check('0:5: offene Kombi mit verlorenem Torschützen-Leg wird sofort verloren', db.tables.combo_bets.find((x) => x.id === 500)?.status === 'lost')
    check('0:5: bereits verlorene Kombi bleibt verloren, keine Auszahlung', db.tables.combo_bets.find((x) => x.id === 501)?.status === 'lost' && bal(db, 'u4') === 0)
    const rpcBefore = db.rpcCalls
    const r2 = await settleGoalscorerMarket(db.client(), 1, null)
    check('0:5: wiederholter Aufruf rechnet nichts erneut ab', r2.ok && r2.settled === 0 && db.rpcCalls === rpcBefore)
  }
  // ───── 0:0, Wildenroth II daheim ─────
  {
    const db = world({ home: W2, away: OPP, hs: 0, as: 0 })
    const a = bet(db, 'u1', 'goalscorer', 7)
    const r = await settleGoalscorerMarket(db.client(), 1, [])
    check('0:0 Wildenroth II daheim: leere Liste rechnet als verloren ab', r.ok && st(db, a.id) === 'lost' && bal(db, 'u1') === 0)
  }
  // ───── 5:0, Wildenroth I daheim mit vollständiger Liste ─────
  {
    const db = world({ home: W1, away: OPP, hs: 5, as: 0 })
    const a = bet(db, 'u1', 'goalscorer', 7, { stake: 10, odds: 3 }), b = bet(db, 'u2', 'goalscorer', 8), c = bet(db, 'u3', 'goalscorer_2plus', 7, { stake: 5, odds: 4 })
    combo(db, 600, 'u4', 10, 5); const leg = bet(db, 'u4', 'goalscorer', 7, { combo: 600 }); otherLeg(db, 600, 'u4', 'won')
    const auto = await settleGoalscorerMarket(db.client(), 1, null)
    check('5:0: automatische Null-Tore-Abrechnung verweigert, nichts angefasst', !auto.ok && st(db, a.id) === 'pending')
    const bad = await settleGoalscorerMarket(db.client(), 1, [{ playerId: 7, goals: 3 }])
    check('5:0: unvollständige Liste (3 von 5) wird abgelehnt, nichts abgerechnet', !bad.ok && st(db, a.id) === 'pending' && bal(db, 'u1') === 0)
    const ok = await settleGoalscorerMarket(db.client(), 1, [{ playerId: 7, goals: 3 }, { playerId: 9, goals: 1 }, { playerId: 4, goals: 1, isOwnGoal: true }])
    check('5:0: vollständige Liste (3+1+1 ET) zahlt Treffer aus', ok.ok && st(db, a.id) === 'won' && bal(db, 'u1') === 30 && st(db, b.id) === 'lost' && st(db, c.id) === 'won' && bal(db, 'u3') === 20)
    check('5:0: Kombi mit gewonnenem Torschützen-Leg und gewonnenem Rest wird einmal ausgezahlt', st(db, leg.id) === 'won' && bal(db, 'u4') === 50)
    await settleGoalscorerMarket(db.client(), 1, [{ playerId: 7, goals: 3 }, { playerId: 9, goals: 1 }, { playerId: 4, goals: 1, isOwnGoal: true }])
    check('5:0: wiederholte Abrechnung zahlt nichts doppelt', bal(db, 'u1') === 30 && bal(db, 'u3') === 20 && bal(db, 'u4') === 50)
  }
  // ───── Spiel noch nicht beendet / kein Wildenroth ─────
  {
    const db = world({ home: W1, away: OPP, hs: 0, as: 0, status: 'scheduled' })
    bet(db, 'u1', 'goalscorer', 7)
    check('Nicht beendetes Spiel: keine Torschützenabrechnung', !(await settleGoalscorerMarket(db.client(), 1, [])).ok)
    const db2 = world({ home: OPP, away: 77, hs: 0, as: 0 })
    check('Kein Wildenroth-Spiel: Abrechnung verweigert', !(await resolveWildenrothGoals(db2.client(), 1)).ok)
  }
  // ───── Gleichzeitige Abrechnungen ─────
  {
    const db = world({ home: W1, away: OPP, hs: 1, as: 0 })
    const a = bet(db, 'u1', 'goalscorer', 7, { stake: 10, odds: 3 })
    const list = [{ playerId: 7, goals: 1 }]
    await Promise.all([settleGoalscorerMarket(db.client(), 1, list), settleGoalscorerMarket(db.client(), 1, list), settleGoalscorerMarket(db.client(), 1, list)])
    check('Drei parallele Abrechnungen: genau eine Auszahlung', st(db, a.id) === 'won' && bal(db, 'u1') === 30)
  }
  // ───── Fehlgeschlagene Gutschrift + Retry ─────
  {
    const db = world({ home: W1, away: OPP, hs: 1, as: 0 })
    const a = bet(db, 'u1', 'goalscorer', 7, { stake: 10, odds: 3 }), b = bet(db, 'u2', 'goalscorer', 7, { stake: 10, odds: 2 })
    db.failCreditFor.add('u1')
    const r = await settleGoalscorerMarket(db.client(), 1, [{ playerId: 7, goals: 1 }])
    check('Gutschrift scheitert: Wette bleibt pending, Fehler gemeldet, andere Wette normal ausgezahlt', r.ok && r.settleErrors === 1 && st(db, a.id) === 'pending' && bal(db, 'u1') === 0 && st(db, b.id) === 'won' && bal(db, 'u2') === 20)
    db.failCreditFor.clear()
    await settleGoalscorerMarket(db.client(), 1, [{ playerId: 7, goals: 1 }])
    check('Retry zahlt die offene Wette genau einmal nach, andere nicht doppelt', st(db, a.id) === 'won' && bal(db, 'u1') === 30 && bal(db, 'u2') === 20)
  }

  // ───── Umfrage-Belohnung ─────
  const complete: Answers = {}
  for (const q of ALL_QUESTIONS) {
    // fill every question with its first option / a valid value, then keep only what the survey still considers visible
    if (q.type === 'scale') complete[q.id] = q.scaleMax ?? 5
    else if (q.type === 'single') complete[q.id] = (q.options ?? [])[0]
    else if (q.type === 'multi') complete[q.id] = [(q.options ?? [])[0]].filter(Boolean) as string[]
    else complete[q.id] = 'Test'
  }
  const isComplete = isSurveyComplete(complete)
  check('Testfixture: generierte Antworten sind vollständig', isComplete)
  const incomplete: Answers = { ...complete }; delete incomplete[ALL_QUESTIONS.find((q) => q.type === 'scale')!.id]
  check('Eligibility: Production + abgeschickt + vollständig', isEligibleForSurveyReward(SURVEY_VERSION_PRODUCTION, '2026-11-14T10:00:00Z', complete))
  check('Eligibility: Preview-Version nie', !isEligibleForSurveyReward(SURVEY_VERSION_PREVIEW, '2026-11-14T10:00:00Z', complete))
  check('Eligibility: V1 nie', !isEligibleForSurveyReward('winter_2026_v1', '2026-11-14T10:00:00Z', complete))
  check('Eligibility: abgebrochen (nicht abgeschickt) nie', !isEligibleForSurveyReward(SURVEY_VERSION_PRODUCTION, null, complete))
  check('Eligibility: submitted_at gesetzt, aber unvollständig nie', !isEligibleForSurveyReward(SURVEY_VERSION_PRODUCTION, '2026-11-14T10:00:00Z', incomplete))
  check('RPC-Mapping: Fehler → pending (Retry), granted, already, not submitted',
    rewardStateFromRpc(null, { message: 'x' }).status === 'pending' && rewardStateFromRpc({ granted: true }, null).status === 'granted' &&
    rewardStateFromRpc({ granted: false, reason: 'ALREADY_GRANTED' }, null).status === 'already_granted' &&
    rewardStateFromRpc({ granted: false, reason: 'NOT_SUBMITTED' }, null).status === 'not_eligible')
  {
    const db = new FakeDb()
    db.tables.survey_responses = [{ user_id: 'u1', survey_version: SURVEY_VERSION_PRODUCTION, submitted_at: '2026-11-14T10:00:00Z' }]
    const c = db.client()
    const first = await grantSurveyRewardIfEligible(c, 'u1', SURVEY_VERSION_PRODUCTION, '2026-11-14T10:00:00Z', complete)
    check('Erstmalige gültige Teilnahme: +100', first.status === 'granted' && bal(db, 'u1') === SURVEY_REWARD_AMOUNT)
    const again = await grantSurveyRewardIfEligible(c, 'u1', SURVEY_VERSION_PRODUCTION, '2026-11-14T11:00:00Z', complete)
    check('Wiederholtes Absenden / Bearbeiten: keine zweite Gutschrift', again.status === 'already_granted' && bal(db, 'u1') === 100)
    const edited = await grantSurveyRewardIfEligible(c, 'u1', SURVEY_VERSION_PRODUCTION, null, incomplete)
    check('Nachträglich unvollständig bearbeitet: keine Rückbuchung', edited.status === 'not_eligible' && bal(db, 'u1') === 100)
    db.tables.survey_responses.push({ user_id: 'u2', survey_version: SURVEY_VERSION_PRODUCTION, submitted_at: '2026-11-14T10:00:00Z' })
    await Promise.all([1, 2, 3, 4].map(() => grantSurveyRewardIfEligible(c, 'u2', SURVEY_VERSION_PRODUCTION, '2026-11-14T10:00:00Z', complete)))
    check('Vier gleichzeitige Requests: genau 100 Wildis', bal(db, 'u2') === 100 && db.tables.balance_transactions.filter((j) => j.user_id === 'u2').length === 1)
    db.tables.survey_responses.push({ user_id: 'u3', survey_version: SURVEY_VERSION_PRODUCTION, submitted_at: '2026-11-14T10:00:00Z' })
    db.failCreditFor.add('u3')
    const fail = await grantSurveyRewardIfEligible(c, 'u3', SURVEY_VERSION_PRODUCTION, '2026-11-14T10:00:00Z', complete)
    check('Gutschrift scheitert: pending, kein Journal-Eintrag, kein Guthaben', fail.status === 'pending' && bal(db, 'u3') === 0 && !db.tables.balance_transactions.some((j) => j.user_id === 'u3'))
    db.failCreditFor.clear()
    const retry = await grantSurveyRewardIfEligible(c, 'u3', SURVEY_VERSION_PRODUCTION, '2026-11-14T10:00:00Z', complete)
    check('Wiederholung nach Fehler: genau einmal +100', retry.status === 'granted' && bal(db, 'u3') === 100)
    const preview = await grantSurveyRewardIfEligible(c, 'u1', SURVEY_VERSION_PREVIEW, '2026-11-14T10:00:00Z', complete)
    check('Preview-Teilnahme ruft die RPC gar nicht erst auf und bucht nichts', preview.status === 'not_eligible' && bal(db, 'u1') === 100)
    // Backfill: dreimal über alle laufen lassen
    const before = db.rpcCalls
    for (let i = 0; i < 3; i++) for (const u of ['u1', 'u2', 'u3']) await grantSurveyRewardIfEligible(c, u, SURVEY_VERSION_PRODUCTION, '2026-11-14T10:00:00Z', complete)
    check('Mehrfacher Backfill: keine zusätzlichen Wildis, Journal = 1 Zeile je Nutzer',
      ['u1', 'u2', 'u3'].every((u) => bal(db, u) === 100) && db.tables.balance_transactions.length === 3 && db.rpcCalls === before + 9)
  }

  // ───── Source guards (routes stay wired to the shared, atomic logic) ─────
  const src = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8')
  const settle = src('app/api/admin/settle/route.ts')
  check('settle: Null-Tore-Torschützenabrechnung serverseitig (unabhängig von der Admin-UI)', /settleGoalscorerMarket\(admin, matchId, null\)/.test(settle) && /teamGoals === 0/.test(settle))
  check('settle: meldet offene Torschützenwetten an die Admin-UI', /goalscorerPending/.test(settle))
  const scorers = src('app/api/admin/goalscorers/scorers/route.ts')
  check('scorers: Liste wird VOR dem Speichern gegen das Ergebnis geprüft', scorers.indexOf('validateScorerReport') > 0 && scorers.indexOf('validateScorerReport') < scorers.indexOf("from('match_goalscorers').delete()"))
  check('scorers: keine direkten Status-Updates / increment_balance', !/increment_balance/.test(scorers) && !/\.update\(\{ status/.test(scorers) && /settleGoalscorerMarket\(/.test(scorers))
  check('Admin-UI: Hinweis auf offene Torschützenwetten statt stillem Überspringen', /goalscorerPending/.test(src('app/admin/page.tsx')))
  const survey = src('app/api/survey/route.ts')
  check('Umfrage-API: Belohnung nur über grantSurveyRewardIfEligible (serverseitig, atomar)', /grantSurveyRewardIfEligible\(/.test(survey) && !/increment_balance/.test(survey))
  const sql = src('supabase/survey_reward_2026.sql')
  check('SQL: Journal mit UNIQUE(user, kind, ref), RLS, nur service_role darf buchen, nur winter_2026_v2',
    /UNIQUE \(user_id, kind, ref\)/.test(sql) && /ENABLE ROW LEVEL SECURITY/.test(sql) && /GRANT EXECUTE ON FUNCTION public\.grant_survey_reward\(uuid, text\) TO service_role/.test(sql) && /'winter_2026_v2'/.test(sql))

  console.log(`\n${total - failed}/${total} Prüfungen bestanden`)
  return failed
}
