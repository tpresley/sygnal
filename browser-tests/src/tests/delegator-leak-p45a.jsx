// PLAN-4.5 P45-A (audit finding 4): a component's DOM listeners leave the event delegator when
// the component unmounts. Mount/unmount cycles of a Collection used to leave one destination
// (and its ScopeChecker) per stream behind forever.
import { run, Collection } from 'sygnal'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Delegator cleanup (P45-A)'

function held(del) {
  const checkers = new Set()
  let nodes = 0
  const walk = ([payload, kids]) => {
    nodes++
    if (payload) payload.forEach(q => q.forEach(d => checkers.add(d.scopeChecker)))
    for (const k in kids) walk(kids[k])
  }
  walk(del.virtualListeners.tree)
  return { nodes, checkers: checkers.size, nb: del.nonBubblingListenersToAdd.size }
}

let dom
function Row({ state }) {
  return (
    <li className="row">
      <button className="pick">{state.label}</button>
      <span className="picks">{String(state.picks)}</span>
      <input className="inp" value={state.label} />
    </li>
  )
}
Row.intent = ({ DOM }) => ({ PICK: DOM.click('.pick'), FOCUS: DOM.select('.inp').events('focus') })
Row.model = { PICK: (s) => ({ ...s, picks: s.picks + 1 }), FOCUS: (s) => s }

function List({ state }) {
  return (
    <div>
      <button className="fill">fill</button>
      <button className="clear">clear</button>
      <button className="keep">keep one</button>
      <ul><Collection of={Row} from="rows" /></ul>
    </div>
  )
}
List.initialState = { rows: [] }
List.intent = ({ DOM }) => {
  dom = DOM
  return { FILL: DOM.click('.fill'), CLEAR: DOM.click('.clear'), KEEP: DOM.click('.keep') }
}
List.model = {
  FILL: () => ({ rows: Array.from({ length: 200 }, (_, i) => ({ id: i, label: 'r' + i, picks: 0 })) }),
  CLEAR: () => ({ rows: [] }),
  KEEP: (s) => ({ rows: s.rows.slice(0, 1) }),
}

export async function delegatorLeakTestsP45A() {
  await runTest(CAT, '5 mount/unmount cycles of 200 rows leave no listeners behind', async () => {
    const { id, el } = mount()
    const app = run(List, {}, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('.fill'))
      await wait(50)
      const del = dom._eventDelegator
      const empty = held(del)
      for (let i = 0; i < 5; i++) {
        el.querySelector('.fill').click()
        await waitFor(() => el.querySelectorAll('.row').length === 200)
        assert(held(del).checkers >= empty.checkers + 400, `rows listen: ${JSON.stringify(held(del))}`)
        el.querySelector('.clear').click()
        await waitFor(() => el.querySelectorAll('.row').length === 0)
        await wait(50)
        const now = held(del)
        assert(JSON.stringify(now) === JSON.stringify(empty), `cycle ${i}: ${JSON.stringify(now)} vs ${JSON.stringify(empty)}`)
      }
    } finally { app.dispose() }
  }, 10000)

  await runTest(CAT, 'the rows that stay still hear clicks after their siblings unmount', async () => {
    const { id, el } = mount()
    const app = run(List, {}, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('.fill'))
      el.querySelector('.fill').click()
      await waitFor(() => el.querySelectorAll('.row').length === 200)
      el.querySelector('.keep').click()
      await waitFor(() => el.querySelectorAll('.row').length === 1)
      await wait(50)
      el.querySelector('.pick').click()
      await waitFor(() => el.querySelector('.picks').textContent === '1', 1000)
    } finally { app.dispose() }
  })
}
