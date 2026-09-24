import type { RecordingReference, VideoSourceProvider } from './types'

/** For an uploaded file or any URL that isn't recognized by a specific provider. */
export class ManualVideoProvider implements VideoSourceProvider {
  readonly id = 'manual' as const

  parseReference(input: string): RecordingReference | null {
    const trimmed = input.trim()
    if (!trimmed) return null
    return {
      provider: 'manual',
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
