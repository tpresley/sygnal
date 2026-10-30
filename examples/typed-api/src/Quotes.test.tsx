import { describe, it, expect } from 'vitest'
import { renderComponent, makeFetchDriver, makeSocketDriver } from 'sygnal'
import { fixture, errorFixture } from 'sygnal/api'
import { Quotes } from './Quotes'
import { api } from './api'
import { makeHandler } from '../server/handler'
import { makeRouter } from '../server/router'

// a quote as the server has it (addedAt a Date); fixture() returns it as JSON delivers it
const quote = (id: number, text: string, tag = 'calm') => ({ id, text, tag, addedAt: new Date(id * 1000) })

describe('Quotes with the renderComponent fakes', () => {
  it('lists, adds, shows a typed error and a live event', async () => {
    const t = renderComponent(Quotes)
    await t.ready()
    // the endpoint is the target; the fixture is checked against the contract's output schema
    await t.respond('HTTP', fixture(api.quotes.list, [quote(1, 'Start where you are.')]), api.quotes.list)
    expect(t.queryAll('.list li')).toHaveLength(1)

    await t.simulateEvent('.draft', 'input', { value: 'Less, but better.' })
    await t.simulateEvent('.add-form', 'submit')
    expect(t.requests('HTTP').at(-1)).toMatchObject({ url: '/api/quotes', method: 'POST', json: { text: 'Less, but better.', tag: 'calm' } })
    await t.respond('HTTP', fixture(api.quotes.add, quote(2, 'Less, but better.')), api.quotes.add)
    expect(t.state.message).toBe('Added #2')

    await t.simulateEvent('.draft', 'input', { value: 'Less, but better.' })
    await t.simulateEvent('.add-form', 'submit')
    const dup = errorFixture(api.quotes.add, 'DUPLICATE', { id: 2 }, 'That quote is already here')
    await t.fail('HTTP', dup.status, { request: api.quotes.add, body: dup.body })
    expect(t.state.message).toBe('That quote is already here (#2)')

    await t.push('WS', fixture(api.quotes.feed, quote(3, 'Done is done.')), api.quotes.feed)
    expect(t.state.live.map((q) => q.id)).toEqual([3])
    t.dispose()
  })

  it('a fixture that drifted from the contract fails the test', () => {
    // @ts-expect-error addedAt is missing (the compiler sees it too)
    expect(() => fixture(api.quotes.add, { id: 1, text: 'x', tag: 'calm' })).toThrow(/does not match the contract/)
  })
})

describe('Quotes against the real oRPC server, in-process', () => {
  const until = async (cond: () => boolean, ms = 2000) => {
    const end = Date.now() + ms
    while (!cond()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 5)) }
  }
  const setup = (handle = makeHandler(makeRouter().router)) => {
    const fetch = (url: any, init?: any) => handle(new Request(new URL(String(url), 'http://localhost'), init))
    return renderComponent(Quotes, { drivers: { HTTP: makeFetchDriver({ fetch }), WS: makeSocketDriver({ fetch }) } })
  }

  it('the whole flow: list, add, invalidation, the feed, validation, duplicates, delete', async () => {
    const t = setup()
    await until(() => t.state.quotes.status === 'success')
    await new Promise((r) => setTimeout(r, 20))   // the feed is open

    await t.simulateAction('TYPE', 'Less, but better.')
    await t.simulateAction('ADD')
    await until(() => t.state.message === 'Added #2')
    await until(() => t.state.quotes.data?.length === 2)
    await until(() => t.state.live.length === 1)
    expect(t.state.live[0].addedAt).toMatch(/^\d{4}-\d\d-\d\dT/)   // a Date on the server, a string here

    await t.simulateAction('TYPE', 'less, BUT better.')      // ADDED cleared the draft
    await t.simulateAction('ADD')
    await until(() => t.state.message === 'That quote is already here (#2)')
    await t.simulateAction('TYPE', 'no')
    await t.simulateAction('ADD')
    await until(() => t.state.message === 'Write at least 3 characters')

    await t.simulateAction('REMOVE', 2)
    await until(() => t.state.message === 'Removed')
    await until(() => t.state.quotes.data?.length === 1)
    t.dispose()
  })

  it('an out-of-date client is told to reload', async () => {
    const handle = makeHandler(makeRouter().router)
    const stale = (r: Request) => { r.headers.set('x-api-contract', 'an-old-hash'); return handle(r) }
    const t = setup(stale)
    await until(() => t.state.quotes.status === 'error')
    await t.simulateAction('TYPE', 'Fresh')
    await t.simulateAction('ADD')
    await until(() => t.state.message === 'The app was updated: reload the page.')
    t.dispose()
  })
})
