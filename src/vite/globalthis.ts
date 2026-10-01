/**
 * G-099: xstream does `require('globalthis').getPolyfill()`, which pulls the
 * `globalthis` polyfill and its dependency chain (define-properties,
 * get-intrinsic, object-keys, has-symbols, ...; ~4 KB gzip) into every app
 * bundle. Every runtime Sygnal supports has a native `globalThis`, so
 * `sygnal/vite` (and the sygnal/astro integration) alias the package to
 * dist/shims/globalthis.cjs (src/vite/globalthis-shim.ts) unless
 * `nativeGlobalThis: false`. A `resolve.alias`, not a resolveId hook: Vite's
 * dependency pre-bundling only applies aliases.
 */
// Node built-ins (this runs in Node). The package has no @types/node.
// @ts-ignore
import fs from 'node:fs'
// @ts-ignore
import path from 'node:path'
// @ts-ignore
import { fileURLToPath } from 'node:url'

/**
 * Absolute path of the stub in the sygnal package this code belongs to (found
 * by walking up from this file: dist/vite, dist/astro or src/vite), or
 * undefined when it is missing (e.g. sygnal not built).
 */
export function globalThisShim(): string | undefined {
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url))
    while (dir !== path.dirname(dir)) {
      const pkgFile = path.join(dir, 'package.json')
      if (fs.existsSync(pkgFile) && JSON.parse(fs.readFileSync(pkgFile, 'utf8')).name === 'sygnal') {
        const file = path.join(dir, 'dist', 'shims', 'globalthis.cjs')
        return fs.existsSync(file) ? file : undefined
      }
      dir = path.dirname(dir)
    }
  } catch (_) {}
  return undefined
}

/** Vite `resolve.alias` entries for the stub (empty when it is missing). */
export function globalThisAlias(): Array<{ find: RegExp, replacement: string }> {
  const shim = globalThisShim()
  return shim ? [{ find: /^globalthis$/, replacement: shim }] : []
}
