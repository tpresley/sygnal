// PLAN-10 W-1 (D524): `--graph=html --watch`: the live project (src/live.js), the watcher
// (src/watch.js), the server (src/liveServer.js), the page's host adapter
// (src/graphView/liveHost.js) and the CLI.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createLiveProject } from '../src/live.js'
import { createWatcher, isRelevant } from '../src/watch.js'
import { createLiveServer, PAGE_CSP } from '../src/liveServer.js'
import { graphChanges } from '../src/graphView/liveHost.js'
import { graphHtml } from '../src/graphView/html.js'
import { graphFiles } from '../src/graph.js'
import { expandInputs } from '../src/files.js'
import { main, watchGraph, parseArgs } from '../src/cli.js'

const APP = `import { Counter } from './Counter.jsx'
import { Badge } from '../shared/Badge.jsx'
export function App({ state }) {
  return <div><Counter /><Badge /><button className="reset">reset</button></div>
}
App.initialState = { n: 0 }
App.intent = ({ DOM }) => ({ RESET: DOM.click('.reset') })
App.model = { RESET: () => ({ n: 0 }) }
`
const COUNTER = `export function Counter({ state }) {
  return <button className="inc">{state.count}</button>
}
Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Counter.model = { INC: (s) => ({ count: s.count + 1 }) }
`
const BADGE = 'export function Badge() { return <span>badge</span> }\n'

const dirs = []
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })
/** A temp project: package.json, src/App.jsx, src/Counter.jsx and shared/Badge.jsx (outside src). */
function project() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-watch-test-')))
  dirs.push(root)
  fs.mkdirSync(path.join(root, 'src'))
  fs.mkdirSync(path.join(root, 'shared'))
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'watch-app' }))
  fs.writeFileSync(path.join(root, 'src/App.jsx'), APP)
  fs.writeFileSync(path.join(root, 'src/Counter.jsx'), COUNTER)
  fs.writeFileSync(path.join(root, 'shared/Badge.jsx'), BADGE)
  return root
}
const wait = (ms) => new Promise(r => setTimeout(r, ms))
async function until(fn, ms = 3000) {
  const t0 = Date.now()
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error('timed out')
    await wait(10)
  }
}

describe('live.js: the incremental project', () => {
  it('builds the same graph as graphFiles(), then rebuilds a one-file edit parsing only that file', () => {
    const root = project()
    const live = createLiveProject({ root })
    const a = live.build()
    const { files } = expandInputs(['src'], { cwd: root })
    expect(a.json).toBe(JSON.stringify(graphFiles(files, { cwd: root })))
    expect(a).toMatchObject({ version: 1, changed: true, substituted: [] })
    expect(a.graph.components.map(c => c.name).sort()).toEqual(['App', 'Counter'])

    const parses = live.cache.stats.parses
    fs.writeFileSync(path.join(root, 'src/Counter.jsx'), COUNTER.replace("INC: DOM.click('.inc')", "INC: DOM.click('.inc'), DEC: DOM.click('.dec')"))
    const b = live.build()
    expect(live.cache.stats.parses - parses).toBe(1)
    expect(b).toMatchObject({ version: 2, changed: true })
    expect(b.graph.components.find(c => c.name === 'Counter').actions.map(a => a.name)).toContain('DEC')
    expect(b.hash).not.toBe(a.hash)

    // nothing changed: the same JSON, the same version, nothing re-parsed
    const c = live.build()
    expect(c).toMatchObject({ version: 2, changed: false, hash: b.hash })
    expect(live.cache.stats.parses - parses).toBe(1)
  })

  it('keeps the last good text of a file that stops parsing, with its parse SYG900', () => {
    const root = project()
    const live = createLiveProject({ root })
    live.build()
    const file = path.join(root, 'src/Counter.jsx')
    fs.writeFileSync(file, COUNTER.replace('Counter.model = {', 'Counter.model = {{'))
    const b = live.build()
    expect(b.substituted).toEqual([file])
    expect(b.graph.components.map(c => c.name)).toContain('Counter')
    const parse = [...b.graph.diagnostics, ...b.graph.components.flatMap(c => c.diagnostics)].filter(d => d.code === 'SYG900')
    expect(parse.some(d => /^could not parse file/.test(d.message) && d.file === 'src/Counter.jsx')).toBe(true)
    // parses again: built as it is
    fs.writeFileSync(file, COUNTER.replace('count: 0', 'count: 1, step: 1'))
    const c = live.build()
    expect(c.substituted).toEqual([])
    expect(c.graph.components.find(x => x.name === 'Counter').stateKeys).toEqual(['count', 'step'])
  })

  it('a new file under an input appears; a config file change resolves the options again', () => {
    const root = project()
    const live = createLiveProject({ root })
    expect(live.build().options.strict).toBe(false)
    fs.writeFileSync(path.join(root, 'src/Extra.jsx'), 'export function Extra() { return <p /> }\nExtra.initialState = {}\n')
    expect(live.build().graph.components.map(c => c.name)).toContain('Extra')
    fs.writeFileSync(path.join(root, 'sygnal-check.config.json'), JSON.stringify({ strict: true, paths: ['src', 'shared'] }))
    const b = live.build()
    expect(b.options.strict).toBe(true)
    expect(b.files).toContain(path.join(root, 'shared/Badge.jsx'))
  })

  it('watchSet: the input dirs, files loaded from outside them and the config files', () => {
    const root = project()
    const live = createLiveProject({ root })
    live.build()
    const ws = live.watchSet()
    expect(ws.dirs).toEqual([path.join(root, 'src')])
    expect(ws.files).toEqual([path.join(root, 'package.json'), path.join(root, 'shared/Badge.jsx'), path.join(root, 'sygnal-check.config.json')].sort())
    // --no-config: no config files
    live.build({ settings: { config: false } })
    expect(live.watchSet().files).toEqual([path.join(root, 'shared/Badge.jsx')])
  })
})

describe('watch.js', () => {
  it('isRelevant: sources and config files, not under node_modules or dot directories below the watched one', () => {
    expect(isRelevant('a/B.jsx')).toBe(true)
    expect(isRelevant('package.json')).toBe(true)
    expect(isRelevant('sygnal-check.config.json')).toBe(true)
    expect(isRelevant('a/readme.md')).toBe(false)
    expect(isRelevant('node_modules/x/index.js')).toBe(false)
    expect(isRelevant('.cache/x.js')).toBe(false)
  })

  for (const [label, opts] of [['recursive', {}], ['per-directory', { forcePerDirectory: true }], ['poll', { poll: 30 }]]) {
    it(`${label}: one debounced call for a burst of writes, new directories, single files outside`, async () => {
      const root = project()
      const calls = []
      const w = createWatcher({ ...opts, debounce: 120, onChange: (paths) => calls.push(paths) })
      try {
        w.sync({ dirs: [path.join(root, 'src')], files: [path.join(root, 'shared/Badge.jsx'), path.join(root, 'sygnal-check.config.json')] })
        expect(w.mode).toBe(label)
        await wait(400) // FSEvents can replay the files' creation just after a watch starts: let that settle
        calls.length = 0
        const counter = path.join(root, 'src/Counter.jsx')
        fs.writeFileSync(counter, COUNTER + '\n')
        fs.writeFileSync(counter, COUNTER + '\n\n')
        await until(() => calls.length)
        await wait(300)
        expect(calls.length).toBe(1)
        expect(calls[0]).toContain(counter)

        // a file in a new directory
        calls.length = 0
        fs.mkdirSync(path.join(root, 'src/deep'))
        await wait(label === 'poll' ? 60 : 30)
        fs.writeFileSync(path.join(root, 'src/deep/New.jsx'), BADGE)
        await until(() => calls.flat().includes(path.join(root, 'src/deep/New.jsx')))

        // a followed file outside the dirs, an atomic save (rename over it), and a config file created
        calls.length = 0
        const tmp = path.join(root, 'shared/.Badge.jsx.tmp')
        fs.writeFileSync(tmp, BADGE + '\n')
        fs.renameSync(tmp, path.join(root, 'shared/Badge.jsx'))
        await until(() => calls.flat().includes(path.join(root, 'shared/Badge.jsx')))
        fs.writeFileSync(path.join(root, 'sygnal-check.config.json'), '{}')
        await until(() => calls.flat().includes(path.join(root, 'sygnal-check.config.json')))

        // not relevant: nothing
        calls.length = 0
        fs.writeFileSync(path.join(root, 'src/notes.md'), 'x')
        fs.mkdirSync(path.join(root, 'src/node_modules'))
        fs.writeFileSync(path.join(root, 'src/node_modules/x.js'), 'x')
        await wait(200)
        expect(calls).toEqual([])
      } finally { w.close() }
    })
  }

  it('maxWait: a continuous stream of writes still calls back', async () => {
    const root = project()
    const calls = []
    const w = createWatcher({ debounce: 60, maxWait: 150, onChange: (p) => calls.push(p) })
    try {
      w.sync({ dirs: [path.join(root, 'src')] })
      await wait(150)
      calls.length = 0
      const t0 = Date.now()
      while (Date.now() - t0 < 400) { fs.writeFileSync(path.join(root, 'src/App.jsx'), APP + Date.now()); await wait(20) }
      expect(calls.length).toBeGreaterThanOrEqual(1)
    } finally { w.close() }
  })
})

/** A GET (or other method) with headers; resolves { status, headers, body }. */
function request(url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      let body = ''
      res.on('data', d => { body += d })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}
/** An SSE client: { events: [{ id, data }], close() }. */
function stream(url, headers = {}) {
  const events = []
  let res = null
  const req = http.get(url, { headers }, (r) => {
    res = r
    let buf = ''
    r.on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2)
        if (!raw.startsWith('event: graph')) continue
        events.push({ id: raw.match(/^id: (.*)$/m)[1], data: raw.match(/^data: (.*)$/m)[1] })
      }
    })
  })
  req.on('error', () => {})
  return { events, get status() { return res?.statusCode }, get headers() { return res?.headers }, close: () => req.destroy() }
}

describe('liveServer.js', () => {
  it('listens on 127.0.0.1 only, behind the token and a Host check, and serves only the page and the stream', async () => {
    const s = await createLiveServer({ page: (cur) => `<p>v${cur?.version}</p>` })
    try {
      expect(s.address).toBe('127.0.0.1')
      expect(s.url).toBe(`http://127.0.0.1:${s.port}/?t=${s.token}`)
      expect(s.token).toMatch(/^[A-Za-z0-9_-]{24}$/)
      s.publish({ json: '{"components":[]}', version: 1 })
      const page = await request(s.url)
      expect(page.status).toBe(200)
      expect(page.body).toBe('<p>v1</p>')
      expect(page.headers).toMatchObject({
        'content-security-policy': PAGE_CSP, 'referrer-policy': 'no-referrer', 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
      })
      expect(PAGE_CSP).toContain("connect-src 'self'")
      expect(PAGE_CSP).toContain("frame-ancestors 'none'")
      const base = `http://127.0.0.1:${s.port}`
      expect((await request(base + '/')).status).toBe(403)
      expect((await request(base + '/?t=' + 'x'.repeat(24))).status).toBe(403)
      expect((await request(base + '/events')).status).toBe(403)
      expect((await request(s.url, { headers: { Host: `evil.example:${s.port}` } })).status).toBe(403)
      expect((await request(s.url, { headers: { Host: '127.0.0.1' } })).status).toBe(403)
      expect((await request(s.url, { headers: { Host: `localhost:${s.port}` } })).status).toBe(200)
      expect((await request(`${base}/graph.json?t=${s.token}`)).status).toBe(404)
      expect((await request(`${base}/../etc/passwd?t=${s.token}`)).status).toBe(404)
      expect((await request(s.url, { method: 'POST' })).status).toBe(405)
      expect((await request(`${base}/?t=${s.token}`, { method: 'HEAD' })).status).toBe(200)
      // not on another interface: only loopback answers
      const other = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)
      if (other) await expect(request(`http://${other.address}:${s.port}/?t=${s.token}`, { headers: { Host: `127.0.0.1:${s.port}` } })).rejects.toThrow()
    } finally { await s.close() }
  })

  it('the stream: the current graph first, then each publish; Last-Event-ID skips a graph the client has', async () => {
    const s = await createLiveServer({ page: () => '' })
    try {
      s.publish({ json: '{"v":1}', version: 1 })
      const a = stream(`http://127.0.0.1:${s.port}/events?t=${s.token}`)
      const b = stream(`http://127.0.0.1:${s.port}/events?t=${s.token}`, { 'Last-Event-ID': '1' })
      await until(() => a.events.length === 1 && s.clients === 2)
      expect(a.events[0]).toEqual({ id: '1', data: '{"v":1}' })
      expect(a.headers['content-type']).toMatch(/^text\/event-stream/)
      expect(a.headers['referrer-policy']).toBe('no-referrer')
      expect(b.events).toEqual([])
      s.publish({ json: '{"v":2}', version: 2 })
      await until(() => a.events.length === 2 && b.events.length === 1)
      expect(b.events[0]).toEqual({ id: '2', data: '{"v":2}' })
      a.close(); b.close()
      await until(() => s.clients === 0)
    } finally { await s.close() }
  })

  it('close() ends open streams', async () => {
    const s = await createLiveServer({ page: () => '' })
    s.publish({ json: '{}', version: 1 })
    let ended = false
    http.get(`http://127.0.0.1:${s.port}/events?t=${s.token}`, (r) => { r.on('end', () => { ended = true }); r.resume() })
    await until(() => s.clients === 1)
    await s.close()
    await until(() => ended)
  })
})

describe('the page in live mode', () => {
  const g = (comps) => ({ version: 1, source: 'static', components: comps, events: {}, diagnostics: [] })
  const c = (name, line, extra = {}) => ({ name, key: `src/A.jsx#${name}`, id: `src/A.jsx:${line}`, file: 'src/A.jsx', line, actions: [], children: [], ...extra })

  it('graphChanges: added, removed and changed keys; moved lines are not a change', () => {
    const a = g([c('A', 1), c('B', 10, { children: [{ name: 'A', id: 'src/A.jsx:1', line: 12, column: 3 }] }), c('C', 20)])
    const b = g([c('A', 3), c('B', 12, { children: [{ name: 'A', id: 'src/A.jsx:3', line: 14, column: 3 }] }), c('C', 22, { actions: [{ name: 'GO', line: 23 }] }), c('D', 30)])
    expect(graphChanges(a, b)).toEqual({ added: ['src/A.jsx#D'], removed: [], changed: ['src/A.jsx#C'] })
    expect(graphChanges(b, a)).toEqual({ added: [], removed: ['src/A.jsx#D'], changed: ['src/A.jsx#C'] })
    expect(graphChanges(a, a)).toEqual({ added: [], removed: [], changed: [] })
  })

  it('graphHtml: the live adapter and connect-src only with meta.live', () => {
    const graph = g([c('A', 1)])
    const plain = graphHtml(graph)
    expect(plain).not.toContain('connect-src')
    expect(plain).not.toContain('function mountLive')
    const live = graphHtml(graph, { live: { events: '/events', version: 3 } })
    expect(live).toMatch(/http-equiv="Content-Security-Policy" content="[^"]*connect-src 'self'/)
    expect(live).toContain('V.mountLive(V, api')
    expect(live).toContain('"live":{"events":"/events","version":3}')
    // every code title, since later graphs may have other codes
    expect(Object.keys(JSON.parse(live.match(/id="graph-meta">([^]*?)<\/script>/)[1]).codes).length).toBeGreaterThan(50)
  })
})

describe('cli --watch', () => {
  const quiet = () => { let out = '', err = ''; return { stdout: { write: (s) => { out += s } }, stderr: { write: (s) => { err += s } }, get out() { return out }, get err() { return err } } }

  it('flag validation', () => {
    const bad = (args, msg) => { const io = quiet(); expect(main(args, { ...io, cwd: os.tmpdir() })).toBe(2); expect(io.err).toContain(msg) }
    bad(['--watch'], '--watch needs --graph=html')
    bad(['--graph=json', '--watch'], '--watch needs --graph=html')
    bad(['--graph', '--watch'], '--watch needs --graph=html')
    bad(['--graph=html', '--watch', '--out', 'x.html'], '--out cannot be combined with --watch')
    bad(['--graph=html', '--poll'], '--poll needs --watch')
    bad(['--graph=html', '--port', '8080'], '--port needs --watch')
    bad(['--graph=html', '--watch', '--port', 'x'], '--port must be a port number')
    bad(['--graph=html', '--watch', '--port=70000'], '--port must be a port number')
    bad(['--graph=html', '--watch', '--poll=5'], '--poll must be a number of milliseconds')
    expect(parseArgs(['--graph=html', '--watch', '--poll=500', '--port=0'])).toMatchObject({ graph: 'html', watch: true, poll: 500, port: 0 })
    expect(parseArgs(['--graph=html', '--watch', '--poll'])).toMatchObject({ poll: true })
  })

  it('serves the page, sends a changed graph on save and nothing on a no-op save; Ctrl-C closes', async () => {
    const root = project()
    const io = quiet()
    const opened = []
    const signals = new (await import('node:events')).EventEmitter()
    const h = await watchGraph(parseArgs(['--graph=html', '--watch']), { ...io, cwd: root, env: {}, isTTY: true, openFile: (u) => opened.push(u), signals, debounce: 30 })
    try {
      expect(io.out).toBe(h.url + '\n')
      expect(opened).toEqual([h.url])
      expect(io.err).toMatch(/serving the live graph of 2 components on 127\.0\.0\.1:\d+ \((recursive|per-directory)\); Ctrl-C stops/)
      const page = await request(h.url)
      expect(page.status).toBe(200)
      const meta = JSON.parse(page.body.match(/id="graph-meta">([^]*?)<\/script>/)[1])
      expect(meta).toMatchObject({ title: 'watch-app', live: { events: '/events', version: 1 } })
      await wait(150)
      const u = new URL(h.url)
      const s = stream(`http://127.0.0.1:${u.port}/events${u.search}`)
      await until(() => s.events.length === 1)
      expect(JSON.parse(s.events[0].data).components.length).toBe(2)

      fs.writeFileSync(path.join(root, 'src/Counter.jsx'), COUNTER.replace('count: 0', 'count: 0, step: 1'))
      await until(() => s.events.length === 2)
      expect(s.events[1].id).toBe('2')
      expect(JSON.parse(s.events[1].data).components.find(c => c.name === 'Counter').stateKeys).toEqual(['count', 'step'])
      expect(io.err).toMatch(/updated \(2 components, \d+ ms, src\/Counter\.jsx\)/)

      // a save that doesn't change the graph: rebuilt, nothing sent
      const before = io.err
      fs.writeFileSync(path.join(root, 'src/Counter.jsx'), fs.readFileSync(path.join(root, 'src/Counter.jsx'), 'utf8') + '\n// a comment\n')
      await wait(300)
      expect(s.events.length).toBe(2)
      expect(io.err).toBe(before)

      // a file outside src that the app imports is followed too: it is parsed again
      const parses = h.live.cache.stats.parses
      fs.writeFileSync(path.join(root, 'shared/Badge.jsx'), BADGE + '// edited\n')
      await until(() => h.live.cache.stats.parses > parses)
      expect(s.events.length).toBe(2)
      s.close()
    } finally {
      signals.emit('SIGINT')
    }
    expect(await h.closed).toBe(0)
    await expect(request(h.url)).rejects.toThrow()
  })

  it('opens nothing under CI or without a terminal; --poll; no files is exit 2', async () => {
    const root = project()
    for (const [env, isTTY, args] of [[{ CI: '1' }, true, ['--open']], [{}, false, []], [{}, true, ['--no-open']]]) {
      const io = quiet()
      const opened = []
      const h = await watchGraph(parseArgs(['--graph=html', '--watch', '--poll=50', ...args]), { ...io, cwd: root, env, isTTY, openFile: (u) => opened.push(u), signals: null })
      expect(opened).toEqual([])
      expect(h.watcher.mode).toBe('poll')
      if (args[0] === '--open') expect(io.err).toContain('not opening it: CI is set')
      await h.close()
    }
    const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-watch-empty-')))
    dirs.push(empty)
    fs.writeFileSync(path.join(empty, 'package.json'), '{}')
    const io = quiet()
    expect(await main(['--graph=html', '--watch'], { ...io, cwd: empty })).toBe(2)
    expect(io.err).toContain('no source files found')
  })
})
