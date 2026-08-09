# Finalisierung 26/27 — Arbeitsstand

Arbeitsnotiz zur 19-Punkte-Finalisierungsliste. Kann gelöscht werden, sobald alles erledigt ist.
Stand: Punkte 1–9 erledigt und auf `main`. Hintergrund-Audit für 10/11/12/13/14/15/16/17/18 läuft.

## Erledigt und auf `main` gepusht

| Commit | Inhalt |
|---|---|
| `f4b710d` | Wett-Validierung berücksichtigt Admin-Overrides |
| `2279413` | **Punkt 1** — Spieltagsauswahl numerisch sortiert |
| `63ae4db` | **Punkt 4** — Über/Unter-Quoten: Liga-Basiswert war 36 % zu niedrig; Ü/U 7,5 entfernt |
| `df57d07` | **Punkt 4** — Abwehr-Vorzeichen, Quoten-Untergrenze, Hedging-Sperre |
| `1f2ec2d` | **Punkt 5** — Torschützenmarkt wieder funktionsfähig (beide Mannschaften) |
| `04a6a81` | **Nutzer-Entscheidung 2** — Handicap-COI-Lücke geschlossen (away_plus_* immer gesperrt) |
| `b4dbf8a` | **Punkt 3** — Handicap-Hilfetext + Team-Labels vereinheitlicht |
| `668b466` | **Punkt 6+7** — Tabelle/Teamseiten: Vorsaison-Fallback datengetrieben, Torjäger-Karte |
| `93efb9f` | **Punkt 8+9** — Kader für Nicht-Admins ausgeblendet; Herrsching-Wappen gefixt |
| DB-only (kein Commit) | **Nutzer-Entscheidung 1** — Landsberg II wieder Favorit; **Nutzer-Entscheidung 3** — Wildenroth-II-Kaderdaten eingepflegt |

### Punkt 1 — Spieltagsauswahl
`kreisligaMatchdaysSorted` (lib/season.ts) war nach *frühester Anstoßzeit* sortiert und wurde direkt
als Auswahlleiste gerendert → `1-3-4-5-6-13-7-2-8-...` (exakt reproduziert). Fix: neues
`kreisligaMatchdaysNumeric` für die Anzeige. **`kreisligaMatchdaysSorted` bleibt chronologisch** und
bleibt am Wettfenster-Gate — numerisch dort würde Spieltag 2 (16.09.) und 8 (20.09.) gleichzeitig öffnen.

### Punkt 2 — Spielpläne — keine Änderung nötig
Beide PDFs (Stand 09.08.) sind inhaltlich **identisch** mit denen vom 31.07. Vollabgleich gegen die DB:
**372/372 Spiele stimmen exakt**, verifiziert über Prüfsummen je Spieltag (52/52 Gruppen identisch).
23 Spiele sind im PDF als verlegt markiert; 8 davon werden durch die >7-Tage-Regel einem anderen
Spieltag zugeordnet (mit Badge "eigentlich Spieltag X").

### Punkt 3 — Handicap
Settlement ist ein sauberes Asian Handicap ohne Rückerstattung, die vom Nutzer vorgeschlagenen
Texte waren fachlich korrekt. Hilfetext im Handicap-Tab ergänzt; bare `-1,5`/`+1,5`-Labels (ohne
Team) in MyBets.tsx und tipps/page.tsx auf `Heim -1,5`/`Gast +1,5` vereinheitlicht.

### Punkt 4 — Quoten (wichtigster Fund)
`LEAGUE_HOME_XG/AWAY_XG` waren 1,22/1,13 = 2,35 Tore/Spiel. **Real (prior_season_matches,
Kreisliga Zugspitze 25/26, 364 Spiele): 2,173 / 1,497 = 3,670.**

    Über 3,5   4,99 -> 2,02   (empirisch fair ~1,76)
    Über 5,5  36,48 -> 6,91   (empirisch fair ~5,62)

Poisson-Mathematik war korrekt, nur der Mittelwert falsch. Weitere Funde: `LEAGUE_STRENGTH` wurde in
die Abwehr-Terme multipliziert statt dividiert; `MIN_ODDS` 1,05 erzeugte positiv-EV-Wetten und Bücher
< 1,0 (Arbitrage) → auf 1,01 gesenkt; Gegenwetten im selben Markt serverseitig gesperrt.
`odds`/`odds_diagnostics` wurden geleert (0 offene Wetten betroffen).

### Punkt 5 — Torschützen
Vier unabhängige Ursachen behoben (Datenlücke, fehlender Saisonwechsel-Fallback, falscher
DB-Client beim Einfrieren, fehlende Wildenroth-II-Unterstützung). `wildenroth_players.prev_*`
aus `league_players` befüllt für beide Mannschaften.

### Punkt 6+7 — Tabelle & Teamstatistik-Saisonwechsel, Liga-Torschützen
Ein zentrales `hasCurrentSeasonData`-Flag (>=1 abgeschlossenes Spiel) ersetzt mehrere widersprüchliche
Ad-hoc-Checks. Platz-Chip und Auf-/Abstiegsfarben erscheinen erst mit echten Ergebnissen; B-Klasse
zeigt "keine Vorsaison-Daten" statt einer Nullwerte-Tabelle (prior_season_matches hat 0 B-Klasse-Zeilen).
Neue "Torjäger"-Karte auf /tabelle (aktuell: match_lineups, sonst Vorsaison aus league_players).
Beide Teamseiten zeigen jetzt eine echte 25/26-Vorsaison-Karte statt "Saison noch nicht gestartet".

### Punkt 8+9
Kader-/Spielerbereich auf beiden Teamseiten nur noch für Admins sichtbar (`profiles.is_admin`),
nichts gelöscht. Herrsching-Wappen: `[SG] TSV Herrsching/SF Breitbrunn 2` hatte keinen passenden
Slug → `CREST_NAME_ALIAS` in `lib/teams.ts` ergänzt (zeigt jetzt auf `tsv-herrsching-ii.png`),
`TeamLogo.tsx` nutzt jetzt dieselbe Funktion statt einer eigenen (leicht abweichenden) Kopie.

### Punkt 14 — Taschengeld (Fund: liegt NICHT im Next.js-Code, sondern in Supabase)
Die Auszahlung läuft komplett DB-seitig: Postgres-Funktion `add_weekly_pocket_money()`, ausgelöst
durch `pg_cron`-Job `weekly-pocket-money` (`0 10,11 * * 1` — Montag 10 UND 11 Uhr UTC; die Funktion
selbst filtert per `EXTRACT(HOUR ... 'Europe/Berlin') = 12` auf die tatsächliche 12-Uhr-Stunde, sodass
je nach Sommer-/Winterzeit genau einer der beiden Cron-Trigger tatsächlich auszahlt — sauberes
DST-Handling). Der Saisonstart-Guard (`EXISTS (... matchday=1 AND match_date <= now())`) verhindert
korrekt jede Auszahlung vor dem ersten Spieltag-1-Anstoß (15.08.) — die erste greifende Montag-12-Uhr-
Prüfung ist damit bereits automatisch der 17.08.2026, wie gefordert. Eine verwaiste Edge Function
`weekly-pocket-money` existiert zusätzlich (ruft dieselbe SQL-Funktion auf), wird aber vom Cron-Job
nicht genutzt (der ruft die Funktion direkt per SQL) — unschädlich, aber doppelt gepflegt.

**Zwei echte Bugs gefunden und direkt per Migration behoben** (`fix_weekly_pocket_money_eligibility_and_dedupe`):
1. `UPDATE profiles SET balance = balance + 10` lief **ungefiltert über alle Profile** — auch über
   `eligible_for_current_season = false`-Nutzer (aktuell 1 von 9: "Mj"). Jetzt auf
   `eligible_for_current_season = true OR is_admin = true` eingeschränkt (gleiche Regel wie bei der
   Inaktivitätsstrafe in settle.ts).
2. **Keine Idempotenz-Sperre**: ein manueller Re-Run von `add_weekly_pocket_money()` in derselben
   12-Uhr-Stunde hätte ein zweites Mal ausgezahlt. Neue Tabelle `weekly_pocket_money_log(week_start
   date primary key)` — ein Insert-Unique-Constraint pro Kalenderwoche sperrt Doppelausführung,
   analog zum bestehenden `push_reminders`-Dedupe-Muster für Recap/Inaktivstrafe.
Mit einem harmlosen Testaufruf verifiziert (Saison noch nicht gestartet → korrekt kein Effekt,
Log-Tabelle bleibt leer, Balances unverändert).

### Nutzer-Entscheidungen (aus Rückfrage beantwortet)
1. **Landsberg II wieder Favorit**: Basis-Odds (Modell, unswapped) in `odds` für Match 293 eingefroren,
   Landsberg-Favorit-Variante über `match_odds_overrides` gesetzt (funktioniert jetzt auch beim
   tatsächlichen Wetten, nicht nur in der Anzeige).
2. **Handicap-COI**: `away_plus_*` ist jetzt für Wildenroth-Spieler **immer** gesperrt (nicht nur wenn
   Wildenroth Heim ist) — Commit `04a6a81`.
3. **Wildenroth-II-Kader**: 44 Spieler mit echten 25/26-Werten in `league_players`
   (`team_name='SpVgg Wildenroth II'`) eingepflegt, `wildenroth_players.prev_*` für Kader 2 befüllt
   (inkl. Korrektur zweier Tippfehler: "Lukas Ballhuber"→"Lukas Balhuber", "Thorsten Romanh"→"Romahn").

## Offen — Punkte 10-19

Hintergrund-Audit (Workflow `wwzclqx2o` abgeschlossen, `wf_e184b872-a3c` läuft) deckt ab:
10 Rangliste/RLS · 11 Recap · 12 Awards · 13 Hilfe-Seite · 14 Taschengeld (10 Wildis, erste Zahlung
17.08.2026 12:00) · 15 Inaktivitätsstrafe (100 → **50**, noch zu verifizieren/fixen) · 16 Adminbereich ·
17 Benachrichtigungen · 18 Login/Registrierung · 19 Abschluss-Regressionsaudit.

**Nächster Schritt bei Fortsetzung:** Ergebnisse des Workflows `wf_e184b872-a3c` (Journal unter
`/root/.claude/projects/-home-user-WildenrothTippspiel/b32b4259-557a-52c5-a5c5-3f9b5a149629/subagents/workflows/wf_e184b872-a3c/journal.jsonl`)
auslesen und Fixes analog zu den obigen Commits umsetzen. Falls der Workflow nicht mehr existiert/
abgelaufen ist: Punkte 10-18 einzeln neu untersuchen und beheben.

Bereits bekannte, noch offene Befunde (aus dem ersten Audit-Durchlauf, vor Punkt-6/7/8/9-Fixes
notiert, teilweise inzwischen behoben — bei Fortsetzung gegenprüfen):
- `getRosterFactor` kann nur nach unten wirken (Zugänge haben keine Vorwerte) → ligaweit ca. -6 %.
  Nicht behoben, kein Nutzer-Entscheid dazu eingeholt — niedrige Priorität, nur erwähnen falls gefragt.

## Wichtige Fakten für die Fortsetzung
- Supabase-Projekt: `mpyqtymkdhxuannqhtvp`
- `app_settings.early_betting_open = 'true'` (auf Wunsch gesetzt, damit Spieltag 1 Quoten zeigt)
- 0 offene Wetten, 0 Wetten auf 26/27-Spiele; die 116 vorhandenen Wetten sind alle abgerechnet (Testsaison)
- Es existiert **kein** `over_under_7_5`-Wettschein → Entfernen war gefahrlos
- Empirische Referenzwerte Kreisliga 25/26: 3,670 Tore/Spiel, Heimsieg .517 / Remis .181 / Auswärts .302,
  BTTS .607, O2,5 .703 / O3,5 .508 / O5,5 .159
- Match 293 (Wildenroth–Landsberg II, Spieltag 1) hat jetzt sowohl eine `odds`-Basiszeile als auch
  einen `match_odds_overrides`-Eintrag (Landsberg-Favorit) — bei erneuter Modelländerung beide prüfen.
