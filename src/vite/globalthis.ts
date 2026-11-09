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
 * Absolute path of a file in dist/shims of the sygnal package this code belongs to (found by
 * walking up from this file: dist/vite, dist/astro or src/vite), or undefined when it is missing
 * (e.g. sygnal not built).
 */
function shimFile(name: string): string | undefined {
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url))
    while (dir !== path.dirname(dir)) {
      const pkgFile = path.join(dir, 'package.json')
      if (fs.existsSync(pkgFile) && JSON.parse(fs.readFileSync(pkgFile, 'utf8')).name === 'sygnal') {
        const file = path.join(dir, 'dist', 'shims', name)
        return fs.existsSync(file) ? file : undefined
      }
      dir = path.dirname(dir)
    }
  } catch (_) {}
  return undefined
}

export const globalThisShim = (): string | undefined => shimFile('globalthis.cjs')

/**
 * Whether a Vite `resolve.alias` value (object or array form) already maps
 * `name` (R2-7): the user's alias wins and the stub is not added.
 */
function hasAlias(alias: any, name: string): boolean {
  if (!alias) return false
  if (!Array.isArray(alias)) return Object.prototype.hasOwnProperty.call(alias, name)
  return alias.some((a: any) => a && (a.find instanceof RegExp ? a.find.test(name) : a.find === name))
}

export const hasGlobalThisAlias = (alias: any): boolean => hasAlias(alias, 'globalthis')

/**
 * Vite `resolve.alias` entries for the stub (empty when it is missing, or
 * when `userAlias` — the user's `resolve.alias` — already maps `globalthis`).
 */
export function globalThisAlias(userAlias?: any): Array<{ find: RegExp, replacement: string }> {
  const shim = hasGlobalThisAlias(userAlias) ? undefined : globalThisShim()
  return shim ? [{ find: /^globalthis$/, replacement: shim }] : []
}

/**
 * The compact xstream (src/xstream.ts, dist/shims/xstream.mjs) for a client production build, or
 * undefined when it is missing or the user's `resolve.alias` maps `xstream`. It needs no
 * `globalthis`, so the G-099 chain leaves the bundle with xstream's own code.
 */
export const compactXstream = (userAlias?: any): string | undefined =>
  hasAlias(userAlias, 'xstream') ? undefined : shimFile('xstream.mjs')

/**
 * Whether an import names xstream's main module: from anywhere, or the `../index` of the npm
 * `xstream/extra/*` files (so they build on the same Stream, and the npm one isn't bundled too).
 */
export const importsXstream = (source: string, importer?: string): boolean =>
  /^xstream(\/index(\.js)?)?$/.test(source) ||
  (source === '../index' && !!importer && /[\\/]xstream[\\/]extra[\\/][^\\/]+\.js(\?.*)?$/.test(importer))
