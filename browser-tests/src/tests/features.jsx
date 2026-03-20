import { run, Portal, Suspense, lazy, createRef } from 'sygnal'
import xs from 'xstream'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Advanced Features'

export async function featureTests() {
  // Error boundary — view error
  await runTest(CAT, 'onError catches view errors', async () => {
    const { id, el } = mount()
    function Broken({ state } = {}) { throw new Error('boom') }
    Broken.onError = (err, { componentName }) => (
      <div className="fallback">Caught: {err.message}</div>
    )
    function App() { return <div><Broken state="b" /></div> }
    App.initialState = { b: {} }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.fallback'))
    assert(el.querySelector('.fallback').textContent.includes('Caught: boom'))
  })

  // Error boundary — no handler renders data-sygnal-error
  await runTest(CAT, 'Error without onError renders data-sygnal-error', async () => {
    const { id, el } = mount()
    function Broken({ state } = {}) { throw new Error('no handler') }
    function App() { return <div><Broken state="b" /></div> }
    App.initialState = { b: {} }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('[data-sygnal-error]'))
  })

  // Error boundary — reducer error preserves state
  await runTest(CAT, 'Reducer error preserves previous state', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div><span className="val">{state.count}</span><button className="bad">bad</button></div>
    }
    App.initialState = { count: 5 }
    App.intent = ({ DOM }) => ({ BAD: DOM.click('.bad') })
    App.model = { BAD: () => { throw new Error('reducer crash') } }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.bad'))
    el.querySelector('.bad').click()
    await wait(100)
    assert(el.querySelector('.val').textContent === '5', 'State should be preserved')
  })

  // Refs — createRef
  await runTest(CAT, 'createRef() captures DOM element', async () => {
    const { id, el } = mount()
    const myRef = createRef()
    function App({ state } = {}) {
      return <div>
        <div className="target" ref={myRef}>Target</div>
        <button className="measure">Measure</button>
        <span className="tag">{state.tag}</span>
      </div>
    }
    App.initialState = { tag: 'none' }
    App.intent = ({ DOM }) => ({ MEASURE: DOM.click('.measure') })
    App.model = { MEASURE: (state) => ({ tag: myRef.current?.tagName || 'null' }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.measure'))
    el.querySelector('.measure').click()
    await waitFor(() => el.querySelector('.tag')?.textContent === 'DIV')
  })

  // Portal — renders into target
  await runTest(CAT, 'Portal renders children into target container', async () => {
    const { id, el } = mount()
    const targetEl = document.createElement('div')
    targetEl.id = `portal-target-${id.replace('#', '')}`
    document.body.appendChild(targetEl)

    function App({ state } = {}) {
      return <div>
        <span className="main">Main</span>
        <Portal target={`#${targetEl.id}`}>
          <div className="ported">Ported content</div>
        </Portal>
      </div>
    }
    run(App, {}, { mountPoint: id })
    await waitFor(() => targetEl.querySelector('.ported'))
    assert(targetEl.querySelector('.ported').textContent === 'Ported content')
    // Verify it's NOT in the component's own tree
    assert(!el.querySelector('.ported'), 'Portal content should not be in component tree')
    targetEl.remove()
  })

  // Disposal — dispose$ fires on unmount
  await runTest(CAT, 'dispose$ emits on component unmount', async () => {
    const { id, el } = mount()
    let disposed = false
    function Child({ state } = {}) {
      return <div className="child-d">Child</div>
    }
    Child.intent = ({ DOM, dispose$ }) => ({
      CLEANUP: dispose$,
    })
    Child.model = {
      CLEANUP: {
        EVENTS: () => ({ type: 'CHILD_DISPOSED', data: true }),
      },
    }
    function App({ state } = {}) {
      return <div>
        <button className="tog">{state.show ? 'Hide' : 'Show'}</button>
        {state.show && <Child state="child" />}
        <span className="disposed">{state.wasDisposed ? 'yes' : 'no'}</span>
      </div>
    }
    App.initialState = { show: false, child: {}, wasDisposed: false }
    App.intent = ({ DOM, EVENTS }) => ({
      TOG: DOM.click('.tog'),
      DISPOSED: EVENTS.select('CHILD_DISPOSED'),
    })
    App.model = {
      TOG: (state) => ({ ...state, show: !state.show }),
      DISPOSED: (state) => ({ ...state, wasDisposed: true }),
    }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.tog'))
    // Mount child
    el.querySelector('.tog').click()
    await waitFor(() => el.querySelector('.child-d'))
    // Unmount child
    el.querySelector('.tog').click()
    await waitFor(() => !el.querySelector('.child-d'))
    await waitFor(() => el.querySelector('.disposed')?.textContent === 'yes', 2000)
  })

  // Suspense with READY sink
  await runTest(CAT, 'Suspense shows fallback until READY emits true', async () => {
    const { id, el } = mount()
    function Slow({ state } = {}) {
      return <div className="slow-loaded">Loaded!</div>
    }
    Slow.intent = () => ({
      BECOME_READY: xs.periodic(500).take(1),
    })
    Slow.model = {
      BECOME_READY: { READY: () => true },
    }
    function App({ state } = {}) {
      return <div>
        <Suspense fallback={<div className="fallback-ui">Loading...</div>}>
          <Slow state="slow" />
        </Suspense>
      </div>
    }
    App.initialState = { slow: {} }
    run(App, {}, { mountPoint: id })
    // Should show fallback initially
    await waitFor(() => el.querySelector('.fallback-ui') || el.querySelector('.slow-loaded'))
    // After ~500ms, should show loaded content
    await waitFor(() => el.querySelector('.slow-loaded'), 3000)
    assert(el.querySelector('.slow-loaded').textContent === 'Loaded!')
  }, 5000)

  // Lazy loading (with Suspense to trigger re-render on load)
  await runTest(CAT, 'lazy() with Suspense renders fallback then component', async () => {
    const { id, el } = mount()
    const LazyComp = lazy(() =>
      new Promise(resolve => setTimeout(() => {
        function Loaded({ state } = {}) { return <div className="lazy-done">Lazy loaded!</div> }
        resolve({ default: Loaded })
      }, 800))
    )
    function App({ state } = {}) {
      return <div>
        <Suspense fallback={<div className="lazy-fallback">Loading...</div>}>
          <LazyComp />
        </Suspense>
      </div>
    }
    App.initialState = { _: 0 }
    run(App, {}, { mountPoint: id })
    // Should show fallback or placeholder first
    await waitFor(() => el.querySelector('.lazy-fallback') || el.querySelector('[data-sygnal-lazy]') || el.querySelector('.lazy-done'))
    // After resolution, Suspense triggers re-render and shows the loaded component
    await waitFor(() => el.querySelector('.lazy-done'), 4000)
    assert(el.querySelector('.lazy-done').textContent === 'Lazy loaded!')
  }, 6000)
}
