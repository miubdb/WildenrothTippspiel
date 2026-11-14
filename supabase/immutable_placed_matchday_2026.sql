-- Immutable placement Spieltag (2026/27); safe to run BEFORE new application deploy.
-- Legacy rows get a snapshot from the actual betting-open interval at the time
-- of placement, NOT today's BFV fixture date. This reproduces historic
-- make-up rounds ST7/ST13/ST14 and today's postponed ST16 matches 260/323.
BEGIN;
ALTER TABLE public.bets ADD COLUMN IF NOT EXISTS placed_matchday integer;
ALTER TABLE public.combo_bets ADD COLUMN IF NOT EXISTS placed_matchday integer;
ALTER TABLE public.bets ADD COLUMN IF NOT EXISTS placed_kickoff_at timestamptz;

WITH opens AS (
  SELECT (regexp_match(key, '^betting_open_md_([0-9]+)$'))[1]::integer AS md,
         value::timestamptz AS opens_at
  FROM public.app_settings
  WHERE key ~ '^betting_open_md_[0-9]+$'
)
UPDATE public.bets AS b
SET placed_matchday = COALESCE(
  (SELECT s.matchday FROM public.matchday_specials s WHERE b.market_type='matchday_special' AND s.id=b.special_id),
  (CASE WHEN m.matchday=999 OR m.competition_type='cup' THEN m.matchday END),
  (CASE WHEN b.season='26/27' THEN
    (SELECT o.md FROM opens o WHERE o.opens_at <= b.created_at ORDER BY o.opens_at DESC LIMIT 1)
   END),
  m.tippspiel_matchday,
  m.matchday
)
FROM public.matches m
WHERE m.id=b.match_id AND b.placed_matchday IS NULL;

-- Freeze the kickoff as it was when placed (the November date for #260/#323).
-- Earlier reschedules without archived kickoff history fall back to the current
-- recorded kickoff; they must never be silently labeled "verified original".
UPDATE public.bets AS b
SET placed_kickoff_at =
  CASE WHEN b.match_id IN (260, 323) AND b.season='26/27'
    THEN TIMESTAMP '2026-11-15 13:00:00' AT TIME ZONE 'Europe/Berlin'
    ELSE m.match_date END
FROM public.matches m WHERE m.id=b.match_id AND b.placed_kickoff_at IS NULL;

-- Never guess a combo's owner when history is internally inconsistent.
DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.bets b WHERE b.combo_id IS NOT NULL
    GROUP BY b.combo_id HAVING count(DISTINCT b.placed_matchday)<>1
  ) THEN
    RAISE EXCEPTION 'Mixed placement-matchday combo: manual review required';
  END IF;
END $guard$;
UPDATE public.combo_bets cb
SET placed_matchday = t.md
FROM (
  SELECT b.combo_id, min(b.placed_matchday) AS md FROM public.bets b
  WHERE b.combo_id IS NOT NULL GROUP BY b.combo_id
) t
WHERE cb.id=t.combo_id AND cb.placed_matchday IS NULL;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bets WHERE placed_matchday IS NULL)
     OR EXISTS (SELECT 1 FROM public.combo_bets WHERE placed_matchday IS NULL)
  THEN RAISE EXCEPTION 'Incomplete immutable-matchday backfill'; END IF;
  IF EXISTS (
     SELECT 1 FROM public.bets b JOIN public.combo_bets cb ON cb.id=b.combo_id
     WHERE b.placed_matchday IS DISTINCT FROM cb.placed_matchday
  ) THEN RAISE EXCEPTION 'Combo/leg matchday mismatch after backfill'; END IF;
END $guard$;

CREATE INDEX IF NOT EXISTS bets_placed_md_owner_idx
  ON public.bets (user_id, placed_matchday, status);
CREATE INDEX IF NOT EXISTS bets_placed_md_season_idx
  ON public.bets (season, placed_matchday, status);
CREATE INDEX IF NOT EXISTS combo_bets_placed_md_owner_idx
  ON public.combo_bets (user_id, placed_matchday, status);

-- Retain the original advisory-lock ordering and the legacy request protocol.
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
begin
  for v_check in
    select value from jsonb_array_elements(p_lock_checks) order by (value->>'matchday')::int
  loop
    v_matchday := (v_check->>'matchday')::int;
    select array_agg((elem)::int) into v_match_ids
    from jsonb_array_elements_text(v_check->'match_ids') as elem;
    v_expected := (v_check->>'expected_count')::int;

    perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || v_matchday::text));

    if coalesce(v_check->>'origin_mode', 'false') = 'true' then
      -- New immutable-owner gate. Ignore kickoff-date reassignment entirely.
      select
        (select count(*) from public.bets b
          where b.user_id = p_user_id and b.combo_id is null and not b.is_bonus
            and b.status in ('pending', 'won', 'lost') and b.placed_matchday = v_matchday)
        +
        (select count(*) from public.combo_bets cb
          where cb.user_id = p_user_id and cb.status in ('pending', 'won', 'lost')
            and cb.placed_matchday = v_matchday)
      into v_actual;
    else
      -- Backward-compatible gate for requests from the previous Production build
      -- while the new code is rolling out.
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
      nullif(p_combo_row->>'placed_matchday', '')::int
    )
    returning id into v_combo_id;
  end if;

  insert into public.bets (
    user_id, match_id, market_type, selection, stake, odds_value, status,
    payout, combo_id, is_risky, is_bonus, season, special_id, placed_matchday, placed_kickoff_at
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
    nullif(r->>'placed_matchday', '')::int,
    nullif(r->>'placed_kickoff_at', '')::timestamptz
  from jsonb_array_elements(p_bet_rows) as r;
end;
$function$;

COMMIT;

-- Post-migration checks (read-only):
-- SELECT placed_matchday, count(*) FROM public.bets WHERE match_id IN(260,323) GROUP BY 1;
-- SELECT count(*) FROM public.bets b JOIN public.combo_bets c ON c.id=b.combo_id
--   WHERE b.placed_matchday IS DISTINCT FROM c.placed_matchday;
