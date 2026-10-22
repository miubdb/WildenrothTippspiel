# Verbindliche Wettregel: Nichtantritt und endgültige Spielannullierung

**Gültig für:** Wildenroth-Tippspiel, ab Saison 2026/27.  
**Status:** vom Betreiber festgelegte, dauerhaft anzuwendende Regel — auch bei zukünftigen vergleichbaren Fällen.  
**Technische Umsetzung:** `lib/matchAnnulment.ts`, `supabase/match_annulment.sql`, Admin-Aktion `Spiel annullieren (Quote 1,00)`. Diese Regelbeschreibung ist unabhängig vom Stand des Rollouts und ersetzt **keine** Prüfung der technischen Umsetzung.

## Wann gilt die Regel?

Bei einem **endgültig ausgefallenen bzw. annullierten Spiel**, insbesondere bei einem bestätigten **Nichtantritt** einer Mannschaft. Ein bloß verschobenes Spiel, das nachgeholt werden kann, wird **nicht** automatisch annulliert: zunächst den Wettmarkt sperren und die tatsächliche Entscheidung bzw. Neuansetzung klären.

Die Entscheidung zur **endgültigen** Annullierung trifft ein Admin. Ein vom BFV administrativ gewertetes 2:0 (oder ein anderes Sportgerichtsergebnis) wird für den Wettschein **nicht** als regulär ausgetragene Partie ausgewertet.

## Feste Wertungsregeln — ohne Einzelfall-Sonderbehandlung

1. **Jeder direkt betroffene Tipp:** Der ursprünglich getippte Ausgang/Markt spielt keine Rolle (1X2, Doppelte Chance, Tore, Handicap, Ergebnis, Torschütze usw.). Die Auswahl wird **neutralisiert** (effektiver Quotenfaktor **1,00**), **weder gewonnen noch verloren**. Ursprüngliche Auswahl und angebotene Quote bleiben nachvollziehbar.
2. **Einzelwette:** Den **vollen ursprünglichen Einsatz einmalig** erstatten; keine Gewinnauszahlung. Eine annullierte Einzelwette wird nicht als Gewinn oder Verlust in Statistiken gerechnet und belegt keinen Wettplatz mehr. Die Platzierung zählt gleichwohl als Teilnahme am Spieltag (keine Inaktivitätsstrafe allein wegen der Annullierung).
3. **Kombiwette (einschließlich Risky):** **Nicht die gesamte Kombi stornieren.** Nur den betroffenen Tipp mit Faktor 1,00 ersetzen. Alle anderen Legs behalten ihre ursprüngliche Quote und ihren Status: bereits gewonnene bleiben gewonnen, verlorene bleiben verloren, offene laufen weiter. **Einsatz unverändert**, solange mindestens ein gültiges Leg übrig bleibt; **kein anteiliger Refund**.
4. **Neue Kombi-Gesamtquote:** Produkt der **unveränderten Originalquoten sämtlicher nicht neutralisierter Legs**, gemäß der App-Rundung auf zwei Nachkommastellen. Nicht die alte, gerundete Gesamtquote durch die Quote des neutralisierten Legs dividieren. Bei einem Gewinn: Einsatz × neue Gesamtquote, unter Beachtung des Auszahlungslimits.
5. **Bereits verlorene Kombi:** Bleibt verloren, sofern ein anderes Leg bereits verloren war; **keine Erstattung**, **keine Reaktivierung** oder zusätzliche Auszahlung. Bereits abgeschlossene Elternscheine werden finanziell nicht verändert.
6. **Kombi noch offen:** Läuft zu neuer Quote mit allen übrigen Tipps weiter. Bereits gewonnene Tipps bleiben bestehen. Wenn sämtliche **übrigen** Legs gewonnen sind, wird die Kombi normal zum reduzierten Faktor ausgezahlt.
7. **Vollständig neutralisierter Wettschein:** Wenn keine gültige Auswahl mehr übrig bleibt, ursprünglichen **Gesamteinsatz einmalig** erstatten, weder Gewinn noch Verlust erfassen.
8. **Schon vom Spieler stornierte Wettscheine:** `void/user_cancelled` bleibt **vollständig unverändert**; **keine erneute Erstattung**. Bereits korrekt bezahlte/abgerechnete Fälle vor jeder Korrektur gesondert prüfen, keine doppelten Buchungen.
9. **Risky-Kennzeichnung:** Die durch die ursprüngliche Wette erworbene Klassifizierung bleibt trotz sinkender Quote bestehen; spätere Neuberechnung darf sie nicht stillschweigend umstufen. Auszahlungslimit: **15.000 Wildis Risky**, **10.000 Wildis normal**.
10. **Spieltags-Specials:** Nur Specials neutralisieren, deren `included_match_ids` das tatsächlich annullierte Match enthalten; `representative_match_id` allein ist **kein** Beleg für Betroffenheit. Die jeweilige Special-Auswahl zählt dann mit Faktor 1,00, nicht die restliche Kombi pauschal annullieren.
11. **Transparenz:** Im Wettschein `Annulliert`, Originalquote (durchgestrichen), effektive Quote `1,00`, neue Kombiquote und angepasste theoretische Auszahlung zeigen. Neutralisierte Tipps zählen nicht als richtig/falsch und lösen keine Gewinn-Auszeichnung aus.
12. **Sicherheit / Nachweis:** Nur Admin-Aktion nach kontrollierter Vorschau. Buchungen transaktionssicher und **idempotent**; gleichzeitige Ergebnisabrechnung verhindern; vollständiger Audit-Eintrag. Nachher betroffene Wettscheine, Kontostände und Spieltagsabschluss prüfen.

## Offizielle BFV-Wertung vs. Wettneutralisierung (ab 22.10.2026 ergänzt)

Diese Ergänzung fügt der Regel aus dem ersten Abschnitt zwei fachlich getrennte Dinge hinzu, ohne
sie zu ändern: eine **strukturierte** Admin-Auswahl beim Annullieren, und eine davon **komplett
unabhängige** offizielle Tabellenwertung.

**1. Strukturierte Auswahl beim Annullieren.** Statt nur Freitext muss der Admin bewusst eine von
drei Optionen wählen (keine Vorauswahl): **Nichtantritt Gastmannschaft**, **Nichtantritt
Heimmannschaft**, oder **Anderer Grund**. Gespeichert in `matches.annulment_type`. Diese Auswahl
hat **keinen** Einfluss auf die Wettneutralisierung selbst — die läuft unverändert nach den Regeln
oben, unabhängig vom Grund.

**2. Offizielle Tabellenwertung — ein separater, später nachtragbarer Schritt.** Ein endgültig
annulliertes Spiel mit **bestätigter** offizieller BFV-Wertung zählt für die Fußballtabelle und
tabellenbezogene Teamstatistiken wie ein ganz normal ausgetragenes Spiel: ein zusätzlich
gewertetes Spiel für beide Mannschaften, drei Punkte für die siegreiche Mannschaft, Sieg/
Niederlage, Tore/Gegentore/Tordifferenz entsprechend. § 29 BFV-Spielordnung 2026 schlägt bei
Nichtantritt grundsätzlich 0:2 für die nicht angetretene Mannschaft, 2:0 für den Gegner vor — das
ist aber nur ein **Vorschlag** in der Admin-Oberfläche, nie eine automatische Speicherung.

- Die Ergebnisfelder (`matches.annulment_official_home_score`/`annulment_official_away_score`/
  `annulment_official_confirmed_at`) bleiben so lange NULL, wie die BFV-Entscheidung aussteht.
- Ein Admin trägt die Wertung erst ein, wenn sie **tatsächlich amtlich bestätigt** ist — jederzeit
  später, unabhängig davon, wann annulliert wurde (Admin-Oberfläche: Karte "Annullierte Spiele").
- Das Eintragen/Korrigieren/Zurücknehmen der offiziellen Wertung berührt **ausschließlich** diese
  drei Spalten auf `matches` — es gibt dafür keinen Code-Pfad, der je bets/combo_bets/profiles
  anfasst. Wettscheine werden dadurch nie erneut bearbeitet, nie doppelt ausgezahlt/erstattet.

**Strikte Trennung — technisch erzwungen, nicht nur vereinbart:**
`matches.status` bleibt für ein annulliertes Spiel für immer `'annulled'`, niemals `'finished'`.
`home_score`/`away_score` bleiben NULL (kein Forfeit-Ergebnis wird je als reales Ergebnis
gespeichert). Das Quotenmodell (`lib/odds.ts#getMatchXG`/`getForm`/`getTeamRecord`), `settleBet()`,
die Torschützen-Logik (`lib/goalscorer.ts`) und `settleActiveMatchdaySpecials` lesen ausschließlich
`home_score`/`away_score` UND verlangen zusätzlich `status === 'finished'` — ein annulliertes Spiel
bleibt für all diese Pfade strukturell unsichtbar, unabhängig davon, ob/welche offizielle Wertung
eingetragen ist. Einzige vorgesehene Lesestelle für die offizielle Wertung ist
`lib/matchAnnulment.ts#resultForStandings`, aufgerufen ausschließlich von den vier
Tabellen-/Teamseiten (`app/(app)/tabelle/page.tsx`, `app/(app)/team/[teamId]/page.tsx`,
`app/(app)/team/wildenroth/page.tsx`, `app/(app)/team/wildenroth-ii/page.tsx`).

Bewusst **nicht** geändert: die "Form"-Anzeige (W/D/L-Quadrate, `lib/odds.ts#getForm`) bleibt
überall unverändert und zeigt weiterhin nur echte ausgetragene Spiele — sie wird vom selben Code
auch innerhalb des Quotenmodells verwendet (Formmultiplikator der xG-Berechnung) und darf die
administrative Wertung deshalb nie sehen. Punkte/Tordifferenz/Platzierung berücksichtigen die
offizielle Wertung, die Form-Serie bewusst nicht — zwei getrennte Anzeigen, eine gemeinsame, aber
nicht vermischte Datengrundlage.

**Referenzfall-Fortsetzung (Match 433):** Nichtantritt Gast → Vorschlag 2:0 für TSV
Oberalting-Seefeld — wird erst in der Tabelle gewertet, sobald ein Admin dies nach tatsächlich
bestätigter BFV-Entscheidung separat bestätigt. Bis dahin bleibt das Spiel in der Tabelle
unberücksichtigt, genau wie jedes andere noch nicht entschiedene Spiel.

## Anzeige im Tippspiel-Spielplan

Ein endgültig annulliertes Spiel gilt für die **Spielübersicht** als abgeschlossen, obwohl
`matches.status = 'annulled'` bleibt und kein reales Ergebnis vorliegt. Bis zur
amtlichen BFV-Bestätigung steht im Spielplan statt eines erfundenen 2:0:

- Nichtantritt Gast: **N.AN. GAST**
- Nichtantritt Heim: **N.AN. HEIM**
- Anderer Ausfall: **ANNULLIERT**

Sobald die eigene separate offizielle Wertung tatsächlich bestätigt wurde, zeigt
der Spielplan **2:0 (Wertung)** beziehungsweise das amtliche Ergebnis mit dem Zusatz
`(Wertung)`. Keine dieser Anzeigen ändert die Wettneutralisierung, die echten
`home_score`/`away_score`, Torschützen oder das Quotenmodell.

### Sichtbarkeit in „Alle Tipps“ — Schutz noch stornierbarer Kombis

**Grundregel:** Eine Annullierung ist **kein Anpfiff**. Ein noch nicht
begonnener Wettschein darf bei anderen Nutzern nicht erscheinen, solange
die Kombi weiterhin stornierbar ist. Sie bleibt dem Besitzer unter
„Meine Wetten“ natürlich sichtbar. Insbesondere dürfen weder
Spielerauswahl/Name, Tipps, Gesamtquote, Einsatz noch Risiko-Status
vorzeitig für andere Nutzer sichtbar sein.

- **Noch nicht gestartete Kombis** (kein tatsächlich begonnenes, gültiges
  Leg): für andere Spieler **vollständig verborgen**, auch wenn ein enthaltenes
  Spiel bereits `annulled` ist und auch nach dessen ehemaliger Anstoßzeit.
  Beispiel Match 433: #594 (Jani) und #608 (Lobi).
- **Bereits gestartete Kombis:** sichtbar nach der normalen Wettfreigabe,
  unabhängig von der Annullierung; neutralisierte Auswahl mit
  **durchgestrichener Originalquote → @1,00**, neutralem Hinweis,
  neue Kombi-Gesamtquote und weiterhin gültigem Wettscheinstatus.
  Beispiel Match 433: #598 (Korbi) und #607 (Michi Dischl).
- **Neutralisierte Einzelwetten:** unmittelbar sichtbar, da sie bereits
  endgültig abgerechnet/erstattet sind (kein offener, stornierbarer Wettschein).
- **Stornierte** (`void`) Wettscheine bleiben in „Alle Tipps“ ausgeblendet.
- Die Übersicht darf die **Zahl noch gesperrter Scheine** ohne Namen,
  Tipps, Einsatz, Quote oder sonstige Rückschlüsse anzeigen („🔒 …“).
  Sofern aus anderen Gründen nur einige Legs öffentlich sind, bleibt die
  angezeigte Anzahl ausdrücklich die Anzahl **sichtbarer** Legs.
- **Kein Guthaben- oder Wett-Update** durch die Freigabe: ausschließlich
  Lesezugriffs- und Darstellungsregeln.

**Technische Pflichtregel (RLS):** `private.combo_has_started` darf weder
`annulled` noch `postponed` als tatsächlichen Spielbeginn werten,
**auch nicht nach deren ehemaligem Kickoff**. Gestartet ist eine Kombi erst,
wenn mindestens ein nicht neutralisiertes/nicht storniertes Leg schon
entschieden ist (`won`/`lost`), sein Match `live`/`finished` ist
oder ein nicht annulliertes/nicht verschobenes Spiel seinen Anpfiff erreicht.
Bis dahin darf `bets_select_own` **keine** fremden Kombi-Legs und
`combo_bets_select_own` **keine** fremde Kombi-Zusammenfassung
freigeben. Für annulierte Einzelwetten bleibt eine gezielte Freigabe zulässig.

Historie: `supabase/annulled_bets_social_visibility.sql` war zunächst
weiter gefasst; die verbindliche Korrektur ist in
`supabase/annulled_combo_social_privacy.sql` festgehalten.
**Tests:** ein Nichtbesitzer darf weder unmittelbar nach der Annullierung
noch nach dem ehemaligen Kickoff Namen, Kombi oder Legs ohne echten
Spielbeginn sehen; nach echtem Kickoff wird die Kombi sichtbar;
der Besitzer sieht seinen Schein durchgehend.

## Stornierbarkeit

Die **bestehenden** Stornierungsregeln der App gelten weiterhin; es gibt **kein automatisches Recht**, eine bereits begonnene Kombi aufgrund des Nichtantritts als Ganzes zu stornieren. Technisch zulässige Stornierungen vor Beginn sind weiterhin möglich; die neutralisierte Auswahl wird dabei nicht als noch ausstehendes Spiel behandelt. Die Storno-Bedingungen müssen mit dem jeweils tatsächlich implementierten Code übereinstimmen.

## Referenzfall (22.10.2026)

**TSV Oberalting-Seefeld – SC Schöngeising**, Match-ID **433**, BFV `Nichtantritt Gast`. Der Fall begründet diese verbindliche Regel; spätere Fälle werden grundsätzlich **identisch** behandelt, unabhängig davon, welcher Spieler betroffen ist oder wie viel eine Wette potentiell eingebracht hätte.

Stand vor Annullierung laut read-only Produktionsabgleich:
- **4 offene** Kombis: #594 → **39,13**, #598 → **3,40**, #607 → **389,42**, #608 → **980,65**.
- **8 bereits verlorene** Kombis bleiben verloren (IDs #579, #581, #582, #585, #595, #599, #601, #603).
- **5 stornierte** Kombis bleiben unverändert (IDs #577, #587, #589, #593, **#604**). Achtung: #604 wurde nach älteren Abfragen vom Spieler storniert.
- **Keine** betroffenen Einzelwetten oder enthaltenen Spieltags-Specials; **keine sofortige Änderung irgendeines Guthabens** bei korrekter einmaliger Annullierung.
- Die gewonnenen Maximilian-Scheidl-Torschützen-Legs in #598 und #607 bleiben gewonnen.

**Wichtig:** Diese Zahlen sind ein **Snapshot** zur kontrollierten Prüfung von Match 433, keine allgemeine Geschäftsregel. Die Status anderer Spiele und damit der Wettscheine können sich später verändern.

## Für künftige Vorfälle: Pflichtablauf

1. Bei bekanntem Ausfall Annahme neuer Wetten auf das Spiel sperren.
2. Klären, ob **Nachholspiel/Verlegung** oder **endgültiger Ausfall**; noch nicht vorschnell mit 1,00 abrechnen.
3. Read-only Vorschau aller betroffenen Singles, Kombis, Specials, bereits begonnenen bzw. abgeschlossenen Fälle samt Risky und Guthaben erstellen.
4. **Immer diese Quoten-1,00-Regeln anwenden**, keine individuellen Ausnahmen anhand des Spielers oder des potenziellen Gewinns.
5. Nach verifizierter Technik die Admin-Aktion einmalig ausführen und Ergebnis gegen Vorschau, Kontostände, Kombi-Quoten sowie Spieltagsabschluss kontrollieren.
6. Spieler verständlich informieren und auf abweichende Stornierungsmöglichkeiten nur hinweisen, wenn die App sie tatsächlich anbietet.

**Änderung dieser Regel:** Nur durch bewusste Betreiberentscheidung und anschließende Anpassung von Dokumentation, Tests, UI und Abrechnungslogik. Niemals bei einem Einzelfall stillschweigend anders verfahren.
