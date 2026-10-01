import { describe, it, expect, vi, afterEach } from 'vitest'
import { click, mountApp, waitFor, button, bodyText } from './dom.js'

const QUOTE = { text: 'Simplicity is prerequisite for reliability.', author: 'Edsger Dijkstra' }
const OTHER = { text: 'Premature optimization is the root of all evil.', author: 'Donald Knuth' }

function jsonResponse(body, status = 200) {
  if (typeof Response === 'function') {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
}

/** A fetch stub whose responses are released by the test, in call order. */
function controllableFetch() {
  const pending = []
  const fn = vi.fn(() => new Promise((resolve, reject) => pending.push({ resolve, reject })))
  return {
    fn,
    respond: (value) => pending.shift().resolve(value),
    fail: (err) => pending.shift().reject(err),
    pendingCount: () => pending.length,
  }
}

const urlOf = (arg) => String(arg && typeof arg === 'object' && 'url' in arg ? arg.url : arg)
const LOADING = /Loading(…|\.\.\.)/

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('05 async side effect: load a quote', () => {
  it('requests /api/quote and shows a loading state', async () => {
    const f = controllableFetch()
    vi.stubGlobal('fetch', f.fn)
    await mountApp()
    expect(f.fn).not.toHaveBeenCalled()
    await click(button(/get a quote/i))
    await waitFor(() => expect(f.fn).toHaveBeenCalledTimes(1))
    expect(urlOf(f.fn.mock.calls[0][0])).toMatch(/\/api\/quote$/)
    await waitFor(() => expect(bodyText()).toMatch(LOADING))
  })

  it('shows "<text> — <author>" when the request succeeds', async () => {
    const f = controllableFetch()
    vi.stubGlobal('fetch', f.fn)
    await mountApp()
    await click(button(/get a quote/i))
    await waitFor(() => expect(f.pendingCount()).toBe(1))
    f.respond(jsonResponse(QUOTE))
    await waitFor(() => expect(bodyText()).toContain(`${QUOTE.text} — ${QUOTE.author}`))
    expect(bodyText()).not.toMatch(LOADING)
  })

  it('shows an error for a non-2xx response', async () => {
    const f = controllableFetch()
    vi.stubGlobal('fetch', f.fn)
    await mountApp()
    await click(button(/get a quote/i))
    await waitFor(() => expect(f.pendingCount()).toBe(1))
    f.respond(jsonResponse({ error: 'boom' }, 500))
    await waitFor(() => expect(bodyText()).toContain('Could not load a quote.'))
    expect(bodyText()).not.toMatch(LOADING)
  })

  it('shows an error for a network failure, and a retry can succeed', async () => {
    const f = controllableFetch()
    vi.stubGlobal('fetch', f.fn)
    await mountApp()
    await click(button(/get a quote/i))
    await waitFor(() => expect(f.pendingCount()).toBe(1))
    f.fail(new TypeError('Failed to fetch'))
    await waitFor(() => expect(bodyText()).toContain('Could not load a quote.'))

    await click(button(/get a quote/i))
    await waitFor(() => expect(f.pendingCount()).toBe(1))
    await waitFor(() => expect(bodyText()).toMatch(LOADING))
    f.respond(jsonResponse(OTHER))
    await waitFor(() => expect(bodyText()).toContain(`${OTHER.text} — ${OTHER.author}`))
    expect(bodyText()).not.toContain('Could not load a quote.')
  })
})
