// P45-D: lazy per-component wiring, synchronous teardown, and the view-walk fixes (G-256) in a
// real browser.
import { run, Transition } from 'sygnal'
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

export async function lazyTeardownTestsP45D() {
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
