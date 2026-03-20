import { run, createCommand, ABORT } from 'sygnal'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Commands'

export async function commandTests() {
  // Test: parent sends command to child via commands$ source
  await runTest(CAT, 'child receives commands via commands$.select()', async () => {
    const { id, el } = mount()

    const cmd = createCommand()

    function Child({ state } = {}) {
      return <div className="child-count">Count: {state.count}</div>
    }

    Child.intent = ({ commands$ }) => ({
      INCREMENT: commands$.select('increment'),
    })

    Child.model = {
      INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
    }

    function App({ state }) {
      return (
        <div>
          <button className="send-cmd">Send</button>
          <Child commands={cmd} state="child" />
        </div>
      )
    }

    App.initialState = { child: { count: 0 } }

    App.intent = ({ DOM }) => ({
      SEND: DOM.select('.send-cmd').events('click'),
    })

    App.model = {
      SEND: () => { cmd.send('increment'); return ABORT },
    }

    run(App, {}, { mountPoint: id })

    await waitFor(() => el.querySelector('.child-count'))
    assert(
      el.querySelector('.child-count')?.textContent === 'Count: 0',
      'Child should start at count 0'
    )

    el.querySelector('.send-cmd').click()
    await wait(100)
    assert(
      el.querySelector('.child-count')?.textContent === 'Count: 1',
      'Child should increment to 1 after command'
    )

    el.querySelector('.send-cmd').click()
    el.querySelector('.send-cmd').click()
    await wait(100)
    assert(
      el.querySelector('.child-count')?.textContent === 'Count: 3',
      'Child should increment to 3 after two more commands'
    )
  })

  // Test: command data is extracted by select()
  await runTest(CAT, 'commands$.select() extracts data from send()', async () => {
    const { id, el } = mount()

    const cmd = createCommand()

    function Child({ state } = {}) {
      return <div className="child-label">{state.label}</div>
    }

    Child.intent = ({ commands$ }) => ({
      SET_LABEL: commands$.select('set-label'),
    })

    Child.model = {
      SET_LABEL: (state, label) => ({ ...state, label }),
    }

    function App({ state }) {
      return (
        <div>
          <button className="cmd-hello">Hello</button>
          <button className="cmd-world">World</button>
          <Child commands={cmd} state="child" />
        </div>
      )
    }

    App.initialState = { child: { label: 'none' } }

    App.intent = ({ DOM }) => ({
      CMD_HELLO: DOM.select('.cmd-hello').events('click'),
      CMD_WORLD: DOM.select('.cmd-world').events('click'),
    })

    App.model = {
      CMD_HELLO: () => { cmd.send('set-label', 'Hello'); return ABORT },
      CMD_WORLD: () => { cmd.send('set-label', 'World'); return ABORT },
    }

    run(App, {}, { mountPoint: id })

    await waitFor(() => el.querySelector('.child-label'))
    assert(
      el.querySelector('.child-label')?.textContent === 'none',
      'Child should start with "none"'
    )

    el.querySelector('.cmd-hello').click()
    await wait(100)
    assert(
      el.querySelector('.child-label')?.textContent === 'Hello',
      'Child should show "Hello" after command with data'
    )

    el.querySelector('.cmd-world').click()
    await wait(100)
    assert(
      el.querySelector('.child-label')?.textContent === 'World',
      'Child should show "World" after second command'
    )
  })

  // Test: select() filters by command type
  await runTest(CAT, 'commands$.select() only matches its command type', async () => {
    const { id, el } = mount()

    const cmd = createCommand()

    function Child({ state } = {}) {
      return <div className="child-value">{state.value}</div>
    }

    Child.intent = ({ commands$ }) => ({
      SET_A: commands$.select('a'),
      SET_B: commands$.select('b'),
    })

    Child.model = {
      SET_A: (state) => ({ ...state, value: 'A' }),
      SET_B: (state) => ({ ...state, value: 'B' }),
    }

    function App({ state }) {
      return (
        <div>
          <button className="cmd-a">A</button>
          <button className="cmd-b">B</button>
          <Child commands={cmd} state="child" />
        </div>
      )
    }

    App.initialState = { child: { value: '-' } }

    App.intent = ({ DOM }) => ({
      CMD_A: DOM.select('.cmd-a').events('click'),
      CMD_B: DOM.select('.cmd-b').events('click'),
    })

    App.model = {
      CMD_A: () => { cmd.send('a'); return ABORT },
      CMD_B: () => { cmd.send('b'); return ABORT },
    }

    run(App, {}, { mountPoint: id })

    await waitFor(() => el.querySelector('.child-value'))

    el.querySelector('.cmd-a').click()
    await wait(100)
    assert(
      el.querySelector('.child-value')?.textContent === 'A',
      'Should show A after "a" command'
    )

    el.querySelector('.cmd-b').click()
    await wait(100)
    assert(
      el.querySelector('.child-value')?.textContent === 'B',
      'Should show B after "b" command (not affected by "a" handler)'
    )
  })

  // Test: two separate command channels don't cross-talk
  await runTest(CAT, 'separate command channels are isolated between children', async () => {
    const { id, el } = mount()

    const cmdAlpha = createCommand()
    const cmdBeta = createCommand()

    function Counter({ state } = {}) {
      return <div className={`counter-${state.name}`}>{state.name}: {state.count}</div>
    }

    Counter.intent = ({ commands$ }) => ({
      INCREMENT: commands$.select('increment'),
      RESET:     commands$.select('reset'),
    })

    Counter.model = {
      INCREMENT: (state, amount) => ({ ...state, count: state.count + (amount || 1) }),
      RESET:     (state) => ({ ...state, count: 0 }),
    }

    function App({ state }) {
      return (
        <div>
          <button className="inc-alpha">Inc Alpha</button>
          <button className="inc-beta">Inc Beta</button>
          <button className="reset-alpha">Reset Alpha</button>
          <button className="inc-both">Inc Both</button>
          <Counter cmd={cmdAlpha} state="alpha" />
          <Counter cmd={cmdBeta} state="beta" />
        </div>
      )
    }

    App.initialState = {
      alpha: { name: 'alpha', count: 0 },
      beta:  { name: 'beta', count: 0 },
    }

    App.intent = ({ DOM }) => ({
      INC_ALPHA:   DOM.select('.inc-alpha').events('click'),
      INC_BETA:    DOM.select('.inc-beta').events('click'),
      RESET_ALPHA: DOM.select('.reset-alpha').events('click'),
      INC_BOTH:    DOM.select('.inc-both').events('click'),
    })

    App.model = {
      INC_ALPHA:   () => { cmdAlpha.send('increment'); return ABORT },
      INC_BETA:    () => { cmdBeta.send('increment'); return ABORT },
      RESET_ALPHA: () => { cmdAlpha.send('reset'); return ABORT },
      INC_BOTH:    () => { cmdAlpha.send('increment'); cmdBeta.send('increment'); return ABORT },
    }

    run(App, {}, { mountPoint: id })

    await waitFor(() => el.querySelector('.counter-alpha') && el.querySelector('.counter-beta'))
    assert(
      el.querySelector('.counter-alpha')?.textContent === 'alpha: 0',
      'Alpha should start at 0'
    )
    assert(
      el.querySelector('.counter-beta')?.textContent === 'beta: 0',
      'Beta should start at 0'
    )

    // Increment only alpha — beta must not change
    el.querySelector('.inc-alpha').click()
    await wait(100)
    assert(
      el.querySelector('.counter-alpha')?.textContent === 'alpha: 1',
      'Alpha should be 1 after its own command'
    )
    assert(
      el.querySelector('.counter-beta')?.textContent === 'beta: 0',
      'Beta should still be 0 — alpha command must not leak'
    )

    // Increment only beta — alpha must not change
    el.querySelector('.inc-beta').click()
    await wait(100)
    assert(
      el.querySelector('.counter-alpha')?.textContent === 'alpha: 1',
      'Alpha should still be 1 — beta command must not leak'
    )
    assert(
      el.querySelector('.counter-beta')?.textContent === 'beta: 1',
      'Beta should be 1 after its own command'
    )

    // Reset alpha — beta must not be affected
    el.querySelector('.reset-alpha').click()
    await wait(100)
    assert(
      el.querySelector('.counter-alpha')?.textContent === 'alpha: 0',
      'Alpha should be 0 after reset'
    )
    assert(
      el.querySelector('.counter-beta')?.textContent === 'beta: 1',
      'Beta should still be 1 — alpha reset must not affect beta'
    )

    // Increment both at once — both should change
    el.querySelector('.inc-both').click()
    await wait(100)
    assert(
      el.querySelector('.counter-alpha')?.textContent === 'alpha: 1',
      'Alpha should be 1 after inc-both'
    )
    assert(
      el.querySelector('.counter-beta')?.textContent === 'beta: 2',
      'Beta should be 2 after inc-both'
    )
  })
}
