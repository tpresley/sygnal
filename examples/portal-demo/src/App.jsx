import { Portal } from 'sygnal'

function App({ state } = {}) {
  return (
    <div className="app">
      <h1>Portal Event Handling Tests</h1>

      {/* Test 1: Internal target with regular DOM.select */}
      <section className="test-section">
        <h2>Test 1: Internal Target + DOM.select()</h2>
        <p>Portal target is <strong>inside</strong> the component. Events via <code>DOM.select('.selector')</code>.</p>
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

      {/* Test 2: External target with DOM.select('document').select() */}
      <section className="test-section">
        <h2>Test 2: External Target + DOM.select('document').select()</h2>
        <p>Portal target is <strong>outside</strong> the component (#external-portal-target in body). Events via <code>DOM.select('document').select('.selector')</code>.</p>
        <div className="controls">
          <button type="button" className="toggle-external">
            {state.showExternal ? 'Hide' : 'Show'} Portal
          </button>
          <span>Clicks: <strong>{state.externalClicks}</strong></span>
        </div>
        {state.showExternal && (
          <Portal target="#external-portal-target">
            <div className="portal-content external">
              <p>External portal content (rendered outside #root)</p>
              <button type="button" className="external-btn">Click me</button>
            </div>
          </Portal>
        )}
      </section>
    </div>
  )
}

App.initialState = {
  showInternal: false,
  showExternal: false,
  internalClicks: 0,
  externalClicks: 0,
}

App.intent = ({ DOM }) => ({
  TOGGLE_INTERNAL: DOM.select('.toggle-internal').events('click'),
  TOGGLE_EXTERNAL: DOM.select('.toggle-external').events('click'),
  INTERNAL_CLICK: DOM.select('.internal-btn').events('click'),
  EXTERNAL_CLICK: DOM.select('document').select('.external-btn').events('click'),
})

App.model = {
  TOGGLE_INTERNAL: (state) => ({ ...state, showInternal: !state.showInternal }),
  TOGGLE_EXTERNAL: (state) => ({ ...state, showExternal: !state.showExternal }),
  INTERNAL_CLICK: (state) => ({ ...state, internalClicks: state.internalClicks + 1 }),
  EXTERNAL_CLICK: (state) => ({ ...state, externalClicks: state.externalClicks + 1 }),
}

export default App
