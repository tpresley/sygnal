import { Portal, lazy } from 'sygnal'

const LazyComponent = lazy(() => import('./LazyTest.jsx'))

function App({ state } = {}) {
  return (
    <div className="app">
      <h1>Portal & Lazy Loading Tests</h1>

      {/* Test 1: Internal portal */}
      <section className="test-section">
        <h2>Test 1: Internal Portal</h2>
        <div className="controls">
          <button type="button" className="toggle-internal">
            {state.showInternal ? 'Hide' : 'Show'} Portal
          </button>
          <span>Clicks: <strong>{state.internalClicks}</strong></span>
        </div>
        <div className="target-box">
          <div id="internal-target"></div>
        </div>
        {state.showInternal && (
          <Portal target="#internal-target">
            <div className="portal-content internal">
              <p>Internal portal content</p>
              <button type="button" className="internal-btn">Click me</button>
            </div>
          </Portal>
        )}
      </section>

      {/* Test 2: Lazy Loading */}
      <section className="test-section">
        <h2>Test 2: Lazy Loading</h2>
        <div className="controls">
          <button type="button" className="toggle-lazy">
            {state.showLazy ? 'Unload' : 'Load'} Component
          </button>
        </div>
        {state.showLazy && <LazyComponent />}
      </section>
    </div>
  )
}

App.initialState = {
  showInternal: false,
  showLazy: false,
  internalClicks: 0,
}

App.intent = ({ DOM }) => ({
  TOGGLE_INTERNAL: DOM.select('.toggle-internal').events('click'),
  TOGGLE_LAZY: DOM.select('.toggle-lazy').events('click'),
  INTERNAL_CLICK: DOM.select('.internal-btn').events('click'),
})

App.model = {
  TOGGLE_INTERNAL: (state) => ({ ...state, showInternal: !state.showInternal }),
  TOGGLE_LAZY: (state) => ({ ...state, showLazy: !state.showLazy }),
  INTERNAL_CLICK: (state) => ({ ...state, internalClicks: state.internalClicks + 1 }),
}

export default App
