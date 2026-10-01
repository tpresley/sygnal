import { ABORT, Switchable } from 'sygnal'
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
        <Switchable of={{ home: HomePage, profile: ProfilePage, courses: CoursesPage }} current={state.page} />
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

// The request and its replies are handled here, not in CoursesPage: the page is
// unmounted while another tab is shown, and a reply must not be lost then.
App.intent = ({ DOM, EVENTS, COURSES }) => ({
  OPEN_PAGE: DOM.click('.tab').data('page'),
  RETRY: EVENTS.select('RETRY_COURSES'),
  LOADED: COURSES.select('courses'),
  FAILED: COURSES.errors('courses'),
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
  LOADED: (state, { value }) => ({
    ...state,
    coursesStatus: 'ready',
    courses: value.map((course) => ({ ...course, enrolled: false })),
  }),
  FAILED: (state) => ({ ...state, coursesStatus: 'error' }),
}

export default App
