export default function ActivityLog({ entries, onClear }) {
  return (
    <section className="activity">
      <h2>Activity</h2>
      {entries.length === 0 ? (
        <p className="empty">No activity yet.</p>
      ) : (
        <ul className="entries">
          {entries.map((entry, i) => (
            <li key={entries.length - i}>{entry}</li>
          ))}
        </ul>
      )}
      <button type="button" className="clear" onClick={onClear}>
        Clear
      </button>
    </section>
  )
}
