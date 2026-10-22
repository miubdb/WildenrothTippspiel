// A combo's parent row determines whether it is active or cancelled.
// Leg statuses can differ following neutralisation of a match.
export function isVisibleComboStatus(status: string | null | undefined): boolean {
  return status === 'pending' || status === 'won' || status === 'lost' || status === 'neutralized'
}
export function occupiesBettingSlot(status: string | null | undefined): boolean {
  return status === 'pending' || status === 'won' || status === 'lost'
}
export function visibleComboIds<T extends { id: number | string; status: string }>(rows: readonly T[]): Set<string> {
  return new Set(rows.filter(c => isVisibleComboStatus(c.status)).map(c => String(c.id)))
}
