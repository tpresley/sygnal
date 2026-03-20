import { run, createCommand, ABORT } from 'sygnal'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Effect & Shorthand'

export async function effectShorthandTests() {
  // Test: EFFECT sink runs side effects without state change
  await runTest(CAT, 'EFFECT sink runs side effects without changing state', async () => {
    const { id, el } = mount()

    const cmd = createCommand()
    let effectCount = 0

    function Child({ state } = {}) {
      return <div className="child-val">Value: {state.value}</div>
    }

    Child.intent = ({ commands$ }) => ({
      SET: commands$.select('set'),
    })

    Child.model = {
      SET: (state, val) => ({ ...state, value: val }),
    }

    function App({ state }) {
      return (
        <div>
          <div className="app-count">Count: {state.count}</div>
          <button className="effect-btn">Fire</button>
          <Child commands={cmd} state="child" />
        </div>
      )
    }

    App.initialState = { count: 0, child: { value: 'none' } }

    App.intent = ({ DOM }) => ({
      FIRE: DOM.select('.effect-btn').events('click'),
    })

    App.model = {
      FIRE: {
        EFFECT: (state) => {
          effectCount++
          cmd.send('set', 'from-effect')
        },
      },
    }

    run(App, {}, { mountPoint: id })

    await waitFor(() => el.querySelector('.app-count'))
    assert(
      el.querySelector('.app-count')?.textContent === 'Count: 0',
      'App state should start at 0'
    )

    el.querySelector('.effect-btn').click()
    await wait(150)

    assert(
      el.querySelector('.app-count')?.textContent === 'Count: 0',
      'App state should remain 0 after EFFECT (no state change)'
    )
    assert(
      el.querySelector('.child-val')?.textContent === 'Value: from-effect',
      'Child should receive command sent from EFFECT handler'
    )
    assert(effectCount === 1, 'Effect should have run once')
  })

  // Test: EFFECT with next() dispatches follow-up actions
  await runTest(CAT, 'EFFECT handler can dispatch actions via next()', async () => {
    const { id, el } = mount()

    function App({ state }) {
      return (
        <div>
          <button className="route-btn">Route</button>
          <div className="result">{state.result}</div>
        </div>
      )
    }

    App.initialState = { mode: 'a', result: 'none' }

    App.intent = ({ DOM }) => ({
      ROUTE: DOM.select('.route-btn').events('click'),
    })

    App.model = {
      ROUTE: {
        EFFECT: (state, data, next) => {
          if (state.mode === 'a') next('DO_A')
          else next('DO_B')
        },
      },
      DO_A: (state) => ({ ...state, result: 'routed-to-A' }),
      DO_B: (state) => ({ ...state, result: 'routed-to-B' }),
    }

    run(App, {}, { mountPoint: id })

    await waitFor(() => el.querySelector('.result'))
    el.querySelector('.route-btn').click()
    await wait(150)
    assert(
      el.querySelector('.result')?.textContent === 'routed-to-A',
      'EFFECT should route to DO_A based on state.mode'
    )
  })

  // Test: Model shorthand 'ACTION | DRIVER' syntax
  await runTest(CAT, "'ACTION | DRIVER' shorthand expands correctly", async () => {
    const { id, el } = mount()

    const cmd = createCommand()

    function Child({ state } = {}) {
      return <div className="sh-child">{state.label}</div>
    }

    Child.intent = ({ commands$ }) => ({
      SET_LABEL: commands$.select('label'),
    })

    Child.model = {
      SET_LABEL: (state, val) => ({ ...state, label: val }),
    }

    function App({ state }) {
      return (
        <div>
          <button className="sh-btn">Send</button>
          <Child commands={cmd} state="child" />
        </div>
      )
    }

    App.initialState = { child: { label: 'init' } }

    App.intent = ({ DOM }) => ({
      SEND: DOM.select('.sh-btn').events('click'),
    })

    App.model = {
      'SEND | EFFECT': () => cmd.send('label', 'shorthand-works'),
    }

    run(App, {}, { mountPoint: id })

    await waitFor(() => el.querySelector('.sh-child'))
    assert(
      el.querySelector('.sh-child')?.textContent === 'init',
      'Child should start with "init"'
    )

    el.querySelector('.sh-btn').click()
    await wait(150)
    assert(
      el.querySelector('.sh-child')?.textContent === 'shorthand-works',
      'Shorthand EFFECT should have sent command to child'
    )
  })

  // Test: Shorthand with whitespace around pipe
  await runTest(CAT, "shorthand works with whitespace around '|'", async () => {
    const { id, el } = mount()

    let ran = false

    function App({ state }) {
      return (
        <div>
          <button className="ws-btn">Go</button>
          <div className="ws-result">{state.done ? 'done' : 'waiting'}</div>
        </div>
      )
    }

    App.initialState = { done: false }

    App.intent = ({ DOM }) => ({
      GO: DOM.select('.ws-btn').events('click'),
    })

    App.model = {
      '  GO  |  EFFECT  ': (state, data, next) => {
        ran = true
        next('FINISH')
      },
      FINISH: (state) => ({ ...state, done: true }),
    }

    run(App, {}, { mountPoint: id })

    await waitFor(() => el.querySelector('.ws-result'))
    el.querySelector('.ws-btn').click()
    await wait(150)
    assert(ran, 'EFFECT with whitespace-padded shorthand should have run')
    assert(
      el.querySelector('.ws-result')?.textContent === 'done',
      'next() from shorthand EFFECT should update state'
    )
  })

  // Test: EFFECT combined with STATE in same action
  await runTest(CAT, 'EFFECT and STATE can coexist in the same action', async () => {
    const { id, el } = mount()

    let sideEffectRan = false

    function App({ state }) {
      return (
        <div>
          <button className="combo-btn">Both</button>
          <div className="combo-count">{state.count}</div>
        </div>
      )
    }

    App.initialState = { count: 0 }

    App.intent = ({ DOM }) => ({
      BOTH: DOM.select('.combo-btn').events('click'),
    })

    App.model = {
      BOTH: {
        STATE: (state) => ({ ...state, count: state.count + 1 }),
        EFFECT: () => { sideEffectRan = true },
      },
    }

    run(App, {}, { mountPoint: id })

    await waitFor(() => el.querySelector('.combo-count'))
    el.querySelector('.combo-btn').click()
    await wait(100)
    assert(sideEffectRan, 'EFFECT should run alongside STATE')
    assert(
      el.querySelector('.combo-count')?.textContent === '1',
      'STATE reducer should still update state'
    )
  })
}
