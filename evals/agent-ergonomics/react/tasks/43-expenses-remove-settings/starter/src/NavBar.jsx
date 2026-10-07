import { NavLink } from 'react-router'

const LINKS = [
  { to: '/', label: 'Dashboard' },
  { to: '/expenses', label: 'Expenses' },
  { to: '/expenses/new', label: 'New expense' },
  { to: '/settings', label: 'Settings' },
]

export default function NavBar() {
  return (
    <nav className="main-nav" aria-label="Main">
      {LINKS.map((link) => (
        <NavLink key={link.to} to={link.to} end>
          {link.label}
        </NavLink>
      ))}
    </nav>
  )
}
