// The component against renderComponent's built-in fakes: no server at all. The requests are
// plain data, so the test reads them; replies come back through the same fakes as any request.
import { describe, it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { Quotes } from '../app/Quotes.tsx'
import { contract } from '../app/api.ts'
import { fixture } from '../lib/testing.ts'

describe('Quotes with the fakes', () => {
  it('loads, adds, and hears the feed', async () => {
    const t = renderComponent(Quotes)
    await t.ready()
    // the resource: a GET of the procedure, input in the query string
    expect(t.requests('HTTP')[0]).toMatchObject({ url: '/rpc/listQuotes', query: { input: '{"tag":"calm"}' } })
    await t.respond('HTTP', fixture(contract.listQuotes, [{ id: 1, text: 'Start where you are.', tag: 'calm' }]), 'quotes')
    expect(t.state.quotes.status).toBe('success')

    // the mutation: a POST with reply actions
    await t.simulateAction('TYPE', 'Less, but better.')
    await t.simulateAction('ADD')
    const add = t.requests('HTTP').at(-1)
    expect(add).toMatchObject({ url: '/rpc/addQuote', method: 'POST', json: { text: 'Less, but better.', tag: 'calm' }, ok: 'ADDED', error: 'FAILED' })
    await t.respond('HTTP', fixture(contract.addQuote, { id: 2, text: 'Less, but better.', tag: 'calm' }), 'ADDED')
    expect(t.state.error).toBe('Added #2')

    // the stream: an SSE connection; a pushed event is the ARRIVED action
    expect(t.connections('WS')[0]).toMatchObject({ name: 'feed', sse: '/rpc/quoteFeed?input=%7B%22tag%22%3A%22calm%22%7D', message: 'ARRIVED' })
    await t.push('WS', { id: 3, text: 'Done is done.', tag: 'calm' }, 'feed')
    expect(t.state.live.map((q) => q.id)).toEqual([3])
    t.dispose()
  })

  it('a fixture that drifted from the contract fails the test', () => {
    // @ts-expect-error the compiler sees it too
    expect(() => fixture(contract.addQuote, { id: '2', text: 'x' })).toThrow(/does not match the contract/)
  })
})
