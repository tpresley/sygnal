// PLAN-2 E2: makeFetchDriver() and the renderComponent fakes (t.requests / t.respond / t.fail)
import xs from 'xstream'
import { makeFetchDriver, renderComponent } from 'sygnal'
import type { FetchRequest, FetchResponse, FetchError, FetchSource, FakeReplyOptions } from 'sygnal'

const driver = makeFetchDriver({ baseUrl: '/api', headers: { A: 'b' }, latest: true, timeoutMs: 1000, parse: 'json' })
const source: FetchSource = driver(xs.of<FetchRequest>(
  '/ping',
  { url: '/s', category: 'search', query: { q: 'x', page: 2, skip: null }, latest: true },
  { url: '/save', json: { a: 1 }, init: { credentials: 'include', cache: 'no-store' }, parse: (res: Response) => res.status },
  { url: '/t', query: { tag: ['a', 'b'] }, headers: new Headers({ A: 'b' }), id: 7 },
  { category: 'search', abort: true },
))
source.select('search').map((r: FetchResponse) => [r.category, r.value, r.status, r.request])
source.errors((f: FetchError) => f.status === 404).map(f => [f.error, f.body])
makeFetchDriver({ init: { credentials: 'include' } })
// @ts-expect-error credentials is 'omit' | 'same-origin' | 'include'
makeFetchDriver({ init: { credentials: 'all' } })
// @ts-expect-error parse is a known mode or a function
makeFetchDriver({ parse: 'xml' })
// @ts-expect-error a request needs a url (or abort: true)
export const noUrl: FetchRequest = { category: 'x' }

function Quote() { return null as any }
const t = renderComponent(Quote)
const sent: any[] = t.requests('HTTP')
t.respond('HTTP', { text: 'hi' })
t.respond('HTTP', [], 'search')
const opts: FakeReplyOptions = { category: 'search', request: sent[0], status: 201 }
t.respond('HTTP', 1, opts)
t.fail('HTTP', 404)
t.fail('HTTP', new Error('x'), { request: null, body: { e: 1 } })
// @ts-expect-error the sink name is required
t.respond()
