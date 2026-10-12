// PLAN-9 G-750: a keyed component instance that moves to another parent element in one patch (an
// earlier column, a later one, a deeper or a shallower one, and back) keeps its state and its
// events, leaves no element behind and stops no DOM updates. Before the fix, a move to an EARLIER
// parent removed the new element and left the old one (0-S1 saw NotFoundError in the driver).
import { run } from 'sygnal'
import { mountOnScreen, clearStage, assert, runTest, waitFor, wait } from '../harness.js'

const CAT = 'G-750 (keyed instance moves parent)'

function Counter({ state, label }) {
  return <div className="counter" data={{ label }}><span className="n">{label}:{state.n}</span><button className="inc">+</button></div>
}
Counter.isolatedState = true
Counter.initialState = { n: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Counter.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }

// each step: [deep, left, right] lists of labels
const STEPS = [
  [[], ['a', 'b'], ['c']],
  [[], ['a', 'b', 'c'], []],        // c to an earlier parent
  [['b'], ['a', 'c'], []],          // b deeper, into a parent before them
  [[], ['c'], ['b', 'a']],          // a and b to the later parent
  [['a', 'c'], [], ['b']],          // two into the deep one at once
  [[], ['a', 'b'], ['c']],          // back where they started
]
function Board({ state }) {
  const [deep, left, right] = STEPS[state.step % STEPS.length]
  const c = (k) => <Counter key={k} label={k} />
  return (
    <main>
      <button className="go">go</button>
      <section className="outer"><div className="mid"><div className="deep">{deep.map(c)}</div></div></section>
      <div className="left">{left.map(c)}</div>
      <div className="right">{right.map(c)}</div>
    </main>
  )
}
Board.initialState = { step: 0 }
Board.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
Board.model = { GO: (s) => ({ ...s, step: s.step + 1 }) }

export async function moveParentTestsP9G750() {
  await runTest(CAT, 'moves to earlier, later, deeper and shallower parents keep state and events', async () => {
    const { id, el } = mountOnScreen()
    const errors = []
    const app = run(Board, {}, { mountPoint: id, onError: (e) => errors.push(String(e && e.message || e)) })
    try {
      await waitFor(() => el.querySelector('.counter'))
      const counts = { a: 0, b: 0, c: 0 }
      const col = (sel) => [...el.querySelectorAll(`${sel} > .counter`)].map((e) => e.textContent.replace('+', ''))
      const show = (k) => `${k}:${counts[k]}`
      for (let step = 0; step < STEPS.length; step++) {
        if (step) { await window.__pw('click', `${id} .go`); await wait(30) }
        const [deep, left, right] = STEPS[step]
        assert(!errors.length, `step ${step}: errors ${errors.join('; ')}`)
        assert(el.getAttribute('data-sygnal-error') == null, `step ${step}: the DOM stopped (patch error)`)
        assert(el.querySelectorAll('.counter').length == 3, `step ${step}: ${el.querySelectorAll('.counter').length} counters`)
        assert(JSON.stringify(col('.deep')) == JSON.stringify(deep.map(show)), `step ${step} deep: ${col('.deep')}`)
        assert(JSON.stringify(col('.left')) == JSON.stringify(left.map(show)), `step ${step} left: ${col('.left')}`)
        assert(JSON.stringify(col('.right')) == JSON.stringify(right.map(show)), `step ${step} right: ${col('.right')}`)
        // every instance still gets its own clicks in its new place
        for (const k of ['a', 'b', 'c']) {
          await window.__pw('click', `${id} .counter[data-label="${k}"] .inc`)
          counts[k]++
          await waitFor(() => el.querySelector(`.counter[data-label="${k}"] .n`)?.textContent == show(k), 1000)
            .catch(() => assert(false, `step ${step}: ${k}'s click didn't reach it (${el.querySelector(`.counter[data-label="${k}"] .n`)?.textContent})`))
        }
      }
    } finally { app.dispose(); clearStage() }
  }, 15000)
}
