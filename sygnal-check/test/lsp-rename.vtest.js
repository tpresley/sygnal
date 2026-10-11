// PLAN-7 P4-5: textDocument/prepareRename and textDocument/rename through createLspServer() with
// the in-memory client (lsp-helpers.js), the plan itself (model/rename.js through core.js), and
// the safety test: renames applied to the examples and fixtures leave their findings unchanged.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { startServer, tempDir, copyFixture, uriOf, repo, applyTextEdits } from './lsp-helpers.js'
import { createCore } from '../src/lsp/core.js'
import { check, createParseCache } from '../src/index.js'
import { buildProject } from '../src/model/project.js'
import { buildIndex } from '../src/model/positions.js'
import { expandInputs } from '../src/files.js'
import { resolveOptions } from '../src/config.js'
import { applyEdits } from '../src/edits.js'

const cleanup = []
afterEach(() => {
  for (const f of cleanup.splice(0)) {
    try { f() } catch { /* already gone */ }
  }
})

// what VS Code advertises for rename
const VSCODE = { textDocument: { rename: { prepareSupport: true } }, workspace: { workspaceEdit: { documentChanges: true, changeAnnotationSupport: { groupsOnLabel: true } } } }

async function open(dir, { caps = VSCODE, init = {}, server } = {}) {
  const client = startServer({ server })
  cleanup.push(() => client.server.dispose(), () => fs.rmSync(dir, { recursive: true, force: true }))
  await client.initialize({ workspaceFolders: [{ uri: uriOf(dir), name: 'p' }], capabilities: caps, ...init })
  const file = (rel) => path.join(dir, rel)
  const texts = {} // rel → an unsaved buffer's text
  const textOf = (rel) => texts[rel] ?? fs.readFileSync(file(rel), 'utf8')
  const pos = (rel, needle, { nth = 0, offset = 0 } = {}) => {
    const src = textOf(rel)
    let i = -1
    for (let n = 0; n <= nth; n++) { i = src.indexOf(needle, i + 1); if (i < 0) throw new Error(`no ${needle} #${nth} in ${rel}`) }
    i += offset
    const before = src.slice(0, i)
    return { line: before.split('\n').length - 1, character: i - (before.lastIndexOf('\n') + 1) }
  }
  const at = (rel, needle, opts) => ({ textDocument: { uri: uriOf(file(rel)) }, position: pos(rel, needle, opts) })
  const prepare = (rel, needle, opts) => client.send('textDocument/prepareRename', at(rel, needle, opts))
  const rename = (rel, needle, newName, opts) => client.send('textDocument/rename', { ...at(rel, needle, opts), newName })
  /** Apply a WorkspaceEdit: rel → new text; `only`: the annotation ids to apply (null: every edit). */
  const apply = (edit, { only = null } = {}) => {
    const out = {}
    const lists = edit.changes ? Object.entries(edit.changes) : edit.documentChanges.map(d => [d.textDocument.uri, d.edits])
    for (const [uri, edits] of lists) {
      const rel = path.relative(dir, new URL(uri).pathname)
      const keep = edits.filter(e => !e.annotationId || only === null || only.includes(e.annotationId))
      out[rel] = applyTextEdits(textOf(rel), keep)
    }
    return out
  }
  const edited = (edit) => {
    const lists = edit.changes ? Object.entries(edit.changes) : edit.documentChanges.map(d => [d.textDocument.uri, d.edits])
    return lists.flatMap(([uri, edits]) => edits.map(e => {
      const rel = path.relative(dir, new URL(uri).pathname)
      const line = textOf(rel).split('\n')[e.range.start.line]
      return `${rel}:${e.range.start.line + 1} ${line.slice(e.range.start.character, e.range.end.character)} → ${e.newText}${e.annotationId ? ` [${e.annotationId}]` : ''}`
    }))
  }
  const openDoc = (rel, text) => { texts[rel] = text; client.open(file(rel), text) }
  return { dir, client, file, pos, prepare, rename, apply, edited, openDoc, textOf }
}

const project = (files, opts) => open(tempDir({ 'package.json': '{ "name": "p", "private": true }', ...files }), opts)
const refusal = (r) => { expect(r.error, JSON.stringify(r.result)).toBeTruthy(); expect(r.error.code).toBe(-32803); return r.error.message }

const ACTS = `function Acts({ state }) {
  return <div><button className="go">go</button><i>{state.n}</i></div>
}
Acts.initialState = { n: 0 }
Acts.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
Acts.model = {
  GO: {
    STATE: (s, d, next) => { next('STEP'); return s },
    HTTP: () => ({ url: '/x', ok: 'LOADED', error: 'FAILED' }),
  },
  STEP: (s) => s,
  LOADED: (s) => s,
  'FAILED | EFFECT': () => {},
  MSG: (s) => s,
  TICK: (s) => s,
  ASKED: (s) => s,
}
Acts.connections = { ws: { url: 'ws://x', message: 'MSG' } }
Acts.timers = (s) => ({ tick: { every: 100, action: 'TICK' } })
Acts.agent = { name: 'acts', actions: { ASKED: { description: 'ask' }, GO: { description: 'go' } } }
export default Acts
`

describe('capabilities', () => {
  it('renameProvider with prepareProvider when the client supports prepareRename, else true', async () => {
    const a = startServer()
    cleanup.push(() => a.server.dispose())
    expect((await a.initialize({ rootUri: null, capabilities: VSCODE })).capabilities.renameProvider).toEqual({ prepareProvider: true })
    const b = startServer()
    cleanup.push(() => b.server.dispose())
    expect((await b.initialize({ rootUri: null })).capabilities.renameProvider).toBe(true)
  })
})

describe('prepareRename', () => {
  it('the range and placeholder of a Sygnal name (the string contents; a shorthand key\'s action part)', async () => {
    const p = await project({ 'src/Acts.jsx': ACTS })
    const r = await p.prepare('src/Acts.jsx', "'STEP'", { offset: 2 })
    expect(r.result).toEqual({ range: { start: p.pos('src/Acts.jsx', "'STEP'", { offset: 1 }), end: p.pos('src/Acts.jsx', "'STEP'", { offset: 5 }) }, placeholder: 'STEP' })
    expect((await p.prepare('src/Acts.jsx', "'FAILED | EFFECT'", { offset: 2 })).result.placeholder).toBe('FAILED')
    expect((await p.prepare('src/Acts.jsx', 'GO: DOM')).result.placeholder).toBe('GO')
  })

  it('null outside Sygnal names (plain code, a sink key)', async () => {
    const p = await project({ 'src/Acts.jsx': ACTS })
    expect((await p.prepare('src/Acts.jsx', 'function Acts')).result).toBeNull()
    expect((await p.prepare('src/Acts.jsx', 'STATE:')).result).toBeNull()
    expect((await p.client.send('textDocument/prepareRename', { textDocument: { uri: 'file:///nowhere/x.jsx' }, position: { line: 0, character: 0 } })).result).toBeNull()
  })
})

describe('renamable: actions', () => {
  it('intent key, model key and agent.actions key (annotated: the tool name the LLM sees)', async () => {
    const p = await project({ 'src/Acts.jsx': ACTS })
    const r = await p.rename('src/Acts.jsx', 'GO: DOM', 'START')
    expect(p.edited(r.result)).toEqual([
      'src/Acts.jsx:5 GO → START',
      'src/Acts.jsx:7 GO → START',
      'src/Acts.jsx:20 GO → START [agent]',
    ])
    expect(r.result.changeAnnotations.agent).toMatchObject({ needsConfirmation: true })
    const out = p.apply(r.result)['src/Acts.jsx']
    expect(out).toContain("({ START: DOM.click('.go') })")
    expect(out).toContain('START: { description: \'go\' }')
  })

  it("next('X'), reply names (a shorthand key keeps its sink), connections and timers", async () => {
    const p = await project({ 'src/Acts.jsx': ACTS })
    expect(p.edited((await p.rename('src/Acts.jsx', "'STEP'", 'ADVANCE', { offset: 1 })).result)).toEqual(['src/Acts.jsx:8 STEP → ADVANCE', 'src/Acts.jsx:11 STEP → ADVANCE'])
    const failed = (await p.rename('src/Acts.jsx', "error: 'FAILED'", 'OOPS', { offset: 8 })).result
    expect(p.apply(failed)['src/Acts.jsx']).toContain("'OOPS | EFFECT': () => {}")
    expect(p.apply(failed)['src/Acts.jsx']).toContain("error: 'OOPS'")
    expect(p.edited((await p.rename('src/Acts.jsx', 'MSG: (s)', 'MESSAGE')).result)).toEqual(['src/Acts.jsx:14 MSG → MESSAGE', 'src/Acts.jsx:18 MSG → MESSAGE'])
    expect(p.edited((await p.rename('src/Acts.jsx', "'TICK'", 'BEAT', { offset: 1 })).result)).toEqual(['src/Acts.jsx:15 TICK → BEAT', 'src/Acts.jsx:19 TICK → BEAT'])
  })

  it('a shorthand intent key keeps its value', async () => {
    const p = await project({
      'src/S.jsx': `function S() { return <button className="go">go</button> }
S.intent = ({ DOM }) => { const GO = DOM.click('.go'); return { GO } }
S.model = { GO: (s) => s }
export default S
`,
    })
    const r = await p.rename('src/S.jsx', 'GO }', 'START')
    expect(p.apply(r.result)['src/S.jsx']).toContain('return { START: GO }')
    expect(p.apply(r.result)['src/S.jsx']).toContain('START: (s) => s')
  })

  it('a model object shared by two components: both intents, and each edit once', async () => {
    const p = await project({
      'src/shared.js': 'export const model = { SAVE: (s) => s }\n',
      'src/A.jsx': `import { model } from './shared.js'
function A() { return <button className="a">a</button> }
A.intent = ({ DOM }) => ({ SAVE: DOM.click('.a') })
A.model = model
export default A
`,
      'src/B.jsx': `import { model } from './shared.js'
function B() { return <button className="b">b</button> }
B.intent = ({ DOM }) => ({ SAVE: DOM.click('.b') })
B.model = model
export default B
`,
    })
    const r = await p.rename('src/shared.js', 'SAVE', 'STORE')
    expect(p.edited(r.result).sort()).toEqual(['src/A.jsx:3 SAVE → STORE', 'src/B.jsx:3 SAVE → STORE', 'src/shared.js:1 SAVE → STORE'])
  })

  it("a user behavior's action with one host: the host's 'c.BUMP' and the definition's BUMP", async () => {
    const p = await project({
      'src/counter.js': `import { defineBehavior } from 'sygnal'
export const counter = defineBehavior({
  intent: ({ DOM }, opts) => ({ BUMP: DOM.click(opts.button) }),
  model: { BUMP: (s, d, next) => { next('RESET'); return s }, RESET: (s) => s },
})
`,
      'src/A.jsx': `import { counter } from './counter.js'
function A() { return <button className="a">a</button> }
A.uses = { c: counter({ button: '.a' }) }
A.model = { 'c.BUMP': (s) => s }
export default A
`,
    })
    const r = await p.rename('src/A.jsx', "'c.BUMP'", 'c.HIT', { offset: 3 })
    expect(p.edited(r.result)).toEqual(['src/A.jsx:4 c.BUMP → c.HIT', 'src/counter.js:3 BUMP → HIT', 'src/counter.js:4 BUMP → HIT'])
    // the bare name works too, from the definition
    expect(p.edited((await p.rename('src/counter.js', 'BUMP: DOM', 'HIT')).result)).toHaveLength(3)
    // the uses key itself isn't an action
    expect(refusal(await p.prepare('src/A.jsx', 'c: counter'))).toMatch(/^this is the key of a behavior \(uses\.c\)/)
  })

  it('a computed intent key anywhere in the component refuses its other names too', async () => {
    const p = await open(copyFixture(path.join(repo, 'dev-plans/research/p7-spikes/0-S3/fixture')), { init: { initializationOptions: { paths: ['.'] } } })
    expect(refusal(await p.prepare('Edge.jsx', "'c.BUMP'", { offset: 3 }))).toBe("can't rename c.BUMP: in Edge, its intent is built in a way sygnal-check can't read (a spread, computed keys or a function it can't see)")
  })

  it('through the check worker (the plan crosses the thread boundary as plain data)', async () => {
    const p = await project({ 'src/Acts.jsx': ACTS }, { server: { worker: true } })
    expect(p.client.server.usingWorker).toBe(true)
    expect((await p.prepare('src/Acts.jsx', 'GO: DOM')).result.placeholder).toBe('GO')
    expect(p.edited((await p.rename('src/Acts.jsx', 'GO: DOM', 'START')).result)).toHaveLength(3)
    expect(refusal(await p.rename('src/Acts.jsx', 'GO: DOM', 'STEP'))).toBe("can't rename GO to 'STEP': Acts already has an action STEP")
  })

  it('unsaved buffers: the edits are for the text as the editor has it', async () => {
    const p = await project({ 'src/Acts.jsx': ACTS })
    const text = ACTS.replace("next('STEP'); return s", "next('STEP'); next('STEP'); return s")
    p.openDoc('src/Acts.jsx', '\n\n' + text)
    await p.client.settle()
    const r = await p.rename('src/Acts.jsx', "'STEP'", 'ADVANCE', { offset: 1, nth: 1 })
    expect(p.edited(r.result)).toEqual(['src/Acts.jsx:10 STEP → ADVANCE', 'src/Acts.jsx:10 STEP → ADVANCE', 'src/Acts.jsx:13 STEP → ADVANCE'])
    expect(p.apply(r.result)['src/Acts.jsx']).not.toContain("'STEP'")
  })
})

describe('renamable: EVENTS, class / id tokens, state, context', () => {
  const EVENTS_FILES = {
    'src/Emitter.jsx': `import { event, emit } from 'sygnal'
function Emitter() { return <button className="b">b</button> }
Emitter.intent = ({ DOM }) => ({ A: DOM.click('.b'), B: DOM.click('.b') })
Emitter.model = {
  A: { EVENTS: event('SAVED', (s) => s) },
  B: emit('SAVED', (s) => s),
}
export default Emitter
`,
    'src/Listener.jsx': `function Listener() { return <div>l</div> }
Listener.intent = ({ EVENTS }) => ({ GOT: EVENTS.select('SAVED') })
Listener.model = { GOT: (s) => s }
export default Listener
`,
  }

  it('EVENTS: every emit and select in the project', async () => {
    const p = await project(EVENTS_FILES)
    const r = await p.rename('src/Listener.jsx', "'SAVED'", 'STORED', { offset: 1 })
    expect(p.edited(r.result)).toEqual(['src/Emitter.jsx:5 SAVED → STORED', 'src/Emitter.jsx:6 SAVED → STORED', 'src/Listener.jsx:2 SAVED → STORED'])
    expect(p.edited((await p.rename('src/Emitter.jsx', "'SAVED'", 'any type: ok', { offset: 1 })).result)).toHaveLength(3)
  })

  const DOM_FILE = `function D({ state }) {
  return <div className="panel"><button className="save primary">save</button><span id="count">{state.n}</span></div>
}
D.initialState = { n: 0 }
D.intent = ({ DOM }) => ({ SAVE: DOM.click('.panel .save'), COUNT: DOM.click('#count') })
D.model = { SAVE: (s) => s, COUNT: (s) => s }
export default D
`

  it('class and id: every render and selector of the scope', async () => {
    const p = await project({ 'src/D.jsx': DOM_FILE })
    const r = await p.rename('src/D.jsx', 'save primary', 'store')
    expect(p.edited(r.result)).toEqual(['src/D.jsx:2 save → store', 'src/D.jsx:5 save → store'])
    expect(p.apply(r.result)['src/D.jsx']).toContain("DOM.click('.panel .store')")
    expect(p.apply(r.result)['src/D.jsx']).toContain('className="store primary"')
    // from the selector, '.' / '#' accepted in the new name
    expect(p.edited((await p.rename('src/D.jsx', "'#count'", '#total', { offset: 2 })).result)).toEqual(['src/D.jsx:2 count → total', 'src/D.jsx:5 count → total'])
  })

  it('state: the initialState key and Collection from', async () => {
    const p = await project({
      'src/Item.jsx': 'export default function Item() { return <li>i</li> }\n',
      'src/L.jsx': `import { Collection } from 'sygnal'
import Item from './Item.jsx'
function L() { return <ul><Collection of={Item} from="entries" /></ul> }
L.initialState = { entries: [] }
export default L
`,
    })
    const r = await p.rename('src/L.jsx', 'entries: []', 'rows')
    expect(p.edited(r.result)).toEqual(['src/L.jsx:3 entries → rows', 'src/L.jsx:4 entries → rows'])
  })

  it('context: the provider\'s entry and the reads resolving to it', async () => {
    const p = await project({
      'src/Child.jsx': 'export default function Child({ context }) { return <i className={context.tone}>c</i> }\n',
      'src/Parent.jsx': `import Child from './Child.jsx'
function Parent() { return <div><Child /></div> }
Parent.initialState = { mode: 'dark' }
Parent.context = { tone: (s) => s.mode }
export default Parent
`,
    })
    const r = await p.rename('src/Child.jsx', 'tone', 'shade')
    expect(p.edited(r.result)).toEqual(['src/Child.jsx:1 tone → shade', 'src/Parent.jsx:4 tone → shade'])
  })
})

describe('refusals', () => {
  const refused = async (files, rel, needle, opts = {}) => {
    const p = await project(files)
    const a = refusal(await p.prepare(rel, needle, opts))
    const b = refusal(await p.rename(rel, needle, opts.newName || 'NEW_NAME', opts))
    expect(b).toBe(a)
    return a
  }
  const C = (extra) => ({ 'src/C.jsx': `import { undoable, pager, defineBehavior, controls } from 'sygnal'
function C({ state }) { return <div><button className="go">go</button></div> }
${extra}
export default C
` })

  it('a model built with a spread', async () => {
    expect(await refused(C(`const base = { X: (s) => s }
C.intent = ({ DOM }) => ({ INCREMENT: DOM.click('.go') })
C.model = { ...base, INCREMENT: (s) => s }`), 'src/C.jsx', 'INCREMENT: DOM')).toBe("can't rename INCREMENT: in C, its model is built with a spread or computed keys, so not every use can be found")
  })

  it('next() with a name built at run time', async () => {
    expect(await refused(C(`C.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
C.model = { GO: (s, d, next) => { next(d); return s }, STOP: (s) => s }`), 'src/C.jsx', 'GO: DOM')).toBe("can't rename GO: in C, it calls next() with a name built at run time")
  })

  it('built-ins and undoable()\'s UNDO / REDO', async () => {
    expect(await refused(C(`C.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
C.model = { GO: (s) => s, BOOTSTRAP: (s) => s }`), 'src/C.jsx', 'BOOTSTRAP:')).toBe('BOOTSTRAP is built in: its name is fixed')
    expect(await refused(C(`C.intent = ({ DOM }) => ({ UNDO: DOM.click('.go') })
C.model = undoable({ GO: (s) => s })`), 'src/C.jsx', 'undoable({')).toBe('UNDO is added by undoable(): its name is fixed')
  })

  it('names built from constants', async () => {
    const p = await open(copyFixture(path.join(repo, 'dev-plans/research/p7-spikes/0-S3/fixture')), { init: { initializationOptions: { paths: ['.'] } } })
    expect(refusal(await p.prepare('Edge.jsx', '[ACTIONS.TICK]', { offset: 10 }))).toBe("can't rename TICK: it is built from a constant (TICK at Edge.jsx:15) at Edge.jsx:24; rename the constant's value by hand")
    expect(refusal(await p.prepare('Edge.jsx', 'TICK: (s)'))).toMatch(/^can't rename TICK: it is built from a constant/)
    expect(refusal(await p.prepare('Edge.jsx', 'EVENTS.select(SAVED)', { offset: 15 }))).toMatch(/^can't rename EVENTS 'SAVED': it is built from a constant \(SAVED at names\.js:1\)/)
  })

  it('first-party behavior names and a behavior\'s key', async () => {
    const files = C(`C.uses = { pages: pager({ next: '.go' }) }
C.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
C.model = { GO: (s) => s, 'pages.NEXT': (s) => s }`)
    expect(await refused(files, 'src/C.jsx', "'pages.NEXT'", { offset: 3 })).toBe("pages.NEXT belongs to the first-party behavior 'pages': its names are fixed")
    expect(await refused(files, 'src/C.jsx', 'pages:', { offset: 1 })).toMatch(/^this is the key of a behavior \(uses\.pages\)/)
  })

  it("a user behavior's action when the definition has two hosts", async () => {
    const msg = await refused({
      'src/counter.js': `import { defineBehavior } from 'sygnal'
export const counter = defineBehavior({
  intent: ({ DOM }, opts) => ({ BUMP: DOM.click(opts.button) }),
  model: { BUMP: (s) => s },
})
`,
      'src/A.jsx': `import { counter } from './counter.js'
function A() { return <button className="a">a</button> }
A.uses = { c: counter({ button: '.a' }) }
export default A
`,
      'src/B.jsx': `import { counter } from './counter.js'
function B() { return <button className="b">b</button> }
B.uses = { c: counter({ button: '.b' }) }
export default B
`,
    }, 'src/counter.js', 'BUMP: (s)')
    expect(msg).toMatch(/^can't rename c\.BUMP: the behavior's definition \(src\/counter\.js:3\) is used by 2 hosts or keys/)
  })

  it('controls and component names: TypeScript renames identifiers', async () => {
    const files = C(`const ui = controls({ Add: 'button' })
C.intent = ({ DOM }) => ({ GO: DOM.click(ui.Add) })
C.model = { GO: (s) => s }`)
    files['src/C.jsx'] = files['src/C.jsx'].replace('<button className="go">go</button>', '<ui.Add>go</ui.Add>')
    expect(await refused(files, 'src/C.jsx', 'Add:')).toBe("<Add> is a control (an identifier): rename it with TypeScript's rename")
    expect(await refused(files, 'src/C.jsx', 'function C', { offset: 9 })).toBe("C is a component (an identifier): rename it with TypeScript's rename")
  })

  it('EVENTS: a type built at run time anywhere, Toaster\'s TOAST', async () => {
    expect(await refused({
      'src/E.jsx': `import { event } from 'sygnal'
function E() { return <button className="b">b</button> }
E.intent = ({ DOM, EVENTS }) => ({ A: DOM.click('.b'), B: EVENTS.select(E.kind) })
E.model = { A: { EVENTS: event('SAVED', (s) => s) }, B: (s) => s }
export default E
`,
    }, 'src/E.jsx', "'SAVED'", { offset: 1 })).toBe("can't rename EVENTS 'SAVED': the project has 1 EVENTS select(s) with a type built at run time, and any of them could be 'SAVED'")
    expect(await refused({
      'src/T.jsx': `import { Toaster } from 'sygnal/ui'
function T() { return <div><Toaster /><button className="b">b</button></div> }
T.intent = ({ DOM }) => ({ A: DOM.click('.b') })
T.model = { A: { EVENTS: () => ({ type: 'TOAST', data: 'hi' }) } }
export default T
`,
    }, 'src/T.jsx', "'TOAST'", { offset: 1 })).toBe("EVENTS 'TOAST' is selected by sygnal/ui's Toaster: its name is fixed")
    expect(await refused({
      'src/E.jsx': `import { event } from 'sygnal'
import { more } from 'elsewhere'
function E() { return <button className="b">b</button> }
E.intent = ({ DOM }) => ({ A: DOM.click('.b') })
E.model = { A: { EVENTS: event('SAVED', (s) => s) } }
export default E
`,
      'src/F.jsx': `import { more } from 'elsewhere'
function F() { return <i>f</i> }
F.model = { ...more }
export default F
`,
    }, 'src/E.jsx', "'SAVED'", { offset: 1 })).toBe("can't rename EVENTS 'SAVED': F's model can't be read in full (spreads, computed keys), and it might emit 'SAVED'")
  })

  it('a name that appears elsewhere as a string or property sygnal-check can\'t tie to it', async () => {
    expect(await refused(C(`C.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
C.model = { GO: (s) => s }
export const WIRING = { trigger: 'GO' }`), 'src/C.jsx', 'GO: DOM')).toBe("can't rename GO: 'GO' also appears at src/C.jsx:5 (a string) where sygnal-check can't tell whether it is the same name; rename by hand")
  })

  const D = (view, extra = '') => ({ 'src/D.jsx': `function D({ state }) {
  return ${view}
}
D.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
D.model = { SAVE: (s) => s }
${extra}
export default D
` })

  it('class tokens: dynamic class names, styling only, used in CSS, a module constant, a helper in two views, a behavior option', async () => {
    expect(await refused(D('<button className={"save " + state.kind}>s</button>'), 'src/D.jsx', "'.save'", { offset: 2 }))
      .toBe("can't rename '.save': D's view has dynamic class names, which might produce it")
    expect(await refused(D('<button className="save"><b className="bold">s</b></button>'), 'src/D.jsx', 'bold'))
      .toBe("can't rename '.bold': no intent selects it, so it is only styling or markup; rename it together with your CSS")
    expect(await refused({ ...D('<button className="save">s</button>'), 'src/app.css': '.save { color: red }\n' }, 'src/D.jsx', "'.save'", { offset: 2 }))
      .toBe("can't rename '.save': it is also used in src/app.css:1, which sygnal-check doesn't rename (CSS / markup)")
    const withConst = D('<button className={CLS}>s</button>')
    withConst['src/D.jsx'] = withConst['src/D.jsx'].replace('function D', "const CLS = 'save'\nfunction D")
    expect(await refused(withConst, 'src/D.jsx', "'.save'", { offset: 2 }))
      .toMatch(/^can't rename '\.save': it is written in the module constant CLS/)
    expect(await refused({
      'src/D.jsx': `function btn() { return <button className="save">s</button> }
function D() { return <div>{btn()}</div> }
D.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
D.model = { SAVE: (s) => s }
function E() { return <p>{btn()}</p> }
E.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
E.model = { SAVE: (s) => s }
export { D, E }
`,
    }, 'src/D.jsx', 'save">')).toMatch(/^can't rename '\.save': it is written in a helper rendered in more than one view/)
    expect(await refused({
      'src/D.jsx': `import { pager } from 'sygnal'
function D() { return <button className="go">s</button> }
D.uses = { pages: pager({ next: '.go' }) }
export default D
`,
    }, 'src/D.jsx', "'.go'", { offset: 2 })).toBe("can't rename '.go' here: it is a selector in an option of the behavior 'pages'")
  })

  it('a class used outside the DOM scope; an id also used by a label', async () => {
    expect(await refused({
      ...D('<button className="save">s</button>'),
      'src/F.jsx': 'export default function F() { return <i className="save">f</i> }\nF.initialState = {}\n',
    }, 'src/D.jsx', "'.save'", { offset: 2 })).toMatch(/^can't rename '\.save': it is also used outside this DOM scope \(by F, src\/F\.jsx:1/)
    expect(await refused({
      'src/D.jsx': `function D() { return <div><label htmlFor="name">n</label><input id="name" /></div> }
D.intent = ({ DOM }) => ({ NAME: DOM.input('#name') })
D.model = { NAME: (s) => s }
export default D
`,
    }, 'src/D.jsx', "'#name'", { offset: 2 })).toBe("can't rename '#name': 'name' also appears at src/D.jsx:1 (a string) where sygnal-check can't tell whether it is the same name; rename by hand")
  })

  it('state: read as code, or an initialState sygnal-check can\'t read', async () => {
    expect(await refused({
      'src/L.jsx': `function L({ state }) { return <i>{state.total}</i> }
L.initialState = { total: 0 }
export default L
`,
    }, 'src/L.jsx', 'total: 0')).toBe("can't rename state 'total': 'total' also appears at src/L.jsx:1 (.total) where sygnal-check can't tell whether it is the same name; rename by hand, or with TypeScript's rename where it is typed")
    expect(await refused({
      'src/L.jsx': `import { Collection } from 'sygnal'
import { load } from 'elsewhere'
function Item() { return <li>i</li> }
function L() { return <ul><Collection of={Item} from="rows" /></ul> }
L.initialState = { ...load(), rows: [] }
export default L
`,
    }, 'src/L.jsx', '"rows"', { offset: 1 })).toBe("can't rename 'rows': L's initialState is built in a way sygnal-check can't read")
  })

  it('context: an orphan reader', async () => {
    expect(await refused({
      'src/Child.jsx': 'export default function Child({ context }) { return <i className={context.tone}>c</i> }\n',
      'src/Lone.jsx': 'export default function Lone({ context }) { return <b className={context.tone}>c</b> }\nLone.initialState = {}\n',
      'src/Parent.jsx': `import Child from './Child.jsx'
function Parent() { return <div><Child /></div> }
Parent.context = { tone: () => 'x' }
export default Parent
`,
    }, 'src/Parent.jsx', 'tone:')).toMatch(/^can't rename context 'tone': Lone also reads it \(src\/Lone\.jsx:1\) with no provider sygnal-check can find/)
  })

  it('a file with a syntax error', async () => {
    const p = await project({ 'src/Acts.jsx': ACTS, 'src/Other.jsx': 'export const x = 1\n' })
    p.openDoc('src/Other.jsx', 'export const x = (\n')
    await p.client.settle()
    expect(refusal(await p.prepare('src/Acts.jsx', 'GO: DOM'))).toBe("can't rename while src/Other.jsx has a syntax error: its uses can't be found")
  })
})

const DOM_FILE_2 = `function D({ state }) {
  return <div><button className="save">save</button><span id="count">{state.n}</span></div>
}
D.initialState = { n: 0 }
D.intent = ({ DOM }) => ({ SAVE: DOM.click('.save'), COUNT: DOM.click('#count') })
D.model = { SAVE: (s) => s, COUNT: (s) => s }
export default D
`

describe('new names', () => {
  it('collisions: an existing action of the component, an existing EVENTS type, a used class', async () => {
    const p = await project({ 'src/Acts.jsx': ACTS })
    expect(refusal(await p.rename('src/Acts.jsx', 'GO: DOM', 'STEP'))).toBe("can't rename GO to 'STEP': Acts already has an action STEP")
    expect(refusal(await p.rename('src/Acts.jsx', 'GO: DOM', 'BOOTSTRAP'))).toBe("can't rename GO to 'BOOTSTRAP': BOOTSTRAP is a built-in action")
    const e = await project({
      'src/E.jsx': `import { event } from 'sygnal'
function E() { return <div><button className="a">a</button><button className="b">b</button></div> }
E.intent = ({ DOM, EVENTS }) => ({ A: DOM.click('.a'), B: DOM.click('.b'), C: EVENTS.select('ONE'), D: EVENTS.select('TWO') })
E.model = { A: { EVENTS: event('ONE', (s) => s) }, B: { EVENTS: event('TWO', (s) => s) }, C: (s) => s, D: (s) => s }
export default E
`,
    })
    expect(refusal(await e.rename('src/E.jsx', "'ONE'", 'TWO', { offset: 1 }))).toBe("can't rename EVENTS 'ONE' to 'TWO': EVENTS 'TWO' already exists")
    expect(refusal(await e.rename('src/E.jsx', "'.a'", 'b', { offset: 2 }))).toBe("can't rename '.a' to 'b': '.b' is already used")
  })

  it('invalid names per kind', async () => {
    const p = await project({ 'src/Acts.jsx': ACTS })
    expect(refusal(await p.rename('src/Acts.jsx', 'GO: DOM', 'two words'))).toMatch(/^'two words' isn't a valid action name/)
    expect(refusal(await p.rename('src/Acts.jsx', 'GO: DOM', '1ST'))).toMatch(/^'1ST' isn't a valid action name/)
    expect(refusal(await p.rename('src/Acts.jsx', 'GO: DOM', 'a.b'))).toMatch(/^'a\.b' isn't a valid action name/)
    expect(refusal(await p.rename('src/Acts.jsx', 'GO: DOM', 'GO'))).toBe('the new name is the same as the old one')
    const d = await project({ 'src/D.jsx': DOM_FILE_2 })
    expect(refusal(await d.rename('src/D.jsx', "'#count'", 'two words', { offset: 2 }))).toBe("'two words' isn't a valid CSS id (letters, digits, - and _, not starting with a digit)")
    expect(refusal(await d.rename('src/D.jsx', "'.save'", '9lives', { offset: 2 }))).toBe("'9lives' isn't a valid CSS class name (letters, digits, - and _, not starting with a digit)")
  })

  it('not SCREAMING_SNAKE_CASE: a warning, not a refusal', async () => {
    const dir = tempDir({ 'package.json': '{ "name": "p", "private": true }', 'src/Acts.jsx': ACTS })
    cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }))
    const core = createCore()
    const src = fs.readFileSync(path.join(dir, 'src/Acts.jsx'), 'utf8')
    const lines = src.split('\n')
    const line = lines.findIndex(l => l.startsWith('Acts.intent')) + 1
    const r = core.rename({ folder: dir, sources: new Map(), file: path.join(dir, 'src/Acts.jsx'), line, column: lines[line - 1].indexOf('GO:') + 1, newName: 'startNow' })
    expect(r.edits).toHaveLength(3)
    expect(r.warnings).toContain("'startNow' isn't SCREAMING_SNAKE_CASE (the convention for action names)")
  })
})

describe('test files', () => {
  const files = {
    'src/Acts.jsx': ACTS,
    'src/Acts.test.js': `import { describe, it, expect } from 'vitest'
import Acts from './Acts.jsx'
describe('GO', () => {
  it('GO steps', () => {
    expect(Acts.model.GO).toBeTruthy()
    simulateAction('GO')
    expect('GOING').toBeTruthy()
  })
})
`,
    'src/Other.test.js': `import { it } from 'vitest'
it('unrelated', () => { const x = { GO: 1 }; return 'GO' })
`,
  }

  it('with change annotations: a group needing confirmation (only test files importing the component)', async () => {
    const p = await project(files)
    const r = await p.rename('src/Acts.jsx', 'GO: DOM', 'START')
    expect(p.edited(r.result).filter(e => e.includes('[test]'))).toEqual([
      'src/Acts.test.js:3 GO → START [test]',
      'src/Acts.test.js:5 GO → START [test]',
      'src/Acts.test.js:6 GO → START [test]',
    ])
    expect(r.result.changeAnnotations.test).toMatchObject({ label: 'Test files', needsConfirmation: true })
    const out = p.apply(r.result)['src/Acts.test.js']
    expect(out).toContain("describe('START'")
    expect(out).toContain('Acts.model.START')
    expect(out).toContain("simulateAction('START')")
    expect(out).toContain("'GOING'")
  })

  it('without annotation support: the code only, and a warning (never applied silently)', async () => {
    const p = await project(files, { caps: { textDocument: { rename: { prepareSupport: true } } } })
    const r = await p.rename('src/Acts.jsx', 'GO: DOM', 'START')
    expect(Object.keys(r.result.changes).map(u => path.basename(new URL(u).pathname))).toEqual(['Acts.jsx'])
    expect(p.edited(r.result)).toHaveLength(3)
    await p.client.settle()
    const shown = p.client.messages.filter(m => m.method === 'window/showMessage').map(m => m.params)
    expect(shown).toContainEqual({ type: 2, message: 'Sygnal rename: 3 mention(s) of GO in 1 test file(s) were not renamed (this editor can\'t ask to confirm them): Acts.test.js' })
    expect(shown.some(m => /agent tool/.test(m.message))).toBe(true)
  })

  it('a test file\'s mention doesn\'t block the rename (tests are not in the guard)', async () => {
    const p = await project(files)
    expect((await p.prepare('src/Acts.jsx', "'STEP'", { offset: 1 })).result.placeholder).toBe('STEP')
  })
})

// ---------------------------------------------------------------- the safety test

/**
 * Renames applied to the examples and fixtures leave them with the same findings, modulo the
 * renamed name: each rename's code edits (the WorkspaceEdit without the test group) applied to
 * in-memory copies of the files, then check() before and after.
 */
describe('safety: an applied rename adds no finding', () => {
  const TARGETS = [
    'examples/kanban', 'examples/todomvc', 'examples/ts-example-2048', 'examples/getting-started',
    'examples/advanced-feature-tests', 'examples/ai-panel-spa', 'examples/plan5-showcase', 'examples/ssr',
    'examples/hmr-smoke', 'examples/astro-smoke', 'examples/vike',
    'sygnal-check/test/fixtures/good', 'sygnal-check/test/fixtures/bad', 'dev-plans/research/p7-spikes/0-S3/fixture',
  ]
  const totals = { renames: 0, refused: 0, byKind: {}, teeth: {} }

  for (const target of TARGETS) {
    it(`${target}`, () => {
      const folder = path.join(repo, target)
      const { options } = resolveOptions({ cwd: folder })
      let paths = options.paths
      let { files } = expandInputs(paths, { cwd: folder })
      if (!files.length) { paths = ['.']; files = expandInputs(paths, { cwd: folder }).files }
      const cache = createParseCache()
      const findings = (sources) => check(paths, { cwd: folder, sources, strict: true, cache })
      const norm = (list, from, to) => list.map(d => `${d.file}|${d.line}|${d.code}|${from ? d.message.split(from).join(to) : d.message}`).sort()
      const before = norm(findings())
      const index = buildIndex(buildProject(files, { cwd: folder }))
      // candidates: each action of up to 4 components, and up to 4 names of every other kind
      const seen = new Set()
      const perComp = new Map()
      const perKind = {}
      const picks = []
      for (const o of index.occurrences) {
        const kind = o.ns || (o.role === 'emit' || o.role === 'select' ? 'events' : 'action')
        const key = `${kind}\0${o.name}\0${o.component}`
        if (seen.has(key) || kind === 'control' || kind === 'child') continue
        seen.add(key)
        if (kind === 'action') {
          if (!perComp.has(o.component) && perComp.size >= 4) continue
          perComp.set(o.component, (perComp.get(o.component) || 0) + 1)
        } else if ((perKind[kind] = (perKind[kind] || 0) + 1) > 4) continue
        picks.push({ o, kind })
      }
      const core = createCore()
      let renamed = 0
      for (const { o, kind } of picks) {
        const newName = kind === 'dom' ? `${o.name}Rn` : kind === 'action' || kind === 'events' ? `${o.name.split('.').pop()}_RN` : `${o.name}Rn`
        const plan = core.rename({ folder, settings: { paths }, sources: new Map(), file: o.file, line: o.hit.line, column: o.hit.column, newName })
        if (!plan || plan.refused) { totals.refused++; continue }
        const sources = new Map()
        const byFile = new Map()
        for (const e of plan.edits) {
          if (!byFile.has(e.file)) byFile.set(e.file, [])
          byFile.get(e.file).push({ start: e.start, end: e.end, text: e.newText })
        }
        for (const [file, edits] of byFile) sources.set(file, applyEdits(fs.readFileSync(file, 'utf8'), edits))
        const after = norm(findings(sources), plan.newName, plan.name.split('.').pop())
        expect(after, `${target}: ${kind} ${o.name} → ${plan.newName}`).toEqual(before)
        expect(plan.edits.length).toBeGreaterThan(0)
        // the test has teeth: the same rename with one edit left out changes the findings (for
        // at least one of the edits: the checker doesn't flag every dangling name)
        if (kind === 'action' && plan.edits.length >= 2 && !totals.teeth[target]) {
          const changed = plan.edits.map((skip) => {
            const partial = new Map()
            for (const [file, edits] of byFile) {
              const keep = edits.filter(e => !(file === skip.file && e.start === skip.start))
              partial.set(file, applyEdits(fs.readFileSync(file, 'utf8'), keep))
            }
            return JSON.stringify(norm(findings(partial), plan.newName, plan.name.split('.').pop())) !== JSON.stringify(before)
          })
          expect(changed.some(Boolean), `${target}: ${o.name} with one edit left out`).toBe(true)
          totals.teeth[target] = true
          totals.teethDetected = (totals.teethDetected || 0) + changed.filter(Boolean).length
          totals.teethTried = (totals.teethTried || 0) + changed.length
        }
        renamed++
        totals.renames++
        totals.byKind[kind] = (totals.byKind[kind] || 0) + 1
      }
      if (target.startsWith('examples/') && target !== 'examples/astro-smoke' && target !== 'examples/hmr-smoke') expect(renamed).toBeGreaterThan(0)
    }, 60000)
  }

  it('summary', () => {
    // (vitest runs the cases above first, in order)
    expect(totals.renames).toBeGreaterThan(100)
    console.log(`rename safety: ${totals.renames} renames applied (${JSON.stringify(totals.byKind)}), ${totals.refused} refused, findings identical; one edit left out: ${totals.teethDetected}/${totals.teethTried} detected`)
  })
})

describe('safety through the language server', () => {
  it('kanban: the WorkspaceEdit written to a copy leaves check() unchanged', async () => {
    const dir = copyFixture(path.join(repo, 'examples/kanban'))
    fs.rmSync(path.join(dir, 'node_modules'), { recursive: true, force: true })
    const p = await open(dir)
    const before = check(null, { cwd: dir, strict: true }).map(d => `${d.file}|${d.line}|${d.code}|${d.message}`).sort()
    const r = await p.rename('src/LaneComponent.jsx', 'START_EDIT:', 'BEGIN_EDIT')
    expect(r.result.changeAnnotations?.test).toBeTruthy()
    for (const [rel, text] of Object.entries(p.apply(r.result, { only: [] }))) fs.writeFileSync(path.join(dir, rel), text)
    const after = check(null, { cwd: dir, strict: true }).map(d => `${d.file}|${d.line}|${d.code}|${d.message.split('BEGIN_EDIT').join('START_EDIT')}`).sort()
    expect(after).toEqual(before)
    expect(fs.readFileSync(path.join(dir, 'src/LaneComponent.jsx'), 'utf8')).not.toContain('START_EDIT')
    expect(fs.readFileSync(path.join(dir, 'src/LaneComponent.test.js'), 'utf8')).toContain('START_EDIT') // the test group wasn't applied
  })
})
