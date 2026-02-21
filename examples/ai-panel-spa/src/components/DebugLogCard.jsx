function DebugLogCard({ logs }) {
  return (
    <section className="card">
      <h2>Debug Log</h2>
      {logs.length > 0 ? (
        <ul className="log-list">
          {logs.map((line, index) => <li key={index}>{line}</li>)}
        </ul>
      ) : (
        <p>No events logged yet.</p>
      )}
    </section>
  )
}

export default DebugLogCard
