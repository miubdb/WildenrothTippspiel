import { visibleComboIds } from '@/lib/slipLifecycle'

/**
 * Gruppiert geladene Wett-Zeilen (`bets`) und ihre Kombischein-Elternzeilen (`combo_bets`) zu
 * Anzeige-Items für „Meine Wetten“. Extrahiert aus app/(app)/meine-wetten/page.tsx, damit genau
 * diese Logik — nicht eine Nachbildung — auch testbar ist (scripts/meine-wetten-check.ts).
 *
 * KRITISCH: combo_id/combo_bets.id kommen aus Postgres als NUMBER, nie als String. comboMap und
 * die seen-Deduplizierung sind beide String-Schlüssel (siehe lib/slipLifecycle.ts#visibleComboIds).
 * JEDE Stelle hier muss deshalb mit String(...) nachziehen, sonst verfehlt ein number-Schlüssel
 * den string-Schlüssel IMMER — das war die Ursache der Regression vom 22.10.2026, bei der
 * sämtliche gültigen Kombiwetten aus „Meine Wetten“ verschwanden (comboMap.get(bet.combo_id)
 * mit rohem number statt String(bet.combo_id)).
 */

export interface BetForGrouping {
  id: number
  combo_id: number | string | null
}

export interface ComboForGrouping {
  id: number | string
  status: string
}

export interface GroupedSingleItem<B> {
  kind: 'single'
  bet: B
}

export interface GroupedComboItem<B, C> {
  kind: 'combo'
  comboId: string
  legs: B[]
  cb: (C & { id: string }) | undefined
}

export type GroupedItem<B, C> = GroupedSingleItem<B> | GroupedComboItem<B, C>

export function visibleBetsAndComboMap<B extends BetForGrouping, C extends ComboForGrouping>(
  bets: B[],
  combos: C[],
): { visibleBets: B[]; comboMap: Map<string, C & { id: string }> } {
  // Ein stornierter Kombischein kann noch ein einzelnes, aus der Annullierung stammendes
  // neutralisiertes Leg besitzen (Audit-Spur) — das darf NIE wieder als aktiver/gewonnener
  // Schein auftauchen. Fehlende Elternzeile wird ebenfalls ausgeblendet (fail closed).
  const visibleIds = visibleComboIds(combos)
  const visibleBets = bets.filter((b) => b.combo_id == null || visibleIds.has(String(b.combo_id)))
  const comboMap = new Map<string, C & { id: string }>()
  for (const cb of combos) {
    if (visibleIds.has(String(cb.id))) comboMap.set(String(cb.id), { ...cb, id: String(cb.id) })
  }
  return { visibleBets, comboMap }
}

export function groupBetsIntoItems<B extends BetForGrouping, C extends ComboForGrouping>(
  bets: B[],
  combos: C[],
): GroupedItem<B, C>[] {
  const { visibleBets, comboMap } = visibleBetsAndComboMap(bets, combos)
  const seen = new Set<string>()
  const items: GroupedItem<B, C>[] = []
  for (const bet of visibleBets) {
    if (!bet.combo_id) {
      items.push({ kind: 'single', bet })
    } else {
      const comboKey = String(bet.combo_id)
      if (seen.has(comboKey)) continue
      seen.add(comboKey)
      items.push({
        kind: 'combo',
        comboId: comboKey,
        legs: visibleBets.filter((b) => b.combo_id === bet.combo_id),
        cb: comboMap.get(comboKey),
      })
    }
  }
  return items
}
