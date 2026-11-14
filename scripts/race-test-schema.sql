-- Produktionsnaher Schema-Auszug für lokale Race-Tests (identisch mit scripts/placed-matchday-migration-test.mjs)

create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; grant usage on schema auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
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
create table public.survey_responses (user_id uuid not null references public.profiles(id), survey_version text not null, answers jsonb not null default '{}', submitted_at timestamptz, primary key (user_id, survey_version));
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
