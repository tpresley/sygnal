import { run, driverFromAsync } from 'sygnal'
import App from './App.jsx'

// A request { category: 'courses', value: url } resolves to the course array;
// a network error or non-2xx response rejects and reaches COURSES.errors().
async function loadCourses(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = await response.json()
  return body.courses
}

run(App, { COURSES: driverFromAsync(loadCourses) })
