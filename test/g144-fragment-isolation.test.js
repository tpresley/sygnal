// @vitest-environment jsdom
// G-144: a component whose view returns a fragment keeps its DOM isolation in the real DOM
// driver, as it does in the mock DOM. Gap-study experiment X8: the fragment child's own intent
// never fired and the parent's DOM.click('.fa') caught the child's clicks instead.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Fragment } from '../src/cycle/dom/snabbdom.js'
import { Collection, Switchable } from '../src/index.js'

let t
afterEach(() => { if (t) t.dispose(); t = null; document.body.innerHTML = '' })

const MODES = [['mock', {}], ['real', { dom: 'real' }]]
const bump = (k) => (s) => ({ ...s, [k]: s[k] + 1 })

function Frag({ state }) {
  return h(Fragment, null, h('button', { className: 'fa' }, 'fa'), h('span', { className: 'fn' }, String(state.fragHits)))
}
Frag.intent = ({ DOM }) => ({ OWN: DOM.click('.fa') })
Frag.model = { OWN: bump('fragHits') }

function Box() { return h('div', { className: 'box' }, h('button', { className: 'ba' }, 'ba')) }
Box.intent = ({ DOM }) => ({ OWN: DOM.click('.ba') })
Box.model = { OWN: bump('boxHits') }

function Parent() { return h('div', null, h(Frag), h(Box)) }
Parent.initialState = { fragHits: 0, boxHits: 0, leakFrag: 0, leakBox: 0 }
Parent.intent = ({ DOM }) => ({ LF: DOM.click('.fa'), LB: DOM.click('.ba') })
Parent.model = { LF: bump('leakFrag'), LB: bump('leakBox') }

// nested fragments, a conditional second root and text at the top level
function Nested({ state }) {
  return h(Fragment, null,
    'lead text',
    h(Fragment, null, h('button', { className: 'na' }, 'na'), h(Fragment, null, h('button', { className: 'nb' }, 'nb'))),
    state.extra ? h('button', { className: 'nc' }, 'nc') : null)
}
Nested.intent = ({ DOM }) => ({ A: DOM.click('.na'), B: DOM.click('.nb'), C: DOM.click('.nc') })
Nested.model = { A: bump('a'), B: bump('b'), C: bump('c') }

function NestedParent({ state }) {
  return h('div', null,
    h('button', { className: 'toggle' }, 'toggle'),
    state.show ? h(Nested) : null)
}
NestedParent.initialState = { show: true, extra: false, a: 0, b: 0, c: 0, leak: 0 }
NestedParent.intent = ({ DOM }) => ({
  TOGGLE: DOM.click('.toggle'),
  LEAK: DOM.click('.na, .nb, .nc'),
})
NestedParent.model = { TOGGLE: (s) => ({ ...s, extra: !s.extra }), LEAK: bump('leak') }

// a component that renders nothing, then a fragment
function Maybe({ state }) {
  return state.on ? h(Fragment, null, h('button', { className: 'ma' }, 'ma'), h('i', null, 'x')) : null
}
Maybe.intent = ({ DOM }) => ({ OWN: DOM.click('.ma') })
Maybe.model = { OWN: bump('hits') }
function MaybeParent({ state }) { return h('div', null, h('button', { className: 'on' }, 'on'), h(Maybe)) }
MaybeParent.initialState = { on: false, hits: 0, leak: 0 }
MaybeParent.intent = ({ DOM }) => ({ ON: DOM.click('.on'), LEAK: DOM.click('.ma') })
MaybeParent.model = { ON: (s) => ({ ...s, on: true }), LEAK: bump('leak') }

// Collection items that return fragments
function Row({ state }) {
  return h(Fragment, null, h('dt', { className: 'k' }, state.id), h('dd', null, h('button', { className: 'hit', attrs: { 'data-id': state.id } }, String(state.n))))
}
Row.intent = ({ DOM }) => ({ HIT: DOM.click('.hit') })
Row.model = { HIT: (s) => ({ ...s, n: s.n + 1 }) }
function List({ state }) { return h('dl', null, h(Collection, { of: Row, from: 'rows' })) }
List.initialState = { rows: [{ id: 'r1', n: 0 }, { id: 'r2', n: 0 }], leak: 0 }
List.intent = ({ DOM }) => ({ LEAK: DOM.click('.hit') })
List.model = { LEAK: bump('leak') }

// Switchable pages that return fragments
function PageA() { return h(Fragment, null, h('button', { className: 'pa' }, 'pa'), h('p', null, 'A')) }
PageA.intent = ({ DOM }) => ({ OWN: DOM.click('.pa') })
PageA.model = { OWN: bump('pa') }
function PageB() { return h(Fragment, null, h('button', { className: 'pb' }, 'pb'), h('p', null, 'B')) }
PageB.intent = ({ DOM }) => ({ OWN: DOM.click('.pb') })
PageB.model = { OWN: bump('pb') }
function Pages({ state }) {
  return h('main', null, h('button', { className: 'go' }, 'go'), h(Switchable, { of: { a: PageA, b: PageB }, current: state.page }))
}
Pages.initialState = { page: 'a', pa: 0, pb: 0, leak: 0 }
Pages.intent = ({ DOM }) => ({ GO: DOM.click('.go'), LEAK: DOM.click('.pa, .pb') })
Pages.model = { GO: (s) => ({ ...s, page: 'b' }), LEAK: bump('leak') }

describe('G-144: fragment-root components keep DOM isolation', () => {
  for (const [mode, opts] of MODES) {
    it(`the child hears its own events and the parent doesn't (${mode})`, async () => {
      t = renderComponent(Parent, opts); await t.ready()
      t.simulateEvent('.fa', 'click'); await t.settle()
      t.simulateEvent('.ba', 'click'); await t.settle()
      const { fragHits, boxHits, leakFrag, leakBox } = t.state
      expect({ fragHits, boxHits, leakFrag, leakBox }).toEqual({ fragHits: 1, boxHits: 1, leakFrag: 0, leakBox: 0 })
    })

    it(`nested fragments, conditional roots and top-level text (${mode})`, async () => {
      t = renderComponent(NestedParent, opts); await t.ready()
      t.simulateEvent('.na', 'click'); await t.settle()
      t.simulateEvent('.nb', 'click'); await t.settle()
      t.simulateEvent('.toggle', 'click'); await t.settle()
      t.simulateEvent('.nc', 'click'); await t.settle()
      t.simulateEvent('.toggle', 'click'); await t.settle()
      t.simulateEvent('.na', 'click'); await t.settle()
      const { a, b, c, leak } = t.state
      expect({ a, b, c, leak }).toEqual({ a: 2, b: 1, c: 1, leak: 0 })
    })

    it(`a component that renders nothing, then a fragment (${mode})`, async () => {
      t = renderComponent(MaybeParent, opts); await t.ready()
      t.simulateEvent('.on', 'click'); await t.settle()
      t.simulateEvent('.ma', 'click'); await t.settle()
      t.simulateEvent('.ma', 'click'); await t.settle()
      expect({ hits: t.state.hits, leak: t.state.leak }).toEqual({ hits: 2, leak: 0 })
    })

    it(`Collection items that return fragments (${mode})`, async () => {
      t = renderComponent(List, opts); await t.ready()
      t.simulateEvent('.hit[data-id="r2"]', 'click'); await t.settle()
      t.simulateEvent('.hit[data-id="r2"]', 'click'); await t.settle()
      t.simulateEvent('.hit[data-id="r1"]', 'click'); await t.settle()
      expect(t.state.rows.map(r => r.n)).toEqual([1, 2])
      expect(t.state.leak).toBe(0)
    })

    it(`Switchable pages that return fragments (${mode})`, async () => {
      t = renderComponent(Pages, opts); await t.ready()
      t.simulateEvent('.pa', 'click'); await t.settle()
      t.simulateEvent('.go', 'click'); await t.settle()
      t.simulateEvent('.pb', 'click'); await t.settle()
      const { pa, pb, leak } = t.state
      expect({ pa, pb, leak }).toEqual({ pa: 1, pb: 1, leak: 0 })
    })
  }

  it('the real DOM source of a fragment child finds all of its root elements', async () => {
    let els
    function Roots() { return h(Fragment, null, h('b', { className: 'r1' }, '1'), h('b', { className: 'r2' }, '2')) }
    Roots.intent = ({ DOM }) => ({ ELS: DOM.select('b').elements() })
    Roots.model = { ELS: { EFFECT: (s, e) => { els = e } } }
    function Host() { return h('div', null, h('b', { className: 'outside' }, 'o'), h(Roots)) }
    t = renderComponent(Host, { dom: 'real' }); await t.ready(); await t.settle()
    expect(els.map(e => e.className).sort()).toEqual(['r1', 'r2'])
  })
})
