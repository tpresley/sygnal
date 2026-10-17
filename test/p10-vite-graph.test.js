// PLAN-10 W-2 / P-2 (D543, D544): sygnal/vite's live graph page at /__sygnal/graph (route, stream,
// guard, banner, `graph: false`), the dev-only component stamps (keys equal the static graph's for
// the graph-shop fixture and kanban) and inspect()'s `key`. Runs against the built plugin
// (npm run build) with sygnal-check linked from this repo; the end-to-end run in browsers is
// p10-vite-graph-e2e.test.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sygnal from '../dist/vite/plugin.mjs'
import { setupChecks } from './diagnostics/helpers.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { validate } from '../sygnal-check/src/schema.js'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHOP = path.join(REPO, 'sygnal-check', 'test', 'fixtures', 'graph-shop')
const KANBAN = path.join(REPO, 'examples', 'kanban')
const schema = JSON.parse(fs.readFileSync(path.join(REPO, 'sygnal-check', 'schema', 'inspect.schema.json'), 'utf8'))

function configure(plugin, { command = 'serve', root }) {
  const saved = process.env.VITEST
  delete process.env.VITEST
  try {
    plugin.config({ root }, { command })
    plugin.configResolved?.({ root })
  } finally {
    if (saved !== undefined) process.env.VITEST = saved
  }
}

const dirs = []
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

/** a temp project: `src` copied from `from` (or `files`), sygnal-check linked (unless checker: false) */
function project({ from, files = {}, checker = true } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-graph-route-')))
  dirs.push(dir)
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"graph-app","type":"module"}')
  fs.mkdirSync(path.join(dir, 'node_modules'))
  if (checker) fs.symlinkSync(path.join(REPO, 'sygnal-check'), path.join(dir, 'node_modules', 'sygnal-check'), 'dir')
  if (from) fs.cpSync(path.join(from, 'src'), path.join(dir, 'src'), { recursive: true })
  else fs.mkdirSync(path.join(dir, 'src'))
  for (const [name, code] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'src', name), code)
  return dir
}

function fakeServer(extra = {}) {
  const listeners = {}
  const server = {
    logs: [],
    stack: [],
    middlewares: { use: (fn) => server.stack.push(fn) },
    config: { logger: { info: (m) => server.logs.push(['info', m]), warn: (m) => server.logs.push(['warn', m]) }, server: {} },
    ws: { send: () => {}, on: () => {} },
    watcher: { on: (e, cb) => { (listeners[e] ||= []).push(cb) } },
    httpServer: { once: (e, cb) => { (listeners['http:' + e] ||= []).push(cb) } },
    emit: (e, ...a) => (listeners[e] || []).forEach(cb => cb(...a)),
    ...extra,
  }
  return server
}

function start(dir, options = {}, extra) {
  const plugin = sygnal(options)
  configure(plugin, { root: dir })
  const server = fakeServer(extra)
  plugin.configureServer(server)
  return { plugin, server }
}

// the plugin context Vite gives transform (the SYG103 view words resolve imports through it)
const CTX = { resolve: async (id) => ({ id }), addWatchFile() {}, error(e) { throw new Error(e) } }
const transform = (plugin, code, id, opts) => plugin.transform.call(CTX, code, id, opts)
const codeOf = (r) => (typeof r == 'string' ? r : r?.code) ?? null

/** call the middleware stack like connect: the first that doesn't call next() answers */
async function request(server, url, { method = 'GET', headers = {}, remote = '127.0.0.1' } = {}) {
  const res = {
    statusCode: 200, headers: {}, chunks: [], ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    writeHead(s, h = {}) { this.statusCode = s; for (const k in h) this.setHeader(k, h[k]) },
    write(c) { this.chunks.push(String(c)) },
    end(c) { if (c !== undefined) this.chunks.push(String(c)); this.ended = true },
    get body() { return this.chunks.join('') },
  }
  const reqListeners = {}
  const req = { url, method, headers: { host: 'localhost:5173', ...headers }, socket: { remoteAddress: remote }, on: (e, cb) => { reqListeners[e] = cb } }
  let handled = false
  for (const fn of server.stack) {
    let next = false
    await fn(req, res, () => { next = true })
    if (!next) { handled = true; break }
  }
  return { handled, res, close: () => reqListeners.close?.() }
}

const APP = `export default function App({ state }) { return <button className="inc">{state.n}</button> }
App.initialState = { n: 0 }
App.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
App.model = { INC: (s) => ({ n: s.n + 1 }) }
`

describe('the /__sygnal/graph route (W-2, D543)', () => {
  it('is on by default in dev: the live page, with the security headers', async () => {
    const { server } = start(project({ files: { 'App.jsx': APP } }))
    const { handled, res } = await request(server, '/__sygnal/graph')
    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'.*connect-src 'self'.*frame-ancestors 'none'/)
    expect(res.body).toContain('<title>graph-app · Sygnal app graph</title>')
    expect(res.body).toContain('"live":{"events":"/__sygnal/graph/events","version":1}')
    expect(res.body).toContain('"appData":{"channel":"sygnal:graph"}')
    expect(res.body).toContain('"key":"src/App.jsx#App"')
    // other paths go on to Vite
    expect((await request(server, '/__sygnal/graphs')).handled).toBe(false)
    expect((await request(server, '/')).handled).toBe(false)
    // HEAD: headers only
    const head = await request(server, '/__sygnal/graph', { method: 'HEAD' })
    expect(head.res.statusCode).toBe(200)
    expect(head.res.body).toBe('')
  })

  it('the stream sends the graph on connect and after a change, once per new graph', async () => {
    const dir = project({ files: { 'App.jsx': APP } })
    const { server } = start(dir)
    const { res, close } = await request(server, '/__sygnal/graph/events')
    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).toMatch(/^retry: 1000\n\nevent: graph\nid: 1\ndata: \{"version":1,"source":"static"/)
    // up to date already: no first event
    const again = await request(server, '/__sygnal/graph/events', { headers: { 'last-event-id': '1' } })
    expect(again.res.body).toBe('retry: 1000\n\n')
    // a change that doesn't change the graph sends nothing
    server.emit('change', path.join(dir, 'src', 'App.jsx'))
    await new Promise(r => setTimeout(r, 250))
    expect(res.body.match(/event: graph/g)).toHaveLength(1)
    // a new component: a new graph, to every open stream
    fs.writeFileSync(path.join(dir, 'src', 'Badge.jsx'), 'export function Badge() { return <b /> }\nBadge.initialState = {}\n')
    server.emit('add', path.join(dir, 'src', 'Badge.jsx'))
    await vi.waitFor(() => expect(res.body.match(/event: graph/g)).toHaveLength(2), { timeout: 3000, interval: 20 })
    expect(res.body).toMatch(/event: graph\nid: 2\ndata: .*"key":"src\/Badge\.jsx#Badge"/)
    expect(again.res.body).toMatch(/id: 2/)
    // a stream that went away gets nothing more; the dev server closing ends the others
    again.close()
    server.emit('http:close')
    expect(res.ended).toBe(true)
    expect(again.res.ended).toBe(false)
    close()
  })

  it("the /__sygnal/mcp guard: loopback peer, local Host (or allowedHosts), local Origin; GET / HEAD only", async () => {
    const { server } = start(project({ files: { 'App.jsx': APP } }))
    const status = async (url, o) => (await request(server, url, o)).res.statusCode
    for (const url of ['/__sygnal/graph', '/__sygnal/graph/events']) {
      expect(await status(url, { remote: '10.0.0.7' })).toBe(403)
      expect(await status(url, { headers: { host: 'evil.example:5173' } })).toBe(403)
      expect(await status(url, { headers: { origin: 'http://evil.example' } })).toBe(403)
      expect(await status(url, { headers: { origin: 'null' } })).toBe(403)
      expect(await status(url, { method: 'POST' })).toBe(405)
    }
    const r = await request(server, '/__sygnal/graph', { remote: '10.0.0.7' })
    expect(r.res.body).toMatch(/^Forbidden: the Sygnal graph page only answers requests from this machine/)
    expect(r.res.body).not.toContain('<html')
    // the ones allowed: ::1, 127.x, *.localhost, a same-origin Origin, a host in server.allowedHosts
    expect(await status('/__sygnal/graph', { remote: '::1', headers: { host: '[::1]:5173' } })).toBe(200)
    expect(await status('/__sygnal/graph', { remote: '::ffff:127.0.0.1', headers: { host: 'app.localhost:5173', origin: 'http://app.localhost:5173' } })).toBe(200)
    expect(await status('/__sygnal/graph', { headers: { host: 'dev.test:5173' } })).toBe(403)
    server.config.server.allowedHosts = ['.dev.test']
    expect(await status('/__sygnal/graph', { headers: { host: 'dev.test:5173' } })).toBe(200)
  })

  it('prints its URL under Vite\'s', async () => {
    const printed = []
    const { server } = start(project({ files: { 'App.jsx': APP } }), {}, {
      printUrls() { printed.push('vite') },
      resolvedUrls: { local: ['http://localhost:5173/app/'], network: [] },
    })
    server.printUrls()
    expect(printed).toEqual(['vite'])
    expect(server.logs).toContainEqual(['info', '  ➜  Sygnal graph: http://localhost:5173/__sygnal/graph'])
  })

  it('graph: false: no route, no banner line, no stamps, no app-side bridge', async () => {
    const dir = project({ files: { 'App.jsx': APP } })
    const { plugin, server } = start(dir, { graph: false, check: false }, { printUrls() {}, resolvedUrls: { local: ['http://localhost:5173/'] } })
    expect(server.stack).toEqual([])
    server.printUrls()
    expect(server.logs).toEqual([])
    expect(stamped(codeOf(await transform(plugin, APP, path.join(dir, 'src', 'App.jsx'))))).toEqual({})
    const entry = await transform(plugin, "import { run } from 'sygnal'\nimport App from './App.jsx'\nrun(App)\n", path.join(dir, 'src', 'main.js'))
    expect(entry.code).not.toContain('virtual:sygnal/graph')
    expect(await plugin.resolveId.handler.call({}, 'virtual:sygnal/graph', '/src/main.js', {})).toBeNull()
    // with check on, the checker runs check() as before (no live project)
    const checked = start(dir, { graph: false })
    expect(checked.server.stack).toEqual([])
  })

  it('without sygnal-check: the route says what to install, nothing is stamped or printed', async () => {
    const dir = project({ files: { 'App.jsx': APP }, checker: false })
    const { plugin, server } = start(dir, {}, { printUrls() {}, resolvedUrls: { local: ['http://localhost:5173/'] } })
    const { res } = await request(server, '/__sygnal/graph')
    expect(res.statusCode).toBe(404)
    expect(res.body).toMatch(/needs a sygnal-check with the live graph page.*npm i -D sygnal-check/)
    server.printUrls()
    expect(server.logs.filter(([, m]) => /Sygnal graph/.test(m))).toEqual([])
    expect(stamped(codeOf(await transform(plugin, APP, path.join(dir, 'src', 'App.jsx'))))).toEqual({})
    const entry = await transform(plugin, "import { run } from 'sygnal'\nimport App from './App.jsx'\nrun(App)\n", path.join(dir, 'src', 'main.js'))
    expect(entry.code).not.toContain('virtual:sygnal/graph')
  })
})

/** the keys a module's stamp tail sets, by binding */
const stamped = (code) => {
  const tail = code && /;\(\(\) => \{ try \{ for \(const \[f, k\] of \[(.*)\]\) if \(f\) Object\.defineProperty\(f, '__sygnalKey'/.exec(code)
  if (!tail) return {}
  return Object.fromEntries([...tail[1].matchAll(/\[typeof (\w+) == 'function' \? \1 : null, "([^"]+)"\]/g)].map(m => [m[1], m[2]]))
}

async function stampsOfProject(dir, plugin) {
  const out = {}
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])
  for (const file of walk(path.join(dir, 'src')).filter(f => /\.jsx?$/.test(f) && !/\.test\./.test(f))) {
    const r = await transform(plugin, fs.readFileSync(file, 'utf8'), file)
    const code = typeof r == 'string' ? r : r?.code
    Object.assign(out, Object.fromEntries(Object.entries(stamped(code)).map(([b, k]) => [path.relative(dir, file) + ':' + b, k])))
  }
  return out
}

describe('component stamps (P-2, D544)', () => {
  it.each([['graph-shop', SHOP], ['kanban', KANBAN]])("give each component of %s the static graph's key", async (_, from) => {
    const dir = project({ from })
    const { plugin, server } = start(dir, { check: false })
    const page = await request(server, '/__sygnal/graph')
    const graph = JSON.parse(/<script type="application\/json" id="graph-data">(.*?)<\/script>/s.exec(page.res.body)[1].replace(/\\u003c/g, '<'))
    const stamps = await stampsOfProject(dir, plugin)
    expect(Object.values(stamps).sort()).toEqual(graph.components.map(c => c.key).sort())
    // each binding is the component of that key, in its own file
    for (const [where, key] of Object.entries(stamps)) {
      const [file, binding] = where.split(':')
      expect(key.startsWith(file.split(path.sep).join('/') + '#')).toBe(true)
      expect(graph.components.find(c => c.key === key).name).toBe(binding)
    }
  })

  it('the tail keeps the sourcemap and runs: a non-enumerable key on the function', async () => {
    const dir = project({ files: { 'App.jsx': APP } })
    const { plugin } = start(dir, { check: false })
    const r = await transform(plugin, APP, path.join(dir, 'src', 'App.jsx'))
    expect(r.code.startsWith(APP)).toBe(true)
    expect(r.map.mappings.split(';')).toHaveLength(APP.split('\n').length)
    const fn = new Function(r.code.replace('export default function App', 'function App').replace(/<button[^]*?<\/button>/, 'null').replace(/^.*__SYGNAL_VIEW_TOKENS__.*$/m, '') + '\nreturn App')()
    expect(fn.__sygnalKey).toBe('src/App.jsx#App')
    expect(Object.keys(fn)).not.toContain('__sygnalKey')
    expect(Object.getOwnPropertyDescriptor(fn, '__sygnalKey')).toMatchObject({ enumerable: false, writable: false, configurable: true })
  })

  it('a module edited on disk is built again before it is stamped (no stale key, no wait for the watcher)', async () => {
    const dir = project({ files: { 'App.jsx': APP } })
    const { plugin } = start(dir, { check: false })
    expect(stamped((await transform(plugin, APP, path.join(dir, 'src', 'App.jsx'))).code)).toEqual({ App: 'src/App.jsx#App' })
    const renamed = APP.replace(/\bApp\b/g, 'Root')
    fs.writeFileSync(path.join(dir, 'src', 'App.jsx'), renamed)
    expect(stamped((await transform(plugin, renamed, path.join(dir, 'src', 'App.jsx'))).code)).toEqual({ Root: 'src/App.jsx#Root' })
  })

  it('never in a build, under SSR, or for files outside the scanned paths', async () => {
    const dir = project({ files: { 'App.jsx': APP } })
    const build = sygnal()
    configure(build, { root: dir, command: 'build' })
    expect(transform(build, APP, path.join(dir, 'src', 'App.jsx'))).toBeNull()
    expect(await build.resolveId.handler.call({}, 'virtual:sygnal/graph', '/src/main.js', {})).toBeNull()
    const { plugin } = start(dir, { check: false })
    expect(await transform(plugin, APP, path.join(dir, 'src', 'App.jsx'), { ssr: true })).toBeNull()
    fs.mkdirSync(path.join(dir, 'other'))
    fs.writeFileSync(path.join(dir, 'other', 'X.jsx'), APP)
    expect(stamped(codeOf(await transform(plugin, APP, path.join(dir, 'other', 'X.jsx'))))).toEqual({})
    expect(await transform(plugin, APP, path.join(dir, 'node_modules', 'x', 'App.jsx'))).toBeNull()
    // in dev the same module is stamped
    expect(stamped(codeOf(await transform(plugin, APP, path.join(dir, 'src', 'App.jsx'))))).toEqual({ App: 'src/App.jsx#App' })
  })

  it("the dev entries load the app side of 'Live data' (with DevTools on)", async () => {
    const dir = project({ files: { 'App.jsx': APP } })
    const ENTRY = "import { run } from 'sygnal'\nimport App from './App.jsx'\nrun(App)\n"
    const { plugin } = start(dir, { check: false })
    const entry = await transform(plugin, ENTRY, path.join(dir, 'src', 'main.js'))
    expect(entry.code.split('\n')[0]).toMatch(/^import 'sygnal\/devtools';import 'virtual:sygnal\/graph';/)
    expect(await plugin.resolveId.handler.call({}, 'virtual:sygnal/graph', '/src/main.js', {})).toBe('\0virtual:sygnal/graph')
    expect(plugin.load('\0virtual:sygnal/graph')).toBe("import { installGraphBridge } from 'sygnal/devtools';\ninstallGraphBridge({ channel: \"sygnal:graph\" });\n")
    const off = start(dir, { check: false, devtools: false }).plugin
    const plain = await transform(off, ENTRY, path.join(dir, 'src', 'main.js'))
    expect(plain.code).not.toContain('virtual:sygnal/graph')
  })
})

describe("inspect()'s key (P-2)", () => {
  const h = createElement
  function Row({ state }) { return h('li', null, String(state.t)) }
  Row.initialState = { t: '' }
  function List() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
  List.initialState = { rows: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }] }
  let t
  beforeEach(() => setupChecks())
  afterEach(() => { t?.dispose(); t = null })

  it('reports the stamped key on each instance (and none without a stamp), valid against the schema', async () => {
    Object.defineProperty(List, '__sygnalKey', { value: 'src/List.jsx#List', configurable: true })
    try {
      t = renderComponent(List)
      await t.ready()
      const g = t.inspect()
      expect(validate(schema, g)).toEqual([])
      expect(g.components.find(c => c.name === 'List').key).toBe('src/List.jsx#List')
      expect(g.components.filter(c => c.name === 'Row').map(c => c.key)).toEqual([undefined, undefined])
      expect(g.components.filter(c => c.name === 'Row').every(c => !('key' in c))).toBe(true)
    } finally {
      delete List.__sygnalKey
    }
  })
})
