import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeSupabase } from './support/fakeSupabase.ts'
import { runTippspielSync } from '../lib/import/tippspielSync.ts'
import type { MatchDataProvider, ProviderMatch, ProviderMatchLineups } from '../lib/providers/match-data/types.ts'

const ORG_ID = 'org-1'
const SQUAD_ID = 'squad-1'

function baseProviderMatch(overrides: Partial<ProviderMatch> = {}): ProviderMatch {
  return {
    sourceIdentifier: 'tippspiel:220',
    kickoffAt: '2026-09-06T15:00:00.000Z',
    homeAway: 'home',
    opponentName: 'FC Musterhausen',
    opponentSourceIdentifier: 'tippspiel:team:40',
    matchday: 2,
    competitionName: 'Kreisliga',
    status: 'finished',
    ourScore: 2,
    opponentScore: 1,
    htOurScore: null,
    htOpponentScore: null,
    venue: null,
    ...overrides,
  }
}

class StubProvider implements MatchDataProvider {
  readonly id = 'wildenroth_tippspiel'
  readonly sourceType = 'wildenroth_tippspiel' as const
  private matches: ProviderMatch[]
  private lineups: ProviderMatchLineups | null

  constructor(matches: ProviderMatch[], lineups: ProviderMatchLineups | null = null) {
    this.matches = matches
    this.lineups = lineups
  }
  async isAvailable() {
    return true
  }
  async fetchMatches() {
    return this.matches
  }
  async fetchLineups() {
    return this.lineups
  }
}

function seededDb() {
  const db = new FakeSupabase()
  db.seed('data_sources', [
    { id: 'ds-1', org_id: ORG_ID, source_type: 'wildenroth_tippspiel', config: { ownTeamNamesBySquad: { [SQUAD_ID]: ['SpVgg Wildenroth'] } } },
  ])
  db.seed('squads', [{ id: SQUAD_ID, org_id: ORG_ID, name: '1. Mannschaft' }])
  db.seed('seasons', [{ id: 'season-1', org_id: ORG_ID, start_date: '2026-08-01', is_current: true }])
  return db
}

test('first sync creates a new match and records provenance (source_imports)', async () => {
  const db = seededDb()
  const provider = new StubProvider([baseProviderMatch()])

  const summary = await runTippspielSync(db as never, { orgId: ORG_ID, squadId: SQUAD_ID, startedBy: 'user-1' }, provider)

  assert.equal(summary.error, null)
  assert.equal(summary.matchesCreated, 1)
  assert.equal(summary.matchesUpdated, 0)
  assert.equal(db.tables.get('matches')?.length, 1)

  const imports = db.tables.get('source_imports') ?? []
  const matchImport = imports.find((i) => i.entity_type === 'matches')
  assert.ok(matchImport, 'expected a source_imports row for the created match')
  assert.equal(matchImport!.source_identifier, 'tippspiel:220')
})

test('re-running the same sync is idempotent: no duplicate match, reported as unchanged', async () => {
  const db = seededDb()
  const provider = new StubProvider([baseProviderMatch()])

  await runTippspielSync(db as never, { orgId: ORG_ID, squadId: SQUAD_ID, startedBy: 'user-1' }, provider)
  const second = await runTippspielSync(db as never, { orgId: ORG_ID, squadId: SQUAD_ID, startedBy: 'user-1' }, provider)

  assert.equal(db.tables.get('matches')?.length, 1, 'must not create a duplicate match row')
  assert.equal(second.matchesCreated, 0)
  assert.equal(second.matchesUnchanged, 1)
  assert.equal(second.matchesUpdated, 0)
})

test('an upstream score change updates the match when the field was never manually edited', async () => {
  const db = seededDb()
  await runTippspielSync(db as never, { orgId: ORG_ID, squadId: SQUAD_ID, startedBy: 'user-1' }, new StubProvider([baseProviderMatch({ ourScore: 2 })]))

  const second = await runTippspielSync(
    db as never,
    { orgId: ORG_ID, squadId: SQUAD_ID, startedBy: 'user-1' },
    new StubProvider([baseProviderMatch({ ourScore: 3 })])
  )

  assert.equal(second.matchesUpdated, 1)
  assert.equal(second.conflictsCreated, 0)
  const match = db.tables.get('matches')?.[0]
  assert.equal(match?.our_score, 3)
})

test('a manually corrected field is never silently overwritten — a conflict is recorded instead', async () => {
  const db = seededDb()
  await runTippspielSync(db as never, { orgId: ORG_ID, squadId: SQUAD_ID, startedBy: 'user-1' }, new StubProvider([baseProviderMatch({ ourScore: 2 })]))

  const match = db.tables.get('matches')![0]
  match.our_score = 5 // simulate a trainer's manual correction
  match.manually_edited_fields = ['our_score']

  const second = await runTippspielSync(
    db as never,
    { orgId: ORG_ID, squadId: SQUAD_ID, startedBy: 'user-1' },
    new StubProvider([baseProviderMatch({ ourScore: 2 })]) // upstream still reports the old value
  )

  assert.equal(match.our_score, 5, 'manual correction must survive the sync untouched')
  assert.equal(second.conflictsCreated, 1)

  const conflicts = db.tables.get('data_conflicts') ?? []
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].field_name, 'our_score')
  assert.equal(conflicts[0].resolved_at, undefined)
})

test('re-running after a conflict was already recorded does not create a duplicate conflict row', async () => {
  const db = seededDb()
  await runTippspielSync(db as never, { orgId: ORG_ID, squadId: SQUAD_ID, startedBy: 'user-1' }, new StubProvider([baseProviderMatch({ ourScore: 2 })]))
  const match = db.tables.get('matches')![0]
  match.our_score = 5
  match.manually_edited_fields = ['our_score']

  await runTippspielSync(db as never, { orgId: ORG_ID, squadId: SQUAD_ID, startedBy: 'user-1' }, new StubProvider([baseProviderMatch({ ourScore: 2 })]))
  const third = await runTippspielSync(db as never, { orgId: ORG_ID, squadId: SQUAD_ID, startedBy: 'user-1' }, new StubProvider([baseProviderMatch({ ourScore: 2 })]))

  assert.equal(third.conflictsCreated, 0, 'the conflict already exists and unresolved — must not be duplicated')
  assert.equal((db.tables.get('data_conflicts') ?? []).length, 1)
})

test('the same opponent is resolved to one team row across two different matches, not duplicated', async () => {
  const db = seededDb()
  const provider = new StubProvider([
    baseProviderMatch({ sourceIdentifier: 'tippspiel:220', matchday: 2 }),
    baseProviderMatch({ sourceIdentifier: 'tippspiel:221', matchday: 3 }),
  ])

  await runTippspielSync(db as never, { orgId: ORG_ID, squadId: SQUAD_ID, startedBy: 'user-1' }, provider)

  const teams = db.tables.get('teams') ?? []
  const opponentTeams = teams.filter((t) => t.name === 'FC Musterhausen')
  assert.equal(opponentTeams.length, 1, 'the opponent team must be created once and reused')

  const matches = db.tables.get('matches') ?? []
  assert.equal(matches.length, 2)
  assert.equal(matches[0].opponent_team_id, matches[1].opponent_team_id)
})

test('lineup rows are imported without duplication on re-sync', async () => {
  const db = seededDb()
  const lineups: ProviderMatchLineups = {
    matchSourceIdentifier: 'tippspiel:220',
    own: [
      {
        playerName: 'Max Mustermann',
        jerseyNumber: null,
        position: 'Mittelfeld',
        isStarting: true,
        minutesPlayed: 90,
        goals: 1,
        assists: 0,
        yellowCards: 0,
        redCardMinute: null,
        penaltyMissed: false,
      },
    ],
    opponent: [],
  }
  const provider = new StubProvider([baseProviderMatch()], lineups)

  await runTippspielSync(db as never, { orgId: ORG_ID, squadId: SQUAD_ID, startedBy: 'user-1' }, provider)
  await runTippspielSync(db as never, { orgId: ORG_ID, squadId: SQUAD_ID, startedBy: 'user-1' }, provider)

  const lineupPlayers = db.tables.get('lineup_players') ?? []
  assert.equal(lineupPlayers.length, 1, 'must not create a duplicate lineup_players row on re-sync')
  assert.equal(lineupPlayers[0].goals, 1)
})

test('missing squad team-name configuration fails clearly instead of guessing', async () => {
  const db = new FakeSupabase()
  db.seed('data_sources', [{ id: 'ds-1', org_id: ORG_ID, source_type: 'wildenroth_tippspiel', config: { ownTeamNamesBySquad: {} } }])
  db.seed('squads', [{ id: SQUAD_ID, org_id: ORG_ID, name: '1. Mannschaft' }])
  db.seed('seasons', [{ id: 'season-1', org_id: ORG_ID, start_date: '2026-08-01', is_current: true }])

  const summary = await runTippspielSync(db as never, { orgId: ORG_ID, squadId: SQUAD_ID, startedBy: 'user-1' }, new StubProvider([baseProviderMatch()]))

  assert.ok(summary.error)
  assert.equal(summary.matchesCreated, 0)
})
