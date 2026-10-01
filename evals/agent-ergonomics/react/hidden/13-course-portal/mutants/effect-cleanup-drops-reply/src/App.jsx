import { useState } from 'react'
import HomePage from './HomePage.jsx'
import ProfilePage from './ProfilePage.jsx'
import CoursesPage from './CoursesPage.jsx'
import { fetchCourses } from './api.js'

const TABS = [
  { page: 'home', label: 'Home' },
  { page: 'profile', label: 'Profile' },
  { page: 'courses', label: 'Courses' },
]

export default function App() {
  const [page, setPage] = useState('home')
  const [name, setName] = useState('Ada')
  // status: 'idle' (never requested) | 'loading' | 'error' | 'ready'.
  // Kept here, not in CoursesPage, so it survives the page being unmounted.
  const [catalog, setCatalog] = useState({ status: 'idle', courses: [] })

  const load = () => {
    setCatalog((current) => ({ ...current, status: 'loading' }))
    fetchCourses().then(
      (courses) => setCatalog({ status: 'ready', courses: courses.map((c) => ({ ...c, enrolled: false })) }),
      () => setCatalog((current) => ({ ...current, status: 'error' }))
    )
  }

  // MUTANT: CoursesPage starts the load in an effect whose cleanup drops the reply.
  const openPage = (next) => setPage(next)

  const toggleEnroll = (id) =>
    setCatalog((current) => ({
      ...current,
      courses: current.courses.map((course) => {
        if (course.id !== id) return course
        if (course.enrolled) return { ...course, enrolled: false, seats: course.seats + 1 }
        if (course.seats === 0) return course
        return { ...course, enrolled: true, seats: course.seats - 1 }
      }),
    }))

  const enrolled = catalog.courses.filter((course) => course.enrolled)

  return (
    <div className="portal">
      <header className="portal-header">
        <h1>Learning portal</h1>
        <p className="enrolled-count">{enrolled.length} enrolled</p>
      </header>
      <nav className="tabs">
        {TABS.map((tab) => (
          <button key={tab.page} className={tab.page === page ? 'tab active' : 'tab'} onClick={() => openPage(tab.page)}>
            {tab.label}
          </button>
        ))}
      </nav>
      <main className="page">
        {page === 'home' && <HomePage name={name} />}
        {page === 'profile' && <ProfilePage name={name} onNameChange={setName} myCourses={enrolled} />}
        {page === 'courses' && (
          <CoursesPage catalog={catalog} setCatalog={setCatalog} onRetry={load} onToggleEnroll={toggleEnroll} />
        )}
      </main>
    </div>
  )
}
