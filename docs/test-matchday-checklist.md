# Test-Spieltag — Pre-Season Testplan (Spieltag 999)

Dieser Testplan ermöglicht einen vollständigen Funktionstest vor Saisonstart,
ohne echte Saison-26/27-Daten zu beschädigen.

---

## Isolation & Schutz

| Schutzmechanismus | Umsetzung |
|---|---|
| Spieltag-Nummer | `999` — kein Konflikt mit echten Spieltagen |
| Wett-Season | `season = 'TEST'` — erscheint nicht in Ranglisten-P&L |
| Cron-Guard | Matchday ≥ 900 wird übersprungen → keine Massen-Pushes |
| Settle-Guard | Inaktivitäts-Strafe + Recap-Push für Matchday ≥ 900 deaktiviert |
| Balance-Snapshot | Guthaben des Test-Users wird vor Seed gespeichert, bei Teardown wiederhergestellt |

**Wichtig:** Der Test ist für den Admin-User gedacht. Andere Nutzer sollen
während des Tests keine Wetten auf Spieltag 999 platzieren.

---

## Beteiligte Tabellen

| Tabelle | Was passiert beim Test |
|---|---|
| `matches` | 6 Zeilen mit `matchday = 999` werden angelegt / gelöscht |
| `bets` | Test-Wetten mit `season = 'TEST'` — werden beim Teardown gelöscht |
| `combo_bets` | Test-Kombis — werden beim Teardown gelöscht |
| `notification_log` | Einträge mit Dedupe-Key `betting-open-999`, `bet-reminder-999-*`, `settlement-*-<matchId>` — werden beim Teardown gelöscht |
| `push_reminders` | Einträge für `matchday = 999` — werden beim Teardown gelöscht |
| `app_settings` | Temporärer Balance-Snapshot `test_balance_snapshot_<userId>` — wird beim Teardown gelöscht |
| `profiles.balance` | Ändert sich während Test (Einsätze / Auszahlungen) — wird beim Teardown wiederhergestellt |

**Nicht verändert:** `app_settings.season_started`, echte 26/27-Wetten, andere Nutzer-Guthaben.

---

## Spielplan Spieltag 999

Die Kickoff-Zeiten sind relativ zur Seed-Zeit (T = Zeitpunkt des Anlegens):

| Spiel | Heim | Gast | Anpfiff | Testzweck |
|---|---|---|---|---|
| A | SpVgg Wildenroth | SC Schöngeising | T + 5 Min | Torschützen-Test, erster Anpfiff |
| B | SV Germering | TSV Hechendorf | T + 30 Min | Normales 1X2 / O-U / BTTS |
| C | TSV Alling | 1. SC Gröbenzell | T + 90 Min | Sichtbarkeit je Anpfiff (später als A+B) |
| D | Gautinger SC | SpFr Breitbrunn | T + 150 Min | Kombi- und Risky-Wette |
| E | SC Fürstenfeldbruck | VfL Egenburg | T + 210 Min | Postpone-Test (wird verschoben) |
| F | FC Landsberied | TSV Geiselbullach II | T + 270 Min | Letzter Anpfiff, vollständiger Spieltag |

---

## Testablauf

### Vorbereitung

- [ ] Admin → Verwaltung → 🧪 Test-Spieltag anlegen
- [ ] Überprüfen: 6 Spiele erscheinen auf der Tipps-Seite (`/tipps?matchday=999`)
- [ ] Quoten prüfen: Sind für Spieltag 999 Quoten berechnet?
  - Falls nein: Admin → Quoten neu berechnen (Spieltag 999 hat keine Saison-Stats → Fallback auf League-Defaults erwartet)

---

### 1. Wetten platzieren (vor Spiel A, innerhalb der ersten 5 Min nach Seed)

- [ ] **Einzelwette auf Spiel A** (SpVgg Wildenroth): 1X2 Heimsieg platzieren
- [ ] **Einzelwette auf Spiel B** (SV Germering): O/U 2,5 platzieren
- [ ] **Kombiwette**: Spiele C + D auswählen → Gesamtquote = Produkt der Einzelquoten prüfen
- [ ] **Risky-Wette**: Wette mit Quote ≥ 20,00 auf Spiel D oder E suchen und platzieren
- [ ] Prüfen: Meine Tipps erscheinen unter „Meine Wetten"
- [ ] Prüfen: Guthaben wurde korrekt abgezogen

---

### 2. Stornierung

- [ ] Wette auf Spiel B stornieren → Guthaben wird gutgeschrieben
- [ ] Neue Wette auf Spiel B platzieren

---

### 3. Sichtbarkeit je Anpfiff

- [ ] **Vor Anpfiff Spiel A**: Tipps anderer erscheinen nicht (Spieltag-Tab zeigt nur Anzahl)
- [ ] **Nach Anpfiff Spiel A** (T + 5 Min): Wetten auf Spiel A sind sichtbar, Spiel B/C/D noch nicht
- [ ] **Nach Anpfiff Spiel B** (T + 30 Min): Wetten auf A + B sichtbar
- [ ] **Kombi mit Spiel C + D**: Wird sichtbar, sobald Spiel C angepfiffen hat (da Stornierung nicht mehr möglich)

---

### 4. Spiel A abrechnen (nach T + 5 Min)

- [ ] Admin → Spieltag → Spiel A auswählen → Ergebnis eingeben (z.B. 2:1 Heimsieg)
- [ ] Wetten werden korrekt abgerechnet (gewonnen/verloren prüfen)
- [ ] Gewonnen-Push kommt beim Test-User an
- [ ] Verloren-Push kommt beim Test-User an (falls verloren)
- [ ] Guthaben aktualisiert sich korrekt

---

### 5. Torschützen-Test (Spiel A: SpVgg Wildenroth)

- [ ] Admin → Quoten → Torschützen → Spieler für Spiel A setzen (falls vorhanden)
- [ ] Torschützen-Wette auf Wildenroth-Spieler platzieren (falls noch offen)
- [ ] Torschützen-Ergebnis eintragen und abrechnen
- [ ] Torschützen-Wette wird korrekt berechnet

---

### 6. Postpone-Test (Spiel E: SC Fürstenfeldbruck – VfL Egenburg)

- [ ] Admin → Spieltag → Spiel E → „Verschieben" → Status = postponed
- [ ] Spiel erscheint in „Verschobene Spiele"-Sektion
- [ ] Offene Wetten auf Spiel E bleiben pending
- [ ] Nachholtermin setzen → Status = scheduled
- [ ] Spiel wieder tippbar (falls Deadline noch nicht vorbei)

---

### 7. Spiel B–D abrechnen

- [ ] Spiel B abrechnen → Einzelwette und Kombi-Leg setzen sich
- [ ] Spiel C abrechnen → weiteres Kombi-Leg
- [ ] Spiel D abrechnen → letztes Kombi-Leg → Kombi wird gewonnen/verloren → Push kommt an
- [ ] Risky-Wette korrekt abgerechnet

---

### 8. Spiel F abrechnen (letzter Anpfiff)

- [ ] Spiel F abrechnen
- [ ] Kein Recap-Push an alle Nutzer! (Guard aktiv für Spieltag 999) ← explizit prüfen
- [ ] Kein Inaktivitäts-Abzug bei anderen Nutzern ← explizit prüfen

---

### 9. Recap & Rangliste

- [ ] `/recap/999` öffnen → zeigt Ergebnisse + Spieltag-Highlights
- [ ] Rangliste: P&L des Testspieltags erscheint **nicht** in der Gesamt-Rangliste (season=TEST)
- [ ] Spieltag-Tab: Spieltag 999 auswählbar, Tipps korrekt angezeigt

---

### 10. Teardown

- [ ] Admin → Verwaltung → 🧪 Test-Spieltag vollständig entfernen
- [ ] Bestätigung: Spieltag 999 nicht mehr auf Tipps-Seite
- [ ] Bestätigung: Guthaben auf Snapshot-Wert zurückgesetzt
- [ ] Bestätigung: Keine pending Wetten für Spieltag 999 in DB
- [ ] Bestätigung: notification_log ohne Einträge für matchday 999

---

## Push-Test (aus Admin-Panel, unabhängig vom Test-Spieltag)

Diese Punkte können jederzeit getestet werden — kein Test-Spieltag nötig:

- [ ] Admin → Verwaltung → Push → Test-Push an mich senden → Push kommt an
- [ ] Push öffnet App und springt zur richtigen Seite (Deep-Link)

---

*Erstellt: 2026-06-18 — Für Pre-Season-Test vor Saisonstart 26/27*
