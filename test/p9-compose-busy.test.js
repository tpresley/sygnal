// compose(catalog, { busy: 'queue' }): at most one composition in flight, then the newest waiting
// one (research/ai-compose/request-pacing.md). The default 'abort' starts a new one at once and the
// lane's `latest` aborts the old step, so a page that recomposes faster than its model answers
// never finishes one.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { setupChecks } from './diagnostics/helpers.js'
import { renderComponent } from '../src/extra/testing.ts'
import { composeWith, compose } from '../src/extra/ai/index.ts'
import { fromTree } from '../src/extra/ai/compose/layout.ts'
import { makeApp, catalog } from './p9-compose-app.js'
import { fakeDecisions, fakeLlm, shape } from './p9-compose-fakes.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { t?.dispose(); t = null })

const queued = (backend, extra = {}) => makeApp(backend, { uses: { page: compose(catalog, { backend, form: '.ask', prompt: '.prompt', busy: 'queue' }) }, ...extra })
const tree = (part) => JSON.stringify({ page: [{ part }] })
const prompts = () => t.requests('LLM').map((r) => r.messages[0].content.split('\n')[0])

describe("compose busy: 'queue'", () => {
  it('a COMPOSE while one is in flight waits; the newest replaces it; it starts as the one in flight lands', async () => {
    t = renderComponent(queued(fakeLlm()), { strict: true })
    t.simulateAction('page.COMPOSE', 'orders')
    await t.next((s) => s.page.status === 'composing')
    t.simulateAction('page.COMPOSE', 'tickets')
    t.simulateAction('page.COMPOSE', { prompt: 'weather', fresh: true })
    await t.next((s) => s.page.queued?.prompt === 'weather')
    expect(t.state.page.queued).toEqual({ prompt: 'weather', fresh: true })
    expect(prompts()).toEqual(['orders'])

    // the one in flight lands (DONE runs), then the waiting one starts
    await t.respond('LLM', tree('orders'), 'page.REPLY')
    await t.waitForState((s) => s.doneCount === 1)
    expect(shape(t.state.page.layout)).toEqual(['orders'])
    expect(t.state.page).toMatchObject({ status: 'composing', prompt: 'weather', queued: null })
    expect(prompts()).toEqual(['orders', 'weather'])
    // fresh: true reached the backend (no previous layout in its prompt)
    expect(t.requests('LLM')[1].messages[0].content).toBe('weather')

    await t.respond('LLM', tree('weather'), 'page.REPLY')
    await t.waitForState((s) => s.page.status === 'done' && s.doneCount === 2)
    expect(shape(t.state.page.layout)).toEqual(['weather'])
    expect(t.requests('LLM')).toHaveLength(2)
    t.expectNoDiagnostics()
  })

  it("the default 'abort' sends each one at once (the older ones aborted)", async () => {
    t = renderComponent(makeApp(fakeLlm()), { strict: true })
    t.simulateAction('page.COMPOSE', 'orders')
    t.simulateAction('page.COMPOSE', 'tickets')
    t.simulateAction('page.COMPOSE', 'weather')
    await t.next((s) => s.page.prompt === 'weather')
    expect(prompts()).toEqual(['orders', 'tickets', 'weather'])
    expect(t.state.page.queued).toBe(null)
    await composeWith(t, catalog, [{ part: 'weather' }])
    await t.waitForState((s) => s.page.status === 'done')
    expect(t.state.doneCount).toBe(1)
  })

  it('a failure while one waits: the waiting one starts (status composing, no error shown)', async () => {
    t = renderComponent(queued(fakeLlm()), { strict: true })
    t.simulateAction('page.COMPOSE', 'orders')
    await t.next((s) => s.page.status === 'composing')
    t.simulateAction('page.COMPOSE', 'tickets')
    await t.next((s) => s.page.queued)
    await t.fail('LLM', new Error('model offline'), 'page.FAILED')
    await t.waitForState((s) => s.page.prompt === 'tickets')
    expect(t.state.page).toMatchObject({ status: 'composing', error: null, queued: null })
    // a reply the backend rejects ends it too
    t.simulateAction('page.COMPOSE', 'weather')
    await t.next((s) => s.page.queued)
    await t.respond('LLM', 'not json', 'page.REPLY')
    await t.waitForState((s) => s.page.prompt === 'weather')
    expect(t.state.page.status).toBe('composing')
    await composeWith(t, catalog, [{ part: 'weather' }])
    await t.waitForState((s) => s.page.status === 'done')
    expect(prompts()).toEqual(['orders', 'tickets', 'weather'])
  })

  it('composeWith answers one composition; the queued one needs its own', async () => {
    t = renderComponent(queued(fakeDecisions()), { strict: true })
    t.simulateAction('page.COMPOSE', 'orders')
    await t.next((s) => s.page.status === 'composing')
    t.simulateAction('page.COMPOSE', 'tickets')
    await t.next((s) => s.page.queued)
    // the decisions fake takes 2 steps: both answered, then composeWith stops
    await composeWith(t, catalog, [{ part: 'orders' }])
    await t.waitForState((s) => s.doneCount === 1)
    expect(shape(t.state.page.layout)).toEqual(['orders'])
    expect(t.state.page).toMatchObject({ status: 'composing', prompt: 'tickets' })
    await composeWith(t, catalog, [{ part: 'tickets' }])
    await t.waitForState((s) => s.doneCount === 2)
    expect(shape(t.state.page.layout)).toEqual(['tickets'])
  })

  it('SET_LAYOUT ends the one in flight and drops the waiting one', async () => {
    t = renderComponent(queued(fakeLlm()), { strict: true })
    t.simulateAction('page.COMPOSE', 'orders')
    await t.next((s) => s.page.status === 'composing')
    t.simulateAction('page.COMPOSE', 'tickets')
    await t.next((s) => s.page.queued)
    t.simulateAction('page.SET_LAYOUT', { root: 'page', nodes: { page: { part: 'page', slots: { default: ['weather'] } }, weather: { part: 'weather' } } })
    await t.next((s) => s.page.status === 'done')
    expect(t.state.page).toMatchObject({ pending: null, queued: null })
    // the next COMPOSE starts at once
    t.simulateAction('page.COMPOSE', 'tickets')
    await t.next((s) => s.page.status === 'composing')
    expect(prompts()).toHaveLength(2)
  })

  it('a slice that comes back with pending (HMR, persist) has nothing in flight: a COMPOSE starts at once', async () => {
    const App = queued(fakeLlm())
    const page = { prompt: 'orders', status: 'composing', layout: null, preview: null, pending: { step: 'llm', prompt: 'orders' }, queued: null, decisions: null, error: null, ui: {}, local: {} }
    t = renderComponent(App, { strict: true, initialState: { ...App.initialState, page } })
    t.simulateAction('page.COMPOSE', 'tickets')
    await t.next((s) => s.page.prompt === 'tickets')
    expect(t.state.page.queued).toBe(null)
    expect(prompts()).toEqual(['tickets'])
  })

  it("the waiting edit starts after DONE: on the layout DONE's STATE left, the landed one 'done' first", async () => {
    const pinned = (state) => catalog.finish(fromTree(catalog, [{ part: 'weather' }]), state)
    const App = queued(fakeLlm())
    // the app's correction as a layout lands (the docs' enforcePins)
    App.model = { ...App.model, 'page.DONE': (state) => ({ ...state, seen: state.page.status, doneCount: state.doneCount + 1, page: { ...state.page, layout: pinned(state) } }) }
    t = renderComponent(App, { strict: true })
    t.simulateAction('page.COMPOSE', 'orders')
    await t.next((s) => s.page.status === 'composing')
    t.simulateAction('page.COMPOSE', 'tickets too')
    await t.next((s) => s.page.queued)
    await t.respond('LLM', tree('orders'), 'page.REPLY')
    await t.waitForState((s) => s.page.prompt === 'tickets too' && s.page.status === 'composing')
    expect(t.state.seen).toBe('done')
    // the edit's previous layout is the corrected one
    expect(t.requests('LLM')[1].messages[0].content).toBe('tickets too\n\nThe page now: ["weather","page"]')
  })

  it('a step whose request is aborted with no reply releases the queue', async () => {
    // two uses of one host in the default lane: the second one's request aborts the first one's
    const both = makeApp(fakeLlm(), { uses: {
      page: compose(catalog, { backend: fakeLlm(), busy: 'queue' }),
      side: compose(catalog, { backend: fakeLlm() }),
    } })
    t = renderComponent(both, { strict: true })
    t.simulateAction('page.COMPOSE', 'orders')
    await t.next((s) => s.page.status === 'composing')
    t.simulateAction('side.COMPOSE', 'weather')
    await t.waitForState((s) => s.page.status === 'error')
    expect(t.state.page.error).toMatch(/aborted/)
    t.simulateAction('page.COMPOSE', 'tickets')
    await t.next((s) => s.page.prompt === 'tickets')
    expect(t.state.page).toMatchObject({ status: 'composing', queued: null })
    t.dispose()

    // the app aborts the lane: the waiting one starts when the request's timeout ends
    const b = fakeLlm(), start = b.start
    b.start = (a) => { const r = start(a); r.request.timeoutMs = 50; return r }
    t = renderComponent(queued(b), { strict: true })
    t.simulateAction('page.COMPOSE', 'orders')
    await t.next((s) => s.page.status === 'composing')
    t.simulateAction('page.COMPOSE', 'tickets')
    await t.next((s) => s.page.queued)
    await t.waitForState((s) => s.page.prompt === 'tickets' && s.page.status === 'composing')
    expect(t.state.page).toMatchObject({ queued: null, error: null })
    expect(prompts()).toEqual(['orders', 'tickets'])
    await composeWith(t, catalog, [{ part: 'tickets' }])
    await t.waitForState((s) => s.page.status === 'done')
    expect(shape(t.state.page.layout)).toEqual(['tickets'])
  })

  it('busy takes abort or queue (SYG681)', () => {
    expect(() => compose(catalog, { backend: fakeLlm(), busy: 'debounce' })).toThrow(/SYG681.*busy/)
  })
})
