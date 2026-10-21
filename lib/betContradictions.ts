/**
 * Same-match selection contradictions — single source of truth for "does
 * picking B make picking A pointless/impossible to hold at the same time".
 * Only meaningful when both candidates are already known to be for the SAME
 * match; this module has no match/game concept of its own.
 *
 * Used by context/BetSlipContext.tsx to decide whether a new pick REPLACES
 * an existing one in the not-yet-submitted Wettschein, instead of silently
 * stacking alongside it — stacking two same-match legs always ends up as an
 * "Ungültige Kombination" the moment the slip has 2+ selections, since a
 * combo can never hold two legs from the same match (see
 * app/api/bets/place/route.ts). This module does NOT replace that
 * server-side validation (kept exactly as-is, per its own authority) — it
 * only drives the client-side replace UX so the invalid state is never
 * reached in the first place.
 */

interface ContradictionCandidate {
  marketType: string
  selection: string
}

export function selectionsContradict(a: ContradictionCandidate, b: ContradictionCandidate): boolean {
  // Same market, different pick: there is only ever one slot per market on a
  // match (Über vs. Unter, Heim vs. Unentschieden vs. Gast, …) — the new pick
  // always replaces the old one. (Identical picks are handled separately as
  // an exact-repeat toggle-off before this function is ever consulted.)
  if (a.marketType === b.marketType) return a.selection !== b.selection

  const has = (m: string, s: string) => (a.marketType === m && a.selection === s) || (b.marketType === m && b.selection === s)

  // 1X2 ↔ Doppelte Chance: the same "wer gewinnt"-Entscheidung, nur über
  // einen anderen Markt ausgedrückt — ob es die exakte Gegenseite ist oder
  // nicht, eine neue Auswahl hier ersetzt immer die alte statt daneben zu
  // stehen (siehe Aufgabenbeschreibung: "1" dann "1X" soll nur "1X" lassen).
  if ((a.marketType === '1x2' && b.marketType === 'double_chance') || (b.marketType === '1x2' && a.marketType === 'double_chance')) return true

  // Genaues Ergebnis legt Tordifferenz/Gesamttore fest und widerspricht damit
  // jedem Markt, den dieses exakte Ergebnis unmöglich macht.
  const exact = a.marketType === 'exact_score' ? a : b.marketType === 'exact_score' ? b : null
  if (exact) {
    const [hg, ag] = exact.selection.split(':').map(Number)
    const t = hg + ag
    const diff = hg - ag
    if (has('1x2', 'home') && ag > hg) return true
    if (has('1x2', 'away') && hg >= ag) return true
    if (has('1x2', 'draw') && hg !== ag) return true
    if (has('over_under_3_5', 'over_3.5') && t <= 3) return true
    if (has('over_under_3_5', 'under_3.5') && t >= 4) return true
    if (has('over_under_5_5', 'over_5.5') && t <= 5) return true
    if (has('over_under_5_5', 'under_5.5') && t >= 6) return true
    if (has('over_under_7_5', 'over_7.5') && t <= 7) return true
    if (has('over_under_7_5', 'under_7.5') && t >= 8) return true
    if (has('over_9_5', 'over_9.5') && t <= 9) return true
    if (has('btts', 'yes') && (hg === 0 || ag === 0)) return true
    if (has('btts', 'no') && hg > 0 && ag > 0) return true
    if (has('handicap', 'home_minus_1_5') && diff < 2) return true
    if (has('handicap', 'away_plus_1_5') && diff >= 2) return true
    if (has('handicap', 'home_minus_2_5') && diff < 3) return true
    if (has('handicap', 'away_plus_2_5') && diff >= 3) return true
    // Mirrored (away-favoured) direction.
    if (has('handicap', 'away_minus_1_5') && diff > -2) return true
    if (has('handicap', 'home_plus_1_5') && diff < -1) return true
    if (has('handicap', 'away_minus_2_5') && diff > -3) return true
    if (has('handicap', 'home_plus_2_5') && diff < -2) return true
  }

  // Über 9,5 impliziert jede niedrigere Über-Linie, die Unter-Gegenstücke
  // widersprechen ihr also direkt. NICHT widersprüchlich ist dagegen
  // "Nicht beide treffen": ein 10:0 erfüllt beides. `over_under` ist die
  // reguläre 2,5-Linie (siehe types/index.ts#MarketType).
  if (has('over_9_5', 'over_9.5') && has('over_under', 'under_2.5')) return true
  if (has('over_9_5', 'over_9.5') && has('over_under_3_5', 'under_3.5')) return true
  if (has('over_9_5', 'over_9.5') && has('over_under_5_5', 'under_5.5')) return true

  // Handicap ±1.5/±2.5 schließt die extremen 1X2-Ausgänge aus, die der
  // Vorsprung gar nicht zulässt (nicht aber den naheliegenden Sieg-Tipp
  // derselben Seite — "Heimsieg" + "Heim -1.5" ist ein normales, zulässiges
  // Paar und bleibt unabhängig kombinierbar).
  if (has('handicap', 'home_minus_1_5') && has('1x2', 'draw')) return true
  if (has('handicap', 'home_minus_1_5') && has('1x2', 'away')) return true
  if (has('handicap', 'home_minus_2_5') && has('1x2', 'draw')) return true
  if (has('handicap', 'home_minus_2_5') && has('1x2', 'away')) return true
  if (has('handicap', 'away_minus_1_5') && has('1x2', 'draw')) return true
  if (has('handicap', 'away_minus_1_5') && has('1x2', 'home')) return true
  if (has('handicap', 'away_minus_2_5') && has('1x2', 'draw')) return true
  if (has('handicap', 'away_minus_2_5') && has('1x2', 'home')) return true

  return false
}
