import type { AIProvider, SceneObservation, TacticalInference } from './types'

/**
 * Default provider when nothing is configured (spec section 20 — the app
 * must be fully usable without any paid AI service). Every stage returns
 * `supported: false` / a review-required inference rather than fabricating
 * anything, so manual scene work (trainer notes → candidates → trainer
 * fills in evidence_items by hand) is the only path, and it works
 * completely.
 */
export class NoAIProvider implements AIProvider {
  readonly id = 'none' as const

  isConfigured() {
    return true // "configured" in the sense of "safe to use with zero setup"
  }

  async observeScene(input: { startSecond: number; endSecond: number }): Promise<{ observation: SceneObservation; usage: null }> {
    return {
      observation: {
        supported: false,
        startSecond: input.startSecond,
        endSecond: input.endSecond,
        observations: [],
        players: [],
        ballLocation: null,
        confidence: 0,
        uncertainties: ['Kein AI-Provider konfiguriert — manuelle Auswertung erforderlich.'],
        requiresReview: true,
      },
      usage: null,
    }
  }

  async inferTactics(): Promise<{ inference: TacticalInference; usage: null }> {
    return {
      inference: {
        text: 'Nicht zuverlässig bewertbar.',
        confidence: 0,
        basedOnObservationIndexes: [],
      },
      usage: null,
    }
  }
}
