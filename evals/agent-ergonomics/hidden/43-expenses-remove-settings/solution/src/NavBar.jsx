import { href } from './routes.js'

const LINKS = [
  { route: 'dashboard', label: 'Dashboard' },
  { route: 'expenses', label: 'Expenses' },
  { route: 'newExpense', label: 'New expense' },
]

function NavBar({ state }) {
  return (
    <nav className="main-nav" aria-label="Main">
      {LINKS.map((link) => (
        <a href={href(link.route)} aria-current={state.route.name === link.route ? 'page' : 'false'}>
          {link.label}
        </a>
      ))}
    </nav>
  )
}

export default NavBar
