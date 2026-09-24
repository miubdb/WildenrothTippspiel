import type { RecordingReference, VideoSourceProvider } from './types'

/**
 * V1 Veo integration (spec section 15): recognizes a pasted Veo URL/share
 * link and extracts a recording id where the URL shape allows it. There is
 * no official public Veo API for a club-tier (non-Analytics) subscription,
 * so this deliberately does NOT scrape or reverse-engineer a private
 * endpoint (spec section 16) — it only does client-visible URL parsing,
 * which needs no authentication and cannot break if Veo changes internal
 * APIs (only if they change the URL shape, which `parseReference` isolates).
 *
 * `refreshMetadata` is a no-op that returns the input unchanged until a
 * stable, permitted way to fetch duration/title exists (e.g. the admin
 * types them in manually, or a future official API). This keeps the
 * platform fully functional without it, per spec section 16/55.
 */
export class VeoProvider implements VideoSourceProvider {
  readonly id = 'veo' as const

  parseReference(input: string): RecordingReference | null {
    const trimmed = input.trim()
    let url: URL
    try {
      url = new URL(trimmed)
    } catch {
      return null
    }

    if (!/(^|\.)veo\.co$/.test(url.hostname)) return null

    // Veo share/watch URLs look like https://app.veo.co/matches/<slug-with-id>/
    // The trailing path segment is used as the recording id when present —
    // it is an opaque identifier we store verbatim, not something we parse
    // further or attach meaning to.
    const segments = url.pathname.split('/').filter(Boolean)
    const recordingId = segments.length > 0 ? segments[segments.length - 1] : null

    return {
      provider: 'veo',
      externalUrl: trimmed,
      providerRecordingId: recordingId,
      title: null,
      durationSeconds: null,
      recordedAt: null,
    }
  }

  async refreshMetadata(reference: RecordingReference): Promise<RecordingReference> {
    return reference
  }
}
