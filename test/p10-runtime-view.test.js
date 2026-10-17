// PLAN-10 V-3 (D520, D530): a real runtime inspect() graph through the graph page's runtime adapter
// (sygnal-check/src/graphView/runtime.js) and model: cards ×N, the tree from parentId, context
// edges from InstanceView.reads, hidden Switchable pages, two run()s as two clusters, the runtime
// health groups. SYGNAL_RUNTIME_FIXTURE=<file> writes the graph (the browser suite's runtime sample,
// sygnal-check/test/fixtures/graph-runtime/shop.runtime.json).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setupChecks, settle } from './diagnostics/helpers.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { Switchable } from '../src/switchable.js'
import { event } from '../src/extra/reducers.js'
import { inspect } from '../src/extra/diagnostics/checks/index.js'
import { validate } from '../sygnal-check/src/schema.js'
import { fromRuntime, runtimeHealth, rtDetailHtml, rtCardSub } from '../sygnal-check/src/graphView/runtime.js'
import { buildModel, healthList } from '../sygnal-check/src/graphView/model.js'
import { layoutGraph } from '../sygnal-check/src/graphView/layout.js'

const schema = JSON.parse(readFileSync(fileURLToPath(new URL('../sygnal-check/schema/inspect.schema.json', import.meta.url)), 'utf8'))

function Badge({ context }) { return h('span', { className: 'badge' }, String(context.currency)) }

function Header() { return h('header', null, h('button', { className: 'go' }, 'shop')) }
Header.intent = ({ DOM }) => ({ GO: DOM.select('.go').events('click') })
Header.model = { GO: { EVENTS: event('NAVIGATE', () => 'shop') } }

function Line({ state, context }) { return h('li', null, h('button', { className: 'remove' }, `${state.title} ${context.currency}`)) }
Line.intent = ({ DOM }) => ({ REMOVE: DOM.select('.remove').events('click') })
Line.model = { REMOVE: { PARENT: (s) => s.id } }

function Cart() { return h('ul', null, h(Collection, { of: Line, from: 'items' })) }
Cart.model = { CHECKOUT: (s) => s }

function Shop({ state }) { return h('p', null, String(state.items.length)) }
Shop.model = { BUY: (s) => s }

function App({ state }) {
  return h('main', null, h(Header), h(Badge), h(Switchable, { of: { cart: Cart, shop: Shop }, current: state.page }))
}
App.initialState = { page: 'cart', currency: 'EUR', items: [{ id: 1, title: 'tea' }, { id: 2, title: 'cake' }] }
App.context = { currency: (s) => s.currency }
App.intent = ({ EVENTS }) => ({ NAV: EVENTS.select('NAVIGATE') })
App.model = { NAV: (s, page) => ({ ...s, page }) }

function Widget({ state }) { return h('div', null, String(state.n)) }
Widget.initialState = { n: 1 }
Widget.intent = ({ DOM }) => ({ INC: DOM.select('.inc').events('click') })
Widget.model = { INC: (s) => ({ n: s.n + 1 }) }

let ts = []
beforeEach(() => setupChecks())
afterEach(() => { for (const t of ts) t.dispose(); ts = []; vi.restoreAllMocks() })

const card = (m, name) => m.comps.find(c => c.name === name)

describe('PLAN-10 V-3: a runtime graph on the page model', () => {
  it('groups instances per (parent card, name), keeps the tree, context reads, hidden pages and apps', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const app = renderComponent(App)
    const widget = renderComponent(Widget)
    ts = [app, widget]
    await app.ready(); await widget.ready()
    await settle(30)
    // the whole page (both apps); t.inspect() would list only its own tree
    const raw = inspect({ actions: 50 })
    expect(validate(schema, raw)).toEqual([])
    if (process.env.SYGNAL_RUNTIME_FIXTURE) writeFileSync(process.env.SYGNAL_RUNTIME_FIXTURE, JSON.stringify(raw, null, 2) + '\n')

    const g = fromRuntime(raw)
    const m = buildModel(g)
    expect(m.runtime).toBe(true)
    expect(m.comps.map(c => c.name).sort()).toEqual(['App', 'Badge', 'Cart', 'Header', 'Line', 'Shop', 'Widget'])
    expect(m.ghosts).toEqual([])
    // ×N: the two Line instances are one card, with both instances (and both map to it)
    const line = card(m, 'Line')
    expect(line.rt.count).toBe(2)
    expect(line.id).toBe('rt:App>Cart>Line')
    expect(line.rt.instances.map(i => g.rtCardOf[i.id])).toEqual([line.id, line.id])
    expect(rtCardSub(line)).toBe('2 instances')
    // the tree from parentId (not names): App → Header, Badge, Cart, Shop; Cart → Line [collection]
    const kids = (name) => m.renderEdges.filter(e => e.from === card(m, name).id).map(e => [m.byId.get(e.to).name, e.via]).sort()
    expect(kids('App')).toEqual([['Badge', 'tag'], ['Cart', 'switchable'], ['Header', 'tag'], ['Shop', 'switchable']])
    expect(kids('Cart')).toEqual([['Line', 'collection']])
    // D530: context reads at runtime → context edges from the nearest provider
    expect(line.contextConsumes).toEqual(['currency'])
    expect(card(m, 'Badge').contextConsumes).toEqual(['currency'])
    expect(m.contextEdges.map(e => [m.byId.get(e.from).name, m.byId.get(e.to).name, e.fields]).sort()).toEqual([
      ['App', 'Badge', ['currency']], ['App', 'Line', ['currency']],
    ])
    expect(m.orphanReads).toEqual([])
    // the hidden Switchable page, view-only, entry
    expect(card(m, 'Shop').shown).toBe(false)
    expect(card(m, 'Cart').shown).toBeUndefined()
    expect(card(m, 'Badge').viewOnly).toBe(true)
    expect(m.comps.filter(c => c.entry).map(c => c.name).sort()).toEqual(['App', 'Widget'])
    // two run()s: two clusters, named by app and root
    expect(card(m, 'Line').dir).toBe(card(m, 'App').dir)
    expect(new Set(m.comps.map(c => c.dir)).size).toBe(2)
    expect(card(m, 'App').dir).toMatch(/^app \d · App$/)
    expect(layoutGraph(m).clusters.map(c => c.key).sort()).toEqual([card(m, 'App').dir, card(m, 'Widget').dir].sort())
    // EVENTS by card id: nobody emitted NAVIGATE yet
    expect(m.events.NAVIGATE).toMatchObject({ emitterIds: [], selectorIds: [card(m, 'App').id] })
    expect(m.eventEdges).toEqual([])

    // health: no static false alarms, the "not seen yet" groups instead
    const groups = healthList(m).map(x => x.group)
    for (const g of ['Actions nothing triggers', 'Selectors not in the view', 'Events nobody selects', 'Events nobody emits']) expect(groups).not.toContain(g)
    const rh = runtimeHealth(m)
    expect(rh.map(x => [x.group, x.tone])).toEqual([['Actions not seen yet', 'muted'], ['EVENTS selected, not emitted yet', 'muted']])
    expect(rh[0].items.map(i => i.title).sort()).toEqual(['BUY', 'CHECKOUT'])
    expect(rh[1].items).toEqual([{ id: card(m, 'App').id, event: 'NAVIGATE', title: 'NAVIGATE', sub: 'selected by App' }])

    // after a click: the emitter, the event edge, the recent actions per card
    app.simulateEvent('.go', 'click')
    await app.waitForState(s => s.page === 'shop')
    await settle(30)
    const m2 = buildModel(fromRuntime(inspect({ actions: 50 })))
    expect(m2.eventEdges.map(e => [m2.byId.get(e.from).name, m2.byId.get(e.to).name, e.type])).toEqual([['Header', 'App', 'NAVIGATE']])
    expect(card(m2, 'Header').rt.recent).toMatchObject({ GO: 1 })
    expect(card(m2, 'App').rt.recent).toMatchObject({ NAV: 1 })
    expect(card(m2, 'Shop').shown).toBeUndefined()
    expect(card(m2, 'Cart').shown).toBe(false)
    expect(runtimeHealth(m2).map(x => x.group)).toEqual(['Actions not seen yet'])
    // stable card keys across graphs (selection survives a refresh)
    expect(m2.comps.map(c => c.key).sort()).toEqual(m.comps.map(c => c.key).sort())
  })

  it('the detail panel: recent actions, one row per instance, state only when the host gave it', () => {
    const raw = {
      version: 1, source: 'runtime', diagnostics: [], events: {},
      components: [
        { name: 'List', id: '0', parentId: null, kind: 'root', entry: true, app: 0, actions: [], stateKeys: ['items'], calculated: [], contextProvides: [], contextConsumes: [], eventsEmitted: [], eventsSelected: [], children: [{ name: 'Row', via: 'collection', count: 2, ids: ['1', '2'] }], selectors: [], diagnostics: [] },
        { name: 'Row', id: '1', parentId: '0', kind: 'collection-item', app: 0, actions: [{ name: 'PICK', trigger: 'unknown', sinks: ['STATE'] }], stateKeys: ['id'], calculated: [], contextProvides: [], contextConsumes: null, eventsEmitted: [], eventsSelected: [], children: [], selectors: [{ selector: '.pick', events: ['click'], matched: false, isolationHit: null }], diagnostics: [] },
        { name: 'Row', id: '2', parentId: '0', kind: 'collection-item', app: 0, actions: [{ name: 'PICK', trigger: 'intent', sinks: ['STATE', 'EVENTS'] }], stateKeys: ['id'], calculated: [], contextProvides: [], contextConsumes: null, eventsEmitted: [], eventsSelected: [], children: [], selectors: [{ selector: '.pick', events: ['click'], matched: true, isolationHit: null }], diagnostics: [] },
      ],
      recentActions: [{ type: 'PICK', component: 'Row', instance: '2', sinks: ['STATE'], cause: 'intent', at: 5 }, { type: 'PICK', component: 'Row', instance: '1', sinks: ['STATE'], cause: 'intent', at: 9 }],
    }
    const m = buildModel(fromRuntime(raw))
    const row = card(m, 'Row')
    // the union over instances: the best trigger, every sink, matched when any instance matched
    expect(row.actions).toEqual([{ name: 'PICK', trigger: 'intent', sinks: ['STATE', 'EVENTS'] }])
    expect(row.selectors).toEqual([{ selector: '.pick', events: ['click'], matched: true, isolationHit: null }])
    expect(row.rt.recent).toEqual({ PICK: 2 })
    const esc = (s) => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
    const btnChip = (text, attrs) => `<button ${attrs}>${esc(text)}</button>`
    const html = rtDetailHtml(row, { esc, btnChip, states: { 2: { id: 'b' } }, canFetch: false })
    expect(html).toContain('data-trace-action="PICK">PICK ×2</button>')
    expect(html.match(/class="rt-inst"/g)).toHaveLength(2)
    expect(html).toContain('data-inst="1"')
    expect(html).toMatch(/data-inst="2"[^]*&#34;id&#34;: &#34;b&#34;/)
    expect(html).toContain('State values come from the host')
    expect(rtDetailHtml(card(m, 'List'), { esc, btnChip, states: {}, canFetch: true })).toContain(' open><summary>') // one instance: open, loading
  })
})
