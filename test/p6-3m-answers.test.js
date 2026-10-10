// PLAN-6 M-2: answers() fixtures, typed from the questions, as replies for t.respond('HTTP', …,
// target); the confidence-escalation pattern of the samples (§6): an unsure decision goes to the
// chat model; decide.openai() requests get the array form (answers.openai).
import { it, expect, afterEach, describe } from 'vitest'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { ABORT } from '../src/shared.ts'
import { answers, decide, choice, noul, score } from '../src/extra/ai/index.ts'
import { fromOpenAI } from '../src/extra/ai/decide.ts'

const questions = {
  topic: choice('What is this ticket about?', {
    billing: 'Payments, invoices, plans, refunds',
    bug: 'Something in the product is broken',
    account: 'Login, access or profile',
  }),
  urgent: noul('Does the customer need this handled today?', { true: 'Blocked, losing money, or a deadline', false: 'A question or a minor issue' }),
  mood: score('How upset is the customer?', ['calm', 'annoyed', 'angry']),
}

// nimble's confidence: 1 - entropy / ln(n) (checked against a real reply: 0.907 for [0.0058, 0.9818, 0.0124])
const confidenceOf = (ps) => 1 + ps.reduce((h, p) => h + (p > 0 ? p * Math.log(p) : 0), 0) / Math.log(ps.length)

let t
afterEach(() => { t?.dispose(); t = null })

describe('answers()', () => {
  it('fills every question sensibly; the reply has the dictionary shape', () => {
    const r = answers(questions)
    expect(r.model).toBe('test')
    expect(r.usage).toEqual({ input_tokens: 0, output_tokens: 0 })
    expect(r.answers.topic).toMatchObject({ type: 'choice', choice: 'billing' })
    expect(r.answers.topic.confidence).toBeCloseTo(0.9, 6)
    const ps = Object.values(r.answers.topic.probabilities)
    expect(ps.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    expect(confidenceOf(ps)).toBeCloseTo(0.9, 6)
    expect(r.answers.topic.probabilities.bug).toBeCloseTo(r.answers.topic.probabilities.account, 12)
    expect(r.answers.urgent).toEqual({ type: 'noul', noul: 0.05 })
    expect(r.answers.mood).toEqual({ type: 'score', score: 0, legend: { 0: 'calm', 1: 'annoyed', 2: 'angry' }, probabilities: { 0: 1, 1: 0, 2: 0 }, confidence: 1 })
  })

  it('picks: option names, confidences, probabilities, booleans, levels', () => {
    const r = answers(questions, { topic: { choice: 'bug', confidence: 0.35 }, urgent: true, mood: 'angry' })
    expect(r.answers.topic.choice).toBe('bug')
    expect(r.answers.topic.confidence).toBe(0.35)
    expect(confidenceOf(Object.values(r.answers.topic.probabilities))).toBeCloseTo(0.35, 6)
    expect(r.answers.topic.probabilities.bug).toBeGreaterThan(r.answers.topic.probabilities.billing)
    expect(r.answers.urgent.noul).toBe(0.95)
    expect(r.answers.mood.score).toBe(2)

    const p = answers(questions, { topic: { probabilities: { account: 0.5, bug: 0.3 } }, urgent: 0.7, mood: 1.4 })
    expect(p.answers.topic.choice).toBe('account')
    expect(p.answers.topic.probabilities).toEqual({ billing: expect.closeTo(0.2, 9), bug: 0.3, account: 0.5 })
    expect(p.answers.topic.confidence).toBeCloseTo(confidenceOf([0.2, 0.3, 0.5]), 9)
    expect(p.answers.urgent.noul).toBe(0.7)
    // a fractional score sits between two levels; the weighted index is the score
    expect(p.answers.mood.probabilities).toEqual({ 0: 0, 1: expect.closeTo(0.6, 9), 2: expect.closeTo(0.4, 9) })
    expect(p.answers.mood.score).toBe(1.4)
    expect(answers(questions, { mood: { score: 'annoyed', confidence: 0.2 } }).answers.mood).toMatchObject({ score: 1, confidence: 0.2 })
    expect(answers(questions, { topic: 'account' }, { model: 'jev-latest' })).toMatchObject({ model: 'jev-latest', answers: { topic: { choice: 'account' } } })
  })

  it('typos throw: question names, options, levels, probabilities', () => {
    expect(() => answers(questions, { topc: 'billing' })).toThrow(/topc: no such question \(topic, urgent, mood\)/)
    expect(() => answers(questions, { topic: 'billng' })).toThrow(/topic: "billng" is not an option \(billing, bug, account\)/)
    expect(() => answers(questions, { mood: 'furious' })).toThrow(/mood: "furious" is not a level/)
    expect(() => answers(questions, { mood: 3 })).toThrow(/level index from 0 to 2/)
    expect(() => answers(questions, { urgent: 2 })).toThrow(/true, false or a probability/)
  })

  it('answers.openai(): the array form, which decide.openai() maps back to the same answers', () => {
    const picks = { topic: { choice: 'bug', confidence: 0.5 }, urgent: true, mood: 1.5 }
    const o = answers.openai(questions, picks)
    expect(o.answers.map((a) => [a.type, a.name])).toEqual([['choice', 'topic'], ['predicate', 'urgent'], ['score', 'mood']])
    expect(o.answers[2].probabilities).toEqual([{ value: 0, label: 'calm', probability: 0 }, { value: 1, label: 'annoyed', probability: 0.5 }, { value: 2, label: 'angry', probability: 0.5 }])
    const { answers: back } = fromOpenAI(o)
    expect(back).toEqual(answers(questions, picks).answers)
  })
})

// ------------------------------------------------------------------ the samples' §6 pattern

function Ticket({ state }) {
  const t = state.triage
  return h('article', null, h('p', null, state.text),
    t.status === 'success' ? h('p', { className: 'labels' }, t.data.answers.topic.choice) : null,
    state.topicByLLM ? h('p', { className: 'llm' }, state.topicByLLM) : null)
}
Ticket.initialState = { text: 'card declined but money left my bank', topicByLLM: null }
Ticket.resources = {
  triage: (state) => state.text && decide({ model: 'jev-latest', state: state.text, questions }),
}
Ticket.intent = ({ STATE }) => ({
  // the resource's answer, once per success
  TRIAGED: STATE.stream.map((s) => s.triage).filter((r) => r.status === 'success').map((r) => r.data),
})
// escalation: only an unsure decision goes to a chat model
Ticket.model = {
  TRIAGED: {
    LLM: (state, { answers: a }) => a.topic.confidence < 0.6
      ? { messages: [{ role: 'user', parts: [{ type: 'text', text: `Classify as billing, bug or account: ${state.text}` }] }], ok: 'CLASSIFIED' }
      : ABORT,
  },
  CLASSIFIED: (state, { text }) => ({ ...state, topicByLLM: text.trim() }),
}

describe('confidence escalation (samples §6)', () => {
  it('an unsure topic goes to the chat model', async () => {
    t = renderComponent(Ticket)
    await t.respond('HTTP', answers(questions, { topic: { choice: 'billing', confidence: 0.35 }, urgent: true }), 'triage')
    await t.settle()
    expect(t.state.triage.data.answers.topic.choice).toBe('billing')
    expect(t.requests('LLM')).toHaveLength(1)
    await t.stream('LLM', ['billing'])
    await t.settle()
    expect(t.state.topicByLLM).toBe('billing')
    expect(t.html()).toContain('billing')
  })

  it('a sure one does not', async () => {
    t = renderComponent(Ticket)
    await t.respond('HTTP', answers(questions, { topic: 'bug' }), 'triage')
    await t.settle()
    expect(t.state.triage.data.answers.topic).toMatchObject({ choice: 'bug', confidence: expect.closeTo(0.9, 6) })
    expect(t.requests('LLM')).toHaveLength(0)
  })

  it('a reply-action request, answered by its ok action name', async () => {
    function Triage({ state }) { return h('p', null, state.topic || '…') }
    Triage.initialState = { topic: null }
    Triage.model = {
      BOOTSTRAP: { HTTP: () => decide({ model: 'nimble', state: 'refund please', questions, ok: 'DECIDED' }) },
      DECIDED: (state, d) => ({ ...state, topic: d.answers.topic.choice }),
    }
    t = renderComponent(Triage)
    await t.respond('HTTP', answers(questions, { topic: 'billing' }), 'DECIDED')
    expect(t.state.topic).toBe('billing')
  })
})
