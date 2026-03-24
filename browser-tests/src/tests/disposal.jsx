import { run, Collection, xs } from 'sygnal'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Disposal'

export async function disposalTests() {
  // Test: DISPOSE EFFECT fires when sub-component is removed
  await runTest(CAT, 'DISPOSE EFFECT fires when sub-component is removed from DOM', async () => {
    const { id, el } = mount()

    window.__disposeEffectRan = false

    function Child({ state } = {}) {
      return <div className="child-content">Child here</div>
    }
    Child.model = {
      DISPOSE: {
        EFFECT: () => { window.__disposeEffectRan = true },
      },
    }

    function App({ state }) {
      return (
        <div>
          <button className="toggle-btn">Toggle</button>
          {state.showChild ? <Child state="child" /> : <div className="no-child">Gone</div>}
        </div>
      )
    }

    App.initialState = { showChild: true, child: {} }
    App.intent = ({ DOM }) => ({
      TOGGLE: DOM.click('.toggle-btn'),
    })
    App.model = {
      TOGGLE: (state) => ({ ...state, showChild: !state.showChild }),
    }

    run(App, {}, { mountPoint: id })

    await waitFor(() => el.querySelector('.child-content'))
    assert(window.__disposeEffectRan === false, 'DISPOSE should not have fired yet')

    el.querySelector('.toggle-btn').click()
    await waitFor(() => el.querySelector('.no-child'))
    await wait(100)
    assert(window.__disposeEffectRan === true, 'DISPOSE EFFECT should fire when child is removed')

    delete window.__disposeEffectRan
  })

  // Test: DISPOSE EFFECT receives current state
  await runTest(CAT, 'DISPOSE EFFECT receives the current component state', async () => {
    const { id, el } = mount()

    window.__disposeStateCapture = null

    function Child({ state } = {}) {
      return (
        <div>
          <span className="child-val">{state.count}</span>
          <button className="inc-btn">Inc</button>
        </div>
      )
    }
    Child.intent = ({ DOM }) => ({
      INC: DOM.click('.inc-btn'),
    })
    Child.model = {
      INC: (state) => ({ ...state, count: state.count + 1 }),
      DISPOSE: {
        EFFECT: (state) => { window.__disposeStateCapture = state.count },
      },
    }

    function App({ state }) {
      return (
        <div>
          <button className="remove-btn">Remove</button>
          {state.showChild ? <Child state="child" /> : <div className="removed">Removed</div>}
        </div>
      )
    }

    App.initialState = { showChild: true, child: { count: 0 } }
    App.intent = ({ DOM }) => ({
      REMOVE: DOM.click('.remove-btn'),
    })
    App.model = {
      REMOVE: (state) => ({ ...state, showChild: false }),
    }

    run(App, {}, { mountPoint: id })

    await waitFor(() => el.querySelector('.child-val'))

    // Increment the child state from within the Child component
    el.querySelector('.inc-btn').click()
    await waitFor(() => el.querySelector('.child-val')?.textContent === '1')

    // Now remove the child
    el.querySelector('.remove-btn').click()
    await waitFor(() => el.querySelector('.removed'))
    await wait(100)
    assert(
      window.__disposeStateCapture === 1,
      `DISPOSE should receive current state (count=1), got: ${window.__disposeStateCapture}`
    )

    delete window.__disposeStateCapture
  })

  // Test: DISPOSE with model shorthand
  await runTest(CAT, "'DISPOSE | EFFECT' shorthand fires on removal", async () => {
    const { id, el } = mount()

    window.__shorthandDisposeRan = false

    function Child({ state } = {}) {
      return <div className="sh-child">Child</div>
    }
    Child.model = {
      'DISPOSE | EFFECT': () => { window.__shorthandDisposeRan = true },
    }

    function App({ state }) {
      return (
        <div>
          <button className="sh-toggle">Toggle</button>
          {state.show ? <Child state="c" /> : <div className="sh-gone">Gone</div>}
        </div>
      )
    }

    App.initialState = { show: true, c: {} }
    App.intent = ({ DOM }) => ({
      TOGGLE: DOM.click('.sh-toggle'),
    })
    App.model = {
      TOGGLE: (state) => ({ ...state, show: !state.show }),
    }

    run(App, {}, { mountPoint: id })

    await waitFor(() => el.querySelector('.sh-child'))
    assert(window.__shorthandDisposeRan === false, 'Shorthand DISPOSE should not fire yet')

    el.querySelector('.sh-toggle').click()
    await waitFor(() => el.querySelector('.sh-gone'))
    await wait(100)
    assert(window.__shorthandDisposeRan === true, 'Shorthand DISPOSE EFFECT should fire on removal')

    delete window.__shorthandDisposeRan
  })

  // Test: DISPOSE fires for Collection items when removed
  await runTest(CAT, 'DISPOSE fires for Collection items removed from array', async () => {
    const { id, el } = mount()

    window.__collectionDisposeCount = 0

    function Item({ state } = {}) {
      return <div className="coll-item">{state.label}</div>
    }
    Item.model = {
      DISPOSE: {
        EFFECT: () => { window.__collectionDisposeCount++ },
      },
    }

    function App({ state }) {
      return (
        <div>
          <button className="remove-last">Remove Last</button>
          <Collection of={Item} from="items" />
        </div>
      )
    }

    App.initialState = {
      items: [
        { id: 1, label: 'A' },
        { id: 2, label: 'B' },
        { id: 3, label: 'C' },
      ],
    }
    App.intent = ({ DOM }) => ({
      REMOVE: DOM.click('.remove-last'),
    })
    App.model = {
      REMOVE: (state) => ({ ...state, items: state.items.slice(0, -1) }),
    }

    run(App, {}, { mountPoint: id })

    await waitFor(() => el.querySelectorAll('.coll-item').length === 3)
    assert(window.__collectionDisposeCount === 0, 'No items disposed yet')

    el.querySelector('.remove-last').click()
    await waitFor(() => el.querySelectorAll('.coll-item').length === 2)
    await wait(100)
    assert(
      window.__collectionDisposeCount === 1,
      `One item should have been disposed, got: ${window.__collectionDisposeCount}`
    )

    el.querySelector('.remove-last').click()
    await waitFor(() => el.querySelectorAll('.coll-item').length === 1)
    await wait(100)
    assert(
      window.__collectionDisposeCount === 2,
      `Two items total should have been disposed, got: ${window.__collectionDisposeCount}`
    )

    delete window.__collectionDisposeCount
  })

  // Test: DISPOSE with EVENTS sink notifies parent
  await runTest(CAT, 'DISPOSE with EVENTS sink notifies parent on removal', async () => {
    const { id, el } = mount()

    function Child({ state } = {}) {
      return <div className="evt-child">Child {state.name}</div>
    }
    Child.model = {
      DISPOSE: {
        EVENTS: (state) => ({ type: 'CHILD_DISPOSED', data: state.name }),
      },
    }

    function App({ state }) {
      return (
        <div>
          <button className="evt-toggle">Toggle</button>
          <div className="disposed-name">{state.disposedChild || 'none'}</div>
          {state.show ? <Child state="child" /> : null}
        </div>
      )
    }

    App.initialState = { show: true, child: { name: 'Bob' }, disposedChild: null }
    App.intent = ({ DOM, EVENTS }) => ({
      TOGGLE: DOM.click('.evt-toggle'),
      CHILD_GONE: EVENTS.select('CHILD_DISPOSED'),
    })
    App.model = {
      TOGGLE: (state) => ({ ...state, show: !state.show }),
      CHILD_GONE: (state, name) => ({ ...state, disposedChild: name }),
    }

    run(App, {}, { mountPoint: id })

    await waitFor(() => el.querySelector('.evt-child'))
    assert(
      el.querySelector('.disposed-name')?.textContent === 'none',
      'No child disposed yet'
    )

    el.querySelector('.evt-toggle').click()
    await waitFor(() => !el.querySelector('.evt-child'))
    await wait(150)
    assert(
      el.querySelector('.disposed-name')?.textContent === 'Bob',
      `Parent should receive CHILD_DISPOSED event with name, got: "${el.querySelector('.disposed-name')?.textContent}"`
    )
  })

  // Test: dispose$ source still works for advanced use cases
  await runTest(CAT, 'dispose$ source stream still fires on unmount', async () => {
    const { id, el } = mount()

    window.__dispose$Fired = false

    function Child({ state } = {}) {
      return <div className="ds-child">Child</div>
    }
    Child.intent = ({ DOM, dispose$ }) => ({
      CLEANUP: dispose$,
    })
    Child.model = {
      CLEANUP: {
        EFFECT: () => { window.__dispose$Fired = true },
      },
    }

    function App({ state }) {
      return (
        <div>
          <button className="ds-toggle">Toggle</button>
          {state.show ? <Child state="c" /> : <div className="ds-gone">Gone</div>}
        </div>
      )
    }

    App.initialState = { show: true, c: {} }
    App.intent = ({ DOM }) => ({
      TOGGLE: DOM.click('.ds-toggle'),
    })
    App.model = {
      TOGGLE: (state) => ({ ...state, show: !state.show }),
    }

    run(App, {}, { mountPoint: id })

    await waitFor(() => el.querySelector('.ds-child'))
    el.querySelector('.ds-toggle').click()
    await waitFor(() => el.querySelector('.ds-gone'))
    await wait(100)
    assert(window.__dispose$Fired === true, 'dispose$ should still fire on unmount')

    delete window.__dispose$Fired
  })

  // Test: DISPOSE fires on root component when app.dispose() is called
  await runTest(CAT, 'DISPOSE fires on root component when app is disposed', async () => {
    const { id, el } = mount()

    window.__rootDisposeRan = false
    window.__rootDisposeState = null

    function App({ state }) {
      return <div className="root-val">Count: {state.count}</div>
    }

    App.initialState = { count: 42 }
    App.model = {
      DISPOSE: {
        EFFECT: (state) => {
          window.__rootDisposeRan = true
          window.__rootDisposeState = state.count
        },
      },
    }

    const app = run(App, {}, { mountPoint: id })

    await waitFor(() => el.querySelector('.root-val')?.textContent === 'Count: 42')
    assert(window.__rootDisposeRan === false, 'Root DISPOSE should not have fired yet')

    app.dispose()
    await wait(100)
    assert(window.__rootDisposeRan === true, 'Root DISPOSE EFFECT should fire when app.dispose() is called')
    assert(
      window.__rootDisposeState === 42,
      `Root DISPOSE should receive current state (42), got: ${window.__rootDisposeState}`
    )

    delete window.__rootDisposeRan
    delete window.__rootDisposeState
  })
}
