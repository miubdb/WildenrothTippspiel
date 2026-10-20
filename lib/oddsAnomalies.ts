import type { OddsDiagnostics } from '@/lib/odds'

/**
 * Admin 3.0, Punkt 8: automatische Quotenwarnungen. Rein lesende Analyse der bereits vom Modell
 * berechneten Werte (Quoten + `OddsDiagnostics`, wie sie `/api/admin/odds/preview` ohnehin schon
 * zurückgibt) — KEINE eigene Quotenberechnung, kein Zugriff auf Kopf-an-Kopf-/Saisondaten, keine
 * automatische Korrektur. "Ungewöhnlich" heißt hier ausdrücklich nicht "falsch": jede Warnung
 * nennt den konkreten Wert und den Grund, die Einordnung bleibt beim Admin (siehe CLAUDE.md zu
 * Punkt 8 im Auftrag — Vorgabe, keine automatische Quotenänderung).
 *
 * Schwellenwerte sind bewusst grobe, dokumentierte Heuristiken für "verdient einen zweiten Blick",
 * keine Re-Implementierung der Modell-Konstanten aus lib/odds.ts (die bleiben dort privat und
 * unverändert) — dieses Modul erzeugt nur Hinweise, niemals Zahlen, die in eine Quote einfließen.
 */

/** Nur die für die Analyse gebrauchten Felder — absichtlich kein voller `OddsValues`-Import aus
 *  app/admin/page.tsx (Richtung falsch: lib/ darf nicht von app/ abhängen). */
export interface OddsAnomalyInput {
  home_win: number
  draw: number
  away_win: number
  over_2_5: number
  under_2_5: number
  btts_yes: number
  btts_no: number
}

export type OddsAnomalyCode =
  | 'extreme_favorite' | 'extreme_longshot' | 'low_sample_home' | 'low_sample_away'
  | 'thin_league_baseline' | 'roster_factor_home' | 'roster_factor_away' | 'goal_expectancy'

export interface OddsAnomaly {
  code: OddsAnomalyCode
  /** Kurzer, für Admins verständlicher Grund inkl. der konkreten Zahl(en). */
  reason: string
}

const EXTREME_SHORT_ODDS = 1.12
const EXTREME_LONG_ODDS = 40
const LOW_SAMPLE_GAMES = 3
const THIN_BASELINE_MATCHES = 10
const ROSTER_FACTOR_LOW = 0.7
const ROSTER_FACTOR_HIGH = 1.1
const GOAL_EXPECTANCY_DEVIATION = 2.0

const fmt = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Prüft ein Spiel und liefert 0..n Hinweise. Reine Funktion, keine Seiteneffekte. */
export function detectOddsAnomalies(odds: OddsAnomalyInput, diagnostics: OddsDiagnostics): OddsAnomaly[] {
  const out: OddsAnomaly[] = []

  const shortest = Math.min(odds.home_win, odds.draw, odds.away_win)
  if (shortest <= EXTREME_SHORT_ODDS) {
    out.push({ code: 'extreme_favorite', reason: `Sehr kurze 1X2-Quote (${fmt(shortest)}) — nahe der Modell-Untergrenze.` })
  }
  const longest = Math.max(odds.home_win, odds.draw, odds.away_win)
  if (longest >= EXTREME_LONG_ODDS) {
    out.push({ code: 'extreme_longshot', reason: `Sehr lange 1X2-Quote (${fmt(longest)}) — weit außerhalb des üblichen Bereichs.` })
  }

  if (diagnostics.home.gamesAll < LOW_SAMPLE_GAMES) {
    out.push({ code: 'low_sample_home', reason: `Heimteam hat erst ${diagnostics.home.gamesAll.toFixed(1)} gewertete Saisonspiele — Rate stützt sich noch stark auf Vorsaison/Liga-Baseline.` })
  }
  if (diagnostics.away.gamesAll < LOW_SAMPLE_GAMES) {
    out.push({ code: 'low_sample_away', reason: `Gastteam hat erst ${diagnostics.away.gamesAll.toFixed(1)} gewertete Saisonspiele — Rate stützt sich noch stark auf Vorsaison/Liga-Baseline.` })
  }

  if (diagnostics.baselineSampleMatches < THIN_BASELINE_MATCHES) {
    out.push({ code: 'thin_league_baseline', reason: `Liga-Basiswert (${diagnostics.tier}) beruht auf nur ${diagnostics.baselineSampleMatches} echten Spielen — noch überwiegend der gepoolte Prior.` })
  }

  if (diagnostics.home.rosterFactor <= ROSTER_FACTOR_LOW || diagnostics.home.rosterFactor >= ROSTER_FACTOR_HIGH) {
    out.push({ code: 'roster_factor_home', reason: `Kader-Faktor Heimteam ${diagnostics.home.rosterFactor.toFixed(2)} — Transfers/Abgänge wirken merklich auf die Quote.` })
  }
  if (diagnostics.away.rosterFactor <= ROSTER_FACTOR_LOW || diagnostics.away.rosterFactor >= ROSTER_FACTOR_HIGH) {
    out.push({ code: 'roster_factor_away', reason: `Kader-Faktor Gastteam ${diagnostics.away.rosterFactor.toFixed(2)} — Transfers/Abgänge wirken merklich auf die Quote.` })
  }

  const totalXg = diagnostics.home.finalXG + diagnostics.away.finalXG
  const baselineTotal = diagnostics.baselineHome + diagnostics.baselineAway
  if (Math.abs(totalXg - baselineTotal) >= GOAL_EXPECTANCY_DEVIATION) {
    out.push({
      code: 'goal_expectancy',
      reason: `Torerwartung ${totalXg.toFixed(2)} weicht stark vom Liga-Durchschnitt (${baselineTotal.toFixed(2)}) ab — wirkt sich auf Über/Unter und BTTS aus.`,
    })
  }

  return out
}
