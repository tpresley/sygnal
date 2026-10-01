import { ABORT, Switchable } from 'sygnal'
import HomePage from './HomePage.jsx'
import ProfilePage from './ProfilePage.jsx'

const TABS = [
  { page: 'home', label: 'Home' },
  { page: 'profile', label: 'Profile' },
]

function App({ state }) {
  return (
    <div className="portal">
      <header className="portal-header">
        <h1>Learning portal</h1>
      </header>
      <nav className="tabs">
        {TABS.map((tab) => (
          <button className={tab.page === state.page ? 'tab active' : 'tab'} data={{ page: tab.page }}>
            {tab.label}
          </button>
        ))}
      </nav>
      <main className="page">
        <Switchable of={{ home: HomePage, profile: ProfilePage }} current={state.page} />
      </main>
    </div>
  )
}

App.initialState = {
  page: 'home',
  name: 'Ada',
}

App.intent = ({ DOM }) => ({
  OPEN_PAGE: DOM.click('.tab').data('page'),
})

App.model = {
  OPEN_PAGE: (state, page) => (page === state.page ? ABORT : { ...state, page }),
}

export default App
