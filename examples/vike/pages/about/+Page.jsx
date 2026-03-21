function Page({ state }) {
  return (
    <div className="page">
      <h1>About</h1>
      <p className="subtitle">{state.description}</p>
      <div className="info-card">
        <h3>Features demonstrated</h3>
        <ul>
          <li>Server-side rendering with hydration</li>
          <li>File-based routing via Vike</li>
          <li>Data fetching with <code>+data()</code></li>
          <li>Client-side navigation</li>
          <li>Shared Layout component</li>
          <li>SPA mode (no SSR)</li>
        </ul>
        {state.renderedAt ? (
          <p className="meta">
            Data fetched at: <code>{state.renderedAt}</code>
          </p>
        ) : null}
      </div>
    </div>
  )
}

Page.initialState = {
  description: '',
  renderedAt: '',
}

export default Page
