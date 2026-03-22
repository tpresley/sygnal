function Layout({ state, innerHTML }) {
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
      <main className="content" props={{ innerHTML: innerHTML || '' }}></main>
    </div>
  )
}

Layout.initialState = {}

export default Layout
