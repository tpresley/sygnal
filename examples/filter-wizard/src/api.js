// A fake filter API with latency: makeFetchDriver({ fetch: fakeApi() }) talks to it as to a server.
//   GET  /api/filters              the list
//   GET  /api/filters/:id          one filter (404 when there is none)
//   POST /api/filters              create (422 when the name is taken)
//   POST /api/filters/:id/preview  count the filter's matches in the last hour (stored on the filter)
export const seedFilters = () => [
  { id: 1, name: 'Payment errors', source: 'logs', keywords: 'payment, declined', matches: 14 },
  { id: 2, name: 'Slow checkout', source: 'metrics', metric: 'latency', above: 800, matches: 3 },
]

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export function fakeApi({ latency = 300, filters = seedFilters() } = {}) {
  const db = filters.map((f) => ({ ...f }))
  let nextId = Math.max(0, ...db.map((f) => f.id)) + 1
  const fetch = (url, init = {}) => new Promise((resolve, reject) => {
    const signal = init.signal
    const t = setTimeout(() => resolve(handle(url, init)), latency)
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason) })
  })
  function handle(url, { method = 'GET', body }) {
    const path = new URL(url, 'http://local').pathname
    const m = /^\/api\/filters(?:\/(\d+))?(\/preview)?$/.exec(path)
    if (!m) return json(404, { error: 'not found' })
    const id = m[1] && +m[1], filter = db.find((f) => f.id === id)
    if (method === 'GET' && !id) return json(200, db)
    if (method === 'POST' && !id) {
      const data = JSON.parse(body)
      if (db.some((f) => f.name.toLowerCase() === data.name.trim().toLowerCase())) return json(422, { error: 'A filter with this name exists' })
      const created = { ...data, name: data.name.trim(), id: nextId++, matches: null }
      db.push(created)
      return json(201, created)
    }
    if (!filter) return json(404, { error: 'no such filter' })
    if (method === 'GET' && !m[2]) return json(200, filter)
    if (method === 'POST' && m[2]) return json(200, { matches: (filter.matches = (filter.name.length * 7) % 40) })
    return json(405, { error: 'method' })
  }
  fetch.db = db
  return fetch
}
