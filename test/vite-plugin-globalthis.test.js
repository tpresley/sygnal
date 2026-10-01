// G-099 (D47): sygnal/vite aliases xstream's `globalthis` dependency to a stub that
// returns the native globalThis; `nativeGlobalThis: false` keeps the polyfill package.
// Runs against the built plugin (npm run build) and this repo's Vite (7).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import sygnal from '../dist/vite/plugin.mjs'
import sygnalAstro from '../dist/astro/index.mjs'

const require = createRequire(import.meta.url)
const SHIM = path.resolve('dist/shims/globalthis.cjs')

const configOf = (options, command = 'build') =>
  sygnal(options).config.call({ meta: { viteVersion: '7.3.1' } }, { root: process.cwd() }, { command })

describe('vite plugin: native globalThis (G-099)', () => {
  it('the stub has the shape xstream uses: require("globalthis").getPolyfill()', () => {
    const g = require(SHIM)
    expect(typeof g).toBe('function')
    expect(g()).toBe(globalThis)
    expect(g.getPolyfill()).toBe(globalThis)
    expect(g.implementation).toBe(globalThis)
    expect(g.shim()).toBe(globalThis)
    // the real package agrees
    const real = require('globalthis')
    expect(real.getPolyfill()).toBe(g.getPolyfill())
  })

  it('aliases exactly `globalthis` to the stub, in build and serve', () => {
    for (const command of ['build', 'serve']) {
      const { alias } = configOf({}, command).resolve
      expect(alias).toHaveLength(1)
      expect(alias[0].find.test('globalthis')).toBe(true)
      expect(alias[0].find.test('globalthis/polyfill')).toBe(false)
      expect(alias[0].replacement).toBe(SHIM)
      expect(fs.existsSync(alias[0].replacement)).toBe(true)
    }
  })

  it('nativeGlobalThis: false adds no alias', () => {
    expect(configOf({ nativeGlobalThis: false }).resolve).toBeUndefined()
  })

  it('sygnal/astro adds the alias in astro build, unless nativeGlobalThis: false', () => {
    const setup = (options) => {
      let vite
      sygnalAstro(options).hooks['astro:config:setup']({ addRenderer() {}, updateConfig(c) { vite = c.vite }, command: 'build' })
      return vite
    }
    expect(setup().resolve.alias[0].replacement).toBe(SHIM)
    expect(setup({ nativeGlobalThis: false }).resolve).toBeUndefined()
  })

  it('a Vite build bundles the stub instead of the polyfill chain, and xstream works', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-globalthis-'))
    try {
      fs.writeFileSync(path.join(dir, 'entry.js'),
        "import xs from 'xstream'\nexport const values = []\nxs.of(1, 2).subscribe({ next: v => values.push(v) })\n")
      const bundle = async (options, outDir) => {
        await build({
          root: dir, configFile: false, logLevel: 'silent',
          resolve: { alias: { xstream: require.resolve('xstream') } },
          plugins: [sygnal({ ...options, check: false })],
          build: { outDir, minify: false, lib: { entry: path.join(dir, 'entry.js'), formats: ['es'], fileName: 'out' } },
        })
        const file = path.join(outDir, fs.readdirSync(outDir).find(f => f.startsWith('out')))
        return { code: fs.readFileSync(file, 'utf8'), file }
      }
      const native = await bundle({}, path.join(dir, 'a'))
      const poly = await bundle({ nativeGlobalThis: false }, path.join(dir, 'b'))
      expect(native.code).toMatch(/implementation = globalThis/)
      expect(native.code).not.toMatch(/define-properties|get-intrinsic|%AsyncFromSyncIteratorPrototype%/)
      expect(poly.code).toMatch(/define-properties|get-intrinsic|%AsyncFromSyncIteratorPrototype%/)
      expect(native.code.length).toBeLessThan(poly.code.length)
      const mod = await import(pathToFileURL(native.file).href)
      expect(mod.values).toEqual([1, 2])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 30000)
})
