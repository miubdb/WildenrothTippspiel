/**
 * Per-match data quality (spec section 41 — prepared now, full UI in Phase
 * 3). Pure function over plain counts so it's testable without a database;
 * the caller (match detail page) gathers the counts with a few cheap
 * queries and passes them in here.
 */

export type QualityFlag = 'complete' | 'partial' | 'missing'

export interface MatchDataQualityInput {
  hasResult: boolean
  matchEventCount: number
  ownLineupCount: number
  opponentLineupCount: number
  ownLineupIdentifiedCount: number // own-side lineup_players rows with player_id set
  recordingCount: number
}

export interface MatchDataQuality {
  result: QualityFlag
  events: QualityFlag
  lineup: QualityFlag
  playerIdentification: QualityFlag
  video: QualityFlag
}

export function computeMatchDataQuality(input: MatchDataQualityInput): MatchDataQuality {
  const lineup: QualityFlag =
    input.ownLineupCount > 0 && input.opponentLineupCount > 0
      ? 'complete'
      : input.ownLineupCount > 0 || input.opponentLineupCount > 0
        ? 'partial'
        : 'missing'

  const playerIdentification: QualityFlag =
    input.ownLineupCount === 0
      ? 'missing'
      : input.ownLineupIdentifiedCount === input.ownLineupCount
        ? 'complete'
        : input.ownLineupIdentifiedCount > 0
          ? 'partial'
          : 'missing'

  return {
    result: input.hasResult ? 'complete' : 'missing',
    events: input.matchEventCount > 0 ? 'complete' : 'missing',
    lineup,
    playerIdentification,
    video: input.recordingCount > 0 ? 'complete' : 'missing',
  }
}
