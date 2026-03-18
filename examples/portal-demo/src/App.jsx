import { Portal } from 'sygnal'

function App({ state } = {}) {
  return (
    <div className="app">
      <h1>Portal Event Handling Test</h1>
      <p>
        Testing whether DOM events work when the portal target is
        <strong> inside</strong> the component's own DOM tree.
      </p>

      <div className="controls">
        <button type="button" className="toggle-btn">
          {state.showPortal ? 'Hide Portal' : 'Show Portal'}
        </button>
        <span className="click-count">
          Portal button clicked: <strong>{state.portalClicks}</strong> times
        </span>
      </div>

      {/* Portal target is INSIDE this component's DOM */}
      <div className="portal-target-container">
        <h3>Portal Target (inside component tree)</h3>
        <div id="inner-portal-target" className="target-box"></div>
      </div>

      {state.showPortal && (
        <Portal target="#inner-portal-target">
          <div className="portal-content">
            <h4>I'm portaled content!</h4>
            <p>Rendered into #inner-portal-target above.</p>
            <button type="button" className="portal-btn">
              Click me (from inside portal)
            </button>
            <p className="status">
              {state.portalClicks > 0
                ? `Button works! Clicked ${state.portalClicks} times.`
                : 'Click the button to test event handling.'}
            </p>
          </div>
        </Portal>
      )}
    </div>
  )
}

App.initialState = {
  showPortal: false,
  portalClicks: 0,
}

App.intent = ({ DOM }) => ({
  TOGGLE: DOM.select('.toggle-btn').events('click'),
  PORTAL_CLICK: DOM.select('.portal-btn').events('click'),
})

App.model = {
  TOGGLE: (state) => ({ ...state, showPortal: !state.showPortal }),
  PORTAL_CLICK: (state) => ({ ...state, portalClicks: state.portalClicks + 1 }),
}

export default App
