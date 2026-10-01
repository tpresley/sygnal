// 2B: runtime inspect() in the 'sygnal/diagnostics' dev entry, renderComponent's t.inspect(),
// getDevTools().inspect, and validation against sygnal-check/schema/inspect.schema.json.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setupChecks, settle } from './diagnostics/helpers.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { inspect, installChecks } from '../src/extra/diagnostics/checks/index.js'
import { inspectCheck } from '../src/extra/diagnostics/checks/inspect.js'
import { getDevTools } from '../src/extra/devtools.js'
import { event } from '../src/extra/reducers.js'
import { validate } from '../sygnal-check/src/schema.js'

const schema = JSON.parse(readFileSync(fileURLToPath(new URL('../sygnal-check/schema/inspect.schema.json', import.meta.url)), 'utf8'))
const h = createElement

function Item({ state }) { return h('li', { className: 'item' }, h('button', { className: 'remove' }, String(state.title))) }
Item.intent = ({ DOM }) => ({ REMOVE: DOM.select('.remove').events('click') })
Item.model = { REMOVE: { EVENTS: event('ITEM_REMOVED', (s) => s.id) } }

function Badge({ state }) { return h('span', { className: 'badge' }, String(state.count)) }

function App({ state }) {
  return h('div', null,
    h('button', { className: 'add' }, '+'),
    h(Collection, { of: Item, from: 'items' }),
    h(Badge, { state: 'counter' }),
  )
}
App.initialState = { items: [{ id: 1, title: 'x' }, { id: 2, title: 'y' }], counter: { count: 0 }, tab: 'a' }
App.calculated = { total: s => s.items.length }
App.context = { theme: () => 'dark' }
App.intent = ({ DOM, EVENTS }) => ({
  ADD: DOM.select('.add').events('click'),
  CLICK_ITEM: DOM.select('.remove').events('click'), // isolation boundary: inside Item
  REMOVED: EVENTS.select('ITEM_REMOVED'),
  ORPHAN: DOM.select('.nothing').events('click'),
})
App.model = {
  ADD: (s, _d, next) => { next('LOG'); return { ...s, items: [...s.items, { id: 3, title: 'z' }] } },
  LOG: (s) => ({ ...s }),
  CLICK_ITEM: (s) => s,
  REMOVED: (s, id) => ({ ...s, items: s.items.filter(i => i.id !== id) }),
  NEVER: (s) => s,
}

let t
beforeEach(() => setupChecks())
afterEach(() => { if (t) t.dispose(); t = null; vi.restoreAllMocks() })

const byName = (g, name) => g.components.filter(c => c.name === name)

describe('t.inspect() (renderComponent)', () => {
  it('returns the graph of the rendered tree, valid against the JSON Schema', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    t = renderComponent(App)
    await t.ready()
    t.simulateEvent('.add', 'click')
    await t.waitForState(s => s.items.length === 3)
    await settle(60)
    const g = t.inspect()
    expect(validate(schema, g)).toEqual([])
    expect(g.version).toBe(1)
    expect(g.source).toBe('runtime')

    const [app] = byName(g, 'App')
    expect(app.kind).toBe('root')
    expect(app.parentId).toBe(null)
    const actions = Object.fromEntries(app.actions.map(a => [a.name, a]))
    expect(actions.ADD).toEqual({ name: 'ADD', trigger: 'intent', sinks: ['STATE'] })
    expect(actions.ORPHAN).toEqual({ name: 'ORPHAN', trigger: 'intent', sinks: [] })
    // LOG and NEVER have no intent stream; renderComponent injects one for each, so their
    // trigger can't be told apart from simulateAction -> 'unknown'
    expect(actions.LOG.trigger).toBe('unknown')
    expect(actions.NEVER.trigger).toBe('unknown')
    // the core adds INITIALIZE to every model (it seeds initialState)
    expect(actions.INITIALIZE).toEqual({ name: 'INITIALIZE', trigger: 'builtin', sinks: ['STATE'] })
    expect(app.stateKeys.sort()).toEqual(['counter', 'items', 'tab'])
    expect(app.calculated).toEqual(['total'])
    expect(app.contextProvides).toEqual(['theme'])
    expect(app.contextConsumes).toBe(null)
    expect(app.eventsSelected).toEqual(['ITEM_REMOVED'])

    const sel = Object.fromEntries(app.selectors.map(s => [s.selector, s]))
    expect(sel['.add']).toEqual({ selector: '.add', events: ['click'], matched: true, isolationHit: null })
    expect(sel['.remove']).toEqual({ selector: '.remove', events: ['click'], matched: false, isolationHit: 'Item' })
    expect(sel['.nothing'].matched).toBe(false)
    expect(sel['.nothing'].isolationHit).toBe(null)

    const children = Object.fromEntries(app.children.map(c => [c.name, c]))
    expect(children.Item).toMatchObject({ via: 'collection', count: 3 })
    expect(children.Badge).toMatchObject({ via: 'tag', count: 1 })

    const items = byName(g, 'Item')
    expect(items).toHaveLength(3)
    for (const item of items) {
      expect(item.kind).toBe('collection-item')
      expect(item.parentId).toBe(app.id)
      expect(item.actions).toEqual([
        { name: 'REMOVE', trigger: 'intent', sinks: ['EVENTS'] },
        { name: 'INITIALIZE', trigger: 'builtin', sinks: ['STATE'] },
      ])
      expect(item.selectors).toEqual([{ selector: '.remove', events: ['click'], matched: true, isolationHit: null }])
    }
    expect(byName(g, 'Badge')[0].kind).toBe('child')

    expect(g.events.ITEM_REMOVED).toEqual({ emitters: [], selectors: ['App'] })
    // SYG104 for App's '.remove' is attached to App
    expect(app.diagnostics.map(d => d.code)).toContain('SYG104')
  })

  it('prunes disposed collection items (and the events they emitted)', async () => {
    t = renderComponent(App)
    await t.ready()
    t.simulateEvent('.remove', 'click') // first item emits ITEM_REMOVED -> App removes it
    await t.waitForState(s => s.items.length === 1)
    await settle(60)
    const g = t.inspect()
    expect(validate(schema, g)).toEqual([])
    expect(byName(g, 'Item')).toHaveLength(1)
    expect(byName(g, 'Item')[0].eventsEmitted).toEqual([])
    expect(g.events.ITEM_REMOVED).toEqual({ emitters: [], selectors: ['App'] })
  })

  it('attributes EVENTS emits to the emitting instance (not the root that forwards them)', async () => {
    function Pinger() { return h('button', { className: 'ping' }, 'ping') }
    Pinger.intent = ({ DOM }) => ({ PING: DOM.select('.ping').events('click') })
    Pinger.model = { PING: { EVENTS: event('PING') } }
    function Host({ state }) { return h('div', null, h(Pinger, { state: 'pinger' }), String(state.n)) }
    Host.initialState = { n: 0, pinger: {} }
    Host.intent = ({ EVENTS }) => ({ PINGED: EVENTS.select('PING') })
    Host.model = { PINGED: s => ({ ...s, n: s.n + 1 }) }
    t = renderComponent(Host)
    await t.ready()
    t.simulateEvent('.ping', 'click')
    await t.waitForState(s => s.n === 1)
    const g = t.inspect()
    expect(validate(schema, g)).toEqual([])
    expect(g.events.PING).toEqual({ emitters: ['Pinger'], selectors: ['Host'] })
    expect(byName(g, 'Pinger')[0].eventsEmitted).toEqual(['PING'])
    expect(byName(g, 'Host')[0].eventsEmitted).toEqual([])
    expect(byName(g, 'Host')[0].eventsSelected).toEqual(['PING'])
  })

  it("reports a 'next' trigger for a model-only action seen running (no test injection)", async () => {
    function Child({ state }) { return h('button', { className: 'go' }, String(state.n)) }
    Child.intent = ({ DOM }) => ({ GO: DOM.select('.go').events('click') })
    Child.model = { GO: (s, _d, next) => { next('STEP'); return s }, STEP: s => ({ ...s, n: s.n + 1 }) }
    function Parent() { return h('div', null, h(Child, { state: 'child' })) }
    Parent.initialState = { child: { n: 0 } }
    t = renderComponent(Parent)
    await t.ready()
    t.simulateEvent('.go', 'click')
    await t.waitForState(s => s.child.n === 1)
    const [child] = byName(t.inspect(), 'Child')
    expect(child.actions).toEqual([
      { name: 'GO', trigger: 'intent', sinks: ['STATE'] },
      { name: 'STEP', trigger: 'next', sinks: ['STATE'] },
      { name: 'INITIALIZE', trigger: 'builtin', sinks: ['STATE'] },
    ])
  })

  it('only lists the components of its own tree', async () => {
    const other = renderComponent(Item, { initialState: { id: 9, title: 'other' } })
    t = renderComponent(App)
    await Promise.all([t.ready(), other.ready()])
    expect(byName(t.inspect(), 'Item')).toHaveLength(2)
    expect(byName(other.inspect(), 'Item')).toHaveLength(1)
    expect(byName(other.inspect(), 'App')).toHaveLength(0)
    other.dispose()
  })

  it('throws a clear error when the dev entry is not loaded', async () => {
    const core = globalThis.__SYGNAL_DIAGNOSTICS__
    core.__uninstallChecks()
    try {
      t = renderComponent(Item, { initialState: { id: 1, title: 'a' } })
      await t.ready()
      expect(() => t.inspect()).toThrow("t.inspect() needs import 'sygnal/diagnostics'")
    } finally {
      installChecks()
    }
  })
})

describe('inspect() / getDevTools().inspect', () => {
  // (Switchable can't be rendered by renderComponent's mock DOM yet, so the kind
  // detection is checked on component-shaped objects.)
  it('derives the kind from the sources the core builds', () => {
    const parent = { _componentNumber: 90001, name: 'Host', sources: {}, stateSourceName: 'STATE' }
    const STATE = {}
    const mk = (n, name, extra) => ({ _componentNumber: n, name, stateSourceName: 'STATE', sources: { __parentComponentNumber: 90001, STATE, ...extra } })
    const comps = [parent, mk(90002, 'Tagged', {}), mk(90003, 'Row', { PARENT: null }), mk(90004, 'Tab', { state: {} })]
    for (const c of comps) { inspectCheck.onIntent(c, []); inspectCheck.onModel(c, {}) }
    try {
      const g = inspect({ ids: [90001, 90002, 90003, 90004], diagnostics: [] })
      expect(validate(schema, g)).toEqual([])
      expect(g.components.map(c => [c.name, c.kind, c.parentId])).toEqual([
        ['Host', 'root', null], ['Tagged', 'child', '90001'], ['Row', 'collection-item', '90001'], ['Tab', 'switchable', '90001'],
      ])
      expect(g.components[0].children).toEqual([
        { name: 'Tagged', via: 'tag', count: 1 }, { name: 'Row', via: 'collection', count: 1 }, { name: 'Tab', via: 'switchable', count: 1 },
      ])
    } finally {
      for (const c of comps) inspectCheck.onDispose(c)
    }
  })

  it('is attached to the devtools object when it exists', async () => {
    const dt = getDevTools()
    const prev = globalThis.__SYGNAL_DEVTOOLS__
    globalThis.__SYGNAL_DEVTOOLS__ = dt
    try {
      t = renderComponent(Item, { initialState: { id: 1, title: 'a' } })
      await t.ready()
      expect(typeof dt.inspect).toBe('function')
      expect(dt.inspect).toBe(inspect)
      const g = dt.inspect()
      expect(validate(schema, g)).toEqual([])
      expect(byName(g, 'Item').length).toBeGreaterThan(0)
    } finally {
      if (prev === undefined) delete globalThis.__SYGNAL_DEVTOOLS__
      else globalThis.__SYGNAL_DEVTOOLS__ = prev
      delete dt.inspect
    }
  })

  it('prunes components once they are disposed', async () => {
    t = renderComponent(Item, { initialState: { id: 1, title: 'a' } })
    await t.ready()
    expect(byName(inspect({ diagnostics: [] }), 'Item').length).toBeGreaterThan(0)
    t.dispose()
    t = null
    await settle(10)
    expect(byName(inspect({ diagnostics: [] }), 'Item')).toHaveLength(0)
  })
})
