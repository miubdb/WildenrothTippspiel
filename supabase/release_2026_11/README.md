# Release 11/2026 – Ausführungsreihenfolge (Supabase SQL-Editor)

| Schritt | Datei | Projekt | Erwartetes Ergebnis |
|---|---|---|---|
| 1 | `01_SANDBOX_umfrage_migrationstest.sql` | **Sandbox** `aspbgawbqwfntvlqtcvl` | Fehlermeldung `SURVEY_REWARD_SANDBOX_TEST (alles zurückgerollt)` mit 11× `OK`, kein `FAIL` |
| 2 | `02_PRODUCTION_backup.sql` | **Production** `mpyqtymkdhxuannqhtvp` | 1 Zeile, `bets_ok = true`, `balance_ok = true`, `functions_saved = 4` |
| 3 | `03_PRODUCTION_migrationen.sql` | **Production** | 1 Zeile `MIGRATION OK`, `legs_260_323_auf_st16 = 40`, 6 neue Funktionen |
| 4 | — (Claude: Merge PR #29, Vercel prüfen) | | |
| 5 | `05_PRODUCTION_umfrage_nachbuchung.sql` | **Production** | Hinweis `Neu gebucht: 1 Empfänger, 100 Wildis`, 1 Journal-Zeile |

Jedes Production-Skript läuft in einer Transaktion und prüft sich selbst; bei jeder Abweichung `ABBRUCH: …` und nichts
ist verändert. 02 überschreibt nie ein vorhandenes Backup, 03 und 05 sind wiederholbar ohne Doppelbuchung.
Alle Skripte wurden vorab gegen einen lokalen PostgreSQL 16 mit demselben Schema-Auszug durchgespielt
(inkl. Abbruch ohne Backup, Wiederholung, Abbruch bei ungeprüfter weiterer Teilnahme).
