// Untrusted data and `__proto__` (sandbox research §6, maintainer-approved): JSON.parse makes a
// "__proto__" key an own data property; copying it with Object.assign({}, data) or `out[k] = data[k]`
// sets the copy's prototype instead (its other properties then read the sender's values).
// Library code copies parsed data with spreads, or skips the key. (persist was already safe: its
// `k in calc` test is true for '__proto__'; the test guards the explicit skip.)
import { describe, it, expect, vi, afterEach } from 'vitest'
import xs from 'xstream'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { persist } from '../src/extra/persist.js'
import { defineCatalog, fromTree } from '../src/extra/ai/index.ts'
import { parsePartialJSON } from '../src/extra/ai/compose/llm.ts'

const EVIL = '{"__proto__": {"polluted": true, "admin": true}, "text": "hi"}'
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const clean = (o) => {
  expect(Object.getPrototypeOf(o)).toBe(Object.prototype)
  expect(o.polluted).toBe(undefined)
  expect(o.admin).toBe(undefined)
  expect({}.polluted).toBe(undefined)
}

afterEach(() => vi.unstubAllGlobals())

describe('fetch driver: a JSON body with "__proto__"', () => {
  it('arrives with the key as own data and an untouched prototype', async () => {
    let push
    const sink$ = xs.create({ start: (l) => { push = (v) => l.next(v) }, stop() {} })
    const fetch = vi.fn(async () => new Response(EVIL, { headers: { 'Content-Type': 'application/json' } }))
    const out = []
    makeFetchDriver({ fetch })(sink$).select().addListener({ next: (v) => out.push(v) })
    push({ category: 'x', url: '/x' })
    await tick(10)
    const body = out[0].value
    clean(body)
    expect(Object.keys(body)).toEqual(['__proto__', 'text'])
    // what a reducer does with it: a spread keeps it data
    clean({ ...body })
  })

  it('headers merge without Headers (an old runtime): a "__proto__" header object is data', () => {
    vi.stubGlobal('Headers', undefined)
    const f = vi.fn(() => new Promise(() => {}))
    let push
    const sink$ = xs.create({ start: (l) => { push = (v) => l.next(v) }, stop() {} })
    makeFetchDriver({ fetch: f, headers: { 'X-App': '1' } })(sink$)
    push({ url: '/y', headers: JSON.parse('{"__proto__": {"polluted": "yes"}, "X-Req": "2"}') })
    const sent = f.mock.calls[0][1].headers
    clean(sent)
    expect(sent['X-Req']).toBe('2')
  })
})

describe('persist: a tampered stored state with "__proto__"', () => {
  it("the RESTORE data a model reads (another tab's write) has no inherited values", async () => {
    let listener
    const store = new Map()
    const storage = {
      getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k),
      subscribe: (fn) => { listener = fn; return () => { listener = null } },
    }
    const seen = []
    function App({ state }) { return h('p', null, state.admin ? 'admin' : 'user') }
    App.initialState = { todos: [], admin: false }
    App.model = { RESTORE: (s, d) => { seen.push(d); return { ...s, ...d, admin: d.admin === true } } }
    App.persist = persist({ key: 'k', omit: ['admin'], storage, sync: true })
    const t = renderComponent(App)
    await t.ready()
    listener('k', `{"version":1,"state":${EVIL.replace('"text": "hi"', '"todos": ["x"]')}}`)
    await t.waitForState((s) => s.todos.length === 1)
    clean(seen[0])
    expect(t.state.admin).toBe(false)
    t.dispose()
  })
})

describe('compose: a model reply with "__proto__" params and slots', () => {
  const C = () => h('div', null)
  const cat = defineCatalog({
    parts: { chart: { component: C, description: 'Chart', params: { range: { options: { month: 'm', year: 'y' }, default: 'year' } } } },
    containers: { tabs: { slots: { one: null, two: null } } },
  })
  it("fromTree keeps the layout's params and slots free of inherited values", () => {
    const reply = JSON.parse(`[
      {"part": "chart", "params": {"__proto__": {"polluted": true, "admin": true}, "range": "month"}},
      {"part": "tabs", "children": {"__proto__": [{"part": "chart"}], "one": [{"part": "chart"}], "two": [{"part": "chart"}]}}
    ]`)
    const layout = fromTree(cat, reply)
    for (const n of Object.values(layout.nodes)) {
      if (n.params) { clean(n.params); expect(n.params.range).toBe('month') }
      if (n.slots) { expect(Object.getPrototypeOf(n.slots)).toBe(Object.prototype); expect(Object.keys(n.slots)).not.toContain('__proto__') }
    }
    expect(Object.values(layout.nodes).filter((n) => n.params)).toHaveLength(1)
  })
  it('the streaming reply parser reads "__proto__" as JSON.parse does: own data', () => {
    for (const text of [EVIL, EVIL.slice(0, -1)]) {   // complete, and cut off mid-stream
      const v = parsePartialJSON(text)
      clean(v)
      expect(Object.keys(v)).toContain('__proto__')
    }
  })
})
