// sygnal/api (dev preview): types inferred from an oRPC contract, openapi-typescript `paths` and a
// Hono app's routes; the canonical component form with Output<typeof api.x> / ApiFailure.
import { z } from 'zod'
import { oc, eventIterator } from '@orpc/contract'
import { Hono } from 'hono'
import type { ExtractSchema } from 'hono/types'
import type { Component, Resource, FetchRequest, FetchSource, SocketSource, Connections, ActionsOf, IntentSources } from 'sygnal'
import { orpcClient, openApiClient, honoClient, fixture, errorFixture, contractHash, contractSkew, isContractSkew, contractFetch } from 'sygnal/api'
import type { Output, Input, ApiFailure, ErrorBody, ApiRequest, ApiStream, Jsonify } from 'sygnal/api'

// ── oRPC ───────────────────────────────────────────────────────────────
const Quote = z.object({ id: z.number(), text: z.string(), at: z.date() })
const contract = {
  quotes: {
    list: oc.route({ method: 'GET', path: '/quotes' }).input(z.object({ tag: z.string().optional() })).output(z.array(Quote)),
    add: oc.route({ method: 'POST', path: '/quotes' }).input(z.object({ text: z.string() })).output(Quote)
      .errors({ DUPLICATE: { status: 409, data: z.object({ id: z.number() }) } }),
    feed: oc.route({ method: 'GET', path: '/feed' }).output(eventIterator(Quote)),
  },
  ping: oc.output(z.literal('pong')),
}
const api = orpcClient(contract, { prefix: '/api', headers: { 'x-api-contract': contractHash(contract) } })

// input is checked; an optional input may be left out
api.quotes.list({ tag: 'a' }, { ok: 'LIST', latest: true })
api.quotes.list()
api.quotes.add({ text: 'x' }, { ok: 'ADDED', error: 'FAILED', invalidates: [api.quotes.list] })
api.ping()
// @ts-expect-error wrong input type
api.quotes.list({ tag: 1 })
// @ts-expect-error missing required input
api.quotes.add()
// @ts-expect-error no such procedure
api.quotes.remove({ id: 1 })
// @ts-expect-error a stream endpoint is no request to invalidate
api.quotes.add({ text: 'x' }, { invalidates: [api.quotes.feed] })

// outputs as JSON delivers them (Date → string)
type Q = Output<typeof api.quotes.add>
const q: Q = { id: 1, text: 't', at: '1970-01-01T00:00:00.000Z' }
// @ts-expect-error at is a string on the wire, not a Date
const qd: Q = { id: 1, text: 't', at: new Date() }
const list: Output<typeof api.quotes.list> = [q]
const ev: Output<typeof api.quotes.feed> = q           // one stream event
const pong: Output<typeof api.ping> = 'pong'
const inp: Input<typeof api.quotes.add> = { text: 'x' }
export { qd, list, ev, pong, inp }

// requests are FetchRequests / resource requests; streams are connections
const r: FetchRequest = api.quotes.add({ text: 'x' })
const rr: ApiRequest<Q> = api.quotes.add({ text: 'x' })
const conns: Connections = { feed: api.quotes.feed(undefined, { message: 'ARRIVED' }) }
const st: ApiStream<Q> = api.quotes.feed()
export { r, rr, conns, st }

// typed error bodies: declared errors by code
type AddError = ErrorBody<typeof api.quotes.add>
const errBody = (e: AddError) => (e.defined && e.code === 'DUPLICATE' ? e.data.id : e.message)
export { errBody }

// the canonical component form
type State = { draft: string; error: string; quotes: Resource<Output<typeof api.quotes.list>>; live: Q[] }
type Drivers = { HTTP: { source: FetchSource; sink: FetchRequest }; WS: { source: SocketSource; sink: any } }
const intent = ({ DOM }: IntentSources<State, Drivers>) => ({ TYPE: DOM.input('.draft').value(), ADD: DOM.click('.add') })
type Actions = ActionsOf<typeof intent> & {
  ADDED: Output<typeof api.quotes.add>
  FAILED: ApiFailure<typeof api.quotes.add>
  ARRIVED: Output<typeof api.quotes.feed>
}
const Quotes: Component<State, {}, Drivers, Actions> = ({ state }) => <ul>{state.quotes.status === 'success' && state.quotes.data.map((x) => <li>{x.text}</li>)}</ul>
Quotes.intent = intent
Quotes.resources = { quotes: (state) => api.quotes.list({ tag: state.draft || undefined }) }
Quotes.connections = () => ({ feed: api.quotes.feed(undefined, { message: 'ARRIVED' }) })
Quotes.model = {
  TYPE: (state, draft) => ({ ...state, draft }),
  ADD: { HTTP: (state) => api.quotes.add({ text: state.draft }, { ok: 'ADDED', error: 'FAILED' }) },
  ADDED: (state, quote) => ({ ...state, error: `#${quote.id} at ${quote.at.slice(0, 4)}` }),
  FAILED: (state, { status, body }) => ({
    ...state,
    error: isContractSkew({ status, body }) ? 'reload' : body?.defined && body.code === 'DUPLICATE' ? `dup of ${body.data.id}` : body?.message ?? String(status),
  }),
  ARRIVED: (state, quote) => ({ ...state, live: [...state.live, quote] }),
}
const Bad: Component<State, {}, Drivers, Actions> = () => <div />
Bad.model = {
  // @ts-expect-error quote.id is a number
  ADDED: (state, quote) => ({ ...state, error: quote.id.toUpperCase() }),
}

// fixtures are typed by the endpoint
// the server's value (a Date), returned as JSON delivers it (a string)
const fx: { at: string } = fixture(api.quotes.add, { id: 1, text: 't', at: new Date(0) })
// @ts-expect-error a fixture with the wrong shape
fixture(api.quotes.add, { id: '1', text: 't', at: new Date(0) })
export { fx }
const e = errorFixture(api.quotes.add, 'DUPLICATE', { id: 1 })
const code: 'DUPLICATE' = e.body.code
// @ts-expect-error not a declared error of this endpoint
errorFixture(api.quotes.add, 'GONE')
export { code }

// skew helpers
const res: Response | undefined = contractSkew(new Request('http://x'), { hash: 'h', header: 'x-api-contract' })
const f: (i: any, init?: any) => Promise<Response> = contractFetch({ onSkew: ({ server }) => void server })
export { res, f }

// ── openapi-typescript `paths` (the shape openapi-typescript 7 generates) ──
interface paths {
  '/quotes': {
    parameters: { query?: never; header?: never; path?: never; cookie?: never }
    get: {
      parameters: { query?: { tag?: string; tags?: string[] }; header?: never; path?: never; cookie?: never }
      requestBody?: never
      responses: { 200: { headers: { [name: string]: unknown }; content: { 'application/json': { id: number; text: string }[] } } }
    }
    post: {
      parameters: { query?: never; header?: never; path?: never; cookie?: never }
      requestBody: { content: { 'application/json': { text: string } } }
      responses: {
        201: { headers: { [name: string]: unknown }; content: { 'application/json': { id: number; text: string } } }
        409: { headers: { [name: string]: unknown }; content: { 'application/json': { message: string } } }
      }
    }
    put?: never
  }
  '/quotes/{id}': {
    get: {
      parameters: { query?: never; header?: never; path: { id: number }; cookie?: never }
      requestBody?: never
      responses: { 200: { headers: { [name: string]: unknown }; content: { 'application/json': { id: number; text: string } } }; 404: { headers: { [name: string]: unknown }; content?: never } }
    }
  }
}
const http = openApiClient<paths>({ prefix: '/api' })
const getQuote = http.get('/quotes/{id}')
const listQuotes = http.get('/quotes')
const addQuote = http.post('/quotes')
getQuote({ params: { path: { id: 1 } } }, { ok: 'GOT' })
listQuotes()
listQuotes({ params: { query: { tags: ['a'] } } })
addQuote({ body: { text: 'x' } }, { ok: 'ADDED', invalidates: [listQuotes] })
// @ts-expect-error the path parameter is required
getQuote()
// @ts-expect-error id is a number
getQuote({ params: { path: { id: '1' } } })
// @ts-expect-error body is required
addQuote({})
// @ts-expect-error no such path
http.get('/nope')
// @ts-expect-error no PUT on /quotes
http.put('/quotes')
const got: Output<typeof getQuote> = { id: 1, text: 't' }
const added: Output<typeof addQuote> = { id: 1, text: 't' }
const addErr: ErrorBody<typeof addQuote> = { message: 'dup' }
// @ts-expect-error the reply is one quote, not a list
const wrong: Output<typeof getQuote> = [{ id: 1, text: 't' }]
export { got, added, addErr, wrong }
const sse = http.sse<{ id: number }>('/quotes')
const evs: Output<typeof sse> = { id: 1 }
export { evs }

// ── Hono ────────────────────────────────────────────────────────────────
const app = new Hono()
  .get('/api/quotes/:id', (c) => c.json({ id: Number(c.req.param('id')), text: 't' }, 200))
  .post('/api/quotes', async (c) => c.json({ id: 2, text: 'x' }, 201))
const hono = honoClient<ExtractSchema<typeof app>>()
const hq = hono.get('/api/quotes/:id')
hq({ param: { id: '1' } }, { ok: 'GOT' })
// @ts-expect-error param is required
hq({})
// @ts-expect-error no such route
hono.get('/api/nope')
const hout: Output<typeof hq> = { id: 1, text: 't' }
// @ts-expect-error text is a string
const hbad: Output<typeof hq> = { id: 1, text: 2 }
const hadd: Output<ReturnType<typeof hono.post<'/api/quotes'>>> = { id: 1, text: 'x' }
export { hout, hbad, hadd }

// Jsonify
type J = Jsonify<{ a: Date; b: () => void; c: { d: Date[] } }>
const j: J = { a: 's', c: { d: ['s'] } }
export { j }

// ── function-first (*.server.ts) ────────────────────────────────────────
import { query, mutation, stream, serverFunctions } from 'sygnal/api'

declare module 'sygnal/api' { interface ServerContext { user?: { name: string } } }

const fnSuggest = query(z.object({ tag: z.string() }), async ({ tag }, { context, errors }) => {
  if (!tag) throw errors.NO_IDEAS({ data: { tag } })
  return { text: tag + (context.user?.name ?? ''), at: new Date() }
}, { errors: { NO_IDEAS: { status: 404, data: z.object({ tag: z.string() }) } } })
fnSuggest({ tag: 'a' }, { ok: 'SUGGESTED', error: 'NO_IDEA', invalidates: [fnSuggest] })
// @ts-expect-error tag is a string
fnSuggest({ tag: 1 })
// @ts-expect-error the input is required
fnSuggest()
const fnOut: Output<typeof fnSuggest> = { text: 't', at: '1970-01-01T00:00:00.000Z' }
const fnErr = (e: ErrorBody<typeof fnSuggest>) => (e.defined && e.code === 'NO_IDEAS' ? e.data.tag : e.message)
const fnFx: { at: string } = fixture(fnSuggest, { text: 't', at: new Date(0) })
const fnReq: FetchRequest = fnSuggest({ tag: 'a' })
export { fnOut, fnErr, fnFx, fnReq }

const fnCount = query(() => 3)
fnCount()
const fnN: Output<typeof fnCount> = 3
// @ts-expect-error an undeclared error code
query(z.string(), (_s, { errors }) => { throw errors.NOPE() })
const fnDouble = mutation(z.object({ n: z.number() }), ({ n }) => n * 2)
// @ts-expect-error n is a number
fnDouble({ n: '2' })
const fnTicks = stream(async function* () { yield { i: 1 } })
const fnConns: Connections = { ticks: fnTicks(undefined, { message: 'TICK' }) }
const fnTick: Output<typeof fnTicks> = { i: 1 }
// @ts-expect-error a stream is no request to invalidate
fnDouble({ n: 1 }, { invalidates: [fnTicks] })
export { fnN, fnConns, fnTick }

const fns = serverFunctions({ '/src/x.server.ts': { fnSuggest } }, { os: {} })
const fnSkew: Response | undefined = fns.skew(new Request('http://x'))
const fnHashes: Record<string, string> = fns.hashes
export { fnSkew, fnHashes }
