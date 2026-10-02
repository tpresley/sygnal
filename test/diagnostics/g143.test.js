// PLAN-3 1-G (G-143): dev-entry diagnostics for mistakes found in the Haiku eval failures.
//   SYG115 unknown DOM event shorthand (DOM.key('.x'))
//   SYG116 a value with no string type (a function) emitted on EVENTS
//   SYG221 set() called with a string (set('city'))
//   SYG421 invalid data (dataset) key ('task-id')
// Plus the canonical Escape-key pattern, DOM.keydown('document').key().filter(...).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupChecks, diagnostics, settle, later } from './helpers.js'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement } from '../../src/pragma/index.js'
import { ABORT } from '../../src/component.js'
import { set, event } from '../../src/extra/reducers.js'
import { listCodes, getCodeInfo } from '../../src/extra/diagnostics/checks/index.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { if (t) t.dispose(); t = null })

const named = (name, fn) => { Object.defineProperty(fn, 'name', { value: name }); return fn }
const view = () => createElement('div', null, createElement('button', { className: 'go' }, 'go'))

describe('dev-entry code registry (G-143)', () => {
  it('registers SYG115/116/221/421 with their titles and severities', () => {
    const codes = listCodes().map(c => c.code)
    expect(codes).toEqual(expect.arrayContaining(['SYG115', 'SYG116', 'SYG221', 'SYG421']))
    expect(getCodeInfo('SYG115')).toMatchObject({ severity: 'warn', title: 'Unknown DOM event shorthand' })
    expect(getCodeInfo('SYG116').severity).toBe('error')
    expect(getCodeInfo('SYG221').severity).toBe('error')
    expect(getCodeInfo('SYG421').severity).toBe('error')
  })
})

describe('SYG115 — unknown DOM event shorthand', () => {
  it('reports DOM.key(sel) with the keydown().key() fix, once', async () => {
    const App = named('Search', () => view())
    App.initialState = { q: '' }
    App.intent = ({ DOM }) => ({ KEY: DOM.key('.go'), KEY2: DOM.key('.go') })
    App.model = { KEY: s => s, KEY2: s => s }
    t = renderComponent(App)
    await t.ready()
    const found = diagnostics('SYG115')
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('warn')
    expect(found[0].component).toBe('Search')
    expect(found[0].data).toEqual({ event: 'key', selector: '.go' })
    expect(found[0].message).toContain("DOM.key('.go')")
    expect(found[0].fix).toContain("DOM.keydown('.go').key()")
  })

  it('suggests Escape/Enter filters, near-miss event names and the explicit form for custom events', async () => {
    const App = named('Keys', () => view())
    App.initialState = {}
    App.intent = ({ DOM }) => ({ A: DOM.escape('document'), B: DOM.keyDown('.go'), C: DOM.myevent('.go') })
    App.model = { A: s => s, B: s => s, C: s => s }
    t = renderComponent(App)
    await t.ready()
    const fixes = Object.fromEntries(diagnostics('SYG115').map(d => [d.data.event, d.fix]))
    expect(fixes.escape).toContain("DOM.keydown('document').key().filter(k => k === 'Escape')")
    expect(fixes.keyDown).toContain("Did you mean DOM.keydown('.go')")
    expect(fixes.myevent).toContain("DOM.select('.go').events('myevent')")
  })

  it('does not report real event shorthands, DOM.select().events() or source methods', async () => {
    const App = named('Fine', () => view())
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({
      A: DOM.click('.go'), B: DOM.keydown('document').key(), C: DOM.input('.go').value(),
      D: DOM.select('.go').events('my-custom'), E: DOM.dblclick('.go'), F: DOM.pointerdown('.go'),
    })
    App.model = { A: s => ({ ...s, n: s.n + 1 }), B: s => s, C: s => s, D: s => s, E: s => s, F: s => s }
    t = renderComponent(App)
    t.simulateEvent('.go', 'click')
    await t.waitForState(s => s.n === 1) // the shorthand still works through the check's Proxy
    expect(diagnostics('SYG115')).toEqual([])
  })

  it('still behaves like the core shorthand (the stream is the same as DOM.select().events())', async () => {
    const App = named('Custom', () => view())
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({ HIT: DOM.bump('.go') })
    App.model = { HIT: s => ({ ...s, n: s.n + 1 }) }
    t = renderComponent(App)
    t.simulateEvent('.go', 'bump')
    await t.waitForState(s => s.n === 1)
    expect(diagnostics('SYG115')).toHaveLength(1)
  })
})

describe('SYG116 — EVENTS value with no string type', () => {
  it('reports a model entry that returns event(...) instead of being event(...)', async () => {
    const App = named('Sender', () => view())
    App.initialState = {}
    App.intent = ({ DOM, EVENTS }) => ({ GO: DOM.select('.go').events('click'), GOT: EVENTS.select('SAVED') })
    App.model = { GO: { EVENTS: () => event('SAVED', 1) }, GOT: s => s }
    t = renderComponent(App, { mockConfig: { '.go': { click: later() } } })
    await settle(120)
    const found = diagnostics('SYG116')
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('error')
    expect(found[0].component).toBe('Sender')
    expect(found[0].message).toMatch(/no string 'type'.*function/)
    expect(found[0].fix).toContain("{ EVENTS: event('TYPE'")
  })

  it('does not report event(), a raw { type, data } object or ABORT', async () => {
    const App = named('Fine', () => view())
    App.initialState = { got: 0 }
    App.intent = ({ DOM, EVENTS }) => ({
      GO: DOM.select('.go').events('click'), GOT: EVENTS.select('A'), GOT2: EVENTS.select('B'),
    })
    App.model = {
      GO: { EVENTS: event('A', 1) },
      GOT: { EVENTS: () => ({ type: 'B', data: 2 }), STATE: s => ({ ...s, got: s.got + 1 }) },
      GOT2: { EVENTS: () => ABORT },
    }
    t = renderComponent(App, { mockConfig: { '.go': { click: later() } } })
    await t.waitForState(s => s.got === 1)
    await settle(60)
    expect(diagnostics('SYG116')).toEqual([])
  })
})

describe('SYG221 — set() called with a string', () => {
  function make(reducer) {
    const App = named('Weather', () => view())
    App.initialState = { city: '', n: 0 }
    App.intent = ({ DOM }) => ({ GO: DOM.select('.go').events('click') })
    App.model = { GO: reducer }
    return App
  }

  it("reports set('city') with the canonical function form", async () => {
    t = renderComponent(make(set('city')), { mockConfig: { '.go': { click: later('Paris') } } })
    await settle(120)
    const found = diagnostics('SYG221')
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('error')
    expect(found[0].data).toEqual({ action: 'GO', field: 'city' })
    expect(found[0].message).toContain("set('city')")
    expect(found[0].fix).toContain('set((state, city) => ({ city }))')
  })

  it('does not report set(object), set(fn) or a state that already has numeric keys', async () => {
    t = renderComponent(make(set((state, city) => ({ city }))), { mockConfig: { '.go': { click: later('Paris') } } })
    await t.waitForState(s => s.city === 'Paris')
    t.dispose()
    t = renderComponent(make(set({ n: 1 })), { mockConfig: { '.go': { click: later() } } })
    await t.waitForState(s => s.n === 1)
    t.dispose()
    const Grid = make(s => ({ ...s, 0: 'x' }))
    Grid.initialState = { 0: 'a', n: 0 }
    t = renderComponent(Grid, { mockConfig: { '.go': { click: later() } } })
    await t.waitForState(s => s[0] === 'x')
    expect(diagnostics('SYG221')).toEqual([])
  })
})

describe('SYG421 — invalid data (dataset) key', () => {
  it("reports data={{ 'task-id': ... }} with the camelCase fix", async () => {
    const App = named('Board', () => createElement('div', null, createElement('div', { className: 'card', data: { 'task-id': 7 } }, 'x')))
    App.initialState = {}
    t = renderComponent(App)
    await t.ready()
    const found = diagnostics('SYG421')
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('error')
    expect(found[0].data).toEqual({ key: 'task-id', suggested: 'taskId', attribute: 'data-task-id' })
    expect(found[0].fix).toContain('data={{ taskId: … }}')
    expect(found[0].fix).toContain(".data('taskId')")
  })

  it('also catches a data-task-id="..." JSX attribute (the pragma makes it the dataset key task-id)', async () => {
    const App = named('Board', () => createElement('div', { 'data-task-id': '7' }, 'x'))
    App.initialState = {}
    t = renderComponent(App)
    await t.ready()
    expect(diagnostics('SYG421').map(d => d.data.key)).toEqual(['task-id'])
  })

  it('does not report camelCase or single-word keys', async () => {
    const App = named('Board', () => createElement('div', { data: { taskId: 1, id: 2 }, 'data-value': '3' }, 'x'))
    App.initialState = {}
    t = renderComponent(App)
    await t.ready()
    expect(diagnostics('SYG421')).toEqual([])
  })
})

describe('canonical Escape-key pattern (G-143 docs)', () => {
  it("DOM.keydown('document').key().filter(k => k === 'Escape') fires on Escape only", async () => {
    const App = named('Modal', ({ state }) => createElement('div', null, state.open ? 'open' : 'closed'))
    App.initialState = { open: true }
    App.intent = ({ DOM }) => ({ CLOSE: DOM.keydown('document').key().filter(k => k === 'Escape') })
    App.model = { CLOSE: s => ({ ...s, open: false }) }
    t = renderComponent(App)
    await t.ready()
    t.simulateEvent('document', 'keydown', { key: 'Enter' })
    await settle(30)
    expect(t.state.open).toBe(true)
    t.simulateEvent('document', 'keydown', { key: 'Escape' })
    await t.waitForState(s => s.open === false)
    expect(diagnostics()).toEqual([])
  })
})
