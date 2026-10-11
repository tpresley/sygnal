// PLAN-7 N-2: textDocument/definition and textDocument/references for actions and EVENTS types,
// through createLspServer() with the in-memory client (lsp-helpers.js). The index itself:
// positions.vtest.js.
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

async function project(files, { init = {}, server } = {}) {
  const dir = tempDir({ 'package.json': '{ "name": "p", "private": true }', ...files })
  return open(dir, { init, server })
}

async function open(dir, { init = {}, server } = {}) {
  const client = startServer({ server })
  cleanup.push(() => client.server.dispose(), () => fs.rmSync(dir, { recursive: true, force: true }))
  await client.initialize({ workspaceFolders: [{ uri: uriOf(dir), name: 'p' }], ...init })
  const file = (rel) => path.join(dir, rel)

  /** The 0-based position of the `nth` match of `needle` in `rel` (or in `text`), plus `offset` characters. */
  const pos = (rel, needle, { nth = 0, offset = 0, text } = {}) => {
    const src = text ?? fs.readFileSync(file(rel), 'utf8')
    let i = -1
    for (let n = 0; n <= nth; n++) { i = src.indexOf(needle, i + 1); if (i < 0) throw new Error(`no ${needle} #${nth} in ${rel}`) }
    i += offset
    const before = src.slice(0, i)
    const line = before.split('\n').length - 1
    return { line, character: i - (before.lastIndexOf('\n') + 1) }
  }
  /** `file:line:col-endCol` (1-based, as editors show them) of each Location, with the text it covers. */
  const show = (locs, texts = {}) => locs === null ? null : locs.map(l => {
    const rel = path.relative(dir, new URL(l.uri).pathname)
    const src = texts[rel] ?? fs.readFileSync(file(rel), 'utf8')
    const lines = src.split('\n')
    const t = lines[l.range.start.line].slice(l.range.start.character, l.range.end.character)
    return `${rel}:${l.range.start.line + 1}:${l.range.start.character + 1} ${t}`
  })
  const at = (rel, needle, opts) => ({ textDocument: { uri: uriOf(file(rel)) }, position: pos(rel, needle, opts) })
  const definition = async (rel, needle, opts = {}) => show(await client.request('textDocument/definition', at(rel, needle, opts)), opts.texts)
  const references = async (rel, needle, opts = {}) => show(await client.request('textDocument/references', {
    ...at(rel, needle, opts), context: { includeDeclaration: opts.includeDeclaration ?? true },
  }), opts.texts)
  return { dir, client, file, pos, definition, references }
}

const ALL = `import { undoable, pager } from 'sygnal'

function All({ state }) {
  return <div><button className="go">go</button><button className="back">back</button></div>
}
All.uses = { pages: pager({ next: '.go' }) }
All.initialState = { n: 0 }
All.intent = ({ DOM }) => ({ GO: DOM.click('.go'), UNDO: DOM.click('.back') })
All.model = undoable({
  GO: {
    STATE: (s, d, next) => { next('STEP'); return s },
    HTTP: () => ({ url: '/x', ok: 'LOADED', error: 'FAILED' }),
  },
  STEP: (s) => s,
  LOADED: (s) => s,
  'FAILED | EFFECT': () => {},
  MSG: (s) => s,
  RES: (s) => s,
  ROUTE: (s) => s,
  TICK: (s) => s,
  VIS: (s) => s,
  ASKED: (s) => s,
  'pages.NEXT': (s) => s,
  BOOTSTRAP: (s) => s,
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
  it('advertises definitionProvider and referencesProvider', async () => {
    const client = startServer()
    cleanup.push(() => client.server.dispose())
    const r = await client.initialize({ rootUri: null })
    expect(r.capabilities.definitionProvider).toBe(true)
    expect(r.capabilities.referencesProvider).toBe(true)
  })
})

describe('actions: each kind, both ways', () => {
  it('intent key ↔ model entry', async () => {
    const p = await project({ 'src/All.jsx': ALL })
    expect(await p.definition('src/All.jsx', 'GO:')).toEqual(['src/All.jsx:10:3 GO'])
    expect(await p.definition('src/All.jsx', 'GO: {', { offset: 1 })).toEqual(['src/All.jsx:8:30 GO'])
  })

  it("next('X') ↔ model entry", async () => {
    const p = await project({ 'src/All.jsx': ALL })
    expect(await p.definition('src/All.jsx', "next('STEP')", { offset: 7 })).toEqual(['src/All.jsx:14:3 STEP'])
    expect(await p.definition('src/All.jsx', 'STEP: (s)')).toEqual(['src/All.jsx:11:36 STEP'])
  })

  it('reply names (ok / error) ↔ model entries, the shorthand key by its action part', async () => {
    const p = await project({ 'src/All.jsx': ALL })
    expect(await p.definition('src/All.jsx', "'LOADED'", { offset: 2 })).toEqual(['src/All.jsx:15:3 LOADED'])
    expect(await p.definition('src/All.jsx', 'LOADED: (s)')).toEqual(['src/All.jsx:12:36 LOADED'])
    expect(await p.definition('src/All.jsx', "'FAILED'", { offset: 1 })).toEqual(['src/All.jsx:16:4 FAILED'])
    expect(await p.definition('src/All.jsx', "'FAILED | EFFECT'", { offset: 3 })).toEqual(['src/All.jsx:12:53 FAILED'])
    expect(await p.definition('src/All.jsx', "'FAILED | EFFECT'", { offset: 12 })).toBeNull() // EFFECT: a sink
  })

  it('connections / resources / route / timers / browser names ↔ model entries', async () => {
    const p = await project({ 'src/All.jsx': ALL })
    for (const [needle, name, line] of [["'MSG'", 'MSG', 17], ["'RES'", 'RES', 18], ["'ROUTE'", 'ROUTE', 19], ["'TICK'", 'TICK', 20], ["'VIS'", 'VIS', 21]]) {
      expect(await p.definition('src/All.jsx', needle, { offset: 1 })).toEqual([`src/All.jsx:${line}:3 ${name}`])
      const back = await p.definition('src/All.jsx', `${name}: (s)`)
      expect(back).toHaveLength(1)
      expect(back[0]).toMatch(new RegExp(`^src/All\\.jsx:(2[6-9]|30):\\d+ ${name}$`))
    }
  })

  it('agent.actions key ↔ model entry', async () => {
    const p = await project({ 'src/All.jsx': ALL })
    expect(await p.definition('src/All.jsx', 'ASKED: {')).toEqual(['src/All.jsx:22:3 ASKED'])
    expect(await p.definition('src/All.jsx', 'ASKED: (s)')).toEqual(['src/All.jsx:31:39 ASKED'])
  })

  it("behavior names: a host's 'pages.NEXT' entry ↔ the uses key (a first-party behavior has no source)", async () => {
    const p = await project({ 'src/All.jsx': ALL })
    expect(await p.definition('src/All.jsx', "'pages.NEXT'", { offset: 3 })).toEqual(['src/All.jsx:6:14 pages'])
    expect(await p.definition('src/All.jsx', 'pages:', { offset: 1 })).toEqual(['src/All.jsx:23:4 pages.NEXT'])
    const refs = await p.references('src/All.jsx', 'pages:')
    expect(refs).toContain('src/All.jsx:23:4 pages.NEXT')
    expect(refs).toContain('src/All.jsx:6:14 pages')
  })

  it("undoable(): UNDO / REDO at the undoable callee (synthetic)", async () => {
    const p = await project({ 'src/All.jsx': ALL })
    expect(await p.definition('src/All.jsx', 'UNDO:')).toEqual(['src/All.jsx:9:13 undoable'])
    expect(await p.definition('src/All.jsx', 'undoable({', { offset: 2 })).toEqual(['src/All.jsx:8:52 UNDO'])
  })

  it('built-ins: a BOOTSTRAP entry has no trigger to go to; its references are itself', async () => {
    const p = await project({ 'src/All.jsx': ALL })
    expect(await p.definition('src/All.jsx', 'BOOTSTRAP:')).toBeNull()
    expect(await p.references('src/All.jsx', 'BOOTSTRAP:')).toEqual(['src/All.jsx:24:3 BOOTSTRAP'])
    expect(await p.references('src/All.jsx', 'BOOTSTRAP:', { includeDeclaration: false })).toEqual([])
  })

  it('references: every occurrence of the action in the component; includeDeclaration leaves out the model keys', async () => {
    const p = await project({ 'src/All.jsx': ALL })
    expect(await p.references('src/All.jsx', "'LOADED'", { offset: 1 })).toEqual(['src/All.jsx:12:36 LOADED', 'src/All.jsx:15:3 LOADED'])
    expect(await p.references('src/All.jsx', "'LOADED'", { offset: 1, includeDeclaration: false })).toEqual(['src/All.jsx:12:36 LOADED'])
    expect(await p.references('src/All.jsx', 'GO:', { includeDeclaration: false })).toEqual(['src/All.jsx:8:30 GO'])
  })

  it('outside any occurrence (a sink key, a selector\'s quote, plain code): null', async () => {
    const p = await project({ 'src/All.jsx': ALL })
    expect(await p.definition('src/All.jsx', 'STATE:')).toBeNull()
    expect(await p.definition('src/All.jsx', "'.go'", { offset: 0 })).toBeNull()
    expect(await p.references('src/All.jsx', 'function All')).toBeNull()
    expect(await p.client.request('textDocument/definition', { textDocument: { uri: 'file:///nowhere/x.jsx' }, position: { line: 0, character: 0 } })).toBeNull()
  })
})

describe('0-S3 edge fixture', () => {
  it('names built from constants go to the action and the constant; the rest navigates', async () => {
    const p = await open(copyFixture(path.join(repo, 'dev-plans/research/p7-spikes/0-S3/fixture')), { init: { initializationOptions: { paths: ['.'] } } })
    expect(await p.definition('Edge.jsx', '[ACTIONS.TICK]', { offset: 10 })).toEqual(['Edge.jsx:15:19 TICK', 'Edge.jsx:36:3 TICK'])
    // no model entry LOAD_DONE / LOAD_MORE: the constant only
    expect(await p.definition('Edge.jsx', "PREFIX + '_DONE'", { offset: 11 })).toEqual(['Edge.jsx:14:7 PREFIX'])
    expect(await p.definition('Edge.jsx', '${PREFIX}_MORE', { offset: 10 })).toEqual(['Edge.jsx:14:7 PREFIX'])
    // SAVED: imported; its emitter (event('SAVED')) and the constant in names.js
    expect(await p.definition('Edge.jsx', 'EVENTS.select(SAVED)', { offset: 15 })).toEqual(['Edge.jsx:32:20 SAVED', 'names.js:1:14 SAVED'])
    expect(await p.definition('Edge.jsx', "'TRIAGED'", { offset: 1 })).toBeNull() // no model entry: nothing
    expect(await p.definition('Edge.jsx', 'SAVE: DOM')).toEqual(['Edge.jsx:28:3 SAVE'])
    expect(await p.definition('Edge.jsx', 'SAVE: {', { nth: 0 })).toEqual(['Edge.jsx:23:3 SAVE'])
    expect(await p.references('Edge.jsx', 'SAVE: DOM')).toEqual(['Edge.jsx:23:3 SAVE', 'Edge.jsx:28:3 SAVE', 'Edge.jsx:40:41 SAVE'])
    expect(await p.definition('Edge.jsx', "'POLL'", { offset: 1 })).toBeNull()
    // the behavior definition's intent key (and the uses key)
    expect(await p.definition('Edge.jsx', "'c.BUMP'", { offset: 1 })).toEqual(['Edge.jsx:10:33 BUMP', 'Edge.jsx:20:15 c'])
  })
})

describe('EVENTS across files', () => {
  const files = {
    'src/Emitter.jsx': `import { event, emit } from 'sygnal'
function Emitter() { return <button className="b">b</button> }
Emitter.intent = ({ DOM }) => ({ A: DOM.click('.b'), B: DOM.click('.b'), C: DOM.click('.b') })
Emitter.model = {
  A: { EVENTS: event('SAVED', (s) => s) },
  B: emit('SAVED', (s) => s),
  C: { EVENTS: () => ({ type: 'TOAST', data: 'hi' }) },
}
export default Emitter
`,
    'src/Listener.jsx': `import { Toaster } from 'sygnal/ui'
function Listener() { return <div><Toaster /></div> }
Listener.intent = ({ EVENTS }) => ({ GOT: EVENTS.select('SAVED') })
Listener.model = { GOT: (s) => s }
export default Listener
`,
  }

  it('select → its emitters; emitter → its selects (the implicit Toaster one included)', async () => {
    const p = await project(files)
    expect(await p.definition('src/Listener.jsx', "'SAVED'", { offset: 1 })).toEqual(['src/Emitter.jsx:5:23 SAVED', 'src/Emitter.jsx:6:12 SAVED'])
    expect(await p.definition('src/Emitter.jsx', "'SAVED'", { offset: 1 })).toEqual(['src/Listener.jsx:3:58 SAVED'])
    expect(await p.definition('src/Emitter.jsx', "'TOAST'", { offset: 1 })).toEqual(['src/Listener.jsx:1:10 Toaster'])
    expect(await p.definition('src/Listener.jsx', 'Toaster }')).toEqual(['src/Emitter.jsx:7:32 TOAST'])
  })

  it('references across files; includeDeclaration leaves out the emits', async () => {
    const p = await project(files)
    const all = ['src/Emitter.jsx:5:23 SAVED', 'src/Emitter.jsx:6:12 SAVED', 'src/Listener.jsx:3:58 SAVED']
    expect(await p.references('src/Listener.jsx', "'SAVED'", { offset: 1 })).toEqual(all)
    expect(await p.references('src/Emitter.jsx', "'SAVED'", { offset: 1, nth: 1 })).toEqual(all)
    expect(await p.references('src/Emitter.jsx', "'SAVED'", { offset: 1, includeDeclaration: false })).toEqual(['src/Listener.jsx:3:58 SAVED'])
  })
})

describe('cross-file and shared definitions', () => {
  it('an intent imported from another file', async () => {
    const p = await project({
      'src/intent.js': `export const intent = ({ DOM }) => ({ INC: DOM.click('.inc') })\n`,
      'src/C.jsx': `import { intent } from './intent.js'\nfunction C() { return <button className="inc">+</button> }\nC.intent = intent\nC.model = { INC: (s) => s + 1 }\nC.initialState = 0\nexport default C\n`,
    })
    expect(await p.definition('src/C.jsx', 'INC:')).toEqual(['src/intent.js:1:39 INC'])
    expect(await p.definition('src/intent.js', 'INC:')).toEqual(['src/C.jsx:4:13 INC'])
  })

  it('a model shared by two components: every intent key', async () => {
    const p = await project({
      'src/shared.js': `export const model = { GO: (s) => s }\n`,
      'src/A.jsx': `import { model } from './shared.js'\nfunction A() { return <a className="a">a</a> }\nA.intent = ({ DOM }) => ({ GO: DOM.click('.a') })\nA.model = model\nexport default A\n`,
      'src/B.jsx': `import { model } from './shared.js'\nfunction B() { return <b className="b">b</b> }\nB.intent = ({ DOM }) => ({ GO: DOM.click('.b') })\nB.model = model\nexport default B\n`,
    })
    expect(await p.definition('src/shared.js', 'GO:')).toEqual(['src/A.jsx:3:28 GO', 'src/B.jsx:3:28 GO'])
    expect(await p.references('src/shared.js', 'GO:')).toEqual(['src/A.jsx:3:28 GO', 'src/B.jsx:3:28 GO', 'src/shared.js:1:24 GO'])
    expect(await p.references('src/A.jsx', 'GO:')).toEqual(['src/A.jsx:3:28 GO', 'src/shared.js:1:24 GO'])
  })
})

const C = `function C() { return <button className="go">go</button> }
C.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
C.model = { GO: (s) => s }
export default C
`

describe('freshness', () => {
  it('unsaved buffers: positions come from the open document, not the disk', async () => {
    const p = await project({ 'src/C.jsx': C })
    const text = C.replace('C.model = { GO: (s) => s }', 'C.model = {\n  // moved\n  GO: (s) => s,\n}')
    p.client.open(p.file('src/C.jsx'), text)
    await p.client.settle()
    expect(await p.definition('src/C.jsx', 'GO:', { texts: { 'src/C.jsx': text } })).toEqual(['src/C.jsx:5:3 GO'])
  })

  it('a document changed since the last check is answered from a fresh index (the worker), a checked one from the last check', async () => {
    const p = await project({ 'src/C.jsx': C }, { server: { debounce: 60_000 }, init: { initializationOptions: { trace: { server: 'verbose' } } } })
    const navLogs = () => p.client.messages.filter(m => m.method === 'window/logMessage' && m.params.message.includes('navigation:')).map(m => m.params.message)
    p.client.open(p.file('src/C.jsx'), C)
    await p.client.settle()
    expect(await p.definition('src/C.jsx', 'GO:')).toEqual(['src/C.jsx:3:13 GO'])
    expect(navLogs().at(-1)).toMatch(/from the last check's index/)

    // changed, not saved: the check waits for the (long) debounce, so the kept index is stale
    const text = '// a new first line\n' + C.replace('C.model = { GO: (s) => s }', 'C.model = {\n  GO: (s) => s,\n  BACK: (s) => s,\n}')
    p.client.change(p.file('src/C.jsx'), text)
    const texts = { 'src/C.jsx': text }
    expect(await p.definition('src/C.jsx', 'GO:', { text, texts })).toEqual(['src/C.jsx:5:3 GO'])
    expect(navLogs().at(-1)).toMatch(/changed since the last check; index built in/)
    // that index is kept: the next request needs no worker call
    expect(await p.references('src/C.jsx', 'GO:', { text, texts })).toEqual(['src/C.jsx:3:28 GO', 'src/C.jsx:5:3 GO'])
    expect(navLogs().at(-1)).toMatch(/from the last check's index/)
    // the old position (line 3, the intent's GO before the edit) is now plain code
    expect(await p.client.request('textDocument/definition', { textDocument: { uri: uriOf(p.file('src/C.jsx')) }, position: { line: 2, character: 12 } })).toBeNull()
  })

  it("a document that doesn't parse: null in it; other files still navigate", async () => {
    const p = await project({
      'src/C.jsx': C,
      'src/D.jsx': `import { emit } from 'sygnal'\nfunction D() { return <i className="d">d</i> }\nD.intent = ({ DOM }) => ({ X: DOM.click('.d') })\nD.model = { X: (s) => s }\nexport default D\n`,
    })
    p.client.open(p.file('src/C.jsx'), C)
    await p.client.settle()
    const broken = C.replace("DOM.click('.go') })", "DOM.click('.go' })")
    p.client.change(p.file('src/C.jsx'), broken)
    await p.client.settle()
    expect(await p.definition('src/C.jsx', 'GO:', { text: broken })).toBeNull()
    expect(await p.definition('src/D.jsx', 'X:')).toEqual(['src/D.jsx:4:13 X'])
  })

  it('in the check worker (structured-cloned index)', async () => {
    const p = await project({ 'src/C.jsx': C }, { server: { worker: true } })
    expect(p.client.server.usingWorker).toBe(true)
    expect(await p.definition('src/C.jsx', 'GO:')).toEqual(['src/C.jsx:3:13 GO'])
    const text = C.replace('C.model = { GO', 'C.model = {   GO')
    p.client.open(p.file('src/C.jsx'), text)
    expect(await p.definition('src/C.jsx', 'GO:', { texts: { 'src/C.jsx': text } })).toEqual(['src/C.jsx:3:15 GO'])
  })
})
