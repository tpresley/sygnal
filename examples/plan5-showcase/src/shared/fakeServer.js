// An in-page "server": a fetch function for makeFetchDriver({ fetch }). The real driver runs;
// only the network is fake (with a delay, so pending states are visible).
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const wait = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) })
})

const QUOTES = {
  1: { id: 1, text: 'Simplicity is prerequisite for reliability.', author: 'Edsger W. Dijkstra' },
  2: { id: 2, text: 'Make it work, make it right, make it fast.', author: 'Kent Beck' },
  3: { id: 3, text: 'Programs must be written for people to read.', author: 'Harold Abelson' },
}
let accounts = 100

export async function fakeFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url, location.origin)
  const method = (init.method || 'GET').toUpperCase()
  await wait(700, init.signal)

  if (method === 'POST' && url.pathname === '/api/signup') {
    const body = JSON.parse(init.body)
    if (body.email.endsWith('@taken.com')) return json({ errors: { email: 'Already registered' } }, 422)
    const atlantis = body.addresses.findIndex((a) => a.city.toLowerCase() === 'atlantis')
    if (atlantis >= 0) return json({ errors: [{ path: ['addresses', atlantis, 'city'], message: 'Unknown city' }] }, 422)
    if (body.name.toLowerCase() === 'crash') return json({}, 500)
    return json({ id: ++accounts }, 201)
  }
  const quote = url.pathname.match(/^\/api\/quotes\/(\d+)$/)
  if (quote) return QUOTES[quote[1]] ? json(QUOTES[quote[1]]) : json({ message: 'Not found' }, 404)
  return json({ message: 'Not found' }, 404)
}
