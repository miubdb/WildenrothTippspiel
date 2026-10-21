-- Wildenroth-Tippspiel – Nichtantritt / Annullierung mit Quote 1,00
--
-- STATUS: vorbereitet, aber in dieser Umgebung NICHT ausgeführt — diese Sitzung hatte nur
-- LESENDEN Supabase-Zugriff (mcp__Supabase_Wildenroth_Read_Only), und zwar ausschließlich auf
-- das Produktionsprojekt (mpyqtymkdhxuannqhtvp) — keinerlei Zugriff auf die separate Sandbox
-- `aspbgawbqwfntvlqtcvl` ("Wildenroth Redesign Sandbox", strukturell entsprechende Tabellen).
-- Dieselbe Situation wie supabase/admin3_audit_log.sql — siehe dort für das etablierte
-- Vorgehen bei vorbereiteten, noch nicht angewendeten Migrationen.
--
-- Anwendung (zwingend in dieser Reihenfolge):
--   1. ZUERST gegen die Sandbox `aspbgawbqwfntvlqtcvl` verifizieren — siehe
--      supabase/SANDBOX_MIGRATION_RUNBOOK.md für den vollständigen, sicheren Testablauf
--      (Schema-Abgleich, Vorher/Nachher-Schnappschuss, Migration, Logiktest, echte
--      Nebenläufigkeitsprobe). Dieses Skript selbst verändert KEINE bestehenden Zeilen — es
--      erweitert nur Constraints und fügt neue, NULLABLE Spalten/eine neue Funktion hinzu.
--   2. Erst danach gegen die EINE gemeinsame Produktions-/Preview-Datenbank anwenden (Preview/
--      `integration` und Production/`main` lesen/schreiben dieselben Tabellen — siehe
--      CLAUDE.md "Branch- und Deployment-Strategie") und dort gegen eine ERFUNDENE/unwichtige
--      Test-Kombination verifizieren — NICHT gegen Match-ID 433, das bleibt bis zur
--      ausdrücklichen Freigabe unberührt.
--   3. Match-ID 433 (TSV Oberalting-Seefeld – SC Schöngeising, Nichtantritt) erst nach
--      ausdrücklicher Freigabe durch den Nutzer über die neue Admin-Aktion annullieren.
--
-- Sicherheitsmodell — identisch zu jeder anderen Admin-Mutation in diesem Projekt: nur der
-- Service-Role-Client darf `neutralize_match` aufrufen (die Admin-API-Route prüft `is_admin`
-- selbst, siehe app/api/admin/matches/[id]/annul/route.ts); die Funktion selbst ist
-- SECURITY DEFINER mit explizitem search_path, exakt wie `finalize_bet_placement`/
-- `increment_balance`/`deduct_balance` es bereits vormachen.

begin;

-- ───────────────────────── 1. matches: neuer Status 'annulled' ─────────────────────────
-- 'annulled' ist bewusst ein NEUER, eigener Wert — nicht das bereits erlaubte, aber nirgends
-- tatsächlich verwendete 'cancelled' (siehe types/index.ts MatchStatus und
-- app/api/admin/matchday-checklist/route.ts, die einzige Stelle, die 'cancelled' überhaupt
-- kennt, ohne dass je eine Zeile diesen Wert trägt). Eine eigene, einmalig für genau diesen
-- Nichtantritt/Annullierungs-Pfad eingeführte Konstante kann nicht mit einer künftigen, anders
-- gemeinten Verwendung von 'cancelled' kollidieren.
alter table public.matches drop constraint matches_status_check;
alter table public.matches add constraint matches_status_check
  check (status = any (array['scheduled', 'finished', 'postponed', 'live', 'cancelled', 'annulled']));

alter table public.matches add column if not exists annulled_at timestamptz;
alter table public.matches add column if not exists annulment_reason text;

comment on column public.matches.annulled_at is 'Gesetzt von neutralize_match() beim finalen Annullieren (Nichtantritt o.ä.). status=''annulled'' ist final — settle/route.ts verweigert danach jede normale Ergebniseingabe für dieses Spiel.';
comment on column public.matches.annulment_reason is 'Freitext-Grund, vom Admin bei der Annullierung eingegeben (z.B. "Nichtantritt der Gastmannschaft"). Für die Spieler-Anzeige ("Annulliert"-Hinweistext) wird NICHT dieser Freitext verwendet, sondern der feste Erklärungstext aus lib/betDisplay.ts — dieses Feld ist reine Admin-Dokumentation.';

-- ───────────────────────── 2. bets: neuer Status 'neutralized' ─────────────────────────
alter table public.bets drop constraint bets_status_check;
alter table public.bets add constraint bets_status_check
  check (status = any (array['pending', 'won', 'lost', 'void', 'neutralized']));

alter table public.bets add column if not exists neutralized_at timestamptz;
alter table public.bets add column if not exists neutralized_reason text;
alter table public.bets add constraint bets_neutralized_reason_check
  check (neutralized_reason = any (array['match_annulled', 'special_voided']));

comment on column public.bets.neutralized_reason is 'Analog zu void_reason, aber für status=''neutralized'': match_annulled = direkte Auswahl auf einem annullierten Spiel; special_voided = Auswahl auf einem Spieltag-Special, das annulliert wurde, weil es ein annulliertes Spiel in included_match_ids hatte. odds_value/stake bleiben UNVERÄNDERT (der Originalwert ist also immer schon vorhanden) — es gibt bewusst keine separate "original_odds"-Spalte auf bets.';

-- ───────────────────────── 3. combo_bets: neuer Status 'neutralized' + Original-Quote ─────
alter table public.combo_bets drop constraint combo_bets_status_check;
alter table public.combo_bets add constraint combo_bets_status_check
  check (status = any (array['pending', 'won', 'lost', 'void', 'neutralized']));

alter table public.combo_bets add column if not exists original_total_odds numeric;
alter table public.combo_bets add column if not exists neutralized_at timestamptz;

comment on column public.combo_bets.original_total_odds is 'Snapshot von total_odds, bevor eine Annullierung total_odds auf den neu berechneten Wert überschreibt — NUR beim ersten Berühren gesetzt (COALESCE in neutralize_match verhindert ein Überschreiben bei einem zweiten/idempotenten Lauf). NULL = diese Kombi wurde nie von einer Annullierung berührt. total_odds selbst trägt danach den NEUEN Wert, damit Settlement/Risky/Statistik/Anzeige ihn ohne Sonderfall-Code übernehmen.';

-- ───────────────────────── 4. Die RPC selbst ─────────────────────────
--
-- Jede Berechnung hier ist eine direkte Übersetzung von lib/matchAnnulment.ts
-- (classifyCombo/planCombo/planSingleBet/legMatchesTarget) — siehe dort für die
-- ausführliche Begründung jedes Falls, und scripts/match-annulment-check.ts für die
-- Prüfung dieser Logik gegen die 12 Spezifikations-Szenarien UND gegen die echten,
-- read-only verifizierten Produktionsdaten zu Match-ID 433 (34/34 Prüfungen bestanden).
--
-- Idempotenz: JEDE Mutation hier ist an status='pending'/status='active' gebunden (die
-- UPDATE-Statements selbst sind der Filter) — ein zweiter Lauf auf einem bereits
-- annullierten Spiel findet in Schritt 1 keine passende Zeile mehr (alles schon
-- 'neutralized'), gibt sofort { alreadyAnnulled: true, ... } zurück und ändert nichts.
--
-- Nebenläufigkeit: pg_advisory_xact_lock serialisiert konkurrierende Aufrufe für
-- DASSELBE match_id (z.B. zwei Admin-Browsertabs), exakt wie finalize_bet_placement es für
-- (user_id, matchday) bereits tut. Eine Race zwischen "normales Ergebnis eintragen"
-- (app/api/admin/settle/route.ts) und "annullieren" für DASSELBE Spiel ist davon NICHT
-- erfasst (zwei unterschiedliche Funktionen, zwei unterschiedliche Locks) — siehe
-- Abschlussbericht, Abschnitt "Offene Risiken".
create or replace function public.neutralize_match(p_match_id int, p_actor_id uuid, p_reason text)
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
  -- market_type <> 'matchday_special' is essential here: a Special bet's
  -- own match_id is only its representative_match_id (technical FK anchor,
  -- see lib/matchdaySpecials.ts) — a plain match_id match would wrongly
  -- neutralize a Special merely ANCHORED on this match even when its own
  -- included_match_ids doesn't contain it at all. A Special is only ever
  -- reached below, via special_id, after confirming genuine
  -- included_match_ids membership.
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

  -- Schritt 2: jedes AKTIVE Spieltag-Special, das dieses Spiel in included_match_ids
  -- trägt, kann ebenfalls nie mehr ein echtes Ergebnis erreichen — seine eigenen,
  -- noch offenen Wetten werden genauso neutralisiert (NIE die anderen Legs einer
  -- Kombi, zu der eine solche Wette gehört — diese werden in Schritt 3 einheitlich
  -- für ALLE in diesem Aufruf berührten Kombis aufgelöst), und das Special selbst
  -- wird stillgelegt. Ein Special, dessen representative_match_id zufällig dieses
  -- Spiel ist, OHNE es in included_match_ids zu führen (reiner technischer Anker),
  -- wird von dieser Abfrage korrekt NICHT erfasst.
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

  -- Schritt 3: jede in diesem Aufruf berührte Kombi, deren EIGENER Status noch
  -- 'pending' war, neu auflösen. Eine bereits gewonnene/verlorene/stornierte/
  -- neutralisierte Kombi bleibt hier (status/total_odds/payout) vollständig
  -- unberührt — nur ihr(e) betroffenes/betroffene Leg(s) wurde(n) oben neutralisiert.
  if v_combo_ids is not null then
    foreach v_combo_id in array v_combo_ids
    loop
      -- combo_bets has no is_risky column of its own (every leg carries the
      -- same value, see lib/risky.ts) — never select it from here.
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
        -- Unter normalem Betrieb unerreichbar: eine noch 'pending' Kombi kann
        -- nie bereits ein 'lost'-Leg enthalten (settle/route.ts hätte sie
        -- sonst längst auf 'lost' gesetzt). Als Anomalie gemeldet statt
        -- stillschweigend geraten — siehe Admin-Vorschau "Fehler/Anomalien".
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

  -- Schritt 4: das Spiel selbst ist nun final entschieden — niemals normal
  -- abgerechnet (kein 2:0-Forfeit-Ergebnis wird je gespeichert, home_score/
  -- away_score bleiben NULL, siehe app/api/admin/settle/route.ts's neue
  -- 'annulled'-Sperre).
  -- Defensive WHERE guard on top of the FOR UPDATE row lock taken above
  -- (which already serializes against a concurrent settle/route.ts UPDATE
  -- on the same row, see that route's own matching WHERE guard) — belt and
  -- suspenders: this UPDATE can never resurrect/overwrite a match some other
  -- path already finished or annulled in the meantime.
  update matches set status = 'annulled', annulled_at = v_now, annulment_reason = p_reason
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

revoke all on function public.neutralize_match(int, uuid, text) from public, anon, authenticated;
grant execute on function public.neutralize_match(int, uuid, text) to service_role;

notify pgrst, 'reload schema';

commit;
