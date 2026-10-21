# Match-Annullierung — sicherer Testablauf gegen die Sandbox (`aspbgawbqwfntvlqtcvl`)

**Status: vorbereitet, in dieser Sitzung an keiner Stelle ausgeführt.** Diese Sitzung hat
ausschließlich lesenden MCP-Zugriff auf das **Produktions**-Projekt
(`mpyqtymkdhxuannqhtvp.supabase.co`, über `mcp__Supabase_Wildenroth_Read_Only`) — keinerlei
Zugriff, weder lesend noch schreibend, auf die separate Sandbox `aspbgawbqwfntvlqtcvl`. Jeder
Schritt unten muss vom Nutzer selbst oder einer Sitzung mit echtem Zugriff auf die Sandbox
ausgeführt werden.

**Ziel:** `supabase/match_annulment.sql` (Migration + RPC `neutralize_match`),
`supabase/match_annulment_integration_test.sql` (rollback-sicherer Logiktest) und
`supabase/match_annulment_race_test.sh` (echte Nebenläufigkeitsprobe) in der Sandbox verifizieren,
**bevor** irgendetwas davon gegen Produktion läuft — ohne dabei vorhandene, nicht mit diesem
Test zusammenhängende Sandbox-Daten unnötig zu verändern.

## 0. Vorbedingungen

- Zugriff auf das Sandbox-Projekt `aspbgawbqwfntvlqtcvl` (Supabase-Dashboard oder `psql`).
- Für den Nebenläufigkeitstest: eine **Direct-Connection**-Connection-String (NICHT der Connection
  Pooler/PgBouncer — der kann eine Sitzung mitten im Test auf eine andere physische Verbindung
  umschalten und damit die `FOR UPDATE`-Sperre zwischen den Anweisungen verlieren, was den Test
  wertlos macht). Im Supabase-Dashboard unter *Project Settings → Database → Connection string →
  "Direct connection"* zu finden.
- `psql` lokal installiert (`psql --version`).

## 1. Vor jeder Änderung: Schema-Abgleich bestätigen

Der Nutzer hat bestätigt, dass die fünf für diese Funktion relevanten Tabellen
(`matches`, `bets`, `combo_bets`, `matchday_specials`, `profiles`) in der Sandbox strukturell der
Produktion entsprechen. Trotzdem vor dem eigentlichen Test einmal **lesend** gegenprüfen (keine
Schreiboperation, verändert nichts):

```sql
-- In der Sandbox ausführen, nicht in Produktion.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_name in ('matches', 'bets', 'combo_bets', 'matchday_specials', 'profiles')
order by table_name, ordinal_position;

select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid::regclass::text in ('matches', 'bets', 'combo_bets', 'matchday_specials')
  and contype = 'c'
order by table_name, conname;
```

Insbesondere prüfen, dass **genau diese** Spalten existieren (die Migration/RPC setzt sie voraus):
`bets.special_id`, `bets.void_reason`, `bets.is_risky`, `combo_bets.void_reason`,
`matchday_specials.included_match_ids`, `matchday_specials.representative_match_id`. Fehlt eine
davon, **nicht fortfahren** — das wäre ein echter struktureller Unterschied zur Produktion, kein
Grund, die Migration anzupassen, ohne das vorher zu klären.

## 2. Vorher-Schnappschuss (Beweis, dass nichts anderes verändert wurde)

```sql
select
  (select count(*) from matches) as matches_total,
  (select count(*) from bets) as bets_total,
  (select count(*) from combo_bets) as combo_bets_total,
  (select count(*) from matchday_specials) as specials_total,
  (select count(*) from profiles) as profiles_total,
  (select count(*) from matches where matchday = 999) as matches_testmatchday,
  (select coalesce(sum(balance), 0) from profiles) as balance_sum;
```

Ergebnis notieren (oder `\g sandbox_before.txt` in psql). `balance_sum` ist der wichtigste
Einzelwert — jede Abweichung danach bedeutet, dass irgendwo echtes Guthaben verändert wurde, was
bei einem rollback-sicheren Test **nie** passieren darf.

## 3. Migration anwenden

`supabase/match_annulment.sql` komplett in den Sandbox-SQL-Editor (oder `psql -f`) einfügen und
ausführen. Das Skript selbst:

- erweitert nur CHECK-Constraints (`matches.status`, `bets.status`, `combo_bets.status`) um neue,
  zusätzliche erlaubte Werte — ändert keine bestehende Zeile,
- fügt nur neue, nullable Spalten hinzu (`matches.annulled_at`/`annulment_reason`,
  `bets.neutralized_at`/`neutralized_reason`, `combo_bets.original_total_odds`/`neutralized_at`),
- legt nur die neue Funktion `neutralize_match()` an.

Keine bestehende Zeile wird dabei gelesen oder verändert. Nach der Ausführung den
Vorher-Schnappschuss aus Schritt 2 **sofort erneut** laufen lassen — er muss identisch sein
(die Migration selbst darf den Datenbestand nicht verändern, nur das Schema).

## 4. Logiktest (rollback-sicher)

`supabase/match_annulment_integration_test.sql` komplett im Sandbox-SQL-Editor ausführen. Das
Skript:

- legt eigene Testzeilen unter `matchday = 999` an (4 Spiele, 2 Specials, mehrere Bets/Kombis),
- verwendet zwei **bereits existierende, beliebige** `profiles`-Zeilen als Platzhalter-Nutzer
  (ihr Guthaben wird innerhalb der Transaktion verändert),
- endet mit einem expliziten `ROLLBACK;` — das Skript selbst ist der Beweis, dass es sich zurücksetzt.

Erwartete Ausgabe: eine Notice `INTEGRATIONSTEST: alle ASSERTs bestanden.` Schlägt ein `ASSERT`
fehl, bricht die Transaktion sofort ab (wird ebenfalls automatisch zurückgerollt) — die Fehlermeldung
nennt genau, welche Prüfung fehlschlug.

**Danach den Vorher-Schnappschuss aus Schritt 2 noch einmal ausführen** — er muss wieder exakt
identisch sein (insbesondere `balance_sum` und `matches_testmatchday`), sonst hat der `ROLLBACK`
aus irgendeinem Grund nicht gegriffen und es muss **vor jedem weiteren Schritt** geklärt werden,
warum (z. B. weil das Skript nicht als zusammenhängende Transaktion, sondern Anweisung für
Anweisung mit Autocommit ausgeführt wurde — manche SQL-Editoren tun das; im Zweifel über `psql -f`
ausführen, das führt die Datei als eine Sitzung aus).

## 5. Nebenläufigkeitsprobe (echte Parallelität)

```bash
export DATABASE_URL="<Direct-Connection-String der Sandbox>"
bash supabase/match_annulment_race_test.sh
```

Das Skript legt **zwei eigene, eigenständige** Testzeilen in `matches` an (keine Bets/Kombis/
Guthaben beteiligt), testet beide Reihenfolgen (Annullierung zuerst / normale Abrechnung zuerst)
mit zwei echten parallelen `psql`-Sitzungen und räumt beide Testzeilen danach selbst auf
(`trap ... RETURN`). Erwartete Endausgabe:

```
BESTANDEN: beide Reihenfolgen (Annullierung zuerst / normale Abrechnung zuerst) korrekt serialisiert, keine SQL-Fehler.
```

Jeder andere Ausgang (`FEHLER [...]`, ein psql-Exitcode ≠ 0 in einer der beiden Sitzungen) bedeutet:
**nicht fortfahren**, bis geklärt ist, warum die Race-Guard-Logik nicht wie erwartet greift.

Danach den Vorher-Schnappschuss aus Schritt 2 ein drittes Mal ausführen — `matches_total` sollte
wieder dem Ausgangswert entsprechen (die beiden Testzeilen wurden gelöscht); alles andere
unverändert.

## 6. Falls ein Schritt mitten im Test abbricht (Absicherung)

- **Logiktest (Schritt 4) abgebrochen** (z. B. Verbindungsabbruch mitten in der Transaktion):
  Postgres rollt eine Verbindung, die ohne `COMMIT` abbricht, selbst automatisch zurück — keine
  manuelle Aufräumaktion nötig. Zur Sicherheit trotzdem den Schnappschuss aus Schritt 2 prüfen.
- **Race-Test (Schritt 5) abgebrochen** (z. B. das Skript selbst wurde mit Strg-C beendet, bevor
  der `trap` greifen konnte): manuell aufräumen —
  ```sql
  delete from matches where matchday = 999 and match_number in (999901, 999902);
  ```
  Dieser Befehl ist sicher: er trifft ausschließlich die beiden dedizierten Testzeilen dieses
  Skripts (eindeutig über `match_number`), nie eine echte Begegnung.

## 7. Danach

Erst wenn **alle drei** Schritte (3–5) in der Sandbox fehlerfrei durchgelaufen UND der
Vorher-Schnappschuss jedes Mal unverändert war, ist die Migration/RPC als in dieser Sandbox
verifiziert zu betrachten. Das ist weiterhin **keine** Freigabe für Produktion — dafür bleibt es
bei den bestehenden, expliziten Vorgaben: keine Migration gegen die Produktionsdatenbank ohne
gesondertes Go, keine echte Annullierung von Match-ID 433 ohne gesondertes Go, und ein Merge nach
`main` nur auf ausdrückliche Anweisung.
