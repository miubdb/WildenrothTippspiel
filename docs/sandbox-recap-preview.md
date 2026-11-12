# Winter-Recap-Vorschau mit echten Daten – Sandbox-Plan

Ziel: die **echte** Route `/recap/hinrunde` (Hub, Navigation, Admin-Ansicht, „Mein bester Tipp“) im separaten Vercel-Projekt `wildenroth-winterrecap`
mit dem echten Wildenroth-Datenbestand – verbunden **ausschließlich** mit der Supabase-Sandbox `aspbgawbqwfntvlqtcvl`. Production
(`mpyqtymkdhxuannqhtvp`) wird nur **gelesen**, nie verändert.

## Zustand der Sandbox (geprüft am 12.11.2026, nur lesend)
| Prüfung | Ergebnis |
|---|---|
| Datenbank | online (PostgreSQL 17.11) |
| Schema | **identisch** zu Production: alle 35 Public-Tabellen mit gleicher Spalten-Signatur, 87 Policies; Migrationen bis 22.10.2026 |
| Marker | Tabelle `__sandbox_marker` = `sandbox` (gibt es in Production nicht) |
| Auth | 41 Nutzer, alle mit E-Mail `*@sandbox.invalid`; Profil-IDs **identisch** zu Production; Admin „Jani“ hat ein Test-Login (letzter Login 19.10.) |
| pg_cron / pg_net / HTTP-Funktionen | nicht vorhanden → nichts kann nach außen senden |
| Datenstand | **veraltet** (Snapshot vom 14.10.): letztes beendetes Spiel 18.10., 2.025 Wetten 26/27, 469 Kombis – Production hat inzwischen ~3.040 Wettzeilen / 685 Kombis, Spieltag 1–15 vollständig |
| Differenz Profile | Production 42, Sandbox 41 (ein Profil neu) |

→ Es genügt ein **reiner Daten-Refresh**; Schema, Auth, Logins und App-Einstellungen der Sandbox bleiben, wie sie sind.

## Schritt 1 – Daten aus Production lesen und in die Sandbox laden (du, lokal)
Verbindungsdaten holst du selbst aus dem Dashboard („Connect“ → *Direct connection*); sie gehören nicht in den Chat. `PGOPTIONS` macht die
Production-Sitzung **schreibgeschützt** – ein Schreibversuch bricht mit Fehler ab.
```bash
export PROD_URL='postgresql://…production…'    # nur zum Lesen
export SBX_URL='postgresql://…sandbox…'

# a) Sandbox-Daten leeren (bricht in Production sofort ab, weil dort die Marker-Tabelle fehlt)
psql "$SBX_URL" -v ON_ERROR_STOP=1 -f supabase/sandbox/01_sandbox_truncate_data.sql

# b) Nur Daten (kein Schema) aus Production lesen – ohne private Tabellen, ohne app_settings
PGOPTIONS='-c default_transaction_read_only=on' pg_dump "$PROD_URL" --schema=public --data-only --no-owner \
  --exclude-table-data=public.push_subscriptions --exclude-table-data=public.notification_log \
  --exclude-table-data=public.notification_preferences --exclude-table-data=public.push_reminders \
  --exclude-table-data=public.survey_responses --exclude-table-data=public.audit_log \
  --exclude-table-data=public.bet_comments --exclude-table-data=public.odds_diagnostics \
  --exclude-table-data=public.app_settings -f /tmp/prod_data.sql

# c) in die Sandbox einspielen (FK-Prüfung aus, weil die Reihenfolge der Tabellen im Dump nicht FK-sortiert ist)
( echo "set session_replication_role = replica;"; cat /tmp/prod_data.sql ) | psql "$SBX_URL" -v ON_ERROR_STOP=1

# d) bereinigen (E-Mails zurück auf sandbox.invalid, Auth-Nutzer für das neue Profil)
psql "$SBX_URL" -v ON_ERROR_STOP=1 -f supabase/sandbox/02_after_refresh.sql
```
Nicht kopiert: `auth`-Schema, Push-Abos, Benachrichtigungs-Logs, Umfrageantworten, Audit-Log, Wett-Kommentare, App-Einstellungen.
Namen/Spitznamen und Wettzahlen sind echt (Wunsch); echte E-Mail-Adressen werden sofort überschrieben (Schritt d).

## Schritt 2 – Sandbox-Auth (du)
- Das vorhandene Admin-Login („Jani“ in der Sandbox) bleibt gültig; Passwort vergessen → Supabase Sandbox → Authentication → Users → *Send password recovery* geht nicht
  (`@sandbox.invalid`), dann im SQL-Editor: `update auth.users set encrypted_password = extensions.crypt('NEUES-PASSWORT', extensions.gen_salt('bf')) where id = 'a128ad3d-16e3-4bdd-bc1b-eec0d96dfe9f';`
  (Passwort nur dort eintragen, nie in Chat/Repo).
- Authentication → Providers → Email: **„Allow new users to sign up“ aus**.
- Authentication → URL Configuration: Site URL `https://wildenroth-winterrecap.vercel.app`; zusätzlich Redirect-URL
  `https://wildenroth-winterrecap-git-in-9225eb-michaels-projects-788f49ad.vercel.app`.

## Schritt 3 – Vercel-Verbindung (du, Projekt `wildenroth-winterrecap`; nur Sandbox-Werte!)
Settings → Environment Variables, Ziele *Production* **und** *Preview*:
| Name | Wert |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://aspbgawbqwfntvlqtcvl.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon-Key der **Sandbox** |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role-Key der **Sandbox** (als *Sensitive* speichern) |
Niemals Schlüssel der Production eintragen. *Vercel Authentication* bleibt an (nur Team), die App verlangt zusätzlich das Test-Login.

## Schritt 4 – Nachweis und Datenabgleich (ich)
- `supabase/sandbox/04_parity_check.sql` in Production **und** Sandbox: Zahlen und Hash-Werte müssen identisch sein (Spieltage 1–15 unverändert).
- `GET /api/recap-health` zeigt `{ vercelEnv, database: { ref, kind } }` – muss `kind: "sandbox"` melden. Die Admin-Ansicht auf `/recap/hinrunde` zeigt
  die verbundene Datenbank; zeigt eine Vorschau die produktive DB, erscheint ein roter Warnhinweis und die Simulation ist gesperrt.
- Danach deploye ich den aktuellen `integration`-Stand ins Testprojekt; Spieltag 16 wird nur über `?test=sim16` im Speicher simuliert.

## Schutz im Code
Simulation nur bei `VERCEL_ENV=preview` (oder lokal `development`) **und** Datenbank ≠ Production, nur für Admins, schreibt nie. Veröffentlichen prüft serverseitig
die echte Bereitschaft und ist in der Simulation gesperrt; eine Freigabe in der Sandbox berührt Production nicht.
