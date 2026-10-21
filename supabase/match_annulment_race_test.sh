#!/usr/bin/env bash
# Match-Annullierung — ECHTE Nebenläufigkeitsprobe (zwei tatsächlich gleichzeitig laufende
# Datenbank-Sitzungen), als Ergänzung zu supabase/match_annulment_integration_test.sql's
# SEQUENZIELLER Race-Guard-Prüfung (die nur zeigt, dass die WHERE-Bedingung NACH einer
# abgeschlossenen Annullierung 0 Zeilen trifft — nicht, dass zwei WIRKLICH parallele
# Transaktionen korrekt serialisieren). Ein einzelner `DO $$ ... $$` SQL-Block (wie im
# Integrationstest) kann das grundsätzlich nicht abbilden, da er in nur EINER Sitzung läuft.
#
# STATUS: geschrieben, in DIESER Sitzung NICHT ausgeführt (kein psql/DATABASE_URL verfügbar,
# nur lesender Supabase-MCP-Zugriff). Muss vom Nutzer (oder einer Sitzung mit echtem
# Datenbankzugriff) selbst ausgeführt werden — idealerweise zuerst gegen eine
# Nicht-Produktionsumgebung (siehe supabase/SANDBOX_MIGRATION_RUNBOOK.md).
#
# SICHERHEIT: Rührt NUR eigens angelegte, komplett eigenständige Testzeilen in `matches` an
# (matchday=999, match_number=999901/999902) — KEINE bets/combo_bets/profiles, also KEIN
# Guthaben irgendeines echten Nutzers. Jede Testzeile wird per `trap ... RETURN` beim Verlassen
# ihres eigenen run_race()-Durchlaufs IMMER gelöscht — auch wenn dieser Durchlauf mit einem
# Fehler (SQL-Fehler, falsche Zeilenzahl) endet, über jeden return-Pfad der Funktion hinweg.
# Match-ID 433 wird nicht referenziert.
#
# JEDER psql-Aufruf läuft mit `-v ON_ERROR_STOP=1`: ein SQL-Fehler bricht die jeweilige
# Sitzung sofort ab (die UPDATE-Anweisung danach läuft nicht mehr, COMMIT wird nie erreicht —
# die Transaktion bleibt unbestätigt), UND psql selbst beendet sich mit einem Exitcode != 0.
# Beide Sitzungs-Exitcodes werden GETRENNT ausgewertet — ein PASS ist nur möglich, wenn BEIDE
# Sitzungen fehlerfrei durchliefen (unabhängig davon, welche "das Rennen gewonnen" hat).
#
# Was wird geprüft: in jeweils EINEM von zwei Durchläufen hält abwechselnd die simulierte
# `neutralize_match()`-Sitzung bzw. die simulierte `settle/route.ts`-Sitzung den Zeilen-Lock
# künstlich für 3s offen (per pg_sleep VOR dem COMMIT), während die andere Sitzung 1s später
# startet und auf diesen Lock warten muss. Erwartung in BEIDEN Reihenfolgen: GENAU eine der
# beiden UPDATE-Anweisungen betrifft 1 Zeile, die andere 0 — niemals beide, niemals keine, UND
# keine der beiden Sitzungen darf einen SQL-Fehler werfen.
#
# Nutzung:
#   export DATABASE_URL="postgresql://...“   # z.B. aus dem Supabase-Dashboard (Direct Connection,
#                                             # NICHT der Connection Pooler — der kann Sessions
#                                             # zwischen Statements wechseln und die FOR-UPDATE-
#                                             # Sperre dadurch verschleiern)
#   bash supabase/match_annulment_race_test.sh

set -euo pipefail

: "${DATABASE_URL:?Bitte DATABASE_URL setzen (Direct Connection, nicht der Pooler).}"
command -v psql >/dev/null || { echo "psql wird benötigt, ist aber nicht installiert/im PATH." >&2; exit 1; }

PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1)

TEAM_IDS=$("${PSQL[@]}" -t -A -c "select home_team_id || ',' || away_team_id from matches limit 1")
HOME_TEAM_ID=$(echo "$TEAM_IDS" | cut -d, -f1)
AWAY_TEAM_ID=$(echo "$TEAM_IDS" | cut -d, -f2)
if [ -z "$HOME_TEAM_ID" ] || [ -z "$AWAY_TEAM_ID" ]; then
  echo "Konnte keine existierenden team_ids aus matches lesen — ist die Datenbank leer?" >&2
  exit 1
fi

# Erzeugt eine neue, eigenständige Testzeile und gibt ihre id aus.
create_test_match() {
  local match_number="$1"
  "${PSQL[@]}" -t -A -c "
    insert into matches (match_number, matchday, home_team_id, away_team_id, match_date, status, competition_type, match_category, is_topspiel)
    values ($match_number, 999, $HOME_TEAM_ID, $AWAY_TEAM_ID, now() + interval '7 days', 'postponed', 'league', 'kreisliga', false)
    returning id;
  " | tr -d '[:space:]'
}

cleanup_match() {
  local match_id="$1"
  "${PSQL[@]}" -c "delete from matches where id = $match_id;" >/dev/null 2>&1 || \
    echo "WARNUNG: Aufräumen fehlgeschlagen — bitte manuell prüfen/löschen: delete from matches where id = $match_id;" >&2
}

# SQL-Vorlagen. {{SLEEP}} wird durch "select pg_sleep(3);" ersetzt für die Rolle, die den
# Zeilen-Lock künstlich offen hält (das simulierte "Vorsprung"-Szenario dieses Durchlaufs),
# und durch nichts für die nachfolgende, 1s später startende Rolle.
annul_sql() {
  local sleep_stmt="$1" match_id="$2"
  cat <<SQL
BEGIN;
SELECT status FROM matches WHERE id = $match_id FOR UPDATE;
$sleep_stmt
UPDATE matches SET status = 'annulled', annulled_at = now(), annulment_reason = 'race test'
  WHERE id = $match_id AND status NOT IN ('annulled', 'finished')
  RETURNING 'rows:' || id;
COMMIT;
SQL
}

settle_sql() {
  local sleep_stmt="$1" match_id="$2"
  cat <<SQL
BEGIN;
UPDATE matches SET status = 'finished', home_score = 2, away_score = 0
  WHERE id = $match_id AND status NOT IN ('finished', 'annulled')
  RETURNING 'rows:' || id;
$sleep_stmt
COMMIT;
SQL
}

# Führt einen Durchlauf in der gegebenen Reihenfolge aus. $1 = "annul_first" | "settle_first".
# Gibt 0 zurück bei PASS, 1 bei FAIL (inkl. jedes SQL-Fehlers in einer der beiden Sitzungen).
run_race() {
  local order="$1" match_number="$2"
  local match_id
  match_id=$(create_test_match "$match_number")
  echo ""
  echo "=== Durchlauf: $order (Testspiel id=$match_id, matchday=999, keine Wetten/Guthaben beteiligt) ==="
  # shellcheck disable=SC2064
  trap "cleanup_match $match_id" RETURN

  local tmp_dir
  tmp_dir=$(mktemp -d)

  local pid_first pid_second role_first role_second
  if [ "$order" = "annul_first" ]; then
    role_first="annul"; role_second="settle"
    annul_sql "select pg_sleep(3);" "$match_id" > "$tmp_dir/first.sql"
    settle_sql "" "$match_id" > "$tmp_dir/second.sql"
  else
    role_first="settle"; role_second="annul"
    settle_sql "select pg_sleep(3);" "$match_id" > "$tmp_dir/first.sql"
    annul_sql "" "$match_id" > "$tmp_dir/second.sql"
  fi

  "${PSQL[@]}" -t -A -f "$tmp_dir/first.sql" > "$tmp_dir/first.out" 2> "$tmp_dir/first.err" &
  pid_first=$!
  sleep 1
  "${PSQL[@]}" -t -A -f "$tmp_dir/second.sql" > "$tmp_dir/second.out" 2> "$tmp_dir/second.err" &
  pid_second=$!

  local rc_first=0 rc_second=0
  wait "$pid_first" || rc_first=$?
  wait "$pid_second" || rc_second=$?

  echo "--- Sitzung 1 ($role_first, startet sofort, hält den Lock künstlich 3s) ---"
  cat "$tmp_dir/first.out"; cat "$tmp_dir/first.err" >&2
  echo "--- Sitzung 2 ($role_second, startet 1s später) ---"
  cat "$tmp_dir/second.out"; cat "$tmp_dir/second.err" >&2

  # Kein PASS, wenn IRGENDEINE der beiden Sitzungen einen SQL-Fehler hatte — unabhängig davon,
  # was die Zeilenzahlen sonst nahelegen würden.
  if [ "$rc_first" -ne 0 ] || [ "$rc_second" -ne 0 ]; then
    echo "FEHLER [$order]: Sitzung $role_first (Exitcode $rc_first) und/oder Sitzung $role_second (Exitcode $rc_second) hatten einen SQL-Fehler — kein PASS möglich." >&2
    rm -rf "$tmp_dir"
    return 1
  fi

  local hit_first hit_second final_status
  hit_first=$(grep -c "^rows:" "$tmp_dir/first.out" || true)
  hit_second=$(grep -c "^rows:" "$tmp_dir/second.out" || true)
  final_status=$("${PSQL[@]}" -t -A -c "select status from matches where id = $match_id;")
  rm -rf "$tmp_dir"
  echo "Endstatus (vor Aufräumen): $final_status"

  local expected_status
  [ "$role_first" = "annul" ] && expected_status="annulled" || expected_status="finished"

  if [ "$hit_first" = "1" ] && [ "$hit_second" = "0" ] && [ "$final_status" = "$expected_status" ]; then
    echo "BESTANDEN [$order]: Sitzung $role_first (zuerst, hält den Lock) gewann das Rennen; Sitzung $role_second wurde korrekt zu 0 Zeilen zurückgewiesen."
    return 0
  fi
  echo "FEHLER [$order]: Race-Guard versagt — $role_first betraf $hit_first Zeile(n), $role_second betraf $hit_second Zeile(n), Endstatus=$final_status (erwartet: $role_first gewinnt mit 1 Zeile, $role_second mit 0, Endstatus=$expected_status)." >&2
  return 1
}

overall_rc=0
run_race annul_first 999901 || overall_rc=1
run_race settle_first 999902 || overall_rc=1

if [ "$overall_rc" -eq 0 ]; then
  echo ""
  echo "BESTANDEN: beide Reihenfolgen (Annullierung zuerst / normale Abrechnung zuerst) korrekt serialisiert, keine SQL-Fehler."
else
  echo ""
  echo "FEHLGESCHLAGEN: siehe Meldungen oben." >&2
fi
exit "$overall_rc"
