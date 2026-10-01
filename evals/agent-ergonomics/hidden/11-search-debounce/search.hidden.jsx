import { describe, it, expect, vi, afterEach } from 'vitest'
import { mountApp, waitFor, bodyText, typeInto, sleep, textOf } from './dom.js'

const SEARCHING = /Searching(…|\.\.\.)/
const DUNE = [
  { id: 7, title: 'Dune' },
  { id: 8, title: 'Dune Messiah' },
]
const DU = [{ id: 3, title: 'Dubliners' }]
const DUN = [{ id: 9, title: 'Dungeon Crawler Carl' }]

function jsonResponse(body, status = 200) {
  if (typeof Response === 'function') {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
}

const urlOf = (arg) => String(arg && typeof arg === 'object' && 'url' in arg ? arg.url : arg)
const parsed = (arg) => new URL(urlOf(arg), 'http://localhost')

/** A fake search server: every fetch stays pending until the test answers it, by query. */
function searchServer() {
  const pending = []
  const fn = vi.fn((input) => new Promise((resolve, reject) => pending.push({ q: parsed(input).searchParams.get('q'), resolve, reject })))
  const take = (q) => {
    const i = pending.findIndex((p) => p.q === q)
    if (i < 0) throw new Error(`no pending request for q=${q}; pending: ${pending.map((p) => p.q).join(', ')}`)
    return pending.splice(i, 1)[0]
  }
  return {
    fn,
    queries: () => fn.mock.calls.map((call) => parsed(call[0]).searchParams.get('q')),
    respond: (q, results) => take(q).resolve(jsonResponse({ results })),
    respondStatus: (q, status) => take(q).resolve(jsonResponse({ error: 'nope' }, status)),
    fail: (q) => take(q).reject(new TypeError('Failed to fetch')),
  }
}

const box = () => document.querySelector('input')
const titles = () => [...document.querySelectorAll('ul.results li')].map((li) => textOf(li))

/** Type a word one letter at a time, ~50 ms apart (well inside the 300 ms debounce). */
async function typeQuickly(word) {
  for (let i = 1; i <= word.length; i++) await typeInto(box(), word.slice(0, i))
}

async function startServer() {
  const server = searchServer()
  vi.stubGlobal('fetch', server.fn)
  await mountApp()
  return server
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('11 debounced search with stale-response handling', () => {
  it('waits for a 300 ms pause in typing and sends one request for the final text', async () => {
    const server = await startServer()
    await typeQuickly('dune')
    await sleep(150)
    expect(server.fn).not.toHaveBeenCalled()
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(1))
    const url = parsed(server.fn.mock.calls[0][0])
    expect(url.pathname).toBe('/api/search')
    expect(server.queries()).toEqual(['dune'])
    await waitFor(() => expect(bodyText()).toMatch(SEARCHING))
    await sleep(400)
    expect(server.fn).toHaveBeenCalledTimes(1)
  })

  it('shows the results, then "No results" for an empty list', async () => {
    const server = await startServer()
    await typeQuickly('dune')
    await waitFor(() => expect(server.queries()).toEqual(['dune']))
    server.respond('dune', DUNE)
    await waitFor(() => expect(titles()).toEqual(['Dune', 'Dune Messiah']))
    expect(bodyText()).not.toMatch(SEARCHING)
    expect(bodyText()).not.toContain('No results')

    await typeInto(box(), 'dune zz')
    await waitFor(() => expect(server.queries()).toEqual(['dune', 'dune zz']))
    server.respond('dune zz', [])
    await waitFor(() => expect(bodyText()).toContain('No results'))
    expect(titles()).toEqual([])
    expect(bodyText()).not.toMatch(SEARCHING)
  })

  it('shows "Search failed." for a non-2xx response or a network error, and recovers on the next search', async () => {
    const server = await startServer()
    await typeInto(box(), 'du')
    await waitFor(() => expect(server.queries()).toEqual(['du']))
    server.respondStatus('du', 500)
    await waitFor(() => expect(bodyText()).toContain('Search failed.'))
    expect(bodyText()).not.toMatch(SEARCHING)

    await typeInto(box(), 'dun')
    await waitFor(() => expect(server.queries()).toEqual(['du', 'dun']))
    server.fail('dun')
    await waitFor(() => expect(bodyText()).toContain('Search failed.'))

    await typeInto(box(), 'dune')
    await waitFor(() => expect(server.queries()).toEqual(['du', 'dun', 'dune']))
    server.respond('dune', DUNE)
    await waitFor(() => expect(titles()).toEqual(['Dune', 'Dune Messiah']))
    expect(bodyText()).not.toContain('Search failed.')
  })

  it('ignores an older response that arrives after a newer one', async () => {
    const server = await startServer()
    await typeInto(box(), 'du')
    await waitFor(() => expect(server.queries()).toEqual(['du']))
    await typeInto(box(), 'dun')
    await waitFor(() => expect(server.queries()).toEqual(['du', 'dun']))

    server.respond('dun', DUN)
    await waitFor(() => expect(titles()).toEqual(['Dungeon Crawler Carl']))
    server.respond('du', DU)
    await sleep(200)
    expect(titles()).toEqual(['Dungeon Crawler Carl'])
    expect(bodyText()).not.toMatch(SEARCHING)
  })

  it('an older response arriving first is not shown; the newest one is', async () => {
    const server = await startServer()
    await typeInto(box(), 'du')
    await waitFor(() => expect(server.queries()).toEqual(['du']))
    await typeInto(box(), 'dune')
    await waitFor(() => expect(server.queries()).toEqual(['du', 'dune']))

    server.respond('du', DU)
    await sleep(200)
    expect(titles()).not.toContain('Dubliners')
    expect(bodyText()).toMatch(SEARCHING)

    server.respond('dune', DUNE)
    await waitFor(() => expect(titles()).toEqual(['Dune', 'Dune Messiah']))
    expect(bodyText()).not.toMatch(SEARCHING)
  })

  it('a stale failure does not replace newer results', async () => {
    const server = await startServer()
    await typeInto(box(), 'du')
    await waitFor(() => expect(server.queries()).toEqual(['du']))
    await typeInto(box(), 'dun')
    await waitFor(() => expect(server.queries()).toEqual(['du', 'dun']))

    server.respond('dun', DUN)
    await waitFor(() => expect(titles()).toEqual(['Dungeon Crawler Carl']))
    server.fail('du')
    await sleep(200)
    expect(titles()).toEqual(['Dungeon Crawler Carl'])
    expect(bodyText()).not.toContain('Search failed.')
  })

  it('clearing the box clears everything at once, sends nothing, and ignores the request in flight', async () => {
    const server = await startServer()
    await typeInto(box(), 'dune')
    await waitFor(() => expect(server.queries()).toEqual(['dune']))
    server.respond('dune', DUNE)
    await waitFor(() => expect(titles()).toEqual(['Dune', 'Dune Messiah']))

    await typeInto(box(), '')
    expect(titles()).toEqual([])
    await sleep(500)
    expect(server.queries()).toEqual(['dune'])
    expect(titles()).toEqual([])

    await typeInto(box(), 'dun')
    await waitFor(() => expect(server.queries()).toEqual(['dune', 'dun']))
    await waitFor(() => expect(bodyText()).toMatch(SEARCHING))
    await typeInto(box(), '')
    expect(bodyText()).not.toMatch(SEARCHING)
    server.respond('dun', DUN)
    await sleep(200)
    expect(titles()).toEqual([])
    expect(bodyText()).not.toMatch(SEARCHING)
    expect(bodyText()).not.toContain('No results')
    expect(server.queries()).toEqual(['dune', 'dun'])
  })

  it('clearing the box before the pause is over sends no request at all', async () => {
    const server = await startServer()
    await typeQuickly('dun')
    await typeInto(box(), '')
    await sleep(600)
    expect(server.fn).not.toHaveBeenCalled()
    expect(titles()).toEqual([])
    expect(bodyText()).not.toMatch(SEARCHING)
  })
})
