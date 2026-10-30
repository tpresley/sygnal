// The component against the real server implementation, in-process: the real fetch and socket
// drivers with a fetch() that calls the Hono app directly. No port, no mocks of the backend.
import { describe, it, expect } from 'vitest'
import { renderComponent, makeFetchDriver, makeSocketDriver } from 'sygnal'
import { Quotes } from '../app/Quotes.tsx'
import { makeApp, makeStore } from '../app/server.ts'

const until = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms
  while (!cond()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)) }
}

function setup() {
  const store = makeStore()
  const app = makeApp(store.impl)
  const fetch = async (url: any, init?: any) => app.fetch(new Request(new URL(String(url), 'http://localhost'), init))
  const t = renderComponent(Quotes, { drivers: { HTTP: makeFetchDriver({ fetch }), WS: makeSocketDriver({ fetch }) } })
  return { t, store }
}

describe('Quotes against the real server, in-process', () => {
  it('loads, adds (invalidating the list) and hears the feed', async () => {
    const { t, store } = setup()
    await until(() => t.state.quotes.status === 'success')
    expect(t.state.quotes.data!.map((q) => q.text)).toEqual(['Start where you are.'])

    await t.simulateAction('TYPE', 'Less, but better.')
    await t.simulateAction('ADD')
    await until(() => t.state.error === 'Added #2')
    expect(store.quotes).toHaveLength(2)
    // invalidates: ['listQuotes'] refetched the resource
    await until(() => t.state.quotes.data?.length === 2)
    // the stream: the server's generator yielded the new quote
    await until(() => t.state.live.length === 1)
    expect(t.state.live[0]).toMatchObject({ id: 2, tag: 'calm' })
    t.dispose()
  })

  it('server-side validation and errors reach the error action', async () => {
    const { t } = setup()
    await until(() => t.state.quotes.status === 'success')
    await t.simulateAction('TYPE', 'no')            // text: min(3)
    await t.simulateAction('ADD')
    await until(() => t.state.error !== '')
    expect(t.state.error).toMatch(/3/)
    await t.simulateAction('TYPE', 'Start where you are.')   // a 409 ApiError
    await t.simulateAction('ADD')
    await until(() => t.state.error === 'That quote is already here')
    t.dispose()
  })
})
