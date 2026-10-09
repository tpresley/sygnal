// PLAN-6 M-1, opt-in (not in npm test's default run): decide() against a real local Ollama
// (≥ 0.35) with the `nimble` decision model. TEST_OLLAMA=1 npx vitest run test/p6-1m-ollama.test.js
// (OLLAMA_URL overrides http://localhost:11434). Checks the answer shapes, not the model's accuracy.
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'
import { renderComponent } from '../src/extra/testing.js'
import { decide, choice, noul, score } from '../src/extra/ai/index.js'

const BASE = process.env.OLLAMA_URL || 'http://localhost:11434'
let t
afterEach(() => { t?.dispose(); t = undefined })

const questions = {
  topic: choice('What is this support ticket about?', { billing: 'Payments, charges, plans, invoices', bug: 'A defect in the software', account: 'Login, access or profile' }),
  urgent: noul('Does the customer need this handled today?', { true: 'Blocked, losing money, or a deadline', false: 'A question or a minor issue' }),
  plain: noul('Is the text in English?'),
  mood: score('How upset is the customer?', ['calm', 'annoyed', 'angry']),
}

describe.skipIf(!process.env.TEST_OLLAMA)('decide() against local Ollama nimble', () => {
  it('a reply action and a resource get the dictionary answers', async () => {
    function Ticket({ state }) { return h('p', null, state.triage.status) }
    Ticket.initialState = { text: 'URGENT: I was charged twice this month, refund please!!' }
    const req = (s, extra) => decide({ url: `${BASE}/v1/systemone`, model: 'nimble', state: s.text, questions, ...extra })
    Ticket.resources = { triage: (s) => req(s) }
    Ticket.model = {
      BOOTSTRAP: { HTTP: (s) => req(s, { ok: 'TRIAGED', error: 'FAILED' }) },
      TRIAGED: (s, d) => ({ ...s, reply: d }),
      FAILED: (s, e) => ({ ...s, failed: String(e.error) }),
    }
    t = renderComponent(Ticket, { drivers: { HTTP: makeFetchDriver() } })
    const s = await t.waitForState(s => s.failed || (s.reply && s.triage?.status === 'success'), 60000)
    expect(s.failed).toBeUndefined()
    for (const d of [s.reply, s.triage.data]) {
      expect(d.model).toBe('nimble')
      expect(d.usage).toMatchObject({ input_tokens: expect.any(Number), output_tokens: 0 })
      const { topic, urgent, plain, mood } = d.answers
      expect(topic).toMatchObject({ type: 'choice', choice: expect.stringMatching(/^(billing|bug|account)$/), confidence: expect.any(Number) })
      expect(Object.keys(topic.probabilities).sort()).toEqual(['account', 'billing', 'bug'])
      expect(urgent).toEqual({ type: 'noul', noul: expect.any(Number) })
      expect(plain.noul).toBeGreaterThanOrEqual(0)
      expect(mood).toMatchObject({ type: 'score', score: expect.any(Number), legend: { 0: 'calm', 1: 'annoyed', 2: 'angry' }, confidence: expect.any(Number) })
      expect(Object.keys(mood.probabilities)).toEqual(['0', '1', '2'])
    }
    expect(s.reply.answers.topic.choice).toBe('billing')
  }, 90000)
})
