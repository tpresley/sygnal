import { run, ABORT } from 'sygnal'
import xs from 'xstream'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Core Component'

export async function coreTests() {
  // Basic render
  await runTest(CAT, 'Component renders view', async () => {
    const { id, el } = mount()
    function App() { return <div className="hello">Hello Test</div> }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.hello'))
    assert(el.querySelector('.hello').textContent === 'Hello Test')
  })

  // Initial state
  await runTest(CAT, 'initialState sets state', async () => {
    const { id, el } = mount()
    function App({ state } = {}) { return <div className="count">{state.count}</div> }
    App.initialState = { count: 42 }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.count')?.textContent === '42')
  })

  // Intent + Model cycle
  await runTest(CAT, 'Intent maps events to model actions', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div><span className="val">{state.count}</span><button className="btn">+</button></div>
    }
    App.initialState = { count: 0 }
    App.intent = ({ DOM }) => ({ INC: DOM.select('.btn').events('click') })
    App.model = { INC: (state) => ({ count: state.count + 1 }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.btn'))
    el.querySelector('.btn').click()
    await waitFor(() => el.querySelector('.val')?.textContent === '1')
  })

  // ABORT cancels state update
  await runTest(CAT, 'ABORT prevents state change', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div><span className="val">{state.count}</span><button className="inc">+</button><button className="abort">abort</button></div>
    }
    App.initialState = { count: 0 }
    App.intent = ({ DOM }) => ({
      INC: DOM.select('.inc').events('click'),
      DO_ABORT: DOM.select('.abort').events('click'),
    })
    App.model = {
      INC: (state) => ({ count: state.count + 1 }),
      DO_ABORT: () => ABORT,
    }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.inc'))
    el.querySelector('.inc').click()
    await waitFor(() => el.querySelector('.val')?.textContent === '1')
    el.querySelector('.abort').click()
    await wait(100)
    assert(el.querySelector('.val').textContent === '1', 'State should not change after ABORT')
  })

  // Calculated fields
  await runTest(CAT, 'Calculated fields derive from state', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div><span className="doubled">{state.doubled}</span><button className="btn">+</button></div>
    }
    App.initialState = { count: 3 }
    App.calculated = { doubled: (state) => state.count * 2 }
    App.intent = ({ DOM }) => ({ INC: DOM.select('.btn').events('click') })
    App.model = { INC: (state) => ({ ...state, count: state.count + 1 }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.doubled')?.textContent === '6')
    el.querySelector('.btn').click()
    await waitFor(() => el.querySelector('.doubled')?.textContent === '8')
  })

  // next() delayed action
  await runTest(CAT, 'next() triggers delayed follow-up action', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div><span className="val">{state.step}</span><button className="btn">go</button></div>
    }
    App.initialState = { step: 'start' }
    App.intent = ({ DOM }) => ({ GO: DOM.select('.btn').events('click') })
    App.model = {
      GO: (state, _data, next) => { next('DONE', null, 10); return { step: 'going' } },
      DONE: () => ({ step: 'done' }),
    }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.btn'))
    el.querySelector('.btn').click()
    await waitFor(() => el.querySelector('.val')?.textContent === 'done')
  })
}
