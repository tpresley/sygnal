export default function Header({ counts, roles }) {
  return (
    <header className="header">
      <h1>Hiring pipeline</h1>
      <p className="summary">{`${counts.active} active · ${counts.hired} hired · ${counts.onHold} on hold`}</p>
      <p className="roles">{roles.map(({ role, count }) => `${role}: ${count}`).join(', ')}</p>
    </header>
  )
}
