// D77 / G-100: DevTools leave production builds. sygnal/vite imports the dev-only
// 'sygnal/devtools' entry in dev (`vite`), never in `vite build` or Vitest;
// `devtools: false` opts out. Builds examples/kanban with its own Vite (as
// scripts/size-gate.mjs does) and the built plugin: needs `npm run build` and
// `npm install --prefix examples/kanban`.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sygnal from '../dist/vite/plugin.mjs'
import sygnalAstro from '../dist/astro/index.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KANBAN = path.join(REPO, 'examples', 'kanban')
const DEVTOOLS = "import 'sygnal/devtools';"
const ENTRY = `import { run } from 'sygnal'\nimport App from './App.jsx'\nrun(App)\n`
// Strings only the DevTools bridge contains (its message protocol)
const MARKERS = ['__SYGNAL_DEVTOOLS_PAGE__', '__SYGNAL_DEVTOOLS_EXTENSION__', 'TIME_TRAVEL_APPLIED']

function configure(plugin, { vitest = false, command = 'serve', config = {} } = {}) {
  const saved = process.env.VITEST
  if (vitest) process.env.VITEST = 'true'
  else delete process.env.VITEST
  try {
    const result = plugin.config(config, { command })
    plugin.configResolved?.({ root: config.root || process.cwd() })
    return result
  } finally {
    if (saved === undefined) delete process.env.VITEST
    else process.env.VITEST = saved
  }
}
const devPlugin = (options, extra) => { const p = sygnal(options); configure(p, extra); return p }

const kanbanVite = () => import(pathToFileURL(createRequire(path.join(KANBAN, 'package.json')).resolve('vite')).href)

describe('vite plugin: devtools option (D77)', () => {
  it('imports sygnal/devtools first in dev, with or without diagnostics', () => {
    expect(devPlugin().transform(ENTRY, '/src/main.js').code.startsWith(DEVTOOLS + 'if (globalThis.__SYGNAL_DEV__')).toBe(true)
    expect(devPlugin({ diagnostics: 'off' }).transform(ENTRY, '/src/main.js').code.startsWith(DEVTOOLS + 'import { run }')).toBe(true)
  })

  it('devtools: false keeps diagnostics but drops the import', () => {
    const code = devPlugin({ devtools: false }).transform(ENTRY, '/src/main.js').code
    expect(code).not.toContain('sygnal/devtools')
    expect(code).toContain("import 'sygnal/diagnostics'")
  })

  it('devtools: { redux: true } also connects the Redux DevTools bridge (PLAN-4 3-E)', () => {
    const code = devPlugin({ devtools: { redux: true } }).transform(ENTRY, '/src/main.js').code
    expect(code.startsWith("import { connectReduxDevtools as __sygnalReduxDevtools } from 'sygnal/devtools';__sygnalReduxDevtools();if (globalThis.__SYGNAL_DEV__")).toBe(true)
    // an object without redux: the plain import
    expect(devPlugin({ devtools: {} }).transform(ENTRY, '/src/main.js').code.startsWith(DEVTOOLS)).toBe(true)
    expect(devPlugin({ devtools: { redux: true } }, { command: 'build' }).transform(ENTRY, '/src/main.js')).toBeNull()
  })

  it('never in a build or under Vitest', () => {
    expect(devPlugin({}, { command: 'build' }).transform(ENTRY, '/src/main.js')).toBeNull()
    expect(devPlugin({}, { vitest: true }).transform(ENTRY, '/src/main.js')).toBeNull()
    expect(JSON.stringify(configure(sygnal(), { command: 'build' }))).not.toContain('devtools')
  })

  it('the Vike client wrapper installs DevTools even with diagnostics off', async () => {
    const plugin = devPlugin({ diagnostics: 'off' })
    expect(await plugin.resolveId.handler.call({}, 'sygnal/vike/onRenderClient', '/x.js', {})).toBe('\0sygnal-dev:vike-client')
    const code = plugin.load('\0sygnal-dev:vike-client')
    expect(code).toBe(`${DEVTOOLS}\nexport * from 'sygnal/vike/onRenderClient';\n`)
  })

  it('the Astro integration passes devtools through to the plugin in astro dev', () => {
    const pluginOf = options => {
      let vite
      sygnalAstro(options).hooks['astro:config:setup']({ addRenderer() {}, updateConfig(c) { vite = c.vite }, command: 'dev' })
      return vite.plugins[0]
    }
    const file = path.join(fs.realpathSync(REPO), 'dist', 'astro', 'client.mjs')
    const code = fs.readFileSync(file, 'utf8')
    const on = pluginOf({}); configure(on, { config: { root: REPO } })
    const off = pluginOf({ devtools: false }); configure(off, { config: { root: REPO } })
    expect(on.transform(code, file).code.startsWith(DEVTOOLS)).toBe(true)
    expect(off.transform(code, file).code).not.toContain('sygnal/devtools')
  })
})

describe('kanban with sygnal/vite (D77)', () => {
  it('a production build contains no DevTools code (the core hooks only)', async () => {
    const vite = await kanbanVite()
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-devtools-build-'))
    try {
      await vite.build({ root: KANBAN, configFile: false, logLevel: 'silent', plugins: [sygnal({ check: false })], build: { outDir, emptyOutDir: true } })
      const assets = path.join(outDir, 'assets')
      const code = fs.readdirSync(assets).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(assets, f), 'utf8')).join('\n')
      expect(code).toContain('__SYGNAL_DEVTOOLS__') // the core's guarded hooks
      for (const m of MARKERS) expect(code).not.toContain(m)
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true })
    }
  }, 60000)

  it('the dev server serves the entry with the sygnal/devtools import, and serves that entry', async () => {
    const vite = await kanbanVite()
    // A plain dev server, not Vitest: the plugin reads process.env.VITEST in config()
    const saved = process.env.VITEST
    delete process.env.VITEST
    const server = await vite.createServer({
      root: KANBAN, configFile: false, logLevel: 'silent',
      plugins: [sygnal({ check: false })],
      server: { middlewareMode: true, hmr: false, ws: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    }).finally(() => { if (saved !== undefined) process.env.VITEST = saved })
    try {
      const main = await server.transformRequest('/src/main.js')
      const m = main.code.match(/import\s*["']([^"']*devtools[^"']*)["']/)
      expect(m).not.toBeNull()
      const served = await server.transformRequest(m[1])
      for (const marker of MARKERS.slice(0, 2)) expect(served.code).toContain(marker)
    } finally {
      await server.close()
    }
  }, 60000)
})
