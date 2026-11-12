// Testet supabase/winter_awards.sql in einer reinen In-Memory-Postgres (PGlite) – berührt keine echte Datenbank.
// Einmalig: npm i --no-save @electric-sql/pglite   ·   Aufruf: node scripts/winter-awards-migration-test.mjs supabase/winter_awards.sql
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
const db = new PGlite()
// Minimal-Stubs für Abhängigkeiten der Migration (Produktion hat diese bereits)
await db.exec(`create role anon; create role authenticated; create role service_role;
create table public.profiles (id uuid primary key);
insert into public.profiles values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
create table public.user_awards (id serial primary key, user_id uuid, award_type text, matchday int, season text);
insert into public.user_awards (user_id, award_type, matchday, season) values ('00000000-0000-0000-0000-000000000001','spieltagskoenig',7,'26/27');`)
const sql = fs.readFileSync(process.argv[2], 'utf8')
await db.exec(sql); await db.exec(sql) // zweimal: idempotent
const U = (n) => `00000000-0000-0000-0000-00000000000${n}`
const row = (k, u, v) => ({ award_key: k, user_id: U(u), award_title: k, award_icon: '🏆', award_description: 'd', value_text: v })
const call = async (rows) => (await db.query(`select public.replace_winter_awards('26/27','hinrunde',$1::jsonb) as n`, [JSON.stringify(rows)])).rows[0].n
const count = async () => (await db.query('select count(*)::int c from public.winter_awards')).rows[0].c
const ok = (name, c) => { console.log(c ? 'OK ' : 'FAIL', name); if (!c) process.exitCode = 1 }
const r1 = [row('hall_der_ehre',1,'14'), row('hall_der_ehre',2,'14'), row('wildi_magnet',3,'+100')]
ok('erstes Veröffentlichen: 3 Zeilen (Gleichstand = 2 Gewinner)', (await call(r1)) === 3 && (await count()) === 3)
ok('erneutes Veröffentlichen: keine Duplikate', (await call(r1)) === 3 && (await count()) === 3)
ok('Ersetzen mit neuem Ergebnis: alter Stand ersetzt', (await call([row('wildi_magnet',1,'+5')])) === 1 && (await count()) === 1)
ok('doppelter Eintrag im selben Aufruf: unique → nur einer', (await call([row('kombi_pech',1,'9'), row('kombi_pech',1,'9')])) === 1)
let bad = false; try { await call([row('unbekannt',1,'x')]) } catch { bad = true }
ok('ungültiger award_key wird abgelehnt', bad)
ok('Fehler lässt den alten Stand unverändert (Transaktion)', (await count()) === 1)
let bad2 = false; try { await db.query(`select public.replace_winter_awards('26/27','hinrunde','{"a":1}'::jsonb)`) } catch { bad2 = true }
ok('kein Array wird abgelehnt', bad2)
ok('Spieltags-Pokale (user_awards) unverändert', (await db.query('select count(*)::int c from public.user_awards')).rows[0].c === 1)
let bad3 = false; try { await db.query(`insert into public.winter_awards (season,recap_key,award_key,user_id,award_title,award_icon,award_description) values ('26/27','hinrunde','wildi_magnet','${U(9)}','t','i','d')`) } catch { bad3 = true }
ok('Fremdschlüssel auf profiles erzwungen', bad3)
const g = (await db.query(`select has_table_privilege('anon','public.winter_awards','select') a, has_table_privilege('authenticated','public.winter_awards','select') b, has_function_privilege('authenticated','public.replace_winter_awards(text,text,jsonb)','execute') c, has_function_privilege('service_role','public.replace_winter_awards(text,text,jsonb)','execute') d`)).rows[0]
ok('anon/authenticated haben weder Tabellen- noch Funktionszugriff, service_role darf ausführen', !g.a && !g.b && !g.c && g.d)
const rls = (await db.query(`select relrowsecurity r from pg_class where relname='winter_awards'`)).rows[0].r
ok('RLS aktiv', rls === true)
