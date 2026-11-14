-- 100 Wildis als Dankeschön für die vollständig abgeschlossene Winterumfrage 2026 (winter_2026_v2).
-- Idempotent (mehrfach ausführbar). Reihenfolge im Release: NACH immutable_placed_matchday_2026.sql, VOR dem App-Deploy.
--
-- Garantien:
--  * genau EINE Belohnung je Nutzer und Umfrageversion: UNIQUE (user_id, kind, ref) im Buchungsjournal
--  * Journal-Eintrag und Guthabenerhöhung in EINER Transaktion: scheitert die Gutschrift, gibt es auch keinen
--    Journal-Eintrag -> erneuter Versuch jederzeit sicher; parallele Aufrufe warten auf den Unique-Index, nur einer bucht
--  * nur die Production-Version 'winter_2026_v2' ist belohnungsfähig (Preview 'winter_2026_v2_preview', V1: nie)
--  * nur ein abgeschickter Datensatz (submitted_at gesetzt); die inhaltliche Vollständigkeit prüft die App vorher mit
--    derselben Validierung wie beim Absenden (lib/surveyValidation.ts#isCompleteForSubmission)
--  * späteres Bearbeiten bucht nie erneut und bucht nie zurück (die Funktion zieht nie etwas ab)
--  * nur service_role darf buchen; Nutzer sehen per RLS ausschließlich ihre eigenen Journal-Zeilen
BEGIN;

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

COMMIT;
-- Kontrolle:
-- SELECT kind, ref, count(*), sum(amount) FROM public.balance_transactions GROUP BY 1,2;
-- Rollback (nur wenn noch KEINE Belohnung gebucht wurde): DROP FUNCTION public.grant_survey_reward(uuid,text); DROP TABLE public.balance_transactions;
