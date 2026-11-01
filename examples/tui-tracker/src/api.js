// A fake issue API with latency: makeFetchDriver({ fetch: fakeApi() }) talks to it as to a server.
// The data is generated (40 issues: more than a screen), the latency a timer, so the app shows its
// loading state and tests run it under fake timers or real ones.
export const PEOPLE = ['ana', 'bo', 'chen', 'dara', 'emeka']
const TITLES = [
  'Crash when the config file is empty', 'Dark mode for the settings page', 'Typo in the README',
  'Search ignores accents', 'Export to CSV', 'Slow startup on Windows', 'Keyboard shortcut for archive',
  'Wrong date format in German', 'Add a --quiet flag', 'Emoji in titles break the layout 🐛',
]
const LABELS = ['bug', 'feature', 'docs']
const PRIORITIES = ['low', 'medium', 'high']

export function seedIssues(n = 40) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    title: TITLES[i % TITLES.length] + (i >= TITLES.length ? ` (${Math.floor(i / TITLES.length) + 1})` : ''),
    body: `Steps to reproduce issue ${i + 1}.\nExpected: it works.\nActual: it doesn't.`,
    labels: [LABELS[i % 3], ...(i % 4 == 0 ? [LABELS[(i + 1) % 3]] : [])],
    priority: PRIORITIES[i % 3],
    assignee: PEOPLE[i % PEOPLE.length],
    closed: i % 5 == 4,
  }))
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** a fetch over an in-memory table: GET /api/issues, POST /api/issues, PUT/DELETE /api/issues/:id */
export function fakeApi({ latency = 300, issues = seedIssues() } = {}) {
  const db = issues.map((x) => ({ ...x }))
  let nextId = db.length + 1
  const fetch = (url, init = {}) => new Promise((resolve, reject) => {
    const signal = init.signal
    const t = setTimeout(() => resolve(handle(url, init)), latency)
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason) })
  })
  function handle(url, { method = 'GET', body }) {
    const path = new URL(url, 'http://local').pathname
    const m = /^\/api\/issues(?:\/(\d+))?$/.exec(path)
    if (!m) return json(404, { error: 'not found' })
    const id = m[1] && +m[1], i = db.findIndex((x) => x.id === id)
    const data = body ? JSON.parse(body) : null
    if (method == 'GET' && !id) return json(200, db)
    if (method == 'POST' && !id) {
      if (db.some((x) => x.title === data.title)) return json(422, { errors: { title: 'An issue with this title exists' } })
      const issue = { ...data, id: nextId++, closed: false }
      db.push(issue)
      return json(201, issue)
    }
    if (i < 0) return json(404, { error: 'no such issue' })
    if (method == 'PUT') return json(200, (db[i] = { ...db[i], ...data, id }))
    if (method == 'DELETE') { db.splice(i, 1); return json(200, { id }) }
    return json(405, { error: 'method' })
  }
  fetch.db = db
  return fetch
}
