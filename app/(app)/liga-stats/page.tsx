import { redirect } from 'next/navigation'

/**
 * Entschieden nach technischer/rechtlicher Prüfung von BFV und FuPa (siehe Abschlussbericht
 * "Spielerstatistiken automatisieren oder ausblenden"): weder BFV noch FuPa erlauben einen
 * zuverlässigen, rechtlich zulässigen automatisierten Abruf von Aufstellungen/Einsätzen für
 * diese Liga — BFVs Nutzungsbedingungen untersagen ausdrücklich jede Vervielfältigung/
 * Weiterverarbeitung der DFBnet-Daten außerhalb des offiziellen Widget-Embeds (hier bewusst
 * nicht gewünscht), FuPas robots.txt blockiert die match- und playerstats-Pfade sowie die
 * Spieler-Rankings für Suchmaschinen, und api.fupa.net/robots.txt sperrt mit "Disallow: /"
 * (User-agent *) jeden automatisierten Zugriff komplett. Eine manuelle
 * Nachpflege (das ursprüngliche Problem) wollte der Nutzer ausdrücklich nicht wiederholen.
 *
 * Diese Seite zeigte ausschließlich individuelle Liga-Spielerstatistiken (Torschützen,
 * Vorlagen, Scorer, Einsätze, Minuten, Karten, MVP) — keine Mannschafts-/Tabellen-/Wett-
 * statistik ist betroffen, die bleibt vollständig unter /tabelle, /team/* etc. erhalten.
 * `lib/leagueStats.ts` und die zugrunde liegenden Tabellen (`match_lineups`,
 * `player_bfv_snapshot`, `player_season_snapshot`) werden NICHT gelöscht — nur diese
 * Darstellung ist entfernt, falls eine zuverlässigere Datenquelle doch noch gefunden wird.
 */
export default function LigaStatsPage() {
  redirect('/tabelle')
}
