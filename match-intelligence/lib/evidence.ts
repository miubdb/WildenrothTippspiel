import type { EvidenceLevel, IdentificationStatus, SceneStatus } from '@/types/database'

/**
 * Central anti-hallucination guards (spec sections 5-8, 44-45). Every place
 * that aggregates scenes/evidence into a statistic or a report MUST route
 * through these rather than re-implementing the same status checks, so the
 * rule can never silently drift between, say, the dashboard and the PDF
 * exporter.
 */

const VERIFIED_STATUSES: SceneStatus[] = ['trainer_verified', 'trainer_corrected']

/** Whether a scene may contribute to a default (verified-only) season trend or aggregate. */
export function isVerifiedForTrends(status: SceneStatus): boolean {
  return VERIFIED_STATUSES.includes(status)
}

/** A hypothesis must never be presented as if it were established fact (spec section 5). */
export function canPresentAsConfirmedFact(level: EvidenceLevel): boolean {
  return level === 'fact'
}

/**
 * A player is only ever auto-attributed at 'confirmed' when a human
 * explicitly confirmed the identification — a single AI-scored frame can at
 * most reach 'probable' (spec section 23: "Ein Spieler darf NICHT aufgrund
 * eines einzigen unscharfen Frames sicher identifiziert werden.").
 */
export function resolveIdentificationStatus(params: { confirmedByHuman: boolean; aiConfidence: number | null }): IdentificationStatus {
  if (params.confirmedByHuman) return 'confirmed'
  if (params.aiConfidence !== null && params.aiConfidence >= 0.5) return 'probable'
  return 'unknown'
}

/**
 * A training recommendation is only "data-based" (spec section 34/45) if it
 * actually names supporting scenes. An empty list must never be silently
 * accepted as a valid recommendation.
 */
export function hasSupportingEvidence(supportingSceneIds: string[]): boolean {
  return supportingSceneIds.length > 0
}

/**
 * Guards report generation (spec section 44): a report section may only be
 * rendered if it has at least one evidence-backed item behind it. An empty
 * topic must be omitted, never filled with invented text.
 */
export function shouldRenderReportSection(evidenceCount: number): boolean {
  return evidenceCount > 0
}
