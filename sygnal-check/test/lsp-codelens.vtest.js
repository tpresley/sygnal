// PLAN-7 P4-4: textDocument/codeLens (intent keys, model keys, EVENTS selects / emits), its
// commands per client, workspace/codeLens/refresh and the sygnal.codeLens setting, through
// createLspServer() with the in-memory client (lsp-helpers.js).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { startServer, tempDir, copyFixture, uriOf, repo } from './lsp-helpers.js'

const cleanup = []
afterEach(() => {
  for (const f of cleanup.splice(0)) {
    try { f() } catch { /* already gone */ }
  }
})

async function open(dir, { init = {}, server, onRequest } = {}) {
  const client = startServer({ server, onRequest })
  cleanup.push(() => client.server.dispose(), () => fs.rmSync(dir, { recursive: true, force: true }))
  await client.initialize({ workspaceFolders: [{ uri: uriOf(dir), name: 'p' }], ...init })
  const file = (rel) => path.join(dir, rel)
  const raw = (rel) => client.request('textDocument/codeLens', { textDocument: { uri: uriOf(file(rel)) } })
  /** Each lens as `token → title` (token: the text its range covers), in order. */
  const lenses = async (rel, { text } = {}) => {
    const list = await raw(rel)
    if (list === null) return null
    const lines = (text ?? fs.readFileSync(file(rel), 'utf8')).split('\n')
    return list.map(l => `${lines[l.range.start.line].slice(l.range.start.character, l.range.end.character)} → ${l.command.title}`)
  }
  const refreshes = () => client.serverRequests.filter(m => m.method === 'workspace/codeLens/refresh').length
  return { dir, client, file, raw, lenses, refreshes }
}

const project = (files, opts) => open(tempDir({ 'package.json': '{ "name": "p", "private": true }', ...files }), opts)

// every trigger kind and sink kind
const ALL = `import { undoable, pager, event } from 'sygnal'
import { decide } from 'sygnal/ai'

function All({ state }) {
  return <div><button className="go">go</button><button className="back">back</button><i className="ev">e</i></div>
}
All.uses = { pages: pager({ next: '.go' }) }
All.initialState = { n: 0 }
All.intent = ({ DOM }) => ({ GO: DOM.click('.go'), UNDO: DOM.click('.back'), FIRE: DOM.click('.ev'), NOPE: DOM.click('.ev') })
All.model = undoable({
  GO: {
    STATE: (s, d, next) => { next('STEP'); return s },
    HTTP: () => ({ url: '/x', ok: 'LOADED', error: 'FAILED' }),
  },
  FIRE: {
    EVENTS: event('FIRED', (s) => s),
    EFFECT: () => {},
    PARENT: (s) => s.n,
    LLM: () => decide({ messages: [], ok: 'DECIDED' }),
  },
  STEP: (s) => s,
  LOADED: (s) => s,
  'FAILED | EFFECT': () => {},
  DECIDED: (s) => s,
  MSG: (s) => s,
  RES: (s) => s,
  ROUTE: (s) => s,
  TICK: (s) => s,
  VIS: (s) => s,
  ASKED: (s) => s,
  'pages.NEXT': (s) => s,
  BOOTSTRAP: (s) => s,
  ORPHAN: (s) => s,
})
All.connections = { ws: { url: 'ws://x', message: 'MSG' } }
All.resources = { r: { url: '/r', ok: 'RES' } }
All.route = 'ROUTE'
All.timers = (s) => ({ tick: { every: 100, action: 'TICK' } })
All.browser = (s) => ({ vis: { visibility: true, action: 'VIS' } })
All.agent = { name: 'all', actions: { ASKED: { description: 'ask' } } }
export default All
`

describe('capabilities', () => {
  it('advertises codeLensProvider (no resolve) and the jump command', async () => {
    const client = startServer()
    cleanup.push(() => client.server.dispose())
    const r = await client.initialize({ rootUri: null })
    expect(r.capabilities.codeLensProvider).toEqual({ resolveProvider: false })
    expect(r.capabilities.executeCommandProvider).toEqual({ commands: ['sygnal.goTo'] })
  })
})

describe('titles', () => {
  it('intent keys: the handler, its sinks (EVENTS types, reply names) and next() targets; no model entry (SYG101)', async () => {
    const p = await project({ 'src/All.jsx': ALL })
    const ls = await p.lenses('src/All.jsx')
    expect(ls).toContain('GO → handled by model.GO · STATE, HTTP → LOADED/FAILED · next → STEP')
    expect(ls).toContain("FIRE → handled by model.FIRE · EVENTS 'FIRED', EFFECT, PARENT, LLM → DECIDED")
    expect(ls).toContain('UNDO → handled by model.UNDO · STATE')
    expect(ls).toContain('NOPE → no model entry')
    const diags = p.client.diags(p.file('src/All.jsx'))
    expect(diags.filter(d => d.code === 'SYG101').map(d => d.data?.action ?? d.message)).toHaveLength(1)
  })

  it('model keys: each trigger kind; not triggered (SYG102)', async () => {
    const p = await project({ 'src/All.jsx': ALL })
    const ls = await p.lenses('src/All.jsx')
    for (const want of [
      'GO → triggered by intent',
      'FIRE → triggered by intent',
      'STEP → triggered by next from GO',
      'LOADED → triggered by reply (HTTP ok from GO)',
      'FAILED → triggered by reply (HTTP error from GO)',
      'DECIDED → triggered by reply (LLM ok from FIRE)',
      'MSG → triggered by connection (message)',
      'RES → triggered by resource',
      'ROUTE → triggered by route',
      'TICK → triggered by timer',
      'VIS → triggered by browser',
      'ASKED → triggered by agent tool',
      "'pages.NEXT' → triggered by behavior pages",
      'BOOTSTRAP → triggered by the core',
      'ORPHAN → not triggered',
      // undoable(): both at the callee, prefixed with the action
      'undoable → UNDO: triggered by intent',
      'undoable → REDO: not triggered',
    ]) expect(ls).toContain(want)
    const syg102 = p.client.diags(p.file('src/All.jsx')).filter(d => d.code === 'SYG102').map(d => d.message)
    expect(syg102.join('\n')).toMatch(/'ORPHAN'/)
    expect(syg102.join('\n')).toMatch(/'REDO'/)
  })

  it("not triggered as info when a dynamic next() might; unknown triggers and handlers aren't guessed", async () => {
    const p = await project({
      'src/D.jsx': `function D() { return <i className="d">d</i> }
D.intent = ({ DOM }) => ({ X: DOM.click('.d') })
D.model = { X: (s, d, next) => { next(d.name); return s }, Y: (s) => s }
export default D
`,
      'src/U.jsx': `const more = {}
function U() { return <i className="u">u</i> }
U.intent = ({ DOM }) => ({ A: DOM.click('.u'), B: DOM.click('.u') })
U.model = { A: (s) => s, ...more }
export default U
`,
      'src/I.jsx': `import intent from './intent.js'
function I() { return <i className="i">i</i> }
I.intent = intent
I.model = { Z: (s) => s }
export default I
`,
      'src/intent.js': 'export default (sources) => sources.DOM.select(".i").events("click").map(() => ({ type: "Z" }))\n',
    })
    expect(await p.lenses('src/D.jsx')).toEqual([
      'X → handled by model.X · STATE',
      'X → triggered by intent',
      'Y → not triggered (a dynamic name might)',
    ])
    expect(await p.lenses('src/U.jsx')).toEqual([
      'A → handled by model.A · STATE',
      'B → handler not known statically', // a spread in the model: no SYG101
      'A → triggered by intent',
    ])
    expect(await p.lenses('src/I.jsx')).toEqual(['Z → trigger not known statically'])
  })

  it("persist's RESTORE: triggered by persist", async () => {
    const p = await project({
      'src/P.jsx': `function P() { return <i className="p">p</i> }
P.intent = ({ DOM }) => ({ GO: DOM.click('.p') })
P.persist = { key: 'p' }
P.model = { GO: (s) => s, RESTORE: (s, d) => d }
export default P
`,
    })
    expect(await p.lenses('src/P.jsx')).toContain('RESTORE → triggered by persist')
  })

  it('a model shared by two components: one lens per component, prefixed with its name', async () => {
    const p = await project({
      'src/model.js': 'export const model = { GO: (s) => s }\n',
      'src/A.jsx': `import { model } from './model.js'\nfunction A() { return <i className="a">a</i> }\nA.intent = ({ DOM }) => ({ GO: DOM.click('.a') })\nA.model = model\nexport default A\n`,
      'src/B.jsx': `import { model } from './model.js'\nfunction B() { return <i className="b">b</i> }\nB.model = model\nexport default B\n`,
    })
    expect(await p.lenses('src/model.js')).toEqual(['GO → A: triggered by intent', 'GO → B: not triggered'])
  })

  it('a reducer function outside the model object: its next() and event() count for the entry', async () => {
    const p = await project({
      'src/R.jsx': `import { event } from 'sygnal'
const save = (s, d, next) => { next('DONE'); return s }
const saved = event('SAVED', (s) => s)
function R() { return <i className="r">r</i> }
R.intent = ({ DOM }) => ({ SAVE: DOM.click('.r') })
R.model = { SAVE: { STATE: save, EVENTS: saved }, DONE: (s) => s }
export default R
`,
    })
    const ls = await p.lenses('src/R.jsx')
    expect(ls).toContain("SAVE → handled by model.SAVE · STATE, EVENTS 'SAVED' · next → DONE")
    expect(ls).toContain('DONE → triggered by next from SAVE')
  })
})

describe('EVENTS', () => {
  it('a select counts its emitters, an emit its listeners, across files', async () => {
    const p = await project({
      'src/A.jsx': `import { event, emit } from 'sygnal'
function A() { return <i className="a">a</i> }
A.intent = ({ DOM }) => ({ X: DOM.click('.a'), Y: DOM.click('.a') })
A.model = { X: { EVENTS: event('SAVED', (s) => s) }, Y: { EVENTS: emit('LONELY', (s) => s) } }
export default A
`,
      'src/B.jsx': `import { event } from 'sygnal'
function B() { return <i className="b">b</i> }
B.intent = ({ DOM }) => ({ Z: DOM.click('.b') })
B.model = { Z: { EVENTS: event('SAVED', (s) => s) } }
export default B
`,
      'src/C.jsx': `function C() { return <i>c</i> }
C.intent = ({ EVENTS }) => ({ GOT: EVENTS.select('SAVED'), NEVER: EVENTS.select('NOBODY') })
C.model = { GOT: (s) => s, NEVER: (s) => s }
export default C
`,
    })
    const c = await p.lenses('src/C.jsx')
    expect(c).toContain("'SAVED' → 2 emitters")
    expect(c).toContain("'NOBODY' → no emitters")
    const a = await p.lenses('src/A.jsx')
    expect(a).toContain("'SAVED' → 1 listener")
    expect(a).toContain("'LONELY' → no listeners")
    expect(a).toContain("X → handled by model.X · EVENTS 'SAVED'")
  })
})

describe('commands', () => {
  const C = `function C() { return <i className="c">c</i> }
C.intent = ({ DOM }) => ({ GO: DOM.click('.c'), NONE: DOM.click('.c') })
C.model = { GO: (s) => s }
export default C
`
  const commandOf = (list, line) => list.find(l => l.range.start.line === line && l.command.title.startsWith('handled'))?.command

  it('no capability for a jump: title-only lenses', async () => {
    const p = await project({ 'src/C.jsx': C })
    const list = await p.raw('src/C.jsx')
    expect(list.length).toBe(3)
    for (const l of list) expect(l.command.command).toBe('')
    expect(list.every(l => l.command.arguments === undefined)).toBe(true)
  })

  it('window/showDocument: the server command; executing it shows the first target and returns them all', async () => {
    const p = await project({ 'src/C.jsx': C }, { init: { capabilities: { window: { showDocument: { support: true } } } } })
    const list = await p.raw('src/C.jsx')
    const cmd = commandOf(list, 1)
    const uri = uriOf(p.file('src/C.jsx'))
    const target = { uri, range: { start: { line: 2, character: 12 }, end: { line: 2, character: 14 } } }
    expect(cmd).toEqual({ title: 'handled by model.GO · STATE', command: 'sygnal.goTo', arguments: [{ uri, position: { line: 1, character: 27 }, locations: [target] }] })
    // a lens without a target stays title-only
    expect(list.find(l => l.command.title === 'no model entry').command).toEqual({ title: 'no model entry', command: '' })
    const res = await p.client.request('workspace/executeCommand', { command: cmd.command, arguments: cmd.arguments })
    expect(res).toEqual([target])
    await p.client.waitFor(() => p.client.serverRequests.some(m => m.method === 'window/showDocument'))
    expect(p.client.serverRequests.find(m => m.method === 'window/showDocument').params).toEqual({ uri, takeFocus: true, selection: target.range })
  })

  it('an unknown command is an error', async () => {
    const p = await project({ 'src/C.jsx': C })
    const r = await p.client.send('workspace/executeCommand', { command: 'nope', arguments: [] })
    expect(r.error.code).toBe(-32602)
  })

  it("a client command the client lists (experimental.commands, or initializationOptions.clientCommands): showReferences' arguments", async () => {
    const uriPos = (p) => [uriOf(p.file('src/C.jsx')), { line: 1, character: 27 }]
    const a = await project({ 'src/C.jsx': C }, { init: { capabilities: { window: { showDocument: { support: true } }, experimental: { commands: { commands: ['sygnal.showReferences', 'editor.action.showReferences'] } } } } })
    const ca = commandOf(await a.raw('src/C.jsx'), 1)
    expect(ca.command).toBe('sygnal.showReferences')
    expect(ca.arguments.slice(0, 2)).toEqual(uriPos(a))
    expect(ca.arguments[2]).toHaveLength(1)
    const b = await project({ 'src/C.jsx': C }, { init: { initializationOptions: { clientCommands: ['editor.action.showReferences'] } } })
    const cb = commandOf(await b.raw('src/C.jsx'), 1)
    expect(cb.command).toBe('editor.action.showReferences')
    expect(cb.arguments.slice(0, 2)).toEqual(uriPos(b))
  })
})

describe('refresh', () => {
  const C = `function C() { return <i className="c">c</i> }
C.intent = ({ DOM }) => ({ GO: DOM.click('.c') })
C.model = { GO: (s) => s }
export default C
`
  it('after a check that changed the lenses, when the client supports it; not for an edit that changes none', async () => {
    const p = await project({ 'src/C.jsx': C }, { init: { capabilities: { workspace: { codeLens: { refreshSupport: true } } } } })
    expect(p.refreshes()).toBe(0) // the first check is the baseline
    p.client.open(p.file('src/C.jsx'), C)
    await p.client.settle()
    expect(p.refreshes()).toBe(0)
    p.client.change(p.file('src/C.jsx'), C + '// a comment\n')
    await p.client.settle()
    expect(p.refreshes()).toBe(0)
    const text = C.replace('C.model = { GO: (s) => s }', 'C.model = { GO: (s) => s, LOST: (s) => s }')
    p.client.change(p.file('src/C.jsx'), text, 3)
    await p.client.settle()
    expect(p.refreshes()).toBe(1)
    expect(await p.lenses('src/C.jsx', { text })).toContain('LOST → not triggered')
  })

  it('never without refreshSupport', async () => {
    const p = await project({ 'src/C.jsx': C })
    p.client.open(p.file('src/C.jsx'), C.replace('C.model = { GO: (s) => s }', 'C.model = { GO: (s) => s, LOST: (s) => s }'))
    await p.client.settle()
    expect(p.refreshes()).toBe(0)
  })
})

describe('the sygnal.codeLens setting', () => {
  const C = `function C() { return <i className="c">c</i> }
C.intent = ({ DOM }) => ({ GO: DOM.click('.c') })
C.model = { GO: (s) => s }
export default C
`
  it('false in initializationOptions: no lenses', async () => {
    const p = await project({ 'src/C.jsx': C }, { init: { initializationOptions: { codeLens: false } } })
    expect(await p.raw('src/C.jsx')).toEqual([])
  })

  it('per folder from workspace/configuration (it wins); turning it off refreshes', async () => {
    let value = true
    const p = await project({ 'src/C.jsx': C }, {
      init: { initializationOptions: { codeLens: false }, capabilities: { workspace: { configuration: true, codeLens: { refreshSupport: true } } } },
      onRequest: (m, params) => m === 'workspace/configuration' ? params.items.map(() => ({ codeLens: value })) : null,
    })
    expect(await p.lenses('src/C.jsx')).toEqual(['GO → handled by model.GO · STATE', 'GO → triggered by intent'])
    value = false
    p.client.notify('workspace/didChangeConfiguration', { settings: {} })
    await p.client.waitFor(() => p.refreshes() === 1)
    expect(await p.raw('src/C.jsx')).toEqual([])
  })

  it('a non-boolean value is ignored with a warning', async () => {
    const p = await project({ 'src/C.jsx': C }, { init: { initializationOptions: { codeLens: 'yes' } } })
    expect(await p.raw('src/C.jsx')).toHaveLength(2)
    expect(p.client.messages.some(m => m.method === 'window/logMessage' && /sygnal\.codeLens must be a boolean/.test(m.params.message))).toBe(true)
  })
})

describe('unsaved buffers and freshness', () => {
  const C = `function C() { return <i className="c">c</i> }
C.intent = ({ DOM }) => ({ GO: DOM.click('.c') })
C.model = { GO: (s) => s }
export default C
`
  it('lenses come from the open document, not the disk', async () => {
    const p = await project({ 'src/C.jsx': C })
    const text = C.replace("GO: DOM.click('.c')", "GO: DOM.click('.c'),\n  NEW: DOM.click('.c')")
    p.client.open(p.file('src/C.jsx'), text)
    await p.client.settle()
    const list = await p.raw('src/C.jsx')
    expect(await p.lenses('src/C.jsx', { text })).toContain('NEW → no model entry')
    expect(list.find(l => l.command.title === 'no model entry').range.start.line).toBe(2)
  })

  it('a document changed during the debounce is answered from a fresh index (the worker call)', async () => {
    const p = await project({ 'src/C.jsx': C }, { server: { debounce: 60_000 } })
    p.client.open(p.file('src/C.jsx'), C)
    await p.client.settle()
    const text = '// first\n' + C.replace('C.model = { GO: (s) => s }', 'C.model = { GO: (s) => s, LATER: (s) => s }')
    p.client.change(p.file('src/C.jsx'), text)
    const list = await p.raw('src/C.jsx')
    expect(list.find(l => l.command.title === 'not triggered').range.start.line).toBe(3)
  })

  it("a document that doesn't parse: null (no positions to trust)", async () => {
    const p = await project({ 'src/C.jsx': C })
    p.client.open(p.file('src/C.jsx'), C)
    await p.client.settle()
    p.client.change(p.file('src/C.jsx'), C.replace("DOM.click('.c') })", "DOM.click('.c' })"))
    await p.client.settle()
    expect(await p.raw('src/C.jsx')).toBeNull()
  })

  it('in the check worker (structured-cloned index and flow)', async () => {
    const p = await project({ 'src/C.jsx': C }, { server: { worker: true } })
    expect(p.client.server.usingWorker).toBe(true)
    expect(await p.lenses('src/C.jsx')).toEqual(['GO → handled by model.GO · STATE', 'GO → triggered by intent'])
  })
})

describe('fixtures and examples', () => {
  it("0-S3's edge-case fixture", async () => {
    const p = await open(copyFixture(path.join(repo, 'dev-plans/research/p7-spikes/0-S3/fixture')), { init: { initializationOptions: { paths: ['.'] } } })
    expect(await p.lenses('Edge.jsx')).toEqual([
      "SAVE → handled by model.SAVE · STATE, HTTP → LOADED/FAILED, LLM → TRIAGED, EVENTS 'SAVED'",
      // a computed intent key ([ACTIONS.TICK]) resolved through its constant (P4-3)
      'ACTIONS.TICK → handled by model.TICK · STATE',
      'EXTERNAL → no model entry',
      // EVENTS.select(SAVED) with SAVED an imported constant, resolved (P4-3)
      'SAVED → 2 emitters',
      // the intent still has a computed key, so the rules don't list it: UNDO/REDO stay unknown
      'undoable → UNDO: trigger not known statically',
      'undoable → REDO: trigger not known statically',
      'SAVE → triggered by intent, agent tool',
      "'SAVED' → 1 listener", // the constant-built select above
      'LOADED → triggered by reply (HTTP ok from SAVE), agent tool',
      'FAILED → triggered by reply (HTTP error from SAVE)',
      'TICK → triggered by intent',
      // the behavior definition's own intent key and the uses key: one label (P4-3)
      "'c.BUMP' → triggered by behavior c",
    ])
  })

  it('kanban: EVENTS across components, emitters and listeners jump to each other', async () => {
    const p = await open(copyFixture(path.join(repo, 'examples/kanban')), { init: { capabilities: { window: { showDocument: { support: true } } } } })
    const root = await p.raw('src/RootComponent.jsx')
    const sel = root.filter(l => l.command.title === '1 emitter')
    expect(sel).toHaveLength(3)
    for (const l of sel) expect(l.command.arguments[0].locations[0].uri).toBe(uriOf(p.file('src/LaneComponent.jsx')))
    const lane = await p.lenses('src/LaneComponent.jsx')
    expect(lane).toContain("DELETE_LANE → handled by model.DELETE_LANE · EVENTS 'DELETE_LANE'")
    expect(lane.filter(l => l.endsWith('→ 1 listener'))).toHaveLength(3)
    expect(await p.lenses('src/RootComponent.jsx')).toContain('BOOTSTRAP → triggered by the core')
  })
})
