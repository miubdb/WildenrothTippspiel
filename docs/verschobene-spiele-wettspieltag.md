# Spielverschiebung / eingefrorener Wettspieltag – Regelwerk und Rollout

## Ausgangslage (14.11.2026)
- **ST16, ursprünglich 15.11.2026:** VfL Denklingen – TSV Altenstadt (Match `323`), TSV Türkenfeld – FC Wildsteig/Rottenbuch (Match `260`).
- Beide Partien wurden auf **17.03.2027** gelegt, also in das Zeitfenster von **ST19**.
- **24 offene Wettpositionen in 20 Kombis von 16 Nutzern** betreffen mindestens eine dieser Partien.
- **729 Bestands-Kombis** wurden für den Backfill geprüft: anhand der gespeicherten `betting_open_md_N`-Zeiten enthält keine Kombi widersprüchliche originäre Wettspieltage. Frühere Nachholspiele ST2/7/13/14 machen die BFV-Rohspieltagnummer ungeeignet.
- Matchtermin-/Statusänderung war bereits LIVE; die Codeänderungen in PR #29 und die Schema-Migration sind vor Merge/Review noch NICHT live.

## Business-Regeln
1. **Wettspieltag** = `bets.placed_matchday` pro Wetttipp, `combo_bets.placed_matchday` pro Kombischein; **bei Platzierung festschreiben**. Nie später anhand des BFV-Anpfiffs neu berechnen.
2. **Spieldatum/Status** = lebende `matches.match_date/status`. Relevant für Sperre neuer Wetten, Anstoß, Storno-Sperre, Abrechnung, Wiedervorlage und Anzeige des Nachholspiels im Spielplan.
3. Eine gültige offene oder abgerechnete Wette zählt als Teilnahme am **ursprünglichen** Wettspieltag; `void` (selbst storniert) nicht. Neutralisierte Wetten separat nach dem bestehenden Annullierungs-Regelwerk behandeln.
4. Ein alter, ins Märzfenster verschobener November-Schein begründet **keine** Teilnahme in ST19, belegt **keinen** Normal/Risky-Platz in ST19 und verhindert dadurch keine neuen Tipps. Für ST19 ohne neue gültige Wette greifen die üblichen Inaktivitätsregeln.
5. Die Einsätze verschobener Spiele/Kombis bleiben bis zur echten Abrechnung gebunden. Keine automatische Rückzahlung, keine Umschreibung von Quote, Einsatz, Payout oder Status aufgrund einer bloßen Verschiebung.
6. Nachholspiel wird am tatsächlichen Datum abgerechnet. Die **Finanzergebnisse und Auszeichnungen** gehören dem ursprünglichen Wettspieltag. Wird das nachträglich entschieden, müssen die Auszeichnungen der alten Runde erneut berechnet werden; Push/Strafwildis/Taschengeld der bereits finalisierten Runde dürfen **nicht** erneut gebucht werden.
7. Ein Kombischein ist ein Wettplatz. **Neue gemischte Spieltag-Kombis** werden in diesem Entwurf ausdrücklich zurückgewiesen: Es ist sonst nicht eindeutig, wo derselbe Schein seinen einen Risky- und Auszeichnungsplatz belegt. Die 729 bestehenden Kombis sind alle eindeutig; diese Schutzentscheidung muss Claude kritisch gegen bisherige Produktregeln prüfen.
8. Spieltag-Specials: `match_id` ist nur technischer Fremdschlüssel; Owner ist `matchday_specials.matchday`. Pokal: bestehende Rohspieltag-/Bonusschein-Regeln gelten weiter. Testspieltag `999` nicht in reale Gewinne/Awards/Strafen einrechnen.
9. Wiederholte Verschiebungen, Status `postponed`→`scheduled`→`finished`, Annullierung (`neutralized`), Storno (`void`), frühe Kombi-Niederlage und späte Torschützenabrechnung dürfen kein Duplikat in Guthaben, Rangliste oder Strafwildis erzeugen.

## Datenmodell und Ablauf
- `supabase/immutable_placed_matchday_2026.sql` ergänzt die beiden Spalten, migriert Bestandsdaten anhand historischer Freigabezeitpunkte und passt die atomare `finalize_bet_placement`-RPC an. Die bestehende advisory-lock-Konkurrenzkontrolle wird für neue Calls über `origin_mode` auf den gespeicherten Wettspieltag umgestellt. Alte Calls bleiben während des Rollouts kompatibel.
- `app/api/bets/place/route.ts` übergibt `placed_matchday` an die RPC und prüft die aktuellen Wettplatz-Limits gegen dieses Feld. `lib/risky.ts` und Storno-Reklassifikation nutzen es ebenfalls.
- `lib/matchdayFinalize.ts` verwendet es für die 50-Strafwildis, mit Idempotenz über `push_reminders`, und für das Nachberechnen älterer Awards bei verspäteter Abrechnung.
- Rangliste, Wetthistorie, Admin-Beteiligung, Nutzer-Statistiken, Tagesrecap und Winter-Recap lesen den eingefrorenen Ursprung für Geld-/Teilnahmezuordnung; Matchanzeige und Abrechnung verwenden die aktuelle Spielzeit.
- `components/NavBottom.tsx` gleicht den Badge an den neuen Wettplatz-Zähler an.

## Release-Reihenfolge / Rollback
1. Unabhängige Claude-Review des gesamten PR #29 einschließlich SQL-Funktion, Admin-/Award-Interaktion und Security (SECURITY DEFINER darf nur `service_role` ausführen).
2. CI grün, einschließlich neuer synthetischer Regressionen `scripts/run-postponements-check.mjs`; im Testprojekt nach Möglichkeit einen kontrollierten Vollablauf mit Konto, Kombi, Verschiebung, Abrechnung, Strafwildis und Rückbuchung simulieren.
3. **Datenbank vor App-Deploy** migrieren. Prüfen: `bets` vollständig backfilled, `combo_bets` vollständig backfilled, keine Kombi-/Leg-Widersprüche, insbesondere Match 260 und 323 = ST16.
4. Neue App-Revision aus PR bauen und auf Preview prüfen, insbesondere iPhone, Tabs, Badge, Recaps und Admin; dann Merge/Production. Während Migrationsfenster unterstützen SQL-Fallbacks die alte Produktionsversion.
5. Nach Deployment: neue Testwette unter dem korrekten Matchday platzieren, Storno prüfen, keinerlei Änderung an bestehenden Einsätzen/Quoten/Payouts/Status; erneut denselben Bestandsdaten-Check.
6. Bei Problem: App-Deploy auf vorherige Revision zurückrollen, DB-Spalten erhalten und Daten nicht zurücknummerieren. Die neue RPC besitzt den alten Zählmodus für alte Aufrufe. Niemals `bets` oder `combo_bets` blind löschen.

## Kritische Review-Fragen
- Muss die App gemischte Kombis über mehrere Wettspieltage weiterhin erlauben? Wenn ja: fachliche Owner-Regel und atomare Platzlimit-Abfrage entsprechend erweitern, bevor Merge!
- Ist der historische Backfill über `betting_open_md_N` wirklich eindeutig, inklusive Pokal, Topspiel/Wildenroth II, Sonderfällen und Mehrfachöffnungen? Stichproben und den gesamten Datensatz prüfen.
- Bleiben `push_reminders` als Idempotenzsperre und Pocket-Money-Zahlungen bei API-/DB-Fehlern konsistent? Sind die SQL-Reads gegen Supabase-1000-Zeilen-Deckel abgesichert?
- Sind alle verspäteten Torschützen-/Special-/Kombi-Abrechnungswege vom Aufruf `finalizeMatchdayIfDone` erfasst? Werden alte Awards ohne doppelten Push/−50/+10 aktualisiert?
- Muss ein **veröffentlichter/frozen** Winter-Recap bewusst unverändert bleiben, selbst wenn eine offene November-Kombi im März entschieden wird?
- Prüfe RLS/Auth, `finalize_bet_placement`-RPC-Abuse, Advisory-Lock-Race, refund-before-insert-Race, doppelte Payouts, `void`/neutralized, fehlende Fremdschlüssel, Hand-Edits an Spielterminen und DB-Migrations-Rollback.
