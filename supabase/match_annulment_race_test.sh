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
# Nicht-Produktionsumgebung.
#
# SICHERHEIT: Rührt NUR eine eigens angelegte, komplett eigenständige Testzeile in `matches`
# an (matchday=999, match_number=999999) — KEINE bets/combo_bets/profiles, also KEIN
# Guthaben irgendeines echten Nutzers. Die Testzeile wird am Ende per `trap ... EXIT`
# IMMER gelöscht, auch bei einem Fehler/Abbruch mitten im Test. Match-ID 433 wird nicht
# referenziert.
#
# Was wird geprüft: zwei konkurrierende, echte Transaktionen — eine mimt den Kern von
# neutralize_match() (nimmt den Zeilen-Lock via SELECT ... FOR UPDATE, hält ihn künstlich
# für 3s offen, setzt dann status='annulled'), die andere mimt die gefixte, bedingte
# UPDATE-Anweisung aus app/api/admin/settle/route.ts (status NOT IN ('finished','annulled')).
# Die zweite Sitzung startet 1s später, überlappt also absichtlich mit dem künstlichen
# Sleep der ersten und muss auf deren Zeilen-Lock warten. Erwartung: GENAU eine der beiden
# UPDATE-Anweisungen betrifft 1 Zeile, die andere 0 — niemals beide, niemals keine.
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

TEAM_IDS=$(psql "$DATABASE_URL" -t -A -c "select home_team_id || ',' || away_team_id from matches limit 1")
HOME_TEAM_ID=$(echo "$TEAM_IDS" | cut -d, -f1)
AWAY_TEAM_ID=$(echo "$TEAM_IDS" | cut -d, -f2)
if [ -z "$HOME_TEAM_ID" ] || [ -z "$AWAY_TEAM_ID" ]; then
  echo "Konnte keine existierenden team_ids aus matches lesen — ist die Datenbank leer?" >&2
  exit 1
fi

MATCH_ID=$(psql "$DATABASE_URL" -t -A -c "
  insert into matches (match_number, matchday, home_team_id, away_team_id, match_date, status, competition_type, match_category, is_topspiel)
  values (999999, 999, $HOME_TEAM_ID, $AWAY_TEAM_ID, now() + interval '7 days', 'postponed', 'league', 'kreisliga', false)
  returning id;
" | tr -d '[:space:]')
echo "Testspiel angelegt (matchday=999, keine Wetten/Guthaben beteiligt): id=$MATCH_ID"

cleanup() {
  echo "Räume Testspiel $MATCH_ID auf..."
  psql "$DATABASE_URL" -c "delete from matches where id = $MATCH_ID;" >/dev/null 2>&1 || \
    echo "WARNUNG: Aufräumen fehlgeschlagen — bitte manuell prüfen/löschen: delete from matches where id = $MATCH_ID;" >&2
}
trap cleanup EXIT

TMP_DIR=$(mktemp -d)

# Sitzung 1: mimt neutralize_match()'s Kern — Zeilen-Lock nehmen, künstlich 3s halten
# (simuliert die reale Arbeit, die die RPC währenddessen erledigt), dann annullieren.
psql "$DATABASE_URL" -v match_id="$MATCH_ID" -t -A > "$TMP_DIR/session1.out" 2>&1 <<'SQL' &
BEGIN;
SELECT status FROM matches WHERE id = :match_id FOR UPDATE;
SELECT pg_sleep(3);
UPDATE matches SET status = 'annulled', annulled_at = now(), annulment_reason = 'race test'
  WHERE id = :match_id AND status NOT IN ('annulled', 'finished')
  RETURNING 'session1_rows:' || id;
COMMIT;
SQL
PID1=$!

# Sitzung 2: mimt die gefixte, bedingte UPDATE-Anweisung aus settle/route.ts. Start 1s
# später, damit sie absichtlich mit Sitzung 1's künstlichem Sleep überlappt.
sleep 1
psql "$DATABASE_URL" -v match_id="$MATCH_ID" -t -A > "$TMP_DIR/session2.out" 2>&1 <<'SQL' &
BEGIN;
UPDATE matches SET status = 'finished', home_score = 2, away_score = 0
  WHERE id = :match_id AND status NOT IN ('finished', 'annulled')
  RETURNING 'session2_rows:' || id;
COMMIT;
SQL
PID2=$!

wait "$PID1" "$PID2"

echo "--- Sitzung 1 (Annullierung) ---"; cat "$TMP_DIR/session1.out"
echo "--- Sitzung 2 (Abrechnung)   ---"; cat "$TMP_DIR/session2.out"

S1_HIT=$(grep -c "session1_rows" "$TMP_DIR/session1.out" || true)
S2_HIT=$(grep -c "session2_rows" "$TMP_DIR/session2.out" || true)
FINAL_STATUS=$(psql "$DATABASE_URL" -t -A -c "select status from matches where id = $MATCH_ID;")
echo "Endstatus (vor Aufräumen): $FINAL_STATUS"
rm -rf "$TMP_DIR"

if [ "$S1_HIT" = "1" ] && [ "$S2_HIT" = "0" ] && [ "$FINAL_STATUS" = "annulled" ]; then
  echo "BESTANDEN: Annullierung gewann das Rennen, die Abrechnung wurde korrekt zu 0 Zeilen zurückgewiesen."
elif [ "$S1_HIT" = "0" ] && [ "$S2_HIT" = "1" ] && [ "$FINAL_STATUS" = "finished" ]; then
  echo "BESTANDEN: Die Abrechnung gewann das Rennen, die Annullierung wurde korrekt zu 0 Zeilen zurückgewiesen."
else
  echo "FEHLER: Race-Guard versagt — S1 betraf $S1_HIT Zeile(n), S2 betraf $S2_HIT Zeile(n), Endstatus=$FINAL_STATUS. Erwartet: genau einer von beiden betrifft 1 Zeile, nie beide, nie keiner." >&2
  exit 1
fi
