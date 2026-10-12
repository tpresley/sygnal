// PLAN-9 H-2 / H-3: cards in the chat, `chat({ ask: { catalog, backend?, instructions?, direct? } })`.
// The model calls ask_user({ need }); the backend composes a card from the catalog (compose.llm()
// on the chat's sink by default, or compose.decisions() on HTTP), stored on the tool part
// (`part.ui`) and rendered by the host with askCard(); a result part's answer
// (compose.answer(props, value), heard through CHILD.select) is the call's output { part, answer }.
// The first four tests are the prototype's chat-ui scenarios (research/ai-compose/api-prototype/
// src/chat-ui.test.jsx) on the shipped API.
import { it, expect, afterEach, describe } from 'vitest'
import { renderComponent } from '../src/extra/testing.ts'
import { persist } from '../src/extra/persist.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { chat, openToolCalls } from '../src/extra/ai/chat/behavior.ts'
import { defineCatalog, compose, composeWith, askCard, Composed } from '../src/extra/ai/compose/index.ts'
import { configureDiagnostics, getDiagnostics, _resetDiagnostics } from '../src/extra/diagnostics/index.ts'
import * as sygnal from '../src/index.ts'
import { setupChecks } from './diagnostics/helpers.js'

// ------------------------------------------------------------------ result parts and the catalog

// a question with options the LLM writes (free-text params: LLM only)
export function ChoiceCard({ question, options = [], answer: picked, frozen }) {
  return h('div', { className: 'choice' }, h('p', { className: 'question' }, question),
    ...options.map((o) => h('button', { type: 'button', className: o === picked ? 'option picked' : 'option', 'data-value': o, disabled: !!frozen }, o)))
}
ChoiceCard.intent = ({ DOM }) => ({ PICK: DOM.click('.option').data('value') })
ChoiceCard.model = { PICK: { PARENT: (_s, value, _n, props) => compose.answer(props, value) } }

// a prepared picker over app data (decision-friendly: no generated text)
export function PlanPicker({ state, answer: picked, frozen }) {
  return h('ul', { className: 'plans' }, ...state.plans.map((p) => h('li', null,
    h('button', { type: 'button', className: p.id === picked ? 'plan picked' : 'plan', 'data-id': p.id, disabled: !!frozen }, `${p.name} (${p.price})`))))
}
PlanPicker.intent = ({ DOM }) => ({ PICK: DOM.click('.plan').data('id') })
PlanPicker.model = { PICK: { PARENT: (_s, id, _n, props) => compose.answer(props, id) } }

// a small form with local state (kept per card), answering with its values
export function ContactForm({ state, frozen }) {
  return h('form', { className: 'contact' },
    h('input', { className: 'name', 'aria-label': 'Name', value: state.name, disabled: !!frozen }),
    h('input', { className: 'email', 'aria-label': 'Email', value: state.email, disabled: !!frozen }),
    h('button', { type: 'submit', className: 'send', disabled: !!frozen }, 'Send'))
}
ContactForm.intent = ({ DOM }) => ({
  NAME: DOM.input('.name').value(),
  EMAIL: DOM.input('.email').value(),
  SEND: DOM.select('.contact').events('submit', { preventDefault: true }),
})
ContactForm.model = {
  NAME: (s, name) => ({ ...s, name }),
  EMAIL: (s, email) => ({ ...s, email }),
  SEND: { PARENT: (s, _d, _n, props) => compose.answer(props, { name: s.name, email: s.email }) },
}

// a display part and a fixed-wording confirmation ("looks right?")
export function Chart({ range }) { return h('figure', { className: 'chart', 'data-range': range }, `Revenue (${range})`) }
export function LooksRight({ answer: picked, frozen }) {
  return h('p', { className: 'looks-right' }, 'Does this look right?',
    h('button', { type: 'button', className: 'yes', disabled: !!frozen }, picked === true ? 'Yes ✓' : 'Yes'),
    h('button', { type: 'button', className: 'no', disabled: !!frozen }, picked === false ? 'No ✓' : 'No'))
}
LooksRight.intent = ({ DOM }) => ({ YES: DOM.click('.yes'), NO: DOM.click('.no') })
LooksRight.model = {
  YES: { PARENT: (_s, _d, _n, props) => compose.answer(props, true) },
  NO: { PARENT: (_s, _d, _n, props) => compose.answer(props, false) },
}

export const catalog = defineCatalog({
  parts: {
    choice: {
      component: ChoiceCard, result: true, description: 'A question with 2 to 5 short options; the user picks one',
      params: { question: { type: 'text', maxLength: 120, required: true }, options: { type: 'list', items: { maxLength: 40 }, min: 2, max: 5, required: true } },
    },
    plans: { component: PlanPicker, result: true, description: 'The pricing plans to pick from (Free, Team, Business)' },
    contact: { component: ContactForm, result: true, local: { name: '', email: '' }, description: 'A form asking for a name and an email' },
    chart: { component: Chart, description: 'Line chart: the revenue trend', params: { range: { options: { month: 'The last month', quarter: 'The last quarter', year: 'The last year' }, default: 'year' } } },
    looksRight: { component: LooksRight, result: true, description: 'Asks: does this look right? (yes / no)' },
  },
})

export const PLANS = [{ id: 'free', name: 'Free', price: '$0' }, { id: 'team', name: 'Team', price: '$12' }, { id: 'biz', name: 'Business', price: '$30' }]

// PLAN-9 M-1: askCard() in the view, or <Composed card={part} /> (test/p9-composed-parity.test.js)
const card = (cat, state, p) => globalThis.__COMPOSE_VIA === 'marker' ? (p.ui?.layout ? h(Composed, { catalog: cat, card: p }) : null) : askCard(cat, state, p)

export function makeChatApp(ask = {}, cat = catalog) {
  function App({ state }) {
    const a = state.assistant
    return h('div', { className: 'chat' },
      h('ol', { className: 'messages' }, ...a.messages.map((m) => h('li', { className: `msg ${m.role}` },
        ...m.parts.map((p) => p.type === 'text' ? h('p', { className: 'text' }, p.text)
          : p.type === 'tool-ask_user' ? h('section', { className: `ask-card ${p.ui?.status}`, 'data-card': p.toolCallId }, card(cat, state, p) ?? h('p', { className: 'composing' }, '…'))
          : null)))),
      a.draft ? h('p', { className: 'draft' }, a.draft) : null,
      h('form', { className: 'ask' }, h('input', { className: 'prompt', 'aria-label': 'Message', value: a.prompt }), h('button', { type: 'submit', disabled: a.status !== 'ready' }, 'Send')),
      h('button', { type: 'button', className: 'stop' }, 'Stop'))
  }
  App.initialState = { plans: PLANS, picked: [] }
  App.uses = { assistant: chat({ form: '.ask', prompt: '.prompt', stop: '.stop', instructions: 'Help the user choose a plan. Ask with ask_user when you need the user to choose, fill in or confirm something.', ask: { catalog: cat, ...ask } }) }
  // the host hears the result parts too: cards render in its view
  App.intent = ({ CHILD }) => ({ PICKED: CHILD.select(PlanPicker) })
  App.model = { PICKED: (s, v) => ({ ...s, picked: [...s.picked, v.value] }) }
  return App
}

// ------------------------------------------------------------------ helpers

let t
afterEach(() => { t?.dispose(); t = null })
const S = () => t.state.assistant
const toolPart = (req) => req.messages.flatMap((m) => m.parts || []).filter((p) => p.type === 'tool-ask_user')
const chatReqs = () => t.requests('LLM').filter((r) => r.key === 'assistant')
async function say(text) {
  t.simulateEvent('.prompt', 'input', { value: text })
  t.simulateEvent('.ask', 'submit')
  await t.next((s) => s.assistant.status === 'submitted')
}
async function waitUntil(f, tries = 50) {
  for (let i = 0; i < tries && !f(); i++) await t.settle()
  if (!f()) throw new Error('timed out')
}
const askCall = (id, need) => ({ toolCall: { id, name: 'ask_user', input: { need } } })

// ------------------------------------------------------------------ the prototype's scenarios

describe('cards, LLM backend (the default: compose.llm() on the chat sink)', () => {
  it('composes the card from `need`, renders it inline; the click is the tool output; the chat continues', async () => {
    t = renderComponent(makeChatApp(), { strict: true })
    await say('Which plan should I take?')
    const first = t.requests('LLM')[0]
    expect(first.tools.ask_user).toMatchObject({ inputSchema: { type: 'object', required: ['need'], additionalProperties: false } })
    expect(first.tools.ask_user.description).toMatch(/^Ask the user and wait for their answer/)

    await t.stream('LLM', ['Let me ask.', askCall('call1', 'How many people will use it?')])
    await t.settle()
    expect(S().status).toBe('streaming')                       // the card composes
    expect(t.query('.ask-card.composing .composing')).toBeTruthy()
    const req = t.requests('LLM')[1]
    // its own key and reply actions; only `need` and the app state, never the conversation
    expect(req).toMatchObject({ key: 'assistant.ask:call1', ok: 'assistant.CARD', error: 'assistant.CARD_FAILED', latest: true })
    expect(req.delta).toBeUndefined()
    expect(req.messages.at(-1)).toEqual({ role: 'user', content: 'How many people will use it?' })
    expect(JSON.stringify(req.messages)).not.toContain('Which plan')
    expect(req.output).toBeTruthy()

    await composeWith(t, catalog, [{ part: 'choice', params: { question: 'How many people will use it?', options: ['Just me', '2–10', 'More'] } }])
    expect(S().status).toBe('ready')                          // only the user's answer is outstanding
    expect(t.query('.msg.assistant .question').textContent).toBe('How many people will use it?')
    expect(chatReqs()).toHaveLength(1)
    expect(openToolCalls(S())[0].ui).toMatchObject({ status: 'open', pending: null, answer: null })

    t.simulateEvent('.option[data-value="2–10"]', 'click')
    await waitUntil(() => chatReqs().length === 2)
    const [part] = toolPart(chatReqs()[1])
    expect(part.state).toBe('output-available')
    expect(part.output).toEqual({ part: 'choice', answer: '2–10' })
    expect(chatReqs()[1].continue).toBe(true)

    // frozen: answered, disabled, the pick marked
    expect(t.query('.ask-card').getAttribute('class')).toContain('answered')
    expect(t.query('fieldset.compose-frozen')).toBeTruthy()
    expect(t.query('.option.picked').textContent).toBe('2–10')
    await t.stream('LLM', ['Then Team is the right plan.'])
    await t.settle()
    expect(S().status).toBe('ready')
    expect(t.html()).toContain('Then Team is the right plan.')
    t.expectNoDiagnostics()
  })

  it('many cards, one per call: each has its own scope (instances, local form state)', async () => {
    setupChecks()
    t = renderComponent(makeChatApp(), { strict: true })
    await say('Sign me up')
    await t.stream('LLM', [askCall('a', 'Their name and email')])
    await composeWith(t, catalog, [{ part: 'contact' }])
    t.simulateEvent('.ask-card[data-card="a"] .name', 'input', { value: 'Ann' })
    await t.settle()
    t.simulateEvent('.ask-card[data-card="a"] .email', 'input', { value: 'ann@example.com' })
    await t.settle()
    // `local` lives on the part
    expect(openToolCalls(S())[0].ui.local.contact).toEqual({ name: 'Ann', email: 'ann@example.com' })
    t.simulateEvent('.ask-card[data-card="a"] .contact', 'submit')
    await waitUntil(() => chatReqs().length === 2)
    expect(toolPart(chatReqs()[1])[0].output).toEqual({ part: 'contact', answer: { name: 'Ann', email: 'ann@example.com' } })

    // the same turn goes on: a second card in the same message, a fresh scope
    await t.stream('LLM', [askCall('b', 'Confirm the revenue chart for the quarter')])
    await composeWith(t, catalog, [{ part: 'chart', params: { range: 'quarter' } }, { part: 'looksRight' }])
    expect(t.queryAll('.ask-card')).toHaveLength(2)
    expect(S().messages).toHaveLength(2)
    expect(t.query('.ask-card[data-card="a"] .name').value).toBe('Ann')   // the answered card keeps its values
    expect(t.query('.ask-card[data-card="b"] .chart').getAttribute('data-range')).toBe('quarter')
    t.simulateEvent('.ask-card[data-card="b"] .yes', 'click')
    await waitUntil(() => chatReqs().length === 3)
    expect(toolPart(chatReqs()[2]).map((p) => p.output.answer)).toEqual([{ name: 'Ann', email: 'ann@example.com' }, true])
    const ids = t.inspect().components.filter((c) => c.name === 'ContactForm' || c.name === 'LooksRight')
    expect(ids).toHaveLength(2)
  })

  it('a reload shows the answered card frozen, from the persisted messages alone', async () => {
    const App = makeChatApp()
    App.persist = persist({ key: 'chat', pick: ['assistant'] })
    t = renderComponent(App)
    await say('plans?')
    await t.stream('LLM', [askCall('x', 'Pick a plan')])
    await composeWith(t, catalog, [{ part: 'plans' }])
    t.simulateEvent('.plan[data-id="team"]', 'click')
    await waitUntil(() => chatReqs().length === 2)
    await t.stream('LLM', ['Team it is.'])
    await t.settle()
    expect(S().status).toBe('ready')
    const saved = t.storage('chat')
    t.dispose()

    t = renderComponent(App, { storage: { chat: saved } })
    await t.ready()
    expect(t.query('.ask-card').getAttribute('class')).toContain('answered')
    expect(t.query('.plan.picked').textContent).toContain('Team')
    expect(t.query('.plan[data-id="free"]').disabled).toBe(true)
    expect(t.html()).toContain('Team it is.')
    expect(t.actions.map((a) => a.type)).not.toContain('assistant.RESUME')
  })
})

describe('cards, decision backend: the LLM says what it needs, a decision model picks the parts', () => {
  it('composes the card from prepared parts with decide() on HTTP, then the answer goes back', async () => {
    t = renderComponent(makeChatApp({ backend: compose.decisions({ url: '/api/decide', model: 'nimble' }) }), { strict: true })
    await say('Help me choose')
    expect(t.requests('LLM')[0].tools.ask_user.inputSchema.required).toEqual(['need'])
    await t.stream('LLM', [askCall('d1', 'Let the user pick a pricing plan')])
    await t.settle()
    expect(openToolCalls(S())[0].ui.status).toBe('composing')
    const q = t.requests('HTTP').at(-1).json.questions
    expect(Object.keys(q)).not.toContain('use_choice')   // generated-text part: LLM only
    expect(JSON.stringify(t.requests('HTTP').at(-1).json)).toContain('Let the user pick a pricing plan')
    await composeWith(t, catalog, [{ part: 'plans' }])
    expect(openToolCalls(S())[0].ui.status).toBe('open')
    t.simulateEvent('.plan[data-id="biz"]', 'click')
    await waitUntil(() => chatReqs().length === 2)
    expect(toolPart(chatReqs()[1])[0].output).toEqual({ part: 'plans', answer: 'biz' })
    // the host heard the result part too (CHILD.select)
    expect(t.state.picked).toEqual(['biz'])
  })
})

// ------------------------------------------------------------------ more

describe('cards: composing, failing, cancelling', () => {
  it('several ask_user calls in one reply compose one at a time; answering both sends one request', async () => {
    t = renderComponent(makeChatApp())
    await say('Two things')
    await t.stream('LLM', [askCall('a', 'Pick a plan'), askCall('b', 'Does the chart look right?')])
    await t.settle()
    expect(t.requests('LLM').filter((r) => r.key?.startsWith('assistant.ask:')).map((r) => r.key)).toEqual(['assistant.ask:a'])
    await composeWith(t, catalog, [{ part: 'plans' }])
    expect(t.requests('LLM').filter((r) => r.key?.startsWith('assistant.ask:')).map((r) => r.key)).toEqual(['assistant.ask:a', 'assistant.ask:b'])
    expect(S().status).toBe('streaming')
    await composeWith(t, catalog, [{ part: 'chart' }, { part: 'looksRight' }])
    expect(S().status).toBe('ready')
    expect(openToolCalls(S()).map((p) => p.ui.status)).toEqual(['open', 'open'])
    t.simulateEvent('.ask-card[data-card="b"] .no', 'click')
    await t.settle()
    expect(chatReqs()).toHaveLength(1)
    t.simulateEvent('.ask-card[data-card="a"] .plan[data-id="free"]', 'click')
    await waitUntil(() => chatReqs().length === 2)
    expect(toolPart(chatReqs()[1]).map((p) => p.output)).toEqual([{ part: 'plans', answer: 'free' }, { part: 'looksRight', answer: false }])
  })

  it('G-756: a decision reply for a card closed while composing is dropped, not read as the next card\'s', async () => {
    const backend = compose.decisions({ url: '/api/decide', model: 'nimble' })
    t = renderComponent(makeChatApp({ backend }), { strict: true })
    await say('Two things')
    await t.stream('LLM', [askCall('a', 'Let the user pick a pricing plan'), askCall('b', 'Ask whether the revenue chart looks right')])
    await t.settle()
    const [a] = openToolCalls(S())
    expect(a.ui.status).toBe('composing')
    const reqA = t.requests('HTTP').at(-1)
    expect(reqA.key).toBe('assistant.ask:a')
    // card a's reply ("plans"), made for its own step
    const late = backend.fake({ catalog, state: t.state, pending: a.ui.pending, target: [{ part: 'plans' }] })
    // the app answers a's call itself while a still composes: b starts composing
    t.simulateAction('assistant.TOOL_OUTPUT', { toolCallId: 'a', output: { plan: 'team' } })
    await t.settle()
    expect(t.requests('HTTP').at(-1).key).toBe('assistant.ask:b')
    const pendingB = openToolCalls(S()).find((p) => p.toolCallId === 'b').ui.pending
    // a's reply arrives late: tagged with a's key, it is dropped (b keeps composing)
    await t.respond('HTTP', late, { request: reqA })
    await t.settle()
    const b = () => S().messages.at(-1).parts.find((p) => p.toolCallId === 'b')
    expect(b().ui.status).toBe('composing')
    expect(b().ui.pending).toEqual(pendingB)
    expect(b().ui.layout).toBeNull()
    // b's own reply opens it
    await t.respond('HTTP', backend.fake({ catalog, state: t.state, pending: pendingB, target: [{ part: 'looksRight' }] }), { request: t.requests('HTTP').at(-1) })
    await t.settle()
    expect(b().ui.status).toBe('open')
    expect(Object.values(b().ui.layout.nodes).map((n) => n.part)).toContain('looksRight')
    expect(t.requests('HTTP').map((r) => r.key)).toEqual(['assistant.ask:a', 'assistant.ask:b'])
    expect(S().messages.at(-1).parts.find((p) => p.toolCallId === 'a')).toMatchObject({ state: 'output-available', output: { plan: 'team' } })
  })

  it('failure: a compose request that fails closes the call ("could not show a card"), and the turn goes on', async () => {
    t = renderComponent(makeChatApp())
    await say('Ask me')
    await t.stream('LLM', [askCall('f', 'Pick a plan')])
    await t.settle()
    await t.fail('LLM', new Error('model overloaded'), 'assistant.CARD_FAILED')
    await waitUntil(() => chatReqs().length === 2)
    const [p] = toolPart(chatReqs()[1])
    expect(p).toMatchObject({ state: 'output-error', errorText: 'could not show a card: model overloaded; ask in text instead' })
    expect(S().messages.at(-1).parts.find((x) => x.toolCallId === 'f').ui.status).toBe('failed')
    expect(S().status).toBe('submitted')
  })

  it('failure: a reply that is not a layout, and a call with no `need`', async () => {
    t = renderComponent(makeChatApp())
    await say('Ask me')
    await t.stream('LLM', [askCall('f', 'Pick a plan'), { toolCall: { id: 'g', name: 'ask_user', input: {} } }])
    await t.settle()
    expect(openToolCalls(S()).map((p) => p.toolCallId)).toEqual(['f'])
    await t.respond('LLM', '{"children": [{"part": "nope"}]}', 'assistant.CARD')
    await waitUntil(() => chatReqs().length === 2)
    expect(toolPart(chatReqs()[1]).map((p) => [p.state, p.errorText.slice(0, 40)])).toEqual([
      ['output-error', 'could not show a card: The model\'s reply'],
      ['output-error', 'could not show a card: the call has no `'],
    ])
  })

  it('STOP while a card composes aborts its request (abort: [keys]) and cancels the card', async () => {
    t = renderComponent(makeChatApp())
    await say('Ask me')
    await t.stream('LLM', [askCall('s', 'Pick a plan')])
    await t.settle()
    expect(S().status).toBe('streaming')
    t.simulateEvent('.stop', 'click')
    await t.settle()
    expect(t.sinkValues('LLM').at(-1)).toEqual({ abort: ['assistant', 'assistant.ask:s'] })
    expect(S().status).toBe('ready')
    const p = S().messages.at(-1).parts.find((x) => x.toolCallId === 's')
    expect(p).toMatchObject({ state: 'output-error', errorText: 'not answered: stopped by the user', ui: { status: 'cancelled', pending: null } })
    // the request was aborted: nothing to answer
    expect(() => t.respond('LLM', '{"children":[{"part":"plans"}]}', 'assistant.CARD')).toThrow(/no pending LLM request/)
    expect(chatReqs()).toHaveLength(1)
  })

  it('STOP while the reply streams and nothing composes aborts only the reply (as before)', async () => {
    t = renderComponent(makeChatApp())
    await say('Hi')
    await t.stream('LLM', ['Hel'], { end: false })
    t.simulateEvent('.stop', 'click')
    await t.settle()
    expect(t.sinkValues('LLM').at(-1)).toEqual({ abort: 'assistant' })
  })

  it('SEND while a card is open cancels it; its result part can no longer answer (frozen)', async () => {
    t = renderComponent(makeChatApp())
    await say('Ask me')
    await t.stream('LLM', [askCall('o', 'Pick a plan')])
    await composeWith(t, catalog, [{ part: 'plans' }])
    await say('Never mind, I picked Free')
    const p = S().messages[1].parts.find((x) => x.toolCallId === 'o')
    expect(p).toMatchObject({ state: 'output-error', errorText: 'not answered: the user sent a new message', ui: { status: 'cancelled' } })
    expect(t.query('.ask-card fieldset.compose-frozen')).toBeTruthy()
  })

  it('a reload while a card composes composes it again; an open card stays answerable', async () => {
    const App = makeChatApp()
    App.persist = persist({ key: 'chat', pick: ['assistant'] })
    t = renderComponent(App)
    await say('plans?')
    await t.stream('LLM', [askCall('r', 'Pick a plan')])
    await t.settle()
    const saved = t.storage('chat')
    expect(saved.state.assistant.messages.at(-1).parts.at(-1).ui).toMatchObject({ status: 'composing', pending: { step: 'llm' } })
    t.dispose()

    t = renderComponent(App, { storage: { chat: saved } })
    await t.ready()
    await t.settle()
    expect(t.actions.map((a) => a.type)).toContain('assistant.RESUME')
    expect(S().status).toBe('streaming')
    expect(t.requests('LLM').map((r) => r.key)).toEqual(['assistant.ask:r'])
    await composeWith(t, catalog, [{ part: 'plans' }])
    expect(S().status).toBe('ready')
    await t.settle()
    const open = t.storage('chat')
    t.dispose()

    t = renderComponent(App, { storage: { chat: open } })
    await t.ready()
    expect(S().status).toBe('ready')
    t.simulateEvent('.plan[data-id="team"]', 'click')
    await waitUntil(() => chatReqs().length === 1)
    expect(toolPart(chatReqs()[0])[0].output).toEqual({ part: 'plans', answer: 'team' })
  })
})

describe('H-3 direct: the tool input is the card', () => {
  it('the layout schema is the input schema; the card opens with no compose round trip', async () => {
    t = renderComponent(makeChatApp({ direct: true }))
    await say('Which plan?')
    const schema = t.requests('LLM')[0].tools.ask_user.inputSchema
    expect(schema.properties.children).toBeTruthy()
    expect(JSON.stringify(schema)).toContain('"plans"')
    await t.stream('LLM', [{ toolCall: { id: 'd', name: 'ask_user', input: { children: [{ part: 'choice', question: 'Monthly or yearly?', options: ['Monthly', 'Yearly'] }] } } }])
    await t.settle()
    expect(t.requests('LLM')).toHaveLength(1)
    expect(S().status).toBe('ready')
    expect(t.query('.question').textContent).toBe('Monthly or yearly?')
    t.simulateEvent('.option[data-value="Yearly"]', 'click')
    await waitUntil(() => chatReqs().length === 2)
    expect(toolPart(chatReqs()[1])[0].output).toEqual({ part: 'choice', answer: 'Yearly' })
  })

  it('an input that is not a card closes the call at once, and the model gets the error', async () => {
    t = renderComponent(makeChatApp({ direct: true }))
    await say('Which plan?')
    await t.stream('LLM', [{ toolCall: { id: 'd', name: 'ask_user', input: { children: 'plans please' } } }])
    await waitUntil(() => chatReqs().length === 2)
    expect(toolPart(chatReqs()[1])[0]).toMatchObject({ state: 'output-error', errorText: expect.stringMatching(/^could not show a card: /) })
  })
})

describe('cards: rendering, diagnostics, exports', () => {
  it('a container control in a card sets ui on the part', async () => {
    const tabsCatalog = defineCatalog({
      parts: { plans: { component: PlanPicker, result: true, description: 'The plans', in: ['page', 'tabs'] }, chart: { component: Chart, description: 'A chart', in: ['page', 'tabs'] } },
      containers: {
        tabs: {
          description: 'Tabs', slots: { a: 'The first tab', b: 'The second tab' },
          render: ({ slots, ui, control }) => h('div', { className: 'tabs' }, h('button', { type: 'button', className: 'to-b', ...control('tab', 'b') }, 'B'), h('div', { className: 'body' }, ui.tab === 'b' ? slots.b : slots.a)),
        },
      },
    })
    t = renderComponent(makeChatApp({}, tabsCatalog))
    await say('Show me')
    await t.stream('LLM', [askCall('c', 'Plans and a chart')])
    await composeWith(t, tabsCatalog, [{ part: 'tabs', children: { a: [{ part: 'chart' }], b: [{ part: 'plans' }] } }])
    expect(t.query('.plans')).toBeNull()
    t.simulateEvent('.to-b', 'click')
    await t.settle()
    expect(openToolCalls(S())[0].ui.ui).toEqual({ tabs: { tab: 'b' } })
    expect(t.query('.plans')).toBeTruthy()
  })

  it('SYG686: an ask catalog with no result part; SYG160: a result part rendered outside a card', () => {
    _resetDiagnostics()
    configureDiagnostics({ mode: 'collect' })
    try {
      const plain = defineCatalog({ parts: { chart: { component: Chart, description: 'A chart' } } })
      chat({ ask: { catalog: plain } })
      expect(getDiagnostics().map((d) => d.code)).toEqual(['SYG686'])
      catalog.render({ layout: { root: 'page', nodes: { page: { part: 'page', slots: { default: ['plans'] } }, plans: { part: 'plans' } } } }, { plans: PLANS })
      expect(getDiagnostics().map((d) => d.code)).toEqual(['SYG686', 'SYG160'])
      expect(() => chat({ ask: { catalog: {} } })).toThrow(/defineCatalog/)
    } finally { _resetDiagnostics() }
  })

  it('askCard: null without a layout; exports from sygnal', () => {
    expect(askCard(catalog, {}, { toolCallId: 'x', ui: { status: 'composing', layout: null } })).toBeNull()
    expect(askCard(catalog, {}, { toolCallId: 'x' })).toBeNull()
    expect(sygnal.askCard).toBe(askCard)
  })
})
