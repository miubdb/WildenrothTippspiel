import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Static checks against the actual RLS SQL (not a live Postgres instance —
 * there is no provisioned Supabase project for this app yet, so this is the
 * verification available without one; see README for how to run a real
 * `supabase start` + pgTAP-style check against a live database).
 *
 * These assert the POLICY TEXT enforces the intended roles/scoping, so a
 * future edit that accidentally widens a policy (e.g. adds 'viewer' to a
 * write policy, or drops the squad-scoping) fails a test instead of only
 * being caught in production.
 */

const migrationsDir = path.resolve(import.meta.dirname, '..', 'supabase', 'migrations')
const rls = readFileSync(path.join(migrationsDir, '0007_rls.sql'), 'utf8')
const functions = readFileSync(path.join(migrationsDir, '0006_functions_triggers.sql'), 'utf8')

function policyBlock(sql: string, policyName: string): string {
  const start = sql.indexOf(`create policy ${policyName}`)
  assert.ok(start >= 0, `expected to find policy "${policyName}" in the RLS migration`)
  const end = sql.indexOf(';', start)
  return sql.slice(start, end + 1)
}

test('can_edit_squad grants admin and trainer, never viewer', () => {
  const start = functions.indexOf('function public.can_edit_squad')
  const end = functions.indexOf('$$;', start)
  const body = functions.slice(start, end)
  assert.match(body, /array\['admin', 'trainer'\]/)
  assert.doesNotMatch(body, /viewer/)
})

test('can_view_squad additionally grants viewer (read-only role)', () => {
  const start = functions.indexOf('function public.can_view_squad')
  const end = functions.indexOf('$$;', start)
  const body = functions.slice(start, end)
  assert.match(body, /array\['admin', 'trainer', 'viewer'\]/)
})

test('matches are squad-scoped for both read and write, not merely org-scoped', () => {
  const select = policyBlock(rls, 'matches_select')
  const write = policyBlock(rls, 'matches_write')
  assert.match(select, /can_view_squad\(org_id, squad_id\)/)
  assert.match(write, /can_edit_squad\(org_id, squad_id\)/)
})

test('a trainer scoped to one squad cannot write matches of a different squad (can_edit_squad requires matching squad_id)', () => {
  const start = functions.indexOf('function public.has_squad_role')
  const end = functions.indexOf('$$;', start)
  const body = functions.slice(start, end)
  // The only way a non-null-squad membership passes is squad_id = target_squad —
  // there is no org-wide trainer escape hatch.
  assert.match(body, /squad_id is null or squad_id = target_squad/)
})

test('squads themselves are admin-write-only (trainers can view, never edit squad metadata)', () => {
  const write = policyBlock(rls, 'squads_write')
  assert.match(write, /is_admin\(org_id\)/)
  assert.doesNotMatch(write, /can_edit_squad/)
})

test('memberships (the authorization source of truth) has no client-writable policy at all', () => {
  assert.doesNotMatch(rls, /create policy memberships_write/)
  assert.doesNotMatch(rls, /create policy memberships_insert/)
  assert.doesNotMatch(rls, /create policy memberships_update/)
})

test('scenes/evidence_items writes require squad edit access (trainer or admin), consistent with the evidence-review workflow', () => {
  const scenesWrite = policyBlock(rls, 'scenes_write')
  const evidenceWrite = policyBlock(rls, 'evidence_items_write')
  assert.match(scenesWrite, /can_edit_squad/)
  assert.match(evidenceWrite, /can_edit_squad/)
})

test('audit_logs is admin-read-only and has no client write policy — corrections cannot be self-erased', () => {
  assert.match(rls, /create policy audit_logs_select[\s\S]*?is_admin\(org_id\)/)
  assert.doesNotMatch(rls, /create policy audit_logs_write/)
  assert.doesNotMatch(rls, /create policy audit_logs_insert/)
})

test('every core table referenced by a policy also has row level security enabled', () => {
  const tables = ['matches', 'squads', 'memberships', 'scenes', 'evidence_items', 'audit_logs', 'trainer_notes', 'lineup_players']
  for (const t of tables) {
    assert.match(rls, new RegExp(`alter table ${t} enable row level security`), `expected RLS enabled on "${t}"`)
  }
})
