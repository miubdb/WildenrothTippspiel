import { sceneObservationSchema, tacticalInferenceSchema, type AIProvider, type SceneObservation, type TacticalInference } from './types'

/**
 * Talks to a locally/self-hosted vision-capable model over an
 * OpenAI-chat-completions-shaped HTTP endpoint (LM Studio, Ollama's OpenAI
 * compatibility layer, vLLM, etc.) — configurable rather than hard-coded to
 * one model, per spec section 20. Fully free to run; the only cost is the
 * admin's own hardware.
 *
 * Every response is validated against the Zod schema before use; a response
 * that fails validation is discarded (never partially trusted) and the
 * scene is left in `needs_review` for a human, per spec section 21.
 */
export class LocalVisionProvider implements AIProvider {
  readonly id = 'local_vision' as const

  private get baseUrl() {
    return process.env.LOCAL_AI_BASE_URL ?? null
  }
  private get model() {
    return process.env.LOCAL_AI_MODEL ?? null
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.model)
  }

  private async chat(systemPrompt: string, userPrompt: string): Promise<string | null> {
    if (!this.isConfigured()) return null
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
        }),
      })
      if (!res.ok) return null
      const data = await res.json()
      return data?.choices?.[0]?.message?.content ?? null
    } catch {
      return null
    }
  }

  async observeScene(input: {
    frameDescriptions: string[]
    startSecond: number
    endSecond: number
  }): Promise<{ observation: SceneObservation; usage: null }> {
    const fallback: SceneObservation = {
      supported: false,
      startSecond: input.startSecond,
      endSecond: input.endSecond,
      observations: [],
      players: [],
      ballLocation: null,
      confidence: 0,
      uncertainties: ['Lokales Vision-Modell nicht erreichbar oder keine gültige Antwort erhalten.'],
      requiresReview: true,
    }

    const raw = await this.chat(
      'Du beobachtest eine kurze Fußball-Videoszene. Antworte AUSSCHLIESSLICH mit validem JSON nach dem vorgegebenen Schema. Erfinde niemals Details, die aus den Frames nicht hervorgehen.',
      JSON.stringify({ startSecond: input.startSecond, endSecond: input.endSecond, frames: input.frameDescriptions })
    )
    if (!raw) return { observation: fallback, usage: null }

    const parsed = sceneObservationSchema.safeParse(safeJsonParse(raw))
    return { observation: parsed.success ? parsed.data : fallback, usage: null }
  }

  async inferTactics(input: { observation: SceneObservation }): Promise<{ inference: TacticalInference; usage: null }> {
    const fallback: TacticalInference = { text: 'Nicht zuverlässig bewertbar.', confidence: 0, basedOnObservationIndexes: [] }
    if (!input.observation.supported) return { inference: fallback, usage: null }

    const raw = await this.chat(
      'Formuliere eine vorsichtige taktische Einschätzung ausschließlich basierend auf den gegebenen Beobachtungen. Antworte AUSSCHLIESSLICH mit validem JSON nach dem Schema.',
      JSON.stringify(input.observation)
    )
    if (!raw) return { inference: fallback, usage: null }

    const parsed = tacticalInferenceSchema.safeParse(safeJsonParse(raw))
    return { inference: parsed.success ? parsed.data : fallback, usage: null }
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
