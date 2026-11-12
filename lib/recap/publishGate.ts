import type { RangeReadiness } from '@/lib/recap/availability'

/**
 * Serverseitige Freigabesperre des Winter-Recaps (einzige Entscheidungsstelle; die Route fragt nur noch die Daten ab).
 * Veröffentlichen ist erlaubt, wenn ALLE Bedingungen erfüllt sind:
 *  – Spieltage 1–16: jedes Spiel beendet/regelkonform behandelt und keine offene Wette (inkl. Torschützen-Wetten) – `readiness.ready`
 *  – der Spieltags-Recap des letzten Spieltags samt Pokalen (user_awards) liegt vor
 *  – der Bericht wurde frisch aus den Produktivdaten berechnet (nicht simuliert, vollständiger Zeitraum)
 */
export interface PublishGateInput {
  readiness: RangeReadiness
  finalMatchday: number
  finalMatchdayAwardCount: number | null
  report: { simulated: boolean; rangeTo: number } | null
}
export function evaluatePublishGate(i: PublishGateInput): { ok: boolean; blockers: string[] } {
  const blockers: string[] = []
  if (!i.readiness.ready) blockers.push('Der Zeitraum ist noch nicht vollständig abgeschlossen.', ...i.readiness.blockers)
  if (i.finalMatchdayAwardCount == null) blockers.push(`Der Spieltags-Recap von Spieltag ${i.finalMatchday} konnte nicht geprüft werden.`)
  else if (i.finalMatchdayAwardCount === 0) blockers.push(`Der Spieltags-Recap von Spieltag ${i.finalMatchday} (inkl. Pokale) liegt noch nicht vor – der Winter-Recap wird zusammen mit ihm veröffentlicht.`)
  if (!i.report) blockers.push('Der Bericht konnte nicht frisch aus den Produktivdaten berechnet werden.')
  else if (i.report.simulated) blockers.push('Simulierte Daten dürfen nie veröffentlicht werden.')
  else if (i.report.rangeTo !== i.finalMatchday) blockers.push(`Der Bericht deckt nicht alle Spieltage bis ${i.finalMatchday} ab.`)
  return { ok: blockers.length === 0, blockers }
}
