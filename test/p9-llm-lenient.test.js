// PLAN-9 B-3 open issue (non-JSON replies): compose.llm()'s requests carry `parse: false`, so the
// chat driver sends the schema but doesn't read the reply; the text reaches the backend's lenient
// reader and repair. Prose around the JSON and a code fence compose; garbage is status 'error' with
// SYG683 (the layout kept), never FAILED from the driver. For other callers the driver is unchanged:
// a request with `output` and no `parse: false` still fails on text that isn't JSON. No network.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { jsonSchema } from '../src/extra/ai/schema/jsonSchema.ts'
import { compose } from '../src/extra/ai/index.ts'
import { makeApp, catalog } from './p9-compose-app.js'
import { shape } from './p9-compose-fakes.js'

let t
afterEach(() => { t?.dispose(); t = null })

const JSON1 = '{"asked_for":["the weather","the tickets"],"children":[{"part":"weather"},{"part":"tickets"}]}'

async function compose1(text, prompt = 'the weather, then the tickets') {
  t.simulateAction('page.COMPOSE', prompt)
  await t.next((s) => s.page.status === 'composing')
  expect(t.requests('LLM').at(-1).parse).toBe(false)
  await t.respond('LLM', text, 'page.REPLY')
  await t.waitForState((s) => s.page.status !== 'composing')
}

describe('compose.llm(): replies that are not strict JSON', () => {
  it('prose around the JSON composes', async () => {
    t = renderComponent(makeApp(compose.llm()), { diagnostics: 'collect' })
    await compose1(`Sure! Here is the page:\n${JSON1}\nLet me know if you want changes.`)
    expect(t.state.page.status).toBe('done')
    expect(shape(t.state.page.layout)).toEqual(['weather', 'tickets'])
    expect(t.diagnostics.filter((d) => d.code === 'SYG683')).toEqual([])
  })

  it('a code fence composes (also a think block before it)', async () => {
    t = renderComponent(makeApp(compose.llm()), { diagnostics: 'collect' })
    await compose1('<think>the user wants two parts</think>\n```json\n' + JSON1 + '\n```')
    expect(shape(t.state.page.layout)).toEqual(['weather', 'tickets'])
  })

  it('an edit reply in prose applies too', async () => {
    t = renderComponent(makeApp(compose.llm()), { diagnostics: 'collect' })
    await compose1(JSON1)
    await compose1('Moving the tickets up: {"ops":[{"op":"move","node":"n2","where":"top"}]}', 'Tickets first')
    expect(shape(t.state.page.layout)).toEqual(['tickets', 'weather'])
  })

  it('garbage: status error with SYG683, the layout kept, no FAILED from the driver', async () => {
    t = renderComponent(makeApp(compose.llm()), { diagnostics: 'collect' })
    await compose1(JSON1)
    const before = t.state.page.layout
    await compose1('Sorry, I cannot help with that.', 'the stock price')
    expect(t.state.page).toMatchObject({ status: 'error', pending: null, preview: null })
    expect(t.state.page.error).toMatch(/not a layout \(not JSON: Sorry, I cannot help with that\.\)/)
    expect(t.state.page.layout).toBe(before)
    const d = t.diagnostics.filter((x) => x.code === 'SYG683')
    expect(d).toHaveLength(1)
    expect(d[0].message).toMatch(/not JSON/)
  })
})

describe('the chat driver for other callers', () => {
  function Host({ state }) { return h('p', null, state.status) }
  Host.initialState = { status: 'idle', value: null, text: null }
  const output = jsonSchema({ type: 'object', properties: { n: { type: 'number' } }, required: ['n'] })
  Host.model = {
    ASK: { LLM: (_s, parse) => ({ messages: [{ role: 'user', content: 'n?' }], output, ok: 'OK', error: 'ERR', ...(parse === false && { parse: false }) }) },
    OK: (s, r) => ({ ...s, status: 'ok', value: r.value ?? null, text: r.text }),
    ERR: (s, e) => ({ ...s, status: 'failed', text: e.error.message }),
  }

  it('without parse: false, text that is not JSON is the error reply (unchanged)', async () => {
    t = renderComponent(Host)
    t.simulateAction('ASK')
    await t.settle()
    await t.respond('LLM', 'n is 3')
    expect(t.state).toMatchObject({ status: 'failed', text: expect.stringMatching(/not JSON/) })
    t.simulateAction('ASK')
    await t.settle()
    await t.respond('LLM', '{"n": 3}')
    expect(t.state).toMatchObject({ status: 'ok', value: { n: 3 } })
  })

  it('with parse: false, ok has the text and no value', async () => {
    t = renderComponent(Host)
    t.simulateAction('ASK', false)
    await t.settle()
    expect(t.requests('LLM')[0].parse).toBe(false)
    await t.respond('LLM', 'n is 3')
    expect(t.state).toMatchObject({ status: 'ok', value: null, text: 'n is 3' })
  })
})
