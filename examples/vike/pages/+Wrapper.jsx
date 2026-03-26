/**
 * App-level Wrapper component.
 *
 * Wraps OUTSIDE the Layout — Wrapper > Layout > Page.
 * Good for context providers, theme state, auth, etc.
 *
 * During SSR, children are passed via the `innerHTML` prop.
 * On the client, children are live Sygnal sub-components.
 */

function Wrapper({ state, children, innerHTML }) {
  return (
    <div className={`theme-wrapper ${state.theme}`}>
      <div className="theme-bar">
        <button className="theme-toggle" type="button">
          {state.theme === 'light' ? '🌙' : '☀️'}
        </button>
      </div>
      {children && children.length
        ? children
        : <div props={{ innerHTML: innerHTML || '' }}></div>
      }
    </div>
  )
}

Wrapper.initialState = {
  theme: 'light',
}

Wrapper.intent = ({ DOM }) => ({
  TOGGLE_THEME: DOM.select('.theme-toggle').events('click'),
})

Wrapper.model = {
  TOGGLE_THEME: (state) => ({
    ...state,
    theme: state.theme === 'light' ? 'dark' : 'light',
  }),
}

export default Wrapper
