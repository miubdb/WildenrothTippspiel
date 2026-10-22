/**
 * Ob eine Kombiwette bereits begonnen hat. Diese Definition wird sowohl von
 * der Admin-Annullierungsvorschau als auch von der tatsächlichen Storno-API
 * verwendet, damit "noch stornierbar" niemals von der UI abweicht.
 *
 * Ein gewonnenes/verlorenes Leg beweist einen bereits begonnenen Schein.
 * Neutralisierte Legs (Spiel endgültig abgesagt) blockieren dagegen die
 * Stornierung verbleibender, tatsächlich noch unbegonnener Legs nicht.
 */
export interface BetStartLeg {
  match_id: number
  status: string
}

export interface BetStartMatch {
  id: number
  match_date: string
  status: string
}

export function hasStartedCombo(
  legs: BetStartLeg[],
  matches: BetStartMatch[],
  now: Date = new Date(),
): boolean {
  const matchById = new Map(matches.map((m) => [m.id, m]))
  return legs.some((leg) => {
    if (leg.status === 'neutralized' || leg.status === 'void') return false
    if (leg.status === 'won' || leg.status === 'lost') return true
    const match = matchById.get(leg.match_id)
    // In unvollständigen DB-Daten im Zweifel KEINE Stornierbarkeit suggerieren.
    if (!match) return true
    if (match.status === 'finished' || match.status === 'live') return true
    // Verschoben/annulliert bedeutet keinen tatsächlichen Anpfiff.
    if (match.status === 'postponed' || match.status === 'annulled') return false
    return new Date(match.match_date).getTime() <= now.getTime()
  })
}
