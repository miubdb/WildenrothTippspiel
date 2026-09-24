import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeMatchDataQuality } from '../lib/dataQuality.ts'

const base = {
  hasResult: false,
  matchEventCount: 0,
  ownLineupCount: 0,
  opponentLineupCount: 0,
  ownLineupIdentifiedCount: 0,
  recordingCount: 0,
}

test('a fully empty match reports everything missing', () => {
  const q = computeMatchDataQuality(base)
  assert.equal(q.result, 'missing')
  assert.equal(q.events, 'missing')
  assert.equal(q.lineup, 'missing')
  assert.equal(q.playerIdentification, 'missing')
  assert.equal(q.video, 'missing')
})

test('lineup is "partial" when only one side has data', () => {
  const q = computeMatchDataQuality({ ...base, ownLineupCount: 11, opponentLineupCount: 0 })
  assert.equal(q.lineup, 'partial')
})

test('lineup is "complete" only when both sides have data', () => {
  const q = computeMatchDataQuality({ ...base, ownLineupCount: 11, opponentLineupCount: 11 })
  assert.equal(q.lineup, 'complete')
})

test('player identification is "missing" when there is no own-side lineup at all', () => {
  const q = computeMatchDataQuality({ ...base, ownLineupCount: 0, ownLineupIdentifiedCount: 0 })
  assert.equal(q.playerIdentification, 'missing')
})

test('player identification is "partial" when some but not all own players are linked', () => {
  const q = computeMatchDataQuality({ ...base, ownLineupCount: 11, ownLineupIdentifiedCount: 4 })
  assert.equal(q.playerIdentification, 'partial')
})

test('player identification is "complete" only when every own-side player is linked', () => {
  const q = computeMatchDataQuality({ ...base, ownLineupCount: 11, ownLineupIdentifiedCount: 11 })
  assert.equal(q.playerIdentification, 'complete')
})

test('result/events/video are complete exactly when their count/flag is positive', () => {
  const q = computeMatchDataQuality({ ...base, hasResult: true, matchEventCount: 3, recordingCount: 1 })
  assert.equal(q.result, 'complete')
  assert.equal(q.events, 'complete')
  assert.equal(q.video, 'complete')
})
