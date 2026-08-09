# Finalisierung 26/27 — Arbeitsstand

Arbeitsnotiz zur 19-Punkte-Finalisierungsliste. Kann gelöscht werden, sobald alles erledigt ist.
Stand: unterbrochen nach Punkt 5 (Nutzungslimit).

## Erledigt und auf `main` gepusht

| Commit | Inhalt |
|---|---|
| `f4b710d` | Wett-Validierung berücksichtigt Admin-Overrides (vorher: Override sichtbar, Wette aber abgelehnt) |
| `2279413` | **Punkt 1** — Spieltagsauswahl numerisch sortiert |
| `63ae4db` | **Punkt 4** — Über/Unter-Quoten: Liga-Basiswert war 36 % zu niedrig; Ü/U 7,5 entfernt |
| `df57d07` | **Punkt 4** — Abwehr-Vorzeichen, Quoten-Untergrenze, Hedging-Sperre |
| `1f2ec2d` | **Punkt 5** — Torschützenmarkt wieder funktionsfähig (beide Mannschaften) |

### Punkt 1 — Spieltagsauswahl
Ursache: `kreisligaMatchdaysSorted` (lib/season.ts) ist nach *frühester Anstoßzeit* sortiert und wurde
direkt als Auswahlleiste gerendert → `1-3-4-5-6-13-7-2-8-...` (exakt reproduziert).
Fix: neues `kreisligaMatchdaysNumeric` für die Anzeige. **`kreisligaMatchdaysSorted` bleibt chronologisch**
und bleibt am Wettfenster-Gate ("nie zwei Spieltage gleichzeitig wettbar") — numerisch dort würde
Spieltag 2 (16.09.) und 8 (20.09.) gleichzeitig öffnen. Zusätzlich drei Stellen von `matchday` auf
`effectiveMatchdayOf` umgestellt (Pillen-Farbe, "Spieltag abgeschlossen", Ergebnis-Rücklink).

### Punkt 4 — Quoten (wichtigster Fund)
`LEAGUE_HOME_XG/AWAY_XG` waren 1,22/1,13 = 2,35 Tore/Spiel. **Real (prior_season_matches,
Kreisliga Zugspitze 25/26, 364 Spiele): 2,173 / 1,497 = 3,670.** Diese Konstanten sind sowohl das
Bayes-Ziel als auch der Maßstab, auf den Vorsaison-Werte skaliert werden → die gesamte Torskala war falsch.

    Über 3,5   4,99 -> 2,02   (empirisch fair ~1,76)
    Über 5,5  36,48 -> 6,91   (empirisch fair ~5,62)

Die Poisson-Mathematik selbst war korrekt (modelliert/empirisch: O2,5 .709/.703, O3,5 .500/.508,
O5,5 .166/.159; 1X2 Heimsieg .528/.517). Nur der Mittelwert war falsch.
Weitere Funde: `LEAGUE_STRENGTH` wurde in die **Abwehr**-Terme multipliziert statt dividiert (Aufsteiger
wurden als bessere Abwehr projiziert); `MIN_ODDS` 1,05 erzeugte positiv-EV-Wetten und Bücher < 1,0
(Arbitrage) → auf 1,01 gesenkt; Gegenwetten im selben Markt serverseitig gesperrt.

**Wichtig:** `odds` und `odds_diagnostics` wurden geleert (0 offene Wetten, 0 Wetten auf 26/27-Spiele),
damit keine Quote aus dem alten Modell überlebt. Sie werden beim nächsten Seitenaufruf neu eingefroren.

### Punkt 5 — Torschützen
Vier unabhängige Ursachen, alle behoben — siehe Commit-Text. Datenseitig: `wildenroth_players.prev_*`
aus `league_players` befüllt (21 aktive Spieler 1. Mannschaft, 19 davon mit verwertbarer Historie),
abgegangene deaktiviert, drei Zugänge ergänzt. Alte eingefrorene Torschützen-Zeilen der 26/27-Spiele gelöscht.

## Offen

### Punkt 2 — Spielpläne — **ERLEDIGT, keine Änderung nötig**
Beide PDFs (Stand 09.08.) sind inhaltlich **identisch** mit denen vom 31.07.; nur die Fußzeile
unterscheidet sich. Vollabgleich gegen die DB: **372/372 Spiele stimmen exakt** (Teams, Spieltag, Datum,
Uhrzeit inkl. Sommer-/Winterzeit), verifiziert über Prüfsummen je Spieltag (52/52 Gruppen identisch).
Nur Namensvarianten (rein kosmetisch, DB-Namen sind bewusst kürzer):
PDF `TSV Oberalting` = DB `TSV Oberalting-Seefeld`; PDF `(SG 1) TSV Herrsching/SF Breitbrunn II` =
DB `[SG] TSV Herrsching/SF Breitbrunn 2`; PDF `SV Adelshofen Nassenhausen II` = DB `SV Adelshofen II`.
23 Spiele sind im PDF als verlegt markiert; 8 davon werden durch die >7-Tage-Regel einem anderen
Spieltag zugeordnet (mit Badge "eigentlich Spieltag X").

### Punkt 3 — Handicap verständlicher
Settlement ist ein sauberes Asian Handicap ohne Rückerstattung (`settleBet`, settle/route.ts):
`home_minus_1_5` gewinnt bei Tordifferenz >= 2, `away_plus_1_5` bei <= 1 (also auch Unentschieden oder
1 Tor Niederlage). Die vom Nutzer vorgeschlagenen Texte sind damit **fachlich korrekt**.
Zu tun: Hilfetext/Tooltip in `components/BettingMatchCard.tsx` (Handicap-Tab), und
`components/MyBets.tsx` + `app/(app)/tipps/page.tsx` zeigen `-1,5`/`+1,5` **ohne Teamnamen** → auf
`Heim -1,5`/`Gast +1,5` vereinheitlichen.

### Punkte 6-19 — noch nicht bearbeitet
6 Teamstatistik Saisonwechsel · 7 Liga-Torschützen · 8 Kader ausblenden · 9 Wappen SG Herrsching ·
10 Rangliste · 11 Recap · 12 Awards · 13 Hilfe-Seite · 14 Taschengeld (10 Wildis, erste Zahlung
17.08.2026 12:00) · 15 Inaktivitätsstrafe (100 -> **50**) · 16 Adminbereich · 17 Benachrichtigungen ·
18 Login/Registrierung · 19 Abschluss-Audit.

Audit-Ergebnisse (6 von 13 Bereichen fertig) liegen als Findings vor; die restlichen 7 Bereiche
(Rangliste/RLS, Recap+Awards, Taschengeld+Strafe, Admin, Push, Auth, Hilfe) waren beim Abbruch noch
in Arbeit und müssen neu erhoben werden.

Bereits bekannte, noch offene Befunde aus den fertigen Bereichen:
- `app/(app)/tabelle/page.tsx`: ohne gespielte Spiele wird **alphabetisch** sortiert, trotzdem werden
  Auf-/Abstiegszonen eingefärbt. `get_prior_standings` wird per RPC gerufen, **existiert aber nicht** in der DB.
- `/team/wildenroth` + `/team/wildenroth-ii`: kein Vorsaison-Fallback; zweite, abweichende Kopie von
  `computeStandings`.
- Top-Torschützen auf den Teamseiten ranken nach `wildenroth_players.goals` (laufende Saison, also 0)
  → zeigen nichts. `prev_*` ist jetzt befüllt und wäre die passende Quelle vor Saisonstart.
- `lib/wildenroth.ts`: Interessenkonflikt-Regel erlaubt `away_plus_*` bei Wildenroth-Auswärtsspielen,
  obwohl `double_chance` (logisch schwächer) gesperrt ist. **Regelentscheidung nötig.**
- `getRosterFactor` kann nur nach unten wirken (Zugänge haben keine Vorwerte) → ligaweit ca. -6 %.

## Entscheidungen, die der Nutzer treffen muss
1. **Wildenroth – Landsberg II (Spieltag 1).** Mit dem korrigierten Modell ist Wildenroth *noch
   deutlicher* Favorit (ca. 1,70 statt 2,33), weil mehr Tore den Favoriten stärken. Die frühere
   manuelle Korrektur (Landsberg II als Favorit) wurde durch das Löschen der eingefrorenen Quoten
   aufgehoben. Soll sie neu gesetzt werden (per Admin-Override, funktioniert seit `f4b710d` auch
   beim Wetten)?
2. **Handicap `away_plus_*` für gesperrte Wildenroth-Spieler** — erlauben oder sperren?
3. **Wildenroth II Torschützen**: 26 aktive Spieler, aber keine Vorsaison-Werte in der DB
   (`league_players` enthält nur die 1. Mannschaft) → Markt bleibt dort vorerst leer.

## Wichtige Fakten für die Fortsetzung
- Supabase-Projekt: `mpyqtymkdhxuannqhtvp`
- `app_settings.early_betting_open = 'true'` (auf Wunsch gesetzt, damit Spieltag 1 Quoten zeigt)
- 0 offene Wetten, 0 Wetten auf 26/27-Spiele; die 116 vorhandenen Wetten sind alle abgerechnet (Testsaison)
- Es existiert **kein** `over_under_7_5`-Wettschein → Entfernen war gefahrlos
- Empirische Referenzwerte Kreisliga 25/26: 3,670 Tore/Spiel, Heimsieg .517 / Remis .181 / Auswärts .302,
  BTTS .607, O2,5 .703 / O3,5 .508 / O5,5 .159
