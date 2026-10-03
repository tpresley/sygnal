// PLAN-3 5-7 finding: a resource function that returns '' (`state.q && …` with an empty query)
// fetched `{ url: '' }` instead of going idle; falsy means idle.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'

let t
afterEach(() => { t?.dispose(); t = null })

describe("resources: '' is idle", () => {
  it('an empty-string request sends nothing and stays idle', async () => {
    function Search({ state }) { return h('p', null, state.hits.status) }
    Search.initialState = { q: '' }
    Search.resources = { hits: (state) => state.q && `/api/search?q=${state.q}` }
    t = renderComponent(Search)
    await t.ready()
    await t.settle()
    expect(t.requests('HTTP')).toEqual([])
    expect(t.state.hits.status).toBe('idle')
  })
})

describe('t.respond right after the state change that fetches a resource (5-7)', () => {
  it('waits for the fetch instead of throwing', async () => {
    function Quote({ state }) { return h('p', { className: 'q' }, state.quote.data?.text ?? state.quote.status) }
    Quote.initialState = { id: 1 }
    Quote.resources = { quote: (state) => `/api/quotes/${state.id}` }
    Quote.intent = ({ DOM }) => ({ NEXT: DOM.click('.q') })
    Quote.model = { NEXT: (state) => ({ ...state, id: state.id + 1 }) }
    t = renderComponent(Quote)
    await t.ready()
    await t.respond('HTTP', { text: 'one' }, 'quote')
    t.simulateAction('NEXT')
    await t.respond('HTTP', { text: 'two' }, 'quote')          // no settle in between
    expect(t.state.quote.data).toEqual({ text: 'two' })
    expect(t.requests('HTTP').map(r => r.url)).toEqual(['/api/quotes/1', '/api/quotes/2'])
  })

  it('still throws at the call for a name that is not a declared resource and not pending', async () => {
    function Quote({ state }) { return h('p', null, state.quote.status) }
    Quote.initialState = { id: 1 }
    Quote.resources = { quote: (state) => `/api/quotes/${state.id}` }
    t = renderComponent(Quote)
    await t.ready()
    expect(() => t.respond('HTTP', {}, 'nope')).toThrow(/no pending HTTP request/)
  })
})
