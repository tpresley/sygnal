import { Collection, event } from 'sygnal'
import CourseItem from './CourseItem.jsx'

function CoursesPage({ state }) {
  if (state.coursesStatus === 'error') {
    return (
      <section className="courses">
        <h2>Courses</h2>
        <p className="error">Couldn't load courses.</p>
        <button className="retry">Retry</button>
      </section>
    )
  }
  if (state.coursesStatus !== 'ready') {
    return (
      <section className="courses">
        <h2>Courses</h2>
        <p className="loading">Loading courses…</p>
      </section>
    )
  }
  return (
    <section className="courses">
      <h2>Courses</h2>
      <ul className="course-list">
        <Collection of={CourseItem} from="courses" />
      </ul>
    </section>
  )
}

CoursesPage.intent = ({ DOM }) => ({
  RETRY: DOM.click('.retry'),
})

CoursesPage.model = {
  RETRY: { EVENTS: event('RETRY_COURSES') },
}

export default CoursesPage
