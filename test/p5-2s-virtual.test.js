// @vitest-environment jsdom
// PLAN-5 2-S: VirtualCollection fixes (review 2-V). jsdom with the fake layout of
// p5-v1-virtual.test.js (the container is BOX px tall, a row is its data-h or ROW px).
// G-394 an inline estimateSize function keeps the measured heights; G-395 SYG430 "grows" only
// for a container that really grows (max-height: bounded); G-401 the focused row stays rendered
// and is never moved in the DOM; G-407 the key function is kept while the key list is unchanged.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import run from '../src/extra/run.js'
import { VirtualCollection } from '../src/index.js'
import { VirtualHost } from '../src/extra/virtual.ts'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'

const settle = (ms = 30) => new Promise(r => setTimeout(r, ms))
const rows = (n, f = () => ({})) => Array.from({ length: n }, (_, i) => ({ id: i + 1, label: 'r' + (i + 1), ...f(i) }))

function Row({ state }) {
  return h('div', { className: 'row', attrs: state.h ? { 'data-h': state.h } : undefined },
    h('span', { className: 'lbl' }, state.label),
    h('button', { className: 'bump' }, String(state.n || 0)))
}
Row.intent = ({ DOM }) => ({ BUMP: DOM.click('.bump') })
Row.model = { BUMP: (s) => ({ ...s, n: (s.n || 0) + 1 }) }

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
      // (grows: as tall as its spacer, up to its max-height: G-427 measures it)
      if (isBox(this)) return L.mode == 'grows' ? Math.min(parseFloat(this.firstElementChild?.style.height || '0'), parseFloat(this.style.maxHeight) || Infinity) : L.mode == 'zero' ? 0 : L.box
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

beforeEach(() => { L.box = 320; L.row = 32; L.mode = 'ok'; fakeLayout() })
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = ''; restore.reverse().forEach(f => f()); restore = []; vi.restoreAllMocks() })

const tickHost = (props) => {
  function A({ state }) {
    return h('div', null,
      h('span', { className: 'tick' }, String(state.tick)),
      h(VirtualCollection, { of: Row, from: 'rows', className: 'rows', ...props(state) }),
      h('button', { className: 'go' }))
  }
  A.initialState = { rows: rows(100, () => ({ h: 50 })), tick: 0, est: 20 }
  A.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
  A.model = { GO: (s) => ({ ...s, tick: s.tick + 1 }) }
  return A
}

describe('G-394: estimateSize', () => {
  it('an inline function (a new one each render) keeps the measured heights across an unrelated owner render', async () => {
    const box = await mount(tickHost(() => ({ estimateSize: () => 20 })))
    await settle(60)
    const before = box.firstElementChild.style.height
    // the rendered rows are measured at 50 px: more than 100 × 20
    expect(parseFloat(before)).toBeGreaterThan(2000)
    document.querySelector('.go').click()
    await settle(60)
    expect(document.querySelector('.tick').textContent).toBe('1')
    expect(box.firstElementChild.style.height).toBe(before)
  })

  it('the same for an inline style object and the other container props: the container keeps its vnode data', async () => {
    const box = await mount(tickHost(() => ({ estimateSize: (r) => 20, style: { height: '320px' } })))
    await settle(60)
    const before = box.firstElementChild.style.height
    document.querySelector('.go').click()
    await settle(60)
    expect(box.firstElementChild.style.height).toBe(before)
  })

  it('a numeric estimate that changes (or a switch between a number and a function) re-measures', async () => {
    function A({ state }) {
      return h('div', null, h(VirtualCollection, { of: Row, from: 'rows', className: 'rows', estimateSize: state.est }), h('button', { className: 'go' }))
    }
    A.initialState = { rows: rows(100), est: 20 }
    A.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    A.model = { GO: (s) => ({ ...s, est: typeof s.est == 'number' ? (s.est == 20 ? 40 : () => 10) : 20 }) }
    const box = await mount(A)
    const total = () => parseFloat(box.firstElementChild.style.height)
    const t20 = total()
    document.querySelector('.go').click(); await settle(60)
    // the unmeasured rows are estimated at 40 now (the rendered ones are measured at 32 again)
    expect(total()).toBeGreaterThan(t20)
    const t40 = total()
    document.querySelector('.go').click(); await settle(60)
    expect(total()).toBeLessThan(t40)
  })
})

describe('G-395: SYG430 "grows"', () => {
  it('a container bounded by max-height, taller than the viewport, that fits its rows: every row, no SYG430', async () => {
    setupChecks()
    L.mode = 'grows'
    function A() { return h(VirtualCollection, { of: Row, from: 'rows', className: 'rows', estimateSize: 32, style: { maxHeight: '1000px' } }) }
    A.initialState = { rows: rows(30) }
    await mount(A, { diagnostics: 'collect' })
    expect(window.innerHeight).toBe(768)
    expect(ids().length).toBe(30)
    expect(ids().at(-1)).toBe('r30')
    expect(diagnostics('SYG430')).toEqual([])
  })

  it('a container that grows (no max-height) is still clamped, with SYG430', async () => {
    setupChecks()
    L.mode = 'grows'
    function A() { return h(VirtualCollection, { of: Row, from: 'rows', className: 'rows', estimateSize: 32 }) }
    A.initialState = { rows: rows(1000) }
    await mount(A, { diagnostics: 'collect' })
    expect(diagnostics('SYG430')[0].message).toMatch(/grows with its rows/)
    expect(ids().length).toBe(29)
  })
})

describe('G-401: the focused row', () => {
  const list = () => {
    function A() { return h(VirtualCollection, { of: Row, from: 'rows', className: 'rows', estimateSize: 32 }) }
    A.initialState = { rows: rows(1000) }
    return A
  }

  it('stays rendered (pinned at its own offset) while scrolled out, and is let go once the focus leaves', async () => {
    const box = await mount(list())
    const btn = document.querySelector('[data-index="2"] .bump')
    btn.focus()
    expect(document.activeElement).toBe(btn)
    await scroll(box, 3200)
    expect(ids()).toContain('r3')
    expect(ids()[1]).toBe('r96')
    const row = btn.closest('[data-index]')
    expect(row.isConnected).toBe(true)
    expect(document.activeElement).toBe(btn)
    // out of the window's flow: at its own offset, relative to the window (which starts at row 96)
    expect(row.style.position).toBe('absolute')
    expect(row.style.top).toBe(2 * 32 - 95 * 32 + 'px')
    // back in view: in the flow again (the same element)
    await scroll(box, 0)
    expect(btn.closest('[data-index]')).toBe(row)
    expect(row.style.position).toBe('')
    // the focus leaves the list: the row goes once it is out of the window
    btn.blur()
    btn.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    await settle()
    await scroll(box, 3200)
    expect(row.isConnected).toBe(false)
    expect(ids()).not.toContain('r3')
  })

  it('a window that loses rows at its front and gains rows at its end moves no row element (a move blurs it)', async () => {
    const box = await mount(list())
    const win = box.firstElementChild.firstElementChild
    const moved = []
    const ib = win.insertBefore.bind(win)
    win.insertBefore = (n, ref) => { if (n.isConnected) moved.push(n.getAttribute('data-index')); return ib(n, ref) }
    let r20
    for (const top of [32, 96, 200, 320, 640]) { await scroll(box, top); r20 ||= document.querySelector('[data-index="19"]') }
    expect(ids()[0]).toBe('r16')
    // keyed: the row's element is its own (not the one at its position before)
    expect(document.querySelector('[data-index="19"]')).toBe(r20)
    expect(r20.querySelector('.lbl').textContent).toBe('r20')
    expect(moved).toEqual([])
  })
})

describe('G-407: the key function', () => {
  it('a row edit (the same keys) keeps getItemKey, so the virtualizer does not rebuild its measurements', async () => {
    function A() { return h(VirtualCollection, { of: Row, from: 'rows', className: 'rows', estimateSize: 32 }) }
    A.initialState = { rows: rows(1000) }
    const box = await mount(A)
    const host = [...appHosts()][0]
    const gk = host.v.options.getItemKey
    document.querySelector('[data-index="1"] .bump').click()
    await settle()
    expect(document.querySelector('[data-index="1"] .bump').textContent).toBe('1')
    expect(host.v.options.getItemKey).toBe(gk)
    void box
  })
})

// the VirtualHost instances (each one's render records it)
const made = new Set()
function appHosts() { return made }
beforeEach(() => {
  made.clear()
  const r = VirtualHost.prototype.render
  vi.spyOn(VirtualHost.prototype, 'render').mockImplementation(function () { made.add(this); return r.call(this) })
})
