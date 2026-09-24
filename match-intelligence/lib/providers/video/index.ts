import { VeoProvider } from './veo-provider'
import { ManualVideoProvider } from './manual-provider'
import { ExternalVideoProvider } from './external-provider'
import type { RecordingReference, VideoSourceProvider } from './types'

const providers: VideoSourceProvider[] = [new VeoProvider(), new ExternalVideoProvider(), new ManualVideoProvider()]

/** Tries each known provider in order (most specific first) and returns the first match. */
export function resolveRecordingReference(input: string): RecordingReference | null {
  for (const provider of providers) {
    const ref = provider.parseReference(input)
    if (ref) return ref
  }
  return null
}

export type { RecordingReference, VideoSourceProvider }
