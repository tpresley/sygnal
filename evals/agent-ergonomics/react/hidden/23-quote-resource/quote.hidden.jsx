import { describe, it, expect, vi, afterEach } from 'vitest'
import { mountApp, waitFor, textOf, click, sleep, getByText } from './dom.js'

const LOADING = /^Loading(…|\.\.\.)$/
const ERROR = 'Could not load the quote.'

const Q101 = { id: 101, text: 'Simplicity is prerequisite for reliability.', author: 'Edsger W. Dijkstra' }
const Q101_EDITED = { id: 101, text: 'Simplicity is a great virtue.', author: 'Edsger W. Dijkstra' }
const Q101_LATEST = { id: 101, text: 'Simplicity is hard work.', author: 'Edsger W. Dijkstra' }
const Q102 = { id: 102, text: 'Premature optimization is the root of all evil.', author: 'Donald Knuth' }
const Q103 = { id: 103, text: 'Talk is cheap. Show me the code.', author: 'Linus Torvalds' }
const ALL_TEXTS = [Q101, Q101_EDITED, Q101_LATEST, Q102, Q103].map((q) => q.text)

function jsonResponse(body, status = 200) {
  if (typeof Response === 'function') {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
}

const urlOf = (arg) => String(arg && typeof arg === 'object' && 'url' in arg ? arg.url : arg)
const pathOf = (arg) => new URL(urlOf(arg), 'http://localhost').pathname

/**
 * A fake quote server: every fetch stays pending until the test answers it, by the
 * index of the request (0 = the first one sent), in any order. Like a browser, an
 * aborted request rejects with an AbortError, and answering it afterwards does nothing.
 */
function quoteServer() {
  const requests = []
  const fn = vi.fn((input, init) => new Promise((resolve, reject) => {
    const request = { path: pathOf(input), resolve, reject, settled: false }
    requests.push(request)
    const signal = init?.signal ?? (input && typeof input === 'object' ? input.signal : undefined)
    const abort = () => {
      if (request.settled) return
      request.settled = true
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener?.('abort', abort)
  }))
  const settle = (i, how) => {
    const request = requests[i]
    if (!request) throw new Error(`no request #${i}; sent: ${requests.map((r) => r.path).join(', ')}`)
    if (request.settled) return
    request.settled = true
    how(request)
  }
  return {
    fn,
    paths: () => requests.map((r) => r.path),
    respond: (i, quote) => settle(i, (r) => r.resolve(jsonResponse(quote))),
    serverError: (i) => settle(i, (r) => r.resolve(jsonResponse({ error: 'boom' }, 500))),
    networkError: (i) => settle(i, (r) => r.reject(new TypeError('Failed to fetch'))),
  }
}

async function start() {
  const server = quoteServer()
  vi.stubGlobal('fetch', server.fn)
  await mountApp()
  return server
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const detail = () => document.querySelector('.detail')
const textIn = (selector) => {
  const el = detail()?.querySelector(selector)
  return el ? textOf(el) : ''
}
const status = () => textIn('.status')
const shownText = () => textIn('.quote-text')
const shownAuthor = () => textIn('.quote-author')

async function pick(id) {
  await click(getByText('button', `Quote ${id}`))
}

async function refresh() {
  await click(getByText('button', 'Refresh'))
}

/** Loading…, and no quote at all (neither this one nor an older one). */
function expectLoading() {
  expect(status()).toMatch(LOADING)
  expect(shownText()).toBe('')
  expect(shownAuthor()).toBe('')
  for (const text of ALL_TEXTS) expect(textOf(detail())).not.toContain(text)
}

function expectShown(quote) {
  expect(shownText()).toBe(quote.text)
  expect(shownAuthor()).toContain(quote.author)
  expect(status()).toBe('')
  for (const text of ALL_TEXTS.filter((t) => t !== quote.text)) expect(textOf(detail())).not.toContain(text)
}

describe('23 quote resource: load on pick, Refresh, latest request only', () => {
  it('loads nothing until a quote is picked, then loads and shows it', async () => {
    const server = await start()
    expect(textOf(detail())).toContain('Select a quote.')
    await sleep(100)
    expect(server.fn).not.toHaveBeenCalled()

    await pick(101)
    await waitFor(() => expect(server.paths()).toEqual(['/api/quotes/101']))
    await waitFor(() => expectLoading())
    server.respond(0, Q101)
    await waitFor(() => expectShown(Q101))
    await sleep(100)
    expect(server.fn).toHaveBeenCalledTimes(1)
  })

  it('picking another quote shows "Loading…" instead of the old quote, then the new one', async () => {
    const server = await start()
    await pick(101)
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(1))
    server.respond(0, Q101)
    await waitFor(() => expectShown(Q101))

    await pick(102)
    await waitFor(() => expect(server.paths()).toEqual(['/api/quotes/101', '/api/quotes/102']))
    await waitFor(() => expectLoading())
    server.respond(1, Q102)
    await waitFor(() => expectShown(Q102))
  })

  it('responses that arrive out of order: only the latest pick is shown', async () => {
    const server = await start()
    await pick(101)
    await pick(102)
    await waitFor(() => expect(server.paths()).toEqual(['/api/quotes/101', '/api/quotes/102']))
    server.respond(1, Q102)
    await waitFor(() => expectShown(Q102))
    server.respond(0, Q101)
    await sleep(150)
    expectShown(Q102)

    // The other way round: the older response arrives first and is ignored.
    await pick(103)
    await pick(101)
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(4))
    expect(server.paths().slice(2)).toEqual(['/api/quotes/103', '/api/quotes/101'])
    server.respond(2, Q103)
    await sleep(150)
    expectLoading()
    server.respond(3, Q101)
    await waitFor(() => expectShown(Q101))
  })

  it('a failure shows the error, and Refresh loads the quote again', async () => {
    const server = await start()
    await pick(102)
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(1))
    server.serverError(0)
    await waitFor(() => expect(status()).toBe(ERROR))
    expect(shownText()).toBe('')

    await refresh()
    await waitFor(() => expect(server.paths()).toEqual(['/api/quotes/102', '/api/quotes/102']))
    await waitFor(() => expectLoading())
    server.networkError(1)
    await waitFor(() => expect(status()).toBe(ERROR))
    expect(shownText()).toBe('')

    await refresh()
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(3))
    await waitFor(() => expectLoading())
    server.respond(2, Q102)
    await waitFor(() => expectShown(Q102))
  })

  it('a failure of an earlier request is never shown', async () => {
    const server = await start()
    await pick(101)
    await pick(102)
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(2))
    server.serverError(0)
    await sleep(150)
    expectLoading()
    server.respond(1, Q102)
    await waitFor(() => expectShown(Q102))

    await pick(103)
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(3))
    server.respond(2, Q103)
    await waitFor(() => expectShown(Q103))
  })

  it('Refresh reloads the selected quote, and only its newest response counts', async () => {
    const server = await start()
    await pick(101)
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(1))
    server.respond(0, Q101)
    await waitFor(() => expectShown(Q101))

    await refresh()
    await waitFor(() => expect(server.paths()).toEqual(['/api/quotes/101', '/api/quotes/101']))
    await waitFor(() => expectLoading())
    server.respond(1, Q101_EDITED)
    await waitFor(() => expectShown(Q101_EDITED))

    // Two refreshes in a row: the first one's late response is stale, though it is for the same quote.
    await refresh()
    await refresh()
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(4))
    server.respond(3, Q101_LATEST)
    await waitFor(() => expectShown(Q101_LATEST))
    server.respond(2, Q101)
    await sleep(150)
    expectShown(Q101_LATEST)
  })

  it('picking another quote and coming back: the first request for that quote is stale', async () => {
    const server = await start()
    await pick(101)
    await pick(102)
    await pick(101)
    await waitFor(() => expect(server.paths()).toEqual(['/api/quotes/101', '/api/quotes/102', '/api/quotes/101']))

    server.respond(0, Q101)
    await sleep(150)
    expectLoading()
    server.respond(1, Q102)
    await sleep(150)
    expectLoading()
    server.respond(2, Q101_EDITED)
    await waitFor(() => expectShown(Q101_EDITED))

    // A late failure of an earlier request for the same quote changes nothing either.
    await refresh()
    await refresh()
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(5))
    server.respond(4, Q101_LATEST)
    await waitFor(() => expectShown(Q101_LATEST))
    server.networkError(3)
    await sleep(150)
    expectShown(Q101_LATEST)
  })
})
