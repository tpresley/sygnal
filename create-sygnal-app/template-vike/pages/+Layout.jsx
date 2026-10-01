/**
 * Shared layout around every page. In the browser the page is passed as
 * `children`; during SSR its HTML arrives in the `innerHTML` prop.
 */
function Layout({ children, innerHTML }) {
  const hasPage = Array.isArray(children) ? children.length > 0 : !!children
  return (
    <div className="layout">
      <nav className="nav">
        <div className="nav-brand">
          <img src="/favicon.svg" alt="Sygnal" className="nav-logo" />
          <strong>Sygnal + Vike</strong>
        </div>
        <div className="nav-links">
          <a href="/">Home</a>
          <a href="/about">About</a>
        </div>
      </nav>
      {hasPage
        ? <main className="content">{children}</main>
        : <main className="content" props={{ innerHTML: innerHTML || '' }}></main>
      }
    </div>
  )
}

Layout.initialState = {}

export default Layout
