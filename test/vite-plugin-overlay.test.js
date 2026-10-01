// R5 (Phase 2 review): the sygnal-check browser channel of the Vite plugin.
// - findings go only to the page that asks for them (never broadcast on connect)
// - warnings never open Vite's error overlay (Vite reloads on the first HMR
//   update while one is open), overlay: 'warn' included
// - error findings are sent again after a source change even when unchanged
//   (the HMR update closed the overlay), and the dev client closes a
//   sygnal-check overlay before each update so it never triggers a reload
// Runs against the built plugin (npm run build).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sygnal from '../dist/vite/plugin.mjs'

const dirs = []
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

function configure(plugin, root) {
  const saved = process.env.VITEST
  delete process.env.VITEST
  try {
    plugin.config({ root }, { command: 'serve' })
    plugin.configResolved({ root })
  } finally {
    if (saved !== undefined) process.env.VITEST = saved
  }
}

// A project whose sygnal-check is a fake returning globalThis.__findings
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-overlay-'))
  dirs.push(dir)
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"app","type":"module"}')
  const pkg = path.join(dir, 'node_modules', 'sygnal-check')
  fs.mkdirSync(pkg, { recursive: true })
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"name":"sygnal-check","type":"module","main":"index.js"}')
  fs.writeFileSync(path.join(pkg, 'index.js'), 'export function check() { globalThis.__checks = (globalThis.__checks || 0) + 1; return globalThis.__findings }')
  fs.mkdirSync(path.join(dir, 'src'))
  return dir
}

const diag = (severity, line = 1) => ({ code: 'SYG101', severity, file: 'src/A.jsx', line, column: 1, message: 'm' })

// A fake Vite dev server: ws.on(<custom event>) listeners, ws.send broadcasts
function fakeServer({ clients = 1 } = {}) {
  const custom = {}
  const watch = {}
  const server = {
    logs: [],
    broadcast: [],
    config: { logger: { info: m => server.logs.push(['info', m]), warn: m => server.logs.push(['warn', m]) } },
    ws: {
      clients: new Set(Array.from({ length: clients }, (_, i) => i)),
      send: p => server.broadcast.push(p),
      on: (e, cb) => { custom[e] = cb },
    },
    watcher: { on: (e, cb) => { watch[e] = cb } },
    // a page loads: its dev client sends 'sygnal:check:request'
    pageLoads() {
      const client = { got: [], send: p => client.got.push(p) }
      custom['sygnal:check:request']?.(undefined, client)
      return client
    },
    change: file => watch.change?.(file),
    hasRequestHandler: () => typeof custom['sygnal:check:request'] === 'function',
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

async function start(findings, options, serverOpts) {
  globalThis.__findings = findings
  globalThis.__checks = 0
  const dir = project()
  const plugin = sygnal(options)
  configure(plugin, dir)
  const server = fakeServer(serverOpts)
  plugin.configureServer(server)
  await until(() => globalThis.__checks > 0 && server.hasRequestHandler())
  return { dir, server }
}

describe('vite plugin — sygnal-check overlay (R5)', () => {
  it('answers only the page that asks; nothing is broadcast on startup or connection', async () => {
    const { server } = await start([diag('error')])
    expect(server.broadcast).toEqual([])
    const a = server.pageLoads()
    expect(a.got.map(p => p.type)).toEqual(['custom', 'error'])
    expect(a.got[1].err).toMatchObject({ plugin: 'sygnal-check', loc: { line: 1 } })
    const b = server.pageLoads()
    expect(b.got.map(p => p.type)).toEqual(['custom', 'error'])
    expect(server.broadcast).toEqual([]) // a second page doesn't re-send to the first
  })

  it("warnings never open the overlay, also with overlay: 'warn' (one notice)", async () => {
    for (const options of [{}, { check: { overlay: 'warn' } }]) {
      const { server } = await start([diag('warn')], options)
      const page = server.pageLoads()
      expect(page.got.map(p => p.type)).toEqual(['custom'])
      expect(page.got[0].data.diagnostics[0]).toMatchObject({ severity: 'warn' })
      const notices = server.logs.filter(([, m]) => /overlay: 'warn' is treated as 'error'/.test(m))
      expect(notices).toHaveLength(options.check ? 1 : 0)
    }
  })

  it('overlay: false keeps errors out of the overlay too', async () => {
    const { server } = await start([diag('error')], { check: { overlay: false } })
    expect(server.pageLoads().got.map(p => p.type)).toEqual(['custom'])
  })

  it('after a source change: re-sends the overlay even when unchanged, the console event only when changed', async () => {
    const { dir, server } = await start([diag('error')])
    server.change(path.join(dir, 'src', 'A.jsx'))
    await until(() => globalThis.__checks > 1)
    expect(server.broadcast.map(p => p.type)).toEqual(['error'])
    globalThis.__findings = [diag('error', 2)]
    server.change(path.join(dir, 'src', 'A.jsx'))
    await until(() => globalThis.__checks > 2)
    expect(server.broadcast.map(p => p.type)).toEqual(['error', 'custom', 'error'])
    expect(server.broadcast[2].err.loc.line).toBe(2)
    globalThis.__findings = []
    server.change(path.join(dir, 'src', 'A.jsx'))
    await until(() => globalThis.__checks > 3)
    expect(server.broadcast.map(p => p.type)).toEqual(['error', 'custom', 'error', 'custom'])
  })

  it('does not send an error while no page is connected (Vite would buffer it for the next load)', async () => {
    const { dir, server } = await start([diag('error')], {}, { clients: 0 })
    server.change(path.join(dir, 'src', 'A.jsx'))
    await until(() => globalThis.__checks > 1)
    await new Promise(r => setTimeout(r, 20))
    expect(server.broadcast).toEqual([])
  })

  it('the dev client asks for the findings and closes a sygnal-check overlay before each HMR update', async () => {
    const plugin = sygnal()
    configure(plugin, process.cwd())
    const code = plugin.load('\0virtual:sygnal/dev')
    const handlers = {}
    const sent = []
    const closed = []
    const overlay = { close: () => closed.push(1) }
    const hot = { on: (e, cb) => { handlers[e] = cb }, send: e => sent.push(e) }
    const document = { querySelectorAll: sel => (sel === 'vite-error-overlay' ? [overlay] : []) }
    const quiet = { warn() {}, error() {}, info() {} }
    new Function('hot', 'document', 'console', code.replace(/import\.meta\.hot/g, 'hot'))(hot, document, quiet)
    expect(sent).toEqual(['sygnal:check:request'])

    // another plugin's error overlay: left alone (Vite handles it)
    handlers['vite:error']({ err: { plugin: 'vite:esbuild' } })
    handlers['vite:beforeUpdate']({})
    expect(closed).toEqual([])
    // ours: closed before the update, so Vite's client doesn't reload the page
    handlers['vite:error']({ err: { plugin: 'sygnal-check' } })
    handlers['vite:beforeUpdate']({})
    expect(closed).toEqual([1])
    // and closed when the findings no longer include errors
    handlers['vite:error']({ err: { plugin: 'sygnal-check' } })
    handlers['sygnal:check']({ summary: 's', diagnostics: [{ severity: 'warn', text: 't' }] })
    expect(closed).toEqual([1, 1])
  })
})
