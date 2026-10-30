// The package.json "sideEffects" allowlist (sandbox research §6, maintainer-approved): bundlers may
// drop a dist file nothing uses, except the ones listed, which do something when imported:
//  - dist/index.{esm,cjs}.js: the core publishes globalThis.__SYGNAL_DIAGNOSTICS__ (the bridge
//    'sygnal/diagnostics' reaches it through, by a bare `import 'sygnal'`), and Collection /
//    Switchable register their hosts on import
//  - dist/diagnostics.*: installs the runtime checks (sygnal/vite injects a bare import)
//  - dist/devtools.*: installs the DevTools bridge (sygnal/vite injects a bare import)
//  - dist/shims/globalthis.cjs: the globalthis package's replacement, loaded for its value
//  - dist/sygnal.min.js: the standalone UMD build, which sets a global
// Needs `npm run build` (dist/).
import { describe, it, expect, afterEach } from 'vitest'
import { build } from 'esbuild'
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// optional peers and Node-only imports: not part of what's measured
const external = ['react', 'react/*', 'react-dom', 'react-dom/*', 'react-native', '@zag-js/*', 'three', 'three/*',
  'virtual:*', 'node:*', 'vite', 'vike', 'vike/*', 'astro', 'astro/*', 'magic-string', 'esbuild', 'sygnal-check', 'sygnal-check/*']

const bundle = async (contents) => {
  const r = await build({ stdin: { contents, resolveDir: root }, bundle: true, write: false, format: 'esm', minify: true,
    platform: 'browser', external, logLevel: 'silent' })
  return r.outputFiles[0].text
}

// every import target of the exports map, by subpath
const targets = Object.entries(pkg.exports).flatMap(([sub, t]) => (typeof t == 'string' ? [t] : [t.import, t.require, t.default])
  .filter((f) => f && /\.(c|m)?js$/.test(f)).map((f) => [sub, f]))

describe('"sideEffects" allowlist', () => {
  it('is exactly the files with import-time effects, and each exists', () => {
    expect(pkg.sideEffects).toEqual([
      './dist/index.esm.js', './dist/index.cjs.js',
      './dist/diagnostics.esm.js', './dist/diagnostics.cjs.js',
      './dist/devtools.esm.js', './dist/devtools.cjs.js',
      './dist/shims/globalthis.cjs',
      // sygnal/sandbox: the worker script listens for messages, the guest kernel's entry sets the
      // guest's globals (both run as entries of their own: a Worker, a QuickJS context)
      './dist/sandbox-worker.esm.js', './dist/sandbox-worker.cjs.js', './dist/sandbox-kernel.esm.js',
      './dist/sygnal.min.js',
    ])
    for (const f of pkg.sideEffects) expect(existsSync(join(root, f)), f).toBe(true)
  })

  it('covers every exports target that a bare import must keep', () => {
    const kept = new Set(pkg.sideEffects)
    for (const sub of ['.', './diagnostics', './devtools']) {
      expect(kept.has(pkg.exports[sub].import), sub).toBe(true)
      expect(kept.has(pkg.exports[sub].require), sub).toBe(true)
    }
    expect(kept.has(pkg.exports['./shims/globalthis'].require ?? pkg.exports['./shims/globalthis'])).toBe(true)
    // no shared chunks: every script in dist/ is an exports target (or the UMD build), so a new
    // chunk with import-time effects can't slip past this list unnoticed
    const listed = new Set([...targets.map(([, f]) => f.replace(/^\.\//, '')), 'dist/sygnal.min.js'])
    const walk = (d) => readdirSync(join(root, d), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(c|m)?js$/.test(e.name) ? [`${d}/${e.name}`] : [])
    expect(walk('dist').filter((f) => !listed.has(f))).toEqual([])
  })
})

describe('esbuild drops what is unused', () => {
  const pure = ['primitives', 'host', 'terminal', 'agent-ui', 'ui', 'ui/menu', 'ui/select', 'ui/combobox', 'zag', 'react', 'ai', 'api', 'element', 'jsx-runtime', 'jsx', 'three', 'react-native', 'sandbox', 'sandbox/build']
  it.each(pure)("a bare import 'sygnal/%s' bundles to nothing", async (sub) => {
    expect(await bundle(`import 'sygnal/${sub}'`)).toBe('')
  })

  it('an unused named import of a side-effect-free entry bundles to nothing', async () => {
    expect(await bundle(`import { View, Text } from 'sygnal/primitives'; import { makeHostDriver } from 'sygnal/host'`)).toBe('')
  })

  it("a used entry is kept (the field drops modules, never code a used module runs)", async () => {
    const out = await bundle(`import { View } from 'sygnal/primitives'; console.log(View)`)
    expect(out).toContain('data-primitive')
  })

  describe("import 'sygnal/diagnostics' is kept and still finds the core", () => {
    let dir, saved
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true })
      dir = undefined
      if (saved === undefined) delete globalThis.__SYGNAL_DIAGNOSTICS__
      else globalThis.__SYGNAL_DIAGNOSTICS__ = saved
    })
    it('alone (a Vite pre-bundle entry of its own) and before the app', async () => {
      saved = globalThis.__SYGNAL_DIAGNOSTICS__
      dir = mkdtempSync(join(tmpdir(), 'sygnal-side-effects-'))
      for (const [name, code] of [['alone', `import 'sygnal/diagnostics'`], ['first', `import 'sygnal/diagnostics'; import { run } from 'sygnal'; globalThis.__seRun = typeof run`]]) {
        const out = await bundle(code)
        expect(out.length, name).toBeGreaterThan(10000)
        const f = join(dir, `${name}.mjs`)
        writeFileSync(f, out)
        delete globalThis.__SYGNAL_DIAGNOSTICS__
        await import(pathToFileURL(f).href)
        // installChecks() ran: it throws when the core's bridge is missing
        expect(globalThis.__SYGNAL_DIAGNOSTICS__?.layers?.size, name).toBeGreaterThan(0)
      }
      expect(globalThis.__seRun).toBe('function')
      delete globalThis.__seRun
    })
  })

  it("import 'sygnal/devtools' is kept", async () => {
    expect((await bundle(`import 'sygnal/devtools'`)).length).toBeGreaterThan(1000)
  })
})
