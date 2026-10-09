// @vitest-environment jsdom
// PLAN-6 M-1: decide() and the question builders build makeFetchDriver requests (no driver of
// their own): the dictionary form (TypeSafe / Ollama /v1/systemone) and decide.openai() (OpenAI
// Decisions' array form, the reply mapped back by `parse`). No network: the HTTP fake and a stub fetch.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'
import { renderComponent } from '../src/extra/testing.js'
import { ABORT } from '../src/shared.js'
import { decide, choice, noul, score } from '../src/extra/ai/index.js'
import { toOpenAI, fromOpenAI } from '../src/extra/ai/decide.js'

let t
afterEach(() => { t?.dispose(); t = undefined })

const questions = {
  topic: choice('What is this ticket about?', { billing: 'Payments, invoices', bug: 'Something is broken', account: 'Login or profile' }),
  urgent: noul('Does the customer need this handled today?', { true: 'Blocked or losing money', false: 'A question' }),
  mood: score('How upset is the customer?', ['calm', 'annoyed', 'angry']),
}
const ANSWERS = {
  topic: { type: 'choice', choice: 'billing', probabilities: { billing: 0.9, bug: 0.06, account: 0.04 }, confidence: 0.35 },
  urgent: { type: 'noul', noul: 0.9 },
  mood: { type: 'score', score: 1.4, legend: { 0: 'calm', 1: 'annoyed', 2: 'angry' }, probabilities: { 0: 0.1, 1: 0.4, 2: 0.5 }, confidence: 0.3 },
}

describe('exports', () => {
  it("'sygnal/ai' and 'sygnal' export decide (with .openai) and the builders", async () => {
    const ai = await import('../dist/ai.esm.js')
    const main = await import('../dist/index.esm.js')
    for (const name of ['decide', 'choice', 'noul', 'score']) expect(ai[name]).toBe(main[name])
    expect(typeof ai.decide.openai).toBe('function')
  })
})

describe('question builders', () => {
  it('choice / noul / score build the dictionary questions', () => {
    expect(questions.topic).toEqual({ type: 'choice', instructions: 'What is this ticket about?', criteria: { billing: 'Payments, invoices', bug: 'Something is broken', account: 'Login or profile' } })
    expect(questions.urgent).toEqual({ type: 'noul', instructions: 'Does the customer need this handled today?', criteria: { true: 'Blocked or losing money', false: 'A question' } })
    expect(noul('Spam?')).toEqual({ type: 'noul', instructions: 'Spam?' })
    expect(questions.mood).toEqual({ type: 'score', instructions: 'How upset is the customer?', criteria: ['calm', 'annoyed', 'angry'] })
    // option names only: descriptions null (TypeSafe and Ollama accept null)
    expect(choice('Which?', ['a', 'b']).criteria).toEqual({ a: null, b: null })
    // instructions may be an object holding the question and its data
    expect(noul({ question: 'Mentions {x}?', x: 'money' }).instructions).toEqual({ question: 'Mentions {x}?', x: 'money' })
  })
})

describe('decide() (dictionary form)', () => {
  it('a POST JSON request to /api/decide by default; request keys pass through', () => {
    const r = decide({ model: 'nimble', state: 'charged twice', questions, ok: 'TRIAGED', error: 'FAILED', key: 'triage', latest: true, headers: { 'x-a': '1' } })
    expect(r).toEqual({
      url: '/api/decide', method: 'POST', json: { model: 'nimble', state: 'charged twice', questions },
      ok: 'TRIAGED', error: 'FAILED', key: 'triage', latest: true, headers: { 'x-a': '1' },
    })
    expect(decide({ url: 'http://localhost:11434/v1/systemone', model: 'nimble', state: { a: 1 }, questions, images: ['iVBOR'] }))
      .toEqual({ url: 'http://localhost:11434/v1/systemone', method: 'POST', json: { model: 'nimble', state: { a: 1 }, questions, images: ['iVBOR'] } })
  })

  it('sent through makeFetchDriver: the body is the dictionary form, the reply goes to the ok action', async () => {
    const fetch = vi.fn(async (url, init) => new Response(JSON.stringify({ model: 'nimble', answers: ANSWERS, usage: { input_tokens: 9, output_tokens: 0 } }), { headers: { 'content-type': 'application/json' } }))
    function C({ state }) { return h('p', null, state.topic ?? '…') }
    C.initialState = { text: 'charged twice' }
    C.model = {
      BOOTSTRAP: { HTTP: (s) => decide({ model: 'nimble', state: s.text, questions, ok: 'TRIAGED' }) },
      TRIAGED: (s, d) => ({ ...s, topic: d.answers.topic.choice, urgent: d.answers.urgent.noul > 0.5 }),
    }
    t = renderComponent(C, { drivers: { HTTP: makeFetchDriver({ fetch }) } })
    await t.waitForState(s => s.topic)
    expect(t.state).toMatchObject({ topic: 'billing', urgent: true })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/decide')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ model: 'nimble', state: 'charged twice', questions })
  })

  it('a reply action under the HTTP fake: t.respond with { answers }, escalation when unsure', async () => {
    function Ticket({ state }) { return h('p', null, state.topic ?? '…') }
    Ticket.initialState = { text: 'card declined', topic: null }
    Ticket.model = {
      BOOTSTRAP: { HTTP: (s) => decide({ model: 'jev-latest', state: s.text, questions, ok: 'TRIAGED' }) },
      TRIAGED: {
        STATE: (s, { answers }) => ({ ...s, topic: answers.topic.choice }),
        LLM: (s, { answers }) => answers.topic.confidence < 0.6 ? { messages: [{ role: 'user', content: s.text }], ok: 'CLASSIFIED' } : ABORT,
      },
    }
    t = renderComponent(Ticket)
    await t.ready()
    expect(t.requests('HTTP')).toEqual([decide({ model: 'jev-latest', state: 'card declined', questions, ok: 'TRIAGED' })])
    await t.respond('HTTP', { answers: ANSWERS }, 'TRIAGED')
    expect(t.state.topic).toBe('billing')
    expect(t.requests('LLM')).toHaveLength(1)
  })

  it('as a resource: re-runs when the state changes, stale answers aborted', async () => {
    function Ticket({ state }) {
      const tr = state.triage
      return h('p', null, tr.status === 'success' ? `${tr.data.answers.topic.choice}${tr.data.answers.urgent.noul > 0.5 ? ' urgent' : ''}` : tr.status)
    }
    Ticket.initialState = { text: 'charged twice' }
    Ticket.resources = { triage: (s) => s.text && decide({ model: 'jev-latest', state: s.text, questions }) }
    Ticket.model = { SET: (s, text) => ({ ...s, text }) }
    t = renderComponent(Ticket)
    await t.ready()
    await t.waitForState(s => s.triage?.status === 'loading')
    expect(t.requests('HTTP')[0]).toMatchObject({ url: '/api/decide', method: 'POST', resource: 'triage', json: { state: 'charged twice' } })
    await t.respond('HTTP', { answers: ANSWERS }, 'triage')
    expect(t.html()).toContain('billing urgent')
    t.simulateAction('SET', 'export crashes')
    await t.waitForState(s => s.triage.status === 'loading')
    expect(t.requests('HTTP')).toHaveLength(2)
    await t.respond('HTTP', { answers: { ...ANSWERS, topic: { ...ANSWERS.topic, choice: 'bug' }, urgent: { type: 'noul', noul: 0.1 } } }, 'triage')
    expect(t.html()).toContain('<p>bug</p>')
    t.simulateAction('SET', '')
    await t.waitForState(s => s.triage.status === 'idle')
  })
})

describe('decide.openai() (OpenAI Decisions array form)', () => {
  const OPENAI_REPLY = {
    answers: [
      { type: 'choice', name: 'topic', choice: 'billing', probabilities: [{ value: 'billing', probability: 0.9 }, { value: 'bug', probability: 0.06 }, { value: 'account', probability: 0.04 }], confidence: 0.35 },
      { type: 'predicate', name: 'urgent', probability: 0.9 },
      { type: 'score', name: 'mood', score: 1.4, probabilities: [{ value: 0, label: 'calm', probability: 0.1 }, { value: 1, label: 'annoyed', probability: 0.4 }, { value: 2, label: 'angry', probability: 0.5 }], confidence: 0.3 },
    ],
  }

  it('maps the questions to the array form', () => {
    expect(toOpenAI(questions)).toEqual([
      { type: 'choice', name: 'topic', instructions: 'What is this ticket about?', choices: [
        { value: 'billing', description: 'Payments, invoices' }, { value: 'bug', description: 'Something is broken' }, { value: 'account', description: 'Login or profile' }] },
      { type: 'predicate', name: 'urgent', instructions: 'Does the customer need this handled today?\nTrue: Blocked or losing money\nFalse: A question' },
      { type: 'score', name: 'mood', instructions: 'How upset is the customer?', levels: [
        { label: 'calm', description: 'calm' }, { label: 'annoyed', description: 'annoyed' }, { label: 'angry', description: 'angry' }] },
    ])
    expect(toOpenAI({ x: noul({ q: 'y' }), c: choice('?', ['a']) })).toEqual([
      { type: 'predicate', name: 'x', instructions: '{"q":"y"}' },
      { type: 'choice', name: 'c', instructions: '?', choices: [{ value: 'a' }] },
    ])
  })

  it('the request: input (text, or a user message with images), the questions array, a parse', () => {
    const r = decide.openai({ model: 'gpt-6-luna', state: { ticket: 'x' }, questions, ok: 'TRIAGED' })
    expect(r).toMatchObject({ url: '/api/decide', method: 'POST', ok: 'TRIAGED', json: { model: 'gpt-6-luna', input: '{"ticket":"x"}', questions: toOpenAI(questions) } })
    expect(typeof r.parse).toBe('function')
    expect(decide.openai({ model: 'm', state: 'look', questions, images: ['iVBORw0', '/9j/4AA', 'data:image/gif;base64,R0'] }).json.input).toEqual([{ role: 'user', content: [
      { type: 'input_text', text: 'look' },
      { type: 'input_image', image_url: 'data:image/png;base64,iVBORw0' },
      { type: 'input_image', image_url: 'data:image/jpeg;base64,/9j/4AA' },
      { type: 'input_image', image_url: 'data:image/gif;base64,R0' },
    ] }])
    // the caller's own parse wins
    const own = () => 1
    expect(decide.openai({ model: 'm', state: '', questions, parse: own }).parse).toBe(own)
  })

  it('maps the reply back to the dictionary form, refusals by name', () => {
    expect(fromOpenAI({ ...OPENAI_REPLY, usage: { input_tokens: 3 } })).toEqual({ answers: ANSWERS, usage: { input_tokens: 3 } })
    expect(fromOpenAI({ answers: [{ type: 'refusal', name: 'topic' }] })).toEqual({ answers: { topic: { type: 'refusal' } } })
    expect(fromOpenAI('oops')).toBe('oops')
  })

  it('reply actions and resources get the dictionary form (HTTP fake)', async () => {
    function C({ state }) { return h('p', null, `${state.topic ?? '…'}|${state.triage.status === 'success' ? state.triage.data.answers.mood.score : ''}`) }
    C.initialState = { text: 'charged twice', topic: null }
    C.resources = { triage: (s) => decide.openai({ model: 'gpt-6-luna', state: s.text, questions }) }
    C.model = {
      BOOTSTRAP: { HTTP: (s) => decide.openai({ model: 'gpt-6-luna', state: s.text, questions, ok: 'TRIAGED' }) },
      TRIAGED: (s, d) => ({ ...s, topic: d.answers.topic.choice, d }),
    }
    t = renderComponent(C)
    await t.ready()
    await t.respond('HTTP', OPENAI_REPLY, 'TRIAGED')
    expect(t.state.d).toEqual({ answers: ANSWERS })
    await t.waitForState(s => s.triage?.status === 'loading')
    await t.respond('HTTP', OPENAI_REPLY, 'triage')
    expect(t.state.triage.data).toEqual({ answers: ANSWERS })
    expect(t.html()).toContain('billing|1.4')
  })
})
