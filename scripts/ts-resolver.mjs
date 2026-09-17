/**
 * Module-resolution hook so Node can run the app's real TypeScript modules
 * directly (via --experimental-strip-types) instead of the backtest
 * re-implementing the model — see scripts/backtest.ts.
 *
 * Bridges exactly two gaps between Next's bundler resolution and Node ESM:
 *  - the `@/…` path alias from tsconfig.json → project root
 *  - extensionless relative imports (`./cupSimulation`) → `.ts`
 *
 * Deliberately NOT a general-purpose loader: it does the minimum needed for
 * lib/* to import cleanly, so the backtest can never silently diverge from
 * what production actually executes.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function withTsExtension(absPath) {
  if (existsSync(absPath)) return absPath
  for (const ext of ['.ts', '.tsx', '/index.ts']) {
    if (existsSync(absPath + ext)) return absPath + ext
  }
  return absPath
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const abs = withTsExtension(path.join(projectRoot, specifier.slice(2)))
    return { url: pathToFileURL(abs).href, shortCircuit: true }
  }
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const abs = withTsExtension(
      path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
    )
    if (existsSync(abs)) return { url: pathToFileURL(abs).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
