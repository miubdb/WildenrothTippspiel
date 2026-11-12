# Audit der Halbzeit-Awards (ST 1–15)

Methode: Jeder Award wurde **unabhängig von `lib/recap/*`** per SQL direkt auf den Produktivtabellen `bets`, `combo_bets`, `matches`, `profiles` (nur lesend) nachgerechnet; nur die Spieltag-Zuordnung (`recapMatchdayOf` → 142 Spiele ST 1–15) wurde als Liste übernommen. Ergebnis: **alle Gewinner und Werte stimmen mit der TypeScript-Berechnung überein**; die Abweichungen zu eurer früheren Analyse hatten fachliche (Definitions-)Gründe, die unten stehen, plus ein echter Programmfehler (Nachteule). Der Tipper-IQ wurde nicht angefasst.

Gemeinsame Basis: Saison 26/27, Wettschein = Einzelwette oder Kombi (Einsatz einmal), Spieltag = frühester Recap-Spieltag der Legs, gelöschte Konten ausgeschlossen. Netto = Auszahlung − Einsatz (won) bzw. −Einsatz (lost); stornierte/offene/neutralisierte Scheine 0. Kombi-Legs mit Quote 1,00 (neutralisiert) zählen nicht als Treffer oder Fehler.

## Fehler und Korrekturen
| # | Befund | Ursache | Korrektur |
|---|---|---|---|
| 1 Hall der Schande | Hengsti (+8) statt Michael Mayr (+192,50) | **Von mir erfundene Hürde** „mind. 2 aufgegangene Gegen-Tipps" schloss jeden mit einem einzigen (aber großen) Treffer aus | Hürde entfernt: Rang nach Gesamtsaldo, Bedingung nur „mind. ein aufgegangener Gegen-Tipp, Saldo > 0" |
| 2 Nachteule | kein Award, obwohl Szymon7 7 Nachtscheine hat | **Programmfehler**: Stundenermittlung lieferte `NaN` (`de-DE` formatiert „01 Uhr"), dazu schloss der Filter später stornierte Scheine aus | Stunde über `en-GB` (Test ergänzt); Fenster 0:00–5:59; Zählung aller abgegebenen Scheine inkl. später stornierter (Bonus ausgenommen) |
| 3 Hall der Ehre | Nils 18 vs. 14 | andere Zählweise: Nils hat **18 Siegtipps (Legs)**, aber nur **9 verschiedene Spiele** – wiederholte gleiche Tipps in mehreren Kombis | gewertet werden **verschiedene Spiele**; die Zahl aller Siegtipps steht jetzt daneben; Gleichstände werden angezeigt |
| 4 Einzelwetten-König | Summe statt bester Schein | zwei verschiedene Kategorien unter einem Namen | **Einzelwetten-Profi** (Gesamtnetto aller Einzelwetten) und **Größter Einzelwetten-Treffer** (höchster Nettogewinn eines Scheins), ebenso **Größter Kombi-Treffer**; Jackpot-König bleibt die Gesamtwertung |
| 5 Kombi-Fluch | knapp gescheitert ≠ Dauerflaute | zwei Leistungen | **Kombi-Fluch** (knapp gescheitert, Mayr 9) und **Kombi-Flaute** (≥ 10 Kombis ohne einen Gewinn, Maxim 22) |
| 6 Storno-Fehler | 2.049 statt 1.949 | Anzeige zeigte die **Auszahlung**, eure Zahl war der **Nettogewinn** | Ranking nach entgangenem Nettogewinn; Einsatz, Quote und mögliche Auszahlung stehen daneben. Gleiches für „Tragischster Beinahe-Gewinn", Kombi-Fluch-Summe, Kombi-Killer und „Ein Tor fehlte" |
| 7 Last-Minute-Tipper | Lena K statt Danny Ca$h (9,88 s) | der Award maß den **Median-Abstand** (Gewohnheit), nicht den einzelnen Schein; Dannys 9,88-s-Schein ist **verloren** (also kein Gewinntipp) | umbenannt in **„Auf den letzten Drücker"** (Median) mit Erklärung; neu **„Spätester Schein"** (egal ob gewonnen/verloren/storniert: Danny 9,9 s) neben **„Bester Last-Minute-Gewinntipp"** (Tobias 17,7 s) |
| 8 Wett-Zwillinge | Ähnlichkeit vs. identischer Gewinnschein | zwei Kategorien | **Wett-Zwillinge** (höchste prozentuale Übereinstimmung) und **Zwillings-Treffer** (identischer gewonnener Kombischein bei ≥ 2 Tippern) |
| zusätzlich | Wildi-Vernichter schloss Bonus-Tipps aus | Bonus-Tipps haben echten Einsatz und Auszahlung (Nils/Marius −100, Jani +57,50, Ender +35) | gleiche Basis wie Wildi-Magnet (inkl. Bonus), nur umgekehrt → **Dennis −1.130** (vorher Jani −1.167,50 ohne Bonus; Jani −1.110 mit) |
| zusätzlich | bei Gleichstand fiel zufällig jemand aus der Top 3 | feste Anzeige von 3 Einträgen | alle Gleichplatzierten auf Platz 3 werden gezeigt (max. 6) |

Zeitbezogene Awards zählen **alle abgegebenen Scheine** (auch später stornierte), weil das Abgabeverhalten gemessen wird; Bonus-Tipps sind ausgenommen. Leistungs-Awards zählen nur abgerechnete Scheine.

## Je Award: Regel · Top 3 (SQL = TS)
1. **Quotenflüsterer** – höchster Tipper-IQ (≥ 15 abgerechnete Scheine **und** ≥ 9 aktive Spieltage; Stand der Prüfung damals 18/10). Xaver 92,6 · Nils 79,2 · Szymon7 78,4. *(Der IQ ist eine mehrstufige Statistik und wurde bewusst **nicht** per SQL nachgebaut; seine Rohgrößen – Gewinnscheine, Σ 1/Quote – stimmen mit der Vorab-Analyse überein: Xaver 11 Gewinnscheine, 4,54 erwartet.)*
2. **Wildi-Magnet** – höchstes Netto aller abgerechneten Scheine (inkl. Bonus): Szymon7 +14.420,81 · Bene Weigl +9.572 · Lorenz Schorer +8.191,30.
3. **Jackpot-König** – bester Kombischein nach Gesamtwertung (Quote, Nettogewinn, Außenseiter-Anteil, Legs): Bene Weigl (181,87) · Szymon7 (11,10) · Michi Dischl (48,43). *Nach reinem Nettogewinn (SQL): Bene Weigl +9.043,50 · Michi Dischl +5.585 · Szymon7 +5.252,50 → siehe „Größter Kombi-Treffer".*
4. **Einzelwetten-Profi** – Summe Netto aller Einzelwetten, ≥ 8 Einzelwetten: Lorenz Schorer +7.004 (17) · Jürgen +1.312,50 (18) · MariusGreyhound +675 (8).
5. **Senkrechtstarter** – Rangverbesserung (kumuliertes Netto) von Ende ST 5 bis ST 15: Szymon7 33→1 (+32) · Tobias 28→9 (+19) · Lorenz Schorer 18→3 (+15).
6. **Hall der Ehre** – meiste verschiedene Wildenroth-Spiele (I+II) mit Siegtipp, ohne je eine Gegenwette, ≥ 5: Lorenz Schorer · Maxim · Tobias je 14 Spiele (Tipps 17/17/14; aufgegangen 7/7/5). Gleichstand zwischen Lorenz und Maxim. Nils: 18 Tipps in 9 Spielen. Xaver (13 Spiele) ist wegen einer Gegenwette ausgeschlossen.
7. **Hall der Schande** – Gesamtsaldo der Wetten **gegen** Wildenroth (Gegner-Sieg, Doppelte Chance ohne Wildenroth-Sieg, Gegner-Handicap, Ergebnis mit Gegner-Sieg); Unentschieden und neutrale Torwetten zählen nicht. Michael Mayr +192,50 (direkt, Einzelwette, Wildenroth–Landsberg II 1:5) · Benno +121,87 (zugeordnet aus Kombi c273, Gesamtgewinn 419,25) · Hengsti +7,70 (3 Gegen-Tipps, 2 davon in verlorenen Kombis ohne Zuordnung).
8. **Kombi-Fluch** – verlorene Kombis (≥ 3 Legs) mit genau einem falschen Tipp: Michael Mayr 9 · Nils 8 · Gleichstand auf 3: Danny Ca$h, Jani, Lorenz Schorer (je 6).
9. **Stehaufmännchen** – größte Erholung vom Tiefpunkt: Szymon7 +15.395,81 (−975 → +14.421) · Lorenz Schorer +8.561,50 · Michi Dischl +8.416.
10. **Scharfschütze** – meiste aufgegangene Präzisionstipps (exaktes Ergebnis, Torschütze, 2+), ≥ 3: Lorenz Schorer 5 · Szymon7 4 · Gleichstand auf 3: Michi Dischl, MariusGreyhound, Sandi1860.

Sonder (Rekorde/Spaß):
- **Größter Einzelwetten-Treffer**: Lorenz Schorer +6.046 (Quote 31,23, Einsatz 200) · Maxi +2.162 · Maxim +1.700.
- **Größter Kombi-Treffer**: Bene Weigl +9.043,50 (6 Legs) · Michi Dischl +5.585 · Szymon7 +5.252,50.
- **Kombi-Flaute**: Maxim 22 Kombis, 0 gewonnen (2.080 Einsatz) · Lobi 20 (920) · Dowte 14 (1.044).
- **Frühbucher** (Median-Abstand, ≥ 10 Scheine, inkl. Stornos): Xaver 67,4 h · Jani 53,3 h · Nils 49,1 h.
- **Auf den letzten Drücker** (Median): Lena K 5,9 h · Benno 6,4 h · Kerrr 6,9 h.
- **Spätester Schein**: Danny Ca$h 9,88 s (verloren) · Tobias 17,7 s (gewonnen) · Maxi 24,5 s (verloren).
- **Bester Last-Minute-Gewinntipp**: Tobias 17,7 s (Quote 1,36, +90) · Maxi 71,1 s (Quote 44,24, +2.162) · Danny Ca$h 85,9 s (+2.632).
- **Nachteule** (0:00–5:59 Berlin, ≥ 5, inkl. Stornos): Szymon7 7 von 42 (je 2 gewonnen, 2 verloren, 3 storniert). Niemand sonst erreicht 5 (nächster: Lorenz Schorer mit 4).
- **Montagmorgen-Manager** (Mo 6:00–11:59 Berlin, ≥ 4): Jani 8 · Xaver 6 · Nils 6 (Gleichstand).
- **Wildi-Vernichter** (kleinstes Gesamtnetto inkl. Bonus): Dennis −1.130 · Jani −1.110 · Lobi −995.
- **Außenseiter-Jäger** (gewonnene Scheine ≥ 5,00, ≥ 3): Xaver 8 · Szymon7 7 · Nils 6.
- **Größter Storno-Fehler** (selbst storniert, hätte gewonnen; nur aus dem Endergebnis bestimmbare Märkte): Danny Ca$h Netto 1.949 (Einsatz 100, Quote 20,49, Auszahlung 2.049) · Nils 680 · Jürgen 612.
- **Längste Verlustserie** (≥ 6): Maxim 16 · Gleichstand Lobi/Ender 15. **Längste Gewinnserie** (≥ 3): Jürgen 6 · Gleichstand Danny Ca$h/Lena K 4.
- **Wett-Zwillinge** (Übereinstimmung gleicher Tipps): Lena K & Maxim 28,2 % (35 von 77/82) · knapp dahinter Maxim & Xaver 27,7 % (43) · Tobias & Maxim 27,5 % (33).
- **Zwillings-Treffer** (identischer gewonnener Kombischein bei ≥ 2 Tippern): Lena K & Szymon7 (4er-Kombi @9,49, +2.123 je) – außerdem Sandi1860 & Nils (3er, +1.033).
- **Ewiger Optimist** (Wildenroth-Spiele, in denen jeder Siegtipp daneben ging, ≥ 3): Lorenz Schorer 10 von 14 · Xaver 10 von 13 · Benno 10 von 12 (Gleichstand bei 10; Reihenfolge nach „erneut gesetzt nach Reinfall").
- **Tragischster Beinahe-Gewinn** (Kombi ≥ 3 Legs, ein falscher Tipp, höchster entgangener Nettogewinn): Lorenz Schorer 12.753 (Einsatz 15, Quote 851,22, Auszahlung 12.768) · TheZeasy 11.343 · Maxim 10.400.

## Besonderheiten Stornos / Kombis / Neutralisierungen
- Stornierte (`void`) Scheine zählen in Leistungs-Awards nie; in zeitbezogenen Awards (Frühbucher, Drücker, Spätester, Nachteule, Montag) schon, weil sie abgegeben wurden. 18 ältere Stornos haben keinen Grund gespeichert und zählen dort mit.
- Kombis zählen einmal; Kombi-Gewinne werden bei Hall der Schande nach ln(Quote)-Anteil zugeordnet, bei verlorenen Kombis nur Legs, die selbst verloren haben.
- Neutralisierte Legs (Quote 1,00) werden bei „knapp gescheitert", Kombi-Killer, „Ein Tor fehlte" und Zwillingen ignoriert; annullierte Spiele werden nie als Ergebnis gewertet.
- Offen: Spieltag 16 ist nicht enthalten (noch nicht abgeschlossen).
