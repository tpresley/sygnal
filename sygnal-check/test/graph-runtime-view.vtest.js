// PLAN-10 V-3 (D520): runtime graphs on the graph page, in Node: runtime.js's fromRuntime() grouping,
// the runtime health, the detail HTML, and the page with runtime.js inlined. The fixture is a real
// runtime inspect() graph (test/p10-runtime-view.test.js at the repo root writes it).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { fromRuntime, runtimeHealth, rtCardSub, rtTime, rtStateText, rtDetailHtml } from '../src/graphView/runtime.js'
import * as runtimeExports from '../src/graphView/runtime.js'
import { buildModel, healthList } from '../src/graphView/model.js'
import { layoutGraph } from '../src/graphView/layout.js'
import { graphHtml, inlineModule } from '../src/graphView/html.js'
import { validate } from '../src/schema.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const shop = () => JSON.parse(fs.readFileSync(path.join(here, 'fixtures/graph-runtime/shop.runtime.json'), 'utf8'))
const schema = JSON.parse(fs.readFileSync(path.join(here, '../schema/inspect.schema.json'), 'utf8'))

/** a runtime instance entry, every list empty unless given */
const inst = (name, id, parentId, extra = {}) => ({
  name, id: String(id), parentId: parentId == null ? null : String(parentId), kind: parentId == null ? 'root' : 'child',
  actions: [], stateKeys: [], calculated: [], contextProvides: [], contextConsumes: [], eventsEmitted: [], eventsSelected: [],
  children: [], selectors: [], diagnostics: [], ...(parentId == null ? { entry: true } : {}), ...extra,
})
const RT = (components, events = {}, extra = {}) => ({ version: 1, source: 'runtime', components, events, diagnostics: [], ...extra })
const byName = (g, name) => g.components.find(c => c.name === name)

describe('fromRuntime: one card per (parent card, name), ×N', () => {
  it('the fixture: a valid runtime graph becomes 7 cards for 8 instances', () => {
    const raw = shop()
    expect(validate(schema, raw)).toEqual([])
    const g = fromRuntime(raw)
    expect(g.components.map(c => [c.id, c.rt.count]).sort()).toEqual([
      ['rt:App', 1], ['rt:App>Badge', 1], ['rt:App>Cart', 1], ['rt:App>Cart>Line', 2], ['rt:App>Header', 1], ['rt:App>Shop', 1], ['rt:Widget', 1],
    ])
    expect(g.components.every(c => c.key === c.id && c.file === null)).toBe(true)
    expect(Object.keys(g.rtCardOf).sort()).toEqual(raw.components.map(c => c.id).sort())
    expect(byName(g, 'Shop').shown).toBe(false)
    expect(byName(g, 'Badge').viewOnly).toBe(true)
    expect(byName(g, 'Cart').children).toEqual([{ name: 'Line', via: 'collection', id: 'rt:App>Cart>Line', count: 2 }])
    expect(byName(g, 'App').dir).toBe('app 1 · App')
    expect(byName(g, 'Line').dir).toBe('app 1 · App')
    expect(byName(g, 'Widget').dir).toBe('app 2 · Widget')
    // the raw graph is untouched
    expect(raw.components).toHaveLength(8)
  })

  it('same name under different parents is two cards; repeated tags under one parent are one', () => {
    const g = fromRuntime(RT([
      inst('App', 0, null), inst('Panel', 1, 0), inst('Panel', 2, 0), inst('Button', 3, 1), inst('Button', 4, 2), inst('Button', 5, 0),
    ]))
    expect(g.components.map(c => [c.id, c.rt.count])).toEqual([['rt:App', 1], ['rt:App>Panel', 2], ['rt:App>Panel>Button', 2], ['rt:App>Button', 1]])
    expect(byName(g, 'App').children.map(c => [c.id, c.count])).toEqual([['rt:App>Panel', 2], ['rt:App>Button', 1]])
  })

  it('root instances of one component (two run()s) are one card ×2 in an "apps" cluster', () => {
    const g = fromRuntime(RT([inst('App', 0, null, { app: 0 }), inst('App', 3, null, { app: 1 }), inst('Row', 1, 0, { app: 0 }), inst('Row', 4, 3, { app: 1 })]))
    expect(g.components.map(c => [c.id, c.rt.count, c.dir])).toEqual([['rt:App', 2, 'apps 1, 2 · App'], ['rt:App>Row', 2, 'apps 1, 2 · App']])
    expect(byName(g, 'App').entry).toBe(true)
  })

  it('graphs from before D522 (no app) cluster by the root name; a parent cycle or a missing parent does not hang', () => {
    const g = fromRuntime(RT([inst('A', 0, null), inst('B', 1, 2), inst('C', 2, 1), inst('D', 5, 99)]))
    expect(byName(g, 'A').dir).toBe('A')
    expect(g.components.map(c => c.id).sort()).toEqual(['rt:A', 'rt:B>C', 'rt:B>C>B', 'rt:D'])
  })

  it('unions the instances: the best trigger, all sinks, matched when any instance matched, diagnostics once, hidden only when all are', () => {
    const d = { code: 'SYG101', severity: 'warn', message: 'x', timestamp: 5 }
    const g = fromRuntime(RT([
      inst('App', 0, null),
      inst('Row', 1, 0, { shown: false, actions: [{ name: 'PICK', trigger: 'unknown', sinks: ['STATE'] }], selectors: [{ selector: '.a', events: ['click'], matched: false, isolationHit: 'Cell' }], controls: [{ name: 'Go', element: 'button', listened: false }], diagnostics: [d], contextConsumes: ['theme'] }),
      inst('Row', 2, 0, { actions: [{ name: 'PICK', trigger: 'next', sinks: ['EVENTS'] }], selectors: [{ selector: '.a', events: ['input'], matched: true, isolationHit: null }], controls: [{ name: 'Go', element: 'button', listened: true }], diagnostics: [d], contextConsumes: null }),
    ]))
    const row = byName(g, 'Row')
    expect(row.actions).toEqual([{ name: 'PICK', trigger: 'next', sinks: ['STATE', 'EVENTS'] }])
    expect(row.selectors).toEqual([{ selector: '.a', events: ['click', 'input'], matched: true, isolationHit: null }])
    expect(row.controls).toEqual([{ name: 'Go', element: 'button', listened: true }])
    expect(row.diagnostics).toEqual([d])
    expect(row.contextConsumes).toEqual(['theme'])
    expect(row.shown).toBeUndefined()
    expect(row.rt.instances).toEqual([{ id: '1', stateKeys: [], shown: false }, { id: '2', stateKeys: [] }])
  })

  it('events and recent actions: instance ids → card ids', () => {
    const g = fromRuntime(RT(
      [inst('App', 0, null), inst('Item', 1, 0), inst('Item', 2, 0)],
      { DONE: { emitters: ['Item'], selectors: ['App'], emitterIds: ['1', '2'], selectorIds: ['0'] }, GONE: { emitters: [], selectors: [] } },
      { recentActions: [{ type: 'DONE', component: 'Item', instance: '2', sinks: [], cause: 'intent', at: 1 }, { type: 'DONE', component: 'Item', instance: '1', sinks: [], cause: 'intent', at: 2 }, { type: 'X', component: 'Gone', instance: '7', sinks: [], cause: 'intent', at: 3 }] },
    ))
    expect(g.events.DONE).toEqual({ emitters: ['Item'], selectors: ['App'], emitterIds: ['rt:App>Item'], selectorIds: ['rt:App'] })
    expect(g.events.GONE).toEqual({ emitters: [], selectors: [], emitterIds: [], selectorIds: [] })
    expect(byName(g, 'Item').rt.recent).toEqual({ DONE: 2 })
    const m = buildModel(g)
    expect(m.eventEdges).toEqual([{ from: 'rt:App>Item', to: 'rt:App', type: 'DONE' }])
  })
})

describe('the model and health on a runtime graph', () => {
  it('model.runtime; the four static checks are off, "not seen yet" groups instead; diagnostics keep their time', () => {
    const raw = RT([
      inst('App', 0, null, { actions: [{ name: 'LATER', trigger: 'unknown', sinks: ['STATE'] }], selectors: [{ selector: '.x', events: null, matched: false, isolationHit: null }], eventsSelected: ['PING'] }),
      inst('Kid', 1, 0, { eventsEmitted: ['PONG'] }),
    ], { PING: { emitters: [], selectors: ['App'], emitterIds: [], selectorIds: ['0'] }, PONG: { emitters: ['Kid'], selectors: [], emitterIds: ['1'], selectorIds: [] } })
    raw.diagnostics = [{ code: 'SYG105', severity: 'warn', message: 'm', timestamp: 1234 }]
    const m = buildModel(fromRuntime(raw))
    expect(m.runtime).toBe(true)
    const h = healthList(m)
    expect(h.map(g => g.group)).toEqual(['SYG105'])
    expect(h[0].items).toEqual([{ id: null, title: 'app', sub: 'm', at: 1234 }])
    expect(runtimeHealth(m)).toEqual([
      { group: 'Actions not seen yet', tone: 'muted', items: [{ id: 'rt:App', title: 'LATER', sub: 'App · no intent, reply or next() has run it yet (sygnal-check checks the source)' }] },
      { group: 'EVENTS selected, not emitted yet', tone: 'muted', items: [{ id: 'rt:App', event: 'PING', title: 'PING', sub: 'selected by App' }] },
    ])
    // the same data as a static graph still gets the static checks
    const s = buildModel({ ...raw, source: 'static', diagnostics: [], components: raw.components.map(c => ({ ...c, file: 'src/x.jsx' })) })
    expect(s.runtime).toBe(false)
    expect(healthList(s).map(g => g.group)).toEqual(expect.arrayContaining(['Actions nothing triggers', 'Selectors not in the view', 'Events nobody selects', 'Events nobody emits']))
  })

  it('the layout clusters by app', () => {
    const m = buildModel(fromRuntime(shop()))
    expect(layoutGraph(m).clusters.map(c => c.key).sort()).toEqual(['app 1 · App', 'app 2 · Widget'])
  })
})

describe('runtime card text and detail HTML', () => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const btnChip = (text, attrs, cls, label) => `<button class="chip ${cls}" ${attrs} aria-label="${esc(label)}">${esc(text)}</button>`

  it('rtCardSub, rtTime, rtStateText', () => {
    const g = fromRuntime(shop())
    expect(rtCardSub(byName(g, 'Line'))).toBe('2 instances')
    expect(rtCardSub(byName(g, 'Shop'))).toBe('instance #5 · hidden')
    expect(rtTime(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe('03:04:05')
    expect(rtTime(undefined)).toBe('')
    expect(rtStateText({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(rtStateText('x'.repeat(10), 4)).toBe('"xxx\n…')
    const cyclic = {}; cyclic.self = cyclic
    expect(rtStateText(cyclic)).toBe('[object Object]')
  })

  it('escapes names and state', () => {
    const g = fromRuntime(RT([inst('App', 0, null, { stateKeys: ['<b>'] })], {}, { recentActions: [{ type: '<x>', component: 'App', instance: '0', sinks: [], cause: 'intent', at: 0 }] }))
    const html = rtDetailHtml(byName(g, 'App'), { esc, btnChip, states: { 0: { s: '</pre><script>' } }, canFetch: true })
    expect(html).not.toMatch(/<script>|<b>|<x>/)
    expect(html).toContain('&lt;/pre&gt;&lt;script&gt;')
  })
})

describe('the page with runtime.js inlined', () => {
  it('runtime.js inlines (no imports, declarations only) and its names do not clash with the other modules', () => {
    const src = fs.readFileSync(path.join(here, '../src/graphView/runtime.js'), 'utf8')
    expect(() => inlineModule(src, 'runtime.js')).not.toThrow()
    const html = graphHtml(shop(), { title: 'shop' })
    const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1].replace(/V\.mountPage\([^\n]*\n/, '')
    const V = vm.runInNewContext(script.replace(/^\(\(\) => \{/, '(() => {').replace(/\}\)\(\)\s*$/, 'return V })()'), {})
    for (const k of Object.keys(runtimeExports)) expect(typeof V[k]).toBe('function')
  })
})
