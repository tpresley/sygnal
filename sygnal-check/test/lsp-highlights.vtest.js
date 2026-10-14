// Highlights (highlights.js): textDocument/semanticTokens/full and sygnal/highlights (action
// names, EVENTS types, intent selectors, the view tokens they target, selected child components),
// the provider opt-out, the refreshes and the sygnal.highlights setting, through createLspServer()
// with the in-memory client (lsp-helpers.js).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { startServer, tempDir, uriOf } from './lsp-helpers.js'
import { LEGEND, encode } from '../src/lsp/highlights.js'

const cleanup = []
afterEach(() => {
  for (const f of cleanup.splice(0)) {
    try { f() } catch { /* already gone */ }
  }
})

async function open(dir, { init = {}, onRequest } = {}) {
  const client = startServer({ onRequest })
  cleanup.push(() => client.server.dispose(), () => fs.rmSync(dir, { recursive: true, force: true }))
  const result = await client.initialize({ workspaceFolders: [{ uri: uriOf(dir), name: 'p' }], ...init })
  const file = (rel) => path.join(dir, rel)
  const textDocument = (rel) => ({ textDocument: { uri: uriOf(file(rel)) } })
  /** Each decoded token as `text:type[modifiers]` (type without the `sygnal` prefix). */
  const tokens = async (rel, { text } = {}) => {
    const list = await client.request('sygnal/highlights', textDocument(rel))
    if (list === null) return null
    const lines = (text ?? fs.readFileSync(file(rel), 'utf8')).split('\n')
    return list.map(t => `${lines[t.line].slice(t.character, t.character + t.length)}:${t.type.slice(6)}${t.modifiers.length ? `[${t.modifiers.join(',')}]` : ''}`)
  }
  const full = (rel) => client.request('textDocument/semanticTokens/full', textDocument(rel))
  const count = (method) => client.serverRequests.filter(m => m.method === method).length
    + client.messages.filter(m => m.method === method && !('id' in m)).length
  return { dir, client, result, file, tokens, full, count }
}

const project = (files, opts) => open(tempDir({ 'package.json': '{ "name": "p", "private": true }', ...files }), opts)

const LIST = `import { Collection, event } from 'sygnal'
import Item from './Item.jsx'

function List({ state }) {
  return (
    <div>
      <button className="add">add</button>
      <span className="plain">x</span>
      <Collection of={Item} from="items" />
    </div>
  )
}
List.initialState = { items: [] }
List.intent = ({ DOM, CHILD, EVENTS }) => ({
  ADD: DOM.click('.add'),
  GONE: DOM.click('.nowhere'),
  REMOVE: CHILD.select(Item),
  HEARD: EVENTS.select('PING'),
})
List.model = {
  ADD: { EVENTS: event('PING', (s) => s) },
  REMOVE: (s) => s,
  HEARD: (s) => s,
}
export default List
`
const ITEM = `function Item({ state }) {
  return <li className={'item ' + state.kind}><button className="del">x</button></li>
}
Item.intent = ({ DOM }) => ({ DEL: DOM.click('.del'), MAYBE: DOM.click('.maybe') })
Item.model = { DEL: { PARENT: (s) => s.id }, MAYBE: (s) => s }
export default Item
`
const FILES = { 'src/List.jsx': LIST, 'src/Item.jsx': ITEM }

describe('tokens', () => {
  it('actions, EVENTS types, selectors, their targets and the selected child', async () => {
    const p = await project(FILES)
    expect(await p.tokens('src/List.jsx')).toEqual([
      'add:Target[declaration]', // targeted by '.add'; .plain (selected by nothing) has no token
      'Item:Child', // <Collection of={Item}>: List selects Item
      'ADD:Action[trigger]', 'add:Selector',
      'GONE:Action[trigger,unhandled]', 'nowhere:Selector[untargeted]', // List's view has no dynamic classes
      'REMOVE:Action[trigger]', 'Item:Child',
      'HEARD:Action[trigger]', 'PING:Event',
      'ADD:Action[handler,declaration]', 'PING:Event[declaration]',
      'REMOVE:Action[handler,declaration]',
      'HEARD:Action[handler,declaration]',
    ])
    expect(await p.tokens('src/Item.jsx')).toEqual([
      'Item:Child[declaration]', // its name: a parent selects it
      'del:Target[declaration]',
      'DEL:Action[trigger]', 'del:Selector',
      'MAYBE:Action[trigger]', 'maybe:Selector[unverified]', // 'item ' + state.kind might be .maybe
      'DEL:Action[handler,declaration]', 'MAYBE:Action[handler,declaration]',
    ])
  })

  it('a component no parent selects: no Child token for its name', async () => {
    const p = await project({ 'src/C.jsx': `function C() { return <i className="c">c</i> }
C.intent = ({ DOM }) => ({ GO: DOM.click('.c') })
C.model = { GO: (s) => s }
export default C
` })
    expect(await p.tokens('src/C.jsx')).toEqual(['c:Target[declaration]', 'GO:Action[trigger]', 'c:Selector', 'GO:Action[handler,declaration]'])
  })

  it('semanticTokens/full is the same tokens in the LSP encoding, with the legend in the capabilities', async () => {
    const p = await project(FILES)
    expect(p.result.capabilities.semanticTokensProvider).toEqual({ legend: LEGEND, full: true })
    const decoded = await p.client.request('sygnal/highlights', { textDocument: { uri: uriOf(p.file('src/List.jsx')) } })
    expect((await p.full('src/List.jsx')).data).toEqual(encode(decoded))
  })

  it('encode: relative lines and characters, the type index and a modifier bit set', () => {
    expect(encode([
      { line: 1, character: 4, length: 3, type: 'sygnalAction', modifiers: ['trigger'] },
      { line: 1, character: 10, length: 2, type: 'sygnalSelector', modifiers: [] },
      { line: 3, character: 2, length: 5, type: 'sygnalAction', modifiers: ['handler', 'declaration'] },
    ])).toEqual([1, 4, 3, 0, 4, 0, 6, 2, 2, 0, 2, 2, 5, 0, 3])
  })

  it('null for a file outside any project; the tokens of the edited text after a check', async () => {
    const p = await project(FILES)
    expect(await p.client.request('sygnal/highlights', { textDocument: { uri: 'file:///nowhere/x.jsx' } })).toBe(null)
    const text = LIST.replace("GONE: DOM.click('.nowhere'),", "GONE: DOM.click('.plain'),")
    p.client.open(p.file('src/List.jsx'), text)
    await p.client.settle()
    const list = await p.tokens('src/List.jsx', { text })
    expect(list).toContain('plain:Target[declaration]')
    expect(list).toContain('plain:Selector')
  })
})

describe('clients that draw the highlights themselves', () => {
  it('initializationOptions.semanticTokens: false → no provider; sygnal/highlights still answers', async () => {
    const p = await project(FILES, { init: { initializationOptions: { semanticTokens: false } } })
    expect(p.result.capabilities.semanticTokensProvider).toBeUndefined()
    expect(await p.tokens('src/Item.jsx')).toContain('del:Target[declaration]')
  })
})

describe('refresh', () => {
  const C = `function C() { return <i className="c">c</i> }
C.intent = ({ DOM }) => ({ GO: DOM.click('.c') })
C.model = { GO: (s) => s }
export default C
`
  const changed = C.replace("DOM.click('.c')", "DOM.click('.d')")
  const caps = { workspace: { semanticTokens: { refreshSupport: true } } }

  it('workspace/semanticTokens/refresh after a check that changed the highlights; none for an edit that changes none', async () => {
    const p = await project({ 'src/C.jsx': C }, { init: { capabilities: caps } })
    p.client.open(p.file('src/C.jsx'), C)
    await p.client.settle()
    p.client.change(p.file('src/C.jsx'), C + '// a comment\n')
    await p.client.settle()
    expect(p.count('workspace/semanticTokens/refresh')).toBe(0)
    p.client.change(p.file('src/C.jsx'), changed, 3)
    await p.client.settle()
    expect(p.count('workspace/semanticTokens/refresh')).toBe(1)
    expect(p.count('sygnal/highlightsChanged')).toBe(0) // not asked for
  })

  it('never without refreshSupport, nor without the provider; sygnal/highlightsChanged when asked for (the first check too)', async () => {
    const p = await project({ 'src/C.jsx': C }, { init: { capabilities: caps, initializationOptions: { semanticTokens: false, highlightsChanged: true } } })
    expect(p.count('sygnal/highlightsChanged')).toBe(1)
    p.client.open(p.file('src/C.jsx'), changed)
    await p.client.settle()
    expect(p.count('workspace/semanticTokens/refresh')).toBe(0)
    expect(p.count('sygnal/highlightsChanged')).toBe(2)
  })
})

describe('the sygnal.highlights setting', () => {
  it('false: empty tokens; per folder from workspace/configuration (it wins), and turning it off refreshes', async () => {
    let value = true
    const p = await project(FILES, {
      init: { initializationOptions: { highlights: false }, capabilities: { workspace: { configuration: true, semanticTokens: { refreshSupport: true } } } },
      onRequest: (m, params) => m === 'workspace/configuration' ? params.items.map(() => ({ highlights: value })) : null,
    })
    expect(await p.tokens('src/Item.jsx')).not.toEqual([])
    value = false
    p.client.notify('workspace/didChangeConfiguration', { settings: {} })
    await p.client.waitFor(() => p.count('workspace/semanticTokens/refresh') === 1)
    expect(await p.tokens('src/Item.jsx')).toEqual([])
    expect((await p.full('src/Item.jsx')).data).toEqual([])
  })

  it('a non-boolean value is ignored with a warning', async () => {
    const p = await project(FILES, { init: { initializationOptions: { highlights: 'yes' } } })
    expect(await p.tokens('src/Item.jsx')).not.toEqual([])
    expect(p.client.messages.some(m => m.method === 'window/logMessage' && /sygnal\.highlights must be a boolean/.test(m.params.message))).toBe(true)
  })
})
