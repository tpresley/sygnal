// @vitest-environment jsdom
// PLAN-4.6 R6: fixes of the R5 review (G-336 ... G-347), each pinned here (failing first).
import { describe, it, expect, vi, afterEach } from 'vitest'
import xs from 'xstream'
import { renderComponent } from '../src/extra/testing.js'
import { run, createElement as h, Collection, Transition, defineComponent } from '../src/index.js'

let t, app
afterEach(() => {
  t?.dispose(); t = null
  app?.dispose(); app = null
  vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

describe('G-338: a single-stream intent (removed) fails with a message naming the form', () => {
  it('names the removed form and links the migration guide, not a stream internal', () => {
    document.body.innerHTML = '<div id="root"></div>'
    function App({ state }) { return h('div', null, 'x' + state.n) }
    App.initialState = { n: 0 }
    App.intent = () => xs.never()
    App.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
    let err
    try { app = run(App, {}, { mountPoint: '#root' }) } catch (e) { err = e }
    expect(err).toBeTruthy()
    expect(err.message).toContain('[Sygnal SYG603] App:')
    expect(err.message).toContain('single stream')
    expect(err.message).toContain('https://sygnal.js.org/guide/migrating-to-6#leftovers')
    expect(err.message).not.toContain('_prod')
  })
})

describe('G-339: SYG403 says context entries are functions of state only', () => {
  it('a state-key string entry (removed) is skipped with the 6.0 fix text', async () => {
    const errors = []
    vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a.map(String).join(' ')))
    function Leaf({ context }) { return h('i', null, String(context.user)) }
    function App() { return h('div', null, h(Leaf)) }
    App.initialState = { currentUser: 'ann' }
    App.context = { user: 'currentUser' }
    t = renderComponent(App)
    await t.ready()
    const msg = errors.find(e => e.includes('SYG403'))
    expect(msg).toBeTruthy()
    expect(msg).toContain('functions of state only')
    expect(msg).toContain('migrating-to-6#leftovers')
    expect(msg).not.toContain('state key')
  })
})

describe("G-346: a simulate* call's cursor expiry timer does not outlive the next() that used it", () => {
  function App({ state }) { return h('div', null, String(state.n)) }
  App.initialState = { n: 0 }
  App.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }

  it('no pending timer after simulateAction + next() under fake timers', async () => {
    vi.useFakeTimers()
    t = renderComponent(App)
    await t.ready()
    t.simulateAction('INC')
    const s = await t.next()
    expect(s.n).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("G-326 kept: a macrotask between the call and next() expires the cursor (next() gets the state after)", async () => {
    App.model.LATER = { EFFECT: (s, d, next) => next('INC', null, 50) }
    try {
      t = renderComponent(App)
      await t.ready()
      t.simulateAction('LATER')
      await sleep(0)
      const s = await t.next()
      expect(s.n).toBe(1)
    } finally { delete App.model.LATER }
  })
})

describe('G-343: defineComponent names and statics', () => {
  it("an inline view in the options object is not named 'view'", () => {
    const C = defineComponent({ view: ({ state }) => h('b', null, 'x'), initialState: {} })
    expect(C.componentName).toBe('Component')
    expect(C.name).toBe('Component')
    function Named() { return h('b', null, 'n') }
    expect(defineComponent({ view: Named }).componentName).toBe('Named')
    expect(defineComponent({ name: 'Given', view: () => h('b') }).componentName).toBe('Given')
  })

  it('statics already on the view are kept; the options override them', async () => {
    function Card({ state }) { return h('p', { className: 'card' }, `${state.n}:${state.tag}`) }
    Card.initialState = { n: 1, tag: 'view' }
    Card.calculated = { tag: () => 'calc' }
    const Plain = defineComponent({ view: Card })
    expect(Plain.initialState).toEqual({ n: 1, tag: 'view' })
    expect(Plain.calculated).toBe(Card.calculated)
    const Over = defineComponent({ view: Card, initialState: { n: 2, tag: 'opt' } })
    expect(Over.initialState).toEqual({ n: 2, tag: 'opt' })
    expect(Card.initialState).toEqual({ n: 1, tag: 'view' })
    t = renderComponent(Over)
    await t.ready()
    expect(t.html()).toContain('2:calc')
  })
})

describe('G-342: behaviour kept from tests deleted with the old core', () => {
  it('G-264: a props object lent to a child is not written', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const shared = Object.freeze({ label: 'L' })
    const open = { label: 'M' }
    function Child({ label }) { return h('b', { className: 'c' }, label) }
    function App() { return h('div', null, h(Child, shared), h(Child, open), h(Child, { props: open })) }
    App.initialState = {}
    app = run(App, {}, { mountPoint: '#root' })
    await sleep(20)
    expect([...document.querySelectorAll('.c')].map(e => e.textContent).slice(0, 2)).toEqual(['L', 'M'])
    expect(open).toEqual({ label: 'M' })
    expect(shared).toEqual({ label: 'L' })
  })

  it('G-267: a producer whose stop() throws does not keep the other streams running, and the error is reported', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const errors = []
    vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a))
    const uncaught = []
    const onUncaught = (e) => uncaught.push(e)
    process.on('uncaughtException', onUncaught)
    const appErrors = []
    let stopped = 0
    const mk = (id) => xs.create({ start() {}, stop() { if (id === 1) throw new Error('boom'); stopped++ } })
    function Item({ state }) { return h('li', null, String(state.id)) }
    Item.intent = ({ STATE }) => ({ X: STATE.stream.map(s => mk(s.id)).flatten() })
    Item.model = { X: (s) => s }
    function App() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    App.initialState = { items: [{ id: 1 }, { id: 2 }, { id: 3 }] }
    App.intent = ({ DOM }) => ({ CLR: DOM.select('ul').events('click') })
    App.model = { CLR: () => ({ items: [] }) }
    try {
      app = run(App, {}, { mountPoint: '#root', onError: (e, info) => appErrors.push([e, info]) })
      await sleep(20)
      document.querySelector('ul').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(50)
    } finally { process.off('uncaughtException', onUncaught) }
    expect(stopped).toBe(2)
    expect(document.querySelectorAll('li').length).toBe(0)
    // reported: to the app's onError, and logged
    expect(appErrors.map(([e]) => e.message)).toContain('boom')
    expect(errors.some(a => a.some(x => x?.message === 'boom' || String(x).includes('boom')))).toBe(true)
    expect(uncaught).toEqual([])
  })

  it('B-003: a sink sees the reducer result of an action in the same tick', async () => {
    const seen = []
    let l
    const $ = xs.create({ start(x) { l = x }, stop() {} })
    function C() { return h('div', null) }
    C.initialState = { n: 0 }
    C.intent = () => ({ INC: $.filter(e => e === 'inc'), LOOK: $.filter(e => e === 'look') })
    C.model = { INC: (s) => ({ ...s, n: s.n + 1 }), LOOK: { EFFECT: (s) => { seen.push(s.n) } } }
    t = renderComponent(C)
    await t.ready(); await t.settle()
    l.next('inc'); l.next('look')
    await t.settle()
    expect(seen).toEqual([1])
  })

  it('a child gets its children as written (markers unprocessed); the HTML is the same', async () => {
    let seen
    function Wrap({ children }) { seen = children; return h('div', { className: 'wrap' }, ...children) }
    function App() { return h('div', null, h(Wrap, null, h(Transition, { name: 'fade' }, h('p', null, 'x')))) }
    App.initialState = {}
    t = renderComponent(App)
    await t.ready(); await t.settle()
    expect(seen[0].sel).toBe('transition')
    expect(t.html()).toContain('<div class="wrap"><p')
    expect(t.html()).toContain('>x</p></div>')
  })
})
