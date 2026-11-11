# Recap V2 – Hinrunden-Recap, Tipper-IQ, Halbzeit-Awards

Stand: Branch `recap-v2` (nicht auf `integration`/`main`). Bestehende Spieltags-Recaps (`/recap/[matchday]`) sind **unverändert**.

## Was gebaut wurde
| Baustein | Datei |
|---|---|
| Wettschein-Normalisierung (gemeinsame Datenbasis aller Recaps) | `lib/recap/slips.ts` |
| Tipper-IQ V1.0 + Sensitivität | `lib/recap/tipperIq.ts` |
| Hall der Ehre / Schande (Haltung je Tipp, Kombi-Zuordnung) | `lib/recap/wildenrothStance.ts` |
| Kennzahlen, Verläufe, Serien, Beinahe-Treffer, bester Tipp, Spaß-Statistiken | `lib/recap/hinrundeStats.ts` |
| Halbzeit-Awards (10 Haupt-, bis zu 10 Sonderstatistiken) | `lib/recap/halbzeitAwards.ts` |
| „Bereit"-Logik + Sichtbarkeit | `lib/recap/availability.ts` |
| Gesamtbericht (reines JSON) | `lib/recap/report.ts` |
| Datenladen (Service-Role, `fetchAllRows`) | `lib/recap/loadRecap.ts` |
| UI: Hub `/recap`, `/recap/hinrunde`, Typ-Umschalter, Admin-Panel | `app/(app)/recap/*`, `components/recap/*` |
| Admin-Freigabe | `app/api/admin/recap/route.ts` (`app_settings.recap_published_hinrunde`, kein Schema-Change, Audit-Log `recap_publish`) |
| Prüfskript (58 Checks, in CI) | `scripts/recap-v2-check.ts` |
| Gegenprobe mit echten Daten (offline) | `scripts/recap-v2-realdata.ts` |

Alles ist für Rückrunde/Saison/Monat wiederverwendbar: die Funktionen nehmen Scheine + Spieltagsbereich (`{from,to}`) entgegen; nichts ist auf „1–16" fest verdrahtet außer der Konstante `HINRUNDE` in `availability.ts`.

## Begriffe (so werden Zahlen bezeichnet)
Wettschein = Einzelwette **oder** Kombi (Kombi-Einsatz einmal). Leg = einzelne Auswahl einer Kombi. abgerechnet = gewonnen/verloren. Beträge nur für abgerechnete Scheine.

Stand der Produktivdaten (Saison 26/27, nur gelesen): **973 Wettscheine** = 291 Einzelwetten + 682 Kombis.
| | Einzel | Kombi | gesamt |
|---|---|---|---|
| gewonnen | 86 | 83 | 169 |
| verloren | 162 | 513 | 675 |
| storniert (void) | 39 | 70 | 109 |
| offen | 4 | 16 | 20 |

Zeilen in `bets`: 2.944 = 291 Einzelwetten + 2.653 Kombi-Legs; Status 1.293 won, 1.262 lost, 303 void, 12 neutralized, **74 pending**. Die 74 offenen Zeilen = 4 offene Einzelwetten + 70 Legs von 16 offenen Kombis (alle Spieltag 16). 109 stornierte Scheine: 89 `user_cancelled`, 18 ohne gespeicherten Grund (ältere Stornos), 2 System-Storno (Torschütze nicht verfügbar). 12 Legs per Regelwerk auf Quote 1,00 neutralisiert (Kombis bleiben aktiv). Kombis über mehrere Spieltage: 0.

## Freischaltung
Bereit, sobald **jeder** Recap-Spieltag 1–16 (effektive Zuordnung: Nachholspiele, Wildenroth II, Topspiele) mind. ein Spiel hat, alle nicht verschobenen/annullierten Spiele beendet sind und keine offene Wette mehr existiert – dieselbe Regel wie `finalizeMatchdayIfDone`, nie nach Datum. „Bereit" ≠ „sichtbar": Mitglieder sehen den Recap erst nach Admin-Freigabe; Veröffentlichen prüft serverseitig erneut die Bereitschaft, Zurückziehen geht immer. Admins sehen vorab eine gekennzeichnete Testansicht (bis zum letzten abgeschlossenen Spieltag). Stand heute: ST1–15 vollständig, ST16 nicht (9 Spiele, 74 offene Zeilen).

## Tipper-IQ V1.0 – „ein spielerischer Qualitätsindex, kein wissenschaftliches Maß"
Gewertet: abgerechnete (won/lost) Scheine, **ohne** Bonus-Tipps, Spieltags-Specials (`matchday_special`), offene, stornierte und komplett neutralisierte Scheine. Normale verlorene Wetten zählen. Teil-neutralisierte Kombis zählen mit den verbleibenden Legs (Sensitivität ohne sie getestet). Mindestgrenze: **18 abgerechnete Scheine und 7 aktive Spieltage**, sonst „Noch nicht gewertet" (Zwischenwert ohne Platz).

Treffererwartung je Schein: `p = 1 / Quote` (roh, Entscheidung des Betreibers). Aus den `p` wird ein z-Wert gegen den Zufall gebildet – **exakt** (Poisson-Binomial-Verteilung der gewichteten Treffer, Mid-p, zurück auf die Normalskala), nicht per Normalnäherung: diese überschätzt seltene Außenseitertreffer stark (2 Treffer bei 0,36 erwarteten wären z = 2,8; exakt ≈ 1,6). Abbildung auf 0–100: `100 · Φ(z/2)`; 50 = genau wie erwartet.

| Gewicht | Baustein | Messung |
|---|---|---|
| 45 % | Quotenbereinigte Trefferqualität | z aus Σ w·(Treffer − p) |
| 20 % | Konstanz | an wie vielen Spieltagen mind. die Spieltags-Erwartung erreicht, gegen die exakte Wahrscheinlichkeit dafür |
| 20 % | Schwierige Treffer | je Spieltag „≥ 1 Gewinnschein mit Quote ≥ 3,00 / ≥ 5,00" gegen die Zufallswahrscheinlichkeit, Mittel beider Schwellen, je Spieltag einmal |
| 15 % | Robustheit | Trefferqualität ohne den Spieltag mit dem größten Überschuss |

**Überschneidungen (anteilige Gewichtung):** identisch = gleiches Spiel + Markt + Auswahl. Kommt ein Ereignis bei einem Tipper in k Scheinen vor, trägt jedes Auftreten 1/k; ein Schein bekommt den Mittelwert seiner Leg-Gewichte. Dreimal derselbe Tipp = ein unabhängiger Tipp; Einzelwette A + Kombi A+B → 0,5 + 0,75. Verschiedene Märkte auf demselben Spiel sind nicht identisch (nur korreliert) und werden nicht abgewertet; `correlatedSameMatchPairs` weist sie als Hinweis aus.

### Einschränkungen (ehrlich)
- `1/Quote` enthält die Hausmarge (12 %, Torschützen 15 %; bei Kombis multipliziert). Das senkt die Erwartung nicht, sondern **erhöht** sie – der Index ist also eher streng. Empirisch (Spieltag 1–15): Einzelwetten 86 Treffer vs. 89,5 (roh) / 79,5 (margenbereinigt); Kombis 83 vs. 69,7 / 51,3. Die Tipper schlagen die Quoten bei Kombis deutlich, also sind die Quoten nicht perfekt kalibriert (z. B. Kombis Quote 25–60: 9,2 % Treffer vs. 2,8 % roh; Einzelwetten Quote 5–10: 36 % vs. 15 %, nur 22 Scheine).
- Kleine Stichproben: schon 2 Treffer bei sehr langen Quoten heben den Index. Michi Dischl (21 Scheine, genau 7 Spieltage, 2 Treffer, 0,36 erwartet) landet so auf Platz 2 – korrekt nach Formel, aber fragil (siehe offene Entscheidung 1).
- Es gibt keine Unabhängigkeitsgarantie zwischen Scheinen verschiedener Märkte desselben Spiels.
- Die Punktzahl wurde **nicht** auf eine gewünschte Rangfolge hin optimiert. Die Vorab-Analyse (Xaver 87,8 / Nils 81,8 / Lorenz 78,5 / Mayr 71,3 / Dischl 70,9 / Szymon7 67,9) ist mit anderer Formel entstanden; die Reproduktion der **Rohzahlen** stimmt (Xaver: 11 Gewinnscheine, 4,54 erwartet, 9 Gewinn-Spieltage, 9 Gewinnscheine ≥ 3,00).

### Ergebnis ST 1–15 (`recap-v2-realdata`)
1 Xaver 92,6 · 2 Michi Dischl 81,3 · 3 Nils 79,2 · 4 Szymon7 78,4 · 5 Lorenz Schorer 76,2 · 6 Michael Mayr 69,0 (23 Tipper gewertet, 15 noch nicht).

### Stabilität (Spearman-ρ gegen die offizielle Rangliste)
Ohne Überschneidungs-Gewichtung 0,983 · margenbereinigte Wahrscheinlichkeit 0,978 · ohne teil-neutralisierte Kombis 0,994 · vier Alternativgewichtungen (25/25/25/25, 60/15/15/10, 55/25/0/20, 35/15/15/35) 0,980–0,997 · Leave-one-matchday-out (jeder der 15 Spieltage weggelassen) 0,922–0,994. **Xaver ist in allen 23 Varianten Platz 1.** Die Plätze 2–5 (Dischl, Nils, Szymon7, Lorenz) tauschen je nach Variante untereinander; Mayr/Reims bleiben dahinter. Die Überschneidungs-Gewichtung verändert die Rangliste kaum (ρ 0,983: nur Nils/Szymon7 tauschen).

## Hall der Ehre / Schande
Pro Tipp bzw. Kombi-Leg auf Spielen mit Wildenroth I (Team 14) oder II (40): **win** (Siegtipp: 1X2, Handicap Wildenroth −N, Ergebnistipp), **supportive** (Torschütze, Doppelte Chance mit Wildenroth), **draw**, **against** (Gegner-Sieg, Doppelte Chance ohne Wildenroth-Sieg, Handicap Gegner −N, Ergebnistipp Gegner-Sieg), **neutral** (Tore gesamt, BTTS, Plus-Handicaps, „12"). Neutral ≠ Gegenwette. Ehre = meiste Wildenroth-Spiele mit Siegtipp ohne je eine Gegenwette (≥ 5). Schande = bester Gesamtsaldo der Gegenwetten (≥ 2 aufgegangene). Getrennt ausgewiesen: direkt aus Einzelwetten · **rechnerisch zugeordnet** aus Kombis (Anteil = ln(Quote_leg)/Σ ln(Quote), nur bei gewonnenen Kombis; bei verlorenen nur Legs, die selbst verloren haben, Einsatz/Anzahl verlorener Legs) · Gesamtsaldo inkl. erfolgloser Gegenwetten. Nie wird ein Kombigewinn komplett einem Leg zugeschrieben; zugeordnete Werte sind als solche beschriftet. Wildenroth I/II/gesamt stehen im Bericht (`wildenroth.I/II/all`).

## Awards (nur mit Mindest-Stichprobe, sonst nicht vergeben)
Haupt (10): Quotenflüsterer (IQ), Wildi-Magnet (Netto), Jackpot-König (beste Kombi), Einzelwetten-König (≥ 8 Einzelwetten), Senkrechtstarter, Hall der Ehre, Hall der Schande, Kombi-Fluch (≥ 3 „nur einer falsch"), Stehaufmännchen, Scharfschütze (≥ 3 Präzisionstreffer). Sonder: Frühbucher, Last-Minute-Tipper, Bester Last-Minute-Gewinntipp, Nachteule (≥ 5, derzeit niemand), Außenseiter-Jäger, Größter Storno-Fehler, Längste Verlust-/Gewinnserie, Wett-Zwillinge, Tragischster Beinahe-Gewinn.
„Bester Tipp der Hinrunde" ist ein eigener Block, getrennt von „bester Tipper" (IQ) und „größter Gewinner" (Netto): Einzel/Kombi nach Mittel der Perzentile aus Quote, Gewinn, Außenseiter-Anteil (und Legs); dazu „Klügster Treffer" (selten gewähltes Leg ≥ 2,00, ≥ 5 Tipper am Spiel) und „Tragischster Schein". Hinweis: ein Tipper kann mehrere Awards gewinnen (Szymon7: Wildi-Magnet, Senkrechtstarter, Stehaufmännchen) – das sind unabhängig berechnete echte Ergebnisse.

## Datenschutz
Gelöschte Konten (z. B. Protezz) werden weder in IQ, Awards noch Namenslisten genannt; ihre Scheine bleiben in anonymen Gesamtzahlen. Jani läuft normal mit. Der Bericht enthält nur Anzeigenamen/Avatare der genannten Tipper.

## Zukünftige Recap-Typen (nur vorbereitet)
Monats-, persönlicher („Meine Hinrunde", braucht Berechtigungslogik), Wildenroth-Team-, Rekorde-, Saison- und Rückrunden-Recap: `RecapTypeNav` listet Typen und blendet nicht verfügbare aus; `buildRecapReport` und die Stats-Funktionen nehmen beliebige Spieltagsbereiche; `computeWildenrothRecords` hat Scope I/II/alle.

## Offene Entscheidungen
1. Mindestgrenze: 7 aktive Spieltage lässt Fälle wie Dischl (2 Treffer) auf Platz 2 zu. Strengere Grenze (z. B. 10 Spieltage) oder Mindestzahl Treffer wäre möglich – nicht entschieden, nicht eingebaut.
2. Teil-neutralisierte Kombis zählen standardmäßig mit (12 Scheine); Ausschluss ist per Option vorhanden.
3. Links vom Spieltags-Recap auf den Hub/Hinrunde fehlen bewusst (Spieltags-Recap blieb unverändert); Einstieg: `/recap`.
4. Nicht berechnet (Daten nicht belastbar): „ein Tor fehlte" (Kombis, die an genau einem Tor scheiterten) und Gaudi-Awards Montagmorgen-Manager/Ewiger Optimist/Kombi-Killer/Wildi-Vernichter.
5. Storno-Fehler beachtet nur `user_cancelled` und nur aus dem Endergebnis bestimmbare Märkte.

## Tests
`node --experimental-strip-types scripts/run-recap-v2-check.mjs` (58 Checks: Normalisierung, Kombi-Einsatz einmal, exakte Statistik, Überschneidungen, Mindestgrenzen, Ausschlüsse, Haltungs-Klassifikation, Kombi-Zuordnung, Serien, Freischaltung, Datenschutz, JSON-Stabilität). `tsc`, `eslint`, `next build` grün. Visuell: Chromium 390 px (hell/dunkel), kein horizontaler Überlauf.
