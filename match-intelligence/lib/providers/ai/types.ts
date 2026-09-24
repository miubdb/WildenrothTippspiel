import { z } from 'zod'

/**
 * AIProvider — the sole boundary through which any AI model output enters
 * the system. Every provider returns the SAME structured shape (never free
 * text into the DB, spec section 21), so Stage 2/3 of the analysis pipeline
 * (lib/analysis) work identically regardless of which provider is
 * configured, including the "no provider configured" case.
 *
 * `sceneObservationSchema` mirrors spec section 19's Stage 2 example
 * exactly: `supported: false` must short-circuit the pipeline before any
 * tactical inference is generated (spec section 44 / anti-hallucination
 * tests) — enforced in lib/analysis/pipeline.ts, not just documented here.
 */
export const sceneObservationSchema = z.object({
  supported: z.boolean(),
  startSecond: z.number(),
  endSecond: z.number(),
  observations: z.array(
    z.object({
      text: z.string(),
      confidence: z.number().min(0).max(1),
    })
  ),
  players: z.array(
    z.object({
      jerseyNumber: z.number().int().nullable(),
      teamSide: z.enum(['own', 'opponent']),
      identificationConfidence: z.number().min(0).max(1),
    })
  ),
  ballLocation: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  uncertainties: z.array(z.string()),
  requiresReview: z.boolean(),
})
export type SceneObservation = z.infer<typeof sceneObservationSchema>

export const tacticalInferenceSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1),
  basedOnObservationIndexes: z.array(z.number().int()),
})
export type TacticalInference = z.infer<typeof tacticalInferenceSchema>

export interface AIUsageMeta {
  provider: string
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  costEstimateUsd: number | null
}

export interface AIProvider {
  readonly id: 'none' | 'local_vision' | 'anthropic'

  isConfigured(): boolean

  /** Stage 2: observe a single, short (pre-identified) time window. */
  observeScene(input: {
    frameDescriptions: string[] // pre-extracted frame references/descriptions — this provider never receives raw video
    startSecond: number
    endSecond: number
  }): Promise<{ observation: SceneObservation; usage: AIUsageMeta | null }>

  /** Stage 3: tactical interpretation — only ever called when Stage 2's `supported` was true. */
  inferTactics(input: { observation: SceneObservation }): Promise<{ inference: TacticalInference; usage: AIUsageMeta | null }>
}
