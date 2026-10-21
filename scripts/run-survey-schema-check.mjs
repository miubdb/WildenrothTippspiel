/**
 * Entry point for the survey V2 schema/validation checks (scripts/survey-schema-check.ts).
 *
 *   node --experimental-strip-types scripts/run-survey-schema-check.mjs
 *
 * Exits non-zero if any check fails, so it can gate a change the same way a
 * test suite would.
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
register(pathToFileURL(path.join(ROOT, 'scripts/ts-resolver.mjs')).href, pathToFileURL(ROOT + '/'))

const { run } = await import(pathToFileURL(path.join(ROOT, 'scripts/survey-schema-check.ts')).href)

console.log('=== Umfrage V2: Schema- und Validierungsprüfungen ===')
process.exit((await run()) === 0 ? 0 : 1)
