// Spike 0-S (PLAN-4.6): behaviour tests of the extended prototype core (proto/core-next.ts),
// items 1-9 of the spike. Cases are adapted from the current core's suites (named per test).
//   npm run build && npx vitest run --config dev-plans/research/core-rewrite/proto/vitest.config.mjs
import { describe, it, expect, afterEach, vi } from 'vitest'
import { xs, createElement as h, Collection, Switchable, ABORT, makeTimerDriver, makeFetchDriver } from 'sygnal'
import { run } from './core-next.ts'
import { defOf } from './define.ts'
import { Suspense, lazy } from './markers.ts'
import { undo } from './uses.ts'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 2 })
let apps = []
afterEach(() => { apps.forEach(a => { try { a.dispose() } catch (_) {} }); apps = []; document.body.innerHTML = ''; vi.useRealTimers(); vi.restoreAllMocks() })

function mount(App, drivers = {}, hooks = {}) {
  document.body.innerHTML = '<div id="root"></div>'
  const patches = []
  const app = run(App, drivers, { mountPoint: '#root', hooks: { ...hooks, onPatch: (v) => patches.push(v) } })
  apps.push(app)
  return { app, patches, $: (s) => document.querySelector(s), $$: (s) => [...document.querySelectorAll(s)], text: (s) => document.querySelector(s)?.textContent }
}
const click = (el) => (typeof el == 'string' ? document.querySelector(el) : el).dispatchEvent(new MouseEvent('click', { bubbles: true }))

// ============================================================================ 1. calculated
describe('1. calculated fields (cell decorator)', () => {
  it('fn and [deps, fn] in the view and reducers; topological order regardless of declaration order', async () => {
    const calls = { total: 0 }
    function C({ state }) { return h('p', { className: 'o' }, `${state.label}|${state.total}|${state.double}`) }
    C.initialState = { a: 1, b: 2, name: 'x' }
    // declared out of order: label depends on total (calculated) which depends on a, b
    C.calculated = {
      label: [['total', 'name'], (s) => `${s.name}=${s.total}`],
      total: [['a', 'b'], (s) => { calls.total++; return s.a + s.b }],
      double: (s) => s.total * 2,
    }
    C.intent = ({ DOM }) => ({ INC: DOM.click('.o'), RENAME: DOM.dblclick('.o') })
    let seen
    C.model = { INC: (s) => { seen = s.total; return { ...s, a: s.a + 1 } }, RENAME: (s) => ({ ...s, name: s.name + 'y' }) }
    const m = mount(C)
    await until(() => expect(m.text('.o')).toBe('x=3|3|6'))
    click('.o')
    await until(() => expect(m.text('.o')).toBe('x=4|4|8'))
    expect(seen).toBe(3) // reducers get the calculated fields of the state before the action
    const before = calls.total
    m.$('.o').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await until(() => expect(m.text('.o')).toBe('xy=4|4|8'))
    expect(calls.total).toBe(before) // memoized on its deps: name changed, a and b did not
    // stored in state (storeCalculatedInState's default)
    expect(m.app.state).toMatchObject({ a: 2, total: 4, double: 8, label: 'xy=4' })
  })

  it('SYG209: a cycle throws at definition, with the cycle path', () => {
    function Bad() { return h('div') }
    Bad.calculated = { a: [['b'], (s) => s.b], b: [['c'], (s) => s.c], c: [['a'], (s) => s.a], ok: (s) => 1 }
    expect(() => defOf(Bad)).toThrow(/SYG209.*Circular calculated dependency: (a → b → c → a|b → c → a → b|c → a → b → c)/)
    function Bad2() { return h('div') }
    Bad2.calculated = { x: 1 }
    expect(() => defOf(Bad2)).toThrow(/SYG206.*Invalid calculated field 'x'/)
  })

  it("a child sees its parent's calculated fields; a child bound to a calculated field can't write it (SYG409)", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    function Kid({ state }) { return h('i', { className: 'k' }, String(state)) }
    Kid.intent = ({ DOM }) => ({ W: DOM.click('.k') })
    Kid.model = { W: () => 99 }
    function Whole({ state }) { return h('b', { className: 'w' }, String(state.sum)) }
    function P() { return h('div', null, h(Whole), h(Kid, { state: 'sum' })) }
    P.initialState = { a: 2, b: 3 }
    P.calculated = { sum: [['a', 'b'], (s) => s.a + s.b] }
    const m = mount(P)
    await until(() => expect(m.text('.w') + m.text('.k')).toBe('55'))
    click('.k')
    await sleep(20)
    expect(m.text('.k')).toBe('5')
    expect(warn.mock.calls.some(c => String(c[0]).includes('SYG409'))).toBe(true)
  })
})

// ============================================================================ 2. Collection
function Row({ state }) { return h('li', { className: 'row', 'data-id': String(state.id) }, state.text, h('button', { className: 'edit' }, 'e'), h('button', { className: 'del' }, 'x')) }
Row.intent = ({ DOM }) => ({ EDIT: DOM.click('.edit'), DEL: DOM.click('.del') })
Row.model = { EDIT: (s) => ({ ...s, text: s.text + '!' }), DEL: () => undefined }
const texts = () => [...document.querySelectorAll('.row')].map(li => li.firstChild.textContent)

describe('2. Collection: filter, sort, removal, write-back (PF-1 cases)', () => {
  const rows = [{ id: 1, text: 'c', n: 2, done: false }, { id: 2, text: 'a', n: 1, done: true }, { id: 3, text: 'b', n: 2, done: false }, { id: 4, text: 'd', n: 1, done: false }]
  const listWith = (props) => {
    function L({ state }) { return h('ul', null, h(Collection, { of: Row, from: 'rows', ...props(state) })) }
    L.initialState = { rows, mode: 0 }
    L.intent = ({ DOM }) => ({ MODE: DOM.click('#root') })
    return L
  }

  it.each([
    ['field name', () => ({ sort: 'text' }), ['a', 'b', 'c', 'd']],
    ['{ field: "desc" }', () => ({ sort: { text: 'desc' } }), ['d', 'c', 'b', 'a']],
    ['{ field: -1 }', () => ({ sort: { text: -1 } }), ['d', 'c', 'b', 'a']],
    ['array (n asc, then text desc)', () => ({ sort: ['n', { text: 'desc' }] }), ['d', 'a', 'c', 'b']],
    ['compare function', () => ({ sort: (x, y) => y.id - x.id }), ['d', 'b', 'a', 'c']],
    ['filter + sort', () => ({ filter: (r) => !r.done, sort: 'text' }), ['b', 'c', 'd']],
  ])('sort form: %s', async (_, props, want) => {
    const m = mount(listWith(props))
    await until(() => expect(texts()).toEqual(want))
  })

  it("an item's edit is written back to its own element; the state array keeps its order", async () => {
    const m = mount(listWith(() => ({ filter: (r) => !r.done, sort: { text: 'desc' } })))
    await until(() => expect(texts()).toEqual(['d', 'c', 'b']))
    const before = m.app.state.rows
    click(m.$$('.edit')[1]) // 'c' (id 1)
    await until(() => expect(texts()).toEqual(['d', 'c!', 'b']))
    expect(m.app.state.rows.map(r => r.text)).toEqual(['c!', 'a', 'b', 'd'])
    expect(m.app.state.rows[1]).toBe(before[1]) // the filtered-out one is untouched
    expect(m.app.state.rows[2]).toBe(before[2])
  })

  it('an item removing itself (returning undefined) removes only that element; a filter change re-filters', async () => {
    function L({ state }) { return h('ul', null, h(Collection, { of: Row, from: 'rows', filter: state.hideDone ? (r) => !r.done : undefined })) }
    L.initialState = { rows, hideDone: false }
    L.intent = ({ DOM }) => ({ T: DOM.click('#root') })
    const m = mount(L)
    await until(() => expect(texts()).toEqual(['c', 'a', 'b', 'd']))
    const keep = m.app.state.rows[3]
    click(m.$$('.del')[2]) // b
    await until(() => expect(texts()).toEqual(['c', 'a', 'd']))
    expect(m.app.state.rows.map(r => r.text)).toEqual(['c', 'a', 'd'])
    expect(m.app.state.rows[2]).toBe(keep)
  })

  it('items without ids are keyed by index (write-back adds the id); primitives are written back as primitives', async () => {
    function P({ state }) { return h('li', { className: 'row' }, String(state.value ?? state.text), h('button', { className: 'edit' }, '+')) }
    P.intent = ({ DOM }) => ({ INC: DOM.click('.edit') })
    P.model = { INC: (s) => (s.value !== undefined ? { ...s, value: s.value + 10 } : { ...s, text: s.text + '!' }) }
    function L() { return h('div', null, h(Collection, { of: P, from: 'nums', className: 'nums' }), h(Collection, { of: P, from: 'objs', className: 'objs' })) }
    L.initialState = { nums: [1, 2, 3], objs: [{ text: 'a' }, { text: 'b' }] }
    const m = mount(L)
    await until(() => expect(texts()).toEqual(['1', '2', '3', 'a', 'b']))
    click(m.$$('.nums .edit')[2])
    await until(() => expect(m.app.state.nums).toEqual([1, 2, 13]))
    click(m.$$('.objs .edit')[1])
    await until(() => expect(m.app.state.objs).toEqual([{ text: 'a' }, { text: 'b!', id: 1 }]))
    expect(texts()).toEqual(['1', '2', '13', 'a', 'b!'])
  })

  it('a parent change elsewhere does not re-render the items (PF-1)', async () => {
    let views = 0
    function Item({ state }) { views++; return h('li', null, state.text) }
    function L({ state }) { return h('div', null, h('b', { className: 'n' }, String(state.n)), h(Collection, { of: Item, from: 'rows' })) }
    L.initialState = { n: 0, rows: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }] }
    L.intent = ({ DOM }) => ({ BUMP: DOM.click('.n') })
    L.model = { BUMP: (s) => ({ ...s, n: s.n + 1 }) }
    const m = mount(L)
    await until(() => expect(m.text('.n')).toBe('0'))
    const v = views
    click('.n')
    await until(() => expect(m.text('.n')).toBe('1'))
    expect(views).toBe(v)
  })

  // G-257 (test/p45-r-g257.test.js): a cross-Collection move of items with intent + model
  function Item({ state }) { return h('li', { className: 'item' }, h('button', { className: 'x' }, state.id + ':' + (state.n || 0))) }
  Item.intent = ({ DOM }) => ({ CLICK: DOM.click('.x') })
  Item.model = { CLICK: (s) => ({ ...s, n: (s.n || 0) + 1 }) }
  function Lanes() {
    return h('div', null, h('button', { className: 'mv' }, 'mv'),
      h('ul', { className: 'l' }, h(Collection, { of: Item, from: 'left' })),
      h('ul', { className: 'r' }, h(Collection, { of: Item, from: 'right' })))
  }
  Lanes.initialState = { left: [{ id: 'x' }, { id: 'y' }], right: [{ id: 'z' }] }
  Lanes.intent = ({ DOM }) => ({ MV: DOM.click('.mv') })
  Lanes.model = { MV: (s) => ({ left: s.left.slice(1), right: [...s.right, s.left[0]] }) }

  it('G-257: a move between Collections is one patch, and no DOM state in between misses the item', async () => {
    const m = mount(Lanes)
    await until(() => expect(m.$$('.item').length).toBe(3))
    await sleep(20)
    const before = m.patches.length, counts = []
    const mo = new MutationObserver(() => counts.push(m.$$('.item').length))
    mo.observe(document.body, { subtree: true, childList: true })
    click('.mv')
    await until(() => expect(m.$$('.r .item').map(e => e.textContent)).toEqual(['z:0', 'x:0']))
    await sleep(20)
    mo.disconnect()
    expect(m.patches.length - before).toBe(1)
    expect(counts.length).toBeGreaterThan(0)
    expect(counts.every(n => n == 3)).toBe(true)
  })

  it('G-257: the moved item responds to a click as soon as it is visible (D153)', async () => {
    const m = mount(Lanes)
    await until(() => expect(m.$$('.item').length).toBe(3))
    click('.mv')
    await until(() => expect(m.$$('.r .item').length).toBe(2))
    click(m.$$('.r .x')[1])
    await until(() => expect(m.$$('.r .item').map(e => e.textContent)).toEqual(['z:0', 'x:1']))
  })
})

// ============================================================================ 3. Switchable
describe('3. Switchable: hidden pages kept alive, current, instance', () => {
  let renders
  function Counter({ state }) { renders[state.tag] = (renders[state.tag] || 0) + 1; return h('section', { className: state.tag }, h('button', { className: 'inc' }, `${state.tag}:${state.n}`)) }
  Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
  Counter.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
  function Local({ state }) { return h('section', { className: 'local' }, h('button', { className: 'linc' }, `local:${state.k}`)) }
  Local.isolatedState = true
  Local.initialState = { k: 0 }
  Local.intent = ({ DOM }) => ({ INC: DOM.click('.linc') })
  Local.model = { INC: (s) => ({ ...s, k: s.k + 1 }), DISPOSE: { EFFECT: () => disposed.push('local') } }
  let disposed
  function Tabs({ state }) {
    return h('div', null, h('button', { className: 'go-a' }, 'a'), h('button', { className: 'go-l' }, 'l'), h('button', { className: 'bump' }, 'bump'), h('button', { className: 'reinst' }, 'r'),
      h('main', null, h(Switchable, { of: { a: Counter, l: Local }, current: state.page, state: 'pageA', instance: state.inst })))
  }
  Tabs.initialState = { page: 'a', inst: 1, pageA: { tag: 'pa', n: 0 } }
  Tabs.intent = ({ DOM, CHILD }) => ({ A: DOM.click('.go-a'), L: DOM.click('.go-l'), BUMP: DOM.click('.bump'), RE: DOM.click('.reinst') })
  Tabs.model = {
    A: (s) => ({ ...s, page: 'a' }), L: (s) => ({ ...s, page: 'l' }),
    BUMP: (s) => ({ ...s, pageA: { ...s.pageA, n: s.pageA.n + 100 } }),
    RE: (s) => ({ ...s, inst: s.inst + 1 }),
  }

  it("a hidden page does not re-render on state changes; it renders the current state when shown; local state survives switches", async () => {
    renders = {}; disposed = []
    const m = mount(Tabs)
    await until(() => expect(m.text('.inc')).toBe('pa:0'))
    click('.go-l')
    await until(() => expect(m.text('.linc')).toBe('local:0'))
    click('.linc'); click('.linc')
    await until(() => expect(m.text('.linc')).toBe('local:2'))
    const r = renders.pa
    click('.bump')
    await sleep(20)
    expect(renders.pa).toBe(r) // hidden: render skipped
    expect(m.$('.pa')).toBe(null)
    click('.go-a')
    await until(() => expect(m.text('.inc')).toBe('pa:100'))
    click('.go-l')
    await until(() => expect(m.text('.linc')).toBe('local:2')) // kept alive
    expect(disposed).toEqual([])
  })

  it('an instance change re-creates the current page (fresh local state, DISPOSE); a hidden page is re-created when shown', async () => {
    renders = {}; disposed = []
    const m = mount(Tabs)
    await until(() => expect(m.text('.inc')).toBe('pa:0'))
    click('.go-l')
    await until(() => expect(m.$('.linc')).toBeTruthy())
    click('.linc')
    await until(() => expect(m.text('.linc')).toBe('local:1'))
    click('.reinst')
    await until(() => expect(m.text('.linc')).toBe('local:0'))
    expect(disposed).toEqual(['local'])
  })

  it("a hidden page's actions still run and its PARENT reaches the parent's CHILD.select(Page)", async () => {
    function Page({ state }) { return h('p', { className: 'pg' }, String(state.v)) }
    Page.intent = ({ DOM }) => ({ T: DOM.click('.pg'), TICK: xs.periodic(5).take(3) })
    Page.model = { TICK: { STATE: (s) => ({ ...s, v: s.v + 1 }), PARENT: (s) => s.v + 1 }, T: (s) => s }
    function Other() { return h('p', { className: 'other' }, 'other') }
    function P({ state }) { return h('div', null, h(Switchable, { of: { pg: Page, other: Other }, current: 'other' }), h('b', { className: 'got' }, state.got.join())) }
    P.initialState = { v: 0, got: [] }
    P.intent = ({ CHILD }) => ({ GOT: CHILD.select(Page) })
    P.model = { GOT: (s, v) => ({ ...s, got: [...s.got, v] }) }
    const m = mount(P)
    await until(() => expect(m.text('.got')).toBe('1,2,3'))
    expect(m.$('.pg')).toBe(null)
    expect(m.app.state.v).toBe(3)
  })
})

// ============================================================================ 4. Suspense / READY, Lazy
describe('4. Suspense / READY and Lazy (registered markers)', () => {
  function NotReady() { return h('div', { className: 'nr' }, 'not ready') }
  NotReady.isolatedState = true
  NotReady.initialState = {}
  NotReady.model = { BOOTSTRAP: { READY: () => false } }
  function Delayed({ state }) { return h('div', { className: 'delayed' }, state.ready ? 'Now ready!' : 'Still loading...') }
  Delayed.isolatedState = true
  Delayed.initialState = { ready: false }
  Delayed.intent = () => ({ BECOME_READY: xs.periodic(30).take(1) })
  Delayed.model = { BOOTSTRAP: { READY: () => false }, BECOME_READY: { STATE: (s) => ({ ...s, ready: true }), READY: () => true } }
  function Ready() { return h('div', { className: 'ready' }, 'ready') }

  it('renders the fallback (pending wrapper) while a child is not READY, then the content', async () => {
    function A() { return h('div', null, h(Suspense, { fallback: h('p', { className: 'fb' }, 'Loading') }, h(Delayed))) }
    A.initialState = {}
    const m = mount(A)
    await until(() => expect(m.text('.fb')).toBe('Loading'))
    expect(m.$('[data-sygnal-suspense="pending"]')).toBeTruthy()
    await until(() => expect(m.text('.delayed')).toBe('Now ready!'))
    expect(m.$('.fb')).toBe(null)
    expect(m.$('[data-sygnal-suspense]')).toBe(null) // single resolved child: no wrapper
  })

  it('a string fallback; several children resolved get the resolved wrapper; READY=false stays pending', async () => {
    function A() { return h('div', null, h(Suspense, { fallback: 'wait' }, h(NotReady)), h(Suspense, { fallback: 'x' }, h(Ready), h(Ready))) }
    A.initialState = {}
    const m = mount(A)
    await until(() => expect(m.$('[data-sygnal-suspense="pending"]')?.textContent).toBe('wait'))
    expect(m.$('[data-sygnal-suspense="resolved"]').querySelectorAll('.ready').length).toBe(2)
    await sleep(30)
    expect(m.$('.nr')).toBe(null)
  })

  it('Lazy: the loading placeholder (and the Suspense fallback) until the import resolves, then a working component', async () => {
    let resolve
    const loaded = new Promise(r => { resolve = r })
    function Heavy({ state }) { return h('button', { className: 'heavy' }, `heavy ${state.n}`) }
    Heavy.intent = ({ DOM }) => ({ INC: DOM.click('.heavy') })
    Heavy.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
    const LazyHeavy = lazy(() => loaded)
    function A() { return h('div', null, h(Suspense, { fallback: h('i', { className: 'fb' }, '...') }, h(LazyHeavy, { state: 'heavy' }))) }
    A.initialState = { heavy: { n: 1 } }
    const m = mount(A)
    await until(() => expect(m.$('.fb')).toBeTruthy())
    resolve({ default: Heavy })
    await until(() => expect(m.text('.heavy')).toBe('heavy 1'))
    expect(m.$('.fb')).toBe(null)
    click('.heavy')
    await until(() => expect(m.text('.heavy')).toBe('heavy 2'))
  })
})

// ============================================================================ 5. statics (timers)
describe('5. generic statics: timers with the real makeTimerDriver (p4-3c-timers-run cases)', () => {
  function Clock({ state }) { return h('p', { className: 'n' }, String(state.n)) }
  Clock.initialState = { running: true, n: 0 }
  Clock.timers = (state) => ({ tick: state.running && { every: 1000, action: 'TICK' } })
  Clock.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.n') })
  Clock.model = { TICK: (state, { n }) => ({ ...state, n }), TOGGLE: (s) => ({ ...s, running: !s.running }) }

  it('ticks into the view; falsy stops; app dispose leaves no timer; the driver key is free', async () => {
    vi.useFakeTimers()
    const m = mount(Clock, { CLOCK: makeTimerDriver() })
    await vi.advanceTimersByTimeAsync(3050)
    expect(m.text('.n')).toBe('3')
    click('.n')
    await vi.advanceTimersByTimeAsync(3000)
    expect(m.text('.n')).toBe('3')
    click('.n') // restart: a new spec from scratch
    await vi.advanceTimersByTimeAsync(1010)
    expect(m.text('.n')).toBe('1')
    m.app.dispose()
    apps = []
    await vi.advanceTimersByTimeAsync(100)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("Collection items each run their own timer; a removed item's timer stops", async () => {
    vi.useFakeTimers()
    function T({ state }) { return h('li', { className: 't' }, `${state.id}:${state.n || 0}`) }
    T.timers = (s) => ({ t: { every: s.ms, action: 'TICK' } })
    T.model = { TICK: (s, { n }) => ({ ...s, n }) }
    function L() { return h('ul', null, h('button', { className: 'drop' }), h(Collection, { of: T, from: 'items' })) }
    L.initialState = { items: [{ id: 1, ms: 100 }, { id: 2, ms: 300 }] }
    L.intent = ({ DOM }) => ({ DROP: DOM.click('.drop') })
    L.model = { DROP: (s) => ({ ...s, items: s.items.slice(1) }) }
    const m = mount(L, { TIMER: makeTimerDriver() })
    await vi.advanceTimersByTimeAsync(610)
    expect(m.$$('.t').map(e => e.textContent)).toEqual(['1:6', '2:2'])
    click('.drop')
    await vi.advanceTimersByTimeAsync(10)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('a hidden Switchable page keeps only its background: true timers; shown again, the others restart', async () => {
    vi.useFakeTimers()
    function Page({ state }) { return h('p', { className: 'pg' }, `${state.fg}/${state.bg}`) }
    Page.timers = () => ({ fg: { every: 100, action: 'FG' }, bg: { every: 100, action: 'BG', background: true } })
    Page.model = { FG: (s) => ({ ...s, fg: s.fg + 1 }), BG: (s) => ({ ...s, bg: s.bg + 1 }) }
    function Other() { return h('p', { className: 'other' }, 'o') }
    function T({ state }) { return h('div', null, h('button', { className: 'flip' }), h(Switchable, { of: { pg: Page, o: Other }, current: state.page })) }
    T.initialState = { page: 'pg', fg: 0, bg: 0 }
    T.intent = ({ DOM }) => ({ FLIP: DOM.click('.flip') })
    T.model = { FLIP: (s) => ({ ...s, page: s.page == 'pg' ? 'o' : 'pg' }) }
    const m = mount(T, { TIMER: makeTimerDriver() })
    await vi.advanceTimersByTimeAsync(310)
    expect(m.text('.pg')).toBe('3/3')
    click('.flip')
    await vi.advanceTimersByTimeAsync(500)
    expect(m.app.state).toMatchObject({ fg: 3, bg: 8 })
    click('.flip')
    await vi.advanceTimersByTimeAsync(210)
    expect(m.text('.pg')).toBe('5/10')
  })
})

// ============================================================================ 6. fetch scope tagging
function stubFetch() {
  const calls = []
  const fetch = vi.fn((url, init) => new Promise((resolve, reject) => {
    const call = { url, init, resolve, reject, aborted: false }
    init?.signal?.addEventListener('abort', () => { call.aborted = true })
    calls.push(call)
  }))
  const respond = (call, body) => call.resolve(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }))
  return { fetch, calls, respond, call: (u) => calls.find(c => c.url.endsWith(u)) }
}
/** the proposal's isolateValue on the fetch source (value-level scoping; tagRequest as isolateSink does) */
const withIsolateValue = (driver) => (sink$, name) => {
  const wrap = (src) => src && ({
    ...src,
    isolateSource: (s, scope) => wrap(src.isolateSource(s, scope)),
    isolateValue: (v, scope) => { let out; src.isolateSink(xs.of(v), scope).take(1).addListener({ next: (x) => { out = x } }); return out },
  })
  return wrap(driver(sink$, name))
}

describe('6. fetch: requests from Collection items reach makeFetchDriver; replies come back to the right instance', () => {
  // p3-1a-replies: reply actions
  function Item({ state }) { return h('li', { className: `item i${state.id}` }, h('button', { className: 'go' }, 'go'), h('span', { className: 'v' }, String(state.v ?? ''))) }
  Item.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
  Item.model = {
    GO: { HTTP: (s) => ({ url: `/api/item/${s.id}`, ok: 'GOT', error: 'BAD', latest: true }) },
    GOT: (s, body) => ({ ...s, v: body.v }),
    BAD: (s) => ({ ...s, v: 'bad' }),
  }
  function List() { return h('div', null, h('button', { className: 'drop' }, 'drop'), h('ul', null, h(Collection, { of: Item, from: 'items' }))) }
  List.initialState = { items: [{ id: 1 }, { id: 2 }] }
  List.intent = ({ DOM }) => ({ DROP: DOM.click('.drop') })
  List.model = { DROP: (s) => ({ ...s, items: s.items.slice(1) }) }

  it('reply actions: two items, same ok name, replies in reverse order; each gets only its own', async () => {
    const f = stubFetch()
    const m = mount(List, { HTTP: makeFetchDriver({ fetch: f.fetch }) })
    await until(() => expect(m.$$('.go').length).toBe(2))
    click('.i1 .go'); click('.i2 .go')
    await until(() => expect(f.calls.length).toBe(2))
    expect(f.calls.map(c => c.aborted)).toEqual([false, false])
    f.respond(f.call('/api/item/2'), { v: 'two' })
    f.respond(f.call('/api/item/1'), { v: 'one' })
    await until(() => expect(m.text('.i1 .v') + m.text('.i2 .v')).toBe('onetwo'))
  })

  it("a removed item's request is aborted at once and nothing is delivered (G-144)", async () => {
    const f = stubFetch()
    const m = mount(List, { HTTP: makeFetchDriver({ fetch: f.fetch }) })
    await until(() => expect(m.$$('.go').length).toBe(2))
    click('.i1 .go')
    await until(() => expect(f.calls.length).toBe(1))
    click('.drop')
    await until(() => expect(m.$$('.go').length).toBe(1))
    expect(f.calls[0].aborted).toBe(true)
  })

  // plan2-4r-isolation: HTTP.select scoped per item (the scope tags on the request)
  function Det({ state }) { return h('li', { className: 'det', 'data-id': String(state.id) }, h('button', { className: 'load' }, 'load'), `${state.id}:${state.detail || '-'}`) }
  Det.intent = ({ DOM, HTTP }) => ({ LOAD: DOM.click('.load'), GOT: HTTP.select('detail') })
  Det.model = {
    LOAD: { HTTP: (s) => ({ url: `/items/${s.id}`, category: 'detail', latest: true }) },
    GOT: (s, { value }) => ({ ...s, detail: value }),
  }
  function DList() { return h('ul', null, h(Collection, { of: Det, from: 'items' })) }
  DList.initialState = { items: [{ id: 1 }, { id: 2 }] }

  it.each([['the stream fallback (isolateSink)', (d) => d], ['isolateValue', withIsolateValue]])('select(category) per item, latest: true per item: %s', async (_, wrap) => {
    const f = stubFetch()
    const m = mount(DList, { HTTP: wrap(makeFetchDriver({ fetch: f.fetch })) })
    await until(() => expect(m.$$('.load').length).toBe(2))
    click('.det[data-id="1"] .load'); click('.det[data-id="2"] .load')
    await until(() => expect(f.calls.length).toBe(2))
    expect(f.calls.map(c => c.aborted)).toEqual([false, false])
    f.respond(f.calls[1], 'D2'); f.respond(f.calls[0], 'D1')
    await until(() => expect(m.$$('.det').map(e => e.textContent.replace('load', ''))).toEqual(['1:D1', '2:D2']))
    click('.det[data-id="1"] .load'); click('.det[data-id="1"] .load')
    await until(() => expect(f.calls.length).toBe(4))
    expect(f.calls.map(c => c.aborted)).toEqual([false, false, true, false])
  })
})

// ============================================================================ 7. behaviors via a definition hook
describe('7. undo (GS-1 behaviors, uses) through transformDef', () => {
  function Editor({ state }) {
    return h('div', null, h('input', { className: 'doc', value: state.doc }), h('button', { className: 'add' }, '+'),
      h('button', { className: 'undo', disabled: !state.history.canUndo }, 'u'), h('button', { className: 'redo', disabled: !state.history.canRedo }, 'r'),
      h('p', { className: 'out' }, `${state.doc}|${state.history.past.length}|${state.history.future.length}`))
  }
  Editor.initialState = { doc: '' }
  Editor.uses = { history: undo({ key: 'doc', undo: '.undo', redo: '.redo' }) }
  Editor.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
  Editor.model = { ADD: (s) => ({ ...s, doc: s.doc + 'a' }) }

  it('state.history with canUndo / canRedo; the controls trigger history.UNDO / history.REDO; the definition is rewritten once', async () => {
    const m = mount(Editor)
    await until(() => expect(m.text('.out')).toBe('||0|0'.slice(1)))
    click('.add'); click('.add'); click('.add')
    await until(() => expect(m.text('.out')).toBe('aaa|3|0'))
    expect(m.app.state.history.canUndo).toBe(true)
    click('.undo'); click('.undo')
    await until(() => expect(m.text('.out')).toBe('a|1|2'))
    click('.redo')
    await until(() => expect(m.text('.out')).toBe('aa|2|1'))
    expect([...defOf(Editor).handlers.keys()].sort()).toEqual(['ADD', 'history.REDO', 'history.UNDO'])
  })

  it('as a Collection item host: each item its own history (the slice read as a default until first written)', async () => {
    function Note({ state }) { return h('li', { className: 'note' }, h('button', { className: 'add' }, '+'), h('button', { className: 'undo' }, 'u'), `${state.doc}:${state.history.past.length}`) }
    Note.uses = { history: undo({ key: 'doc', undo: '.undo' }) }
    Note.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
    Note.model = { ADD: (s) => ({ ...s, doc: s.doc + 'x' }) }
    function L() { return h('ul', null, h(Collection, { of: Note, from: 'notes' })) }
    L.initialState = { notes: [{ id: 1, doc: 'a' }, { id: 2, doc: 'b' }] }
    const m = mount(L)
    const notes = () => m.$$('.note').map(e => e.textContent.replace('+u', ''))
    await until(() => expect(notes()).toEqual(['a:0', 'b:0']))
    click(m.$$('.note .add')[1]); click(m.$$('.note .add')[1])
    await until(() => expect(notes()).toEqual(['a:0', 'bxx:2']))
    click(m.$$('.note .undo')[1])
    await until(() => expect(notes()).toEqual(['a:0', 'bx:1']))
    expect(m.app.state.notes[0]).toEqual({ id: 1, doc: 'a' })
  })
})

// ============================================================================ 8. hooks
describe('8. hooks: an action log (t.actions) from onAction / wrapHandler / onReducer, and onNext', () => {
  it('records actions with the sinks each handler fed, state before / after, and next() calls without parsing debug text', async () => {
    const log = [], nexts = []
    const hooks = {
      onAction: (inst, type, data) => log.push({ component: inst.def.name, type, data, sinks: [] }),
      wrapHandler: (inst, type, sink, fn) => (...a) => { const v = typeof fn == 'function' ? fn(...a) : fn; log.at(-1).sinks.push(sink); return v },
      onReducer: (inst, type, prev, next) => Object.assign(log.at(-1), { prev, next }),
      onNext: (inst, type, data, ms) => nexts.push({ component: inst.def.name, type, data, ms }),
    }
    function C({ state }) { return h('button', { className: 'b' }, String(state.n)) }
    C.initialState = { n: 0 }
    C.intent = ({ DOM }) => ({ INC: DOM.click('.b') })
    C.model = {
      INC: { STATE: (s) => ({ ...s, n: s.n + 1 }), EFFECT: (s, d, next) => next('LATER', s.n, 5) },
      LATER: (s, v) => ({ ...s, n: s.n + 10 }),
    }
    const m = mount(C, {}, hooks)
    await until(() => expect(m.text('.b')).toBe('0'))
    click('.b')
    await until(() => expect(m.text('.b')).toBe('11'))
    expect(log.map(({ component, type, sinks, prev, next }) => ({ component, type, sinks, prev, next }))).toEqual([
      { component: 'C', type: 'INC', sinks: ['STATE', 'EFFECT'], prev: { n: 0 }, next: { n: 1 } },
      { component: 'C', type: 'LATER', sinks: ['STATE'], prev: { n: 1 }, next: { n: 11 } },
    ])
    expect(nexts).toEqual([{ component: 'C', type: 'LATER', data: 0, ms: 5 }])
  })
})

// ============================================================================ 9. reentrancy and startup races
describe('9. reentrancy: FIFO, run-to-completion, no nested flush, one patch', () => {
  /** a bus driver that delivers every sink value synchronously, during sink delivery */
  const syncBus = () => (sink$) => {
    const ls = new Set()
    sink$.addListener({ next: (v) => ls.forEach(l => l.next(v)) })
    return { select: (t) => xs.create({ start: (l) => { ls.add({ next: (v) => v.type === t && l.next(v.data) }) }, stop: () => {} }) }
  }

  it('a driver emitting synchronously into a source during sink delivery: queued after the current action (FIFO), one patch', async () => {
    const order = []
    function A({ state }) { return h('button', { className: 'a' }, `a${state.n}`) }
    A.intent = ({ DOM }) => ({ GO: DOM.click('.a') })
    A.model = { GO: { STATE: (s) => { order.push('A.STATE'); return { ...s, n: s.n + 1 } }, BUS: (s) => { order.push('A.BUS'); return { type: 'PING', data: s.n + 1 } }, EFFECT: () => order.push('A.EFFECT') } }
    function B({ state }) { return h('i', { className: 'b' }, `b${state.n}`) }
    B.intent = ({ BUS }) => ({ PING: BUS.select('PING') })
    B.model = { PING: (s, n) => { order.push('B.PING'); return { ...s, n: s.n + n } } }
    function P({ state }) { return h('div', null, h(A, { state: 'a' }), h(B, { state: 'b' })) }
    P.initialState = { a: { n: 0 }, b: { n: 0 } }
    const m = mount(P, { BUS: syncBus() })
    await until(() => expect(m.text('.b')).toBe('b0'))
    const before = m.patches.length
    click('.a')
    // run to completion: B's action runs after all of A's handlers, not in the middle
    expect(order).toEqual(['A.STATE', 'A.BUS', 'A.EFFECT', 'B.PING'])
    expect(m.app.state).toEqual({ a: { n: 1 }, b: { n: 1 } }) // synchronous store: applied already
    await until(() => expect(m.text('.b')).toBe('b1'))
    await sleep(10)
    expect(m.patches.length - before).toBe(1)
  })

  it('an EFFECT that dispatches synchronously: appended to the queue, sees the state after the current action', async () => {
    const trace = []
    const cmd$ = xs.create()
    function Child({ state }) { return h('i', { className: 'c' }, String(state.v)) }
    Child.intent = () => ({ CMD: cmd$ })
    Child.model = { CMD: (s, d) => { trace.push(['CMD', d]); return { ...s, v: d } } }
    function P({ state }) { return h('div', null, h('button', { className: 'go' }, String(state.n)), h(Child, { state: 'child' })) }
    P.initialState = { n: 0, child: { v: 0 } }
    P.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    P.model = { GO: { STATE: (s) => ({ ...s, n: s.n + 1 }), EFFECT: (s) => { cmd$.shamefullySendNext(s.n + 1); trace.push(['EFFECT returned', s.n]) } } }
    const m = mount(P)
    await until(() => expect(m.text('.c')).toBe('0'))
    const before = m.patches.length
    click('.go'); click('.go')
    expect(trace).toEqual([['EFFECT returned', 0], ['CMD', 1], ['EFFECT returned', 1], ['CMD', 2]])
    await until(() => expect(m.text('.go') + m.text('.c')).toBe('22'))
    await sleep(10)
    expect(m.patches.length - before).toBe(1)
  })

  it('an action arriving during the render flush (a driver replying synchronously to a static) is drained in the same flush: one patch', async () => {
    // a minimal static driver: answers each declaration synchronously, inside the flush
    const echo = () => (sink$) => {
      const to = new Map()
      sink$.addListener({ next: (v) => to.get(v.__emitterId)?.next({ type: 'ECHO', data: v.echo }) })
      return { __sygnalStatic: 'echo', __sygnalReplies: true, replies: (id) => xs.create({ start: (l) => to.set(id, l), stop: () => to.delete(id) }) }
    }
    function Item({ state }) { return h('li', { className: 'e' }, `${state.id}:${state.seen ?? '-'}`) }
    Item.echo = (s) => s.id * 10
    Item.model = { ECHO: (s, v) => ({ ...s, seen: v }) }
    function L() { return h('ul', null, h('button', { className: 'add' }), h(Collection, { of: Item, from: 'items' })) }
    L.initialState = { items: [{ id: 1 }] }
    L.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
    L.model = { ADD: (s) => ({ ...s, items: [...s.items, { id: s.items.length + 1 }] }) }
    const seen = []
    const m = mount(L, { ECHO: echo() })
    await until(() => expect(m.$$('.e').map(e => e.textContent)).toEqual(['1:10']))
    expect(m.patches.length).toBe(1) // first render, the declaration and its reply: one patch
    click('.add')
    await until(() => expect(m.$$('.e').map(e => e.textContent)).toEqual(['1:10', '2:20']))
    await sleep(10)
    expect(m.patches.length).toBe(2)
  })

  // G-266 (test/p45-r-start-order.test.js)
  it("G-266: a child created in the root's first render: an intent that emits at once reduces the initial state", async () => {
    const seen = []
    function Child({ state }) { return h('p', { className: 'c' }, String(state.n)) }
    Child.isolatedState = true
    Child.initialState = { n: 1 }
    Child.intent = () => ({ INC: xs.of(1) })
    Child.model = { INC: (s) => { seen.push(s.n); return { ...s, n: s.n + 1 } } }
    function Root() { return h('div', null, h(Child)) }
    Root.initialState = { x: 0 }
    const m = mount(Root)
    await until(() => expect(m.text('.c')).toBe('2'))
    expect(seen).toEqual([1])
    expect(m.patches.length).toBe(1) // the startup is one patch: '1' is never shown
  })

  it("G-266: BOOTSTRAP in a child created in the root's first render sees the initial state", async () => {
    const seen = []
    function Child({ state }) { return h('p', { className: 'c' }, String(state.n)) }
    Child.isolatedState = true
    Child.initialState = { n: 1 }
    Child.model = { BOOTSTRAP: (s) => { seen.push(s?.n); return { ...s, n: s.n * 10 } } }
    function Root() { return h('div', null, h(Child)) }
    Root.initialState = { x: 0 }
    Root.model = { BOOTSTRAP: (s) => s }
    const m = mount(Root)
    await until(() => expect(m.text('.c')).toBe('10'))
    expect(seen).toEqual([1])
  })

  it('G-266 under fake timers that are never advanced: startup needs no timer at all', async () => {
    vi.useFakeTimers()
    function Child({ state }) { return h('p', { className: 'c' }, String(state.n)) }
    Child.intent = () => ({ INC: xs.of(1) })
    Child.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
    function Root() { return h('div', null, h(Child, { state: 'kid' })) }
    Root.initialState = { kid: { n: 1 } }
    const m = mount(Root)
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(m.text('.c')).toBe('2')
    expect(vi.getTimerCount()).toBe(0)
  })

  // G-260 / G-283 / G-284: a non-settling loop is throttled with a bounded number of timers
  it('G-283: a loop that never settles stays bounded (few timers, the page keeps responding)', async () => {
    const spy = vi.spyOn(globalThis, 'setTimeout')
    let flushes = 0
    function Loop({ state }) { return h('b', { className: 'g' }, String(state.n)) }
    Loop.initialState = { n: 0 }
    Loop.intent = ({ DOM }) => ({ ADD: DOM.select('.g').elements() })
    Loop.model = { ADD: (s) => ({ ...s, n: s.n + 1 }) }
    const m = mount(Loop, {}, { onRender: () => flushes++ })
    await sleep(200)
    // xstream's own deferred stops (streams disposed by the previous test) aside, the loop arms no timer (the sleep is the test's)
    const mine = spy.mock.calls.filter(c => !String(c[0]).includes('_stopNow'))
    const n = m.app.state.n
    expect(n).toBeGreaterThan(50)
    expect(mine.length).toBeLessThanOrEqual(1)
    m.app.dispose(); apps = []
  })

  it('teardown: removed items stop their intent streams synchronously at the end of the flush, with no timer', async () => {
    const stopped = []
    function It({ state }) { return h('li', { className: 'it' }, String(state.id)) }
    It.intent = ({ DOM }) => ({ C: DOM.click('.it').map(() => 1), T: xs.create({ start: () => {}, stop: () => stopped.push('own') }).map(x => x) })
    It.model = { C: (s) => s, T: (s) => s }
    function L() { return h('ul', null, h('button', { className: 'clear' }), h(Collection, { of: It, from: 'items' })) }
    L.initialState = { items: Array.from({ length: 50 }, (_, i) => ({ id: i + 1 })) }
    L.intent = ({ DOM }) => ({ CLEAR: DOM.click('.clear') })
    L.model = { CLEAR: (s) => ({ ...s, items: [] }) }
    const m = mount(L)
    await until(() => expect(m.$$('.it').length).toBe(50))
    const st = globalThis.setTimeout, stacks = []
    // (a stop cascading from an older xstream timer, left by an earlier test, is not this teardown's)
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(function (f, ms) { const k = new Error().stack; if (String(f).includes('_stopNow') && !k.includes('listOnTimeout')) stacks.push(k); return st(f, ms) })
    click('.clear')
    await until(() => expect(m.$$('.it').length).toBe(0))
    expect(stopped.length).toBe(50)
    expect(stacks).toEqual([])
  })

  it('G-257 / D153 grow: every render adds an item with intent (a chain of new components) and it completes', async () => {
    function Leaf({ state }) { return h('i', { className: 'leaf' }, String(state.n)) }
    Leaf.intent = ({ DOM }) => ({ C: DOM.click('.leaf') })
    Leaf.model = { C: (s) => s }
    function Grow({ state }) { return h('div', null, h('b', { className: 'g' }, String(state.items.length)), h(Collection, { of: Leaf, from: 'items' })) }
    Grow.initialState = { items: [] }
    Grow.intent = ({ DOM }) => ({ ADD: DOM.select('.g').elements() })
    Grow.model = { ADD: (s) => (s.items.length < 30 ? { items: [...s.items, { id: s.items.length + 1, n: s.items.length }] } : s) }
    const m = mount(Grow)
    await until(() => expect(m.$$('.leaf').length).toBe(30))
  })
})
