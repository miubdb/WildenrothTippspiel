# Finalisierung 26/27 — Abschlussbericht

Alle 19 Punkte der Finalisierungsliste sind bearbeitet und auf `main`. Diese Datei kann gelöscht werden.

## Vollständige Commit-Liste (chronologisch)

f4b710d Wett-Validierung berücksichtigt Admin-Overrides
2279413 Punkt 1 — Spieltagsauswahl numerisch sortiert
63ae4db Punkt 4 — Über/Unter-Quoten: Liga-Basiswert korrigiert, Ü/U 7,5 entfernt
df57d07 Punkt 4 — Abwehr-Vorzeichen, Quoten-Untergrenze, Hedging-Sperre
1f2ec2d Punkt 5 — Torschützenmarkt wieder funktionsfähig
04a6a81 Handicap-COI-Lücke geschlossen (Nutzer-Entscheidung 2)
b4dbf8a Punkt 3 — Handicap-Hilfetext + Labels
668b466 Punkt 6+7 — Tabelle/Teamseiten Vorsaison-Fallback, Torjäger-Karte
93efb9f Punkt 8+9 — Kader ausgeblendet, Herrsching-Wappen
97fda1f Punkt 15 — Inaktivitätsstrafe 100 → 50
2553c1c Punkt 14 dokumentiert (Fix lag in Supabase, siehe unten)
e997efa KRITISCH — RLS-Leck combo_bets behoben
9c061d2 KRITISCH — Saison-Kollision Dedupe, Goalscorer-Recap-Lücke
a010c16 Recap/Awards — Cross-Spieltag-Kombiwetten-Doppelzählung, Tiebreaks
ee4bc40 Admin — Wildenroth-II-Torschützen-Recompute, Saisonfilter
e4585a9 Push — fehlende RLS-INSERT-Policy, falsche Spieltag-Gruppierung
416b1d5 Auth — anon-Profilzugriff eingeschränkt, ILIKE-Injection, redirectTo
1b34b00 Punkt 13 — Hilfe-Seite aktualisiert

Plus DB-only (kein Git-Commit): Landsberg-II-Favorit (Nutzer-Entscheidung 1),
Wildenroth-II-Kaderdaten (Nutzer-Entscheidung 3), Taschengeld-Fix (Punkt 14),
diverse RLS/GRANT-Migrationen.

## Die wichtigsten Funde

**Kritisch (echtes Geld/Datenlecks):**
1. **Über/Unter-Quoten**: Liga-Torbasis war 36 % zu niedrig (2,35 statt real 3,67 Tore/Spiel)
2. **Quoten-Untergrenze**: erzeugte handfeste Arbitrage (garantierter Gewinn)
3. **combo_bets RLS-Leck**: jeder eingeloggte Nutzer konnte fremde Kombiwetten Wochen vor
   Anpfiff einsehen (Einsatz, Quote, Auszahlung) — falsches Zeitfenster in der Datenbank-Policy
4. **profiles RLS-Leck**: Guthaben, Admin-Status und Wildenroth-Flags aller Nutzer waren ohne
   Login über die Supabase-API auslesbar
5. **push_reminders Saison-Kollision**: hätte Recap-Push UND Inaktivitätsstrafe für Spieltag
   24/25/26 dieser Saison stillschweigend für immer blockiert (Kollision mit Test-Daten von
   letzter Saison)
6. **notification_preferences ohne INSERT-Policy**: die meisten Nutzer bekamen nie eine
   Präferenzen-Zeile angelegt → Push-Benachrichtigungen liefen für sie ins Leere

**Hoch (Kernfunktionalität kaputt):**
7. Torschützenmarkt lief komplett leer (vier unabhängige Ursachen)
8. Kombiwetten-Doppelzählung bei echten Pokalen (Spieltagskönig etc.), nicht nur in der Anzeige
9. Wildenroth-II-Torschützen-Recompute im Admin-Bereich war komplett kaputt
10. Cron-Benachrichtigungen gruppierten nach falscher Spieltag-Logik

## Detail-Zusammenfassung je Punkt

**1 — Spieltagsauswahl**: numerisch sortiert statt chronologisch (`1-3-4-5-6-13-7-2-8...` behoben).
Wettfenster-Gate bleibt bewusst chronologisch.

**2 — Spielpläne**: 372/372 Spiele exakt geprüft, keine Abweichung zur DB.

**3 — Handicap**: Texte des Nutzers waren fachlich korrekt; Hilfetext ergänzt, Labels vereinheitlicht.

**4 — Quoten**: Kernfehler war die Liga-Torbasis. Zusätzlich: Abwehrstärke falsch skaliert,
Quoten-Untergrenze erzeugte Arbitrage, Ü/U 7,5 entfernt.

**5 — Torschützen**: Datenlücke (alle Spieler 0 Spiele/Minuten), fehlender Saisonwechsel-Fallback,
falscher DB-Client beim Einfrieren, keine Wildenroth-II-Unterstützung — alle vier behoben.

**6+7 — Tabelle/Teamstatistik**: `hasCurrentSeasonData`-Flag ersetzt Ad-hoc-Checks; echte
Vorsaison-Karten statt "noch nicht gestartet"; Torjäger-Karte neu.

**8+9 — Kader/Wappen**: Kader für Nicht-Admins ausgeblendet; Herrsching-Wappen gemappt.

**10 — Rangliste/RLS**: Ranglisten-Rechnung korrekt. Zwei Bugs: das kritische combo_bets-RLS-Leck
(oben) und ein mit gesamter Saison statt Spieltag verrechneter "N Wettscheine platziert"-Zähler.

**11 — Recap**: Grundmechanik korrekt (Spieltag "truly done" = alle Spiele fertig + keine
offenen Wetten). Zwei kritische Bugs behoben: Saison-Kollision im Dedupe, fehlender
Recap-Push/Inaktivstrafe bei Torschützen-getriebenem Abschluss. Plus: Kombiwetten-Doppelzählung,
Tiebreak-Abweichung zwischen Live-Vorschau und persistierten Pokalen, Testspieltag-Guard.

**12 — Awards**: alle 7 Pokale gegen den Code verifiziert (siehe unten). Kombiwetten-Doppelzählung
war der einzige echte Fehler — betraf die tatsächlich vergebenen Pokale, nicht nur die Anzeige.

**13 — Hilfe-Seite**: "Verschobene Spiele"-Abschnitt war komplett veraltet (neue >7-Tage-Regel
fehlte), Risky-Schwelle falsch formuliert (≥20 statt >20), Handicap-Sperre nicht erwähnt,
Kombi-Möglichkeit bei "Eier aus Stahl" nicht erwähnt, Gegenwetten-Sperre nicht dokumentiert.

**14 — Taschengeld**: Mechanismus liegt in Supabase (pg_cron + Postgres-Funktion, nicht im
Next.js-Code). Zwei Bugs: lief ungefiltert über alle Profile (auch nicht-berechtigte), keine
Doppelausführungs-Sperre. Beide behoben. Termin-Logik (17.08.2026) war bereits korrekt.

**15 — Inaktivitätsstrafe**: 100 → 50 Wildis.

**16 — Admin**: Wildenroth-II-Torschützen-Recompute war komplett kaputt (falsche Team-Auflösung).
Vier Admin-Ansichten zeigten Vorsaison-Daten vermischt mit der aktuellen Saison (kein Season-Filter).
Reschedule-Lücke (Testspieltag-Bereich) geschlossen.

**17 — Benachrichtigungen**: fehlende RLS-INSERT-Policy (kritisch, oben), falsche Spieltag-Gruppierung
im Cron. Der Goalscorer-Recap-Gap war bereits durch den Recap-Fix miterledigt.

**18 — Login/Registrierung**: profiles-RLS-Leck (kritisch, oben), ILIKE-Injection in der
Namens-Eindeutigkeitsprüfung, fehlendes redirectTo nach Login.

**19 — Abschluss-Audit**: `npx tsc --noEmit` und `npm run build` laufen nach jeder Änderung sauber
durch (finale Prüfung: 39 Routen erfolgreich gebaut, keine Type-Fehler). Verbleibende Lint-Warnungen/
-Fehler sind alle vorbestehend in Dateien, die diese Session nicht angefasst wurden (verifiziert).

## Die 7 Awards — wie sie tatsächlich vergeben werden

1. **🏆 Spieltagskönig** — bester Netto-Saldo (Einzel- + Kombiwetten) des Spieltags. Muss > 0 sein,
   sonst kein Gewinner. Kein expliziter Tiebreak bei exaktem Gleichstand.
2. **🥚 Eier aus Stahl** — höchste Quote unter *gewonnenen* Wetten (Einzel oder Kombi).
3. **😭 Unlucky Bastard** — nur Kombiwetten: genau 1 verlorenes Bein bei ≥2 Beinen insgesamt,
   höchster möglicher Gewinn (Einsatz × Quote) unter den Kandidaten.
4. **🔮 Ergebnis-Orakel** — gewonnene exakte-Ergebnis-Wette, nur als Einzelwette (nicht in Kombi),
   höchster Einsatz gewinnt bei Gleichstand.
5. **🚽 Griff ins Klo** — höchster verlorener Einsatz (Einzel + Kombi gemeinsam), Tiebreak: höherer
   möglicher Gewinn.
6. **🧱 Betonmischer** — niedrigste Quote unter gewonnenen Wetten, Tiebreak: höherer Einsatz.
7. **🔥 On Fire** — meiste gewonnene Wettscheine (min. 2), Tiebreak: höherer Saldo.

Alle sieben: maximal ein Gewinner pro Spieltag und Typ; derselbe Nutzer kann denselben Award an
mehreren Spieltagen gewinnen (zählt im Pokalschrank als „×N"). Kombiwetten wurden bis zu diesem
Fix bei Spieltag-übergreifenden Wetten auf mehreren Spieltagen gleichzeitig voll gezählt — jetzt
genau einmal, beim frühesten betroffenen Spieltag.

## Taschengeld & Inaktivität — Bestätigung

- **10 Wildis** jeden Montag 12:00 Uhr Europe/Berlin, ab **17.08.2026** (durch den bereits
  korrekten Saisonstart-Guard in der DB-Funktion) — jetzt zusätzlich auf berechtigte Nutzer
  beschränkt und gegen Doppelausführung abgesichert.
- **Inaktivitätsstrafe: 50 Wildis** (war 100) bei komplett ausgelassenem Spieltag.

## Benachrichtigungen — Liste

| Benachrichtigung | Trigger | Zielgruppe | Dedupe |
|---|---|---|---|
| Spieltag wettbar | Cron (30-Min-Takt) | alle Push-Abonnenten | notification_log, jetzt korrekt nach effektivem Spieltag gruppiert |
| Wettscheine noch frei | Cron, 2,5h vor Anpfiff | Nutzer mit freien Slots | notification_log |
| Wette abgerechnet | Settle-Route | einzelner Nutzer | notification_log |
| Torschütze gewonnen/verloren | Goalscorer-Settle-Route | einzelner Nutzer | notification_log |
| Spieltags-Recap | Settle/Goalscorer-Route (spieltagTrulyDone) | alle Push-Abonnenten | push_reminders (jetzt saisonsicher) |
| Reaktion/Kommentar | sofort bei Aktion | betroffener Nutzer | notification_log |

Alle funktionieren jetzt korrekt; vorher blockierte die fehlende RLS-INSERT-Policy die meisten
Nutzer komplett.

## Login/Registrierung — aktueller Workflow

Registrierung: 3-Schritt-Assistent (Name → E-Mail → Passwort), optionales "Wildenroth-Spieler"-Flag.
Name-Eindeutigkeit wird vor Anmeldung geprüft (jetzt ohne ILIKE-Injection-Lücke). Profil wird per
DB-Trigger angelegt, Berechtigung für die aktuelle Saison automatisch gesetzt (außer Saison hat
bereits begonnen). Login per E-Mail/Passwort, leitet jetzt korrekt zur ursprünglich angeforderten
Seite weiter (`redirectTo`, nur relative Pfade erlaubt). `profiles`-Tabelle ist jetzt gegen
anonymen Zugriff auf sensible Spalten (Guthaben, Admin-Status, Berechtigung) abgesichert.

## Spielplan — Ergebnis

Keine Abweichung zwischen PDF und Datenbank gefunden (372/372 Spiele exakt, inkl. Sommer-/
Winterzeit-Umrechnung).

## Offene Punkte (keine Code-Änderung nötig, nur zur Kenntnis)

- `getRosterFactor` kann strukturell nur nach unten wirken (Zugänge haben keine Vorwerte) →
  ligaweit ca. −6 %. Keine Nutzer-Entscheidung dazu eingeholt, niedrige Priorität.
- Wildenroth-II-Torschützen haben keine Vorsaison-Daten in `league_players` (nur die 1. Mannschaft
  wurde für andere Gegner erfasst) — Markt bleibt dort ohne weitere Dateneingabe auf 0.
- Mehrere kleinere, niedrig priorisierte Admin-/UI-Befunde aus dem Audit wurden bewusst nicht
  angefasst (z. B. doppelter B-Klasse-Topspiel-Auswahlmechanismus, fehlende Freitext-Suche in der
  Admin-Spielliste) — rein kosmetisch/Komfort, kein Korrektheitsproblem.

## Tests

- `npx tsc --noEmit`: sauber nach jeder Änderung
- `npm run build`: 39 Routen erfolgreich, zuletzt verifiziert
- `npm run lint`: verbleibende Warnungen/Fehler alle vorbestehend, keine Regressionen
