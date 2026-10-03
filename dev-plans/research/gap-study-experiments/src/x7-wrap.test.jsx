// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest'
import { renderComponent, Collection } from 'sygnal'
import { controls } from './controls.js'

const { Inner } = controls({ Inner: 'button' })
const { Slot } = controls({ Slot: 'div' })

function Child({ state }) { return <div className="child"><Inner>inner</Inner><span className="txt">{state.n}</span></div> }
Child.intent = ({ DOM }) => ({ INNER: DOM.click(Inner.sel) })
Child.model = { INNER: { PARENT: () => 'inner-clicked' } }

function FragChild() { return <><button className="a">a</button><p className="b">b</p></> }

function Parent({ state }) {
  return <div>
    <Slot><Child state="c" /></Slot>
    <Slot className="frag"><FragChild /></Slot>
    <p className="log">{state.log.join(',')}</p>
  </div>
}
Parent.initialState = { c: { n: 1 }, log: [] }
Parent.intent = ({ DOM, CHILD }) => ({
  WRAP:  DOM.click(Slot.sel),                       // parent-owned wrapper element
  FROM:  CHILD.select(Child),
})
Parent.model = {
  WRAP: (s, e) => ({ ...s, log: [...s.log, 'wrap:' + (e.target.className || e.target.tagName)] }),
  FROM: (s, v) => ({ ...s, log: [...s.log, 'child:' + v] }),
}
let t; afterEach(() => t?.dispose())
for (const dom of ['mock', 'real']) it(`parent wrapper hears clicks from inside children (${dom})`, async () => {
  t = renderComponent(Parent, dom === 'real' ? { dom: 'real' } : {}); await t.ready()
  t.simulateEvent(Inner.sel, 'click'); await t.settle()
  t.simulateEvent('.txt', 'click'); await t.settle()
  t.simulateEvent('.a', 'click'); await t.settle()
  t.simulateEvent('.b', 'click'); await t.settle()
  // recommended semantics (what the mock DOM does today): the parent's own wrapper hears bubbled clicks
  expect(t.state.log.join(' | ')).toBe('wrap:BUTTON | child:inner-clicked | wrap:SPAN | wrap:BUTTON | wrap:P')
})
