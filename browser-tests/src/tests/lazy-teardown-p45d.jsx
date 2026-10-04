// P45-D: lazy per-component wiring, synchronous teardown, and the view-walk fixes (G-256) in a
// real browser.
import { run, Transition, Collection } from 'sygnal'
import { mount, assert, runTest, waitFor, wait } from '../harness.js'

const CAT = 'P45-D (lazy wiring, teardown)'

// G-256: a Transition inside a fragment gets its enter and leave classes
function Faded({ state }) {
  return (
    <div>
      <button className="tg">toggle</button>
      <>
        <i>x</i>
        {state.on ? <Transition name="p45d" duration={40}><p className="tp">hi</p></Transition> : null}
      </>
    </div>
  )
}
Faded.initialState = { on: false }
Faded.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.tg') })
Faded.model = { TOGGLE: (s) => ({ ...s, on: !s.on }) }

// a Collection of counters that use context, CHILD/PARENT, EFFECT and DISPOSE
function Counter({ state, context }) {
  return (
    <div className="p45d-counter">
      <span className="val">{context.prefix}{state.n}</span>
      <button className="inc">+</button>
      <button className="pick">pick</button>
    </div>
  )
}
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc'), PICK: DOM.click('.pick') })
Counter.model = {
  INC: (s) => ({ ...s, n: s.n + 1 }),
  PICK: { PARENT: (s) => s.id },
  DISPOSE: { EFFECT: (s) => { window.__p45dDisposed.push([s.id, document.querySelectorAll('.p45d-counter').length]) } },
}
function Counters({ state }) {
  return (
    <div>
      <button className="create">create</button>
      <button className="destroy">destroy</button>
      <b className="picked">{state.picked}</b>
      <Collection of={Counter} from="counters" />
    </div>
  )
}
Counters.initialState = { counters: [], prefix: '#', picked: '' }
Counters.context = { prefix: (s) => s.prefix }
Counters.intent = ({ DOM, CHILD }) => ({ CREATE: DOM.click('.create'), DESTROY: DOM.click('.destroy'), PICKED: CHILD.select(Counter) })
Counters.model = {
  CREATE: (s) => ({ ...s, counters: Array.from({ length: 300 }, (_, i) => ({ id: i + 1, n: 0 })) }),
  DESTROY: (s) => ({ ...s, counters: [] }),
  PICKED: (s, id) => ({ ...s, picked: String(id) }),
}

export async function lazyTeardownTestsP45D() {
  await runTest(CAT, 'Collection items: context, CHILD and EFFECT work; unmounting 300 takes a few setTimeouts and runs DISPOSE before the patch', async () => {
    const { id, el } = mount()
    window.__p45dDisposed = []
    const app = run(Counters, {}, { mountPoint: id })
    const st = window.setTimeout
    try {
      await waitFor(() => el.querySelector('.create'))
      await wait(30)
      el.querySelector('.create').click()
      await waitFor(() => el.querySelectorAll('.p45d-counter').length == 300, 2000, 5)
      const c5 = el.querySelectorAll('.p45d-counter')[4]
      assert(c5.querySelector('.val').textContent == '#0', `context in an item: ${c5.querySelector('.val').textContent}`)
      c5.querySelector('.inc').click()
      await waitFor(() => c5.querySelector('.val').textContent == '#1', 1000, 2)
      c5.querySelector('.pick').click()
      await waitFor(() => el.querySelector('.picked').textContent == '5', 1000, 2)
      await wait(50)
      let timeouts = 0
      window.setTimeout = function (...a) { timeouts++; return st.apply(this, a) }
      el.querySelector('.destroy').click()
      await waitFor(() => el.querySelectorAll('.p45d-counter').length == 0, 2000, 2)
      await wait(200)
      window.setTimeout = st
      assert(timeouts < 100, `${timeouts} setTimeout calls to unmount 300 items`)
      assert(window.__p45dDisposed.length == 300, `${window.__p45dDisposed.length} DISPOSE effects`)
      assert(window.__p45dDisposed.every(([, n]) => n == 300), 'every DISPOSE effect ran before the patch removed the items')
    } finally { window.setTimeout = st; app.dispose() }
  })

  await runTest(CAT, 'G-256: a Transition inside a fragment enters and leaves with its classes', async () => {
    const { id, el } = mount()
    const app = run(Faded, {}, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('.tg'))
      await wait(30)
      el.querySelector('.tg').click()
      await waitFor(() => el.querySelector('.tp'), 1000, 2)
      assert(!el.querySelector('transition'), 'no <transition> element')
      assert(el.querySelector('.tp').classList.contains('p45d-enter-active'), `enter classes: ${el.querySelector('.tp').className}`)
      await waitFor(() => !el.querySelector('.tp').classList.contains('p45d-enter-active'), 1000, 5)
      el.querySelector('.tg').click()
      await waitFor(() => el.querySelector('.tp')?.classList.contains('p45d-leave-active'), 1000, 2)
      await waitFor(() => !el.querySelector('.tp'), 1000, 5)
    } finally { app.dispose() }
  })
}
