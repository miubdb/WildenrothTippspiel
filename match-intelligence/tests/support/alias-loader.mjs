// Minimal ESM resolve hook so plain `node --test` can run this project's
// lib code directly. Two things Next.js's bundler resolves that plain Node
// ESM does not: the `@/*` path alias (tsconfig.json), and TypeScript's
// convention of extensionless relative imports (`./foo` meaning `./foo.ts`).
// Without this, none of the app's lib/ modules — which all use both — could
// be exercised by a plain unit test.
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const projectRoot = pathToFileURL(path.resolve(import.meta.dirname, '..', '..') + '/').href

function resolveExtensionless(fileUrl) {
  const filePath = fileURLToPath(fileUrl)
  for (const candidate of [filePath, `${filePath}.ts`, `${filePath}.tsx`, path.join(filePath, 'index.ts')]) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href
  }
  return fileUrl
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return nextResolve(resolveExtensionless(new URL(specifier.slice(2), projectRoot).href), context)
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !path.extname(specifier) && context.parentURL) {
    return nextResolve(resolveExtensionless(new URL(specifier, context.parentURL).href), context)
  }
  return nextResolve(specifier, context)
}
