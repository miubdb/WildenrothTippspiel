import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcileFields, determineSyncAction } from '../lib/import/reconcile.ts'

test('reconcileFields: identical values produce no patch and no conflicts', () => {
  const { patch, conflicts } = reconcileFields({ our_score: 2 }, { our_score: 2 }, [])
  assert.deepEqual(patch, {})
  assert.deepEqual(conflicts, [])
})

test('reconcileFields: a changed, non-locked field is included in the patch', () => {
  const { patch, conflicts } = reconcileFields({ our_score: 2 }, { our_score: 3 }, [])
  assert.deepEqual(patch, { our_score: 3 })
  assert.deepEqual(conflicts, [])
})

test('reconcileFields: a changed, manually-locked field becomes a conflict, never a silent overwrite', () => {
  const { patch, conflicts } = reconcileFields({ our_score: 5 }, { our_score: 2 }, ['our_score'])
  assert.deepEqual(patch, {})
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].field, 'our_score')
  assert.equal(conflicts[0].currentValue, 5)
  assert.equal(conflicts[0].incomingValue, 2)
})

test('reconcileFields: timestamps are compared as instants, not string formatting', () => {
  const { patch } = reconcileFields({ kickoff_at: '2026-09-06T15:00:00.000Z' }, { kickoff_at: '2026-09-06T15:00:00+00:00' }, [])
  assert.deepEqual(patch, {}, 'the same instant in a different format must not look like a change')
})

test('reconcileFields: locking one field does not block an unrelated field from updating', () => {
  const { patch, conflicts } = reconcileFields({ our_score: 5, status: 'scheduled' }, { our_score: 2, status: 'finished' }, ['our_score'])
  assert.deepEqual(patch, { status: 'finished' })
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].field, 'our_score')
})

test('determineSyncAction: a brand new entity is always "create"', () => {
  assert.equal(determineSyncAction(false, {}), 'create')
  assert.equal(determineSyncAction(false, { our_score: 2 }), 'create')
})

test('determineSyncAction: an existing entity with an empty patch is "unchanged", not "update"', () => {
  assert.equal(determineSyncAction(true, {}), 'unchanged')
})

test('determineSyncAction: an existing entity with a non-empty patch is "update"', () => {
  assert.equal(determineSyncAction(true, { our_score: 2 }), 'update')
})
