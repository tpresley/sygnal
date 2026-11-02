// @vitest-environment jsdom
// Sift friction (7.2): the response `headers` (a Headers) on a failure: the `error` reply data
// `{ error, status, body, request, headers }`, `errors()` and the Error itself (`error.headers`,
// so a resource's `state.x.error.headers` too). On success, headers are read through `parse`.
import { describe, it, expect, afterEach, vi } from 'vitest'
import xs from 'xstream'
import { createElement as h } from '../src/pragma/index.js'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'
import { queryCache } from '../src/extra/queryCache.js'
import { renderComponent } from '../src/extra/testing.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'
import { until } from './support/wait.js'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  vi.restoreAllMocks()
  _resetDiagnostics()
})

const json = (body, status, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
function harness(respond) {
  const fetch = vi.fn(async (url) => respond(url))
  const req$ = xs.create()
  const src = makeFetchDriver({ fetch })(req$)
  const got = [], errors = []
  const sender = {}
  src.replies(sender).addListener({ next: (a) => got.push([a.type, a.data]) })
  src.errors().addListener({ next: (e) => errors.push(e) })
  const send = (r, own = true) => {
    if (own) Object.defineProperty(r, '__emitterId', { value: sender })
    req$.shamefullySendNext(r)
  }
  return { got, errors, send }
}

describe('headers on failures', () => {
  it('the error reply action gets the response headers (and error.headers)', async () => {
    const H = harness(() => json({ message: 'slow down' }, 429, { 'Retry-After': '7' }))
    H.send({ url: '/a', ok: 'OK', error: 'FAILED' })
    await until(() => expect(H.got).toHaveLength(1))
    const [type, d] = H.got[0]
    expect(type).toBe('FAILED')
    expect(d).toMatchObject({ status: 429, body: { message: 'slow down' }, request: { url: '/a' } })
    expect(d.headers).toBeInstanceOf(Headers)
    expect(d.headers.get('Retry-After')).toBe('7')
    expect(d.error.headers.get('retry-after')).toBe('7')
  })

  it('errors() gets them too', async () => {
    const H = harness(() => json({}, 503, { 'X-Request-Id': 'r1' }))
    H.send({ url: '/a', category: 'c' }, false)
    await until(() => expect(H.errors).toHaveLength(1))
    expect(H.errors[0]).toMatchObject({ category: 'c', status: 503 })
    expect(H.errors[0].headers.get('x-request-id')).toBe('r1')
  })

  it('a body that does not parse, or does not validate, carries the headers of its 2xx response', async () => {
    const H = harness((url) => new Response(url == '/a' ? 'not json' : '{}', { status: 200, headers: { 'content-type': 'application/json', 'X-Id': '9' } }))
    H.send({ url: '/a', error: 'FAILED' })
    await until(() => expect(H.got).toHaveLength(1))
    expect(H.got[0][1].headers.get('x-id')).toBe('9')
    const schema = { '~standard': { validate: () => ({ issues: [{ message: 'no' }] }) } }
    H.send({ url: '/b', error: 'FAILED', validate: schema })
    await until(() => expect(H.got).toHaveLength(2))
    expect(H.got[1][1]).toMatchObject({ status: 200, issues: [{ message: 'no' }] })
    expect(H.got[1][1].headers.get('x-id')).toBe('9')
  })

  it('a network error has no headers', async () => {
    const H = harness(() => { throw new TypeError('Failed to fetch') })
    H.send({ url: '/a', error: 'FAILED' })
    await until(() => expect(H.got).toHaveLength(1))
    expect(H.got[0][1].headers).toBeUndefined()
  })
})

// a resource whose parse reads a response header
function Report({ state }) { return h('p', null, `${state.report.status}:${state.report.data?.asOf ?? ''}`) }
Report.resources = {
  report: () => ({
    url: '/api/report',
    parse: async (res) => ({ body: await res.json(), asOf: res.headers.get('X-Computed-At') }),
  }),
}
Report.initialState = {}
Report.model = { REFRESH: { HTTP: () => ({ refresh: 'report' }) } }

describe('reading headers on success through parse', () => {
  it('a resource gets what parse returns', async () => {
    t = renderComponent(Report)
    await t.respond('HTTP', json({ total: 3 }, 200, { 'X-Computed-At': '2026-11-01T10:00:00Z' }), 'report')
    expect(t.state.report).toMatchObject({ status: 'success', data: { body: { total: 3 }, asOf: '2026-11-01T10:00:00Z' } })
  })

  it('a resource with a parse function is not cached (its key would not know the function)', async () => {
    const cache = queryCache()
    t = renderComponent(Report, { http: { cache } })
    await t.respond('HTTP', json({ total: 3 }, 200, { 'X-Computed-At': 'a' }), 'report')
    expect(t.cache('HTTP')).toEqual([])
  })
})
