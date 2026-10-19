import { effectiveMatchdayOf, type EffectiveMatchdayIndex } from '@/lib/season'
import type { Match } from '@/types'

/**
 * Zuordnung eines Wettscheins zum Tippspiel-Spieltag – nur Darstellung, keine Wettlogik.
 *
 * Befund (Stand v2.1): Weder `bets` noch `combo_bets` speichern den Spieltag, unter dem ein Schein
 * platziert wurde. Die Platzierungs-API (`app/api/bets/place`) leitet ihn bei jeder Anfrage aus den
 * Spielen des Scheins ab (`effectiveMatchdayOf`, Pokal: rohe Spieltagsnummer) und zählt einen Kombischein
 * in JEDEM Spieltag, in dem eines seiner Spiele liegt. Ein Kombischein mit Spielen aus mehreren
 * Spieltagen gehört also fachlich zu mehreren Spieltagen – es gibt keinen einzigen „richtigen“.
 *
 * Deshalb wird hier nichts geraten: Liegen alle zuordenbaren Spiele im selben Spieltag, ist die Zuordnung
 * eindeutig. Sonst wird „gemischt“ mit allen beteiligten Spieltagen ausgewiesen. (Die frühere Mehrheits-
 * regel mit „bei Gleichstand der spätere“ hat bei gemischten Scheinen stillschweigend einen Spieltag
 * behauptet, den die Daten nicht hergeben.)
 */
export type SlipMatchday =
  /** Alle zuordenbaren Spiele liegen im selben Spieltag. `partial`: mindestens ein Spiel ließ sich keinem Spieltag zuordnen. */
  | { kind: 'single'; matchday: number; partial: boolean }
  /** Spiele aus mindestens zwei Spieltagen (aufsteigend sortiert). */
  | { kind: 'mixed'; matchdays: number[] }
  | { kind: 'unknown' }

/** Spieltag eines einzelnen Spiels – exakt wie in `app/api/bets/place/route.ts`: Pokal nutzt die rohe Nummer. */
export function legMatchdayOf(match: Match, index: EffectiveMatchdayIndex): number | null {
  if (match.competition_type === 'cup') return match.matchday
  return effectiveMatchdayOf(match, index)
}

export function resolveSlipMatchday(legMatchdays: readonly (number | null)[]): SlipMatchday {
  const known = [...new Set(legMatchdays.filter((md): md is number => md != null))].sort((a, b) => a - b)
  if (known.length === 0) return { kind: 'unknown' }
  if (known.length === 1) return { kind: 'single', matchday: known[0], partial: legMatchdays.some((md) => md == null) }
  return { kind: 'mixed', matchdays: known }
}

export function slipGroupKey(r: SlipMatchday): string {
  return r.kind === 'single' ? `md-${r.matchday}` : r.kind === 'mixed' ? `mixed-${r.matchdays.join('-')}` : 'unknown'
}

export function slipGroupLabel(r: SlipMatchday): string {
  if (r.kind === 'single') return `${r.matchday}. Spieltag`
  if (r.kind === 'mixed') return `Spieltage ${r.matchdays.join(' + ')}`
  return 'Spieltag nicht eindeutig'
}

/**
 * Sortierwert einer Gruppe: Position im tatsächlichen Spielplan (`kreisligaMatchdaysDisplayOrder`,
 * Median-Anspielzeit) statt der BFV-Nummer – Spieltag 2 kann nach Spieltag 7 gespielt worden sein.
 * Gemischte Gruppen zählen mit ihrem spätesten Spieltag. Größer = jünger; unbekannt = −1.
 */
export function slipGroupRank(r: SlipMatchday, displayOrder: readonly number[]): number {
  const pos = (md: number) => {
    const i = displayOrder.indexOf(md)
    // Spieltag außerhalb der Kreisliga-Liste (z. B. Test 999 / Pokal): hinter alle regulären, nach Nummer
    return i >= 0 ? i : displayOrder.length + md
  }
  if (r.kind === 'single') return pos(r.matchday)
  if (r.kind === 'mixed') return Math.max(...r.matchdays.map(pos)) + 0.5
  return -1
}
