# Winter-Recap-Vorschau mit echten Daten – Sandbox-Plan

Ziel: die **echte** Route `/recap/hinrunde` (inkl. Hub, Navigation, Admin-Ansicht, „Mein bester Tipp") im separaten Vercel-Projekt
`wildenroth-winterrecap` mit dem echten Wildenroth-Datenbestand – verbunden **ausschließlich** mit der Supabase-Sandbox
`aspbgawbqwfntvlqtcvl`. Production (`mpyqtymkdhxuannqhtvp`) wird nur **gelesen** (SELECT), nie verändert.

## Stand (12.11.2026)
- Sandbox-Projekt ist **pausiert/inaktiv**: die Datenbank antwortet nicht („Database is possibly not accessible"). Der Datenstand
  (Tabellen, Migrationen, Profile, Spiele, Wetten, Kombis, Auth) ist deshalb noch nicht prüfbar.
- Production: 36 Public-Tabellen (alle mit RLS), 125 Migrationen, 42 Profile, 555 Spiele, ~3.040 Wettzeilen, ~685 Kombis.
  Einziger Job mit Außenwirkung: pg_cron `push-reminders` → Funktion `trigger_push_reminders()` (HTTP-Aufruf der App).
- Die Sandbox bekommt eine **frische Kopie**: sie ist mit Sicherheit nicht auf Production-Stand (Production hat Migrationen bis 22.10.2026).

## Schritt 0 – Sandbox reaktivieren (du)
Supabase-Dashboard → Projekt „Wildenroth Redesign Sandbox" → Banner „Project paused" → **Restore project**. Dauert wenige Minuten.
(Pausierte Free-Projekte lassen sich innerhalb von 90 Tagen wiederherstellen; danach nur noch als Backup herunterladen – sag Bescheid,
falls der Button fehlt.) → Danach melde dich, ich prüfe den Zustand per lesendem Notebook.

## Schritt 1 – Schema + Daten kopieren (du, lokal; Production nur lesend)
Verbindungsdaten holst du selbst aus dem Dashboard („Connect" → *Direct connection*); sie gehören nicht in den Chat. `PGOPTIONS` erzwingt,
dass die Production-Sitzung **schreibgeschützt** ist – ein Schreibversuch würde mit Fehler abbrechen.
```bash
export PROD_URL='postgresql://…production…'     # nur zum Lesen
export SBX_URL='postgresql://…sandbox…'

# a) Sandbox leeren (NUR Sandbox!) – im Skript steht die Bestätigungszeile
psql "$SBX_URL" -c "set app.sandbox_ack='ja-nur-sandbox'" -f supabase/sandbox/01_sandbox_reset_public.sql   # Sitzung beachten: beide in EINER psql-Sitzung

# b) Schema (ohne Daten) und Daten (ohne private Tabellen) aus Production lesen
PGOPTIONS='-c default_transaction_read_only=on' pg_dump "$PROD_URL" --schema=public --schema-only --no-owner -f /tmp/prod_schema.sql
PGOPTIONS='-c default_transaction_read_only=on' pg_dump "$PROD_URL" --schema=public --data-only --no-owner \
  --exclude-table-data=public.push_subscriptions --exclude-table-data=public.notification_log \
  --exclude-table-data=public.notification_preferences --exclude-table-data=public.push_reminders \
  --exclude-table-data=public.survey_responses --exclude-table-data=public.audit_log \
  --exclude-table-data=public.bet_comments --exclude-table-data=public.odds_diagnostics -f /tmp/prod_data.sql

# c) in die Sandbox einspielen (Daten mit deaktivierten FK-Prüfungen, weil auth.users erst danach entsteht)
psql "$SBX_URL" -v ON_ERROR_STOP=1 -f /tmp/prod_schema.sql
( echo "set session_replication_role = replica;"; cat /tmp/prod_data.sql ) | psql "$SBX_URL" -v ON_ERROR_STOP=1
```
Nicht kopiert: `auth`-Schema (Passwörter, Tokens, Sitzungen), Push-Abos, Benachrichtigungs-Logs, Umfrageantworten, Audit-Log,
Wett-Kommentare. E-Mail-Adressen werden in Schritt 2 anonymisiert. Namen/Spitznamen und Wettzahlen bleiben echt (Wunsch).

## Schritt 2 – Bereinigen + Test-Authentifizierung (du, Sandbox-SQL-Editor)
1. `supabase/sandbox/02_after_restore_sanitize.sql` – schaltet pg_cron/Push ab, anonymisiert E-Mails, legt Auth-Nutzer **ohne Passwort** an.
2. `supabase/sandbox/03_set_test_login.sql` – ein einziges Test-Login (Admin-Profil). Passwort denkst du dir neu aus und trägst es nur dort ein.
3. Supabase Sandbox → Authentication → Providers → Email: **„Allow new users to sign up" ausschalten** (niemand kann sich selbst registrieren).
4. Authentication → URL Configuration: Site URL = Domain des Testprojekts (`https://wildenroth-winterrecap.vercel.app`) und die Branch-Alias-URL
   `https://wildenroth-winterrecap-git-in-9225eb-michaels-projects-788f49ad.vercel.app` als Redirect-URL.

## Schritt 3 – Vercel-Verbindung (du, Projekt `wildenroth-winterrecap`; nur Sandbox-Werte!)
Settings → Environment Variables, Ziele *Production* **und** *Preview*:
| Name | Wert |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://aspbgawbqwfntvlqtcvl.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon-Key der **Sandbox** |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role-Key der **Sandbox** (als *Sensitive* speichern) |
Niemals Schlüssel der Production eintragen. Schutz: *Vercel Authentication* bleibt an (nur Team-Mitglieder), die App verlangt zusätzlich das Test-Login.

## Schritt 4 – Nachweis und Datenabgleich (ich)
- `GET /api/recap-health` liefert nur `{ vercelEnv, database: { ref, kind }, simulationAllowed }` – muss `kind: "sandbox"` zeigen. Zusätzlich zeigt
  die Admin-Ansicht auf `/recap/hinrunde` die verbundene Datenbank; zeigt eine Vorschau die produktive DB, erscheint ein roter Warnhinweis und die
  Simulation ist gesperrt (`lib/recap/environmentGuard.ts`).
- `supabase/sandbox/04_parity_check.sql` in Production **und** Sandbox: Zahlen und Hash-Werte müssen identisch sein (Spieltage 1–15 unverändert).
- Danach deploye ich den aktuellen `integration`-Stand in das Testprojekt; Spieltag 16 wird nur über `?test=sim16` im Speicher simuliert.

## Schutz in Code
- Simulation: nur `VERCEL_ENV=preview` (oder lokal `development`) **und** Datenbank ≠ Production; nur für Admins; schreibt nie.
- Veröffentlichen prüft serverseitig die echte Bereitschaft und ist in der Simulation gesperrt; die Sandbox-Freigabe berührt Production nicht.
