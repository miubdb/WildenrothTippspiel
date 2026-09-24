import type { RecordingReference, VideoSourceProvider } from './types'

/** Any other externally-hosted video (e.g. a club's YouTube upload). */
export class ExternalVideoProvider implements VideoSourceProvider {
  readonly id = 'external' as const

  parseReference(input: string): RecordingReference | null {
    const trimmed = input.trim()
    try {
      new URL(trimmed)
    } catch {
      return null
    }
    return {
      provider: 'external',
      externalUrl: trimmed,
      providerRecordingId: null,
      title: null,
      durationSeconds: null,
      recordedAt: null,
    }
  }

  async refreshMetadata(reference: RecordingReference): Promise<RecordingReference> {
    return reference
  }
}
