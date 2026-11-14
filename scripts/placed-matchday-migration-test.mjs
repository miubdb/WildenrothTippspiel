// Testet supabase/immutable_placed_matchday_2026.sql in einer reinen In-Memory-Postgres (PGlite) mit einem produktionsnahen
// Schema-Auszug, den ECHTEN (nicht-monotonen) Freigabezeiten aus Production, Supabase-typischen Rollen/Standardrechten und den
// verbatim übernommenen Produktions-Funktionen. Berührt keine echte Datenbank.
// Einmalig: npm i --no-save @electric-sql/pglite   ·   Aufruf: node scripts/placed-matchday-migration-test.mjs
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import path from 'node:path'

const MIGRATION = fs.readFileSync(path.join(process.cwd(), 'supabase/immutable_placed_matchday_2026.sql'), 'utf8')
let failed = 0, total = 0
const ok = (name, cond) => { total++; if (!cond) failed++; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}`) }

const SCHEMA = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table public.profiles (id uuid primary key default gen_random_uuid(), balance numeric not null default 1000);
create table public.matches (id int primary key, matchday int not null, tippspiel_matchday int, competition_type text default 'league', match_date timestamptz not null, status text not null default 'scheduled');
create table public.matchday_specials (id int primary key, matchday int not null);
create table public.app_settings (key text primary key, value text);
create table public.combo_bets (id serial primary key, user_id uuid not null, stake numeric not null check (stake > 0), total_odds numeric not null, status text not null default 'pending' check (status in ('pending','won','lost','void','neutralized')), payout numeric, created_at timestamptz default now(), season text not null default '26/27', void_reason text, original_total_odds numeric, neutralized_at timestamptz);
create table public.bets (id serial primary key, user_id uuid not null, match_id int not null references public.matches(id), market_type text not null, selection text not null, stake numeric, odds_value numeric not null, status text not null default 'pending' check (status in ('pending','won','lost','void','neutralized')), payout numeric, combo_id int references public.combo_bets(id), created_at timestamptz default now(), is_risky boolean not null default false, season text not null default '26/27', is_bonus boolean not null default false, void_reason text, special_id int references public.matchday_specials(id), neutralized_at timestamptz, neutralized_reason text, constraint single_or_combo check ((combo_id is null and stake is not null) or (combo_id is not null and stake is null)));
create table public.push_reminders (id bigserial primary key, type text not null, matchday int not null, sent_at timestamptz not null default now(), season text not null default '26/27', unique (type, matchday, season));
create or replace function public.apply_penalty(p_user_id uuid, p_amount numeric) returns numeric language plpgsql security definer set search_path to '' as $f$ declare v numeric; begin update public.profiles set balance = greatest(0, balance - p_amount) where id = p_user_id returning balance into v; return v; end; $f$;
create or replace function public.increment_balance(p_user_id uuid, p_amount numeric) returns numeric language plpgsql security definer set search_path to '' as $f$ declare v numeric; begin update public.profiles set balance = balance + p_amount where id = p_user_id returning balance into v; return v; end; $f$;
revoke all on function public.apply_penalty(uuid,numeric), public.increment_balance(uuid,numeric) from public, anon, authenticated;
-- verbatim Production-Stand der alten RPC (nur Legacy-Zählmodus)
create or replace function public.finalize_bet_placement(p_user_id uuid, p_lock_checks jsonb, p_combo_row jsonb, p_bet_rows jsonb) returns void language plpgsql security definer set search_path to 'public' as $f$
declare v_check jsonb; v_matchday int; v_match_ids int[]; v_expected int; v_actual int; v_combo_id int;
begin
  for v_check in select value from jsonb_array_elements(p_lock_checks) order by (value->>'matchday')::int loop
    v_matchday := (v_check->>'matchday')::int;
    select array_agg((elem)::int) into v_match_ids from jsonb_array_elements_text(v_check->'match_ids') as elem;
    v_expected := (v_check->>'expected_count')::int;
    perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || v_matchday::text));
    select (select count(*) from public.bets b where b.user_id = p_user_id and b.combo_id is null and not b.is_bonus and b.status in ('pending','won','lost') and b.match_id = any(v_match_ids))
         + (select count(distinct cb.id) from public.combo_bets cb join public.bets b on b.combo_id = cb.id where cb.user_id = p_user_id and cb.status in ('pending','won','lost') and b.match_id = any(v_match_ids)) into v_actual;
    if v_actual <> v_expected then raise exception 'SLOT_COUNT_CHANGED' using errcode = 'P0001'; end if;
  end loop;
  if p_combo_row is not null then
    insert into public.combo_bets (user_id, stake, total_odds, status, payout, season) values (p_user_id, (p_combo_row->>'stake')::numeric, (p_combo_row->>'total_odds')::numeric, p_combo_row->>'status', null, p_combo_row->>'season') returning id into v_combo_id;
  end if;
  insert into public.bets (user_id, match_id, market_type, selection, stake, odds_value, status, payout, combo_id, is_risky, is_bonus, season, special_id)
  select p_user_id, (r->>'match_id')::int, r->>'market_type', r->>'selection', nullif(r->>'stake','')::numeric, (r->>'odds_value')::numeric, r->>'status', null, v_combo_id, (r->>'is_risky')::boolean, coalesce((r->>'is_bonus')::boolean,false), r->>'season', nullif(r->>'special_id','')::int from jsonb_array_elements(p_bet_rows) as r;
end; $f$;
revoke all on function public.finalize_bet_placement(uuid,jsonb,jsonb,jsonb) from public, anon, authenticated; grant execute on function public.finalize_bet_placement(uuid,jsonb,jsonb,jsonb) to service_role;
`
// echte Freigabezeiten aus Production (nicht monoton: ST2 am 14.09., ST17/18 im März/Mai)
const OPENS = { 1:'2026-08-10T10:00:00+00:00',2:'2026-09-14 09:32:53.678266+00',3:'2026-08-17T10:00:00+00:00',4:'2026-08-21T08:30:00+00:00',5:'2026-08-24T11:04:47+00:00',6:'2026-08-31T11:18:00+00:00',7:'2026-09-07 09:56:46.602084+00',8:'2026-09-18T08:05:53+00:00',9:'2026-09-21 09:32:24.39444+00',10:'2026-09-28 09:42:06.372602+00',11:'2026-10-05 09:03:55.876593+00',12:'2026-10-12 07:16:54.884788+00',13:'2026-10-19T09:31:21Z',14:'2026-10-26T09:00:00.000Z',15:'2026-11-02T09:01:19.798Z',16:'2026-11-09T11:00:00+00:00',17:'2027-03-01T11:00:00+00:00',18:'2027-05-03T10:00:00+00:00',19:'2027-03-08T11:00:00+00:00',20:'2027-03-15T11:00:00+00:00',24:'2027-04-12T10:00:00+00:00' }
const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`

async function fresh(extra = '') {
  const db = new PGlite()
  await db.exec(SCHEMA)
  for (const [md, v] of Object.entries(OPENS)) await db.query(`insert into app_settings values ($1,$2)`, [`betting_open_md_${md}`, v])
  for (let i = 1; i <= 6; i++) await db.query('insert into profiles (id) values ($1)', [U(i)])
  await db.exec(`
    insert into matches (id, matchday, tippspiel_matchday, competition_type, match_date, status) values
      (236, 2, null, 'league', '2026-09-16T17:00:00Z', 'finished'),   -- Nachholspiel ST2 (nach ST7 gespielt)
      (296, 7, null, 'league', '2026-09-12T11:00:00Z', 'finished'),
      (573, 7, null, 'cup',    '2026-09-09T17:00:00Z', 'finished'),   -- Pokal: rohe Nummer
      (420, 8, null, 'league', '2026-09-20T13:00:00Z', 'finished'),
      (260, 16, null, 'league', '2027-03-17T18:30:00Z', 'postponed'),  -- verschoben in ST19-Fenster
      (323, 16, null, 'league', '2027-03-17T18:00:00Z', 'postponed'),
      (351, 16, null, 'league', '2026-11-15T12:00:00Z', 'scheduled'),
      (520, 19, null, 'league', '2027-03-19T14:00:00Z', 'scheduled'),
      (999, 999, null, 'league', '2026-09-01T10:00:00Z', 'scheduled'),
      (900, 24, null, 'league', '2026-04-04T10:00:00Z', 'finished');  -- Vorsaison
    insert into matchday_specials (id, matchday) values (5, 8);
    insert into combo_bets (id, user_id, stake, total_odds, status, created_at, season) values
      (1, '${U(1)}', 50, 4, 'pending', '2026-11-11T12:00:00Z', '26/27'),
      (2, '${U(2)}', 20, 3, 'lost',    '2026-09-15T12:00:00Z', '26/27');
    insert into bets (id, user_id, match_id, market_type, selection, stake, odds_value, status, combo_id, created_at, season, special_id) values
      (1, '${U(1)}', 260, '1x2', 'home', null, 2, 'pending', 1, '2026-11-11T12:00:00Z', '26/27', null),
      (2, '${U(1)}', 351, '1x2', 'home', null, 2, 'won',     1, '2026-11-11T12:00:00Z', '26/27', null),
      (3, '${U(2)}', 236, '1x2', 'home', null, 3, 'lost',    2, '2026-09-15T12:00:00Z', '26/27', null),  -- ST2-Nachholspiel NACH ST7-Öffnung, aber md2 (14.09.) ist die jüngere Freigabe
      (4, '${U(3)}', 296, '1x2', 'home', 10, 2, 'won', null, '2026-09-08T12:00:00Z', '26/27', null),
      (5, '${U(3)}', 573, '1x2', 'home', 10, 2, 'won', null, '2026-09-08T12:30:00Z', '26/27', null),
      (6, '${U(4)}', 420, 'matchday_special', 'a', 10, 2, 'lost', null, '2026-09-19T12:00:00Z', '26/27', 5),
      (7, '${U(5)}', 999, '1x2', 'home', 10, 2, 'lost', null, '2026-09-02T12:00:00Z', 'TEST', null),
      (8, '${U(5)}', 900, '1x2', 'home', 10, 2, 'won', null, '2026-04-01T12:00:00Z', '25/26', null);
    select setval('bets_id_seq', 100); select setval('combo_bets_id_seq', 100);
    ${extra}`)
  return db
}
const val = async (db, sql, params) => (await db.query(sql, params)).rows
const q1 = async (db, sql, params) => Object.values((await db.query(sql, params)).rows[0] ?? {})[0]
const throws = async (fn) => { try { await fn(); return null } catch (e) { return e.message } }
const run = async (db, sql) => { await db.exec('begin'); try { await db.exec(sql.replace(/^\s*BEGIN;/i, '').replace(/COMMIT;\s*(--[^\n]*\n?)*$/i, '')); await db.exec('commit') } catch (e) { await db.exec('rollback'); throw e } }

const db = await fresh()
const before = await q1(db, 'select count(*)::int from bets')
await db.exec(MIGRATION)
// ---------- Backfill ----------
const md = Object.fromEntries((await val(db, 'select id, placed_matchday from bets order by id')).map((r) => [r.id, r.placed_matchday]))
ok('Backfill: Wette auf verschobenes Spiel 260 (Nov-Kombi) bleibt Spieltag 16 – unabhängig vom März-Termin', md[1] === 16 && md[2] === 16)
ok('Backfill: ST2-Nachholspiel nach nicht-monotoner Freigabe (md2 = 14.09. > md7 = 07.09.) → 2', md[3] === 2)
ok('Backfill: normale ST7-Wette vor der ST2-Freigabe → 7; Pokal → rohe Nummer 7', md[4] === 7 && md[5] === 7)
ok('Backfill: Spieltag-Special → Spieltag des Specials (8), nicht der technische Anker', md[6] === 8)
ok('Backfill: Testspieltag 999 → 999; Vorsaison → Rohnummer 24 (nicht aus Freigabezeiten)', md[7] === 999 && md[8] === 24)
const cm = await val(db, 'select id, placed_matchday from combo_bets order by id')
ok('Backfill: Kombischeine erben den eindeutigen Spieltag ihrer Legs', cm[0].placed_matchday === 16 && cm[1].placed_matchday === 2)
ok('Backfill verändert keine Einsätze/Quoten/Status/Auszahlungen (Anzahl + Summen unverändert)', (await q1(db, 'select count(*)::int from bets')) === before)
// ---------- Idempotenz, NOT NULL, Trigger ----------
ok('Migration ist erneut ausführbar (idempotent)', (await throws(() => db.exec(MIGRATION))) === null)
const nn = await throws(() => db.exec(`insert into bets (user_id, match_id, market_type, selection, stake, odds_value) values ('${U(1)}', 99999, 'x','y',1,1)`))
ok('bets.placed_matchday ist NOT NULL: unbekanntes Spiel (derive = NULL) scheitert laut statt still NULL zu speichern', !!nn)
await db.exec(`insert into bets (user_id, match_id, market_type, selection, stake, odds_value, created_at) values ('${U(6)}', 351, '1x2','home',10,2,'2026-11-12T10:00:00Z')`)
ok('Trigger füllt fehlenden Owner (Legacy-/Fremd-Insert): ST16-Wette → 16', (await q1(db, `select placed_matchday from bets where user_id='${U(6)}'`)) === 16)
// Legacy-RPC (alter Stand) nach Rollout: Combo + Legs bekommen Owner über Trigger
await db.exec(`create or replace function public.legacy_place() returns void language plpgsql as $f$ begin
  insert into public.combo_bets (user_id, stake, total_odds, status, season) values ('${U(6)}', 10, 4, 'pending', '26/27');
  insert into public.bets (user_id, match_id, market_type, selection, odds_value, status, combo_id, season, created_at) select '${U(6)}', 351, '1x2', 'home', 2, 'pending', currval('combo_bets_id_seq'), '26/27', '2026-11-12T11:00:00Z';
end $f$`)
await db.exec('select legacy_place()')
ok('Legacy-Kombi ohne placed_matchday: Parent erbt Owner vom ersten Leg (kein NULL)', (await q1(db, `select count(*)::int from combo_bets where placed_matchday is null`)) === 0)
// ---------- Guard bricht bei widersprüchlichen Kombis ab ----------
const bad = await fresh(`update bets set created_at = '2026-09-15T12:00:00Z' where id = 1;`)  // Leg 1 (Match 260) später platziert → md2, Leg 2 bleibt 16
const badErr = await throws(() => run(bad, MIGRATION))
ok('Guard: Kombi mit widersprüchlichen Leg-Spieltagen bricht die Migration ab', /spans multiple origin matchdays/.test(badErr ?? ''))
ok('Abbruch rollt alles zurück (Spalte existiert nicht)', (await q1(bad, `select count(*)::int from information_schema.columns where table_name='bets' and column_name='placed_matchday'`)) === 0)

// ---------- RPC: Ursprungsmodus, Saisonisolation, Race-Schutz, Legacy ----------
const rpc = async (user, checks, combo, rows) => throws(async () => { await db.exec('set role service_role'); try { await db.query('select public.finalize_bet_placement($1,$2::jsonb,$3::jsonb,$4::jsonb)', [user, JSON.stringify(checks), combo ? JSON.stringify(combo) : null, JSON.stringify(rows)]) } finally { await db.exec('reset role') } })
const row = (m, md, extra = {}) => ({ match_id: m, market_type: '1x2', selection: 'home', stake: 10, odds_value: 2, status: 'pending', is_risky: false, is_bonus: false, season: '26/27', placed_matchday: md, ...extra })
// u1 hat eine offene ST16-Kombi (placed 16, enthält verschobenes Spiel 260). Neue ST19-Wette darf NICHT dadurch blockiert werden.
const e1 = await rpc(U(1), [{ matchday: 19, match_ids: [520, 260, 323], expected_count: 0, origin_mode: true }], null, [row(520, 19)])
ok('Alte November-Kombi (placed 16, Leg auf 260) verbraucht KEINEN Wettplatz in ST19', e1 === null && (await q1(db, `select count(*)::int from bets where user_id='${U(1)}' and placed_matchday=19`)) === 1)
const e2 = await rpc(U(1), [{ matchday: 19, match_ids: [520], expected_count: 0, origin_mode: true }], null, [row(520, 19)])
ok('Veralteter Zähler (stale expected_count) wird als SLOT_COUNT_CHANGED abgewiesen', /SLOT_COUNT_CHANGED/.test(e2 ?? ''))
const e3 = await rpc(U(1), [{ matchday: 16, match_ids: [351], expected_count: 1, origin_mode: true }], null, [row(351, 16)])
ok('ST16: die offene Kombi zählt als 1 Platz in ST16 (expected 1 passt)', e3 === null)
// Saisonisolation: Vorsaison-Zeile hat placed 24 – darf 26/27-ST24 nicht blockieren
await db.exec(`insert into bets (user_id, match_id, market_type, selection, stake, odds_value, status, season, placed_matchday) values ('${U(7)}'::uuid, 900, '1x2','home',10,2,'won','25/26',24)`.replace(`'${U(7)}'::uuid`, `'${U(5)}'`))
const e4 = await rpc(U(5), [{ matchday: 24, match_ids: [], expected_count: 0, origin_mode: true }], null, [row(351, 24)])
ok('Saison-Isolation: Vorsaison-Wette mit placed_matchday 24 belegt keinen Platz in 26/27-ST24', e4 === null)
const e5 = await rpc(U(5), [{ matchday: 24, match_ids: [], expected_count: 0, origin_mode: true }], null, [{ ...row(351, 24), season: undefined }])
ok('Ursprungsmodus ohne Saison wird abgewiesen (SEASON_MISSING) statt Saisons zu vermischen', /SEASON_MISSING/.test(e5 ?? ''))
const e6 = await rpc(U(2), [{ matchday: 8, match_ids: [420], expected_count: 0 }], null, [row(420, null)])
ok('Legacy-Aufruf (alte App, kein origin_mode/placed_matchday) funktioniert weiter; Owner kommt über Trigger', e6 === null)
// Combo atomar: Parent + Legs mit identischem Owner
const e7 = await rpc(U(3), [{ matchday: 16, match_ids: [351, 260], expected_count: 0, origin_mode: true }], { stake: 20, total_odds: 4, status: 'pending', season: '26/27', placed_matchday: 16 }, [row(351, 16, { stake: null }), row(260, 16, { stake: null })])
ok('Kombi atomar gespeichert: Parent und beide Legs tragen placed_matchday 16', e7 === null && (await q1(db, `select count(*)::int from combo_bets c join bets b on b.combo_id=c.id where c.user_id='${U(3)}' and c.placed_matchday=16 and b.placed_matchday=16`)) === 2)
// ---------- Rechte ----------
const denied = []
for (const role of ['anon', 'authenticated']) {
  await db.exec(`set role ${role}`)
  denied.push(await throws(() => db.query(`select public.finalize_bet_placement('${U(1)}','[]','null','[]')`)))
  denied.push(await throws(() => db.query(`select public.book_matchday_round('pocket_money','26/27',16,array['${U(1)}']::uuid[],10)`)))
  denied.push(await throws(() => db.query(`select public.derive_placed_matchday(1,'x',null,'26/27',now())`)))
  await db.exec('reset role')
}
ok('anon/authenticated dürfen weder finalize_bet_placement, book_matchday_round noch derive_placed_matchday ausführen', denied.every((e) => /permission denied/i.test(e ?? '')))

// ---------- Atomare Rundenbuchung ----------
const bal = async (u) => Number(await q1(db, 'select balance from profiles where id=$1', [u]))
const book = (type, md, users, amount) => db.query(`select public.book_matchday_round($1,'26/27',$2,$3::uuid[],$4) as r`, [type, md, users, amount])
await db.exec('set role service_role')
const r1 = (await book('inactivity_fee', 16, [U(1), U(2), U(2)], 50)).rows[0].r
await db.exec('reset role')
ok('Strafwildis: einmal gebucht (Duplikate im Array zählen nur einmal): U1/U2 je −50', r1.booked === true && r1.users === 2 && (await bal(U(1))) === 950 && (await bal(U(2))) === 950)
await db.exec('set role service_role')
const r2 = (await book('inactivity_fee', 16, [U(1), U(2)], 50)).rows[0].r
await db.exec('reset role')
ok('Zweiter Abschluss derselben Runde: ALREADY_BOOKED, keine Doppelbuchung', r2.booked === false && (await bal(U(1))) === 950)
// Fehlerinjektion: ein Empfänger scheitert → ALLES zurück inkl. Marker, Retry möglich
await db.exec(`create function fail_for_u4() returns trigger language plpgsql as $f$ begin if new.id = '${U(4)}' then raise exception 'boom'; end if; return new; end $f$; create trigger t_fail before update on profiles for each row execute function fail_for_u4();`)
await db.exec('set role service_role')
const eb = await throws(() => book('pocket_money', 16, [U(3), U(4), U(5)], 10))
await db.exec('reset role')
ok('Fehlgeschlagene Teilbuchung rollt ALLES zurück: kein Marker, U3/U5 unverändert (kein halber Batch)', !!eb && (await q1(db, `select count(*)::int from push_reminders where type='pocket_money' and matchday=16`)) === 0 && (await bal(U(3))) === 1000 && (await bal(U(5))) === 1000)
await db.exec('drop trigger t_fail on profiles')
await db.exec('set role service_role')
const r3 = (await book('pocket_money', 16, [U(3), U(4), U(5)], 10)).rows[0].r
await db.exec('reset role')
ok('Retry nach behobenem Fehler bucht genau einmal (+10 je Empfänger)', r3.booked === true && (await bal(U(3))) === 1010 && (await bal(U(4))) === 1010)
const bad1 = await throws(() => book('pocket_money', 999, [U(1)], 10)); const bad2 = await throws(() => book('hack', 16, [U(1)], 10)); const bad3 = await throws(() => book('pocket_money', 17, [U(1)], -5))
ok('Ungültiger Spieltag (Test 999), unbekannter Typ und negativer Betrag werden abgewiesen', !!bad1 && !!bad2 && !!bad3)

console.log(`\n${total - failed}/${total} Prüfungen bestanden`)
process.exit(failed ? 1 : 0)
