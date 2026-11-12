# Winter-Recap-Vorschau mit echten Daten (ohne Datenbank)

Das separate Vercel-Testprojekt (`wildenroth-winterrecap`) hat **keine** Supabase-Variablen und kann technisch keine
Datenbank erreichen. Die echte Hinrunde (Spieltag 1–15) liegt als **pseudonymisierter, AES-256-GCM-verschlüsselter
Snapshot** in `lib/recap/snapshot.enc.ts` (das Repo ist öffentlich – nur Chiffretext, nie Klartext, nie der Schlüssel).
Der Schlüssel steckt nur im Vorschau-Link (`/recap-demo/unlock?k=…` → httpOnly-Cookie, danach Redirect ohne Schlüssel).
Ohne Schlüssel zeigt `/recap-demo` erfundene Fixture-Daten. Spieltag 16 wird nur im Speicher simuliert.

Snapshot neu erzeugen (Export per schreibgeschütztem Lesezugriff, kein Schreibzugriff auf Produktion):
`RECAP_DATA_DIR=<dir> RECAP_KEY_OUT=<keyfile außerhalb des Repos> node scripts/build-recap-snapshot.mjs`
Entfernt werden Benutzernamen, E-Mails, Kontostände, Avatare, Admin-Flags; Nutzer-IDs werden durch u01… ersetzt.
Nach Abschluss der Vorschau: Snapshot-Datei löschen (und ggf. aus der Git-Historie entfernen).
