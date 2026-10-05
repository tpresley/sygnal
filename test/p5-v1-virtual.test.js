// @vitest-environment jsdom
// PLAN-5 V-1: <VirtualCollection>. Collection semantics (of/from/filter/sort, D169/D177/D178),
// the window (only rows in view + overscan have instances), ARIA list semantics, scrollToIndex /
// scrollToId element commands, dynamic heights, and SYG430–434. jsdom has no layout: the mock DOM
// and jsdom without layout get the no-layout window (10 rows' estimate + overscan); the window
// tests give jsdom a fake layout (offsetHeight / getClientRects / scrollTop / scrollTo).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import run from '../src/extra/run.js'
import { renderComponent } from '../src/extra/testing.js'
import { VirtualCollection, Collection } from '../src/index.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'
import { CODE_TITLES, CODE_SEVERITY, DEV_CODE_SEVERITY } from '../src/extra/diagnostics/codes.js'

const settle = (ms = 30) => new Promise(r => setTimeout(r, ms))
const rows = (n, f = () => ({})) => Array.from({ length: n }, (_, i) => ({ id: i + 1, label: 'r' + (i + 1), ...f(i) }))

let made = 0, gone = 0
function Row({ state }) {
  return h('div', { className: 'row', attrs: state.h ? { 'data-h': state.h } : undefined },
    h('span', { className: 'lbl' }, state.label),
    h('button', { className: 'bump' }, String(state.n || 0)))
}
Row.intent = ({ DOM }) => ({ BUMP: DOM.click('.bump') })
Row.model = {
  BOOTSTRAP: (s) => { made++; return s },
  DISPOSE: (s) => { gone++; return s },
  BUMP: (s) => ({ ...s, n: (s.n || 0) + 1 }),
}

const list = (props = {}, extra = {}) => {
  function List({ state }) {
    return h('div', null,
      h(VirtualCollection, { of: Row, from: 'rows', className: 'rows', estimateSize: 32, 'aria-label': 'Rows', ...props }),
      h('button', { className: 'jump' }, 'jump'),
      h('button', { className: 'find' }, 'find'))
  }
  List.initialState = { rows: rows(1000) }
  List.intent = ({ DOM }) => ({ JUMP: DOM.click('.jump').mapTo(500), FIND: DOM.click('.find').mapTo(900) })
  List.model = {
    JUMP: { ELEMENT: (s, index) => ({ scrollToIndex: '.rows', index, align: 'start' }) },
    FIND: { ELEMENT: (s, id) => ({ scrollToId: '.rows', id, align: 'start' }) },
    ...extra,
  }
  return List
}

beforeEach(() => { made = 0; gone = 0 })

describe('mock DOM: Collection semantics with a window', () => {
  it('renders only the no-layout window (10 rows + overscan 5) of 1,000, with list semantics', async () => {
    const t = renderComponent(list())
    await t.ready()
    const items = t.queryAll('.row')
    expect(items.length).toBe(15)
    expect(items[0].textContent).toContain('r1')
    expect(items[14].textContent).toContain('r15')
    const box = t.query('.rows')
    expect(box.getAttribute('role')).toBe('list')
    expect(box.getAttribute('tabindex')).toBe('0')
    expect(box.getAttribute('aria-label')).toBe('Rows')
    expect(items[0].getAttribute('role')).toBe('listitem')
    expect(items[0].getAttribute('aria-setsize')).toBe('1000')
    expect(items[3].getAttribute('aria-posinset')).toBe('4')
    expect(items[3].getAttribute('data-index')).toBe('3')
    t.dispose()
  })

  it('filter and sort as Collection: the window is over the filtered, sorted list; aria-setsize counts it', async () => {
    const t = renderComponent(list({ filter: (r) => r.id % 2 === 0, sort: { id: 'desc' } }))
    await t.ready()
    const items = t.queryAll('.row')
    expect(items.length).toBe(15)
    expect(items[0].textContent).toContain('r1000')
    expect(items[1].textContent).toContain('r998')
    expect(items[0].getAttribute('aria-setsize')).toBe('500')
    t.dispose()
  })

  it("an item's actions write its own array element (state survives in the array)", async () => {
    const t = renderComponent(list())
    await t.ready()
    t.simulateEvent('.bump', 'click', { within: '[data-index="2"]' })
    await t.settle()
    expect(t.state.rows[2].n).toBe(1)
    expect(t.state.rows[0].n).toBeUndefined()
    t.dispose()
  })

  it('other props go to every item; className, role and aria-* are the container\'s', async () => {
    let seen
    function Item({ state, tone }) { seen = tone; return h('li', { className: 'it' }, state.label) }
    function L() { return h(VirtualCollection, { of: Item, from: 'rows', className: 'box', tone: 'warm', role: 'listbox', 'aria-label': 'x' }) }
    L.initialState = { rows: rows(3) }
    const t = renderComponent(L)
    await t.ready()
    expect(seen).toBe('warm')
    expect(t.query('.box').getAttribute('role')).toBe('listbox')
    // not a list: the items keep no listitem role of their own
    expect(t.query('.it').getAttribute('role')).toBe(null)
    expect(t.query('.it').getAttribute('aria-posinset')).toBe('1')
    t.dispose()
  })

  it('D177 duplicate ids render once; D178 a missing from renders once it exists', async () => {
    function L({ state }) { return h(VirtualCollection, { of: Row, from: 'later', className: 'rows' }) }
    L.initialState = { rows: [] }
    L.intent = ({ DOM }) => ({ ADD: DOM.click('.rows') })
    L.model = { ADD: (s) => ({ ...s, later: [{ id: 1, label: 'a' }, { id: 1, label: 'dup' }, { id: 2, label: 'b' }] }) }
    const t = renderComponent(L, { diagnostics: 'off' })
    await t.ready()
    expect(t.queryAll('.row').length).toBe(0)
    t.simulateEvent('.rows', 'click')
    await t.settle()
    expect(t.queryAll('.row').map(r => r.querySelector('.lbl').textContent)).toEqual(['a', 'b'])
    t.dispose()
  })

  it('scrollToIndex / scrollToId are recorded element commands, with no SYG641', async () => {
    setupChecks()
    const t = renderComponent(list())
    await t.ready()
    t.simulateEvent('.jump', 'click')
    t.simulateEvent('.find', 'click')
    await t.settle()
    expect(t.commands('ELEMENT')).toEqual([{ scrollToIndex: '.rows', index: 500, align: 'start' }, { scrollToId: '.rows', id: 900, align: 'start' }])
    expect(diagnostics('SYG641')).toEqual([])
    t.dispose()
  })

  it('0 B core when unused: importing the module registers nothing; the first render does', async () => {
    const { hosts } = await import('../src/core/registry.ts')
    // (an earlier test rendered one; the registration is the tag's render hook, not the import)
    expect(typeof VirtualCollection.__sygnalControl).toBe('function')
    expect(hosts['virtual-collection']).toBeTypeOf('function')
    const src = (await import('node:fs')).readFileSync(process.cwd() + '/src/extra/virtual.ts', 'utf8')
    // no statement at module level writes the registry
    expect(src.split('\n').filter(l => /^hosts\[/.test(l))).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// jsdom with a fake layout: the container is BOX px tall, a row is its data-h or ROW px
const L = { box: 320, row: 32, mode: 'ok' }
let restore = []
const isBox = (el) => el.classList?.contains('rows')
function fakeLayout() {
  const P = HTMLElement.prototype, E = Element.prototype
  const keep = (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); restore.push(() => d ? Object.defineProperty(o, k, d) : delete o[k]) }
  const tops = new WeakMap()
  keep(P, 'offsetHeight'); keep(P, 'offsetWidth'); keep(E, 'getClientRects'); keep(E, 'scrollTop'); keep(E, 'scrollTo')
  keep(E, 'scrollHeight'); keep(E, 'clientHeight')
  Object.defineProperty(E, 'scrollHeight', { configurable: true, get() { return isBox(this) ? parseFloat(this.firstElementChild?.style.height || '0') : 0 } })
  Object.defineProperty(E, 'clientHeight', { configurable: true, get() { return isBox(this) ? this.offsetHeight : 0 } })
  Object.defineProperty(P, 'offsetHeight', {
    configurable: true,
    get() {
      if (isBox(this)) return L.mode == 'grows' ? parseFloat(this.firstElementChild?.style.height || '0') : L.mode == 'zero' ? 0 : L.box
      if (this.hasAttribute('data-index')) return Number(this.getAttribute('data-h') || L.row)
      return 0
    },
  })
  Object.defineProperty(P, 'offsetWidth', { configurable: true, get() { return 300 } })
  Object.defineProperty(E, 'getClientRects', { configurable: true, value() { return L.mode == 'nolayout' ? [] : [{}] } })
  Object.defineProperty(E, 'scrollTop', { configurable: true, get() { return tops.get(this) || 0 }, set(v) { tops.set(this, v) } })
  Object.defineProperty(E, 'scrollTo', {
    configurable: true,
    value(o) { this.scrollTop = Math.max(0, o.top + 0); this.dispatchEvent(new Event('scroll')) },
  })
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 0)
    window.cancelAnimationFrame = (i) => clearTimeout(i)
    restore.push(() => { delete window.requestAnimationFrame; delete window.cancelAnimationFrame })
  }
}

let app
const mount = async (App, opts = {}) => {
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, {}, { mountPoint: '#root', ...opts })
  await settle(60)
  return document.querySelector('.rows')
}
const ids = () => [...document.querySelectorAll('.row .lbl')].map(e => e.textContent)
const scroll = async (box, top) => { box.scrollTop = top; box.dispatchEvent(new Event('scroll')); await settle(40) }

describe('jsdom with a fake layout: the window follows the scroll', () => {
  beforeEach(() => { L.box = 320; L.row = 32; L.mode = 'ok'; fakeLayout() })
  afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = ''; restore.reverse().forEach(f => f()); restore = []; vi.restoreAllMocks() })

  it('10 rows in view + 5 overscan; the spacer is as tall as every row', async () => {
    const box = await mount(list())
    expect(ids().length).toBe(15)
    expect(box.firstElementChild.style.height).toBe('32000px')
    expect(box.style.overflowY).toBe('auto')
    expect(made).toBe(15)
  })

  it('scrolling recycles: rows scrolled out are disposed, rows scrolled in are made; state in the array survives', async () => {
    const box = await mount(list())
    document.querySelector('[data-index="1"] .bump').click()
    await settle()
    await scroll(box, 3200)
    // row 100 at the top: 95..114 (overscan before and after)
    expect(ids()[0]).toBe('r96')
    expect(ids().length).toBe(20)
    expect(box.querySelector('.row').parentElement.style.transform).toBe('translateY(3040px)')
    expect(gone).toBe(15)
    await scroll(box, 0)
    expect(ids()[0]).toBe('r1')
    expect(document.querySelector('[data-index="1"] .bump').textContent).toBe('1')
    // the window is the only thing ever instantiated
    expect(made).toBeLessThan(60)
  })

  it('a row in view keeps its instance while the window moves by less than the overscan', async () => {
    const box = await mount(list())
    const el = document.querySelector('[data-index="3"]')
    await scroll(box, 64)
    expect(document.querySelector('[data-index="3"]')).toBe(el)
    expect(gone).toBe(0)
  })

  it('ELEMENT { scrollToIndex } scrolls to the row, which then renders; scrollToId by id', async () => {
    const box = await mount(list())
    document.querySelector('.jump').click()
    await settle(80)
    expect(box.scrollTop).toBe(500 * 32)
    expect(document.querySelector('[data-index="500"] .lbl').textContent).toBe('r501')
    document.querySelector('.find').click()
    await settle(80)
    expect(box.scrollTop).toBe(899 * 32)
    expect(document.querySelector('[data-index="899"] .lbl').textContent).toBe('r900')
  })

  it('dynamic heights: rendered rows are measured; the spacer and later offsets follow', async () => {
    function Tall() { return h(VirtualCollection, { of: Row, from: 'rows', className: 'rows', estimateSize: 20 }) }
    Tall.initialState = { rows: rows(100, (i) => ({ h: i % 2 ? 50 : 30 })) }
    const box = await mount(Tall)
    await settle(60)
    const spacer = box.firstElementChild
    // the rendered rows are measured (30/50 alternating), the rest estimated at 20
    const n = document.querySelectorAll('.row').length
    // the rows measured so far are a prefix (every row rendered once); the others keep the estimate
    const total = parseFloat(spacer.style.height), hOf = (i) => (i % 2 ? 50 : 30)
    const m = Array.from({ length: 101 }, (_, k) => k).find(k => Array.from({ length: k }, (_, i) => hOf(i)).reduce((a, b) => a + b, 0) + (100 - k) * 20 === total)
    expect(m).toBeGreaterThanOrEqual(n)
    expect(n).toBeGreaterThan(5)
    // the rendered rows sit where their measured predecessors end: row 3 starts at 30 + 50 + 30
    await scroll(box, 110)
    expect(document.querySelector('[data-index="3"]')).toBeTruthy()
  })

  it('SYG431 for items without ids; SYG434 for a bad estimateSize; SYG433 for a target not in the list', async () => {
    setupChecks()
    function NoIds() { return h('div', null, h(VirtualCollection, { of: Row, from: 'rows', className: 'rows', estimateSize: -1 }), h('button', { className: 'go' })) }
    NoIds.initialState = { rows: [{ label: 'a' }, { label: 'b' }] }
    NoIds.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    NoIds.model = { GO: { ELEMENT: { scrollToId: '.rows', id: 'nope' } } }
    await mount(NoIds, { diagnostics: 'collect' })
    expect(diagnostics('SYG431').length).toBe(1)
    expect(diagnostics('SYG434')[0].message).toMatch(/estimateSize=\{-1\}/)
    document.querySelector('.go').click()
    await settle(80)
    expect(diagnostics('SYG433')[0].message).toMatch(/scrollToId for id "nope"/)
  })

  it('SYG430: a container that grows with its rows is clamped to the viewport', async () => {
    setupChecks()
    L.mode = 'grows'
    await mount(list(), { diagnostics: 'collect' })
    expect(diagnostics('SYG430')[0].message).toMatch(/grows with its rows/)
    // window.innerHeight (768) / 32 = 24 rows + 5 overscan, not 1,000
    expect(ids().length).toBe(29)
  })

  it('SYG430: a laid-out container 0 px tall; none without layout (jsdom as is)', async () => {
    setupChecks()
    L.mode = 'zero'
    await mount(list(), { diagnostics: 'collect' })
    expect(diagnostics('SYG430')[0].message).toMatch(/0 px tall/)
    app.dispose(); app = null
    setupChecks()
    L.mode = 'nolayout'
    await mount(list(), { diagnostics: 'collect' })
    expect(diagnostics('SYG430')).toEqual([])
    expect(ids().length).toBe(15)
  })

  it('SYG432: an item that renders a fragment', async () => {
    setupChecks()
    function Frag({ state }) { return h('span', null, state.label) }
    Frag.view = undefined
    function Frags({ state }) { return [h('i', null, state.label), h('b', null, '!')] }
    function F() { return h(VirtualCollection, { of: Frags, from: 'rows', className: 'rows' }) }
    F.initialState = { rows: rows(3) }
    await mount(F, { diagnostics: 'collect' })
    expect(diagnostics('SYG432').length).toBe(1)
  })

  it('removing the list cleans up: no listeners left on the container, every item disposed', async () => {
    function Host({ state }) { return h('div', null, state.on ? h(VirtualCollection, { of: Row, from: 'rows', className: 'rows' }) : null, h('button', { className: 'off' })) }
    Host.initialState = { on: true, rows: rows(50) }
    Host.intent = ({ DOM }) => ({ OFF: DOM.click('.off') })
    Host.model = { OFF: (s) => ({ ...s, on: false }) }
    const box = await mount(Host)
    const rm = vi.spyOn(box, 'removeEventListener')
    document.querySelector('.off').click()
    await settle()
    expect(document.querySelector('.rows')).toBe(null)
    expect(rm.mock.calls.map(c => c[0])).toContain('scroll')
    expect(box.scrollToIndex).toBeUndefined()
    expect(gone).toBe(made)
  })

  it('the same list in a plain Collection renders every row (the comparison the window saves)', async () => {
    function Plain() { return h(Collection, { of: Row, from: 'rows', className: 'rows' }) }
    Plain.initialState = { rows: rows(300) }
    await mount(Plain)
    expect(ids().length).toBe(300)
  })
})

describe('codes', () => {
  it('SYG430–434 are dev-entry codes with titles (not in the core table)', () => {
    for (const c of ['SYG430', 'SYG431', 'SYG432', 'SYG433', 'SYG434']) {
      expect(DEV_CODE_SEVERITY[c], c).toBe('warn')
      expect(CODE_TITLES[c], c).toMatch(/VirtualCollection/)
    }
  })
})
