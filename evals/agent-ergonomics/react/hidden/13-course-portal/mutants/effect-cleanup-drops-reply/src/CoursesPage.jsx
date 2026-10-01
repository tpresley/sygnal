import { useEffect } from 'react'
import { fetchCourses } from './api.js'

function CourseItem({ course, onToggle }) {
  const full = course.seats === 0 && !course.enrolled
  return (
    <li className="course">
      <span className="course-title">{course.title}</span>
      <span className="seats">{`${course.seats} seats left`}</span>
      <button className="enroll" disabled={full} onClick={() => onToggle(course.id)}>
        {course.enrolled ? 'Leave' : full ? 'Full' : 'Enroll'}
      </button>
    </li>
  )
}

export default function CoursesPage({ catalog, setCatalog, onRetry, onToggleEnroll }) {
  useEffect(() => {
    if (catalog.status !== 'idle') return undefined
    let cancelled = false
    setCatalog((current) => ({ ...current, status: 'loading' }))
    fetchCourses().then(
      (courses) => !cancelled && setCatalog({ status: 'ready', courses: courses.map((c) => ({ ...c, enrolled: false })) }),
      () => !cancelled && setCatalog((current) => ({ ...current, status: 'error' }))
    )
    return () => {
      cancelled = true
    }
  }, [])

  if (catalog.status === 'error') {
    return (
      <section className="courses">
        <h2>Courses</h2>
        <p className="error">Couldn't load courses.</p>
        <button className="retry" onClick={onRetry}>
          Retry
        </button>
      </section>
    )
  }
  if (catalog.status !== 'ready') {
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
        {catalog.courses.map((course) => (
          <CourseItem key={course.id} course={course} onToggle={onToggleEnroll} />
        ))}
      </ul>
    </section>
  )
}
