/**
 * Entry point for the goalscorer consistency checks (scripts/goalscorer-check.ts).
 *
 *   node --experimental-strip-types scripts/run-goalscorer-check.mjs
 *
 * Exits non-zero if any check fails, so it can gate a change the same way a
 * test suite would.
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
register(pathToFileURL(path.join(ROOT, 'scripts/ts-resolver.mjs')).href, pathToFileURL(ROOT + '/'))

const { run } = await import(pathToFileURL(path.join(ROOT, 'scripts/goalscorer-check.ts')).href)

console.log('=== Konsistenzprüfungen Torschützenmodell ===')
process.exit(run() === 0 ? 0 : 1)
