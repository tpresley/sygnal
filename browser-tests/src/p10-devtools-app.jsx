// PLAN-10 P-1: a small app with sygnal/diagnostics and sygnal/devtools loaded (as sygnal/vite does in
// dev) for the devtools panel's App graph test (graph-view-runtime.mjs): two run()s, a Collection,
// a Switchable with a hidden page, a context read, and an intent action with no model entry (SYG101).
import 'sygnal/devtools'
import 'sygnal/diagnostics'
import { run, Collection, Switchable, event } from 'sygnal'

function Line({ state, context }) { return <li className="line">{state.title} {context.currency}</li> }

function Cart() { return <ul className="cart"><Collection of={Line} from="items" /></ul> }

function Shop() { return <p className="shop">shop</p> }
Shop.model = { BUY: (s) => s }

function Header() { return <button className="go">go</button> }
Header.intent = ({ DOM }) => ({ GO: DOM.select('.go').events('click') })
Header.model = { GO: { EVENTS: event('NAVIGATE', () => 'shop') } }

function App({ state }) {
  return (
    <main>
      <Header />
      <button className="add">add</button>
      <span className="count">{state.items.length}</span>
      <Switchable of={{ cart: Cart, shop: Shop }} current={state.page} />
    </main>
  )
}
App.initialState = { page: 'cart', currency: 'EUR', items: [{ id: 1, title: 'tea' }, { id: 2, title: 'cake' }] }
App.context = { currency: (s) => s.currency }
App.intent = ({ DOM, EVENTS }) => ({
  ADD: DOM.select('.add').events('click'),
  NAV: EVENTS.select('NAVIGATE'),
  ORPHAN: DOM.select('.add').events('dblclick'), // SYG101: no model entry
})
App.model = {
  ADD: (s) => ({ ...s, items: [...s.items, { id: s.items.length + 1, title: 'jam' }] }),
  NAV: (s, page) => ({ ...s, page }),
}

function Counter({ state }) { return <button className="inc">{state.n}</button> }
Counter.initialState = { n: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.select('.inc').events('click') })
Counter.model = { INC: (s) => ({ n: s.n + 1 }) }

// sygnal/vite passes run() its `diagnostics` mode in dev
run(App, {}, { mountPoint: '#root', diagnostics: 'warn' })
run(Counter, {}, { mountPoint: '#root2', diagnostics: 'warn' })
window.__p10Ready = true
