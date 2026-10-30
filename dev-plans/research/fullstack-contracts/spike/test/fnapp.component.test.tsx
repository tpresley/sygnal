// The function-first component: its import of ../fnapp/quotes.server.ts is stubbed by the
// vitest config's serverFunctions(), and the calls go to the Vite dev server of fn-dev-server.ts.
import { describe, it, expect, inject } from 'vitest'
import { renderComponent, makeFetchDriver, makeSocketDriver } from 'sygnal'
import { Quotes } from '../fnapp/Quotes.tsx'
import * as stub from '../fnapp/quotes.server.ts'

const base = inject('fnBase' as never) as string
const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms
  while (!cond()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)) }
}

describe('server functions, client side', () => {
  it('the import is the stub: calls are requests', () => {
    expect(stub.addQuote({ text: 'abc', tag: 'x' })).toMatchObject({ url: '/rpc/fnapp/quotes/addQuote', method: 'POST' })
    expect(stub.listQuotes.procedure).toBe('fnapp/quotes/listQuotes')
  })

  it('the component round-trips through the dev server, stream included', async () => {
    const fetch = globalThis.fetch.bind(globalThis)
    const t = renderComponent(Quotes, { drivers: { HTTP: makeFetchDriver({ baseUrl: base, fetch }), WS: makeSocketDriver({ baseUrl: base, fetch }) } })
    await until(() => t.state.quotes.status === 'success')
    await t.simulateAction('TYPE', 'Function first.')
    await t.simulateAction('ADD')
    await until(() => t.state.error === 'Added #2')
    await until(() => t.state.live.some((q) => q.text === 'Function first.'))
    await until(() => t.state.quotes.data?.length === 2)
    t.dispose()
  })
})
