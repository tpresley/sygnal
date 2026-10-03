// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'

function Frag({ state }) { return <><button className="fa">fa</button><span className="fn">{state.fragHits}</span></> }
Frag.intent = ({ DOM }) => ({ OWN: DOM.click('.fa') })
Frag.model = { OWN: (s) => ({ ...s, fragHits: s.fragHits + 1 }) }

function Box({ state }) { return <div className="box"><button className="ba">ba</button></div> }
Box.intent = ({ DOM }) => ({ OWN: DOM.click('.ba') })
Box.model = { OWN: (s) => ({ ...s, boxHits: s.boxHits + 1 }) }

function Parent({ state }) { return <div><Frag /><Box /></div> }
Parent.initialState = { fragHits: 0, boxHits: 0, leakFrag: 0, leakBox: 0 }
Parent.intent = ({ DOM }) => ({ LF: DOM.click('.fa'), LB: DOM.click('.ba') })   // selectors of the children's elements
Parent.model = { LF: (s) => ({ ...s, leakFrag: s.leakFrag + 1 }), LB: (s) => ({ ...s, leakBox: s.leakBox + 1 }) }

let t; afterEach(() => t?.dispose())
for (const dom of ['mock', 'real']) it(`isolation with fragment roots (${dom})`, async () => {
  t = renderComponent(Parent, dom === 'real' ? { dom: 'real', diagnostics: 'collect' } : { diagnostics: 'collect' }); await t.ready()
  t.simulateEvent('.fa', 'click'); await t.settle()
  t.simulateEvent('.ba', 'click'); await t.settle()
  const { fragHits, boxHits, leakFrag, leakBox } = t.state
  expect({ fragHits, boxHits, leakFrag, leakBox }).toEqual({ fragHits: 1, boxHits: 1, leakFrag: 0, leakBox: 0 })
})
