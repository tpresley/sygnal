import { useState } from 'react'
import HomePage from './HomePage.jsx'
import ProfilePage from './ProfilePage.jsx'

const TABS = [
  { page: 'home', label: 'Home' },
  { page: 'profile', label: 'Profile' },
]

export default function App() {
  const [page, setPage] = useState('home')
  const [name, setName] = useState('Ada')

  return (
    <div className="portal">
      <header className="portal-header">
        <h1>Learning portal</h1>
      </header>
      <nav className="tabs">
        {TABS.map((tab) => (
          <button key={tab.page} className={tab.page === page ? 'tab active' : 'tab'} onClick={() => setPage(tab.page)}>
            {tab.label}
          </button>
        ))}
      </nav>
      <main className="page">
        {page === 'home' && <HomePage name={name} />}
        {page === 'profile' && <ProfilePage name={name} onNameChange={setName} />}
      </main>
    </div>
  )
}
