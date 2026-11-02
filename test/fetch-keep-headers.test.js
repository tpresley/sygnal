// @vitest-environment jsdom
// Sift friction (7.2, item 5): `keepHeaders: [name, …]` on a resource (or cached) request. The
// resource state gets `headers: { lowercased name: value | null }` next to `data` on 'success',
// kept with data on refetches / keepPrevious / errors, cleared by a key change. The query cache
// stores them with the entry: cache hits, dehydrate / hydrate, renderToString, set(q, data, h).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { renderToString } from '../src/extra/ssr.js'
import { queryCache } from '../src/extra/queryCache.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  vi.restoreAllMocks()
  _resetDiagnostics()
})

const reply = (body, headers = {}, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const Report = (extra = {}) => {
  const C = ({ state }) => h('p', null, `${state.report.status}:${state.report.data?.total ?? ''}@${state.report.headers?.['x-computed-at'] ?? ''}`)
  C.initialState = { id: 1 }
  C.resources = { report: (s) => ({ url: `/api/report/${s.id}`, keepHeaders: ['X-Computed-At', 'X-Missing'], ...extra }) }
  C.model = { REFRESH: { HTTP: () => ({ refresh: 'report' }) }, NEXT: (s) => ({ ...s, id: s.id + 1 }) }
  return C
}

describe('keepHeaders on a resource', () => {
  it("'success' carries the kept headers (lowercased, null when absent); the view can read them", async () => {
    t = renderComponent(Report())
    await t.respond('HTTP', reply({ total: 3 }, { 'X-Computed-At': '10:00', 'X-Other': 'no' }), 'report')
    expect(t.state.report).toMatchObject({ status: 'success', data: { total: 3 } })
    expect(t.state.report.headers).toEqual({ 'x-computed-at': '10:00', 'x-missing': null })
    expect(t.html()).toContain('success:3@10:00')
  })

  it('a refetch keeps them until its reply; a failed refetch keeps them; a key change clears them', async () => {
    t = renderComponent(Report())
    await t.respond('HTTP', reply({ total: 3 }, { 'X-Computed-At': '10:00' }), 'report')
    await t.simulateAction('REFRESH')
    expect(t.state.report).toMatchObject({ refreshing: true, headers: { 'x-computed-at': '10:00' } })
    await t.fail('HTTP', 500, 'report')
    expect(t.state.report).toMatchObject({ status: 'error', data: { total: 3 }, headers: { 'x-computed-at': '10:00' } })
    await t.simulateAction('REFRESH')
    await t.respond('HTTP', reply({ total: 4 }, { 'X-Computed-At': '11:00' }), 'report')
    expect(t.state.report.headers['x-computed-at']).toBe('11:00')
    await t.simulateAction('NEXT')
    expect(t.state.report.status).toBe('loading')
    expect(t.state.report.headers).toBeUndefined()
  })

  it('keepPrevious keeps them with the data until the new page arrives', async () => {
    t = renderComponent(Report({ keepPrevious: true }))
    await t.respond('HTTP', reply({ total: 3 }, { 'X-Computed-At': '10:00' }), 'report')
    await t.simulateAction('NEXT')
    expect(t.state.report).toMatchObject({ data: { total: 3 }, refreshing: true, headers: { 'x-computed-at': '10:00' } })
  })

  it('a resource without keepHeaders has no headers field', async () => {
    t = renderComponent(Report({ keepHeaders: undefined }))
    await t.respond('HTTP', reply({ total: 3 }, { 'X-Computed-At': '10:00' }), 'report')
    expect('headers' in t.state.report).toBe(false)
  })

  it('keepHeaders is part of the identity: changing it refetches', async () => {
    const C = Report()
    C.resources = { report: (s) => ({ url: '/api/report', keepHeaders: s.id > 1 ? ['ETag'] : ['X-Computed-At'] }) }
    t = renderComponent(C)
    await t.respond('HTTP', reply({ total: 1 }), 'report')
    await t.simulateAction('NEXT')
    expect(t.state.report.status).toBe('loading')
    expect(t.requests('HTTP')).toHaveLength(2)
  })
})

describe('keepHeaders with the query cache', () => {
  it('the entry stores them (listed by t.cache, in the key); a cache hit shows them at once', async () => {
    const cache = queryCache({ gcTime: Infinity, staleTime: 60000 })
    t = renderComponent(Report(), { http: { cache } })
    await t.respond('HTTP', reply({ total: 3 }, { 'X-Computed-At': '10:00' }), 'report')
    expect(t.cache('HTTP')).toMatchObject([{ key: 'GET /api/report/1 headers:x-computed-at,x-missing', headers: { 'x-computed-at': '10:00', 'x-missing': null } }])
    t.dispose()
    t = renderComponent(Report(), { http: { cache } })
    await t.waitForState((s) => s.report?.status === 'success')
    expect(t.state.report).toMatchObject({ data: { total: 3 }, headers: { 'x-computed-at': '10:00' } })
    expect(t.requests('HTTP')).toHaveLength(0)
  })

  it('dehydrate / hydrate / queryCache({ initial }) and renderToString carry them', async () => {
    const server = queryCache()
    server.set({ url: '/api/report/1', keepHeaders: ['X-Computed-At', 'X-Missing'] }, { total: 9 }, new Headers({ 'X-Computed-At': '09:00' }))
    const snap = server.dehydrate()
    expect(snap).toMatchObject([{ data: { total: 9 }, headers: { 'x-computed-at': '09:00', 'x-missing': null } }])
    const html = renderToString(Report(), { cache: server })
    expect(html).toContain('success:9@09:00')
    const client = queryCache({ initial: JSON.parse(JSON.stringify(snap)), staleTime: 60000 })
    t = renderComponent(Report(), { http: { cache: client } })
    await t.waitForState((s) => s.report?.status === 'success')
    expect(t.state.report.headers).toEqual({ 'x-computed-at': '09:00', 'x-missing': null })
  })

  it('an updates: write keeps the entry headers', async () => {
    const cache = queryCache()
    const C = Report()
    C.model = { ...C.model, SAVE: { HTTP: () => ({ url: '/api/report/1', method: 'PUT', json: {}, ok: 'SAVED', updates: 'report' }) }, SAVED: (s) => s }
    t = renderComponent(C, { http: { cache } })
    await t.respond('HTTP', reply({ total: 3 }, { 'X-Computed-At': '10:00' }), 'report')
    await t.simulateAction('SAVE')
    await t.respond('HTTP', { total: 5 }, 'SAVED')
    expect(t.state.report).toMatchObject({ data: { total: 5 }, headers: { 'x-computed-at': '10:00' } })
    expect(t.cache('HTTP')[0]).toMatchObject({ data: { total: 5 }, headers: { 'x-computed-at': '10:00' } })
  })

  it('the ok action still gets the body', async () => {
    const C = ({ state }) => h('p', null, String(state.got?.total ?? ''))
    C.initialState = {}
    C.model = {
      LOAD: { HTTP: () => ({ url: '/api/x', keepHeaders: ['X-A'], ok: 'GOT' }) },
      GOT: (s, body) => ({ ...s, got: body }),
    }
    t = renderComponent(C)
    await t.simulateAction('LOAD')
    await t.respond('HTTP', reply({ total: 2 }, { 'X-A': '1' }), 'GOT')
    expect(t.state.got).toEqual({ total: 2 })
  })
})
