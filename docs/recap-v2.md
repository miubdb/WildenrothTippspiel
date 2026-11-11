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
Gewertet: abgerechnete (won/lost) Scheine, **ohne** Bonus-Tipps, Spieltags-Specials (`matchday_special`), offene, stornierte und komplett neutralisierte Scheine. Normale verlorene Wetten zählen. Teil-neutralisierte Kombis zählen mit den verbleibenden Legs (Sensitivität ohne sie getestet). Offizielle Mindestgrenze (Betreiberentscheidung): **18 abgerechnete Scheine und 10 aktive Spieltage**, keine Mindestzahl an Treffern (würde schwierige Quoten benachteiligen). Wer darunter liegt, gilt als „Noch nicht für die offizielle Rangliste qualifiziert" und sieht seinen berechneten IQ trotzdem selbst (ohne Platz). Die Regel hängt ausschließlich an Scheinen und Spieltagen (Konstanten `IQ_MIN_SLIPS`/`IQ_MIN_MATCHDAYS`), nie an Person oder Trefferzahl – im Prüfskript getestet.

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
- Kleine Stichproben: schon 2 Treffer bei sehr langen Quoten hoben den Index (Michi Dischl, 7 Spieltage, wäre bei der alten 7-Spieltage-Grenze Platz 2 gewesen). Mit der 10-Spieltage-Grenze ist er nicht qualifiziert.
- Es gibt keine Unabhängigkeitsgarantie zwischen Scheinen verschiedener Märkte desselben Spiels.
- Die Punktzahl wurde **nicht** auf eine gewünschte Rangfolge hin optimiert. Die Vorab-Analyse (Xaver 87,8 / Nils 81,8 / Lorenz 78,5 / Mayr 71,3 / Dischl 70,9 / Szymon7 67,9) ist mit anderer Formel entstanden; die Reproduktion der **Rohzahlen** stimmt (Xaver: 11 Gewinnscheine, 4,54 erwartet, 9 Gewinn-Spieltage, 9 Gewinnscheine ≥ 3,00).

### Ergebnis ST 1–15 (`recap-v2-realdata`), Grenze 18 Scheine / 10 Spieltage
19 von 38 Tippern qualifiziert (vorher mit 7 Spieltagen: 23). Der IQ-Wert selbst ändert sich durch die Grenze für niemanden, nur wer einen Platz bekommt:

| Platz neu | Tipper | IQ | Platz alt (7 Sp.) |
|---|---|---|---|
| 1 | Xaver | 92,6 | 1 |
| 2 | Nils | 79,2 | 3 |
| 3 | Szymon7 | 78,4 | 4 |
| 4 | Lorenz Schorer | 76,2 | 5 |
| 5 | Michael Mayr | 69,0 | 6 |
| 6 | Reims | 63,9 | 7 |
| 7–19 | Dennis 55,9 · Jani 54,3 · Jürgen 51,2 · Tobias 51,2 · Maxi 50,0 · Danny Ca$h 49,2 · Benno 48,3 · Felix Rüth 46,8 · Lobi 41,9 · Maxim 28,4 · Ender 26,3 · Markus Weigl 25,8 · Lena K 25,5 | | |

Herausgefallen (≥ 18 Scheine, aber < 10 Spieltage): Michi Dischl (7 Spieltage, IQ 81,3, alt Platz 2), TheZeasy (9, IQ 59,5, alt 8), korbisca (7, IQ 43,6, alt 17), Simon Weigl (9, IQ 21,0, alt 23). Alle anderen rücken nach, die Reihenfolge der Übrigen ist unverändert.

### Stabilität (Spearman-ρ gegen die offizielle Rangliste, 19 Qualifizierte)
Ohne Überschneidungs-Gewichtung 0,972 · margenbereinigte Wahrscheinlichkeit 0,967 · ohne teil-neutralisierte Kombis 0,991 · vier Alternativgewichtungen 0,970–0,996 · Leave-one-matchday-out (jeder der 15 Spieltage weggelassen) 0,923–0,991. **Xaver ist in allen 23 Varianten Platz 1**, die Top 6 bestehen fast überall aus denselben sechs Tippern; Reihenfolge innerhalb Platz 2–5 schwankt je nach Variante.

## Hall der Ehre / Schande
Pro Tipp bzw. Kombi-Leg auf Spielen mit Wildenroth I (Team 14) oder II (40): **win** (Siegtipp: 1X2, Handicap Wildenroth −N, Ergebnistipp), **supportive** (Torschütze, Doppelte Chance mit Wildenroth), **draw**, **against** (Gegner-Sieg, Doppelte Chance ohne Wildenroth-Sieg, Handicap Gegner −N, Ergebnistipp Gegner-Sieg), **neutral** (Tore gesamt, BTTS, Plus-Handicaps, „12"). Neutral ≠ Gegenwette. Ehre = meiste Wildenroth-Spiele mit Siegtipp ohne je eine Gegenwette (≥ 5). Schande = bester Gesamtsaldo der Gegenwetten (≥ 2 aufgegangene). Getrennt ausgewiesen: direkt aus Einzelwetten · **rechnerisch zugeordnet** aus Kombis (Anteil = ln(Quote_leg)/Σ ln(Quote), nur bei gewonnenen Kombis; bei verlorenen nur Legs, die selbst verloren haben, Einsatz/Anzahl verlorener Legs) · Gesamtsaldo inkl. erfolgloser Gegenwetten. Nie wird ein Kombigewinn komplett einem Leg zugeschrieben; zugeordnete Werte sind als solche beschriftet. Wildenroth I/II/gesamt stehen im Bericht (`wildenroth.I/II/all`).

## Awards (nur mit Mindest-Stichprobe, sonst nicht vergeben)
Mehrfachgewinner sind ausdrücklich erlaubt; es gibt keine Vielfalts-Regel. Gleichstände werden in der UI als „Gleichstand" ausgewiesen.
Haupt (10): Quotenflüsterer (IQ), Wildi-Magnet (Netto), Jackpot-König (beste Kombi), Einzelwetten-König (≥ 8 Einzelwetten), Senkrechtstarter, Hall der Ehre, Hall der Schande, Kombi-Fluch (≥ 3 „nur einer falsch"), Stehaufmännchen, Scharfschütze (≥ 3 Präzisionstreffer).
Sonder: Frühbucher, Last-Minute-Tipper, Bester Last-Minute-Gewinntipp, Nachteule (≥ 5, derzeit niemand), Außenseiter-Jäger, Größter Storno-Fehler, Längste Verlust-/Gewinnserie, Wett-Zwillinge, Tragischster Beinahe-Gewinn, **Montagmorgen-Manager** (Mo 6:00–11:59 Europe/Berlin, ≥ 4; DST getestet), **Wildi-Vernichter** (größter Nettoverlust abgerechneter Scheine, ohne Bonus), **Ewiger Optimist** (Wildenroth-Spiele, in denen jeder eigene Siegtipp danebenging, ≥ 3; Zusatz: erneute Siegtipps nach einem Reinfall).
„Bester Tipp der Hinrunde" ist ein eigener Block, getrennt von „bester Tipper" (IQ) und „größter Gewinner" (Netto).

### Zusätzliche Fakten (kein Award, im Recap als „Interessante Fakten")
- **Kombi-Killer:** verlorene Kombis (≥ 2 aktive Legs) mit genau einem falschen und sonst nur richtigen Tipps: **166** (ST 1–15), davon **53** mit Wildenroth I oder II als einzigem Fehler (I: 37, II: 16). Eure frühere Zahl 51 erklärt sich vermutlich dadurch, dass 2 dieser 53 Kombis ein per Regelwerk neutralisiertes Leg enthalten; ohne sie ergeben sich 51. Mit ≥ 3 Legs sind es 35. Spitzenreiter: SC Oberweikertshofen II – Wildenroth 4:1 (11 Kombis von 11 Tippern), Wildenroth – Wildsteig/Rottenbuch 1:2 (6).
- **Ein Tor fehlte:** der einzige falsche Tipp wäre mit +1/−1 Tor bei Heim oder Gast aufgegangen. Nur bei aus dem Endergebnis berechenbaren Märkten (1X2, Doppelte Chance, Handicap, Über/Unter, BTTS, Ergebnis). Ergebnis: **59 von 166**; 95 weitere Fälle brauchen mehr als ein Tor, 12 sind nicht berechenbar (Torschützen u. a.) und bleiben außen vor. Validierung: `settleBet` reproduziert alle 2.377 gespeicherten Leg-Status der berechenbaren Märkte mit 0 Abweichungen. Annulliert/neutralisierte Legs zählen nicht als Fehler oder Treffer; Spiele ohne Endergebnis werden nicht geraten.
- **Montagmorgen:** Sechs Montagvormittage reichen für Xaver und Jani (je 6); regulär öffnet das Wettfenster erst Montag 12:00, deshalb sind die Zahlen klein.

## Datenschutz
Gelöschte Konten (z. B. Protezz) werden weder in IQ, Awards noch Namenslisten genannt; ihre Scheine bleiben in anonymen Gesamtzahlen. Jani läuft normal mit. Der Bericht enthält nur Anzeigenamen/Avatare der genannten Tipper.

## Zukünftige Recap-Typen (nur vorbereitet)
Monats-, persönlicher („Meine Hinrunde", braucht Berechtigungslogik), Wildenroth-Team-, Rekorde-, Saison- und Rückrunden-Recap: `RecapTypeNav` listet Typen und blendet nicht verfügbare aus; `buildRecapReport` und die Stats-Funktionen nehmen beliebige Spieltagsbereiche; `computeWildenrothRecords` hat Scope I/II/alle.

## Offene Entscheidungen
1. Teil-neutralisierte Kombis zählen standardmäßig mit (12 Scheine); Ausschluss ist per Option vorhanden (Sensitivität ρ 0,991).
2. Storno-Fehler beachtet nur `user_cancelled` und nur aus dem Endergebnis bestimmbare Märkte; 18 ältere Stornos ohne Grund bleiben außen vor.
3. „Ein Tor fehlte" für Torschützen-/Cup-Märkte nicht berechenbar (keine belastbaren Torereignisse je Minute/Spieler im Schema).

## Zugriffskontrolle & Caching
Die Entscheidung „darf dieser Betrachter die Auswertung sehen" steht an einer Stelle (`canViewRecapReport`) und wird serverseitig **vor** dem Rechnen ausgewertet: Mitglieder sehen nur veröffentlichte Berichte, Admins ab einem fertigen Spieltag als Vorschau. Es gibt keinen API-Endpunkt, der den Bericht ausliefert; die einzige neue API (`POST /api/admin/recap`) ist admin-only, prüft beim Veröffentlichen die Bereitschaft erneut und schreibt Audit-Log. Seiten sind `force-dynamic` (kein ISR/Full-Route-Cache), nach Veröffentlichen/Zurückziehen `router.refresh()`; Daten werden pro Anfrage frisch berechnet.

## Tests
`node --experimental-strip-types scripts/run-recap-v2-check.mjs` (71 Checks: Normalisierung, Kombi-Einsatz einmal, exakte Statistik, Überschneidungen, Mindestgrenzen, Ausschlüsse, Haltungs-Klassifikation, Kombi-Zuordnung, Serien, Freischaltung, Datenschutz, JSON-Stabilität). `tsc`, `eslint`, `next build` grün. Visuell: Chromium 390 px und 1280 px, hell/dunkel, auch mit sehr langen Namen (keine Überläufe; Gewinnername wird gekürzt, vollständig im „Dahinter"-Text).
