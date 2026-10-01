export async function fetchCourses() {
  const response = await fetch('/api/courses')
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = await response.json()
  return body.courses
}
