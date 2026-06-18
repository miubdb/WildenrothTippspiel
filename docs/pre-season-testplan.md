# Pre-Season Testplan — SpVgg Wildenroth Tippspiel

Vor Saisonstart diesen Plan einmal vollständig durchlaufen.
Jeder Punkt mit ✅ abhaken wenn er funktioniert.

---

## 1. Registrierung & Onboarding

- [ ] Einladungscode erstellen (Admin → noch kein Panel, direkt in DB: `invite_codes`)
- [ ] Registrierung mit gültigem Code durchführen
- [ ] Wildenroth-Checkbox: einmal mit, einmal ohne — prüfen ob `is_wildenroth` korrekt gesetzt
- [ ] Welcome-Screen (`/willkommen`) erscheint nach Registrierung
- [ ] Bei Registrierung **vor** Saisonstart: `eligible_for_current_season = true` → direkt tippbar
- [ ] Bei Registrierung **nach** Saisonstart: `eligible_for_current_season = false` → Freischaltungs-Meldung sichtbar

---

## 2. Freischaltung & Push

- [ ] Admin → Verwaltung → User freischalten (Sperren/Freischalten-Button)
- [ ] User kann nach Freischaltung tippen
- [ ] App auf Home-Bildschirm installieren (iPhone: Safari → Teilen → Zum Home-Bildschirm)
- [ ] Unter Profil: Benachrichtigungen aktivieren
- [ ] Admin → Verwaltung → Push → Test-Push an mich senden → Push kommt an
- [ ] Push öffnet die App und springt zur richtigen Seite (Deep-Link)

---

## 3. Spieltag wettbar

- [ ] Saisonstart-Flag setzen (Admin → Verwaltung → Saison starten) oder ersten Spieltag anlegen
- [ ] Montag nach 12:00 Uhr: Wettfenster öffnet → „Spieltag offen"-Push prüfen (GitHub Actions Cron)
- [ ] Tipps-Seite zeigt die Spiele des Spieltags
- [ ] Quoten sind sichtbar und plausibel

---

## 4. Einzelwette platzieren

- [ ] Wetttyp wählen (z.B. 1X2 Heimsieg), Einsatz eingeben, absenden
- [ ] Wette erscheint unter „Meine Wetten"
- [ ] Stornierung vor Anpfiff möglich → Guthaben wird zurückgebucht
- [ ] Nach Anpfiff des Spiels: Spiel ist nicht mehr tippbar, andere Spiele des Spieltags noch offen ✓

---

## 5. Kombiwette platzieren

- [ ] Mehrere Picks aus verschiedenen Spielen auswählen → Kombi entsteht automatisch
- [ ] Gesamtquote = Produkt der Einzelquoten (prüfen)
- [ ] Einsatz eingeben und absenden
- [ ] Stornierung vor erstem Anpfiff der enthaltenen Spiele möglich

---

## 6. Risky-Wette platzieren

- [ ] Wettschein mit Quote ≥ 20,00 platzieren → als Risky markiert
- [ ] Nicht möglich wenn bereits 2 normale + 1 Risky vorhanden
- [ ] Risky-Slot separat vom normalen Slot

---

## 7. Tipps-Sichtbarkeit vor/nach Anpfiff

- [ ] Vor Anpfiff: Tipps anderer User in Rangliste / Spieltag-Tab verborgen
- [ ] Nach Anpfiff des **ersten** Spiels: Tipps aller User werden sichtbar
- [ ] Eigene Tipps immer sichtbar

---

## 8. Erinnerungs-Push (2,5 Stunden vor erstem Spiel)

- [ ] GitHub Actions Cron läuft (Minute :07 und :37 jeder Stunde prüfen in Actions-Log)
- [ ] Ca. 2:15–2:45h vor erstem Spiel: Reminder-Push für User mit noch freien Wettscheinen
- [ ] Kein Reminder wenn alle 3 Wettscheine bereits belegt
- [ ] Dedupe: kein zweiter Reminder für denselben Spieltag

---

## 9. Ergebnis eintragen & abrechnen

- [ ] Admin → Spieltag → ausstehende Ergebnisse
- [ ] Heimtore und Auswärtstore eingeben, „Ergebnis & abrechnen" klicken
- [ ] Wetten werden korrekt abgerechnet (gewonnen/verloren)
- [ ] Guthaben der User aktualisiert sich
- [ ] Gewonnen-Push kommt beim Gewinner an
- [ ] Verloren-Push kommt beim Verlierer an

---

## 10. Rangliste & Recap

- [ ] Rangliste zeigt aktuelles Guthaben korrekt
- [ ] Spieltag-Rangliste zeigt P&L des Spieltags
- [ ] Spieltags-Recap (`/recap/{spieltag}`) zeigt Ergebnisse + Rangliste
- [ ] Recap-Push nach Abrechnung aller Spiele

---

## 11. Verschobenes Spiel

- [ ] Admin → Spieltag → Spiel auf „Verschoben" setzen
- [ ] Spiel erscheint in „Verschobene Spiele"-Sektion
- [ ] Offene Wetten auf dieses Spiel bleiben pending
- [ ] Nachholtermin setzen → Spiel geht zurück in „Geplant"
- [ ] Spiel wird nach dem Nachholtermin normal abgerechnet
- [ ] Kombiwetten mit verschobenem Spiel: erst vollständig prüfen wenn alle Legs settled

---

## 12. Abschluss-Check

- [ ] Alle Guthaben stimmen (Startkapital ± Gewinne/Verluste ± Inaktivitätsstrafen)
- [ ] Keine pending Wetten für abgeschlossene Spieltage
- [ ] Push-Fehler-Log im Admin leer (oder bekannte Fehler dokumentiert)
- [ ] GitHub Actions Cron-Log: letzte Läufe erfolgreich (kein 401/500)

---

## Cron-Architektur (zur Erinnerung)

| Scheduler | Intervall | Zweck |
|---|---|---|
| **GitHub Actions** | alle 30 Min (`:07` und `:37`) | **Haupt-Scheduler** für zeitgesteuerte Pushes |
| **Vercel Cron** | täglich 08:00 UTC | Fallback — nicht für zeitkritische Pushes |

Zeitkritische Pushes (Spieltag offen, Tipp-Erinnerung 2,5h vorher) kommen ausschließlich über GitHub Actions.

---

*Erstellt: 2026-06-18 — vor Saisonstart 26/27 durchzuführen*
