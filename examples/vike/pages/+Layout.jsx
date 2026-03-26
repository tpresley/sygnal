/**
 * Shared layout wrapping all pages.
 *
 * On the client, the Layout is a live interactive component — its intent,
 * model, and state all work. The Page is rendered as `children`.
 *
 * During SSR, onRenderHtml passes the page HTML via the `innerHTML` prop.
 */

function Layout({ state, children, innerHTML }) {
  return (
    <div className={`layout ${state.menuOpen ? 'menu-open' : ''}`}>
      <nav className="nav">
        <div className="nav-brand">
          <button className="menu-toggle" type="button">
            {state.menuOpen ? '✕' : '☰'}
          </button>
          <strong>Sygnal + Vike</strong>
        </div>
        <div className="nav-links">
          <a href="/">Home</a>
          <a href="/about">About</a>
          <a href="/spa">SPA Mode</a>
        </div>
      </nav>
      {state.menuOpen && (
        <div className="mobile-menu">
          <a href="/">Home</a>
          <a href="/about">About</a>
          <a href="/spa">SPA Mode</a>
        </div>
      )}
      {children && children.length
        ? <main className="content">{children}</main>
        : <main className="content" props={{ innerHTML: innerHTML || '' }}></main>
      }
      <footer className="footer">
        <small>
          <span className={`status-dot ${state.interactive ? 'active' : 'inactive'}`}></span>
          Layout {state.interactive ? 'interactive' : 'static'}
        </small>
      </footer>
    </div>
  )
}

Layout.initialState = {
  menuOpen: false,
  interactive: false,
}

Layout.intent = ({ DOM }) => ({
  TOGGLE_MENU: DOM.select('.menu-toggle').events('click'),
  MOUNTED: DOM.select('document').events('DOMContentLoaded'),
})

Layout.model = {
  TOGGLE_MENU: (state) => ({ ...state, menuOpen: !state.menuOpen }),
  MOUNTED: (state) => ({ ...state, interactive: true }),
}

export default Layout
