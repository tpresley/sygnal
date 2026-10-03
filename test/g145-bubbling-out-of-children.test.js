// @vitest-environment jsdom
// G-145: events bubble out of an isolated child the way they do in the browser. A listener on
// an element the parent rendered itself hears events from inside the children it wraps, in
// the real DOM driver as in the mock DOM. The parent still can't select elements inside a
// child (SYG104). Gap-study experiment X7.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Fragment } from '../src/cycle/dom/snabbdom.js'
import { Collection } from '../src/index.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
afterEach(() => { if (t) t.dispose(); t = null; _resetDiagnostics(); document.body.innerHTML = '' })

const MODES = [['mock', {}], ['real', { dom: 'real' }]]
const log = (s, entry) => ({ ...s, log: [...s.log, entry] })

function Child({ state }) {
  return h('div', { className: 'child' }, h('button', { className: 'inner' }, 'inner'), h('span', { className: 'txt' }, String(state.n)))
}
Child.intent = ({ DOM }) => ({ INNER: DOM.click('.inner') })
Child.model = { INNER: { PARENT: () => 'inner-clicked' } }

function FragChild() { return h(Fragment, null, h('button', { className: 'a' }, 'a'), h('p', { className: 'b' }, 'b')) }

function Parent({ state }) {
  return h('div', null,
    h('div', { className: 'slot' }, h(Child, { state: 'c' })),
    h('div', { className: 'slot' }, h(FragChild)),
    h('p', { className: 'log' }, state.log.join(',')))
}
Parent.initialState = { c: { n: 1 }, log: [] }
Parent.intent = ({ DOM, CHILD }) => ({
  WRAP: DOM.click('.slot'),
  FROM: CHILD.select(Child),
})
Parent.model = {
  WRAP: (s, e) => log(s, 'wrap:' + e.target.tagName),
  FROM: (s, v) => log(s, 'child:' + v),
}

// the parent selects an element inside a child: still isolated (SYG104)
function Peeker() {
  return h('section', { className: 'outer' }, h(Child, { state: 'c' }))
}
Peeker.initialState = { c: { n: 1 }, log: [] }
Peeker.intent = ({ DOM }) => ({ PEEK: DOM.click('.inner'), PEEK_ROOT: DOM.click('.child'), OUTER: DOM.click('.outer') })
Peeker.model = { PEEK: (s) => log(s, 'peek'), PEEK_ROOT: (s) => log(s, 'peek-root'), OUTER: (s) => log(s, 'outer') }

// a Collection inside the parent's own list element
function Item({ state }) { return h('li', null, h('button', { className: 'pick' }, state.id)) }
Item.intent = ({ DOM }) => ({ PICK: DOM.click('.pick') })
Item.model = { PICK: (s) => ({ ...s, picks: s.picks + 1 }) }
function Board({ state }) { return h('div', null, h('ul', { className: 'list' }, h(Collection, { of: Item, from: 'items' }))) }
Board.initialState = { items: [{ id: 'x', picks: 0 }, { id: 'y', picks: 0 }], log: [] }
Board.intent = ({ DOM }) => ({ LIST: DOM.click('.list') })
Board.model = { LIST: (s) => log(s, 'list') }

describe('G-145: events bubble out of children to elements the parent rendered', () => {
  for (const [mode, opts] of MODES) {
    it(`the parent's wrapper hears clicks from inside the children it wraps (${mode})`, async () => {
      t = renderComponent(Parent, opts); await t.ready()
      t.simulateEvent('.inner', 'click'); await t.settle()
      t.simulateEvent('.txt', 'click'); await t.settle()
      t.simulateEvent('.a', 'click'); await t.settle()
      t.simulateEvent('.b', 'click'); await t.settle()
      // native order: the child's listener on the button runs before the parent's on the wrapper
      expect(t.state.log.join(' | ')).toBe('child:inner-clicked | wrap:BUTTON | wrap:SPAN | wrap:BUTTON | wrap:P')
    })

    it(`the parent still can't select elements inside a child (${mode})`, async () => {
      t = renderComponent(Peeker, opts); await t.ready()
      t.simulateEvent('.inner', 'click'); await t.settle()
      expect(t.state.log).toEqual(['outer'])
    })

    it(`a list element around a Collection hears its items' clicks (${mode})`, async () => {
      t = renderComponent(Board, opts); await t.ready()
      t.simulateEvent('.pick', 'click'); await t.settle()
      expect(t.state.items.map(i => i.picks)).toEqual([1, 0])
      expect(t.state.log).toEqual(['list'])
    })

    it(`within one component the deeper listener runs first (${mode})`, async () => {
      function Card() { return h('div', { className: 'card' }, h('button', { className: 'btn' }, 'b')) }
      Card.initialState = { log: [] }
      Card.intent = ({ DOM }) => ({ CARD: DOM.click('.card'), BTN: DOM.click('.btn') })
      Card.model = { CARD: (s) => log(s, 'card'), BTN: (s) => log(s, 'btn') }
      t = renderComponent(Card, opts); await t.ready()
      t.simulateEvent('.btn', 'click'); await t.settle()
      expect(t.state.log).toEqual(['btn', 'card'])
    })
  }

  it('stopPropagation() in the child keeps the event from the parent (real)', async () => {
    function Stopper() { return h('button', { className: 'stop' }, 'stop') }
    Stopper.intent = ({ DOM }) => ({ STOP: DOM.click('.stop').map(e => { e.stopPropagation(); return null }) })
    Stopper.model = { STOP: { EFFECT: () => {} } }
    function Host() { return h('div', { className: 'host' }, h(Stopper), h('button', { className: 'go' }, 'go')) }
    Host.initialState = { log: [] }
    Host.intent = ({ DOM }) => ({ HOST: DOM.click('.host') })
    Host.model = { HOST: (s) => log(s, 'host') }
    t = renderComponent(Host, { dom: 'real' }); await t.ready()
    t.simulateEvent('.stop', 'click'); await t.settle()
    t.simulateEvent('.go', 'click'); await t.settle()
    expect(t.state.log).toEqual(['host'])
  })

  it('capture listeners on the parent run before the child (real)', async () => {
    const order = []
    function Leaf() { return h('button', { className: 'leaf' }, 'leaf') }
    Leaf.intent = ({ DOM }) => ({ LEAF: DOM.select('.leaf').events('click') })
    Leaf.model = { LEAF: { EFFECT: () => { order.push('leaf') } } }
    function Host() { return h('div', { className: 'host' }, h(Leaf)) }
    Host.initialState = {}
    Host.intent = ({ DOM }) => ({
      CAP: DOM.select('.host').events('click', { useCapture: true }),
      BUB: DOM.select('.host').events('click'),
    })
    Host.model = { CAP: { EFFECT: () => { order.push('capture') } }, BUB: { EFFECT: () => { order.push('bubble') } } }
    t = renderComponent(Host, { dom: 'real' }); await t.ready()
    t.simulateEvent('.leaf', 'click'); await t.settle()
    expect(order).toEqual(['capture', 'leaf', 'bubble'])
  })
})
