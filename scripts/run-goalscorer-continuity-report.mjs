/**
 * Entry point for the read-only ST8 → ST9 continuity report.
 *
 *   node --experimental-strip-types scripts/run-goalscorer-continuity-report.mjs
 *
 * Needs $BACKTEST_DATA_DIR/gscontinuity.json (default /tmp/bt). Writes nothing.
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
register(pathToFileURL(path.join(ROOT, 'scripts/ts-resolver.mjs')).href, pathToFileURL(ROOT + '/'))

const { run } = await import(pathToFileURL(path.join(ROOT, 'scripts/goalscorer-continuity-report.ts')).href)
process.exit(run())
