/**
 * Shared layout wrapping all pages.
 * During SSR, onRenderHtml passes the page HTML as the `innerHTML` prop.
 * The Layout renders the navigation and injects page content into <main>.
 */

function Layout({ state, innerHTML }) {
  return (
    <div className="layout">
      <nav className="nav">
        <div className="nav-brand">
          <strong>Sygnal + Vike</strong>
        </div>
        <div className="nav-links">
          <a href="/">Home</a>
          <a href="/about">About</a>
          <a href="/spa">SPA Mode</a>
        </div>
      </nav>
      <main className="content" props={{ innerHTML: innerHTML || '' }}></main>
    </div>
  )
}

Layout.initialState = {}

export default Layout
