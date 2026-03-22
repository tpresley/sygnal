import type { Component } from 'sygnal'

type Layout = Component<Record<string, never>>

const Layout: Layout = function ({ state, innerHTML }) {
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
