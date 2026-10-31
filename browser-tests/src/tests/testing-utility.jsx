import { renderComponent } from 'sygnal'
import { assert, runTest } from '../harness.js'

const CAT = 'Testing Utility'

const wait = (ms) => new Promise(r => setTimeout(r, ms))

export async function testingUtilityTests() {
  // Test: renderComponent returns expected shape
  await runTest(CAT, 'renderComponent returns state$, simulateAction, waitForState, dispose', async () => {
    function App({ state }) {
      return <div>{state.count}</div>
    }
    App.initialState = { count: 0 }

    const t = renderComponent(App)
    try {
      assert(t.state$ !== undefined, 'should have state$')
      assert(t.dom$ !== undefined, 'should have dom$')
      assert(t.events$ !== undefined, 'should have events$')
      assert(typeof t.simulateAction === 'function', 'should have simulateAction')
      assert(typeof t.waitForState === 'function', 'should have waitForState')
      assert(typeof t.dispose === 'function', 'should have dispose')
      assert(Array.isArray(t.states), 'should have states array')
    } finally {
      t.dispose()
    }
  })

  // Test: initial state is collected
  await runTest(CAT, 'collects initial state', async () => {
    function App({ state }) {
      return <div>{state.value}</div>
    }
    App.initialState = { value: 42 }

    const t = renderComponent(App)
    try {
      await wait(100)
      assert(t.states.length >= 1, 'should have at least one state')
      assert(t.states[0].value === 42, 'initial state should be { value: 42 }')
    } finally {
      t.dispose()
    }
  })

  // Test: initialState override
  await runTest(CAT, 'initialState option overrides component default', async () => {
    function App({ state }) {
      return <div>{state.count}</div>
    }
    App.initialState = { count: 0 }

    const t = renderComponent(App, { initialState: { count: 99 } })
    try {
      await wait(100)
      assert(t.states[0].count === 99, 'should start with overridden count 99')
    } finally {
      t.dispose()
    }
  })

  // Test: simulateAction triggers state change
  await runTest(CAT, 'simulateAction triggers model reducer', async () => {
    function Counter({ state }) {
      return <div>{state.count}</div>
    }
    Counter.initialState = { count: 0 }
    Counter.intent = ({ DOM }) => ({
      INC: DOM.select('.btn').events('click'), // sygnal-ignore SYG110 (intentionally unrendered: this test drives the action with simulateAction)
    })
    Counter.model = {
      INC: (state) => ({ ...state, count: state.count + 1 }),
    }

    const t = renderComponent(Counter)
    try {
      await wait(100)
      t.simulateAction('INC')
      await wait(100)
      const last = t.states[t.states.length - 1]
      assert(last.count === 1, `count should be 1, got ${last.count}`)
    } finally {
      t.dispose()
    }
  })

  // Test: simulateAction with data
  await runTest(CAT, 'simulateAction passes data to reducer', async () => {
    function App({ state }) {
      return <div>{state.label}</div>
    }
    App.initialState = { label: 'none' }
    App.intent = ({ DOM }) => ({
      SET: DOM.select('.btn').events('click'), // sygnal-ignore SYG110 (intentionally unrendered: this test drives the action with simulateAction)
    })
    App.model = {
      SET: (state, label) => ({ ...state, label }),
    }

    const t = renderComponent(App)
    try {
      await wait(100)
      t.simulateAction('SET', 'hello')
      await wait(100)
      assert(
        t.states[t.states.length - 1].label === 'hello',
        'label should be "hello"'
      )
    } finally {
      t.dispose()
    }
  })

  // Test: waitForState resolves when predicate matches
  await runTest(CAT, 'waitForState resolves when state matches', async () => {
    function Counter({ state }) {
      return <div>{state.count}</div>
    }
    Counter.initialState = { count: 0 }
    Counter.intent = ({ DOM }) => ({
      INC: DOM.select('.btn').events('click'), // sygnal-ignore SYG110 (intentionally unrendered: this test drives the action with simulateAction)
    })
    Counter.model = {
      INC: (state) => ({ ...state, count: state.count + 1 }),
    }

    const t = renderComponent(Counter)
    try {
      await wait(100)

      // Schedule an action after a short delay
      setTimeout(() => t.simulateAction('INC'), 50)

      const state = await t.waitForState(s => s.count === 1, 2000)
      assert(state.count === 1, 'resolved state should have count 1')
    } finally {
      t.dispose()
    }
  })

  // Test: waitForState rejects on timeout
  await runTest(CAT, 'waitForState rejects on timeout', async () => {
    function App({ state }) {
      return <div>{state.x}</div>
    }
    App.initialState = { x: 0 }

    const t = renderComponent(App)
    try {
      await wait(100)
      let rejected = false
      try {
        await t.waitForState(s => s.x === 999, 200)
      } catch (err) {
        rejected = true
        assert(err.message.includes('timed out'), 'error should mention timeout')
      }
      assert(rejected, 'waitForState should have rejected')
    } finally {
      t.dispose()
    }
  })

  // Test: multiple actions accumulate state
  await runTest(CAT, 'multiple simulateAction calls accumulate correctly', async () => {
    function Counter({ state }) {
      return <div>{state.count}</div>
    }
    Counter.initialState = { count: 0 }
    Counter.intent = ({ DOM }) => ({
      INC: DOM.select('.inc').events('click'), // sygnal-ignore SYG110 (intentionally unrendered: this test drives the action with simulateAction)
      DEC: DOM.select('.dec').events('click'), // sygnal-ignore SYG110 (intentionally unrendered: this test drives the action with simulateAction)
    })
    Counter.model = {
      INC: (state) => ({ ...state, count: state.count + 1 }),
      DEC: (state) => ({ ...state, count: state.count - 1 }),
    }

    const t = renderComponent(Counter)
    try {
      await wait(100)
      t.simulateAction('INC')
      await wait(50)
      t.simulateAction('INC')
      await wait(50)
      t.simulateAction('INC')
      await wait(50)
      t.simulateAction('DEC')
      await wait(100)
      assert(
        t.states[t.states.length - 1].count === 2,
        `count should be 2, got ${t.states[t.states.length - 1].count}`
      )
    } finally {
      t.dispose()
    }
  })

  // Test: EFFECT + next() via simulateAction
  await runTest(CAT, 'simulateAction handles EFFECT with next()', async () => {
    function App({ state }) {
      return <div>{state.result}</div>
    }
    App.initialState = { mode: 'a', result: 'none' }
    App.intent = ({ DOM }) => ({
      ROUTE: DOM.select('.btn').events('click'), // sygnal-ignore SYG110 (intentionally unrendered: this test drives the action with simulateAction)
    })
    App.model = {
      ROUTE: {
        EFFECT: (state, data, next) => {
          if (state.mode === 'a') next('DO_A')
          else next('DO_B')
        },
      },
      DO_A: (state) => ({ ...state, result: 'A' }),
      DO_B: (state) => ({ ...state, result: 'B' }),
    }

    const t = renderComponent(App)
    try {
      await wait(100)
      t.simulateAction('ROUTE')
      await wait(200)
      assert(
        t.states[t.states.length - 1].result === 'A',
        'EFFECT should route to DO_A'
      )
    } finally {
      t.dispose()
    }
  })

  // Temper 2026-10, item 9: { files } on the real DOM gives the input a real FileList (DataTransfer)
  await runTest(CAT, 'dom: real: simulateEvent { files } sets a real FileList on a file input', async () => {
    function Picker({ state }) {
      return <div><input type="file" className="pick" multiple /><p className="got">{state.names}</p></div>
    }
    Picker.initialState = { names: '' }
    Picker.intent = ({ DOM }) => ({ PICK: DOM.select('.pick').events('change').map((e) => [...e.target.files].map((f) => f.name).join(',')) })
    Picker.model = { PICK: (state, names) => ({ ...state, names }) }
    const t = renderComponent(Picker, { dom: 'real' })
    try {
      await t.ready()
      await t.simulateEvent('.pick', 'change', { files: [new File(['a'], 'a.csv'), new File(['b'], 'b.csv')] })
      const el = t.container.querySelector('.pick')
      assert(el.files instanceof FileList, 'files should be a real FileList, got ' + Object.prototype.toString.call(el.files))
      assert(el.files.length === 2 && el.files.item(1).name === 'b.csv', 'the FileList should hold both files')
      assert(!Object.prototype.hasOwnProperty.call(el, 'files'), 'the native files property is used, not a fallback')
      assert(t.state.names === 'a.csv,b.csv', 'the intent should read them, got ' + t.state.names)
      assert(t.query('.got').textContent === 'a.csv,b.csv', 'and the view show them')
    } finally {
      t.dispose()
    }
  })
}
