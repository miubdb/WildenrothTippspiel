# Manueller Test-Checkliste — Release-Entscheidung (Phase 1–3 + Audit)

Stand: nach Phase 1, Phase 2, Phase 3 und dem finalen End-to-End-Audit, alles auf `integration`.
Ziel: strukturiertes manuelles Durchtesten vor der Merge-Entscheidung nach `main`.

**Spalten:** Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen

**Rollen-Kürzel:**
- **N** = Normaler Nutzer (kein Wildenroth-Flag)
- **W1** = Wildenroth 1. Mannschaft (is_wildenroth = true)
- **W2** = Wildenroth 2. Mannschaft (is_wildenroth_ii = true)
- **W12** = beide Flags gesetzt
- **A** = Admin

Vor dem Testen: mindestens einen Testnutzer pro Rolle anlegen bzw. über Admin-Panel (Verwaltung-Tab, ⚽1/⚽2-Buttons) entsprechend flaggen.

---

## Phase 1

### 1. Fremde Tipps / Sichtbarkeit

| Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|---|---|
| Sichtbarkeit | Einzelwette anderer Nutzer vor Anpfiff unsichtbar | N | 2 Testnutzer, Spiel noch nicht angepfiffen | 1. Nutzer B platziert Einzelwette auf Spiel X<br>2. Nutzer A öffnet Tipps-Seite für denselben Spieltag | Nutzer A sieht nur "N Wettscheine platziert – sichtbar ab Anpfiff", keine Details (Team/Markt/Quote/Tipp) | Blocker | offen | |
| Sichtbarkeit | Einzelwette anderer Nutzer ab Anpfiff sichtbar | N | wie oben, Spiel X ist inzwischen angepfiffen | 1. Warten bis Spiel X angepfiffen (oder Testspieltag 999 mit kurzen Anstoßzeiten nutzen)<br>2. Tipps-Seite neu laden | Wettschein von Nutzer B wird jetzt mit Team/Markt/Quote/Tipp angezeigt | Blocker | offen | |
| Sichtbarkeit | Sonntagsspiel bleibt unsichtbar, obwohl Samstagsspiel läuft | N | Spieltag mit Spielen an unterschiedlichen Tagen (Sa+So) | 1. Nutzer B wettet auf Sonntagsspiel<br>2. Samstagsspiel des gleichen Spieltags pfeift an<br>3. Nutzer A prüft Tipps-Seite | Sonntagswette bleibt als Platzhalter ("sichtbar ab Anpfiff"), NICHT sichtbar nur weil Samstagsspiel läuft | Blocker | offen | Kern-Regression-Risiko aus Phase 1 Punkt 1 |
| Sichtbarkeit | Kombiwette sichtbar ab erstem gestarteten Leg | N | Kombi mit 2+ Legs aus verschiedenen Spielen | 1. Nutzer B platziert Kombi über Spiel X (später) + Spiel Y (früher)<br>2. Spiel Y pfeift an, Spiel X noch nicht<br>3. Nutzer A prüft Tipps-Seite | Komplette Kombi (alle Legs) wird jetzt sichtbar, auch der Leg von Spiel X | Blocker | offen | |
| Sichtbarkeit | Kein Leak vor Sichtbarkeit | N | wie oben, vor Anpfiff | Netzwerk-Tab/DevTools prüfen: API-Response vor Anpfiff | Keine Team-/Markt-/Quote-/Tipp-Daten fremder Wetten im Response, auch nicht versteckt im DOM/JSON | Blocker | offen | Prüft echtes Leak, nicht nur UI |
| Sichtbarkeit | Platzhalter-Text korrekt | N | 1, 2, 3+ fremde Wettscheine auf einem Spiel | Tipps-Seite vor Anpfiff öffnen, Anzahl variieren | "1 Wettschein platziert" (Singular) bzw. "N Wettscheine platziert" (Plural) – korrekt sichtbar ab Anpfiff | Wichtig | offen | |
| Sichtbarkeit | RLS schützt auch ohne App (DB-Ebene) | A | Supabase-Zugriff oder direkter API-Call | Direkter `select * from bets` als eingeloggter Nicht-Admin-User (z. B. via Browser-Konsole `supabase.from('bets').select()`) vor Anpfiff eines fremden Spiels | Fremde, noch nicht sichtbare Zeilen werden von der DB selbst nicht zurückgegeben (nicht nur clientseitig gefiltert) | Blocker | offen | Bestätigt in Audit (bets_select_own), aber bitte 1x live nachvollziehen |
| Rangliste-Sichtbarkeit | Gleiche Regeln auf Rangliste-Seite | N | wie oben | Gleiche Szenarien wie oben, aber auf `/leaderboard` statt `/tipps` | Identisches Verhalten wie auf Tipps-Seite | Blocker | offen | Rangliste hat eigene Anzeige-Logik, separat testen |

### 2. Interessenkonflikt 1./2. Mannschaft

| Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|---|---|
| Konflikt | W1 darf nicht gegen Wildenroth I wetten | W1 | Spiel mit SpVgg Wildenroth (1. Mannschaft) | Versuche zu wetten auf: Unentschieden, Auswärtssieg (falls Wildenroth heim) bzw. Heimsieg-Gegner, X2/12-Doppelte-Chance gegen Wildenroth, Ergebnis mit Wildenroth-Niederlage | Warnschild erscheint, Tipp wird nicht übernommen | Blocker | offen | |
| Konflikt | W1 darf auf Wildenroth-I-Sieg wetten | W1 | wie oben | Wette auf Wildenroth-I-Sieg (1X2) | Tipp wird normal übernommen, kein Warnschild | Wichtig | offen | |
| Konflikt | W1 darf normal auf Wildenroth-II-Spiele wetten | W1 | Wildenroth-II-Spiel | Beliebigen Tipp auf Wildenroth-II-Spiel setzen | Kein Warnschild, Tipp wird übernommen (Flag gilt nur für Team 1) | Wichtig | offen | |
| Konflikt | W2 darf nicht gegen Wildenroth II wetten | W2 | Wildenroth-II-Spiel | Wette gegen Wildenroth II (Niederlage/Unentschieden/Doppelte Chance dagegen) | Warnschild erscheint ("2. Mannschaft"), Tipp nicht übernommen | Blocker | offen | |
| Konflikt | W2 darf normal auf Wildenroth-I-Spiele wetten | W2 | Wildenroth-I-Spiel | Beliebigen Tipp setzen | Kein Warnschild | Wichtig | offen | |
| Konflikt | W12 gesperrt bei beiden Teams | W12 | je ein Spiel Wildenroth I und II | Wette gegen Wildenroth I UND gegen Wildenroth II einzeln versuchen | Beide werden geblockt, jeweils mit passendem Warnschild (1. bzw. 2. Mannschaft) | Blocker | offen | |
| Konflikt | Warnschild verständlich | W1/W2 | wie oben | Warnschild-Text lesen | Text nennt korrekt "1. Mannschaft" oder "2. Mannschaft", verständlich, nicht generisch falsch | Wichtig | offen | |
| Konflikt | Serverseitige Durchsetzung (nicht nur Frontend) | W1 | Wildenroth-I-Spiel | Versuch, verbotenen Tipp direkt per API-Call (z. B. Browser-DevTools `fetch('/api/bets/place', ...)`) unter Umgehung der UI abzusetzen | API lehnt mit Fehlermeldung ab, kein Bypass möglich | Blocker | offen | Server-Check bereits im Audit bestätigt, bitte 1x live nachvollziehen |
| Admin | Admin kann Flags setzen/ändern | A | Testnutzer ohne Flags | Verwaltung-Tab → ⚽1 und ⚽2 Buttons für Testnutzer togglen | Flags wechseln sichtbar (Badge ⚽1/⚽2 erscheint/verschwindet), Wirkung sofort beim nächsten Wettversuch spürbar | Blocker | offen | |

### 3. Registrierung / Freischaltung

| Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|---|---|
| Registrierung | Vor Saisonstart automatisch berechtigt | – | vor 16.08. bzw. vor echtem ersten Spiel | Neuen Testaccount registrieren | Account ist sofort `eligible_for_current_season = true`, keine Admin-Freischaltung nötig | Blocker | offen | Bug in Phase 1 gefunden & gefixt – wichtig nochmal zu bestätigen |
| Registrierung | Nach Saisonstart braucht Freischaltung | – | Simulation: Testmatchday 999 oder tatsächlich nach 16.08. | Neuen Testaccount nach Saisonstart registrieren | Account ist `eligible_for_current_season = false`, Hinweis-Seite erscheint, Admin muss manuell freischalten | Blocker | offen | Schwer vor dem 16.08. real zu testen – ggf. mit Testdaten/Datum simulieren |
| Registrierung | Name muss eindeutig sein | – | bereits vergebener Anzeigename | Registrierung mit exakt vorhandenem Namen versuchen | Fehlermeldung "Dieser Name ist leider schon vergeben." vor Accounterstellung | Blocker | offen | |
| Registrierung | Groß-/Kleinschreibung bei Namensprüfung | – | vorhandener Name z. B. "Jani" | Registrierung mit "jani" oder "JANI" versuchen | Wird ebenfalls als vergeben erkannt (case-insensitive) | Wichtig | offen | |
| Profil | Namensänderung auf vergebenen Namen abgelehnt | N | zwei bestehende Accounts | Im Profil den eigenen Namen auf den Namen eines anderen Nutzers ändern | Fehlermeldung, Änderung wird nicht gespeichert | Blocker | offen | |
| Profil | Username nirgends mehr sichtbar | N | – | Eigenes Profil, fremdes Profil, Rangliste, Adminliste durchsehen | Kein "@username" sichtbar, nur Anzeigename | Wichtig | offen | |
| Profil | Username nicht mehr editierbar | N | – | Profil-Bearbeiten öffnen | Keine Möglichkeit mehr, einen Benutzernamen separat zu ändern (nur Anzeigename) | Wichtig | offen | |

### 4. Spieltag-Öffnung

| Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|---|---|
| Spieltag-Öffnung | Kein doppelt offener Spieltag (Mittwochsspiel-Fall) | N | Spieltag 3 (Mittwoch) + Spieltag 4 (Fr–So) in gleicher Kalenderwoche | Spieltag 3 läuft/ist offen, direkt vor/während Spieltag 3 prüfen, ob Spieltag 4 schon wettbar ist | Spieltag 4 öffnet erst NACH dem letzten Anpfiff von Spieltag 3, nicht schon am gleichen Montag | Blocker | offen | Konkretes Szenario aus Phase 2, mit echten Terminen (Spielplan) durchspielen |
| Spieltag-Öffnung | Richtiger Standard-Spieltag wird angezeigt | N | – | Tipps-Seite ohne Parameter öffnen an verschiedenen Wochentagen | Vor Montag 12 Uhr: letzter abgeschlossener Spieltag; nach Montag 12 Uhr: nächster wettbarer Spieltag | Wichtig | offen | |
| Spieltag-Öffnung | Direkter Zugriff auf zukünftigen Spieltag per URL blockiert Wetten korrekt | N | `?matchday=N+1` während Spieltag N noch läuft | URL mit zukünftigem matchday-Parameter aufrufen, Wettversuch starten | Wettabgabe wird verweigert (Quoten nicht verfügbar / Spieltag noch nicht offen) | Blocker | offen | Prüft Bypass-Versuch über Query-Parameter |

### 5. Kontostände / Taschengeld

| Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|---|---|
| Guthaben | Startguthaben 1.000 Wildis | N | frischer Account | Profil öffnen direkt nach Registrierung | Guthaben zeigt 1.000,00 Wildis | Blocker | offen | |
| Taschengeld | Kein Taschengeld vor Saisonstart | – | vor 16.08./erstem Spiel | Montag 12 Uhr vor Saisonstart abwarten/prüfen (oder DB-Log prüfen) | Kein automatischer +10-Wildis-Eintrag, Guthaben unverändert | Blocker | offen | Schwer exakt zu timen, ggf. Cron-Log/`notification_log`/Balance-Historie prüfen |
| Taschengeld | Taschengeld ab Saisonstart korrekt | – | nach erstem Spieltag-1-Anpfiff | Montag nach Saisonstart um 12 Uhr prüfen | +10 Wildis automatisch gutgeschrieben | Blocker | offen | |
| Taschengeld | Wettbilanz nicht durch Taschengeld verfälscht | N | Account mit erhaltenem Taschengeld, aber ohne Wetten | Profil öffnen | "Wettbilanz" zeigt 0 (nicht +10 o.ä.), "Taschengeld & Sonstiges" zeigt die +10 separat | Blocker | offen | Kernfix aus Phase 3 |

### 6. B-Klasse / Wildenroth II

| Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|---|---|
| B-Klasse-Zuordnung | Wildenroth-II-Spiel landet beim richtigen Tippspiel-Spieltag | N | Wildenroth-II-Spiel am 30.08. | Tipps-Seite für Spieltag 5 (28.–30.08. Kreisliga-Zeitraum) öffnen | Wildenroth-II-Spiel vom 30.08. erscheint hier, NICHT bei Spieltag 1 | Blocker | offen | Exaktes Beispiel aus der Anforderung, mit echten Daten nachvollziehen |
| B-Klasse-Zuordnung | Zuordnung folgt Datum, nicht B-Klasse-eigener Nummerierung | N | mehrere Wildenroth-II-Spieltage | Für 3–4 verschiedene Wildenroth-II-Spieltage prüfen, bei welchem Tippspiel-Spieltag sie erscheinen | Zuordnung stimmt jeweils mit zeitlicher Nähe zum Kreisliga-Spieltag überein | Wichtig | offen | |
| Topspiel | Admin kann Topspiel setzen | A | anstehendes B-Klasse-Spiel (nicht Wildenroth II) | Verwaltung/Spieltag-Tab → Topspiel-Checkbox anhaken | Spiel wird als Topspiel markiert, Badge erscheint auf Tipps-Seite | Blocker | offen | |
| Topspiel | Nur ein Topspiel pro Woche sinnvoll nutzbar | A | 2 B-Klasse-Spiele in gleicher Woche | Zwei Spiele gleichzeitig als Topspiel markieren (Admin erlaubt das aktuell technisch) | Bewusst prüfen: App zeigt ggf. beide als wettbar an – Admin muss selbst nur eins auswählen (kein automatischer Schutz) | Wichtig | offen | Bekannte Design-Entscheidung: keine automatische Exklusivität, bewusst so gebaut |
| Topspiel | Spieltagspanel zählt nur wettbare Spiele | N | Spieltag mit Kreisliga + Wildenroth II + 1 Topspiel + weiteren nicht gewählten B-Klasse-Spielen | Anzahl im Spieltag-Zähler (Stat-Kachel) prüfen | Zahl entspricht Kreisliga + Wildenroth II + Topspiel, NICHT alle B-Klasse-Spiele | Blocker | offen | |
| Topspiel | Nicht ausgewählte B-Klasse-Spiele nicht wettbar/sichtbar | N | wie oben | Tipps-Seite durchsehen | Nur Kreisliga, Wildenroth II und das gewählte Topspiel erscheinen als Wettkarten | Blocker | offen | |

### 7. Wettschein-Modal

| Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|---|---|
| Wettschein | Button nicht abgeschnitten (mobil) | N | echtes Handy oder Chrome DevTools Mobile-Emulation | Wettschein öffnen, bis zum "Wette platzieren"-Button scrollen | Button komplett sichtbar, nicht vom Rand/Safe-Area abgeschnitten | Blocker | offen | Auf iPhone (Safe-Area/Home-Indicator) und Android testen |
| Wettschein | Singular "1 Wildi" | N | Einsatz exakt 1 Wildi setzen | Betrag 1 eingeben, Gewinn-Anzeige und Bestätigung prüfen | Überall "1 Wildi" (nicht "1 Wildis") | Wichtig | offen | |
| Wettschein | Komma-Beträge erlaubt | N | – | Im eigenen Betragsfeld "9,80" bzw. "9,72" eintippen | Betrag wird korrekt übernommen (kein Fehler, kein leeres Feld) | Blocker | offen | Kernfix Phase 1 Punkt 8 |
| Wettschein | Presets funktionieren | N | – | Auf Presets 10/15/50/100/200/250 klicken | Betrag wird jeweils korrekt übernommen und im Feld angezeigt | Wichtig | offen | |
| Wettschein | Eigenes Feld wird nach Wettabgabe zurückgesetzt | N | – | Eigenen Betrag eintragen, Wette abgeben, Wettschein erneut öffnen | Feld ist wieder leer/Standardwert, nicht der alte Betrag | Wichtig | offen | |
| Wettschein | 2. Risky-Wette im selben Spieltag blockiert | N | bereits 1 Risky-Wette (Quote ≥20) im aktuellen Spieltag platziert | Versuch, eine zweite Wette mit Quote ≥20 als Risky zu platzieren | Fehlermeldung, Wette wird abgelehnt | Blocker | offen | |
| Wettschein | Max. 2 normale Wettscheine pro Spieltag | N | bereits 2 normale Wetten platziert | Versuch einer 3. normalen Wette | Fehlermeldung, Wette wird abgelehnt | Blocker | offen | |
| Wettschein | Kombiwette zeigt Wildi-Icon konsistent | N | Kombiwette mit 2+ Legs | Kombi-Presets und Gesamteinsatz ansehen | Icon/Wildi-Bezeichnung konsistent mit Einzelwetten-Ansicht | Nice-to-have | offen | |

### 8. Hilfe / Regeln

| Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|---|---|
| Hilfe | Seite stimmt mit echtem Verhalten überein | N | – | Anleitung-Seite komplett durchlesen, mit tatsächlichem App-Verhalten vergleichen | Keine falschen/veralteten Aussagen (Storno, Sichtbarkeit, Taschengeld, Wildenroth-Sperre, B-Klasse) | Wichtig | offen | |
| Hilfe | Nicht überladen | N | – | Seite überfliegen | Wirkt übersichtlich, keine Textwüste | Nice-to-have | offen | Subjektive Einschätzung |
| Hilfe | Verschobene Spiele verständlich erklärt | N | – | Abschnitt "Verschobene Spiele" lesen | Erklärt Storno-Verhalten korrekt und verständlich | Wichtig | offen | |
| Hilfe | Sichtbarkeit fremder Tipps verständlich erklärt | N | – | Abschnitt "Tipps anderer Nutzer" lesen | Einzel- vs. Kombi-Regel klar erklärt | Wichtig | offen | |
| Hilfe | Wildenroth-1/-2-Sperre verständlich erklärt | N | – | Abschnitt "Wildenroth-Spieler & Trainer" lesen | Beide Flags unabhängig korrekt erklärt | Wichtig | offen | |

---

## Phase 2

### 1. Quotenlogik

| Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|---|---|
| Quoten | Wildenroth nicht automatisch Favorit gegen stärkere Teams | N/A | Spieltag 1–4, Wildenroth gegen bekannt stärkeres Team | Quoten für dieses Spiel im Admin (Quoten-Tab → Erklärung/Explain) ansehen | Wildenroth ist nicht automatisch Favorit nur wegen Heimspiel/alter Daten; Quote spiegelt echte Stärkeverhältnisse plausibel wider | Wichtig | offen | Subjektive Plausibilitätsprüfung, kein exakter Zahlenwert vorgegeben |
| Quoten | Heimvorteil wirkt moderat | A | mehrere Spiele mit vergleichbar starken Teams | Heim- vs. Auswärts-Quoten bei ausgeglichenen Duellen vergleichen | Heimvorteil spürbar, aber nicht überzogen dominant | Wichtig | offen | |
| Quoten | Admin-Overrides funktionieren weiterhin | A | beliebiges anstehendes Spiel | Quoten-Tab → manuellen Override für ein Spiel setzen, speichern, Quoten-Ansicht neu laden | Override-Wert wird übernommen und bleibt bestehen (auch nach "Quoten neu berechnen") | Blocker | offen | |
| Quoten | Override zurücksetzen funktioniert | A | Spiel mit aktivem Override | "Reset" für Override auswählen | Quote fällt zurück auf automatisch berechneten Wert | Wichtig | offen | |
| Quoten | Spieltag 1–4 plausibel gegengeprüft | A | echte Ansetzungen Spieltag 1–4 | Für jedes Spiel: Explain-Ansicht/Diagnostics durchsehen | Keine offensichtlich unplausiblen Quoten (z. B. krasser Außenseiter als 1.05-Favorit ohne nachvollziehbaren Grund) | Wichtig | offen | |
| Quoten | Nachvollziehbare Änderung nach Ergebniseingabe | A | ein abgerechnetes Spiel, gleiche Teams später erneut | Vor und nach einer Ergebniseingabe die Quoten des nächsten Spiels dieser Teams vergleichen | Änderung ist in erwartete Richtung nachvollziehbar (Sieg erhöht künftige Favoritenrolle etc.) | Nice-to-have | offen | Erst mit echten Ergebnissen im Saisonverlauf sinnvoll testbar |

### 2. Kader / Transfers

| Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|---|---|
| Kader | Spieler hinzufügen | A | – | Verwaltung → Kader & Transfers → Team wählen, Namen eingeben, "+ Hinzufügen" | Neuer Spieler erscheint in der Liste mit Status "Aktiv" | Wichtig | offen | |
| Kader | Spieler-Status ändern | A | bestehender Kadereintrag | Status-Dropdown auf "Abgang"/"Zugang"/"Wechsel"/"Karriereende" setzen | Änderung wird gespeichert (Seite neu laden zur Kontrolle) | Wichtig | offen | |
| Kader | Transfer-Ziel pflegbar | A | Spieler mit Status "Abgang" oder "Wechsel" | Transfer-Ziel-Feld ausfüllen | Wert wird gespeichert | Nice-to-have | offen | |
| Kader | Spieler entfernen | A | Testeintrag | "✕" klicken, Bestätigungsdialog bestätigen | Spieler verschwindet aus der Liste | Wichtig | offen | |
| Kader | Keine historischen Daten beschädigt | A | bereits vorhandene echte Kaderdaten | Vor/nach eigenen Testeinträgen bestehende echte Spieler-Einträge (Tore/Spiele) prüfen | Keine Veränderung an bestehenden, nicht selbst bearbeiteten Einträgen | Blocker | offen | Nur mit Testeinträgen arbeiten, keine echten Spieler löschen! |
| Kader | Aufstellung/Verfügbarkeit weiterhin erfassbar | A | abgerechnetes Wildenroth-Spiel | Spieltag-Tab → abgerechnetes Spiel → "Aufstellung" ausklappen, Spieler mit Minuten/Toren/Assists erfassen | Eintrag wird gespeichert und angezeigt | Wichtig | offen | Bereits vor dieser Session vorhanden, nur auf Regression prüfen |

### 3. Adminbereich Spiele

| Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|---|---|
| Admin-Filter | Wettbewerbsfilter "Kreisliga" | A | gemischte Spiele | Filter "Kreisliga" auswählen | Nur Kreisliga-Spiele (bzw. ohne Kategorie) werden in allen Listen angezeigt | Wichtig | offen | |
| Admin-Filter | Wettbewerbsfilter "Wildenroth II" | A | wie oben | Filter "Wildenroth II" auswählen | Nur Wildenroth-II-Spiele sichtbar | Wichtig | offen | |
| Admin-Filter | Wettbewerbsfilter "B-Klasse" | A | wie oben | Filter "B-Klasse" auswählen | B-Klasse- und Topspiel-Kategorien sichtbar | Wichtig | offen | |
| Admin-Filter | Filter "Alle" zeigt wieder alles | A | – | Filter zurück auf "Alle" | Alle Kategorien wieder sichtbar | Nice-to-have | offen | |
| Admin-Liste | Abgerechnete Spiele neueste zuerst | A | mehrere abgerechnete Spiele | Abschnitt "Abgerechnete Spiele" ansehen | Sortierung neueste zuerst, nicht älteste | Wichtig | offen | |
| Admin-Liste | "Weitere anzeigen" funktioniert | A | mehr als 10 abgerechnete Spiele | Button klicken | Weitere 20 Einträge werden nachgeladen, Zähler stimmt | Nice-to-have | offen | |
| Admin-Liste | Kategorie editierbar | A | beliebiges Spiel | Dropdown "Wettbewerb" bei einem Spiel ändern | Änderung wird in DB übernommen (Seite neu laden zur Kontrolle) | Wichtig | offen | |
| Admin-Liste | Torschützen-Hinweis bei Wildenroth-Spielen | A | Wildenroth-I- oder -II-Spiel | Spiel in der Liste ansehen | Hinweis "⚽ Torschützen im Tab 'Quoten' erfassen" erscheint | Nice-to-have | offen | |

### 4. Verschobene Spiele / Nachholspiele

| Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|---|---|
| Verschiebung | Spiel als verschoben markieren | A | anstehendes Spiel mit Testwette darauf | "Verschoben"-Button klicken | Spiel-Status wird "postponed", erscheint unter "Verschobene Spiele" | Blocker | offen | |
| Verschiebung | Wette bleibt pending nach Verschiebung | N | wie oben | Eigene Wette auf verschobenes Spiel im Profil/Tipps prüfen | Status bleibt "offen"/"pending", kein automatisches Storno | Blocker | offen | |
| Verschiebung | Wette bleibt stornierbar nach Verschiebung | N | wie oben | Storno-Button für diese Wette nutzen | Storno funktioniert weiterhin, Einsatz wird zurückerstattet | Blocker | offen | |
| Verschiebung | Verschobenes Spiel blockiert Spieltag/Recap nicht | A/N | Spieltag mit 1 verschobenen + restlichen abgerechneten Spielen | Alle nicht-verschobenen Spiele abrechnen, Recap/Rangliste prüfen | Spieltag gilt als abgeschlossen, Recap erscheint, Awards werden vergeben | Blocker | offen | Wichtiger Regressionstest nach dem Rangliste-Fix aus Phase 2 |
| Verschiebung | Reschedule wird normal abgerechnet | A | verschobenes Spiel | "Neuer Termin"-Formular ausfüllen (Datum/Zeit/optional Spieltag), speichern | Spiel-Status wird wieder "scheduled" mit neuem Datum, kann normal abgerechnet werden | Blocker | offen | |
| Verschiebung | Langzeit-Verschiebung (August → März) | A | Testspiel | Spiel von August auf März verschieben (Reschedule-Formular) | Neues Datum wird übernommen, Spiel bleibt bis dahin korrekt als "verschoben" geführt, Wetten bleiben offen/stornierbar | Wichtig | offen | Explizit gefordertes Szenario aus der Anforderung |
| Verschiebung | Kombiwette mit verschobenem Leg weiterhin stornierbar | N | Kombi mit einem Leg auf verschobenem Spiel, restliche Legs nicht gestartet | Storno der Kombi versuchen | Storno funktioniert (verschobenes Leg zählt nicht als "gestartet") | Blocker | offen | |

### 5. B-Klasse / Topspiel (Adminseite)

| Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|---|---|
| Topspiel-Badge | Badge erkennt echtes Admin-Flag | N | von Admin gesetztes Topspiel | Tipps-Seite öffnen, betroffenes Spiel ansehen | Badge "B-KLASSE-TOPSPIEL" wird angezeigt (nicht nur bei alter Kategorie `bklasse_topspiel`) | Blocker | offen | Konkreter Fix aus dem Audit, unbedingt verifizieren |
| Topspiel | Topspiel korrekt wettbar | N | wie oben | Wettkarte für das Topspiel öffnen | 1X2/Über-Unter/etc. Märkte verfügbar wie bei normalem Spiel | Wichtig | offen | |
| Topspiel | Topspiel erscheint beim richtigen Spieltag | N | wie oben | Tippspiel-Spieltag prüfen, bei dem das Topspiel-Datum zeitlich liegt | Erscheint dort, nicht bei einem anderen Spieltag | Wichtig | offen | |
| Topspiel | Nur ausgewähltes B-Klasse-Spiel wettbar | N | mehrere B-Klasse-Spiele, nur eins als Topspiel markiert | Alle B-Klasse-Spiele des Spieltags durchsehen | Nur das markierte erscheint als Wettkarte, Rest ist unsichtbar | Blocker | offen | |

### 6. Tabelle

| Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|---|---|
| Tabelle | Alphabetisch vor erstem Spiel | N | Saison vor erstem Spieltag (bzw. B-Klasse-Tab falls dort noch kein Spiel gelaufen) | Tabelle-Seite öffnen | Teams alphabetisch sortiert (nicht zufällige DB-Reihenfolge) | Wichtig | offen | |
| Tabelle | Sportlich korrekt nach Spielen | N | mind. 1 Spieltag abgerechnet | Tabelle nach erstem Spieltag ansehen | Sortierung nach Punkten/Tordifferenz/Toren korrekt, BFV-Tiebreak bei Punktgleichheit | Blocker | offen | |
| Tabelle | Lange Teamnamen lesbar | N | "[SG] TSV Herrsching/SF Breitbrunn 2" in der Liste | Tabelle (B-Klasse) auf Mobile ansehen | Name wird sauber abgeschnitten/truncated, keine Layout-Zerstörung | Wichtig | offen | |
| Tabelle | Auf-/Abstieg 1. Mannschaft korrekt markiert | N | Kreisliga-Tabelle mit 16 Teams | Platzierungen 1, 2, 12–13, 14–16 ansehen | Platz 1 grün (Aufstieg), Platz 2 hellgrün (Relegation), 12–13 orange (Abstiegsrelegation), 14–16 rot (Direktabstieg) | Wichtig | offen | Farblogik gegen die in der Anforderung genannten Platzierungen prüfen |
| Tabelle | Auf-/Abstieg 2. Mannschaft korrekt markiert | N | B-Klasse-Tabelle | Platz 1, 2, letzter Platz ansehen | Platz 1 grün, Platz 2 Aufstiegsquali-Markierung, letzter Platz rot | Wichtig | offen | |
| Tabelle | Herrsching-Name korrekt überall | N | – | Tabelle, Tipps-Seite, Admin-Spielliste durchsehen | Überall "[SG] TSV Herrsching/SF Breitbrunn 2", keine alte Bezeichnung "TSV Herrsching II" mehr sichtbar | Wichtig | offen | |

---

## Phase 3

### 1. Rangliste

| Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|---|---|
| Rangliste | Sortierung nach Guthaben + offenen Einsätzen | N | mind. 2 Nutzer mit unterschiedlichem Guthaben/offenen Wetten | Rangliste ansehen, mit Profil-Guthaben vergleichen | Reihenfolge = Guthaben + offene Einsätze, nicht nur nacktes Guthaben | Blocker | offen | |
| Rangliste | Gleichstand alphabetisch sortiert | N | 2 Testnutzer mit exakt gleichem Guthaben | Rangliste ansehen | Bei exaktem Gleichstand alphabetische Reihenfolge (nicht zufällig) | Nice-to-have | offen | Schwer künstlich herzustellen, ggf. mit Testdaten |
| Rangliste | Erklärung zu Guthaben/offenen Wetten verständlich | N | – | Hinweistext auf der Rangliste-Seite lesen | Erklärt nachvollziehbar, warum Rangliste-Wert vom eigenen sichtbaren Guthaben abweichen kann | Wichtig | offen | Neuer Text aus Phase 3, gegenlesen |
| Rangliste | Eigene Wetten sichtbar | N | eigene offene und abgerechnete Wetten | Eigene Zeile in Rangliste aufklappen | Alle eigenen Wetten sind sichtbar, unabhängig vom Anpfiff-Status | Blocker | offen | Kernfix aus Phase 3 (vorher fälschlich gefiltert) |
| Rangliste | Eigene Wette vor Anpfiff stornierbar | N | eigene offene Einzelwette, Spiel noch nicht gestartet | Storno-Button in der Rangliste-Ansicht nutzen | Storno funktioniert, Einsatz wird zurückerstattet | Blocker | offen | Kernfix aus Phase 3 |
| Rangliste | Eigene Wette nach Anpfiff nicht stornierbar | N | eigene Wette, Spiel bereits gestartet | Storno-Button prüfen | Button ist ausgeblendet/deaktiviert, kein Storno möglich | Blocker | offen | |
| Rangliste | Kombi mit einem gestarteten Leg nicht stornierbar | N | eigene Kombi, ein Leg gestartet, andere nicht | Storno versuchen | Storno wird verweigert (mind. ein Leg gestartet blockiert die ganze Kombi) | Blocker | offen | |
| Rangliste | Fremde Wetten nur als Platzhalter | N | fremde, noch nicht sichtbare Wette | Fremde Zeile aufklappen | Nur "N Wettscheine platziert – sichtbar ab Anpfiff", kein Storno-Button sichtbar/nutzbar | Blocker | offen | |
| Rangliste | Wildi-Logo/Wildis konsistent | N | – | Rangliste durchsehen | Icon und Bezeichnung "Wildi"/"Wildis" konsistent mit Rest der App | Nice-to-have | offen | |

### 2. Profilstatistiken

| Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|---|---|
| Profil | Wettbilanz korrekt berechnet | N | Account mit mehreren gewonnenen/verlorenen Wetten | Profil öffnen, "Wettbilanz" mit manueller Summe (Auszahlung − Einsatz) vergleichen | Werte stimmen exakt überein | Blocker | offen | |
| Profil | Taschengeld separat ausgewiesen | N | Account mit Taschengeld-Zahlungen | "Taschengeld & Sonstiges"-Zeile prüfen | Zeigt Restdifferenz zwischen Guthabenveränderung und Wettbilanz, nicht mit Wettbilanz vermischt | Blocker | offen | |
| Profil | Gesetzte Wildis korrekt | N | mehrere Wetten mit bekannten Einsätzen | Statistik-Kachel "Gesamt"/Einsatz-Summe mit eigener Rechnung vergleichen | Summe stimmt | Wichtig | offen | |
| Profil | Begriffe verständlich, kein "ausgezahlt = Wettgewinn"-Missverständnis | N | – | Profilseite komplett lesen | Kein Eindruck, dass Taschengeld ein Wettgewinn wäre | Wichtig | offen | Subjektive Prüfung |
| Profil | Eigenes Profil korrekt | N | – | Eigenes Profil öffnen | Alle Werte wie oben korrekt | Blocker | offen | |
| Profil | Fremdes Profil korrekt | N | anderes Nutzerprofil | `/spieler/[id]` eines anderen Nutzers öffnen | Wettbilanz/Rang/Awards korrekt für den fremden Nutzer, keine eigenen Daten vermischt | Wichtig | offen | |

### 3. Pokalschrank / Awards

| Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|---|---|
| Pokalschrank | Sichtbar im eigenen Profil | N | mind. 1 Award vorhanden (ggf. Testmatchday 999 nutzen) | Eigenes Profil öffnen | Pokalschrank-Sektion mit Award(s) sichtbar | Wichtig | offen | |
| Pokalschrank | Sichtbar bei Mitspielern | N | Mitspieler mit Award | `/spieler/[id]` öffnen | Pokalschrank dort ebenfalls sichtbar | Blocker | offen | Direkt betroffen von RLS-Fix (user_awards_select_all) |
| Pokalschrank | Gruppierung x2/x3 | N | Nutzer mit mehrfachem gleichen Award | Award-Kachel ansehen | Zähl-Badge "×2"/"×3" korrekt | Wichtig | offen | |
| Pokalschrank | Detailansicht zeigt Einzelgewinne | N | wie oben | Auf die Award-Kachel tippen (aufklappen) | Liste mit jedem Einzelgewinn (Spieltag + Saison + Wert) erscheint | Wichtig | offen | |
| Recap | Awards prominent im Spieltags-Recap | N/A | abgerechneter Spieltag mit Awards | Recap-Seite für diesen Spieltag öffnen | Awards als eigene Karten prominent angezeigt, inkl. Share-Option | Wichtig | offen | |
| Awards | Keine Doppel-Vergabe bei erneutem Settlement-Versuch | A | bereits abgerechnetes Spiel/Spieltag | Versuch, denselben Spieltag/dasselbe Spiel erneut abzurechnen | Re-Abrechnung wird blockiert (409-Fehler), keine doppelten Award-Einträge | Blocker | offen | Kombiniert Re-Settlement-Guard + Award-Upsert-Logik |
| user_awards RLS | Normaler Nutzer kann Awards sehen | N | – | Awards auf Profil/Mitspieler-Profil ansehen | Sichtbar wie gewohnt | Blocker | offen | |
| user_awards RLS | Normaler Nutzer kann keine Awards anlegen | N | – | Versuch via Browser-Konsole: `supabase.from('user_awards').insert({...})` | Wird von RLS abgelehnt (Fehler/leere Response, kein neuer Eintrag) | Blocker | offen | Direkter Test des Audit-Fixes |
| user_awards RLS | Normaler Nutzer kann keine Awards ändern | N | fremder oder eigener Award-Eintrag | Versuch: `supabase.from('user_awards').update({...}).eq('id', X)` | Wird abgelehnt, keine Änderung | Blocker | offen | |
| user_awards RLS | Normaler Nutzer kann keine Awards löschen | N | wie oben | Versuch: `supabase.from('user_awards').delete().eq('id', X)` | Wird abgelehnt, Eintrag bleibt bestehen | Blocker | offen | |
| user_awards RLS | Server-Award-Logik funktioniert weiterhin | A | Spieltag abrechnen mit klaren Award-Kandidaten | Spieltag regulär über Admin abrechnen | Awards werden trotz RLS-Sperre korrekt vergeben (läuft über Service-Role) | Blocker | offen | Bestätigt, dass der RLS-Fix die legitime Vergabe nicht kaputt gemacht hat |

**Die 7 Awards einzeln testen (mit Testmatchday 999 empfohlen, da echte Spieltage lange dauern):**

| Award | Testfall | Voraussetzung/Testdaten | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|
| 🏆 Spieltagskönig | Bester Gesamtsaldo am Spieltag | mehrere Nutzer mit unterschiedlichem Saldo | Nutzer mit höchstem positiven Saldo bekommt Award | Wichtig | offen | |
| 🥚 Eier aus Stahl | Höchste gewonnene Quote | mehrere gewonnene Wetten mit unterschiedlichen Quoten | Nutzer mit höchster gewonnener Quote bekommt Award | Wichtig | offen | |
| 😭 Unlucky Bastard | Kombi mit genau 1 verlorenem Leg | Kombi mit 2+ Legs, genau 1 verliert | Award wird vergeben, Detailansicht zeigt welches Leg verloren hat | Wichtig | offen | |
| 🔮 Ergebnis-Orakel | Exaktes Ergebnis richtig getippt | gewonnene "Genaues Ergebnis"-Wette | Award wird vergeben | Wichtig | offen | |
| 🚽 Griff ins Klo | Höchster verlorener Einsatz | mehrere verlorene Wetten unterschiedlicher Höhe | Nutzer mit höchstem verlorenen Einsatz bekommt Award | Wichtig | offen | |
| 🧱 Betonmischer | Niedrigste gewonnene Quote | mehrere gewonnene Wetten unterschiedlicher Quote | Nutzer mit niedrigster gewonnener Quote bekommt Award | Wichtig | offen | |
| 🔥 On Fire | Meiste gewonnene Wettscheine (≥2) | Nutzer mit 2+ gewonnenen Wettscheinen am selben Spieltag | Award wird vergeben, Anzahl korrekt | Wichtig | offen | |

### 4. Push / Cron

| Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|---|---|
| Push | Reminder-Push nicht doppelt | N | Push aktiviert, offene Wettscheine, Zeitfenster 2,5h vor Anpfiff | Zeitfenster abwarten/mehrfach Cron auslösen (falls manuell möglich) | Nur eine Push-Benachrichtigung pro Nutzer/Spieltag | Wichtig | offen | Am einfachsten mit Testmatchday 999 simulierbar |
| Push | Settlement-Push nicht doppelt | N | abgerechnetes Spiel mit eigenen Wetten | Spiel einmal abrechnen, ggf. Re-Abrechnungsversuch (wird eh geblockt) | Nur eine Push-Benachrichtigung pro Nutzer/Spiel | Wichtig | offen | |
| Push | notification_log-Dedupe funktioniert | A | Supabase-Zugriff | Nach einem Push-Ereignis `select * from notification_log where dedupe_key = '...'` prüfen | Nur ein Eintrag mit `status='sent'` pro dedupe_key | Wichtig | offen | Direkt in Supabase prüfen |
| Push | CRON_SECRET greift | A | – | Cron-Endpoint ohne/mit falschem Bearer-Token aufrufen (z. B. via curl) | 401 Unauthorized, kein Push wird versendet | Blocker | offen | Sicherheitsrelevant |
| Push | Keine Pushes an falsche Nutzer | N | mehrere Testnutzer, nur einer hat offene Wettscheine | Reminder-Zeitfenster abwarten | Nur der betroffene Nutzer bekommt die Erinnerung, nicht alle | Blocker | offen | |
| Push | Fehlgeschlagene Subscription führt nicht zu Fehlern | N | Push-Subscription im Browser deaktivieren/löschen, dann Ereignis auslösen | Server-seitig prüfen (Logs), ob Fehler sauber behandelt werden | Kein Serverfehler/Absturz, ungültige Subscription wird bereinigt | Nice-to-have | offen | |

### 5. Mobile UI

| Bereich | Testfall | Rolle | Voraussetzung/Testdaten | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|---|---|
| Mobile | Tipps-Seite auf iPhone | N | echtes iPhone (Safari) | Tipps-Seite durchscrollen, Wettkarten aufklappen | Layout sauber, keine abgeschnittenen Elemente | Wichtig | offen | |
| Mobile | Tipps-Seite auf Android | N | echtes Android-Gerät (Chrome) | wie oben | Layout sauber | Wichtig | offen | |
| Mobile | Wettschein-Modal iPhone | N | iPhone mit Home-Indicator (z. B. iPhone 12+) | Wettschein öffnen, bis Button scrollen | Button nicht vom Home-Indicator verdeckt | Blocker | offen | |
| Mobile | Wettschein-Modal Android | N | Android-Gerät | wie oben | Button vollständig erreichbar | Blocker | offen | |
| Mobile | Rangliste mobil | N | – | Rangliste auf Handy öffnen, Zeilen aufklappen | Lesbar, Storno-Button erreichbar | Wichtig | offen | |
| Mobile | Profil mobil | N | – | Profilseite auf Handy öffnen | Alle Kacheln/Charts sauber dargestellt | Wichtig | offen | |
| Mobile | Pokalschrank mobil | N | Awards vorhanden | Pokalschrank aufklappen auf Handy | Detailansicht (`<details>`) funktioniert per Touch | Wichtig | offen | |
| Mobile | Anleitung mobil | N | – | Anleitung-Seite auf Handy durchscrollen | Akkordeons funktionieren, Text lesbar | Nice-to-have | offen | |
| Mobile | Adminbereich zumindest nutzbar | A | – | Admin-Panel auf Handy öffnen (Spieltag-, Quoten-, Verwaltung-Tab) | Grundfunktionen (Ergebnis eintragen, Filter, Kader) bedienbar, kein horizontales Scrollen bei normalen Inhalten nötig | Nice-to-have | offen | Admin ist primär für Desktop gedacht, "zumindest nutzbar" reicht |
| Mobile | Lange Teamnamen mobil | N | "[SG] TSV Herrsching/SF Breitbrunn 2" | Auf Wettkarte, Tabelle, ShareCard (Recap teilen) ansehen | Kein Layoutbruch, sauberes Abschneiden mit "…" | Wichtig | offen | Direkt betroffener Audit-Fund (ShareCard-Fix) |
| Mobile | Lange Spielernamen mobil | N | Torschützen-Markt mit langem Spielernamen | Torschützen-Tab in Wettkarte öffnen | Kein Layoutbruch | Nice-to-have | offen | |
| Mobile | Buttons nicht abgeschnitten (allgemein) | N | – | Alle oben genannten Seiten durchklicken | Kein Button/Interaktionselement ist am Rand abgeschnitten oder unerreichbar | Blocker | offen | Sammel-Check über alle Seiten |

---

## Finaler Audit / Security-Nachtests

### user_awards RLS

| Testfall | Rolle | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|
| Awards lesbar | N | Eigenes + fremdes Profil ansehen | Awards sichtbar | Blocker | offen | |
| Keine Award-Erstellung durch Nutzer | N | Direkter Insert-Versuch via Browser-Konsole | Abgelehnt | Blocker | offen | |
| Keine Award-Änderung durch Nutzer | N | Direkter Update-Versuch | Abgelehnt | Blocker | offen | |
| Keine Award-Löschung durch Nutzer | N | Direkter Delete-Versuch | Abgelehnt | Blocker | offen | |
| Server-Vergabe funktioniert weiterhin | A | Spieltag abrechnen | Awards werden korrekt vergeben | Blocker | offen | |

### bets DELETE RLS

| Testfall | Rolle | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|
| Eigene pending Wette vor Anpfiff stornierbar | N | Storno über normale App-Funktion | Funktioniert, Einsatz zurückerstattet | Blocker | offen | |
| Eigene Wette nach Anpfiff nicht direkt löschbar | N | Direkter Delete-Versuch via Browser-Konsole nach Anpfiff | Abgelehnt (RLS blockt) | Blocker | offen | Neuer Fix, unbedingt gegentesten |
| Verschobene Spiele weiterhin stornierbar | N | Storno einer Wette auf verschobenem Spiel | Funktioniert unabhängig vom ursprünglichen Anpfiff-Datum | Blocker | offen | |
| API-Storno funktioniert weiterhin korrekt | N | Normale Storno-Nutzung über UI (Einzel + Kombi) | Kein Unterschied zum bisherigen Verhalten spürbar | Blocker | offen | Regressionscheck nach RLS-Verschärfung |

### username Grant

| Testfall | Rolle | Schritte | Erwartetes Ergebnis | Priorität | Status | Notizen |
|---|---|---|---|---|---|---|
| Username nicht mehr änderbar | N | Direkter Update-Versuch via Browser-Konsole: `supabase.from('profiles').update({username:'x'})` | Wird von DB abgelehnt (Grant entzogen) | Blocker | offen | |
| App funktioniert ohne sichtbaren Username | N | Normale Nutzung: Profil, Rangliste, Kommentare, Reaktionen | Alles funktioniert über Anzeigename, kein Fehler durch fehlenden Username-Zugriff | Blocker | offen | |

---

## Known Issues zum Eintragen

*(Bitte hier eigene Findings während des Testens ergänzen)*

| Fehlerbeschreibung | Bereich | Screenshot vorhanden (ja/nein) | Schritte zur Reproduktion | Erwartetes Verhalten | Tatsächliches Verhalten | Priorität | Entscheidung (vor Release fixen / später / egal) |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |

---

## Nice-to-have / später (aus dieser Liste bereits vorab markiert)

- Rangliste: Gleichstand-alphabetisch-Test (schwer künstlich herzustellen)
- Recap-Share-Wortlaut/Feinschliff
- Admin-Mobile-Nutzbarkeit (Admin ist primär Desktop-Tool)
- Push: Bereinigung ungültiger Subscriptions (kein Nutzer-Impact, nur Hygiene)
- Anleitung "nicht überladen" (subjektiv, kein funktionaler Bug)
- Quoten-Plausibilität Spieltag 1–4 (endgültig erst mit echten Ergebnissen im Saisonverlauf beurteilbar)
- Lange Spielernamen im Torschützen-Markt (geringes Risiko, seltener Fall)
