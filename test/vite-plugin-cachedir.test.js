// The dev server's own dependency cache (plugin.ts 13): with a second Vite config in the
// same folder (Sift: a React console beside the Sygnal one) both servers shared
// node_modules/.vite/deps, each start deleted the other's pre-bundles and the Sygnal page
// got 504 Outdated Optimize Dep for sygnal/devtools and sygnal/diagnostics (a blank page).
// Runs against the built plugin (npm run build).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'
import sygnal from '../dist/vite/plugin.mjs'

const dirs = []
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

function project() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-cachedir-')))
  dirs.push(dir)
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"app","type":"module"}')
  return dir
}

function configFor(config, env) {
  const saved = process.env.VITEST
  if (!env.vitest) delete process.env.VITEST
  try {
    return sygnal({ check: false, graph: false }).config(config, env)
  } finally {
    if (saved !== undefined) process.env.VITEST = saved
  }
}

describe('vite plugin — dependency cache', () => {
  it('the dev server pre-bundles into node_modules/.vite-sygnal beside the nearest package.json', () => {
    const dir = project()
    const sub = path.join(dir, 'web')
    fs.mkdirSync(sub)
    expect(configFor({ root: dir }, { command: 'serve' }).cacheDir).toBe(path.join(dir, 'node_modules', '.vite-sygnal'))
    expect(configFor({ root: sub }, { command: 'serve' }).cacheDir).toBe(path.join(dir, 'node_modules', '.vite-sygnal'))
  })

  it("keeps the config's own cacheDir (Astro sets one)", () => {
    const dir = project()
    expect(configFor({ root: dir, cacheDir: 'node_modules/.vite' }, { command: 'serve' }).cacheDir).toBeUndefined()
  })

  it('leaves vite build and Vitest on Vite\'s default', () => {
    const dir = project()
    expect(configFor({ root: dir }, { command: 'build' }).cacheDir).toBeUndefined()
    expect(configFor({ root: dir }, { command: 'serve', vitest: true }).cacheDir).toBeUndefined()
  })

  it('a dev server and a sibling config without the plugin use different deps folders', async () => {
    const dir = project()
    const opts = { root: dir, configFile: false, logLevel: 'silent', server: { middlewareMode: true, ws: false } }
    const saved = process.env.VITEST
    delete process.env.VITEST
    let a, b
    try {
      a = await createServer({ ...opts, plugins: [sygnal({ check: false, graph: false })] })
      b = await createServer(opts)
    } finally {
      if (saved !== undefined) process.env.VITEST = saved
    }
    try {
      expect(a.config.cacheDir).toBe(path.join(dir, 'node_modules', '.vite-sygnal'))
      expect(b.config.cacheDir).toBe(path.join(dir, 'node_modules', '.vite'))
    } finally {
      await a.close()
      await b.close()
    }
  })
})
