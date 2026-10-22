import { buildEffectiveMatchdayIndex, effectiveMatchdayOf } from '@/lib/season'
import { occupiesBettingSlot } from '@/lib/slipLifecycle'
import type { Match } from '@/types'

/**
 * Anzeige „Wie viele Wettscheine habe ich für den aktuellen Spieltag schon platziert?“ an „Meine Wetten“ in der Navigation.
 *
 * Bedeutung (bewusst NICHT „Anzahl offener Scheine“): gezählt werden die platzierten Scheine des aktuellen Tippspiel-Spieltags –
 * offen UND bereits abgerechnet (gewonnen/verloren), nur stornierte nicht. Das ist dieselbe Zählung wie in der Platzierungs-API
 * (`app/api/bets/place`: pending + won + lost belegen einen Platz) und im Kopf der Tipps-Seite (Normal x/2, Risky y/1):
 * ein früh abgerechneter Schein gibt den Platz nicht wieder frei. Der Pokal-Bonusschein belegt weder Normal- noch Risky-Platz.
 * Ein Kombischein zählt als EIN Schein; Risky ist er, wenn sein erster Tipp `is_risky` trägt (alle Tipps eines Kombis teilen den Wert).
 *
 * „Aktueller Spieltag“ = der früheste Kreisliga-Spieltag (Spielplan-Reihenfolge, Median-Anstoß – nicht BFV-Nummer), der noch ein
 * nicht beendetes, nicht verschobenes Spiel hat; sind alle durch, der letzte. Gleiche Definition wie `currentMatchday` im Admin-Bereich.
 * Zwischen dem letzten Abpfiff und Montag 12 Uhr zeigt die Tipps-Seite noch den alten Spieltag mit Rückblick, die Navigation bereits den
 * kommenden – dort ist noch nichts platziert, also verschwindet die Zahl, bis der neue Spieltag getippt wird.
 */
export const NORMAL_SLOTS = 2
export const RISKY_SLOTS = 1

export type NavBetState = { matchday: number; normal: number; risky: number }

type MatchLite = Pick<Match, 'id' | 'matchday' | 'match_date' | 'status' | 'match_category' | 'is_topspiel' | 'tippspiel_matchday' | 'competition_type'>

export function activeTippMatchday(seasonMatches: MatchLite[]): { matchday: number | null; matchIds: number[] } {
  const matches = seasonMatches as unknown as Match[]
  const index = buildEffectiveMatchdayIndex(matches)
  const order = index.kreisligaMatchdaysDisplayOrder
  const effOf = (m: Match) => (m.matchday === 999 ? null : effectiveMatchdayOf(m, index))
  let matchday: number | null = null
  for (const md of order) {
    if (matches.some((m) => effOf(m) === md && m.status !== 'finished' && m.status !== 'postponed' && m.status !== 'annulled')) { matchday = md; break }
  }
  if (matchday == null) matchday = order[order.length - 1] ?? null
  if (matchday == null) return { matchday: null, matchIds: [] }
  return { matchday, matchIds: matches.filter((m) => effOf(m) === matchday).map((m) => m.id) }
}

type SingleBetLite = { is_risky: boolean | null; is_bonus: boolean | null }
type ComboLite = { is_risky: boolean | null; status: string }

/**
 * `singleBets` = Einzeltipp-Zeilen (combo_id IS NULL) des Nutzers auf Spielen des Spieltags.
 * `combos` = je EINE Zeile pro Kombischein des Nutzers, mit dem AUTORITATIVEN `combo_bets.status`
 * (nicht dem Status einzelner Legs!) — ein Kombischein belegt den Platz nur, solange sein
 * `combo_bets.status` selbst das noch sagt (`occupiesBettingSlot`, lib/slipLifecycle.ts).
 *
 * Grund für die Trennung (Regression vom 22.10.2026): ein storniertes Kombi kann noch ein
 * einzelnes, aus der amtlichen Annullierung stammendes `neutralized`-Leg besitzen, während die
 * übrigen Legs bereits `void` sind. Ein Lookup, der nur Leg-Zeilen dedupliziert (wie zuvor hier),
 * sieht diese eine Zeile, zählt sie als belegten Risky-/Normal-Platz — obwohl der Kombischein als
 * Ganzes storniert und für den Nutzer nicht mehr aktiv ist. Die einzige verlässliche Quelle ist
 * der Status der Kombi selbst, nie der eines einzelnen Legs.
 */
export function countPlacedSlots(singleBets: SingleBetLite[], combos: ComboLite[]): { normal: number; risky: number } {
  let normal = 0
  let risky = 0
  for (const b of singleBets) {
    if (b.is_bonus) continue
    if (b.is_risky) risky++
    else normal++
  }
  for (const c of combos) {
    if (!occupiesBettingSlot(c.status)) continue
    if (c.is_risky) risky++
    else normal++
  }
  return { normal, risky }
}

export function navBadgeLabel(s: NavBetState | null): string | undefined {
  if (!s || s.normal + s.risky === 0) return undefined
  return `Spieltag ${s.matchday}: Normal ${s.normal} von ${NORMAL_SLOTS}, Risky ${s.risky} von ${RISKY_SLOTS} platziert`
}
