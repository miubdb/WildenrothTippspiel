-- NUR IN DER SANDBOX (aspbgawbqwfntvlqtcvl) ausführen. Endet IMMER mit einem Fehler "SURVEY_REWARD_SANDBOX_TEST (alles zurückgerollt)" –
-- das ist gewollt: der Bericht steht in der Fehlermeldung, nichts bleibt in der Datenbank. Erwartet: 11 Zeilen mit OK, keine FAIL.
do $wtest$
declare r text[] := '{}'; n int; bal numeric; u1 uuid; u2 uuid; ok boolean; j jsonb;
begin
CREATE TABLE IF NOT EXISTS public.balance_transactions (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('survey_reward')),
  ref text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT balance_transactions_once UNIQUE (user_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS balance_transactions_user_idx ON public.balance_transactions (user_id, created_at DESC);

ALTER TABLE public.balance_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.balance_transactions FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.balance_transactions_id_seq FROM anon, authenticated;
GRANT SELECT ON public.balance_transactions TO authenticated;
DROP POLICY IF EXISTS balance_transactions_select_own ON public.balance_transactions;
CREATE POLICY balance_transactions_select_own ON public.balance_transactions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.grant_survey_reward(p_user_id uuid, p_survey_version text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
declare
  v_amount constant numeric := 100;
  v_id bigint;
begin
  if p_user_id is null then raise exception 'USER_MISSING'; end if;
  if p_survey_version is distinct from 'winter_2026_v2' then raise exception 'SURVEY_VERSION_NOT_REWARDED'; end if;
  if not exists (
    select 1 from public.survey_responses
    where user_id = p_user_id and survey_version = p_survey_version and submitted_at is not null
  ) then
    return jsonb_build_object('granted', false, 'reason', 'NOT_SUBMITTED', 'amount', 0);
  end if;
  insert into public.balance_transactions (user_id, kind, ref, amount, description)
  values (p_user_id, 'survey_reward', p_survey_version, v_amount, 'Dankeschön für die Winterumfrage 2026')
  on conflict on constraint balance_transactions_once do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('granted', false, 'reason', 'ALREADY_GRANTED', 'amount', v_amount);
  end if;
  perform public.increment_balance(p_user_id, v_amount);
  return jsonb_build_object('granted', true, 'reason', 'GRANTED', 'amount', v_amount, 'transaction_id', v_id);
end;
$fn$;
REVOKE ALL ON FUNCTION public.grant_survey_reward(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_survey_reward(uuid, text) TO service_role;

  if exists (select 1 from public.balance_transactions) then raise exception 'ABBRUCH: Journal nicht leer'; end if;
  select id into u1 from public.profiles order by id limit 1;
  select id into u2 from public.profiles order by id limit 1 offset 1;
  update public.profiles set balance = 1000 where id in (u1,u2);
  insert into public.survey_responses (user_id, survey_version, answers, started_at, submitted_at, updated_at) values
    (u1,'winter_2026_v2','{}'::jsonb, now(), now(), now()), (u2,'winter_2026_v2','{}'::jsonb, now(), null, now()), (u2,'winter_2026_v2_preview','{}'::jsonb, now(), now(), now())
    on conflict (user_id, survey_version) do update set submitted_at = excluded.submitted_at;
  j := public.grant_survey_reward(u1,'winter_2026_v2'); select balance into bal from public.profiles where id=u1;
  r := array_append(r, case when (j->>'granted')::boolean and bal=1100 then 'OK  erste Belohnung +100' else 'FAIL erste '||j::text||'/'||bal end);
  j := public.grant_survey_reward(u1,'winter_2026_v2'); select balance into bal from public.profiles where id=u1;
  r := array_append(r, case when j->>'reason'='ALREADY_GRANTED' and bal=1100 then 'OK  Wiederholung: keine zweite Belohnung' else 'FAIL Wiederholung '||j::text end);
  j := public.grant_survey_reward(u2,'winter_2026_v2');
  r := array_append(r, case when j->>'reason'='NOT_SUBMITTED' then 'OK  Entwurf: keine Belohnung' else 'FAIL Entwurf '||j::text end);
  begin perform public.grant_survey_reward(u2,'winter_2026_v2_preview'); ok := false; exception when others then ok := true; end;
  r := array_append(r, case when ok then 'OK  Preview-Version abgewiesen' else 'FAIL Preview gebucht' end);
  update public.survey_responses set submitted_at = now() where user_id=u2 and survey_version='winter_2026_v2';
  execute 'create function public.zz_fail_u2() returns trigger language plpgsql as $f$ begin if new.id = ' || quote_literal(u2::text) || '::uuid then raise exception ''credit boom''; end if; return new; end $f$';
  create trigger t_zz_fail before update on public.profiles for each row execute function public.zz_fail_u2();
  begin perform public.grant_survey_reward(u2,'winter_2026_v2'); ok := false; exception when others then ok := true; end;
  select count(*) into n from public.balance_transactions where user_id=u2; select balance into bal from public.profiles where id=u2;
  r := array_append(r, case when ok and n=0 and bal=1000 then 'OK  Gutschrift scheitert: kein Journal, kein Guthaben' else 'FAIL Teilzustand '||n||'/'||bal end);
  drop trigger t_zz_fail on public.profiles;
  j := public.grant_survey_reward(u2,'winter_2026_v2'); select balance into bal from public.profiles where id=u2;
  r := array_append(r, case when (j->>'granted')::boolean and bal=1100 then 'OK  Retry: genau einmal +100' else 'FAIL Retry '||bal end);
  select count(*) into n from public.balance_transactions;
  r := array_append(r, case when n=2 then 'OK  Journal: 2 Zeilen' else 'FAIL Journal '||n end);
  r := array_append(r, case when not has_function_privilege('anon','public.grant_survey_reward(uuid,text)','EXECUTE') and not has_function_privilege('authenticated','public.grant_survey_reward(uuid,text)','EXECUTE') and has_function_privilege('service_role','public.grant_survey_reward(uuid,text)','EXECUTE') then 'OK  RPC nur service_role' else 'FAIL RPC-Rechte' end);
  r := array_append(r, case when not has_table_privilege('anon','public.balance_transactions','SELECT') and not has_table_privilege('authenticated','public.balance_transactions','INSERT') and not has_table_privilege('authenticated','public.balance_transactions','UPDATE') and has_table_privilege('authenticated','public.balance_transactions','SELECT') then 'OK  Tabellenrechte: authenticated nur SELECT, anon nichts' else 'FAIL Tabellenrechte' end);
  select count(*) into n from pg_policies where tablename='balance_transactions' and cmd='SELECT' and qual like '%auth.uid()%';
  r := array_append(r, case when n=1 and (select relrowsecurity from pg_class where oid='public.balance_transactions'::regclass) then 'OK  RLS aktiv, Policy nur eigene Zeilen' else 'FAIL RLS' end);
  perform set_config('request.jwt.claim.sub', u1::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u1::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.balance_transactions;
  reset role;
  r := array_append(r, case when n=1 then 'OK  RLS-Probe: Nutzer sieht nur seine 1 Zeile' else 'FAIL RLS-Probe '||n end);
  raise exception E'SURVEY_REWARD_SANDBOX_TEST (alles zurückgerollt)\n%', array_to_string(r, E'\n');
end
$wtest$;