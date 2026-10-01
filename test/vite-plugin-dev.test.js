// Dev-mode features of the Vite plugin (PLAN-1 workstream 2C): the dev
// checks import, the `diagnostics` option (run() wrapper, strict flag), the
// Vitest setup file, the Vike/Astro client wrappers (G-014) and the
// sygnal-check integration. Runs against the built plugin (npm run build).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import sygnal from '../dist/vite/plugin.mjs'
import sygnalAstro from '../dist/astro/index.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEV_FLAG = 'if (globalThis.__SYGNAL_DEV__ === undefined) globalThis.__SYGNAL_DEV__ = true;'
const STRICT_FLAG = 'if (globalThis.__SYGNAL_STRICT__ === undefined) globalThis.__SYGNAL_STRICT__ = true;'
const IMPORTS = "import 'sygnal/diagnostics';import 'virtual:sygnal/dev';"
const ENTRY = `import { run } from 'sygnal'\nimport App from './App.jsx'\nrun(App)\n`

// Call config() as Vite would, with process.env.VITEST set or unset
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

function devPlugin(options, extra) {
  const plugin = sygnal(options)
  configure(plugin, extra)
  return plugin
}

// resolveId is an object hook ({ order: 'pre', handler })
function resolve(plugin, source, importer, opts = {}, ctx = {}) {
  return plugin.resolveId.handler.call(ctx, source, importer, opts)
}

function parseErrors(code) {
  const sf = ts.createSourceFile('m.js', code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
  return sf.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}

describe('vite plugin — dev checks import (deliverable 1)', () => {
  it('injects the dev flag and the sygnal/diagnostics import on the first line', () => {
    const result = devPlugin().transform(ENTRY, '/src/main.js')
    const lines = result.code.split('\n')
    expect(lines[0]).toBe(DEV_FLAG + IMPORTS + "import { run } from 'sygnal'")
    expect(lines[1]).toBe("import App from './App.jsx'")
    expect(parseErrors(result.code)).toEqual([])
  })

  it('injects nothing in build mode: no transform, no virtual modules, no checks dependency', () => {
    const plugin = sygnal({ diagnostics: { mode: 'error', strict: true, ignore: ['SYG105'] } })
    const config = configure(plugin, { command: 'build' })
    expect(plugin.transform(ENTRY, '/src/main.js')).toBeNull()
    expect(JSON.stringify(config)).not.toContain('diagnostics')
    expect(config.optimizeDeps).toBeUndefined()
    expect(config.test).toBeUndefined()
    return Promise.all([
      resolve(plugin, 'virtual:sygnal/dev', '/src/main.js'),
      resolve(plugin, 'sygnal', '/src/main.js'),
      resolve(plugin, 'sygnal/vike/onRenderClient', '/x.js'),
    ]).then(results => expect(results).toEqual([null, null, null]))
  })

  it("diagnostics: 'off' injects nothing (HMR wiring still works)", () => {
    const plugin = devPlugin({ diagnostics: 'off' })
    const result = plugin.transform(ENTRY, '/src/main.js')
    expect(result.code).not.toContain('__SYGNAL_DEV__')
    expect(result.code).not.toContain('sygnal/diagnostics')
    expect(result.code).toContain('import.meta.hot.accept')
    // nothing at all for an entry with manual HMR wiring
    const manual = ENTRY + 'if (import.meta.hot) {}\n'
    expect(plugin.transform(manual, '/src/main.js')).toBeNull()
  })

  it('under Vitest only the flag goes in (the checks come from setupFiles)', () => {
    const result = devPlugin({}, { vitest: true }).transform(ENTRY, '/src/main.js')
    expect(result.code).toBe(DEV_FLAG + ENTRY)
  })

  it('serves the dev client module, which logs sygnal-check results in the browser', async () => {
    const plugin = devPlugin()
    const id = await resolve(plugin, 'virtual:sygnal/dev', '/src/main.js')
    expect(id).toBe('\0virtual:sygnal/dev')
    const code = plugin.load(id)
    expect(parseErrors(code)).toEqual([])
    // run it with a fake import.meta.hot
    const handlers = {}
    const logs = []
    const fakeConsole = { warn: m => logs.push(['warn', m]), error: m => logs.push(['error', m]), info: m => logs.push(['info', m]) }
    new Function('hot', 'console', code.replace(/import\.meta\.hot/g, 'hot'))({ on: (e, cb) => { handlers[e] = cb }, send: () => {} }, fakeConsole)
    handlers['sygnal:check']({ summary: 'sygnal-check: 1 warning', diagnostics: [{ severity: 'warn', text: 'src/A.jsx:1:1 SYG101 A: x' }] })
    handlers['sygnal:check']({ summary: 'sygnal-check: 0 warnings', diagnostics: [] })
    expect(logs).toEqual([
      ['warn', '[sygnal-check] src/A.jsx:1:1 SYG101 A: x'],
      ['info', '[sygnal-check] sygnal-check: 1 warning'],
      ['info', '[sygnal-check] all findings resolved'],
    ])
  })
})

describe('vite plugin — diagnostics option (deliverable 3)', () => {
  it("defaults to 'warn' with no run() wrapper", async () => {
    const plugin = devPlugin()
    plugin.transform(ENTRY, '/src/main.js')
    expect(await resolve(plugin, 'sygnal', '/src/main.js')).toBeNull()
  })

  it('rejects an unknown mode', () => {
    expect(() => sygnal({ diagnostics: 'loud' })).toThrow(/diagnostics mode must be one of/)
  })

  it('strict: true also sets globalThis.__SYGNAL_STRICT__ (only when undefined)', () => {
    const result = devPlugin({ diagnostics: { strict: true } }).transform(ENTRY, '/src/main.js')
    expect(result.code.split('\n')[0]).toBe(DEV_FLAG + STRICT_FLAG + IMPORTS + "import { run } from 'sygnal'")
    const g = { __SYGNAL_STRICT__: false }
    new Function('globalThis', STRICT_FLAG)(g)
    expect(g.__SYGNAL_STRICT__).toBe(false)
    // under Vitest too (alongside the flag)
    const vt = devPlugin({ diagnostics: { strict: true } }, { vitest: true }).transform(ENTRY, '/src/main.js')
    expect(vt.code).toBe(DEV_FLAG + STRICT_FLAG + ENTRY)
  })

  it("another mode or an ignore list routes the entry's 'sygnal' import to the run() wrapper", async () => {
    const plugin = devPlugin({ diagnostics: { mode: 'error', ignore: ['SYG105'] } })
    plugin.transform(ENTRY, '/src/main.js')
    expect(await resolve(plugin, 'sygnal', '/src/main.js')).toBe('\0sygnal-dev:runtime')
    expect(await resolve(plugin, 'sygnal', '/src/main.js?t=123')).toBe('\0sygnal-dev:runtime')
    // other importers (components, the wrapper itself) get the real sygnal
    expect(await resolve(plugin, 'sygnal', '/src/App.jsx')).toBeNull()
    expect(await resolve(plugin, 'sygnal', '\0sygnal-dev:runtime')).toBeNull()
    expect(await resolve(plugin, 'sygnal', undefined)).toBeNull()
  })

  it("the wrapper's run() adds the option unless the call sets diagnostics itself", () => {
    const plugin = devPlugin({ diagnostics: { mode: 'collect', ignore: ['SYG105'] } })
    const code = plugin.load('\0sygnal-dev:runtime')
    expect(code).toContain("export * from 'sygnal'")
    const calls = []
    const body = code
      .replace("import { run as __run } from 'sygnal';", '')
      .replace("export * from 'sygnal';", '')
      .replace('export function run', 'return function run')
    const run = new Function('__run', body)((...args) => calls.push(args))
    run('App', { D: 1 })
    run('App', {}, { mountPoint: '#x' })
    run('App', {}, { diagnostics: 'off' })
    expect(calls).toEqual([
      ['App', { D: 1 }, { diagnostics: { mode: 'collect', ignore: ['SYG105'] } }],
      ['App', {}, { mountPoint: '#x', diagnostics: { mode: 'collect', ignore: ['SYG105'] } }],
      ['App', {}, { diagnostics: 'off' }],
    ])
  })
})

describe('vite plugin — Vitest setup file (deliverable 2)', () => {
  const setupFile = path.join(fs.realpathSync(REPO), 'dist', 'diagnostics.esm.js')

  it("appends the ESM 'sygnal/diagnostics' file to test.setupFiles", () => {
    const config = configure(sygnal(), { vitest: true, config: { root: REPO } })
    expect(config.test).toEqual({ setupFiles: [setupFile] })
    expect(fs.existsSync(setupFile)).toBe(true)
  })

  it('returns an array whatever form the user value takes (Vite concatenates them)', () => {
    for (const setupFiles of ['./setup.js', ['./a.js', './b.js'], undefined]) {
      const config = configure(sygnal(), { vitest: true, config: { root: REPO, test: { setupFiles } } })
      expect(config.test).toEqual({ setupFiles: [setupFile] })
    }
  })

  it('does not add it twice', () => {
    for (const setupFiles of ['sygnal/diagnostics', [setupFile], ['./x.js', path.relative(REPO, setupFile)]]) {
      const config = configure(sygnal(), { vitest: true, config: { root: REPO, test: { setupFiles } } })
      expect(config.test).toBeUndefined()
    }
  })

  it('opts out with vitestSetup: false, and does nothing outside Vitest', () => {
    expect(configure(sygnal({ vitestSetup: false }), { vitest: true, config: { root: REPO } }).test).toBeUndefined()
    expect(configure(sygnal(), { config: { root: REPO } }).test).toBeUndefined()
  })

  it('skips silently when sygnal is not resolvable from the root', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-vt-'))
    try {
      expect(configure(sygnal(), { vitest: true, config: { root: dir } }).test).toBeUndefined()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('vite plugin — dependency scan', () => {
  it('gives the dev dependency scanner the sygnal JSX settings (serve only)', () => {
    const jsx = { runtime: 'automatic', importSource: 'sygnal' }
    expect(configure(sygnal()).optimizeDeps).toEqual({ rolldownOptions: { transform: { jsx } } })
    expect(configure(sygnal({ disableJsx: true })).optimizeDeps).toBeUndefined()
  })

  it('does not pre-bundle the checks for a linked sygnal (it would duplicate the core)', () => {
    // From the repo root, 'sygnal' resolves to this checkout (not node_modules)
    expect(configure(sygnal(), { config: { root: REPO } }).optimizeDeps.include).toBeUndefined()
  })
})

describe('vite plugin — Vike and Astro dev mode (deliverable 4, G-014)', () => {
  it("routes client imports of 'sygnal/vike/onRenderClient' to a dev wrapper", async () => {
    const plugin = devPlugin()
    const virtualEntry = '\0virtual:vike:page-entry:client:/pages/index'
    expect(await resolve(plugin, 'sygnal/vike/onRenderClient', virtualEntry)).toBe('\0sygnal-dev:vike-client')
    // not on the server, and not with diagnostics off
    expect(await resolve(plugin, 'sygnal/vike/onRenderClient', virtualEntry, { ssr: true })).toBeNull()
    expect(await resolve(devPlugin({ diagnostics: 'off' }), 'sygnal/vike/onRenderClient', virtualEntry)).toBeNull()

    const code = plugin.load('\0sygnal-dev:vike-client')
    expect(code).toContain("import 'sygnal/diagnostics'")
    expect(code).toContain("export * from 'sygnal/vike/onRenderClient'")
    expect(code).toContain(DEV_FLAG)
    expect(code).toContain('__sygnalInstallChecks()')
    expect(parseErrors(code)).toEqual([])
  })

  it("the wrapper's own import resolves to the real entry, whose 'sygnal' import gets the run() wrapper", async () => {
    const plugin = devPlugin({ diagnostics: 'error' })
    const real = { id: '/app/node_modules/sygnal/dist/vike/onRenderClient.mjs' }
    const ctx = { resolve: async (source, importer, opts) => (opts.skipSelf ? real : null) }
    expect(await resolve(plugin, 'sygnal/vike/onRenderClient', '\0sygnal-dev:vike-client', {}, ctx)).toBe(real)
    expect(await resolve(plugin, 'sygnal', real.id)).toBe('\0sygnal-dev:runtime')
  })

  it("adds the dev snippet to sygnal's astro/client file, with installChecks() at its end", () => {
    const plugin = devPlugin({ diagnostics: { strict: true } }, { config: { root: REPO } })
    const file = path.join(fs.realpathSync(REPO), 'dist', 'astro', 'client.mjs')
    const code = fs.readFileSync(file, 'utf8')
    const result = plugin.transform(code, file)
    expect(result.code.startsWith(DEV_FLAG + STRICT_FLAG + IMPORTS)).toBe(true)
    expect(result.code.trimEnd().endsWith('try { __sygnalInstallChecks() } catch (e) { console.warn(e) }')).toBe(true)
    // every original line keeps its number
    expect(result.code.split('\n').slice(1, code.split('\n').length)).toEqual(code.split('\n').slice(1))
    expect(parseErrors(result.code)).toEqual([])
    // not in SSR, not under Vitest, not in build, not with diagnostics off
    expect(plugin.transform(code, file, { ssr: true })).toBeNull()
    expect(devPlugin({}, { vitest: true, config: { root: REPO } }).transform(code, file)).toBeNull()
    expect(devPlugin({}, { command: 'build', config: { root: REPO } }).transform(code, file)).toBeNull()
    expect(devPlugin({ diagnostics: 'off' }, { config: { root: REPO } }).transform(code, file)).toBeNull()
  })

  it('the Astro integration adds the plugin in `astro dev` only', () => {
    const setup = (command, options) => {
      const calls = []
      const warnings = []
      sygnalAstro(options).hooks['astro:config:setup']({
        addRenderer: () => {},
        updateConfig: c => calls.push(c),
        command,
        logger: { warn: m => warnings.push(m) },
      })
      return { vite: calls[0].vite, warnings }
    }
    const dev = setup('dev')
    expect(dev.vite.esbuild).toEqual({ jsx: 'automatic', jsxImportSource: 'sygnal' })
    expect(dev.vite.plugins.map(p => p.name)).toEqual(['vite-plugin-sygnal'])
    const build = setup('build')
    expect(build.vite.plugins).toBeUndefined()
    // the integration's own plugin: no JSX/HMR changes, strict passes through
    const plugin = setup('dev', { diagnostics: { strict: true } }).vite.plugins[0]
    const config = configure(plugin, { config: { root: REPO } })
    expect(config.oxc).toBeUndefined()
    // modes the bundled Astro client can't take are reported once
    expect(setup('dev', { diagnostics: 'error' }).warnings).toHaveLength(1)
    expect(setup('dev', { diagnostics: 'off' }).vite.plugins).toHaveLength(1)
    expect(setup('dev', { diagnostics: 'off' }).warnings).toEqual([])
  })
})

describe('vite plugin — sygnal-check in dev (deliverable 3)', () => {
  const dirs = []
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })

  function project({ checker = 'real', files = {} } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-dev-'))
    dirs.push(dir)
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"app","type":"module"}')
    fs.mkdirSync(path.join(dir, 'node_modules'))
    if (checker === 'real') {
      fs.symlinkSync(path.join(REPO, 'sygnal-check'), path.join(dir, 'node_modules', 'sygnal-check'), 'dir')
    } else if (checker) {
      const pkg = path.join(dir, 'node_modules', 'sygnal-check')
      fs.mkdirSync(pkg)
      fs.writeFileSync(path.join(pkg, 'package.json'), '{"name":"sygnal-check","type":"module","main":"index.js"}')
      fs.writeFileSync(path.join(pkg, 'index.js'), checker)
    }
    fs.mkdirSync(path.join(dir, 'src'))
    for (const [name, code] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'src', name), code)
    return dir
  }

  function fakeServer() {
    const listeners = {}
    const server = {
      logs: [],
      sent: [],
      config: {
        logger: {
          info: (m) => server.logs.push(['info', m]),
          warn: (m) => server.logs.push(['warn', m]),
        },
      },
      ws: {
        send: (p) => server.sent.push(p),
        on: (e, cb) => { listeners['ws:' + e] = cb },
      },
      watcher: { on: (e, cb) => { listeners[e] = cb } },
      emit: (e, ...a) => listeners[e]?.(...a),
    }
    return server
  }

  const until = async (fn, ms = 3000) => {
    const end = Date.now() + ms
    while (!fn()) {
      if (Date.now() > end) throw new Error('timed out')
      await new Promise(r => setTimeout(r, 20))
    }
  }

  const BUGGY = `function App() { return <div className="x">hi</div> }
App.intent = ({ DOM }) => ({ ORPHAN: DOM.click('.x') })
App.model = {}
export default App
`
  const FIXED = BUGGY.replace('App.model = {}', 'App.model = { ORPHAN: s => s }')

  function start(dir, options) {
    const plugin = sygnal(options)
    configure(plugin, { config: { root: dir } })
    const server = fakeServer()
    plugin.configureServer(server)
    return server
  }

  it('checks src on startup: terminal in sygnal-check format, browser via a custom HMR event', async () => {
    const dir = project({ files: { 'App.jsx': BUGGY } })
    const server = start(dir)
    await until(() => server.logs.length > 0)
    const [level, text] = server.logs[0]
    expect(level).toBe('warn')
    expect(text).toMatch(/^src\/App\.jsx:2:\d+ SYG101 App: intent action 'ORPHAN' has no model entry/)
    expect(text).toMatch(/sygnal-check: 1 warning$/)
    // nothing is broadcast at startup: a page asks when it loads, and only it is answered (R5)
    expect(server.sent).toEqual([])
    const page = []
    server.emit('ws:sygnal:check:request', undefined, { send: p => page.push(p) })
    const event = page.find(p => p.type === 'custom')
    expect(event.event).toBe('sygnal:check')
    expect(event.data.diagnostics).toHaveLength(1)
    expect(event.data.diagnostics[0]).toMatchObject({ code: 'SYG101', severity: 'warn', file: 'src/App.jsx', line: 2 })
    // warnings don't open the error overlay
    expect(page.some(p => p.type === 'error')).toBe(false)
    expect(server.sent).toEqual([])
  })

  it('re-checks after a source change and reports only when the findings change', async () => {
    const dir = project({ files: { 'App.jsx': BUGGY } })
    const server = start(dir)
    await until(() => server.logs.length > 0)
    // unchanged findings: silent
    server.emit('change', path.join(dir, 'src', 'App.jsx'))
    await new Promise(r => setTimeout(r, 250))
    expect(server.logs).toHaveLength(1)
    // ignored: non-source files and node_modules
    fs.writeFileSync(path.join(dir, 'src', 'App.jsx'), FIXED)
    server.emit('change', path.join(dir, 'src', 'styles.css'))
    server.emit('change', path.join(dir, 'node_modules', 'x', 'index.js'))
    await new Promise(r => setTimeout(r, 250))
    expect(server.logs).toHaveLength(1)
    // fixed
    server.emit('change', path.join(dir, 'src', 'App.jsx'))
    await until(() => server.logs.length > 1)
    expect(server.logs[1]).toEqual(['info', 'sygnal-check: 0 warnings'])
    expect(server.sent.filter(p => p.type === 'custom').pop().data.diagnostics).toEqual([])
    // the unchanged re-check broadcast nothing; the fixed one sent the new findings once
    expect(server.sent.map(p => p.type)).toEqual(['custom'])
  })

  it('include and ignore are honored', async () => {
    const dir = project({ files: { 'App.jsx': BUGGY } })
    fs.mkdirSync(path.join(dir, 'other'))
    fs.writeFileSync(path.join(dir, 'other', 'B.jsx'), BUGGY.replace(/App/g, 'B'))
    const server = start(dir, { check: { include: ['other'] } })
    await until(() => server.logs.length > 0)
    expect(server.logs[0][1]).toMatch(/^other\/B\.jsx:2:\d+ SYG101 B:/)
    expect(server.logs[0][1]).not.toMatch(/App\.jsx/)

    const quiet = start(project({ files: { 'App.jsx': BUGGY } }), { diagnostics: { ignore: ['SYG101'] } })
    await until(() => quiet.logs.length > 0)
    expect(quiet.logs[0]).toEqual(['info', 'sygnal-check: 0 warnings'])
  })

  it('passes strict (default: diagnostics.strict) and ignore to check()', async () => {
    const recorder = `export function check(inputs, options) { globalThis.__checkCalls.push({ inputs, options }); return [] }`
    globalThis.__checkCalls = []
    start(project({ checker: recorder }), { diagnostics: { strict: true, ignore: ['SYG105'] } })
    start(project({ checker: recorder }), { diagnostics: { strict: true }, check: { strict: false, include: ['app'] } })
    await until(() => globalThis.__checkCalls.length === 2)
    const calls = globalThis.__checkCalls.sort((a, b) => a.inputs[0].localeCompare(b.inputs[0]))
    expect(calls[0]).toMatchObject({ inputs: ['app'], options: { strict: false, ignore: [] } })
    expect(calls[1]).toMatchObject({ inputs: ['src'], options: { strict: true, ignore: ['SYG105'] } })
    delete globalThis.__checkCalls
  })

  it('never fails the dev server: a checker that throws only logs a warning', async () => {
    const server = start(project({ checker: `export function check() { throw new Error('boom') }` }))
    await until(() => server.logs.length > 0)
    expect(server.logs).toEqual([['warn', '[sygnal] sygnal-check failed: boom']])
    expect(server.sent).toEqual([])
  })

  it('skips silently when sygnal-check is not installed (one info line if asked for explicitly)', async () => {
    const silent = start(project({ checker: null }))
    const asked = start(project({ checker: null }), { check: true })
    await until(() => asked.logs.length > 0)
    await new Promise(r => setTimeout(r, 50))
    expect(silent.logs).toEqual([])
    expect(asked.logs[0][1]).toMatch(/sygnal-check is not installed/)
  })

  it('check: false and Vitest disable it', async () => {
    const dir = project({ files: { 'App.jsx': BUGGY } })
    const off = start(dir, { check: false })
    const plugin = sygnal()
    configure(plugin, { vitest: true, config: { root: dir } })
    const vt = fakeServer()
    plugin.configureServer(vt)
    await new Promise(r => setTimeout(r, 300))
    expect(off.logs).toEqual([])
    expect(vt.logs).toEqual([])
  })
})
