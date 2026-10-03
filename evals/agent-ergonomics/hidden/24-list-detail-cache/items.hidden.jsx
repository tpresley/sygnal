import { describe, it, expect, vi, afterEach } from 'vitest'
import { mountApp, waitFor, textOf, click, typeInto, sleep, getByText, queryByText } from './dom.js'

const LOADING = /^Loading(…|\.\.\.)$/
const UPDATING = /^Updating(…|\.\.\.)$/
const SAVE_ERROR = 'Could not save the item.'
// Longer than the 2 s freshness window of the spec
const STALE_WAIT_MS = 2300

const ITEMS = [
  { id: 1, title: 'Alpha' },
  { id: 2, title: 'Beta' },
  { id: 3, title: 'Gamma' },
]
const ITEM1 = { id: 1, title: 'Alpha', body: 'The first item.' }
const ITEM2 = { id: 2, title: 'Beta', body: 'The second item.' }
const withTitle = (list, id, title) => list.map((it) => (it.id === id ? { ...it, title } : it))

function jsonResponse(body, status = 200) {
  if (typeof Response === 'function') {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
}

const urlOf = (arg) => String(arg && typeof arg === 'object' && 'url' in arg ? arg.url : arg)
const pathOf = (arg) => new URL(urlOf(arg), 'http://localhost').pathname

/**
 * A fake item server: every fetch stays pending until the test answers it, by the index of the
 * request (0 = the first one sent) or by method and path, in any order. Like a browser, an
 * aborted request rejects with an AbortError, and answering it afterwards does nothing.
 */
function itemServer() {
  const requests = []
  const fn = vi.fn((input, init) => new Promise((resolve, reject) => {
    const method = String(init?.method ?? (input && typeof input === 'object' ? input.method : undefined) ?? 'GET').toUpperCase()
    const request = { method, path: pathOf(input), body: init?.body, resolve, reject, settled: false }
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
    if (!request) throw new Error(`no request #${i}; sent: ${requests.map((r) => `${r.method} ${r.path}`).join(', ')}`)
    if (request.settled) return
    request.settled = true
    how(request)
  }
  const indexes = (method, path) => requests.flatMap((r, i) => (r.method === method && r.path === path ? [i] : []))
  return {
    fn,
    sent: () => requests.map((r) => `${r.method} ${r.path}`),
    count: (method, path) => indexes(method, path).length,
    /** index of the newest request for method + path (-1: none) */
    last: (method, path) => indexes(method, path).at(-1) ?? -1,
    bodyOf: (i) => JSON.parse(requests[i].body),
    respond: (i, body) => settle(i, (r) => r.resolve(jsonResponse(body))),
    serverError: (i) => settle(i, (r) => r.resolve(jsonResponse({ error: 'boom' }, 500))),
    networkError: (i) => settle(i, (r) => r.reject(new TypeError('Failed to fetch'))),
    /** answer every request for method + path still pending (except the indexes in `skip`) */
    answerPending: (method, path, body, skip = []) => {
      for (const i of indexes(method, path)) if (!skip.includes(i)) settle(i, (r) => r.resolve(jsonResponse(body)))
    },
  }
}

async function start() {
  const server = itemServer()
  vi.stubGlobal('fetch', server.fn)
  await mountApp()
  return server
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const textIn = (selector) => {
  const el = document.querySelector(selector)
  return el ? textOf(el) : ''
}
const status = () => textIn('.status')
const listTitles = () => [...document.querySelectorAll('ul.items li')].map((li) => textOf(li))
const shownTitle = () => textIn('.detail .item-title')
const shownBody = () => textIn('.detail .item-body')
const titleInput = () => document.querySelector('.edit input[name="title"]')
const saveError = () => textIn('.save-error')

async function openItem(title) {
  await click(getByText('ul.items button', title))
}
async function back() {
  await click(getByText('button', 'Back to list'))
}
async function edit() {
  await click(getByText('button', 'Edit'))
}
async function save() {
  await click(getByText('.edit button', 'Save'))
}

/** Start the app and answer the first list request. */
async function startWithList() {
  const server = await start()
  await waitFor(() => expect(server.count('GET', '/api/items')).toBe(1))
  server.respond(server.last('GET', '/api/items'), ITEMS)
  await waitFor(() => expect(listTitles()).toEqual(['Alpha', 'Beta', 'Gamma']))
  return server
}

/** Open an item never shown before and answer its request. */
async function openFresh(server, item) {
  await openItem(item.title)
  await waitFor(() => expect(server.count('GET', `/api/items/${item.id}`)).toBeGreaterThan(0))
  server.respond(server.last('GET', `/api/items/${item.id}`), item)
  await waitFor(() => expect(shownTitle()).toBe(item.title))
}

describe('24 list/detail with a cache: loading, background updates, saving', () => {
  it('loads the list: "Loading…" first, then one entry per item', async () => {
    const server = await start()
    await waitFor(() => expect(server.sent()).toEqual(['GET /api/items']))
    await waitFor(() => expect(status()).toMatch(LOADING))
    expect(listTitles()).toEqual([])

    server.respond(0, ITEMS)
    await waitFor(() => expect(listTitles()).toEqual(['Alpha', 'Beta', 'Gamma']))
    expect(status()).toBe('')
    expect(document.querySelectorAll('ul.items li button.open')).toHaveLength(3)
    await sleep(100)
    expect(server.fn).toHaveBeenCalledTimes(1)
  })

  it('an item shows "Loading…" (and nothing of another item) the first time; data less than 2 s old is shown again without a request', async () => {
    const server = await startWithList()

    await openItem('Alpha')
    await waitFor(() => expect(server.sent()).toEqual(['GET /api/items', 'GET /api/items/1']))
    await waitFor(() => expect(status()).toMatch(LOADING))
    expect(shownTitle()).toBe('')
    expect(shownBody()).toBe('')
    server.respond(1, ITEM1)
    await waitFor(() => expect(shownTitle()).toBe('Alpha'))
    expect(shownBody()).toBe('The first item.')
    expect(status()).toBe('')

    // The list arrived less than 2 s ago: shown at once, no request
    await back()
    expect(listTitles()).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(status()).toBe('')
    await sleep(100)
    expect(server.sent()).toEqual(['GET /api/items', 'GET /api/items/1'])

    // Another item: loading, and never the previous item's data
    await openItem('Beta')
    await waitFor(() => expect(server.sent()).toEqual(['GET /api/items', 'GET /api/items/1', 'GET /api/items/2']))
    await waitFor(() => expect(status()).toMatch(LOADING))
    expect(shownTitle()).toBe('')
    expect(textOf(document.querySelector('.detail'))).not.toContain('The first item.')
    server.respond(2, ITEM2)
    await waitFor(() => expect(shownTitle()).toBe('Beta'))
    expect(shownBody()).toBe('The second item.')

    // Back to Alpha within 2 s: from the cache, no request
    await back()
    await openItem('Alpha')
    expect(shownTitle()).toBe('Alpha')
    expect(status()).toBe('')
    await sleep(100)
    expect(server.fn).toHaveBeenCalledTimes(3)
  })

  it('data older than 2 s is shown at once with "Updating…", reloaded in the background, then replaced', async () => {
    const server = await startWithList()
    await openFresh(server, ITEM1)
    await back()
    await sleep(STALE_WAIT_MS)

    await openItem('Alpha')
    expect(shownTitle()).toBe('Alpha')
    expect(shownBody()).toBe('The first item.')
    await waitFor(() => expect(server.count('GET', '/api/items/1')).toBe(2))
    await waitFor(() => expect(status()).toMatch(UPDATING))
    expect(shownTitle()).toBe('Alpha')
    server.respond(server.last('GET', '/api/items/1'), { ...ITEM1, body: 'The first item, updated.' })
    await waitFor(() => expect(shownBody()).toBe('The first item, updated.'))
    expect(status()).toBe('')

    await back()
    expect(listTitles()).toEqual(['Alpha', 'Beta', 'Gamma'])
    await waitFor(() => expect(server.count('GET', '/api/items')).toBe(2))
    await waitFor(() => expect(status()).toMatch(UPDATING))
    expect(listTitles()).toEqual(['Alpha', 'Beta', 'Gamma'])
    server.respond(server.last('GET', '/api/items'), withTitle(ITEMS, 3, 'Gamma (new)'))
    await waitFor(() => expect(listTitles()).toEqual(['Alpha', 'Beta', 'Gamma (new)']))
    expect(status()).toBe('')
  })

  it('Save sends PUT; afterwards the form closes, and the item and the list (though less than 2 s old) are reloaded with the new title', async () => {
    const server = await startWithList()
    await openFresh(server, ITEM1)

    await edit()
    expect(titleInput()).not.toBeNull()
    expect(titleInput().value).toBe('Alpha')
    await typeInto(titleInput(), 'Alpha renamed')
    await save()
    await waitFor(() => expect(server.count('PUT', '/api/items/1')).toBe(1))
    expect(server.bodyOf(server.last('PUT', '/api/items/1'))).toEqual({ title: 'Alpha renamed' })
    const renamed = { ...ITEM1, title: 'Alpha renamed' }
    server.respond(server.last('PUT', '/api/items/1'), renamed)

    await waitFor(() => expect(titleInput()).toBeNull())
    await waitFor(() => {
      server.answerPending('GET', '/api/items/1', renamed)
      expect(shownTitle()).toBe('Alpha renamed')
    })
    expect(saveError()).toBe('')

    await back()
    await waitFor(() => {
      server.answerPending('GET', '/api/items', withTitle(ITEMS, 1, 'Alpha renamed'))
      expect(listTitles()).toEqual(['Alpha renamed', 'Beta', 'Gamma'])
    })
    await waitFor(() => expect(status()).toBe(''))
  })

  it('a failed save shows "Could not save the item." and keeps the typed title; a later save succeeds', async () => {
    const server = await startWithList()
    await openFresh(server, ITEM1)

    await edit()
    await typeInto(titleInput(), 'Alpha v2')
    await save()
    await waitFor(() => expect(server.count('PUT', '/api/items/1')).toBe(1))
    server.serverError(server.last('PUT', '/api/items/1'))
    await waitFor(() => expect(saveError()).toBe(SAVE_ERROR))
    expect(titleInput()).not.toBeNull()
    expect(titleInput().value).toBe('Alpha v2')
    expect(shownTitle()).toBe('Alpha')

    await save()
    await waitFor(() => expect(server.count('PUT', '/api/items/1')).toBe(2))
    expect(server.bodyOf(server.last('PUT', '/api/items/1'))).toEqual({ title: 'Alpha v2' })
    server.networkError(server.last('PUT', '/api/items/1'))
    await waitFor(() => expect(saveError()).toBe(SAVE_ERROR))
    expect(titleInput().value).toBe('Alpha v2')

    await save()
    await waitFor(() => expect(server.count('PUT', '/api/items/1')).toBe(3))
    const saved = { ...ITEM1, title: 'Alpha v2' }
    server.respond(server.last('PUT', '/api/items/1'), saved)
    await waitFor(() => expect(titleInput()).toBeNull())
    await waitFor(() => {
      server.answerPending('GET', '/api/items/1', saved)
      expect(shownTitle()).toBe('Alpha v2')
    })
    expect(saveError()).toBe('')
    expect(queryByText('*', SAVE_ERROR)).toBeNull()
  })

  it('a background reload that started before a save never overwrites the saved title', async () => {
    const server = await startWithList()
    await openFresh(server, ITEM1)
    await back()
    await sleep(STALE_WAIT_MS)

    // Alpha is reloading in the background (request `before`) while the user saves
    await openItem('Alpha')
    await waitFor(() => expect(server.count('GET', '/api/items/1')).toBe(2))
    const before = server.last('GET', '/api/items/1')
    await edit()
    await typeInto(titleInput(), 'Alpha v3')
    await save()
    await waitFor(() => expect(server.count('PUT', '/api/items/1')).toBe(1))
    const saved = { ...ITEM1, title: 'Alpha v3' }
    server.respond(server.last('PUT', '/api/items/1'), saved)
    await waitFor(() => {
      server.answerPending('GET', '/api/items/1', saved, [before])
      expect(shownTitle()).toBe('Alpha v3')
    })

    // The older reload answers last, with the old title
    server.respond(before, ITEM1)
    await sleep(150)
    expect(shownTitle()).toBe('Alpha v3')
    await waitFor(() => expect(status()).toBe(''))
  })
})
