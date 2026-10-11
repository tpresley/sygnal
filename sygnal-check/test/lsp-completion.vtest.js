// PLAN-7 N-2 (P4-1): textDocument/completion through createLspServer() with the in-memory client
// (lsp-helpers.js). Each context on valid text and on mid-edit text (an unterminated string, a
// new key without a colon, an open call, a truncated file), the `.` / `#` filters, no items
// outside Sygnal contexts, the textEdit ranges, multi-file EVENTS, Collection `from`, and the
// model-key snippet only with snippetSupport. `|` marks the cursor.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { startServer, tempDir, copyFixture, uriOf, applyTextEdits, repo } from './lsp-helpers.js'
import { buildProject } from '../src/model/project.js'
import { expandInputs } from '../src/files.js'
import { completionIndex } from '../src/lsp/completionIndex.js'
import { indexState, complete as completeAt } from '../src/lsp/completion.js'

const APP = `import { event, Collection } from 'sygnal'
import Item from './Item.jsx'

export function App({ state }) {
  return (
    <div className="app">
      <button className="add" id="add-btn">Add</button>
      <input className="new-title" id="title" />
      <p title="plain string">hello</p>
      <Collection of={Item} from="items" />
    </div>
  )
}
App.initialState = { items: [], title: '', loading: false }
App.calculated = { count: (state) => state.items.length }
App.intent = ({ DOM, EVENTS }) => ({
  ADD: DOM.click('.add'),
  TYPE: DOM.input('.new-title'),
  REMOVED: EVENTS.select('ITEM_REMOVED'),
})
App.model = {
  ADD: {
    STATE: (state, data, next) => { next('SAVE'); return state },
    HTTP: (state) => ({ url: '/items', ok: 'SAVED', error: 'FAILED' }),
  },
  SAVE: (state) => state,
  SAVED: (state) => state,
  CLEAR: (state) => ({ ...state, items: [] }),
  NOTIFY: { EVENTS: event('APP_NOTICE', (state) => state) },
}
App.timers = (state) => ({ poll: state.loading && { every: 1000, action: 'POLL' } })
`

const ITEM = `import { event } from 'sygnal'

export default function Item({ state }) {
  return <li className="item"><button className="remove">x</button></li>
}
Item.intent = ({ DOM, EVENTS }) => ({
  REMOVE: DOM.click('.remove'),
  NOTICE: EVENTS.select('APP_NOTICE'),
})
Item.model = {
  REMOVE: { EVENTS: event('ITEM_REMOVED', (state) => state.id) },
  NOTICE: (state) => state,
}
`

const PLAIN = `export const greeting = 'hello'
export const handlers = { click: (DOM) => DOM.click('.x') }
`

const cleanup = []
afterEach(() => {
  for (const f of cleanup.splice(0)) {
    try { f() } catch { /* already gone */ }
  }
})

async function setup({ init = {}, files = {} } = {}) {
  const dir = tempDir({ 'package.json': '{ "name": "p", "private": true }', 'src/App.jsx': APP, 'src/Item.jsx': ITEM, 'src/plain.js': PLAIN, ...files })
  const client = startServer()
  cleanup.push(() => client.server.dispose(), () => fs.rmSync(dir, { recursive: true, force: true }))
  await client.initialize({ rootUri: uriOf(dir), ...init })
  const file = (rel) => path.join(dir, 'src', rel)
  for (const f of ['App.jsx', 'Item.jsx', 'plain.js']) client.open(file(f))
  await client.settle()
  return { dir, client, file }
}

/**
 * Change `abs` to `marked` (the cursor at `|`) and ask for completions there; without `settle`
 * the request arrives before the check of the new text (the index is the last check's).
 */
async function complete(client, abs, marked, { settle = false } = {}) {
  const offset = marked.indexOf('|')
  const text = marked.slice(0, offset) + marked.slice(offset + 1)
  client.change(abs, text)
  if (settle) await client.settle()
  const before = text.slice(0, offset).split('\n')
  const position = { line: before.length - 1, character: before[before.length - 1].length }
  const list = await client.request('textDocument/completion', { textDocument: { uri: uriOf(abs) }, position })
  const labels = list ? list.items.map(i => i.label) : null
  return { list, labels, text, offset, position, item: (l) => list?.items.find(i => i.label === l) }
}

const edit = (text, a, b) => {
  if (!text.includes(a)) throw new Error(`not in the text: ${a}`)
  return text.replace(a, b)
}

describe('capabilities', () => {
  it('completionProvider with the trigger characters', async () => {
    const dir = tempDir({ 'package.json': '{}' })
    const client = startServer()
    cleanup.push(() => client.server.dispose(), () => fs.rmSync(dir, { recursive: true, force: true }))
    const r = await client.initialize({ rootUri: uriOf(dir) })
    expect(r.capabilities.completionProvider).toEqual({ triggerCharacters: ["'", '"', '`', '.', '#'], resolveProvider: false })
  })
})

describe('DOM selectors', () => {
  it("DOM.click('.|') offers the view's classes; '#' its ids; a bare word both", async () => {
    const { client, file } = await setup()
    const dot = await complete(client, file('App.jsx'), edit(APP, "DOM.click('.add')", "DOM.click('.|')"))
    expect(dot.labels).toEqual(['.app', '.add', '.new-title'])
    expect(dot.item('.add')).toMatchObject({ kind: 7, detail: "class in App's view", filterText: '.add', sortText: '0.add' })
    const hash = await complete(client, file('App.jsx'), edit(APP, "DOM.click('.add')", "DOM.click('#|')"))
    expect(hash.labels).toEqual(['#add-btn', '#title'])
    expect(hash.item('#title').detail).toBe("id in App's view")
    const bare = await complete(client, file('App.jsx'), edit(APP, "DOM.click('.add')", "DOM.click('|')"))
    expect(bare.labels).toEqual(['.app', '.add', '.new-title', '#add-btn', '#title'])
  })

  it('the textEdit replaces the class token at the cursor (with its dot), not the whole selector', async () => {
    const { client, file } = await setup()
    const r = await complete(client, file('App.jsx'), edit(APP, "DOM.input('.new-title')", "DOM.input('.app .ne|w-title')"))
    const e = r.item('.new-title').textEdit
    const col = r.position.character
    expect(e.range).toEqual({ start: { line: r.position.line, character: col - 3 }, end: { line: r.position.line, character: col + 7 } })
    expect(applyTextEdits(r.text, [e])).toContain("DOM.input('.app .new-title')")
  })

  it('DOM.select(…) and a chained select; the component of the intent decides the classes', async () => {
    const { client, file } = await setup()
    const r = await complete(client, file('Item.jsx'), edit(ITEM, "DOM.click('.remove')", "DOM.select('.|').events('click')"))
    expect(r.labels).toEqual(['.item', '.remove'])
  })

  it("mid-edit: an unterminated string DOM.click('.  (repair), an open call on a new entry", async () => {
    const { client, file } = await setup()
    const r = await complete(client, file('App.jsx'), edit(APP, "  ADD: DOM.click('.add'),", "  ADD: DOM.click('.|"))
    expect(r.labels).toEqual(['.app', '.add', '.new-title'])
    expect(r.item('.add').textEdit.range).toEqual({ start: { line: r.position.line, character: r.position.character - 1 }, end: r.position })
    const open = await complete(client, file('App.jsx'), edit(APP, '  ADD: DOM', "  X: DOM.click('#|\n  ADD: DOM"))
    expect(open.labels).toEqual(['#add-btn', '#title'])
  })

  it('mid-edit after the check of the broken text ran (the index holds the last good text)', async () => {
    const { client, file } = await setup()
    const r = await complete(client, file('App.jsx'), edit(APP, "  ADD: DOM.click('.add'),", "  ADD: DOM.click('.a|"), { settle: true })
    expect(r.labels).toEqual(['.app', '.add', '.new-title'])
  })
})

describe('EVENTS', () => {
  it("EVENTS.select('|') offers the types emitted anywhere in the project (multi-file)", async () => {
    const { client, file } = await setup()
    const r = await complete(client, file('App.jsx'), edit(APP, "EVENTS.select('ITEM_REMOVED')", "EVENTS.select('|')"))
    expect(r.labels.sort()).toEqual(['APP_NOTICE', 'ITEM_REMOVED'])
    expect(r.item('ITEM_REMOVED')).toMatchObject({ kind: 23, detail: 'EVENTS type emitted in Item.jsx' })
    expect(r.item('APP_NOTICE').detail).toBe('EVENTS type emitted in App.jsx')
  })

  it("event('|') in a model offers the types selected anywhere, so emitters match listeners", async () => {
    const { client, file } = await setup()
    const r = await complete(client, file('Item.jsx'), edit(ITEM, "event('ITEM_REMOVED'", "event('IT|EM_REMOVED'"))
    expect(r.labels.sort()).toEqual(['APP_NOTICE', 'ITEM_REMOVED'])
    expect(r.item('ITEM_REMOVED')).toMatchObject({ detail: 'EVENTS type selected in App.jsx' })
    // the whole string contents are replaced
    const e = r.item('APP_NOTICE').textEdit
    expect(applyTextEdits(r.text, [e])).toContain("event('APP_NOTICE', (state) => state.id)")
  })

  it('mid-edit: an unterminated EVENTS.select string', async () => {
    const { client, file } = await setup()
    const r = await complete(client, file('Item.jsx'), edit(ITEM, "  NOTICE: EVENTS.select('APP_NOTICE'),", "  NOTICE: EVENTS.select('AP|"))
    expect(r.labels.sort()).toEqual(['APP_NOTICE', 'ITEM_REMOVED'])
  })
})

describe('model keys and intent keys', () => {
  it('a model key offers triggered actions without a model entry first, then the lifecycle actions', async () => {
    const { client, file } = await setup()
    const r = await complete(client, file('App.jsx'), edit(APP, '  SAVE: (state) => state,', '  |\n  SAVE: (state) => state,'))
    expect(r.labels).toEqual(['TYPE', 'REMOVED', 'FAILED', 'POLL', 'BOOTSTRAP', 'INITIALIZE', 'DISPOSE'])
    expect(r.item('TYPE')).toMatchObject({ kind: 20, detail: 'intent action · App (no model entry)', sortText: '0TYPE' })
    expect(r.item('FAILED').detail).toBe('reply action · App (no model entry)')
    expect(r.item('POLL').detail).toBe('timer action · App (no model entry)')
    expect(r.item('BOOTSTRAP')).toMatchObject({ detail: 'built-in action', sortText: '2BOOTSTRAP' })
    expect(r.item('TYPE').textEdit).toEqual({ range: { start: r.position, end: r.position }, newText: 'TYPE' })
    expect(r.item('TYPE').insertTextFormat).toBeUndefined()
  })

  it('mid-edit: a new model key without a colon; the textEdit replaces what was typed', async () => {
    const { client, file } = await setup()
    const r = await complete(client, file('App.jsx'), edit(APP, '  SAVE: (state) => state,', '  TY|\n  SAVE: (state) => state,'))
    expect(r.labels).toContain('TYPE')
    const e = r.item('TYPE').textEdit
    expect(e.range).toEqual({ start: { line: r.position.line, character: 2 }, end: r.position })
  })

  it('no items for a key of a nested object (a sink object) or a value', async () => {
    const { client, file } = await setup()
    const nested = await complete(client, file('App.jsx'), edit(APP, '    HTTP: (state)', '    HT|TP: (state)'))
    expect(nested.labels).toBeNull()
    const value = await complete(client, file('App.jsx'), edit(APP, '  SAVE: (state) => state,', '  SAVE: (state) => sta|te,'))
    expect(value.labels).toBeNull()
  })

  it('an intent key offers the model actions nothing triggers yet', async () => {
    const { client, file } = await setup()
    const r = await complete(client, file('App.jsx'), edit(APP, "  ADD: DOM.click('.add'),", "  ADD: DOM.click('.add'),\n  |"))
    expect(r.labels).toEqual(['CLEAR', 'NOTIFY'])
    expect(r.item('CLEAR').detail).toBe('model action · App (no trigger)')
    const typing = await complete(client, file('App.jsx'), edit(APP, '  TYPE: DOM', '  CL|\n  TYPE: DOM'))
    expect(typing.labels).toEqual(['CLEAR', 'NOTIFY'])
  })

  it('the handler snippet only with snippetSupport and only for a fresh key', async () => {
    const withSnippets = await setup({ init: { capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true } } } } } })
    const r = await complete(withSnippets.client, withSnippets.file('App.jsx'), edit(APP, '  SAVE: (state) => state,', '  TY|\n  SAVE: (state) => state,'))
    expect(r.item('TYPE')).toMatchObject({ insertTextFormat: 2, textEdit: { newText: 'TYPE: (state, data) => ({ ...state$0 }),' } })
    const existing = await complete(withSnippets.client, withSnippets.file('App.jsx'), edit(APP, '  CLEAR: (state)', '  CLE|AR: (state)'))
    expect(existing.labels).toContain('TYPE')
    expect(existing.item('TYPE').insertTextFormat).toBeUndefined()
    expect(existing.item('TYPE').textEdit.newText).toBe('TYPE')
    // an intent key never gets the model snippet
    const intent = await complete(withSnippets.client, withSnippets.file('App.jsx'), edit(APP, '  TYPE: DOM', '  CL|\n  TYPE: DOM'))
    expect(intent.item('CLEAR').insertTextFormat).toBeUndefined()
  })
})

describe('action names in strings', () => {
  it("next('|'), reply values (ok/error) and a timers spec's action offer the model's actions", async () => {
    const { client, file } = await setup()
    const entries = ['ADD', 'SAVE', 'SAVED', 'CLEAR', 'NOTIFY']
    const next = await complete(client, file('App.jsx'), edit(APP, "next('SAVE')", "next('|')"))
    expect(next.labels).toEqual(entries)
    expect(next.item('SAVE')).toMatchObject({ kind: 20, detail: 'model action · App' })
    const ok = await complete(client, file('App.jsx'), edit(APP, "ok: 'SAVED'", "ok: 'SA|VED'"))
    expect(ok.labels).toEqual(entries)
    expect(applyTextEdits(ok.text, [ok.item('CLEAR').textEdit])).toContain("ok: 'CLEAR', error")
    const timer = await complete(client, file('App.jsx'), edit(APP, "action: 'POLL'", "action: '|'"))
    expect(timer.labels).toEqual(entries)
  })

  it('mid-edit: an unterminated next( and reply value', async () => {
    const { client, file } = await setup()
    const next = await complete(client, file('App.jsx'), edit(APP, "next('SAVE'); return state", "next('S|"))
    expect(next.labels).toContain('SAVED')
    const err = await complete(client, file('App.jsx'), edit(APP, "error: 'FAILED' }),", "error: 'F|"))
    expect(err.labels).toContain('SAVE')
  })

  it("a key that names no action (url: '…') gets nothing", async () => {
    const { client, file } = await setup()
    const r = await complete(client, file('App.jsx'), edit(APP, "url: '/items'", "url: '/it|ems'"))
    expect(r.labels).toBeNull()
  })
})

describe('Collection from', () => {
  it('from="|" and from={\'|\'} offer initialState and calculated keys', async () => {
    const { client, file } = await setup()
    const r = await complete(client, file('App.jsx'), edit(APP, 'from="items"', 'from="it|ems"'))
    expect(r.labels).toEqual(['items', 'title', 'loading', 'count'])
    expect(r.item('items')).toMatchObject({ kind: 5, detail: 'initialState key · App' })
    expect(r.item('count').detail).toBe('calculated key · App')
    expect(r.item('title').textEdit.range).toEqual({ start: { line: r.position.line, character: r.position.character - 2 }, end: { line: r.position.line, character: r.position.character + 3 } })
    const braces = await complete(client, file('App.jsx'), edit(APP, 'from="items"', "from={'|'}"))
    expect(braces.labels).toEqual(['items', 'title', 'loading', 'count'])
  })

  it('mid-edit: an unterminated from="', async () => {
    const { client, file } = await setup()
    const r = await complete(client, file('App.jsx'), edit(APP, 'from="items" />', 'from="|'))
    expect(r.labels).toEqual(['items', 'title', 'loading', 'count'])
  })
})

describe('outside Sygnal contexts', () => {
  it('a plain string in a view, a JS file without components, outside any component: null', async () => {
    const { client, file } = await setup()
    expect((await complete(client, file('App.jsx'), edit(APP, 'title="plain string"', 'title="pl|ain string"'))).list).toBeNull()
    expect((await complete(client, file('plain.js'), edit(PLAIN, "DOM.click('.x')", "DOM.click('.|')"))).list).toBeNull()
    expect((await complete(client, file('plain.js'), edit(PLAIN, "'hello'", "'he|llo'"))).list).toBeNull()
    expect((await complete(client, file('App.jsx'), edit(APP, "import Item from './Item.jsx'", "import Item from './|Item.jsx'"))).list).toBeNull()
    expect((await complete(client, file('App.jsx'), edit(APP, "App.initialState = { items: []", "App.initialState = { items: [], |"))).list).toBeNull()
  })

  it('a document of a folder without components or before any check: null', async () => {
    const dir = tempDir({ 'package.json': '{}', 'src/x.js': "const a = { b: 1 }\n" })
    const client = startServer()
    cleanup.push(() => client.server.dispose(), () => fs.rmSync(dir, { recursive: true, force: true }))
    await client.initialize({ rootUri: uriOf(dir) })
    const abs = path.join(dir, 'src/x.js')
    client.open(abs)
    await client.settle()
    expect((await complete(client, abs, 'const a = { b: 1, | }\n')).list).toBeNull()
    expect(await client.request('textDocument/completion', { textDocument: { uri: 'file:///elsewhere/y.js' }, position: { line: 0, character: 0 } })).toBeNull()
  })
})

describe('truncated files', () => {
  it('everything after the cursor gone: the line prefix with the last good index', async () => {
    const { client, file } = await setup()
    const cut = (marker, typed = '') => {
      const i = APP.indexOf(marker)
      if (i < 0) throw new Error(`not in the text: ${marker}`)
      return APP.slice(0, i + marker.length) + typed + '|'
    }
    const sel = await complete(client, file('App.jsx'), cut("  ADD: DOM.click('."))
    expect(sel.labels).toEqual(['.app', '.add', '.new-title'])
    const key = await complete(client, file('App.jsx'), cut('  SAVED: (state) => state,\n', '  T'))
    expect(key.labels).toContain('TYPE')
    const from = await complete(client, file('App.jsx'), cut('<Collection of={Item} from="'))
    expect(from.labels).toEqual(['items', 'title', 'loading', 'count'])
  })
})

describe('the 0-S3 edge fixture', () => {
  it('undoable() model, agent and timers triggers, decide() replies', async () => {
    const dir = copyFixture(path.join(repo, 'dev-plans/research/p7-spikes/0-S3/fixture'))
    fs.writeFileSync(path.join(dir, 'sygnal-check.config.json'), JSON.stringify({ paths: ['.'] }))
    const client = startServer()
    cleanup.push(() => client.server.dispose(), () => fs.rmSync(dir, { recursive: true, force: true }))
    await client.initialize({ rootUri: uriOf(dir) })
    const abs = path.join(dir, 'Edge.jsx')
    const text = fs.readFileSync(abs, 'utf8')
    client.open(abs, text)
    await client.settle()
    const key = await complete(client, abs, edit(text, '  LOADED: (s) => s,', '  |\n  LOADED: (s) => s,'))
    // POLL (timers) and TRIAGED (decide) have no entry; the undoable model's own keys are found
    expect(key.labels).toEqual(expect.arrayContaining(['POLL', 'TRIAGED', 'EXTERNAL']))
    expect(key.labels).not.toContain('SAVE')
    const sel = await complete(client, abs, edit(text, "DOM.click('#count')", "DOM.click('#|')"))
    expect(sel.labels).toEqual(['#count'])
  })
})

// 0-S3's recovery experiment (dev-plans/research/p7-spikes/0-S3/recovery.mjs) re-run on the real
// chain: every completion site of three examples, with the edits a user makes while typing there,
// answered by complete() from the index of the unedited project. A hit: the expected context, in
// its component's region, offering the site's original name when the model knows it (key-colon:
// a value position, nothing offered). Measured 2026-10-10: 1,270 edits, 100 %.
describe('mid-edit hit rate over the examples (0-S3 §3)', () => {
  const OPS = {
    'intent-key': ['key-typing', 'key-colon', 'open-call', 'truncate'],
    'model-key': ['key-typing', 'key-colon', 'truncate'],
    string: ['autoclosed', 'unterminated', 'truncate'],
  }
  function sitesOf(project) {
    const sites = []
    for (const c of project.components) {
      if (!c.intent?.fn || !c.model?.entries.length) continue
      const push = (kind, file, node, ops, expect, label = null) => { if (node && file === c.file) sites.push({ file: file.path, node, kind, ops, expect, label }) }
      for (const a of c.intent.actions) push('intent-key', c.intent.file, a.node, OPS['intent-key'], 'key')
      for (const e of c.model.entries) if (e.node.type !== 'Identifier' || e.node.name !== 'undoable') push('model-key', e.file, e.node, OPS['model-key'], 'key')
      const classes = c.viewInfo?.classes.names || new Set()
      const ids = c.viewInfo?.ids.names || new Set()
      for (const sel of c.intent.selectors) {
        if (sel.node.type !== 'StringLiteral') continue
        const tok = /^[.#][\w-]+/.exec(sel.node.value)?.[0]
        const known = tok && (tok[0] === '.' ? classes : ids).has(tok.slice(1))
        push('selector', c.intent.file, sel.node, OPS.string, 'selector', known ? tok : null)
      }
      const entries = new Set(c.model.entries.map(e => e.action))
      for (const t of c.model.nextTargets) push('next', t.file, t.node, OPS.string, 'next', entries.has(t.name) ? t.name : null)
      for (const t of c.model.replyTargets) if (t.node.type === 'StringLiteral') push('reply', t.file, t.node, OPS.string, 'value', entries.has(t.name) ? t.name : null)
      const keys = new Set([...(c.initialState?.keys.keys() || []), ...c.calculatedKeys])
      for (const col of c.viewInfo?.collections || []) {
        const v = col.fromNode?.value
        if (v?.type === 'StringLiteral') push('from', c.file, v, OPS.string, 'from', keys.has(v.value) ? v.value : null)
      }
    }
    return sites
  }
  function applyEdit(src, { node: { start, end, type } }, op) {
    const indent = src.slice(src.lastIndexOf('\n', start - 1) + 1, start).match(/^\s*/)[0]
    const insert = (ins) => ({ text: src.slice(0, start) + ins + '\n' + indent + src.slice(start), cursor: start + ins.length })
    switch (op) {
      case 'autoclosed': return { text: src.slice(0, start + 1) + src.slice(end - 1), cursor: start + 1 }
      case 'unterminated': { const mid = start + 1 + Math.floor((end - start - 2) / 2); return { text: src.slice(0, mid) + src.slice(end), cursor: mid } }
      case 'key-typing': return insert('NE')
      case 'key-colon': return insert('NEW: ')
      case 'open-call': return insert("X: DOM.click('")
      case 'truncate': { const cur = type === 'StringLiteral' ? start + 1 : end; return { text: src.slice(0, cur), cursor: cur } }
    }
  }

  it('>= 99 % of the edits get the right context and names', () => {
    let n = 0
    const misses = []
    for (const ex of ['kanban', 'ai-panel-spa', 'plan5-showcase']) {
      const dir = path.join(repo, 'examples', ex, 'src')
      const project = buildProject(expandInputs([dir], { cwd: dir }).files, { cwd: dir })
      const sources = new Map([...project.files.values()].filter(Boolean).map(f => [f.path, f.source]))
      const state = indexState(completionIndex(project), sources)
      for (const site of sitesOf(project)) {
        for (const op of site.ops) {
          const { text, cursor } = applyEdit(sources.get(site.file), site, op)
          const r = completeAt({ text, offset: cursor, file: site.file, state })
          const labels = r?.items.map(i => i.label) || []
          const hit = op === 'key-colon' ? !labels.length
            : op === 'open-call' ? r?.context === 'selector' && r.matched
            : r?.context === site.expect && r.matched && (!site.label || labels.includes(site.label))
          n++
          if (!hit) misses.push(`${ex} ${site.kind}/${op} at ${path.basename(site.file)}:${cursor}: ${r ? `${r.strategy} ${r.context} matched=${r.matched}` : 'no region'}`)
        }
      }
    }
    expect(n).toBeGreaterThan(1000)
    expect(misses.length / n, misses.join('\n')).toBeLessThanOrEqual(0.01)
  })
})
