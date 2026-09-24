import { NoAIProvider } from './no-ai-provider'
import { LocalVisionProvider } from './local-vision-provider'
import { AnthropicProvider } from './anthropic-provider'
import type { AIProvider } from './types'

/**
 * Provider selection: explicit opt-in via AI_PROVIDER, falling back to
 * whichever configured provider is cheapest (local before cloud), falling
 * back to NoAIProvider so the app always has something that works.
 */
export function getAIProvider(): AIProvider {
  const explicit = process.env.AI_PROVIDER

  if (explicit === 'anthropic') return new AnthropicProvider()
  if (explicit === 'local_vision') return new LocalVisionProvider()
  if (explicit === 'none') return new NoAIProvider()

  const local = new LocalVisionProvider()
  if (local.isConfigured()) return local

  const anthropic = new AnthropicProvider()
  if (anthropic.isConfigured()) return anthropic

  return new NoAIProvider()
}

export type { AIProvider, SceneObservation, TacticalInference, AIUsageMeta } from './types'
