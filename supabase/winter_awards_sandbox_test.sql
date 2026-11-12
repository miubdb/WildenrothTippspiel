-- Sandbox-Test für supabase/winter_awards.sql – läuft in EINER Transaktion und wird IMMER zurückgerollt
-- (der Block endet mit einer absichtlichen Exception; der Bericht steht in deren Meldung). Es bleibt nichts in der Datenbank zurück.
-- Nur in der SANDBOX ausführen (SQL-Editor oder Notebook). NIE in Production.
do $wtest$
declare
  r text[] := '{}';
  u1 uuid; u2 uuid; u3 uuid;
  n int; n2 int; ua_before int; ua_after int;
  ok boolean;
  rows1 jsonb; rows2 jsonb;
  msg text;
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='winter_awards') then
    raise exception 'ABBRUCH: winter_awards existiert bereits in dieser Datenbank – Test nur gegen eine Datenbank ohne die Migration';
  end if;
  select id into u1 from public.profiles order by id limit 1 offset 0;
  select id into u2 from public.profiles order by id limit 1 offset 1;
  select id into u3 from public.profiles order by id limit 1 offset 2;
  select count(*) into ua_before from public.user_awards;

  -- ===== Migration (unverändert aus supabase/winter_awards.sql), zweimal ausführbar =====
-- Winter-Auszeichnungen („Hinrunde 2026/27“) für den Pokalschrank.
-- VORBEREITET, NICHT in Production ausgeführt – nur nach ausdrücklicher Freigabe.
-- Idempotent (mehrfach ausführbar). Nur die Tabelle/Funktion werden angelegt; bestehende Tabellen (user_awards, …) bleiben unberührt.
--
-- Zugriff: RLS ist aktiv, es gibt bewusst KEINE Policy für anon/authenticated – gelesen und geschrieben wird ausschließlich
-- serverseitig mit dem Service-Role-Client (lib/recap/winterAwardsStore.ts). Die Sichtbarkeit steuert der Winter-Recap-Schalter
-- app_settings.recap_published_hinrunde (Zurückziehen blendet die Pokale aus, ohne Zeilen zu löschen).

create table if not exists public.winter_awards (
  id bigserial primary key,
  season text not null,
  recap_key text not null,
  award_key text not null check (award_key in ('wildi_magnet','hall_der_ehre','hall_der_schande','gegenwetten','senkrechtstarter','aussenseiter_jaeger','kombi_pech','quotenfluesterer')),
  user_id uuid not null references public.profiles(id) on delete cascade,
  award_title text not null,
  award_icon text not null,
  award_description text not null,
  value_text text,
  created_at timestamptz not null default now(),
  unique (season, recap_key, award_key, user_id)
);

create index if not exists winter_awards_user_idx on public.winter_awards (user_id, season, recap_key);

alter table public.winter_awards enable row level security;
revoke all on public.winter_awards from anon, authenticated;
revoke all on sequence public.winter_awards_id_seq from anon, authenticated;

-- Ersetzt ALLE Winter-Auszeichnungen einer Saison/eines Recaps in EINER Transaktion (löschen + einfügen):
-- wiederholtes Veröffentlichen erzeugt nie Duplikate, ein Fehler lässt den alten Stand unverändert.
create or replace function public.replace_winter_awards(p_season text, p_recap text, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare n integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;
  delete from public.winter_awards where season = p_season and recap_key = p_recap;
  insert into public.winter_awards (season, recap_key, award_key, user_id, award_title, award_icon, award_description, value_text)
  select p_season, p_recap, r.award_key, r.user_id, r.award_title, r.award_icon, r.award_description, r.value_text
  from jsonb_to_recordset(p_rows) as r(award_key text, user_id uuid, award_title text, award_icon text, award_description text, value_text text)
  on conflict (season, recap_key, award_key, user_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.replace_winter_awards(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_winter_awards(text, text, jsonb) to service_role;

  -- ===== Migration noch einmal ausführen (Idempotenz) =====
  create table if not exists public.winter_awards (id bigserial primary key);
  r := array_append(r, ('OK  Migration läuft (Tabelle/Funktion angelegt; erneutes create-if-not-exists fehlerfrei)')::text);

  rows1 := jsonb_build_array(
    jsonb_build_object('award_key','hall_der_ehre','user_id',u1,'award_title','Hall der Ehre','award_icon','x','award_description','d','value_text','14'),
    jsonb_build_object('award_key','hall_der_ehre','user_id',u2,'award_title','Hall der Ehre','award_icon','x','award_description','d','value_text','14'),
    jsonb_build_object('award_key','wildi_magnet','user_id',u3,'award_title','Wildi-Magnet','award_icon','x','award_description','d','value_text','+1'));

  -- ===== als service_role (so schreibt die App serverseitig) =====
  set local role service_role;
  select public.replace_winter_awards('26/27','hinrunde', rows1) into n;
  select count(*) into n2 from public.winter_awards;
  r := array_append(r, (case when n = 3 and n2 = 3 then 'OK  service_role: Veröffentlichen schreibt 3 Zeilen (Gleichstand = 2 Gewinner)' else 'FAIL service_role: erwartet 3, erhalten '||n||'/'||n2 end)::text);
  select public.replace_winter_awards('26/27','hinrunde', rows1) into n;
  select count(*) into n2 from public.winter_awards;
  r := array_append(r, (case when n = 3 and n2 = 3 then 'OK  doppelte Veröffentlichung: weiterhin genau 3 Zeilen (keine Duplikate)' else 'FAIL doppelte Veröffentlichung: '||n||'/'||n2 end)::text);
  rows2 := jsonb_build_array(jsonb_build_object('award_key','kombi_pech','user_id',u1,'award_title','Kombi-Pech','award_icon','x','award_description','d','value_text','9'));
  select public.replace_winter_awards('26/27','hinrunde', rows2) into n;
  select count(*) into n2 from public.winter_awards;
  r := array_append(r, (case when n = 1 and n2 = 1 then 'OK  erneutes Veröffentlichen ersetzt den alten Stand (1 Zeile)' else 'FAIL Ersetzen: '||n||'/'||n2 end)::text);
  -- Fehlerfall: ungültiger award_key → Exception, alter Stand bleibt
  begin
    perform public.replace_winter_awards('26/27','hinrunde', jsonb_build_array(jsonb_build_object('award_key','unbekannt','user_id',u1,'award_title','t','award_icon','i','award_description','d')));
    ok := false;
  exception when others then ok := true; end;
  select count(*) into n2 from public.winter_awards;
  r := array_append(r, (case when ok and n2 = 1 then 'OK  ungültiger award_key wird abgelehnt, alter Stand bleibt unverändert' else 'FAIL Fehlerfall' end)::text);
  -- Rückgabe/Lesen als service_role (RLS-Bypass der Service-Rolle)
  select count(*) into n2 from public.winter_awards where user_id = u1;
  r := array_append(r, (case when n2 = 1 then 'OK  service_role kann lesen (Sichtbarkeit wird serverseitig über den Freigabeschalter gesteuert)' else 'FAIL service_role lesen' end)::text);
  reset role;

  -- ===== als anon / authenticated (Browser-Clients): kein Zugriff =====
  foreach msg in array array['anon','authenticated'] loop
    execute format('set local role %I', msg);
    begin perform count(*) from public.winter_awards; ok := false; exception when insufficient_privilege then ok := true; end;
    r := array_append(r, (case when ok then 'OK  '||msg||': kein Lesezugriff auf winter_awards' else 'FAIL '||msg||' kann lesen!' end)::text);
    begin insert into public.winter_awards (season,recap_key,award_key,user_id,award_title,award_icon,award_description) values ('26/27','hinrunde','wildi_magnet',u1,'t','i','d'); ok := false; exception when insufficient_privilege then ok := true; end;
    r := array_append(r, (case when ok then 'OK  '||msg||': kein Schreibzugriff' else 'FAIL '||msg||' kann schreiben!' end)::text);
    begin perform public.replace_winter_awards('26/27','hinrunde','[]'::jsonb); ok := false; exception when insufficient_privilege then ok := true; end;
    r := array_append(r, (case when ok then 'OK  '||msg||': darf replace_winter_awards nicht ausführen' else 'FAIL '||msg||' darf die Funktion ausführen!' end)::text);
    reset role;
  end loop;

  -- ===== RLS als zweite Sicherung: selbst bei (fälschlich) vergebenem SELECT sehen Browser-Rollen nichts =====
  grant select on public.winter_awards to authenticated;
  set local role authenticated;
  select count(*) into n2 from public.winter_awards;
  reset role;
  revoke select on public.winter_awards from authenticated;
  r := array_append(r, (case when n2 = 0 then 'OK  RLS aktiv: ohne Policy liefert selbst ein vergebenes SELECT 0 Zeilen' else 'FAIL RLS: '||n2||' Zeilen sichtbar' end)::text);

  -- ===== Freigabeschalter: Zurückziehen löscht die Pokale nicht, Wiederveröffentlichen ersetzt sie =====
  insert into public.app_settings (key, value) values ('recap_published_hinrunde','true') on conflict (key) do update set value = 'true';
  delete from public.app_settings where key = 'recap_published_hinrunde';   -- Zurückziehen
  select count(*) into n2 from public.winter_awards;
  r := array_append(r, (case when n2 = 1 then 'OK  Zurückziehen (Schalter entfernt) lässt die gespeicherten Zeilen unangetastet – App blendet sie über den Schalter aus' else 'FAIL Zurückziehen' end)::text);
  set local role service_role;
  select public.replace_winter_awards('26/27','hinrunde', rows1) into n;
  reset role;
  select count(*) into n2 from public.winter_awards;
  r := array_append(r, (case when n2 = 3 then 'OK  erneutes Veröffentlichen nach Zurückziehen: 3 Zeilen, keine Duplikate' else 'FAIL Wiederveröffentlichen: '||n2 end)::text);

  -- ===== Fremdschlüssel / bestehende Pokale =====
  begin insert into public.winter_awards (season,recap_key,award_key,user_id,award_title,award_icon,award_description) values ('26/27','hinrunde','wildi_magnet','00000000-0000-0000-0000-00000000dead','t','i','d'); ok := false; exception when foreign_key_violation then ok := true; end;
  r := array_append(r, (case when ok then 'OK  Fremdschlüssel auf profiles erzwungen' else 'FAIL Fremdschlüssel' end)::text);
  select count(*) into ua_after from public.user_awards;
  r := array_append(r, (case when ua_before = ua_after then 'OK  Spieltags-Pokale (user_awards) unverändert: '||ua_after else 'FAIL user_awards verändert' end)::text);

  raise exception E'WINTER_AWARDS_SANDBOX_TEST (alles zurückgerollt)\n%', array_to_string(r, E'\n');
end
$wtest$;
