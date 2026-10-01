import { ABORT } from 'sygnal'
import HomePage from './HomePage.jsx'
import ProfilePage from './ProfilePage.jsx'
import CoursesPage from './CoursesPage.jsx'

const TABS = [
  { page: 'home', label: 'Home' },
  { page: 'profile', label: 'Profile' },
  { page: 'courses', label: 'Courses' },
]

const LOAD_COURSES = { category: 'courses', value: '/api/courses' }

function App({ state }) {
  return (
    <div className="portal">
      <header className="portal-header">
        <h1>Learning portal</h1>
        <p className="enrolled-count">{state.enrolledCount} enrolled</p>
      </header>
      <nav className="tabs">
        {TABS.map((tab) => (
          <button className={tab.page === state.page ? 'tab active' : 'tab'} data={{ page: tab.page }}>
            {tab.label}
          </button>
        ))}
      </nav>
      <main className="page">
        {state.page === 'home' && <HomePage />}
        {state.page === 'profile' && <ProfilePage />}
        {state.page === 'courses' && <CoursesPage />}
      </main>
    </div>
  )
}

// coursesStatus: 'idle' (never requested) | 'loading' | 'error' | 'ready'
App.initialState = {
  page: 'home',
  name: 'Ada',
  coursesStatus: 'idle',
  courses: [],
}

App.calculated = {
  enrolledCount: (state) => state.courses.filter((course) => course.enrolled).length,
}

// MUTANT: pages rendered conditionally (not Switchable) and the replies read in
// CoursesPage, which is unmounted on other tabs, so a late reply is lost.
App.intent = ({ DOM, EVENTS }) => ({
  OPEN_PAGE: DOM.click('.tab').data('page'),
  RETRY: EVENTS.select('RETRY_COURSES'),
})

App.model = {
  OPEN_PAGE: {
    STATE: (state, page) => {
      if (page === state.page) return ABORT
      const firstVisit = page === 'courses' && state.coursesStatus === 'idle'
      return { ...state, page, coursesStatus: firstVisit ? 'loading' : state.coursesStatus }
    },
    COURSES: (state, page) => (page === 'courses' && state.coursesStatus === 'idle' ? LOAD_COURSES : ABORT),
  },
  RETRY: {
    STATE: (state) => (state.coursesStatus === 'loading' ? ABORT : { ...state, coursesStatus: 'loading' }),
    COURSES: (state) => (state.coursesStatus === 'loading' ? ABORT : LOAD_COURSES),
  },
}

export default App
