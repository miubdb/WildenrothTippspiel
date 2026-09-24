/**
 * VideoSourceProvider — abstracts "where does this match's video live and
 * how do we reference it". The original video is never expected to live in
 * our own storage (spec sections 14-16); a provider only ever resolves
 * metadata about an external recording. Fully swappable so a future Veo API
 * change, or an entirely different video platform, only touches one file.
 */
export interface RecordingReference {
  provider: 'veo' | 'manual' | 'external'
  externalUrl: string | null
  providerRecordingId: string | null
  title: string | null
  durationSeconds: number | null
  recordedAt: string | null
}

export interface VideoSourceProvider {
  readonly id: 'veo' | 'manual' | 'external'

  /** Parses a pasted URL/share-link into a normalized reference, or null if unrecognized. */
  parseReference(input: string): RecordingReference | null

  /**
   * Best-effort metadata refresh (duration, title) for a reference this
   * provider recognizes. Must degrade gracefully — never throw when the
   * remote site is unreachable or has changed; return the reference
   * unchanged instead, per spec section 15 ("Die Plattform soll immer noch
   * funktionieren, wenn Veo seine Website ändert").
   */
  refreshMetadata(reference: RecordingReference): Promise<RecordingReference>
}
