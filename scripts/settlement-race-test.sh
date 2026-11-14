#!/usr/bin/env bash
# Echte Nebenläufigkeit gegen einen LOKALEN, WEGWERF-Postgres (nie Production, nie Sandbox):
# N parallele psql-Sitzungen rufen dieselben Buchungsfunktionen gleichzeitig auf; es darf genau EINE Buchung entstehen.
#   PGURL=postgresql://postgres@/racetest?host=/tmp\&port=5499 bash scripts/settlement-race-test.sh
set -euo pipefail
: "${PGURL:?PGURL auf eine lokale Wegwerf-Datenbank setzen}"
cd "$(dirname "$0")/.."
N=${N:-24}
q() { psql "$PGURL" -v ON_ERROR_STOP=1 -qtAX -c "$1"; }
fail=0; pass=0
expect() { if [ "$2" = "$3" ]; then echo "OK   $1"; pass=$((pass+1)); else echo "FAIL $1 (erwartet $3, erhalten $2)"; fail=$((fail+1)); fi; }
par() { # $1 = SQL, runs N times in parallel, prints number of sessions that returned 't'
  local out; out=$(for i in $(seq 1 "$N"); do (psql "$PGURL" -qtAX -c "$1" 2>/dev/null || echo ERR) & done; wait)
  echo "$out" | grep -c '^t$' || true
}
# Rollen sind clusterweit: nur anlegen, wenn sie fehlen; der Rest des Schemas kommt in eine frische Datenbank.
q "do \$r\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end \$r\$"
grep -v '^create role ' scripts/race-test-schema.sql | psql "$PGURL" -v ON_ERROR_STOP=1 -q >/dev/null
psql "$PGURL" -v ON_ERROR_STOP=1 -q -f supabase/immutable_placed_matchday_2026.sql >/dev/null
psql "$PGURL" -v ON_ERROR_STOP=1 -q -f supabase/survey_reward_2026.sql >/dev/null
U1=00000000-0000-0000-0000-000000000001; U2=00000000-0000-0000-0000-000000000002; U3=00000000-0000-0000-0000-000000000003; U4=00000000-0000-0000-0000-000000000004
q "insert into profiles (id, balance) values ('$U1',1000),('$U2',1000),('$U3',1000),('$U4',1000);
   insert into app_settings values ('betting_open_md_16','2026-11-09T11:00:00+00:00');
   insert into matches (id, matchday, match_date, status) values (1,16,'2026-11-15T12:00:00Z','finished');
   insert into bets (id,user_id,match_id,market_type,selection,stake,odds_value,status,season,created_at) values
     (1,'$U1',1,'1x2','home',10,3,'pending','26/27','2026-11-10T10:00:00Z'),
     (2,'$U2',1,'1x2','home',10,3,'pending','26/27','2026-11-10T10:00:00Z');
   insert into combo_bets (id,user_id,stake,total_odds,status,season) values (1,'$U3',10,5,'pending','26/27');
   insert into bets (id,user_id,match_id,market_type,selection,odds_value,status,combo_id,season,created_at) values
     (3,'$U3',1,'1x2','home',5,'won',1,'26/27','2026-11-10T10:00:00Z');
   insert into survey_responses (user_id, survey_version, submitted_at) values ('$U1','winter_2026_v2',now());
   select setval('bets_id_seq', 100), setval('combo_bets_id_seq', 100);"
r=$(par "set role service_role; select public.settle_bet(1,'won',30)")
expect "$N parallele settle_bet auf dieselbe Wette: genau 1 Abrechnung" "$r" 1
expect "… und genau +30 Guthaben" "$(q "select balance::int from profiles where id='$U1'")" 1030
r=$(par "set role service_role; select public.settle_combo(1,'won',50)")
expect "$N parallele settle_combo: genau 1 Auszahlung" "$r" 1
expect "… und genau +50 Guthaben" "$(q "select balance::int from profiles where id='$U3'")" 1050
out=$(for i in $(seq 1 "$N"); do
  if [ $((i % 2)) -eq 0 ]; then (psql "$PGURL" -qtAX -c "set role service_role; select 'S:'||public.settle_bet(2,'won',30)" 2>/dev/null) &
  else (psql "$PGURL" -qtAX -c "set role service_role; select 'V:'||coalesce(public.void_slip_refund('single',2,'user_cancelled','$U2',false)::text,'null')" 2>/dev/null) & fi
done; wait)
winners=$(echo "$out" | grep -cE '^(S:true|V:10)$' || true)
expect "Storno gegen Abrechnung gleichzeitig: genau einer gewinnt" "$winners" 1
b2=$(q "select balance::int from profiles where id='$U2'"); st2=$(q "select status from bets where id=2")
ok2=0; { [ "$st2" = won ] && [ "$b2" = 1030 ]; } && ok2=1; { [ "$st2" = void ] && [ "$b2" = 1010 ]; } && ok2=1
expect "… Endzustand konsistent (won+30 ODER void+10, nie beides)" "$ok2" 1
r=$(par "set role service_role; select (public.grant_survey_reward('$U1','winter_2026_v2')->>'granted')::boolean")
expect "$N parallele Umfrage-Belohnungen: genau 1 Buchung" "$r" 1
expect "… Guthaben +100 und 1 Journal-Zeile" "$(q "select balance::int from profiles where id='$U1'")/$(q "select count(*) from balance_transactions")" "1130/1"
r=$(par "set role service_role; select (public.book_matchday_round('pocket_money','26/27',16,array['$U1','$U2','$U3']::uuid[],10)->>'booked')::boolean")
expect "$N parallele Taschengeld-Läufe: genau 1 Buchung" "$r" 1
expect "… genau +10 für U3" "$(q "select balance::int from profiles where id='$U3'")" 1060
r=$(par "set role service_role; with r as materialized (select public.finalize_bet_placement('$U4','[{\"matchday\":16,\"match_ids\":[1],\"expected_count\":0,\"origin_mode\":true}]'::jsonb, null, '[{\"match_id\":1,\"market_type\":\"1x2\",\"selection\":\"away\",\"stake\":5,\"odds_value\":2,\"status\":\"pending\",\"is_risky\":false,\"is_bonus\":false,\"season\":\"26/27\",\"placed_matchday\":16}]'::jsonb) as v) select true from r")
expect "$N parallele Platzierungen auf denselben freien Platz: genau 1 erfolgreich" "$r" 1
expect "… genau 1 Wette gespeichert (Advisory-Lock + Zählerprüfung)" "$(q "select count(*) from bets where user_id='$U4'")" 1
echo; echo "$pass bestanden, $fail fehlgeschlagen"; [ "$fail" -eq 0 ]
