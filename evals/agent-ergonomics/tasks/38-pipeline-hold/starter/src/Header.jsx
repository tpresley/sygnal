function Header({ context }) {
  const { counts, roles } = context
  return (
    <header className="header">
      <h1>Hiring pipeline</h1>
      <p className="summary">{`${counts.active} active · ${counts.hired} hired`}</p>
      <p className="roles">{roles.map(({ role, count }) => `${role}: ${count}`).join(', ')}</p>
    </header>
  )
}

export default Header
