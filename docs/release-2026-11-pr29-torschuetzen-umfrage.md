# Release 11/2026: unveränderlicher Wettspieltag (PR #29), Torschützen-Abrechnung, 100-Wildis-Umfragedank

## Migrationen (Reihenfolge zwingend, beide idempotent)
1. `supabase/immutable_placed_matchday_2026.sql` – `placed_matchday` + Backfill + Trigger, saisonbewusste
   `finalize_bet_placement`, atomare `settle_bet` / `settle_combo` / `void_slip_refund` / `book_matchday_round`.
2. `supabase/survey_reward_2026.sql` – Buchungsjournal `balance_transactions` (UNIQUE user/kind/ref, RLS: nur eigene Zeilen
   lesbar) und `grant_survey_reward` (nur `winter_2026_v2`, nur abgeschickte Datensätze, Betrag fest 100, nur service_role).
3. Erst danach App-Deploy (main). Die alte App läuft mit beiden Migrationen weiter (rückwärtskompatibel).

## Torschützenwetten
- Ursache Match 413: die Admin-UI rief `/api/admin/goalscorers/scorers` nur bei nicht-leerer Liste auf; die normale
  Ergebnisabrechnung schließt Torschützenwetten aus. Der angebliche Fix-Commit `985b251…` existiert im Repository nicht.
- Jetzt serverseitig (`lib/goalscorerSettlement.ts`): `/api/admin/settle` rechnet bei **0 Wildenroth-Toren** (I oder II, Heim
  oder Gast, aus dem gespeicherten Ergebnis) alle offenen Torschützenwetten automatisch als verloren ab.
- Hat Wildenroth getroffen, wird nichts angenommen: die Liste muss genau die Wildenroth-Tore erklären
  (Spielertore + als Eigentor markierte Tore). Unvollständig oder zu viel → 400, nichts gespeichert, nichts abgerechnet.
  Die Admin-UI meldet offene Torschützenwetten.
- Abrechnung nur für `finished`-Spiele; Auszahlung über `settle_bet`/`settle_combo` (keine Doppelzahlung, Retry sicher).

## Umfrage-Dankeschön
- Bei Absenden einer vollständigen Production-Umfrage bucht `/api/survey` serverseitig 100 Wildis; scheitert die Buchung,
  holt der nächste Seitenaufruf/Save sie nach. Bearbeiten bucht nie erneut und nie zurück.
- Kontrollübersicht/Nachbuchung: `GET`/`POST /api/admin/survey/rewards` (POST beliebig oft wiederholbar).
- Anzeige: Hinweis auf der Startseite, Bestätigung nach dem Absenden, „Sonderbuchungen“ im Profil.

## Tests
- `scripts/run-settlement-integrity-check.mjs` (CI): 0:0, 0:5, 5:0, Heim/Gast, I/II, Eigentore, unvollständige Liste,
  offene/verlorene Kombis, Wiederholung, parallele Aufrufe, fehlgeschlagene Gutschrift + Retry, Umfrage-Fälle.
- `scripts/placed-matchday-migration-test.mjs` (PGlite) und `scripts/settlement-race-test.sh` (lokaler Wegwerf-Postgres, echte
  parallele Sitzungen: settle_bet, settle_combo, Storno-vs-Abrechnung, Umfrage, Taschengeld, Platzierung).

## Rollback
- App: Vercel auf das vorherige Production-Deployment zurücksetzen. Die Migrationen sind rückwärtskompatibel und bleiben.
- Daten: Tabellenkopien in `release_backup_20261114_pr29` dienen dem Abgleich, **nie** dem blinden Zurückspielen.
