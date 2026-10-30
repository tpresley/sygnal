// @vitest-environment jsdom
// compose.generated (experimental): the `render_component` chat card is the one-part case of the
// same pieces. A catalog with one part, `gen.card('PICK_PLAN')` (a result part), as the chat's
// direct `ask` catalog: the model's ask_user input is the card (its code included), the code runs
// in the box, and its PICK_PLAN event, validated, is the call's output { part, answer }. The
// repair loop is the host's `fix: gen.repair()`, as on a page. The model is scripted.
import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import { createElement as h } from '../src/pragma/index.ts'
import { renderComponent } from '../src/extra/testing.ts'
import { chat } from '../src/extra/ai/chat/behavior.ts'
import { compose, defineCatalog, askCard } from '../src/extra/ai/compose/index.ts'
import { generatedRuntime } from '../src/sandbox.ts'
import { kernel, nodeWorker } from './fixtures/sandbox-helpers.js'
import { compile, until, fixRequests } from './fixtures/generated-app.js'

const PLANS = [{ id: 'free', name: 'Free', price: 0 }, { id: 'team', name: 'Team', price: 12 }, { id: 'biz', name: 'Business', price: 30 }]

function makeApp() {
  const gen = compose.generated(generatedRuntime({ kernel, compile, worker: nodeWorker }), {
    data: { plans: { description: 'the pricing plans', shape: '[{ id: "free" | "team" | "biz", name: string, price: number (USD per seat) }]', from: (s) => s.plans } },
    emits: { PICK_PLAN: { description: 'the plan the user picked (the answer)', schema: z.object({ id: z.enum(['free', 'team', 'biz']) }) } },
  })
  const cards = defineCatalog({ parts: { card: gen.card('PICK_PLAN') }, rows: false })
  function App({ state }) {
    const a = state.assistant
    return h('div', { className: 'chat' },
      ...a.messages.flatMap((m) => m.parts.map((p) => p.type === 'tool-ask_user' ? h('section', { className: 'ask-card', 'data-card': p.toolCallId }, askCard(cards, state, p)) : null)),
      h('form', { className: 'ask' }, h('input', { className: 'prompt', value: a.prompt }), h('button', { type: 'submit' }, 'Send')))
  }
  App.initialState = { plans: PLANS }
  App.uses = {
    assistant: chat({ form: '.ask', prompt: '.prompt', ask: { catalog: cards, direct: true, instructions: gen.instructions } }),
    fix: gen.repair(),
  }
  return { App, gen }
}

const PICKER = `export default function Plans({ state }) {
  return <ul className="stack">{state.plans.map((p) => <li><button className="btn plan" data-id={p.id}>{p.name}: $' + '{p.price}</button></li>)}</ul>
}
Plans.initialState = { plans: [] }
Plans.intent = ({ DOM, PROPS }) => ({ DATA: PROPS.stream, PICK: DOM.select('.plan').events('click').map((e) => e.target.dataset.id) })
Plans.model = { DATA: (state, data) => ({ ...state, ...data }), PICK: { EVENTS: (state, id) => ({ type: 'PICK_PLAN', data: { id } }) } }`.replace("$' + '", '$')

let t
afterEach(() => { t?.dispose(); t = null })

async function ask(t, code) {
  t.container.querySelector('.prompt').value = 'Which plan?'
  t.container.querySelector('.prompt').dispatchEvent(new window.Event('input', { bubbles: true }))
  t.container.querySelector('.ask').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  await t.next((s) => s.assistant.status === 'submitted')
  await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'ask_user', input: { children: [{ part: 'card', title: 'Pick a plan', reads: ['plans'], code }] } } }])
}
const chatReqs = (t) => t.requests('LLM').filter((r) => r.key === 'assistant')

describe('a generated chat card (render_component)', { timeout: 20000 }, () => {
  it("the card's code is in the ask_user input; its PICK_PLAN event answers the call", async () => {
    const { App } = makeApp()
    t = renderComponent(App, { dom: 'real' })
    await t.ready()
    await ask(t, PICKER)
    const req = chatReqs(t)[0]
    expect(req.tools.ask_user.description).toContain('Custom parts:')
    expect(JSON.stringify(req.tools.ask_user.inputSchema)).toContain('"code":{"type":"string","maxLength":4001}')
    await until(() => t.container.querySelectorAll('.ask-card .plan').length === 3, 8000, 'the card')
    expect(t.container.querySelector('.ask-card .gen-title').textContent).toBe('Pick a plan')
    t.container.querySelector('.plan[data-id="team"]').click()
    await until(() => chatReqs(t).length === 2, 8000, 'the next chat request')
    const out = chatReqs(t)[1].messages.flatMap((m) => m.parts || []).find((p) => p.type === 'tool-ask_user').output
    expect(out).toEqual({ part: 'card', answer: { id: 'team' } })
  })

  it('a card whose code fails goes through the same repair loop', async () => {
    const { App } = makeApp()
    t = renderComponent(App, { dom: 'real' })
    await t.ready()
    await ask(t, PICKER.replace('return <ul', 'document.title = "x"\n  return <ul'))
    const fix = await until(() => fixRequests(t)[0], 8000, 'the repair request')
    expect(fix.messages[0].content).toMatch(/What went wrong: runtime: view threw \(SYG406\): ReferenceError: 'document' is not defined/)
    await t.respond('LLM', JSON.stringify({ code: PICKER }), 'fix.REPLY')
    await until(() => t.container.querySelectorAll('.ask-card .plan').length === 3, 8000, 'the fixed card')
    t.container.querySelector('.plan[data-id="biz"]').click()
    await until(() => chatReqs(t).length === 2, 8000)
    const out = chatReqs(t)[1].messages.flatMap((m) => m.parts || []).find((p) => p.type === 'tool-ask_user').output
    expect(out).toEqual({ part: 'card', answer: { id: 'biz' } })
  })
})
