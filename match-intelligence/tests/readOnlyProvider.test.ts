import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createReadOnlyClient } from '../lib/providers/match-data/read-only-client.ts'
import { ExistingTippspielProvider } from '../lib/providers/match-data/existing-tippspiel-provider.ts'

test('createReadOnlyClient exposes only .select() on a table — no insert/update/upsert/delete exist to call', () => {
  const client = createReadOnlyClient('https://example.invalid', 'anon-key')
  const table = client.from('matches')

  assert.equal(typeof table.select, 'function', 'select must be available')
  for (const forbidden of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
    assert.equal(
      Reflect.get(table, forbidden),
      undefined,
      `ReadOnlyTable must not expose .${forbidden}() — ExistingTippspielProvider must be structurally unable to write to the Tippspiel project`
    )
  }
})

test('ExistingTippspielProvider is unavailable (and does nothing) without TIPPSPIEL_SUPABASE_URL/ANON_KEY configured', async () => {
  const originalUrl = process.env.TIPPSPIEL_SUPABASE_URL
  const originalKey = process.env.TIPPSPIEL_SUPABASE_ANON_KEY
  delete process.env.TIPPSPIEL_SUPABASE_URL
  delete process.env.TIPPSPIEL_SUPABASE_ANON_KEY

  try {
    const provider = new ExistingTippspielProvider()
    assert.equal(await provider.isAvailable(), false)
    assert.deepEqual(await provider.fetchMatches({ teamName: 'SpVgg Wildenroth', from: '2026-01-01', to: '2027-01-01' }), [])
    assert.equal(await provider.fetchLineups({ matchSourceIdentifier: 'tippspiel:1', ownTeamNames: ['SpVgg Wildenroth'] }), null)
  } finally {
    if (originalUrl !== undefined) process.env.TIPPSPIEL_SUPABASE_URL = originalUrl
    if (originalKey !== undefined) process.env.TIPPSPIEL_SUPABASE_ANON_KEY = originalKey
  }
})

test('matchSourceIdentifier / parseTippspielMatchId round-trip, and reject foreign formats', () => {
  assert.equal(ExistingTippspielProvider.matchSourceIdentifier(220), 'tippspiel:220')
  assert.equal(ExistingTippspielProvider.parseTippspielMatchId('tippspiel:220'), 220)
  assert.equal(ExistingTippspielProvider.parseTippspielMatchId('manual:220'), null)
  assert.equal(ExistingTippspielProvider.parseTippspielMatchId('tippspiel:team:220'), null)
})
