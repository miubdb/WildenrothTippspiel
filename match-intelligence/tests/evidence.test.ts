import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isVerifiedForTrends,
  canPresentAsConfirmedFact,
  resolveIdentificationStatus,
  hasSupportingEvidence,
  shouldRenderReportSection,
} from '../lib/evidence.ts'
import { sceneObservationSchema } from '../lib/providers/ai/types.ts'

test('only trainer_verified/trainer_corrected scenes count toward verified trends', () => {
  assert.equal(isVerifiedForTrends('trainer_verified'), true)
  assert.equal(isVerifiedForTrends('trainer_corrected'), true)
  assert.equal(isVerifiedForTrends('ai_observed'), false)
  assert.equal(isVerifiedForTrends('candidate'), false)
  assert.equal(isVerifiedForTrends('needs_review'), false)
  assert.equal(isVerifiedForTrends('rejected'), false)
})

test('a hypothesis is never presentable as a confirmed fact', () => {
  assert.equal(canPresentAsConfirmedFact('fact'), true)
  assert.equal(canPresentAsConfirmedFact('observation'), false)
  assert.equal(canPresentAsConfirmedFact('inference'), false)
  assert.equal(canPresentAsConfirmedFact('hypothesis'), false)
})

test('player identification requires explicit human confirmation to reach "confirmed"', () => {
  assert.equal(resolveIdentificationStatus({ confirmedByHuman: false, aiConfidence: 0.99 }), 'probable')
  assert.equal(resolveIdentificationStatus({ confirmedByHuman: true, aiConfidence: null }), 'confirmed')
  assert.equal(resolveIdentificationStatus({ confirmedByHuman: false, aiConfidence: 0.2 }), 'unknown')
})

test('a training recommendation with no supporting scenes is not data-based', () => {
  assert.equal(hasSupportingEvidence([]), false)
  assert.equal(hasSupportingEvidence(['scene-1']), true)
})

test('a report section with zero evidence items is omitted, not filled', () => {
  assert.equal(shouldRenderReportSection(0), false)
  assert.equal(shouldRenderReportSection(3), true)
})

test('an AI scene observation with supported=false is rejected by structure, not content', () => {
  const parsed = sceneObservationSchema.safeParse({
    supported: false,
    startSecond: 100,
    endSecond: 110,
    observations: [],
    players: [],
    ballLocation: null,
    confidence: 0,
    uncertainties: ['keine belastbaren Frames'],
    requiresReview: true,
  })
  assert.equal(parsed.success, true)
  assert.equal(parsed.success && parsed.data.supported, false)
})

test('a malformed AI observation (confidence out of range) fails schema validation', () => {
  const parsed = sceneObservationSchema.safeParse({
    supported: true,
    startSecond: 100,
    endSecond: 110,
    observations: [],
    players: [],
    ballLocation: null,
    confidence: 1.5,
    uncertainties: [],
    requiresReview: false,
  })
  assert.equal(parsed.success, false)
})
