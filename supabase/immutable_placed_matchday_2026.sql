-- Immutable placement round; deploy this transaction BEFORE the matching app release.
BEGIN;
ALTER TABLE public.bets ADD COLUMN IF NOT EXISTS placed_matchday integer;
ALTER TABLE public.combo_bets ADD COLUMN IF NOT EXISTS placed_matchday integer;
-- Single source of truth for the historical owner rule. Used by the one-time backfill below AND (as safety net)
-- by the BEFORE INSERT trigger, so no insertion path (including a rolled-back legacy RPC) can ever store NULL.
-- Rule: Special -> its own matchday; cup/test -> raw matchday; season 26/27 -> latest betting_open_md_N <= created_at;
-- fallback -> tippspiel_matchday, then raw BFV matchday.
CREATE OR REPLACE FUNCTION public.derive_placed_matchday(p_match_id integer, p_market text, p_special_id integer, p_season text, p_created timestamptz)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $fn$
  SELECT COALESCE(
    (SELECT s.matchday FROM public.matchday_specials s WHERE p_market = 'matchday_special' AND s.id = p_special_id),
    (SELECT CASE WHEN m.matchday = 999 OR m.competition_type = 'cup' THEN m.matchday END FROM public.matches m WHERE m.id = p_match_id),
    (CASE WHEN p_season = '26/27' THEN
      (SELECT o.md FROM (
         SELECT (regexp_match(key, '^betting_open_md_([0-9]+)$'))[1]::integer AS md, value::timestamptz AS opens_at
         FROM public.app_settings WHERE key ~ '^betting_open_md_[0-9]+$') o
       WHERE o.opens_at <= COALESCE(p_created, now()) ORDER BY o.opens_at DESC LIMIT 1)
     END),
    (SELECT m.tippspiel_matchday FROM public.matches m WHERE m.id = p_match_id),
    (SELECT m.matchday FROM public.matches m WHERE m.id = p_match_id))
$fn$;
REVOKE ALL ON FUNCTION public.derive_placed_matchday(integer,text,integer,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.derive_placed_matchday(integer,text,integer,text,timestamptz) TO service_role;

UPDATE public.bets AS b
SET placed_matchday = public.derive_placed_matchday(b.match_id, b.market_type, b.special_id, b.season, b.created_at)
WHERE b.placed_matchday IS NULL;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bets WHERE placed_matchday IS NULL) THEN
    RAISE EXCEPTION 'Missing origin matchday on bet';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bets WHERE combo_id IS NOT NULL
    GROUP BY combo_id HAVING count(distinct placed_matchday)<>1
  ) THEN
    RAISE EXCEPTION 'Legacy combo spans multiple origin matchdays: review manually';
  END IF;
END $guard$;
UPDATE public.combo_bets AS cb SET placed_matchday=t.md
FROM (SELECT combo_id, min(placed_matchday) AS md FROM public.bets
      WHERE combo_id IS NOT NULL GROUP BY combo_id) t
WHERE cb.id=t.combo_id AND cb.placed_matchday IS NULL;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.combo_bets WHERE placed_matchday IS NULL) THEN
    RAISE EXCEPTION 'Missing combo origin matchday';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bets b JOIN public.combo_bets cb ON cb.id=b.combo_id
    WHERE b.placed_matchday IS DISTINCT FROM cb.placed_matchday
  ) THEN
    RAISE EXCEPTION 'Bet/parent origin mismatch';
  END IF;
END $guard$;
-- bets: from now on a missing owner is impossible (trigger below fills it, NOT NULL enforces it).
ALTER TABLE public.bets ALTER COLUMN placed_matchday SET NOT NULL;
CREATE OR REPLACE FUNCTION public.trg_bets_fill_placed_matchday() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $t$
BEGIN
  IF NEW.placed_matchday IS NULL THEN
    NEW.placed_matchday := public.derive_placed_matchday(NEW.match_id, NEW.market_type, NEW.special_id, NEW.season, COALESCE(NEW.created_at, now()));
  END IF;
  RETURN NEW;
END $t$;
DROP TRIGGER IF EXISTS bets_fill_placed_matchday ON public.bets;
CREATE TRIGGER bets_fill_placed_matchday BEFORE INSERT ON public.bets FOR EACH ROW EXECUTE FUNCTION public.trg_bets_fill_placed_matchday();
-- combo_bets: the legs are inserted after the parent; the first leg fills a still-missing parent owner (legacy RPC path).
CREATE OR REPLACE FUNCTION public.trg_bets_fill_combo_placed_matchday() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $t$
BEGIN
  UPDATE public.combo_bets SET placed_matchday = NEW.placed_matchday WHERE id = NEW.combo_id AND placed_matchday IS NULL;
  RETURN NEW;
END $t$;
DROP TRIGGER IF EXISTS bets_fill_combo_placed_matchday ON public.bets;
CREATE TRIGGER bets_fill_combo_placed_matchday AFTER INSERT ON public.bets FOR EACH ROW WHEN (NEW.combo_id IS NOT NULL) EXECUTE FUNCTION public.trg_bets_fill_combo_placed_matchday();
-- placed_matchday numbers restart every season: every owner lookup MUST include the season (indexes mirror that).
CREATE INDEX IF NOT EXISTS idx_bets_owner_origin_active ON public.bets (user_id, season, placed_matchday, status);
CREATE INDEX IF NOT EXISTS idx_bets_season_origin ON public.bets (season, placed_matchday, status);
CREATE INDEX IF NOT EXISTS idx_combo_bets_owner_origin ON public.combo_bets (user_id, season, placed_matchday, status);
CREATE OR REPLACE FUNCTION public.finalize_bet_placement(p_user_id uuid, p_lock_checks jsonb, p_combo_row jsonb, p_bet_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_check jsonb;
  v_matchday int;
  v_match_ids int[];
  v_expected int;
  v_actual int;
  v_combo_id int;
  v_season text;
begin
  -- placed_matchday restarts every season, so the origin-mode slot count MUST be season-scoped (found in review).
  v_season := coalesce(nullif(p_combo_row->>'season', ''), nullif(p_bet_rows->0->>'season', ''));
  for v_check in
    select value from jsonb_array_elements(p_lock_checks) order by (value->>'matchday')::int
  loop
    v_matchday := (v_check->>'matchday')::int;
    select array_agg((elem)::int) into v_match_ids
    from jsonb_array_elements_text(v_check->'match_ids') as elem;
    v_expected := (v_check->>'expected_count')::int;

    perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || v_matchday::text));

    if coalesce(v_check->>'origin_mode', 'false') = 'true' then
      if v_season is null then raise exception 'SEASON_MISSING' using errcode = 'P0001'; end if;
      select
        (select count(*) from public.bets b
          where b.user_id = p_user_id and b.combo_id is null and not b.is_bonus
            and b.status in ('pending', 'won', 'lost') and b.season = v_season and b.placed_matchday = v_matchday)
        +
        (select count(distinct cb.id) from public.combo_bets cb
          join public.bets b on b.combo_id = cb.id
          where cb.user_id = p_user_id and cb.status in ('pending', 'won', 'lost')
            and cb.season = v_season and b.placed_matchday = v_matchday)
      into v_actual;
    else
      -- Previous Production code may still submit during rollout.
      select
        (select count(*) from public.bets b
          where b.user_id = p_user_id and b.combo_id is null and not b.is_bonus
            and b.status in ('pending', 'won', 'lost') and b.match_id = any(v_match_ids))
        +
        (select count(distinct cb.id) from public.combo_bets cb
          join public.bets b on b.combo_id = cb.id
          where cb.user_id = p_user_id and cb.status in ('pending', 'won', 'lost')
            and b.match_id = any(v_match_ids))
      into v_actual;
    end if;

    if v_actual <> v_expected then
      raise exception 'SLOT_COUNT_CHANGED' using errcode = 'P0001';
    end if;
  end loop;

  if p_combo_row is not null then
    insert into public.combo_bets (user_id, stake, total_odds, status, payout, season, placed_matchday)
    values (
      p_user_id,
      (p_combo_row->>'stake')::numeric,
      (p_combo_row->>'total_odds')::numeric,
      p_combo_row->>'status',
      null,
      p_combo_row->>'season',
      coalesce(nullif(p_combo_row->>'placed_matchday', '')::int, (p_lock_checks->0->>'matchday')::int)
    )
    returning id into v_combo_id;
  end if;

  insert into public.bets (
    user_id, match_id, market_type, selection, stake, odds_value, status,
    payout, combo_id, is_risky, is_bonus, season, special_id, placed_matchday
  )
  select
    p_user_id,
    (r->>'match_id')::int,
    r->>'market_type',
    r->>'selection',
    nullif(r->>'stake', '')::numeric,
    (r->>'odds_value')::numeric,
    r->>'status',
    null,
    v_combo_id,
    (r->>'is_risky')::boolean,
    coalesce((r->>'is_bonus')::boolean, false),
    r->>'season',
    nullif(r->>'special_id', '')::int,
    coalesce(nullif(r->>'placed_matchday', '')::int, (p_lock_checks->0->>'matchday')::int)
  from jsonb_array_elements(p_bet_rows) as r;
end;
$function$
;
-- Preserve service-role-only mutation boundary. PUBLIC must never directly call
-- this SECURITY DEFINER function with arbitrary user IDs or stakes.
REVOKE ALL ON FUNCTION public.finalize_bet_placement(uuid,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_bet_placement(uuid,jsonb,jsonb,jsonb) TO service_role;
-- Atomic once-per-round booking (inactivity fee / pocket money): the dedup marker (push_reminders) and ALL balance changes are one
-- transaction. A failing user rolls EVERYTHING back (marker included), so a retry is always safe and a partial batch can never
-- be silently marked as done. Replaces the former "insert marker, then fire N independent RPCs and log failures" sequence.
CREATE OR REPLACE FUNCTION public.book_matchday_round(p_type text, p_season text, p_matchday integer, p_user_ids uuid[], p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
declare
  v_uid uuid;
  v_n integer := 0;
  v_claimed integer;
begin
  if p_type not in ('inactivity_fee', 'pocket_money') then raise exception 'INVALID_TYPE'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_matchday is null or p_matchday <= 0 or p_matchday >= 900 then raise exception 'INVALID_MATCHDAY'; end if;
  if p_season is null or p_season = '' or p_season = 'TEST' then raise exception 'INVALID_SEASON'; end if;
  insert into public.push_reminders (type, matchday, season) values (p_type, p_matchday, p_season)
    on conflict (type, matchday, season) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    return jsonb_build_object('booked', false, 'reason', 'ALREADY_BOOKED', 'users', 0);
  end if;
  for v_uid in select distinct u from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u loop
    if p_type = 'inactivity_fee' then perform public.apply_penalty(v_uid, p_amount);
    else perform public.increment_balance(v_uid, p_amount);
    end if;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('booked', true, 'users', v_n);
end;
$fn$;
REVOKE ALL ON FUNCTION public.book_matchday_round(text,text,integer,uuid[],numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_matchday_round(text,text,integer,uuid[],numeric) TO service_role;

-- ───────────────────────── Atomare Abrechnung / Stornierung (Status + Guthaben in EINER Transaktion) ─────────────────────────
-- Vorher: Status per UPDATE (Compare-and-Set), danach separat increment_balance. Scheiterte die Gutschrift, blieb die Wette
-- "won" ohne Auszahlung und wurde nie wieder angefasst. Jetzt: Zeile sperren, Status prüfen, umstellen UND gutschreiben – oder gar
-- nichts. Rückgabe false = bereits entschieden (idempotent, kein zweites Mal gutschreiben).
CREATE OR REPLACE FUNCTION public.settle_bet(p_bet_id integer, p_status text, p_payout numeric)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
declare v_user uuid; v_combo integer; v_cur text; v_pay numeric;
begin
  if p_status not in ('won', 'lost') then raise exception 'INVALID_STATUS'; end if;
  if p_status = 'won' and (p_payout is null or p_payout < 0) then raise exception 'INVALID_PAYOUT'; end if;
  select user_id, combo_id, status into v_user, v_combo, v_cur from public.bets where id = p_bet_id for update;
  if not found or v_cur <> 'pending' then return false; end if;
  v_pay := case when p_status = 'won' then coalesce(p_payout, 0) else 0 end;
  update public.bets set status = p_status, payout = v_pay where id = p_bet_id;
  -- Combo legs never pay on their own: the combo parent pays (settle_combo).
  if p_status = 'won' and v_combo is null and v_pay > 0 then perform public.increment_balance(v_user, v_pay); end if;
  return true;
end;
$fn$;

CREATE OR REPLACE FUNCTION public.settle_combo(p_combo_id integer, p_status text, p_payout numeric)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
declare v_user uuid; v_cur text; v_pay numeric;
begin
  if p_status not in ('won', 'lost') then raise exception 'INVALID_STATUS'; end if;
  if p_status = 'won' and (p_payout is null or p_payout < 0) then raise exception 'INVALID_PAYOUT'; end if;
  select user_id, status into v_user, v_cur from public.combo_bets where id = p_combo_id for update;
  if not found or v_cur <> 'pending' then return false; end if;
  v_pay := case when p_status = 'won' then coalesce(p_payout, 0) else 0 end;
  update public.combo_bets set status = p_status, payout = v_pay where id = p_combo_id;
  if p_status = 'won' and v_pay > 0 then perform public.increment_balance(v_user, v_pay); end if;
  return true;
end;
$fn$;

-- Storno/Void + Rückerstattung des Einsatzes atomar. Gibt den erstatteten Betrag zurück, NULL wenn nichts (mehr) stornierbar war.
CREATE OR REPLACE FUNCTION public.void_slip_refund(p_kind text, p_id integer, p_reason text, p_user_id uuid DEFAULT NULL, p_all_legs boolean DEFAULT false)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
declare v_user uuid; v_stake numeric; v_cur text; v_combo integer;
begin
  if p_reason not in ('user_cancelled', 'admin_special_voided', 'admin_goalscorer_unavailable') then raise exception 'INVALID_REASON'; end if;
  if p_kind = 'single' then
    select user_id, stake, status, combo_id into v_user, v_stake, v_cur, v_combo from public.bets where id = p_id for update;
    if not found or v_cur <> 'pending' or v_combo is not null then return null; end if;
    if p_user_id is not null and v_user <> p_user_id then return null; end if;
    update public.bets set status = 'void', void_reason = p_reason where id = p_id;
  elsif p_kind = 'combo' then
    select user_id, stake, status into v_user, v_stake, v_cur from public.combo_bets where id = p_id for update;
    if not found or v_cur <> 'pending' then return null; end if;
    if p_user_id is not null and v_user <> p_user_id then return null; end if;
    update public.bets set status = 'void', void_reason = p_reason
      where combo_id = p_id and (case when p_all_legs then status <> 'void' else status in ('pending', 'neutralized') end);
    update public.combo_bets set status = 'void', void_reason = p_reason where id = p_id;
  else
    raise exception 'INVALID_KIND';
  end if;
  if coalesce(v_stake, 0) > 0 then perform public.increment_balance(v_user, v_stake); end if;
  return coalesce(v_stake, 0);
end;
$fn$;

REVOKE ALL ON FUNCTION public.settle_bet(integer,text,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_combo(integer,text,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.void_slip_refund(text,integer,text,uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_bet(integer,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_combo(integer,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.void_slip_refund(text,integer,text,uuid,boolean) TO service_role;
COMMIT;
-- Verification:
-- SELECT placed_matchday, count(*) FROM bets WHERE match_id IN (260,323) GROUP BY 1;
-- SELECT count(*) FROM bets b JOIN combo_bets c ON c.id=b.combo_id
--   WHERE b.placed_matchday IS DISTINCT FROM c.placed_matchday;
