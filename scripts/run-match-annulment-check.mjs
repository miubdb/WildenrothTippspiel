/**
 * Entry point for the match-annulment pure-logic checks (scripts/match-annulment-check.ts).
 *
 *   node --experimental-strip-types scripts/run-match-annulment-check.mjs
 *
 * Exits non-zero if any check fails.
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
register(pathToFileURL(path.join(ROOT, 'scripts/ts-resolver.mjs')).href, pathToFileURL(ROOT + '/'))

const { run } = await import(pathToFileURL(path.join(ROOT, 'scripts/match-annulment-check.ts')).href)

console.log('=== Match-Annullierung: Konsistenzprüfungen ===')
process.exit(run() === 0 ? 0 : 1)
