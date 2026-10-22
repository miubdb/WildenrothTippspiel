import { hasStartedCombo, type BetStartLeg, type BetStartMatch } from '@/lib/betStart'

/**
 * "Alle Tipps" folgt AUSNAHMSLOS der Social-Sichtbarkeit, auch für Admins
 * und für die eigenen Wetten. Der DB-Lesezugriff (RLS-Admin-Bypass, eigene
 * Wetten) ist kein Nachweis, dass ein Schein öffentlich gemacht werden darf.
 *
 * WICHTIG: alle Legs der Kombi laden. Bei unvollständigen Daten/Missing
 * matches im Zweifel verbergen, nicht versehentlich veröffentlichen.
 */
export function isComboSociallyStarted(
  legs: BetStartLeg[],
  matches: BetStartMatch[],
  now: Date = new Date(),
): boolean {
  if (legs.length === 0) return false
  const matchIds = new Set(matches.map(m => m.id))
  if (legs.some(l => !matchIds.has(l.match_id))) return false
  return hasStartedCombo(legs, matches, now)
}

export function isSingleSociallyVisible(
  bet: { match_id: number; status: string; combo_id: number | string | null },
  match: BetStartMatch | undefined,
  now: Date = new Date(),
): boolean {
  if (bet.combo_id != null || !match || bet.status === 'void') return false
  if (bet.status === 'neutralized' && match.status === 'annulled') return true
  return new Date(match.match_date).getTime() <= now.getTime()
}
