-- Match-Annullierung — echter Datenbank-Integrationstest gegen die tatsächliche RPC
-- neutralize_match() (nicht nur TypeScript-Logik, siehe scripts/match-annulment-check.ts
-- für die 41 reinen Berechnungs-Prüfungen).
--
-- STATUS: geschrieben, aber in DIESER Sitzung NICHT ausgeführt — nur lesender Supabase-
-- Zugriff verfügbar, und der Nutzer hat ausdrücklich um KEINE Migration/Ausführung ohne
-- sein Go gebeten. Dieses Skript setzt voraus, dass supabase/match_annulment.sql bereits
-- angewendet wurde (sonst existiert neutralize_match() noch nicht) — beide Schritte bleiben
-- getrennte, vom Nutzer einzeln freizugebende Aktionen.
--
-- SICHERHEIT: Das gesamte Skript läuft in EINER Transaktion, die am Ende explizit mit
-- ROLLBACK abgeschlossen wird — unabhängig davon, ob alle ASSERTs bestehen oder eines
-- fehlschlägt (ein fehlgeschlagenes ASSERT wirft ohnehin eine Exception, die die
-- Transaktion automatisch abbricht; der abschließende ROLLBACK-Befehl ist der zweite,
-- unabhängige Schutz für den Erfolgsfall). Es werden ausschließlich temporäre
-- Test-Zeilen unter `matchday = 999` (die bereits etablierte, von echten
-- Rangliste/Awards/Statistiken ausgeschlossene Test-Konvention dieses Projekts, siehe
-- CLAUDE.md) angelegt. Zwei bereits existierende, beliebige `profiles`-Zeilen werden
-- als Platzhalter-Nutzer verwendet (ihr Guthaben wird innerhalb der Transaktion
-- verändert, aber durch den ROLLBACK vollständig zurückgesetzt — am Ende bleibt NICHTS
-- verändert). Match-ID 433 wird an keiner Stelle referenziert.
--
-- Ausführung (erst nach Freigabe durch den Nutzer, idealerweise zuerst gegen eine
-- Nicht-Produktionsumgebung): dieses Skript komplett im Supabase-SQL-Editor einfügen
-- und ausführen. Der SQL-Editor führt es als eine Sitzung aus — BEGIN/ROLLBACK wirken
-- dort exakt wie in psql.
--
-- Abdeckung — bewusst NICHT jedes der 12 Spezifikations-Szenarien erneut (die sind
-- bereits durch die reine TS-Logik abgedeckt, siehe scripts/match-annulment-check.ts),
-- sondern gezielt das, was NUR ein echter Lauf gegen echtes SQL zeigen kann:
--   1. combo_bets.is_risky existiert nicht — ein Aufruf, der (wie vorher) versucht,
--      diese Spalte zu lesen, würde mit einem SQL-Fehler abbrechen. Dass dieser Test
--      überhaupt fehlerfrei durchläuft, beweist den Fix bereits strukturell.
--   2. Ein Spieltag-Special, dessen representative_match_id zufällig das annullierte
--      Spiel ist, OHNE es in included_match_ids zu führen, bleibt unberührt.
--   3. Ein Spieltag-Special, das das annullierte Spiel GENUIN enthält, wird korrekt
--      mit-neutralisiert und als 'void' markiert.
--   4. Eine bereits verlorene Kombi bleibt verloren, ihr betroffenes Leg wird trotzdem
--      neutralisiert (löst sonst stillPendingCount in lib/matchdayFinalize.ts aus).
--   5. Eine Kombi, die NUR durch die Annullierung gewinnt, wird korrekt ausgezahlt.
--   6. Idempotenz: ein zweiter Aufruf verändert nichts (kein doppelter Refund/Payout).
--   7. Die Race-Guard-Bedingung aus app/api/admin/settle/route.ts (UPDATE ... WHERE
--      status NOT IN ('finished','annulled')) betrifft nach der Annullierung tatsächlich
--      null Zeilen.

begin;

do $$
declare
  v_user_a uuid;
  v_user_b uuid;
  v_balance_a_before numeric;
  v_balance_b_before numeric;
  v_balance_a_after numeric;
  v_balance_b_after numeric;
  v_home_team_id int;
  v_away_team_id int;
  v_match_annul int;      -- das zu annullierende Spiel
  v_match_lost int;       -- bereits verloren abgerechnetes "anderes" Spiel
  v_match_won int;        -- bereits gewonnen abgerechnetes "anderes" Spiel
  v_match_open int;       -- noch offenes "anderes" Spiel
  v_special_included int; -- Special, das v_match_annul GENUIN enthält
  v_special_anchor_only int; -- Special, das v_match_annul NUR als representative_match_id trägt
  v_bet_single int;
  v_combo_lost int;
  v_combo_wins_via_annulment int;
  v_combo_still_open int;
  v_bet_special_included int;
  v_bet_special_anchor_only int;
  v_result jsonb;
  v_result2 jsonb;
  v_status text;
  v_total_odds numeric;
  v_payout numeric;
  v_races_affected int;
begin
  select id into v_user_a from profiles order by id limit 1;
  select id into v_user_b from profiles where id <> v_user_a order by id limit 1;
  if v_user_a is null or v_user_b is null then
    raise exception 'Benötige mindestens 2 existierende profiles-Zeilen für diesen Test.';
  end if;
  select balance into v_balance_a_before from profiles where id = v_user_a;
  select balance into v_balance_b_before from profiles where id = v_user_b;

  select home_team_id, away_team_id into v_home_team_id, v_away_team_id from matches limit 1;

  insert into matches (match_number, matchday, home_team_id, away_team_id, match_date, status, competition_type, match_category, is_topspiel)
    values (999001, 999, v_home_team_id, v_away_team_id, now() + interval '7 days', 'postponed', 'league', 'kreisliga', false)
    returning id into v_match_annul;
  insert into matches (match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status, competition_type, match_category, is_topspiel)
    values (999002, 999, v_home_team_id, v_away_team_id, now() - interval '1 day', 1, 2, 'finished', 'league', 'kreisliga', false)
    returning id into v_match_lost;
  insert into matches (match_number, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status, competition_type, match_category, is_topspiel)
    values (999003, 999, v_home_team_id, v_away_team_id, now() - interval '1 day', 2, 0, 'finished', 'league', 'kreisliga', false)
    returning id into v_match_won;
  insert into matches (match_number, matchday, home_team_id, away_team_id, match_date, status, competition_type, match_category, is_topspiel)
    values (999004, 999, v_home_team_id, v_away_team_id, now() + interval '7 days', 'scheduled', 'league', 'kreisliga', false)
    returning id into v_match_open;

  -- Special, das das annullierte Spiel GENUIN enthält.
  insert into matchday_specials (season, matchday, template_key, title, options, included_match_ids, representative_match_id, status, opens_at, closes_at)
    values ('TEST', 999, 'any_00', 'Integrationstest: genuin enthalten',
            '[{"key":"yes","label":"Ja","probability":0.5,"generated_odds":2,"final_odds":2,"overridden":false},{"key":"no","label":"Nein","probability":0.5,"generated_odds":2,"final_odds":2,"overridden":false}]'::jsonb,
            array[v_match_annul, v_match_open], v_match_open, 'active', now() - interval '1 day', now() + interval '7 days')
    returning id into v_special_included;

  -- Special, dessen representative_match_id ZUFÄLLIG das annullierte Spiel ist, das es aber
  -- NICHT in included_match_ids führt — der genaue Fall des gemeldeten Fehlers.
  insert into matchday_specials (season, matchday, template_key, title, options, included_match_ids, representative_match_id, status, opens_at, closes_at)
    values ('TEST', 999, 'any_00', 'Integrationstest: nur technischer Anker',
            '[{"key":"yes","label":"Ja","probability":0.5,"generated_odds":2,"final_odds":2,"overridden":false},{"key":"no","label":"Nein","probability":0.5,"generated_odds":2,"final_odds":2,"overridden":false}]'::jsonb,
            array[v_match_open], v_match_annul, 'active', now() - interval '1 day', now() + interval '7 days')
    returning id into v_special_anchor_only;

  -- 1) Einzelwette auf das annullierte Spiel.
  insert into bets (user_id, match_id, market_type, selection, stake, odds_value, status, is_risky, season)
    values (v_user_a, v_match_annul, '1x2', 'home', 25.00, 1.90, 'pending', false, 'TEST')
    returning id into v_bet_single;

  -- 2) Kombi, die bereits VERLOREN ist (anderes Spiel schon verloren abgerechnet), mit einem
  --    noch offenen Leg auf dem annullierten Spiel (genau wie #579 u.a. in Produktion).
  insert into combo_bets (user_id, stake, total_odds, status, season)
    values (v_user_a, 50.00, 3.80, 'lost', 'TEST')
    returning id into v_combo_lost;
  insert into bets (user_id, match_id, market_type, selection, odds_value, status, combo_id, is_risky, season)
    values (v_user_a, v_match_lost, '1x2', 'home', 2.00, 'lost', v_combo_lost, false, 'TEST');
  insert into bets (user_id, match_id, market_type, selection, odds_value, status, combo_id, is_risky, season)
    values (v_user_a, v_match_annul, '1x2', 'away', 1.90, 'pending', v_combo_lost, false, 'TEST');

  -- 3) Kombi, die NUR durch die Annullierung gewinnt: ein Leg bereits gewonnen, das andere
  --    das annullierte Spiel. is_risky = true, um gleichzeitig den is_risky-Fix (bool_or aus
  --    bets, nicht combo_bets.is_risky) UND den Risky-Payout-Deckel zu testen.
  insert into combo_bets (user_id, stake, total_odds, status, season)
    values (v_user_b, 10.00, 3.80, 'pending', 'TEST')
    returning id into v_combo_wins_via_annulment;
  insert into bets (user_id, match_id, market_type, selection, odds_value, status, combo_id, is_risky, season)
    values (v_user_b, v_match_won, '1x2', 'home', 2.00, 'won', v_combo_wins_via_annulment, true, 'TEST');
  insert into bets (user_id, match_id, market_type, selection, odds_value, status, combo_id, is_risky, season)
    values (v_user_b, v_match_annul, '1x2', 'away', 1.90, 'pending', v_combo_wins_via_annulment, true, 'TEST');

  -- 4) Kombi, die nach der Annullierung noch offen bleibt (ein echtes, noch offenes Leg bleibt).
  insert into combo_bets (user_id, stake, total_odds, status, season)
    values (v_user_b, 15.00, 3.61, 'pending', 'TEST')
    returning id into v_combo_still_open;
  insert into bets (user_id, match_id, market_type, selection, odds_value, status, combo_id, is_risky, season)
    values (v_user_b, v_match_open, '1x2', 'draw', 1.90, 'pending', v_combo_still_open, false, 'TEST');
  insert into bets (user_id, match_id, market_type, selection, odds_value, status, combo_id, is_risky, season)
    values (v_user_b, v_match_annul, '1x2', 'home', 1.90, 'pending', v_combo_still_open, false, 'TEST');

  -- 5) Matchday-Special-Bet auf das Special, das das annullierte Spiel GENUIN enthält.
  insert into bets (user_id, match_id, market_type, selection, stake, odds_value, status, special_id, is_risky, season)
    values (v_user_a, v_match_open, 'matchday_special', 'yes', 5.00, 2.00, 'pending', v_special_included, false, 'TEST')
    returning id into v_bet_special_included;

  -- 6) Matchday-Special-Bet auf das Special, dessen representative_match_id NUR technischer
  --    Anker ist (match_id dieses Bets = v_match_annul, aber included_match_ids enthält
  --    v_match_annul NICHT) — DARF NICHT angefasst werden.
  insert into bets (user_id, match_id, market_type, selection, stake, odds_value, status, special_id, is_risky, season)
    values (v_user_a, v_match_annul, 'matchday_special', 'yes', 5.00, 2.00, 'pending', v_special_anchor_only, false, 'TEST')
    returning id into v_bet_special_anchor_only;

  -------------------------------------------------------------------
  -- Annullierung ausführen.
  -------------------------------------------------------------------
  select neutralize_match(v_match_annul, v_user_a, 'Integrationstest') into v_result;
  raise notice 'neutralize_match Ergebnis: %', v_result;

  -- Fix #1 (combo_bets.is_risky existiert nicht): dass wir überhaupt hier ankommen, ohne
  -- SQL-Fehler, beweist bereits, dass is_risky korrekt aus bets (bool_or) gelesen wird.
  assert (v_result->>'anomalies')::int = 0, 'Keine Anomalien erwartet';

  -- Einzelwette: neutralisiert, voll erstattet.
  select status into v_status from bets where id = v_bet_single;
  assert v_status = 'neutralized', 'Einzelwette muss neutralized sein, ist: ' || v_status;
  select balance into v_balance_a_after from profiles where id = v_user_a;
  -- (Kombi v_combo_wins_via_annulment gehört User B, nicht A — A bekommt hier nur den
  -- Einzelwetten-Refund von 25.00.)
  assert v_balance_a_after = v_balance_a_before + 25.00,
    format('User A Guthaben erwartet %s, ist %s', v_balance_a_before + 25.00, v_balance_a_after);

  -- Bereits verlorene Kombi: bleibt 'lost', ihr annulliertes Leg wird trotzdem neutralisiert.
  select status into v_status from combo_bets where id = v_combo_lost;
  assert v_status = 'lost', 'Bereits verlorene Kombi darf NICHT reaktiviert werden, ist: ' || v_status;
  select status into v_status from bets where combo_id = v_combo_lost and match_id = v_match_annul;
  assert v_status = 'neutralized', 'Das annullierte Leg der verlorenen Kombi muss trotzdem neutralisiert werden';

  -- Fix #2: Special, das NUR als technischer Anker diente, bleibt komplett unberührt.
  select status into v_status from bets where id = v_bet_special_anchor_only;
  assert v_status = 'pending', 'Anchor-only-Special-Bet darf NICHT neutralisiert werden, ist: ' || v_status;
  select status into v_status from matchday_specials where id = v_special_anchor_only;
  assert v_status = 'active', 'Anchor-only-Special darf NICHT voided werden, ist: ' || v_status;

  -- Fix #2 Gegenprobe: das Special, das das Spiel GENUIN enthält, wird korrekt mit-neutralisiert.
  select status into v_status from bets where id = v_bet_special_included;
  assert v_status = 'neutralized', 'Genuin enthaltenes Special-Bet muss neutralisiert werden, ist: ' || v_status;
  select status into v_status from matchday_specials where id = v_special_included;
  assert v_status = 'void', 'Genuin enthaltenes Special muss voided werden, ist: ' || v_status;

  -- Kombi, die NUR durch die Annullierung gewinnt — korrekter Payout, Risky-Deckel beachtet.
  select status, total_odds, payout into v_status, v_total_odds, v_payout from combo_bets where id = v_combo_wins_via_annulment;
  assert v_status = 'won', 'Muss durch Annullierung gewinnen, ist: ' || v_status;
  assert v_total_odds = 2.00, format('Neue Quote erwartet 2.00, ist %s', v_total_odds);
  assert v_payout = 20.00, format('Payout erwartet 20.00 (10 x 2.00), ist %s', v_payout);
  select balance into v_balance_b_after from profiles where id = v_user_b;
  assert v_balance_b_after = v_balance_b_before + 20.00,
    format('User B Guthaben erwartet %s, ist %s', v_balance_b_before + 20.00, v_balance_b_after);

  -- Noch offene Kombi: neue Gesamtquote korrekt berechnet, bleibt pending.
  select status, total_odds into v_status, v_total_odds from combo_bets where id = v_combo_still_open;
  assert v_status = 'pending', 'Muss noch offen bleiben, ist: ' || v_status;
  assert v_total_odds = 1.90, format('Neue Quote erwartet 1.90, ist %s', v_total_odds);

  -- Match selbst final annulliert, kein Forfeit-Ergebnis gespeichert.
  perform 1 from matches where id = v_match_annul and status = 'annulled' and home_score is null and away_score is null;
  assert found, 'Spiel muss annulliert sein, ohne Score';

  -------------------------------------------------------------------
  -- Fix #6: Idempotenz — zweiter Aufruf darf NICHTS mehr verändern.
  -------------------------------------------------------------------
  select balance into v_balance_a_before from profiles where id = v_user_a; -- aktueller Stand nach 1. Lauf
  select balance into v_balance_b_before from profiles where id = v_user_b;
  select neutralize_match(v_match_annul, v_user_a, 'Integrationstest (2. Lauf)') into v_result2;
  assert (v_result2->>'alreadyAnnulled')::boolean = true, 'Zweiter Lauf muss alreadyAnnulled=true melden';
  select balance into v_balance_a_after from profiles where id = v_user_a;
  select balance into v_balance_b_after from profiles where id = v_user_b;
  assert v_balance_a_after = v_balance_a_before, 'Zweiter Lauf darf User-A-Guthaben nicht nochmal ändern';
  assert v_balance_b_after = v_balance_b_before, 'Zweiter Lauf darf User-B-Guthaben nicht nochmal ändern';

  -------------------------------------------------------------------
  -- Fix #4: Race-Guard — dieselbe WHERE-Bedingung wie settle/route.ts nach der Annullierung.
  -------------------------------------------------------------------
  with upd as (
    update matches set status = 'finished', home_score = 9, away_score = 9
    where id = v_match_annul and status not in ('finished', 'annulled')
    returning id
  )
  select count(*) into v_races_affected from upd;
  assert v_races_affected = 0, 'Die Race-Guard-WHERE-Bedingung muss nach der Annullierung 0 Zeilen betreffen';

  raise notice 'INTEGRATIONSTEST: alle ASSERTs bestanden.';
end $$;

-- Egal was oben passiert ist (Erfolg oder Exception) — nichts darf bestehen bleiben.
rollback;
