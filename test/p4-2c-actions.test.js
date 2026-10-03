// @vitest-environment jsdom
// PLAN-4 2-C (GS-10): renderComponent's t.actions, the action log of the rendered tree:
// { type, data, component, instance, sinks, cause, at } per action, causes 'intent' | 'next' |
// 'reply' | 'built-in' | 'simulateAction' | 'behavior' (2-A2: from the instance's
// `_behaviorActions`, 2-B's `uses` merge), in the mock and the real DOM and under fake timers;
// t.explain(pred); inspect({ actions: true }).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection, ABORT, controls } from '../src/index.js'
import { event } from '../src/extra/reducers.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'
import { defineBehavior } from '../src/extra/behaviors.js'

let t
afterEach(() => {
  if (t) t.dispose()
  t = null
  vi.useRealTimers()
  _resetDiagnostics()
  document.body.innerHTML = ''
})

const MODES = [['mock', {}], ['real', { dom: 'real' }]]
const of = (type) => t.actions.filter(a => a.type === type)

function Counter({ state }) {
  return h('div', null, h('button', { className: 'inc' }, '+'), h('span', { className: 'n' }, String(state.count)))
}
Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Counter.model = {
  INC: (s) => ({ ...s, count: s.count + 1 }),
  SET: (s, n) => ({ ...s, count: n }),
}

describe.each(MODES)('t.actions (%s DOM)', (_, opts) => {
  it("an intent action: cause 'intent', its component, sinks and data", async () => {
    t = renderComponent(Counter, opts)
    await t.ready()
    t.simulateEvent('.inc', 'click')
    await t.next(s => s.count === 1)
    const [inc] = of('INC')
    expect(inc).toMatchObject({ type: 'INC', component: 'Counter', cause: 'intent', sinks: ['STATE'] })
    expect(typeof inc.instance).toBe('string')
    expect(typeof inc.at).toBe('number')
    expect(inc.data).toBeDefined() // the DOM event
  })

  it("simulateAction: cause 'simulateAction'", async () => {
    t = renderComponent(Counter, opts)
    t.simulateAction('SET', 5)
    await t.waitForState(s => s.count === 5)
    expect(of('SET')).toEqual([expect.objectContaining({ type: 'SET', data: 5, cause: 'simulateAction', sinks: ['STATE'], component: 'Counter' })])
  })

  it("INITIALIZE (and BOOTSTRAP) are 'built-in'", async () => {
    const Boot = (p) => Counter(p)
    Boot.initialState = { count: 0 }
    Boot.model = { BOOTSTRAP: { EFFECT: () => {} }, INC: Counter.model.INC }
    t = renderComponent(Boot, opts)
    await t.ready()
    await t.settle()
    expect(of('INITIALIZE')).toEqual([expect.objectContaining({ cause: 'built-in', sinks: ['STATE'], data: { count: 0 } })])
    expect(of('BOOTSTRAP')).toEqual([expect.objectContaining({ cause: 'built-in', sinks: ['EFFECT'] })])
    expect(t.actions[0].type).toBe('INITIALIZE')
  })
})

// 2-A2 (GS-10 + GS-1): a behavior's own trigger is 'behavior', with the namespaced type
const pager = defineBehavior({
  initialState: { page: 0 },
  intent: ({ DOM }, { next }) => ({ NEXT: DOM.click(next) }),
  model: { NEXT: (p) => ({ ...p, page: p.page + 1 }) },
})
const { Newer, Go } = controls({ Newer: 'button', Go: 'button' })

describe.each(MODES)("cause 'behavior' (%s DOM)", (_, opts) => {
  it("a behavior's intent action: cause 'behavior', the namespaced type, the host component", async () => {
    function List({ state }) { return h('div', null, h(Newer, null, '›'), h('span', null, String(state.pager.page))) }
    List.uses = { pager: pager({ next: Newer }) }
    t = renderComponent(List, opts)
    await t.ready()
    t.simulateEvent(Newer, 'click')
    await t.next(s => s.pager.page === 1)
    expect(of('pager.NEXT')).toEqual([expect.objectContaining({ type: 'pager.NEXT', component: 'List', cause: 'behavior', sinks: ['STATE'] })])
    expect(of('NEXT')).toEqual([])
  })

  it("a host intent action with the namespaced name is host-owned: 'intent'", async () => {
    function List({ state }) { return h('div', null, h(Newer, null, '›'), h(Go, null, 'go'), String(state.pager.page)) }
    List.uses = { pager: pager({ next: Newer }) }
    List.intent = ({ DOM }) => ({ 'pager.NEXT': DOM.click(Go) })
    t = renderComponent(List, opts)
    await t.ready()
    t.simulateEvent(Go, 'click')
    await t.next(s => s.pager.page === 1)
    expect(of('pager.NEXT')).toEqual([expect.objectContaining({ type: 'pager.NEXT', cause: 'intent', sinks: ['STATE'] })])
  })

  it("simulateAction('pager.NEXT') on a host with no entry for it runs the behavior's reducer: cause 'simulateAction'; its own trigger still works", async () => {
    function List({ state }) { return h('div', null, h(Newer, null, '›'), h('span', null, String(state.pager.page))) }
    List.initialState = { items: [] }
    List.uses = { pager: pager({ next: Newer }) }
    t = renderComponent(List, opts)
    await t.ready()
    t.simulateAction('pager.NEXT')
    await t.waitForState(s => s.pager.page === 1)
    expect(of('pager.NEXT')).toEqual([expect.objectContaining({ type: 'pager.NEXT', component: 'List', cause: 'simulateAction', sinks: ['STATE'] })])
    t.simulateEvent(Newer, 'click')
    await t.next(s => s.pager.page === 2)
    expect(of('pager.NEXT').map(a => a.cause)).toEqual(['simulateAction', 'behavior'])
  })

  it('simulateAction on a host with nothing but `uses` (no initialState, model or intent)', async () => {
    function Bare({ state }) { return h('span', null, String(state.pager.page)) }
    Bare.uses = { pager: pager({ next: Newer }) }
    t = renderComponent(Bare, opts)
    await t.ready()
    t.simulateAction('pager.NEXT')
    await t.waitForState(s => s.pager.page === 1)
    expect(of('pager.NEXT')[0]).toMatchObject({ cause: 'simulateAction', sinks: ['STATE'] })
  })

  it("a host action named under a behavior key that the behavior doesn't own is 'intent'", async () => {
    function List({ state }) { return h('div', null, h(Go, null, 'go'), String(state.pager.page)) }
    List.uses = { pager: pager({ next: Newer }) }
    List.intent = ({ DOM }) => ({ 'pager.RESET': DOM.click(Go) })
    List.model = { 'pager.RESET': (s) => ({ ...s, pager: { ...s.pager, page: 0 }, reset: true }) }
    t = renderComponent(List, opts)
    await t.ready()
    t.simulateEvent(Go, 'click')
    await t.next(s => s.reset)
    expect(of('pager.RESET')).toEqual([expect.objectContaining({ cause: 'intent', sinks: ['STATE'] })])
  })
})

describe("cause 'next'", () => {
  it("an action a reducer sent with next() is 'next'; at grows with the delay", async () => {
    function Later() { return h('div', null, h('button', { className: 'go' }, 'go')) }
    Later.initialState = { n: 0 }
    Later.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    Later.model = {
      GO: (s, _, next) => { next('DONE', 7, 30); return { ...s, n: 1 } },
      DONE: (s, d) => ({ ...s, n: d }),
    }
    t = renderComponent(Later)
    t.simulateEvent('.go', 'click')
    await t.waitForState(s => s.n === 7)
    const [go] = of('GO'), [done] = of('DONE')
    expect(go.cause).toBe('intent')
    expect(done).toMatchObject({ cause: 'next', data: 7, sinks: ['STATE'], component: 'Later' })
    expect(done.at - go.at).toBeGreaterThanOrEqual(25)
  })

  it("an EFFECT's next() is 'next' too", async () => {
    function E() { return h('div') }
    E.initialState = { v: 0 }
    E.model = { KICK: { EFFECT: (s, d, next) => next('SETV', 3, 0) }, SETV: (s, v) => ({ ...s, v }) }
    t = renderComponent(E)
    t.simulateAction('KICK')
    await t.waitForState(s => s.v === 3)
    expect(of('KICK')[0]).toMatchObject({ cause: 'simulateAction', sinks: ['EFFECT'] })
    expect(of('SETV')[0]).toMatchObject({ cause: 'next', sinks: ['STATE'] })
  })
})

describe("cause 'reply'", () => {
  function Quote({ state }) { return h('div', null, h('button', { className: 'get' }, 'Get'), h('p', null, state.text)) }
  Quote.initialState = { text: '', status: 'idle' }
  Quote.intent = ({ DOM }) => ({ LOAD: DOM.click('.get') })
  Quote.model = {
    LOAD: { STATE: s => ({ ...s, status: 'loading' }), HTTP: () => ({ url: '/api/quote', ok: 'LOADED', error: 'FAILED' }) },
    LOADED: (s, q) => ({ ...s, status: 'done', text: q.text }),
    FAILED: (s) => ({ ...s, status: 'error' }),
  }

  it.each(MODES)("a reply action (ok / error) is 'reply'; the request's sinks are listed (%s DOM)", async (_, opts) => {
    t = renderComponent(Quote, opts)
    t.simulateEvent('.get', 'click')
    await t.respond('HTTP', { text: 'Hi' }, 'LOADED')
    expect(of('LOAD')[0]).toMatchObject({ cause: 'intent', sinks: ['STATE', 'HTTP'] })
    expect(of('LOADED')[0]).toMatchObject({ cause: 'reply', data: { text: 'Hi' }, sinks: ['STATE'] })
    t.simulateEvent('.get', 'click')
    await t.fail('HTTP', 500)
    expect(of('FAILED')[0]).toMatchObject({ cause: 'reply', sinks: ['STATE'] })
  })
})

describe('sinks', () => {
  it('lists only the sinks that produced a value (ABORT and EFFECT-less entries are left out)', async () => {
    function S() { return h('div') }
    S.initialState = { n: 0 }
    S.model = {
      BOTH: { STATE: (s) => ({ ...s, n: s.n + 1 }), EVENTS: event('BOTH_DONE', () => 1) },
      EV_ONLY: { STATE: () => ABORT, EVENTS: event('ONLY', () => 2) },
      NONE: { STATE: () => ABORT, EVENTS: () => ABORT },
      CONST: { LOG: 'hello' },
      UNKNOWN_HERE: undefined,
    }
    delete S.model.UNKNOWN_HERE
    t = renderComponent(S)
    t.simulateAction('BOTH')
    t.simulateAction('EV_ONLY')
    t.simulateAction('NONE')
    t.simulateAction('CONST')
    await t.settle()
    expect(of('BOTH')[0].sinks.slice().sort()).toEqual(['EVENTS', 'STATE'])
    expect(of('EV_ONLY')[0].sinks).toEqual(['EVENTS'])
    expect(of('NONE')[0].sinks).toEqual([])
    expect(of('CONST')[0].sinks).toEqual(['LOG'])
  })

  it('an action with no model entry is logged with no sinks', async () => {
    function N() { return h('div', null, h('button', { className: 'b' })) }
    N.initialState = {}
    N.intent = ({ DOM }) => ({ ORPHAN: DOM.click('.b') })
    t = renderComponent(N)
    t.simulateEvent('.b', 'click')
    await t.settle()
    expect(of('ORPHAN')).toEqual([expect.objectContaining({ cause: 'intent', sinks: [] })])
  })

  it('a PARENT value is listed', async () => {
    function Kid() { return h('button', { className: 'k' }, 'k') }
    Kid.intent = ({ DOM }) => ({ TELL: DOM.click('.k') })
    Kid.model = { TELL: { PARENT: () => 'hi' } }
    function Dad() { return h('div', null, h(Kid)) }
    Dad.initialState = { got: null }
    Dad.intent = ({ CHILD }) => ({ HEARD: CHILD.select(Kid) })
    Dad.model = { HEARD: (s, got) => ({ ...s, got }) }
    t = renderComponent(Dad)
    t.simulateEvent('.k', 'click')
    await t.waitForState(s => s.got === 'hi')
    expect(of('TELL')[0]).toMatchObject({ component: 'Kid', cause: 'intent', sinks: ['PARENT'] })
    expect(of('HEARD')[0]).toMatchObject({ component: 'Dad', cause: 'intent', sinks: ['STATE'] })
  })
})

describe('children and Collection items', () => {
  function Item({ state }) { return h('li', null, h('button', { className: 'del' }, String(state.id))) }
  Item.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.del') })
  Item.model = { TOGGLE: (s) => ({ ...s, done: !s.done }) }
  function List() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
  List.initialState = { items: [{ id: 1, done: false }, { id: 2, done: false }] }

  it.each(MODES)('each item instance has its own stable id (%s DOM)', async (_, opts) => {
    t = renderComponent(List, opts)
    await t.ready()
    t.simulateEvent('li:nth-child(2) .del', 'click')
    await t.waitForState(s => s.items[1].done)
    t.simulateEvent('li:nth-child(1) .del', 'click')
    await t.waitForState(s => s.items[0].done)
    t.simulateEvent('li:nth-child(2) .del', 'click')
    await t.waitForState(s => !s.items[1].done)
    const toggles = of('TOGGLE')
    expect(toggles).toHaveLength(3)
    expect(toggles.every(a => a.component === 'Item' && a.cause === 'intent' && a.sinks.includes('STATE'))).toBe(true)
    expect(toggles[0].instance).not.toBe(toggles[1].instance)
    expect(toggles[0].instance).toBe(toggles[2].instance)
    const root = of('INITIALIZE').find(a => a.component === 'List')
    expect(root.instance).not.toBe(toggles[0].instance)
  })
})

describe('fake timers', () => {
  it('records under vi.useFakeTimers(); at is clock time since render', async () => {
    vi.useFakeTimers()
    function Later() { return h('div') }
    Later.initialState = { n: 0 }
    Later.model = { GO: (s, _, next) => { next('DONE', 1, 500); return s.n ? s : { ...s, n: 1 } }, DONE: (s) => ({ ...s, n: 2 }) }
    t = renderComponent(Later)
    t.simulateAction('GO')
    await t.waitForState(s => s.n === 2)
    const [go] = of('GO'), [done] = of('DONE')
    expect(go.cause).toBe('simulateAction')
    expect(done.cause).toBe('next')
    expect(done.at - go.at).toBeGreaterThanOrEqual(500)
    expect(done.at).toBeLessThan(5000)
  })
})

describe('t.actions is live and t.explain()', () => {
  it('grows as actions run', async () => {
    t = renderComponent(Counter)
    const list = t.actions
    t.simulateAction('SET', 1)
    await t.waitForState(s => s.count === 1)
    t.simulateAction('SET', 2)
    await t.waitForState(s => s.count === 2)
    expect(list).toBe(t.actions)
    expect(list.filter(a => a.type === 'SET').map(a => a.data)).toEqual([1, 2])
  })

  it('explain(pred) returns the first action whose resulting state matches, with the reducer', async () => {
    t = renderComponent(Counter)
    await t.ready()
    t.simulateEvent('.inc', 'click')
    t.simulateEvent('.inc', 'click')
    t.simulateAction('SET', 10)
    await t.waitForState(s => s.count === 10)
    const e = t.explain(s => s.count === 2)
    expect(e).toMatchObject({ type: 'INC', cause: 'intent', state: { count: 2 } })
    expect(e.reducer).toMatchObject({ sink: 'STATE' })
    expect(e.reducer.source).toContain('count + 1')
    expect(t.explain(s => s.count === 10)).toMatchObject({ type: 'SET', cause: 'simulateAction' })
    expect(t.explain(s => s.count === 0)).toMatchObject({ type: 'INITIALIZE', cause: 'built-in' })
    expect(t.explain(s => s.count === 99)).toBeUndefined()
  })

  it("a child's action explains the root state it produced", async () => {
    function Kid({ state }) { return h('button', { className: 'k' }, String(state.v)) }
    Kid.intent = ({ DOM }) => ({ BUMP: DOM.click('.k') })
    Kid.model = { BUMP: (s) => ({ ...s, v: s.v + 1 }) }
    function Dad() { return h('div', null, h(Kid, { state: 'kid' })) }
    Dad.initialState = { kid: { v: 0 } }
    t = renderComponent(Dad)
    t.simulateEvent('.k', 'click')
    await t.waitForState(s => s.kid.v === 1)
    expect(t.explain(s => s.kid.v === 1)).toMatchObject({ type: 'BUMP', component: 'Kid' })
  })
})

describe('scope and cause slots', () => {
  it("only this renderComponent's components are listed (two live at once)", async () => {
    const a = renderComponent(Counter)
    function Other() { return h('div') }
    Other.initialState = { x: 1 }
    const b = renderComponent(Other)
    try {
      a.simulateAction('SET', 3)
      await a.waitForState(s => s.count === 3)
      await b.settle()
      expect(new Set(a.actions.map(x => x.component))).toEqual(new Set(['Counter']))
      expect(b.actions.map(x => `${x.component}:${x.type}`)).toEqual(['Other:INITIALIZE'])
    } finally { a.dispose(); b.dispose() }
  })

  it("an action a simulated one triggers synchronously (EVENTS to a child's intent) is 'intent'", async () => {
    function Ear({ state }) { return h('p', null, String(state.heard)) }
    Ear.intent = ({ EVENTS }) => ({ HEAR: EVENTS.select('PINGED') })
    Ear.model = { HEAR: (s) => ({ ...s, heard: s.heard + 1 }) }
    function Mouth() { return h('div', null, h(Ear, { state: 'ear' })) }
    Mouth.initialState = { ear: { heard: 0 } }
    Mouth.model = { PING: { EVENTS: event('PINGED', () => 1) } }
    t = renderComponent(Mouth)
    await t.ready()
    t.simulateAction('PING')
    await t.waitForState(s => s.ear.heard === 1)
    expect(of('PING')[0]).toMatchObject({ component: 'Mouth', cause: 'simulateAction', sinks: ['EVENTS'] })
    expect(of('HEAR')[0]).toMatchObject({ component: 'Ear', cause: 'intent', sinks: ['STATE'] })
  })

  it("DISPOSE is 'built-in'", async () => {
    let cleaned = 0
    function D() { return h('div') }
    D.initialState = {}
    D.model = { DISPOSE: { EFFECT: () => { cleaned++ } } }
    t = renderComponent(D)
    await t.ready()
    const list = t.actions
    t.dispose()
    t = null
    expect(cleaned).toBe(1)
    expect(list.find(a => a.type === 'DISPOSE')).toMatchObject({ cause: 'built-in', sinks: ['EFFECT'] })
  })
})
