// Over a real port: @hono/node-server, Node's fetch, the real drivers with a baseUrl.
// Plus the handler's security rules (Option E of RESEARCH-network-calls).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { serve } from '@hono/node-server'
import { renderComponent, makeFetchDriver, makeSocketDriver } from 'sygnal'
import { Quotes } from '../app/Quotes.tsx'
import { makeApp } from '../app/server.ts'

let server: any, base = ''
beforeAll(async () => {
  await new Promise<void>((r) => { server = serve({ fetch: makeApp().fetch, port: 0, hostname: '127.0.0.1' }, (info) => { base = `http://127.0.0.1:${info.port}`; r() }) })
})
afterAll(() => new Promise((r) => server.close(r)))

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms
  while (!cond()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)) }
}

describe('over HTTP', () => {
  it('the component round-trips list, add and feed', async () => {
    const fetch = globalThis.fetch.bind(globalThis)
    const t = renderComponent(Quotes, { drivers: { HTTP: makeFetchDriver({ baseUrl: base, fetch }), WS: makeSocketDriver({ baseUrl: base, fetch }) } })
    await until(() => t.state.quotes.status === 'success')
    await t.simulateAction('TYPE', 'Over the wire.')
    await t.simulateAction('ADD')
    await until(() => t.state.live.some((q) => q.text === 'Over the wire.'))
    await until(() => t.state.quotes.data?.length === 2)
    t.dispose()
  })

  const rpc = (path: string, init: RequestInit = {}) => fetch(base + path, init)
  const H = { 'x-sygnal-rpc': '1', 'content-type': 'application/json' }

  it('rejects calls without the RPC header, the wrong method, foreign origins, bad input', async () => {
    expect((await rpc('/rpc/addQuote', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status).toBe(403)
    expect((await rpc('/rpc/addQuote', { headers: H })).status).toBe(405)
    expect((await rpc('/rpc/addQuote', { method: 'POST', body: '{"text":"abc","tag":"x"}', headers: { ...H, origin: 'https://evil.example' } })).status).toBe(403)
    const bad = await rpc('/rpc/addQuote', { method: 'POST', body: '{"text":1}', headers: H })
    expect(bad.status).toBe(400)
    expect((await bad.json()).issues.length).toBeGreaterThan(0)
    expect((await rpc('/rpc/nope', { headers: H })).status).toBe(404)
    expect((await rpc('/rpc/__proto__', { headers: H })).status).toBe(404)
    expect((await rpc('/rpc/listQuotes?input=not-json', { headers: H })).status).toBe(400)
  })
})
