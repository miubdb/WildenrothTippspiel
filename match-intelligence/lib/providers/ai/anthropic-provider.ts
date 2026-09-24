import { sceneObservationSchema, tacticalInferenceSchema, type AIProvider, type SceneObservation, type TacticalInference } from './types'

/**
 * Optional paid provider. Never required for the app to function (spec
 * section 20) — only instantiated by the factory (./index.ts) when
 * ANTHROPIC_API_KEY is actually set. Uses the Messages API directly via
 * fetch to avoid an SDK dependency for an entirely optional feature.
 */
export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const

  private get apiKey() {
    return process.env.ANTHROPIC_API_KEY ?? null
  }
  private get model() {
    return process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'
  }

  isConfigured() {
    return Boolean(this.apiKey)
  }

  private async complete(systemPrompt: string, userPrompt: string): Promise<{ text: string | null; usage: { inputTokens: number; outputTokens: number } | null }> {
    if (!this.apiKey) return { text: null, usage: null }
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      })
      if (!res.ok) return { text: null, usage: null }
      const data = await res.json()
      const text = data?.content?.[0]?.text ?? null
      const usage = data?.usage ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens } : null
      return { text, usage }
    } catch {
      return { text: null, usage: null }
    }
  }

  async observeScene(input: { frameDescriptions: string[]; startSecond: number; endSecond: number }) {
    const fallback: SceneObservation = {
      supported: false,
      startSecond: input.startSecond,
      endSecond: input.endSecond,
      observations: [],
      players: [],
      ballLocation: null,
      confidence: 0,
      uncertainties: ['Anthropic-Provider nicht erreichbar oder keine gültige Antwort erhalten.'],
      requiresReview: true,
    }

    const { text, usage } = await this.complete(
      'Du beobachtest eine kurze Fußball-Videoszene anhand beschriebener Frames. Antworte AUSSCHLIESSLICH mit validem JSON nach dem Schema { supported, startSecond, endSecond, observations: [{text, confidence}], players: [{jerseyNumber, teamSide, identificationConfidence}], ballLocation, confidence, uncertainties, requiresReview }. Erfinde niemals Details, die aus den Frames nicht hervorgehen. Wenn die Frames keine belastbare Aussage zulassen, setze supported=false.',
      JSON.stringify({ startSecond: input.startSecond, endSecond: input.endSecond, frames: input.frameDescriptions })
    )
    if (!text) return { observation: fallback, usage: null }

    const parsed = sceneObservationSchema.safeParse(safeJsonParse(text))
    return {
      observation: parsed.success ? parsed.data : fallback,
      usage: usage
        ? { provider: this.id, model: this.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costEstimateUsd: null }
        : null,
    }
  }

  async inferTactics(input: { observation: SceneObservation }) {
    const fallback: TacticalInference = { text: 'Nicht zuverlässig bewertbar.', confidence: 0, basedOnObservationIndexes: [] }
    if (!input.observation.supported) return { inference: fallback, usage: null }

    const { text, usage } = await this.complete(
      'Formuliere eine vorsichtige, knappe taktische Einschätzung ausschließlich basierend auf den gegebenen Beobachtungen (kein Weltwissen über die Teams). Antworte AUSSCHLIESSLICH mit validem JSON nach dem Schema { text, confidence, basedOnObservationIndexes }.',
      JSON.stringify(input.observation)
    )
    if (!text) return { inference: fallback, usage: null }

    const parsed = tacticalInferenceSchema.safeParse(safeJsonParse(text))
    return {
      inference: parsed.success ? parsed.data : fallback,
      usage: usage
        ? { provider: this.id, model: this.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costEstimateUsd: null }
        : null,
    }
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
