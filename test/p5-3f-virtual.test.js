// @vitest-environment jsdom
// PLAN-5 3-F: VirtualCollection review fixes (review 2-S), with the fake layout of
// p5-2s-virtual.test.js (the container is BOX px tall, or as tall as its spacer up to its
// max-height in 'grows' mode; a row is its data-h or ROW px).
// G-424 a reorder keeps the focused row pinned (by key, not by its old index); G-428 a focusout
// with no relatedTarget while the focus is still inside (the window lost the focus) keeps it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import run from '../src/extra/run.js'
import { VirtualCollection } from '../src/index.js'

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
const spacerH = (el) => parseFloat(el.firstElementChild?.style.height || '0')
function fakeLayout() {
  const P = HTMLElement.prototype, E = Element.prototype
  const keep = (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); restore.push(() => d ? Object.defineProperty(o, k, d) : delete o[k]) }
  const tops = new WeakMap()
  keep(P, 'offsetHeight'); keep(P, 'offsetWidth'); keep(E, 'getClientRects'); keep(E, 'scrollTop'); keep(E, 'scrollTo')
  keep(E, 'scrollHeight'); keep(E, 'clientHeight')
  Object.defineProperty(E, 'scrollHeight', { configurable: true, get() { return isBox(this) ? spacerH(this) : 0 } })
  Object.defineProperty(E, 'clientHeight', { configurable: true, get() { return isBox(this) ? this.offsetHeight : 0 } })
  Object.defineProperty(P, 'offsetHeight', {
    configurable: true,
    get() {
      if (isBox(this)) return L.mode == 'grows' ? Math.min(spacerH(this), parseFloat(this.style.maxHeight) || Infinity) : L.mode == 'zero' ? 0 : L.box
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

function List({ state }) {
  return h('div', null,
    h(VirtualCollection, { of: Row, from: 'rows', className: 'rows', estimateSize: 32, sort: state.sort }),
    h('button', { className: 'rev' }), h('button', { className: 'srt' }), h('button', { className: 'mv' }))
}
List.initialState = { rows: rows(1000), sort: undefined }
List.intent = ({ DOM }) => ({ REV: DOM.click('.rev'), SORT: DOM.click('.srt'), MOVE: DOM.click('.mv') })
List.model = {
  // the same keys, the same count: only the order changes
  REV: (s) => ({ ...s, rows: [...s.rows].reverse() }),
  SORT: (s) => ({ ...s, sort: { id: 'desc' } }),
  // r3 to the end, r999 to the front
  MOVE: (s) => { const r = s.rows.filter(x => x.id != 3 && x.id != 999); return { ...s, rows: [s.rows[998], ...r, s.rows[2]] } },
}

const focusRow3 = async (box) => {
  const btn = document.querySelector('[data-index="2"] .bump')
  btn.focus()
  await settle()
  await scroll(box, 3200)
  expect(document.activeElement).toBe(btn)
  expect(ids()).toContain('r3')
  return btn
}

describe('G-424: a reorder with the same count and range', () => {
  for (const [name, cls, at] of [['the array reversed', '.rev', 997], ['a sort prop', '.srt', 997], ['the row moved to the end', '.mv', 999]]) {
    it(`${name}: the focused row stays rendered (pinned at its new index) and keeps the focus`, async () => {
      const box = await mount(List)
      const btn = await focusRow3(box)
      const row = btn.closest('[data-index]')
      document.querySelector(cls).click()
      await settle(60)
      expect(btn.isConnected).toBe(true)
      expect(document.activeElement).toBe(btn)
      expect(btn.closest('[data-index]')).toBe(row)
      expect(row.getAttribute('data-index')).toBe(String(at))
      expect(row.querySelector('.lbl').textContent).toBe('r3')
      // pinned at its new offset, out of the window's flow; the window shows its own rows
      expect(row.style.position).toBe('absolute')
      expect(row.style.top).toBe(at * 32 - 95 * 32 + 'px')
      const flow = [...document.querySelectorAll('.row')].filter(r => r !== row)
      expect(flow.every(r => r.style.position === '')).toBe(true)
      expect(flow.map(r => r.getAttribute('data-index'))[0]).toBe('95')
      void box
    })
  }
})

describe('G-428: a focusout with no relatedTarget', () => {
  it('while the focus is still in the row (the window lost the focus): the row stays pinned', async () => {
    const box = await mount(List)
    const btn = await focusRow3(box)
    // what a window blur sends: the element stays the document's activeElement
    btn.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    await settle()
    await scroll(box, 6400)
    expect(btn.isConnected).toBe(true)
    expect(document.activeElement).toBe(btn)
  })

  it('when the focus really left (the element is blurred): the row goes', async () => {
    const box = await mount(List)
    const btn = await focusRow3(box)
    btn.blur()
    await settle()
    await scroll(box, 6400)
    expect(btn.isConnected).toBe(false)
  })
})
