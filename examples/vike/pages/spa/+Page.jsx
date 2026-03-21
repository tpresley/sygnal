function Page({ state }) {
  return (
    <div className="page">
      <h1>SPA Mode</h1>
      <p className="subtitle">
        This page has <code>ssr: false</code> — it renders entirely on the client.
      </p>
      <div className="info-card">
        <p>
          View the page source to confirm: the <code>#page-view</code> div is empty
          in the HTML response. All rendering happens client-side after JavaScript loads.
        </p>
        <p>
          Current time: <strong>{state.loadedAt}</strong>
        </p>
        <p className="meta">
          If this were server-rendered, the time would be the server's time.
          Since it's SPA-mode, it's always the client's local time.
        </p>
      </div>
    </div>
  )
}

Page.initialState = {
  loadedAt: new Date().toLocaleTimeString(),
}

export default Page
