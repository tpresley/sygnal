import { describe, it, expect, vi, afterEach } from 'vitest'
import { mountApp, advance, typeInto, textOf } from './dom.js'

// Fake timers throughout: every interaction helper advances the clock by 50 ms, and
// advance(ms) moves it further. fetch is a fake server whose requests stay pending
// until the test answers them; localStorage is jsdom's, cleared before each test.

const KEY = 'note-draft'
const SAVING = /^Saving(…|\.\.\.)$/

function jsonResponse(body, status = 200) {
  if (typeof Response === 'function') {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
}

const urlOf = (arg) => String(arg && typeof arg === 'object' && 'url' in arg ? arg.url : arg)
const pathOf = (arg) => new URL(urlOf(arg), 'http://localhost').pathname

/**
 * A fake draft server: every fetch stays pending until the test answers it by index
 * (0 = the first request sent). Like a browser, an aborted request rejects with an
 * AbortError, and answering it afterwards does nothing.
 */
function draftServer() {
  const requests = []
  const fn = vi.fn((input, init) => new Promise((resolve, reject) => {
    const fromInput = input && typeof input === 'object' ? input : {}
    const method = String(init?.method ?? fromInput.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers ?? fromInput.headers ?? {})
    const request = { method, path: pathOf(input), headers, body: init?.body, resolve, reject, settled: false }
    requests.push(request)
    const signal = init?.signal ?? fromInput.signal
    const abort = () => {
      if (request.settled) return
      request.settled = true
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener?.('abort', abort)
  }))
  const settle = async (i, how) => {
    const request = requests[i]
    if (!request) throw new Error(`no request #${i}; sent: ${requests.map((r) => `${r.method} ${r.path}`).join(', ')}`)
    if (!request.settled) {
      request.settled = true
      how(request)
    }
    await advance(50)
  }
  return {
    fn,
    count: () => requests.length,
    request: (i) => requests[i],
    sent: () => requests.map((r) => `${r.method} ${r.path}`),
    jsonOf: (i) => JSON.parse(requests[i].body),
    ok: (i) => settle(i, (r) => r.resolve(jsonResponse({ ok: true }))),
    noContent: (i) => settle(i, (r) => r.resolve(typeof Response === 'function' ? new Response(null, { status: 204 }) : { ok: true, status: 204, json: async () => null, text: async () => '' })),
    serverError: (i) => settle(i, (r) => r.resolve(jsonResponse({ error: 'boom' }, 500))),
    networkError: (i) => settle(i, (r) => r.reject(new TypeError('Failed to fetch'))),
  }
}

/** Open the app (again) with whatever localStorage holds; a fresh fake server each time. */
async function open() {
  const server = draftServer()
  vi.stubGlobal('fetch', server.fn)
  await mountApp()
  return server
}

async function start(stored) {
  localStorage.clear()
  if (stored !== undefined) localStorage.setItem(KEY, stored)
  vi.useFakeTimers()
  return open()
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
})

const title = () => document.querySelector('input[name="title"]')
const body = () => document.querySelector('textarea[name="body"]')
const status = () => textOf(document.querySelector('.save-status'))
const words = () => textOf(document.querySelector('.word-count'))
const stored = () => JSON.parse(localStorage.getItem(KEY))

describe('26 autosave: debounced PUT, save status, latest save only, draft kept in localStorage', () => {
  it('opens empty with no status, and opening the app saves nothing', async () => {
    const server = await start()
    expect(title().value).toBe('')
    expect(body().value).toBe('')
    expect(status()).toBe('')
    expect(words()).toBe('0 words')
    await advance(3000)
    expect(server.count()).toBe(0)
    expect(status()).toBe('')
  })

  it('saves once, 1 s after the last edit, with the current title and body', async () => {
    const server = await start()
    await typeInto(title(), 'Groceries') // edit at t = 0
    expect(status()).toBe('Unsaved changes')
    await advance(550)
    await typeInto(body(), 'milk eggs') // edit at t = 600: restarts the wait
    expect(words()).toBe('2 words')
    await advance(850) // t = 1500: 900 ms after the last edit
    expect(server.count()).toBe(0)
    expect(status()).toBe('Unsaved changes')
    await advance(200) // t = 1700
    expect(server.sent()).toEqual(['PUT /api/draft'])
    expect(server.jsonOf(0)).toEqual({ title: 'Groceries', body: 'milk eggs' })
    expect(server.request(0).headers.get('content-type')).toMatch(/^application\/json/)
    expect(status()).toMatch(SAVING)

    await server.ok(0)
    expect(status()).toBe('Saved')
    await advance(3000)
    expect(server.count()).toBe(1)
    expect(status()).toBe('Saved')
  })

  it('a failed save shows "Save failed." and is not retried; the next edit saves again', async () => {
    const server = await start()
    await typeInto(title(), 'Plan')
    await advance(1100)
    expect(server.count()).toBe(1)
    await server.serverError(0)
    expect(status()).toBe('Save failed.')
    await advance(3000)
    expect(server.count()).toBe(1)

    await typeInto(body(), 'step one')
    expect(status()).toBe('Unsaved changes')
    await advance(1100)
    expect(server.count()).toBe(2)
    expect(server.jsonOf(1)).toEqual({ title: 'Plan', body: 'step one' })
    await server.networkError(1)
    expect(status()).toBe('Save failed.')

    await typeInto(body(), 'step one, two')
    await advance(1100)
    expect(server.count()).toBe(3)
    await server.noContent(2)
    expect(status()).toBe('Saved')
  })

  it('an edit during a save shows "Unsaved changes"; the older success never changes the status', async () => {
    const server = await start()
    await typeInto(title(), 'Draft A')
    await advance(1100)
    expect(server.count()).toBe(1)
    expect(status()).toMatch(SAVING)

    await typeInto(title(), 'Draft AB')
    expect(status()).toBe('Unsaved changes')
    await server.ok(0) // the older save answers while the newer edit waits
    expect(status()).toBe('Unsaved changes')
    await advance(1100)
    expect(server.count()).toBe(2)
    expect(server.jsonOf(1)).toEqual({ title: 'Draft AB', body: '' })
    expect(status()).toMatch(SAVING)
    await server.ok(1)
    expect(status()).toBe('Saved')
  })

  it('an older reply arriving after a newer save never changes the status, success or failure', async () => {
    const server = await start()
    await typeInto(body(), 'one')
    await advance(1100) // save #0 in flight
    await typeInto(body(), 'one two')
    await advance(1100) // save #1 in flight
    expect(server.count()).toBe(2)
    await server.serverError(0)
    expect(status()).toMatch(SAVING)
    await server.ok(1)
    expect(status()).toBe('Saved')

    await typeInto(body(), 'one two three')
    await advance(1100) // save #2
    await typeInto(body(), 'one two three four')
    await advance(1100) // save #3
    expect(server.count()).toBe(4)
    await server.serverError(3)
    expect(status()).toBe('Save failed.')
    await server.ok(2)
    expect(status()).toBe('Save failed.')
  })

  it('keeps the draft in localStorage within 300 ms and restores it when the app opens again', async () => {
    const server = await start()
    await typeInto(title(), 'Trip')
    await typeInto(body(), 'pack bags')
    await advance(250) // 300 ms after the last edit, long before the save
    expect(server.count()).toBe(0)
    expect(stored()).toEqual({ title: 'Trip', body: 'pack bags' })
    await advance(1000)
    expect(server.count()).toBe(1)
    await server.ok(0)

    // Open the app again on the same storage.
    const again = await open()
    expect(title().value).toBe('Trip')
    expect(body().value).toBe('pack bags')
    expect(words()).toBe('2 words')
    expect(status()).toBe('')
    await advance(3000)
    expect(again.count()).toBe(0)

    // The restored draft is the app's state: the next save carries both fields.
    await typeInto(body(), 'pack bags, passport')
    await advance(1100)
    expect(again.count()).toBe(1)
    expect(again.jsonOf(0)).toEqual({ title: 'Trip', body: 'pack bags, passport' })
    expect(stored()).toEqual({ title: 'Trip', body: 'pack bags, passport' })
  })

  it('starts empty when the stored draft is not valid JSON, and stores valid JSON again after an edit', async () => {
    const server = await start('{"title": "Trip", oops')
    expect(title().value).toBe('')
    expect(body().value).toBe('')
    expect(status()).toBe('')
    await typeInto(title(), 'Fresh start')
    await advance(250)
    expect(stored()).toEqual({ title: 'Fresh start', body: '' })
    await advance(800)
    expect(server.count()).toBe(1)
    expect(server.jsonOf(0)).toEqual({ title: 'Fresh start', body: '' })
  })
})
