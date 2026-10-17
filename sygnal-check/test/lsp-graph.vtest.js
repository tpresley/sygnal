// The app graph over LSP (PLAN-10 E-1): the `sygnal/graph` request and the `sygnal/graphChanged`
// notification, through createLspServer() with the in-memory client (lsp-helpers.js), in-thread
// and in the check worker.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { startServer, copyFixture, tempDir, uriOf, here } from './lsp-helpers.js'
import { createLiveProject } from '../src/live.js'
import { ErrorCodes, Methods } from '../src/lsp/protocol.js'

const shop = path.join(here, 'fixtures/graph-shop')

const cleanup = []
afterEach(() => {
  for (const f of cleanup.splice(0)) {
    try { f() } catch { /* already gone */ }
  }
})

async function open(dir, { worker = false, folders = [dir] } = {}) {
  const client = startServer({ server: { worker } })
  cleanup.push(() => client.server.dispose(), () => fs.rmSync(dir, { recursive: true, force: true }))
  await client.initialize({ workspaceFolders: folders.map((f, i) => ({ uri: uriOf(f), name: `f${i}` })) })
  const changed = () => client.messages.filter(m => m.method === Methods.graphChanged).map(m => m.params)
  return { client, dir, changed, file: (rel) => path.join(dir, rel) }
}

const names = (g) => g.components.map(c => c.name).sort()
/** What `sygnal-check --graph --json` gives for the root (live.js build(): the same as graphFiles()). */
const cliGraph = (root) => JSON.parse(createLiveProject({ root }).build().json)

const EXTRA = `function Extra({ state }) {
  return <div className="extra">{state.n}</div>
}
Extra.initialState = { n: 0 }
Extra.intent = ({ DOM }) => ({ BUMP: DOM.click('.extra') })
Extra.model = { BUMP: (s) => ({ ...s, n: s.n + 1 }) }
export default Extra
`

describe('sygnal/graph', () => {
  for (const worker of [false, true]) {
    it(`answers the root's graph, the same JSON as the CLI${worker ? ' (check worker)' : ''}`, async () => {
      const p = await open(copyFixture(shop), { worker })
      const r = await p.client.request(Methods.graph, { root: uriOf(p.dir) })
      expect(r.root).toBe(uriOf(p.dir))
      expect(r.version).toBe(1)
      expect(r.graph).toEqual(cliGraph(p.dir))
      expect(names(r.graph)).toContain('Cart')
      // a stable key per component (D521)
      expect(r.graph.components.find(c => c.name === 'Cart').key).toBe('src/Cart.jsx#Cart')
    })
  }

  it('names the root by a document, by a path, or as the only root', async () => {
    const p = await open(copyFixture(shop))
    const byUri = await p.client.request(Methods.graph, { uri: uriOf(p.file('src/Cart.jsx')) })
    const byDoc = await p.client.request(Methods.graph, { textDocument: { uri: uriOf(p.file('src/App.jsx')) } })
    const byPath = await p.client.request(Methods.graph, { root: p.dir })
    const only = await p.client.request(Methods.graph, {})
    for (const r of [byUri, byDoc, byPath, only]) {
      expect(r.root).toBe(uriOf(p.dir))
      expect(r.version).toBe(1)
    }
    expect(byUri.graph).toEqual(only.graph)
  })

  it('follows the open documents (unsaved text) and notifies after a change', async () => {
    const p = await open(copyFixture(shop))
    const first = await p.client.request(Methods.graph, { root: uriOf(p.dir) })
    expect(p.changed()).toEqual([]) // the first graph is the answer, not a notification
    // a check that changes nothing in the graph sends nothing
    p.client.open(p.file('src/Cart.jsx'))
    await p.client.settle()
    expect(p.changed()).toEqual([])

    // an unsaved edit that adds a component
    const app = p.file('src/App.jsx')
    p.client.open(p.file('src/Extra.jsx'), EXTRA)
    await p.client.settle()
    expect(p.changed()).toEqual([{ root: uriOf(p.dir), version: 2 }])
    const second = await p.client.request(Methods.graph, { root: uriOf(p.dir) })
    expect(second.version).toBe(2)
    expect(names(second.graph)).toEqual([...names(first.graph), 'Extra'].sort())
    // lines added above a component: its id moves, its key doesn't
    p.client.open(app)
    p.client.change(app, '// a comment\n// another\n' + fs.readFileSync(app, 'utf8'))
    const third = await p.client.request(Methods.graph, { root: uriOf(p.dir) }) // waits for the debounced check
    expect(third.version).toBe(3)
    const appOf = (g) => g.components.find(c => c.name === 'App')
    expect(appOf(third.graph).key).toBe(appOf(second.graph).key)
    const lineOf = (c) => Number(c.id.split(':').pop())
    expect(lineOf(appOf(third.graph))).toBe(lineOf(appOf(second.graph)) + 2)
    await p.client.settle()
    expect(p.changed().map(c => c.version)).toEqual([2, 3])
  })

  it("keeps a file's last good version while it doesn't parse", async () => {
    const p = await open(copyFixture(shop))
    const cart = p.file('src/Cart.jsx')
    const before = await p.client.request(Methods.graph, { root: uriOf(p.dir) })
    p.client.open(cart)
    p.client.change(cart, fs.readFileSync(cart, 'utf8').replace('return', 'return ((('))
    const r = await p.client.request(Methods.graph, { uri: uriOf(cart) })
    expect(names(r.graph)).toEqual(names(before.graph))
    expect(r.graph.diagnostics.some(d => d.code === 'SYG900' && /^could not parse file/.test(d.message))).toBe(true)
  })

  it('only notifies about roots a request asked about', async () => {
    const a = copyFixture(shop)
    const b = copyFixture(shop)
    cleanup.push(() => fs.rmSync(b, { recursive: true, force: true }))
    const p = await open(a, { folders: [a, b] })
    await p.client.request(Methods.graph, { root: uriOf(a) })
    p.client.open(path.join(b, 'src/Extra.jsx'), EXTRA)
    await p.client.settle()
    expect(p.changed()).toEqual([])
    p.client.open(path.join(a, 'src/Extra.jsx'), EXTRA)
    await p.client.settle()
    expect(p.changed()).toEqual([{ root: uriOf(a), version: 2 }])
  })

  it('a root without source files has a null graph', async () => {
    const dir = tempDir({ 'package.json': '{ "name": "p", "private": true, "dependencies": { "sygnal": "*" } }', 'README.md': 'x' })
    const p = await open(dir)
    const r = await p.client.request(Methods.graph, { root: uriOf(dir) })
    expect(r).toEqual({ root: uriOf(dir), version: 1, graph: null })
  })

  it('refuses what is not a root it can name', async () => {
    const a = copyFixture(shop)
    const b = copyFixture(shop)
    cleanup.push(() => fs.rmSync(b, { recursive: true, force: true }))
    const p = await open(a, { folders: [a, b] })
    const err = (params) => p.client.send(Methods.graph, params).then(r => r.error)
    expect((await err({})).code).toBe(ErrorCodes.InvalidParams) // two roots
    expect((await err({ root: 'relative/path' })).code).toBe(ErrorCodes.InvalidParams)
    expect((await err({ root: uriOf(path.join(a, 'src')) })).code).toBe(ErrorCodes.InvalidParams) // not a root
    expect((await err({ uri: uriOf('/nowhere/x.jsx') })).code).toBe(ErrorCodes.InvalidParams)
    expect(await err({ root: uriOf(b) })).toBeUndefined()
  })
})
