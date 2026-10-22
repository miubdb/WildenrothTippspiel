-- Wildenroth-Tippspiel – Nichtantritt: strukturierte Admin-Auswahl + offizielle Tabellenwertung
--
-- STATUS: vorbereitet, in dieser Umgebung NICHT ausgeführt — nur lesender Supabase-Zugriff
-- (Produktionsprojekt mpyqtymkdhxuannqhtvp), kein Zugriff auf die Sandbox aspbgawbqwfntvlqtcvl.
-- Siehe supabase/SANDBOX_MIGRATION_RUNBOOK.md für den Testablauf — zuerst Sandbox, dann
-- Production, exakt wie bei supabase/match_annulment.sql (bereits live).
--
-- Ergänzt die bereits produktiv laufende Annullierungs-Funktion um zwei fachlich getrennte
-- Dinge, siehe docs/spielannullierung-regelwerk.md Abschnitt "Offizielle BFV-Wertung vs.
-- Wettneutralisierung":
--   1. Strukturierte Admin-Auswahl beim Annullieren (away_no_show / home_no_show / other)
--      statt nur Freitext — gespeichert in der neuen Spalte `matches.annulment_type`.
--   2. Eine SEPARATE, später (erst nach bestätigter BFV-Entscheidung) nachtragbare offizielle
--      Wertung für die Fußballtabelle — `matches.annulment_official_home_score`,
--      `annulment_official_away_score`, `annulment_official_confirmed_at`. Diese drei Spalten
--      werden von KEINEM bestehenden Code-Pfad gelesen außer den neuen, eigens dafür
--      geschriebenen Stellen (lib/matchAnnulment.ts#resultForStandings und die vier
--      Tabellen-Seiten) — das Quotenmodell (lib/odds.ts), settleBet(), die Torschützen-Logik
--      und settleActiveMatchdaySpecials lesen ausschließlich `home_score`/`away_score` und
--      verlangen zusätzlich `status = 'finished'`; ein annulliertes Spiel bleibt `status =
--      'annulled'` und `home_score`/`away_score` bleiben wie bisher NULL — für all diese
--      bestehenden Pfade ist die neue offizielle Wertung also strukturell unsichtbar, nicht
--      nur "ungenutzt".
--
-- Nichts hier verändert eine bestehende Zeile — nur neue, nullable Spalten und eine erweiterte
-- Funktionssignatur (alter 3-Parameter-Aufruf bleibt über den DEFAULT-Wert kompatibel, siehe
-- unten; die App-Seite ruft ab diesem Deploy ohnehin immer mit 4 Parametern auf).

begin;

-- ───────────────────── 1. Strukturierte Admin-Auswahl ─────────────────────
alter table public.matches add column if not exists annulment_type text;
alter table public.matches add constraint matches_annulment_type_check
  check (annulment_type = any (array['away_no_show', 'home_no_show', 'other']));

comment on column public.matches.annulment_type is 'Bewusste Admin-Auswahl beim Annullieren (nie vorausgewählt, siehe components/admin/MatchAnnulmentPanel.tsx) — away_no_show/home_no_show lösen den Quoten-1,00-Vorschlag 2:0/0:2 aus (§ 29 BFV-Spielordnung 2026), "other" nie. Rein dokumentarisch/für die spätere offizielle Wertung — hat KEINEN Einfluss auf die Wettneutralisierung selbst, die unverändert jede betroffene Auswahl neutralisiert, unabhängig vom Grund.';

-- ───────────────────── 2. Offizielle, separat bestätigte Tabellenwertung ─────────────────────
alter table public.matches add column if not exists annulment_official_home_score int;
alter table public.matches add column if not exists annulment_official_away_score int;
alter table public.matches add column if not exists annulment_official_confirmed_at timestamptz;

alter table public.matches add constraint matches_annulment_official_scores_check
  check (
    (annulment_official_home_score is null and annulment_official_away_score is null)
    or (annulment_official_home_score >= 0 and annulment_official_away_score >= 0)
  );
-- Beide Score-Spalten und confirmed_at müssen gemeinsam gesetzt oder gemeinsam NULL sein — keine
-- Zwischenzustände wie "Score gesetzt, aber nicht bestätigt" oder "bestätigt, aber kein Score".
alter table public.matches add constraint matches_annulment_official_confirmation_check
  check (
    (annulment_official_home_score is null and annulment_official_away_score is null and annulment_official_confirmed_at is null)
    or (annulment_official_home_score is not null and annulment_official_away_score is not null and annulment_official_confirmed_at is not null)
  );

comment on column public.matches.annulment_official_home_score is 'Offizielle, vom BFV bestätigte Wertung für die Fußballtabelle — NIEMALS home_score, NIEMALS für Wettabrechnung/Quotenmodell/Torschützen/Specials gelesen (siehe Modulkommentar oben). NULL, solange die BFV-Entscheidung aussteht (bewusst offen, siehe docs/spielannullierung-regelwerk.md).';
comment on column public.matches.annulment_official_confirmed_at is 'Gesetzt ausschließlich durch confirm_match_annulment_official_score() — erst wenn ein Admin die tatsächlich amtlich bestätigte Wertung einträgt, nie automatisch beim Annullieren selbst.';

-- ───────────────────── 3. neutralize_match: strukturierten Grund mit annullieren ─────────────────────
-- Alte 3-Parameter-Signatur ersetzen (nicht als zweite überladene Funktion stehen lassen) —
-- der 4. Parameter hat einen DEFAULT, ein alter 3-Argumente-Aufruf bliebe also technisch
-- kompatibel, auch wenn die App-Seite ab diesem Deploy ohnehin immer 4 übergibt.
drop function if exists public.neutralize_match(integer, uuid, text);

create or replace function public.neutralize_match(p_match_id int, p_actor_id uuid, p_reason text, p_annulment_type text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_match_status text;
  v_leg record;
  v_combo record;
  v_combo_ids int[] := array[]::int[];
  v_combo_id int;
  v_special record;
  v_affected_singles int := 0;
  v_affected_combo_legs int := 0;
  v_refund_total numeric := 0;
  v_now timestamptz := now();
  v_specials_voided int := 0;
  v_anomalies int := 0;
  v_leg_total int;
  v_lost_count int;
  v_pending_count int;
  v_neutral_count int;
  v_is_risky boolean;
  v_remaining_product numeric;
  v_new_odds numeric;
  v_payout numeric;
  v_cap numeric;
begin
  if p_annulment_type is not null and p_annulment_type not in ('away_no_show', 'home_no_show', 'other') then
    raise exception 'INVALID_ANNULMENT_TYPE';
  end if;

  perform pg_advisory_xact_lock(hashtext('match_annulment:' || p_match_id::text));

  select status into v_match_status from matches where id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;

  if v_match_status = 'annulled' then
    return jsonb_build_object(
      'alreadyAnnulled', true, 'affectedSingles', 0, 'affectedComboLegs', 0,
      'affectedCombos', 0, 'refundTotal', 0, 'specialsVoided', 0, 'anomalies', 0
    );
  end if;

  if v_match_status = 'finished' then
    raise exception 'MATCH_ALREADY_FINISHED';
  end if;

  -- Schritt 1: jede noch offene Auswahl direkt auf diesem Spiel neutralisieren.
  for v_leg in
    update bets set status = 'neutralized', neutralized_at = v_now, neutralized_reason = 'match_annulled'
    where match_id = p_match_id and status = 'pending' and market_type <> 'matchday_special'
    returning id, user_id, combo_id, stake, odds_value
  loop
    if v_leg.combo_id is null then
      v_affected_singles := v_affected_singles + 1;
      v_refund_total := v_refund_total + v_leg.stake;
      perform increment_balance(v_leg.user_id, v_leg.stake);
    else
      v_affected_combo_legs := v_affected_combo_legs + 1;
      if not (v_leg.combo_id = any(v_combo_ids)) then
        v_combo_ids := array_append(v_combo_ids, v_leg.combo_id);
      end if;
    end if;
  end loop;

  -- Schritt 2: jedes AKTIVE Spieltag-Special, das dieses Spiel in included_match_ids trägt.
  for v_special in
    select id from matchday_specials where status = 'active' and p_match_id = any(included_match_ids)
  loop
    for v_leg in
      update bets set status = 'neutralized', neutralized_at = v_now, neutralized_reason = 'special_voided'
      where special_id = v_special.id and status = 'pending'
      returning id, user_id, combo_id, stake, odds_value
    loop
      if v_leg.combo_id is null then
        v_affected_singles := v_affected_singles + 1;
        v_refund_total := v_refund_total + v_leg.stake;
        perform increment_balance(v_leg.user_id, v_leg.stake);
      else
        v_affected_combo_legs := v_affected_combo_legs + 1;
        if not (v_leg.combo_id = any(v_combo_ids)) then
          v_combo_ids := array_append(v_combo_ids, v_leg.combo_id);
        end if;
      end if;
    end loop;

    update matchday_specials set status = 'void' where id = v_special.id;
    v_specials_voided := v_specials_voided + 1;
  end loop;

  -- Schritt 3: jede in diesem Aufruf berührte Kombi, deren EIGENER Status noch 'pending' war.
  if v_combo_ids is not null then
    foreach v_combo_id in array v_combo_ids
    loop
      select id, user_id, stake, total_odds, status
        into v_combo from combo_bets where id = v_combo_id for update;
      if not found or v_combo.status <> 'pending' then
        continue;
      end if;

      select
        count(*),
        count(*) filter (where status = 'lost'),
        count(*) filter (where status = 'pending'),
        count(*) filter (where status = 'neutralized'),
        bool_or(is_risky)
      into v_leg_total, v_lost_count, v_pending_count, v_neutral_count, v_is_risky
      from bets where combo_id = v_combo_id;

      if v_lost_count > 0 then
        v_anomalies := v_anomalies + 1;
        continue;
      end if;

      v_remaining_product := 1;
      for v_leg in select odds_value, status from bets where combo_id = v_combo_id order by id loop
        if v_leg.status <> 'neutralized' then
          v_remaining_product := v_remaining_product * v_leg.odds_value;
        end if;
      end loop;
      v_new_odds := round(v_remaining_product, 2);

      if v_neutral_count = v_leg_total then
        update combo_bets set
          status = 'neutralized',
          original_total_odds = coalesce(original_total_odds, total_odds),
          total_odds = 1.00,
          payout = null,
          neutralized_at = v_now
        where id = v_combo_id;
        perform increment_balance(v_combo.user_id, v_combo.stake);
        v_refund_total := v_refund_total + v_combo.stake;
      elsif v_pending_count > 0 then
        update combo_bets set
          original_total_odds = coalesce(original_total_odds, total_odds),
          total_odds = v_new_odds,
          neutralized_at = v_now
        where id = v_combo_id;
      else
        v_cap := case when coalesce(v_is_risky, false) then 15000 else 10000 end;
        v_payout := round(least(v_combo.stake * v_new_odds, v_cap), 2);
        update combo_bets set
          status = 'won',
          original_total_odds = coalesce(original_total_odds, total_odds),
          total_odds = v_new_odds,
          payout = v_payout,
          neutralized_at = v_now
        where id = v_combo_id;
        perform increment_balance(v_combo.user_id, v_payout);
      end if;
    end loop;
  end if;

  -- Schritt 4: das Spiel selbst ist final entschieden — niemals normal abgerechnet. Der
  -- strukturierte Grund (annulment_type) ist rein dokumentarisch/Grundlage für die später
  -- separat zu bestätigende offizielle Wertung (confirm_match_annulment_official_score) —
  -- nie automatisch mit einem Ergebnis verknüpft.
  update matches set
    status = 'annulled', annulled_at = v_now, annulment_reason = p_reason, annulment_type = p_annulment_type
  where id = p_match_id and status not in ('annulled', 'finished');

  return jsonb_build_object(
    'alreadyAnnulled', false,
    'affectedSingles', v_affected_singles,
    'affectedComboLegs', v_affected_combo_legs,
    'affectedCombos', coalesce(array_length(v_combo_ids, 1), 0),
    'refundTotal', round(v_refund_total, 2),
    'specialsVoided', v_specials_voided,
    'anomalies', v_anomalies
  );
end;
$function$;

revoke all on function public.neutralize_match(int, uuid, text, text) from public, anon, authenticated;
grant execute on function public.neutralize_match(int, uuid, text, text) to service_role;

-- ───────────────────── 4. Separate, idempotente Bestätigung der offiziellen Wertung ─────────────────────
-- Berührt AUSSCHLIESSLICH diese drei matches-Spalten — niemals bets/combo_bets/profiles.
-- "Ohne die Wettscheine erneut zu bearbeiten" ist damit strukturell garantiert, nicht nur
-- eine Verhaltensabsicht: diese Funktion hat schlicht keinen Code-Pfad, der sie berühren
-- könnte. Beide Scores NULL löscht eine zuvor eingetragene (z.B. fehlerhafte) Wertung wieder —
-- derselbe Aufruf dient also sowohl dem Setzen als auch dem Zurücknehmen.
create or replace function public.confirm_match_annulment_official_score(
  p_match_id int, p_actor_id uuid, p_home_score int, p_away_score int
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_match_status text;
begin
  select status into v_match_status from matches where id = p_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND';
  end if;
  if v_match_status <> 'annulled' then
    raise exception 'MATCH_NOT_ANNULLED';
  end if;
  if (p_home_score is null) <> (p_away_score is null) then
    raise exception 'INVALID_SCORE_PAIR';
  end if;
  if p_home_score is not null and (p_home_score < 0 or p_away_score < 0) then
    raise exception 'INVALID_SCORE_PAIR';
  end if;

  update matches set
    annulment_official_home_score = p_home_score,
    annulment_official_away_score = p_away_score,
    annulment_official_confirmed_at = case when p_home_score is null then null else now() end
  where id = p_match_id;

  return jsonb_build_object(
    'matchId', p_match_id, 'homeScore', p_home_score, 'awayScore', p_away_score,
    'confirmed', p_home_score is not null
  );
end;
$function$;

revoke all on function public.confirm_match_annulment_official_score(int, uuid, int, int) from public, anon, authenticated;
grant execute on function public.confirm_match_annulment_official_score(int, uuid, int, int) to service_role;

notify pgrst, 'reload schema';

commit;
