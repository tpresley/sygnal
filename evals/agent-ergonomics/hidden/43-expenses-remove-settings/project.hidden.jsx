import { it, expect, vi, afterEach } from 'vitest'
import { mountApp, waitFor, textOf, bodyText, click, typeInto, choose, blur, getByText, queryByText, sleep } from './dom.js'
import { runProjectTests, leftovers, projectFileExists } from './project.js'

// 43-expenses-remove-settings: the project's own tests
// One app per file that mounts: the app's router keeps listening to the document and to
// history until the page goes away, so each file gets a fresh jsdom.

const SEED = [
  { id: 1, description: 'Flight to Berlin', amount: 420, category: 'Travel', date: '2026-09-02', status: 'approved' },
  { id: 2, description: 'Team lunch', amount: 86.4, category: 'Meals', date: '2026-09-05', status: 'pending' },
  { id: 3, description: 'Desk lamp', amount: 39.99, category: 'Office', date: '2026-09-08', status: 'rejected' },
  { id: 4, description: 'Design tool licence', amount: 120, category: 'Software', date: '2026-09-12', status: 'approved' },
  { id: 5, description: 'Hotel in Berlin', amount: 310.5, category: 'Travel', date: '2026-09-03', status: 'pending' },
  { id: 6, description: 'Client dinner', amount: 145.2, category: 'Meals', date: '2026-09-15', status: 'approved' },
  { id: 7, description: 'Printer paper', amount: 24.75, category: 'Office', date: '2026-09-18', status: 'pending' },
]

function jsonResponse(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const urlOf = (input) => String(input && typeof input === 'object' && 'url' in input ? input.url : input)

/**
 * The expenses REST API in memory: answers every request after a short delay, like a server.
 * `requests` lists { method, path, body } (body parsed); `failNext(method, path, status)` makes the
 * next such request fail. An aborted request rejects with an AbortError, like a browser.
 */
function expenseServer(seed = SEED) {
  const expenses = seed.map((e) => ({ ...e }))
  let nextId = Math.max(...expenses.map((e) => e.id)) + 1
  const requests = []
  const failures = []
  const handle = (method, path, body) => {
    const f = failures.findIndex((x) => x.method === method && x.path === path)
    if (f >= 0) return jsonResponse({ error: 'failed' }, failures.splice(f, 1)[0].status)
    const m = path.match(/^\/api\/expenses(?:\/([^/]+))?$/)
    if (!m) return jsonResponse({ error: 'not found' }, 404)
    if (!m[1] && method === 'GET') return jsonResponse({ expenses: expenses.map((e) => ({ ...e })) })
    if (!m[1] && method === 'POST') {
      const created = { ...body, id: nextId++ }
      expenses.push(created)
      return jsonResponse(created, 201)
    }
    const i = expenses.findIndex((e) => String(e.id) === m[1])
    if (i < 0) return jsonResponse({ error: 'not found' }, 404)
    if (method === 'GET') return jsonResponse(expenses[i])
    if (method === 'PUT') {
      expenses[i] = { ...expenses[i], ...body }
      return jsonResponse(expenses[i])
    }
    if (method === 'DELETE') {
      expenses.splice(i, 1)
      return jsonResponse(null, 204)
    }
    return jsonResponse({ error: 'bad method' }, 405)
  }
  const fn = vi.fn((input, init = {}) => {
    const method = String(init.method ?? (input && typeof input === 'object' ? input.method : undefined) ?? 'GET').toUpperCase()
    const path = new URL(urlOf(input), 'http://localhost').pathname
    const raw = init.body ?? undefined
    const body = typeof raw === 'string' && raw ? JSON.parse(raw) : undefined
    requests.push({ method, path, body })
    const signal = init.signal ?? (input && typeof input === 'object' ? input.signal : undefined)
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'))
      if (signal?.aborted) return abort()
      signal?.addEventListener?.('abort', abort)
      sleep(15).then(() => {
        if (signal?.aborted) return
        resolve(handle(method, path, body))
      })
    })
  })
  return {
    fn,
    expenses,
    requests,
    writes: () => requests.filter((r) => r.method !== 'GET'),
    failNext: (method, path, status) => failures.push({ method, path, status }),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Open the app at `url` (as if typed into the address bar) against a fresh fake API. */
async function start(url, { server = expenseServer(), keepStorage = false } = {}) {
  if (!keepStorage) localStorage.clear()
  window.history.replaceState(null, '', url)
  window.scrollTo = () => {} // not implemented by jsdom
  vi.stubGlobal('fetch', server.fn)
  await mountApp()
  return server
}

const path = () => window.location.pathname
const heading = () => {
  const h1 = document.querySelector('h1')
  return h1 ? textOf(h1) : ''
}
const field = (name) => document.querySelector(`[name="${name}"]`)
const flash = () => document.querySelector('p.flash')
const rows = () => [...document.querySelectorAll('ul.expense-list li.expense')]
const descriptions = () => rows().map((li) => textOf(li.querySelector('a')))
const rowOfExpense = (description) => rows().find((li) => textOf(li.querySelector('a')) === description)
const statusOf = (description) => textOf(rowOfExpense(description).querySelector('.status'))
const totalsRows = () => [...document.querySelectorAll('table.category-totals tbody tr')]
const errors = () => [...document.querySelectorAll('p.error')].map(textOf).filter(Boolean)

/** Wait until the app shows `url` with this <h1>. */
async function at(url, h1) {
  await waitFor(() => {
    expect(path()).toBe(url)
    expect(heading()).toBe(h1)
  })
}

/** Click a link of the main navigation. */
async function nav(text) {
  await click(getByText('nav.main-nav a', text))
}

/** Open the list from the navigation and wait for its rows. */
async function openList() {
  await nav('Expenses')
  await at('/expenses', 'Expenses')
  await waitFor(() => expect(rows().length).toBeGreaterThan(0))
}

/** Open an expense from the list. */
async function openExpense(description) {
  await openList()
  await click(getByText('ul.expense-list a', description))
  await waitFor(() => expect(heading()).toBe(description))
}

it("project: the project's own tests pass", () => {
  const r = runProjectTests()
  expect(r.failures).toEqual([])
  expect(r.failed).toBe(0)
  expect(r.total).toBeGreaterThanOrEqual(3)
}, 240000)
