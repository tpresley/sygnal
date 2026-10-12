// The app without a model: t.stream answers the chat's requests, composeWith answers a card's
// composition with each backend's own fake reply (the layout JSON for the chat model, decide()
// answers for a decision model), and the backend reads it as it would a real one.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { composeWith, openToolCalls } from 'sygnal/ai'
import App from './App.jsx'
import { catalog } from './cards.jsx'

// GET /api/tags: two chat models that call tools, one that doesn't, a decision model, an embedding model
const TAGS = {
  models: [
    { name: 'llama3.2:latest', capabilities: ['completion', 'tools'] },
    { name: 'qwen3:8b', capabilities: ['completion', 'tools', 'thinking'] },
    { name: 'mistral:text', capabilities: ['completion'] },
    { name: 'nimble:latest', capabilities: ['decision'] },
    { name: 'nomic-embed-text:latest', capabilities: ['embedding'] },
  ],
}

let t
afterEach(() => { t?.dispose(); t = null })

const A = () => t.state.assistant
const chatReqs = () => t.requests('LLM').filter((r) => r.key === 'assistant')
const cardReqs = (sink = 'LLM') => t.requests(sink).filter((r) => r.key?.startsWith('assistant.ask:'))
const askPart = (req, id) => req.messages.flatMap((m) => m.parts || []).find((p) => p.type === 'tool-ask_user' && (!id || p.toolCallId === id))
const askCall = (id, need) => ({ toolCall: { id, name: 'ask_user', input: { need } } })

async function start({ cards, jev = false, storage } = {}) {
  t = renderComponent(App, { strict: true, ...(storage && { storage }) })
  await t.respond('HTTP', TAGS, 'models')
  if (jev) await t.respond('HTTP', { available: true }, 'jev')
  else await t.fail('HTTP', 404, 'jev')
  await t.waitForState((s) => !!s.chatModel && !!s.cards)
  await t.settle()
  if (cards) {
    t.simulateEvent('.card-backend', 'change', { value: cards })
    await t.waitForState((s) => s.cards.id === cards)
    await t.settle()
  }
}

async function say(text) {
  t.simulateEvent('.prompt', 'input', { value: text })
  t.simulateEvent('.ask', 'submit')
  await t.next((s) => s.assistant.status === 'submitted')
}

async function until(f, tries = 50) {
  for (let i = 0; i < tries && !f(); i++) await t.settle()
  if (!f()) throw new Error('timed out')
}

describe('the pickers', () => {
  it('offers the chat models that call tools (qwen3:8b first) and the card backends', async () => {
    await start()
    expect(t.state.chatModel).toBe('qwen3:8b')
    expect(t.state.cards).toMatchObject({ id: 'llm', kind: 'llm' })
    const html = t.html()
    expect(html).toContain('<option value="qwen3:8b" selected')
    expect(html).toContain('llama3.2:latest')
    expect(html).not.toContain('mistral:text')
    expect(html).toContain('<option value="nimble:latest">nimble:latest (decision model)')
    expect(html).not.toContain('Jev')
    t.expectNoDiagnostics()
  })

  it('switching the chat model keeps the conversation: the next requests and cards name the new model', async () => {
    await start()
    await say('Hi')
    await t.stream('LLM', ['Hello.'])
    await t.settle()
    t.simulateEvent('.chat-model', 'change', { value: 'llama3.2:latest' })
    await t.waitForState((s) => s.chatModel === 'llama3.2:latest')
    await say('Which plan?')
    expect(chatReqs().map((r) => r.model)).toEqual(['qwen3:8b', 'llama3.2:latest'])
    expect(A().messages.length).toBe(3)                  // the same conversation
    await t.stream('LLM', [askCall('m', 'Pick a plan')])
    await t.settle()
    expect(cardReqs().at(-1).model).toBe('llama3.2:latest')
    await composeWith(t, catalog, [{ part: 'plans' }])
    expect(t.query('.what-happened .happened').textContent).toContain('by llama3.2:latest')
  })
})

describe('cards composed by the chat model (compose.llm)', () => {
  it('ask → card → answer → the model continues, grounded in the app state', async () => {
    await start()
    await say('Which plan should I take?')
    const first = chatReqs()[0]
    expect(first.model).toBe('qwen3:8b')
    expect(Object.keys(first.tools)).toEqual(expect.arrayContaining(['ask_user', 'billing_choose_plan']))
    // the agent's read goes with the request: the real prices
    expect(first.messages[0].parts[0].text).toContain('"pricePerSeatPerMonthUSD":12')

    await t.stream('LLM', ['Let me ask. ', askCall('c1', 'Pick the plan you want')])
    await t.settle()
    expect(t.query('.ask-card.composing .need').textContent).toBe('Pick the plan you want')
    const card = cardReqs().at(-1)
    expect(card).toMatchObject({ key: 'assistant.ask:c1', model: 'qwen3:8b' })
    expect(card.messages.at(-1)).toEqual({ role: 'user', content: 'Pick the plan you want' })

    await composeWith(t, catalog, [{ part: 'plans' }])
    expect(A().status).toBe('ready')
    expect(t.queryAll('.ask-card.open .plan')).toHaveLength(3)
    expect(t.query('.what-happened .happened').textContent).toContain('plans')
    expect(t.query('.what-happened .happened').textContent).toContain('by qwen3:8b')
    expect(t.query('.what-happened .why').textContent).toMatch(/^Plan: /)

    t.simulateEvent('.plan[data-id="team"]', 'click')
    await until(() => chatReqs().length === 2)
    expect(askPart(chatReqs()[1]).output).toEqual({ part: 'plans', answer: 'team' })
    expect(t.query('.ask-card').getAttribute('class')).toContain('answered')
    expect(t.query('.plan.picked').getAttribute('data-id')).toBe('team')
    expect(t.query('.plan[data-id="free"]').disabled).toBe(true)
    expect(t.query('.what-happened .output').textContent).toBe('{"part":"plans","answer":"team"}')

    // the model acts on the answer: the agent action switches the plan, then it says so
    await t.stream('LLM', [{ toolCall: { id: 'c2', name: 'billing_choose_plan', input: { value: 'team' } } }])
    await until(() => chatReqs().length === 3)
    expect(t.state.plan).toBe('team')
    await t.stream('LLM', ['Done: you are on Team, $12 per seat a month.'])
    await t.settle()
    expect(A().status).toBe('ready')
    expect(t.query('.current-plan').textContent).toBe('Team')
    expect(t.html()).toContain('Done: you are on Team')
  })

  it('a generated choice (LLM-only params) and a contact form with its own state', async () => {
    await start()
    await say('I want to talk to sales')
    await t.stream('LLM', [askCall('q', 'How many people will use it?')])
    await composeWith(t, catalog, [{ part: 'choice', params: { question: 'How many people?', options: ['Just me', '2 to 10', 'More than 10'] } }])
    expect(t.query('.question').textContent).toBe('How many people?')
    t.simulateEvent('.option[data-value="More than 10"]', 'click')
    await until(() => chatReqs().length === 2)
    expect(askPart(chatReqs()[1], 'q').output).toEqual({ part: 'choice', answer: 'More than 10' })

    await t.stream('LLM', ['Business fits. ', askCall('c', 'Your name and email, so sales can reach you')])
    await composeWith(t, catalog, [{ part: 'plan', params: { plan: 'business' } }, { part: 'contact' }])
    expect(t.query('.plan-details').textContent).toContain('$30 per seat a month')
    const card = '.ask-card[data-card="c"]'
    expect(t.query(`${card} .send`).disabled).toBe(true)
    t.simulateEvent(`${card} .name`, 'input', { value: 'Ann' })
    await t.settle()
    t.simulateEvent(`${card} .email`, 'input', { value: 'ann@example.com' })
    await t.settle()
    expect(openToolCalls(A())[0].ui.local.contact).toEqual({ name: 'Ann', email: 'ann@example.com' })
    t.simulateEvent(`${card} .contact`, 'submit')
    await until(() => chatReqs().length === 3)
    expect(askPart(chatReqs()[2], 'c').output).toEqual({ part: 'contact', answer: { name: 'Ann', email: 'ann@example.com' } })
    // the host heard the result part too
    expect(t.state.leads).toEqual([{ name: 'Ann', email: 'ann@example.com' }])
    expect(t.query('.account').textContent).toContain('sales will write to ann@example.com')
  })

  it('a failed composition: the call closes with the error, so the model is told and can ask in text', async () => {
    await start()
    await say('Ask me something')
    await t.stream('LLM', [askCall('f', 'Pick a plan')])
    await t.settle()
    await t.fail('LLM', new Error('model overloaded'), 'assistant.CARD_FAILED')
    await until(() => chatReqs().length === 2)
    expect(askPart(chatReqs()[1], 'f')).toMatchObject({ state: 'output-error', errorText: 'could not show a card: model overloaded; ask in text instead' })
    expect(t.query('.ask-card').getAttribute('class')).toContain('failed')
    expect(t.query('.ask-card .card-status').textContent).toBe('Could not show a card: model overloaded; ask in text instead')
    expect(t.query('.what-happened .output.error').textContent).toContain('model overloaded')
    await t.stream('LLM', ['Which plan would you like: Free, Team or Business?'])
    await t.settle()
    expect(A().status).toBe('ready')
  })

  it('a reply that is no card fails the same way', async () => {
    await start()
    await say('Ask me something')
    await t.stream('LLM', [askCall('f', 'Pick a plan')])
    await t.settle()
    await t.respond('LLM', 'Sure! Here are the plans: Free, Team, Business.', 'assistant.CARD')
    await until(() => chatReqs().length === 2)
    expect(askPart(chatReqs()[1], 'f')).toMatchObject({ state: 'output-error', errorText: expect.stringMatching(/^could not show a card: /) })
  })
})

describe('cards composed by a decision model (compose.decisions)', () => {
  it('nimble picks prepared parts with decide() on Ollama; the answer goes back to the chat model', async () => {
    await start({ cards: 'nimble:latest' })
    await say('Switch me to Team')
    await t.stream('LLM', ['Let me confirm. ', askCall('d', 'Confirm the switch to the Team plan')])
    await t.settle()
    expect(openToolCalls(A())[0].ui.status).toBe('composing')
    const decide = t.requests('HTTP').at(-1)
    expect(decide).toMatchObject({ url: 'http://localhost:11434/v1/systemone', key: 'assistant.ask:d', json: { model: 'nimble:latest' } })
    expect(Object.keys(decide.json.questions)).not.toContain('use_choice')   // generated text: LLM only
    expect(JSON.stringify(decide.json)).toContain('Confirm the switch to the Team plan')
    expect(cardReqs('LLM')).toHaveLength(0)

    await composeWith(t, catalog, [{ part: 'plan', params: { plan: 'team' } }, { part: 'confirm' }])
    expect(openToolCalls(A())[0].ui.status).toBe('open')
    expect(t.query('.plan-details').getAttribute('data-plan')).toBe('team')
    const panel = t.query('.what-happened').textContent
    expect(panel).toContain('Card plan[plan=team], confirm')
    expect(panel).toContain('by nimble:latest')
    // the decision model's answers: the parts it used, and the record it picked
    expect(t.queryAll('.what-happened .picks .used').map((li) => li.textContent)).toEqual(['confirm 100%', 'plan: team 100%'])

    t.simulateEvent('.yes', 'click')
    await until(() => chatReqs().length === 2)
    expect(askPart(chatReqs()[1], 'd').output).toEqual({ part: 'confirm', answer: true })
    expect(t.query('.yes').getAttribute('class')).toContain('picked')
    t.expectNoDiagnostics()
  })

  it('Jev, when the dev proxy has a key: decide() goes to /api/decide, with no key in the browser', async () => {
    await start({ jev: true, cards: 'jev' })
    await say('Rate us')
    await t.stream('LLM', [askCall('r', 'How satisfied are you so far?')])
    await t.settle()
    const decide = t.requests('HTTP').at(-1)
    expect(decide).toMatchObject({ url: '/api/decide', json: { model: 'jev-latest' } })
    expect(JSON.stringify(decide)).not.toMatch(/authorization|bearer/i)
    await composeWith(t, catalog, [{ part: 'rating' }])
    t.simulateEvent('.star[data-n="4"]', 'click')
    await until(() => chatReqs().length === 2)
    expect(askPart(chatReqs()[1], 'r').output).toEqual({ part: 'rating', answer: 4 })
    expect(t.state.rating).toBe(4)
    expect(t.queryAll('.star.on')).toHaveLength(4)
  })
})

describe('stopping and moving on', () => {
  it('Stop while a card composes aborts its request and cancels the card', async () => {
    await start()
    await say('Ask me')
    await t.stream('LLM', [askCall('s', 'Pick a plan')])
    await t.settle()
    expect(t.query('.stop').hidden).toBe(false)
    t.simulateEvent('.stop', 'click')
    await t.settle()
    expect(t.sinkValues('LLM').at(-1)).toEqual({ abort: ['assistant', 'assistant.ask:s'] })
    expect(A().status).toBe('ready')
    expect(openToolCalls(A())).toHaveLength(0)
    expect(A().messages.at(-1).parts.find((p) => p.toolCallId === 's')).toMatchObject({ errorText: 'not answered: stopped by the user', ui: { status: 'cancelled' } })
    expect(t.query('.ask-card .card-status').textContent).toBe('Not answered')
    expect(chatReqs()).toHaveLength(1)
  })

  it('Skip while a card is open closes it unanswered and freezes it', async () => {
    await start()
    await say('Ask me')
    await t.stream('LLM', [askCall('o', 'Pick a plan')])
    await composeWith(t, catalog, [{ part: 'plans' }])
    expect(t.query('.stop').textContent).toBe('Skip the card')
    t.simulateEvent('.stop', 'click')
    await t.settle()
    expect(A().messages.at(-1).parts.find((p) => p.toolCallId === 'o').ui.status).toBe('cancelled')
    expect(t.query('.ask-card fieldset.compose-frozen')).toBeTruthy()
    expect(t.query('.stop').hidden).toBe(true)
  })

  it('a new message cancels the open card; the model sees it went unanswered', async () => {
    await start()
    await say('Ask me')
    await t.stream('LLM', [askCall('o', 'Pick a plan')])
    await composeWith(t, catalog, [{ part: 'plans' }])
    await say('Never mind, Free is fine')
    expect(askPart(chatReqs()[1], 'o')).toMatchObject({ state: 'output-error', errorText: 'not answered: the user sent a new message' })
    expect(t.query('.ask-card').getAttribute('class')).toContain('cancelled')
    expect(t.query('.plan[data-id="team"]').disabled).toBe(true)
  })

  it('New conversation clears the messages', async () => {
    await start()
    await say('Hi')
    await t.stream('LLM', ['Hello!'])
    await t.settle()
    expect(t.query('.examples').hidden).toBe(true)
    t.simulateEvent('.new-chat', 'click')
    await t.settle()
    expect(A().messages).toEqual([])
    expect(t.query('.examples').hidden).toBe(false)
  })
})

describe('the conversation persists', () => {
  it('a reload shows an answered card frozen with its pick', async () => {
    await start()
    await say('Which plan?')
    await t.stream('LLM', [askCall('x', 'Pick a plan')])
    await composeWith(t, catalog, [{ part: 'plans' }])
    t.simulateEvent('.plan[data-id="business"]', 'click')
    await until(() => chatReqs().length === 2)
    await t.stream('LLM', ['Business it is.'])
    await t.settle()
    const saved = t.storage('ai-ask')
    t.dispose()

    await start({ storage: { 'ai-ask': saved } })
    expect(t.query('.ask-card').getAttribute('class')).toContain('answered')
    expect(t.query('.plan.picked').getAttribute('data-id')).toBe('business')
    expect(t.query('.plan[data-id="free"]').disabled).toBe(true)
    expect(t.html()).toContain('Business it is.')
    expect(t.query('.what-happened .output').textContent).toBe('{"part":"plans","answer":"business"}')
    expect(t.requests('LLM')).toHaveLength(0)
  })

  it('a reload with an open card: still answerable, and the answer continues the conversation', async () => {
    await start({ cards: 'nimble:latest' })
    await say('Which plan?')
    await t.stream('LLM', [askCall('y', 'Pick a plan')])
    await composeWith(t, catalog, [{ part: 'plans' }])
    await t.settle()
    const saved = t.storage('ai-ask')
    expect(saved.state.cards.id).toBe('nimble:latest')
    t.dispose()

    await start({ storage: { 'ai-ask': saved } })
    expect(t.state.cards.id).toBe('nimble:latest')
    expect(A().status).toBe('ready')
    expect(t.query('.ask-card').getAttribute('class')).toContain('open')
    t.simulateEvent('.plan[data-id="team"]', 'click')
    await until(() => chatReqs().length === 1)
    expect(askPart(chatReqs()[0], 'y').output).toEqual({ part: 'plans', answer: 'team' })
  })
})

describe('the agent declaration', () => {
  it('reads the plans with their prices and the current plan; billing_choose_plan switches it', async () => {
    await start()
    expect(t.tools().map((x) => x.name)).toEqual(expect.arrayContaining(['billing_read', 'billing_choose_plan']))
    const read = await t.callTool('billing_read')
    expect(read.state.currentPlan).toBe('free')
    expect(read.state.plans.map((p) => [p.id, p.pricePerSeatPerMonthUSD])).toEqual([['free', 0], ['team', 12], ['business', 30]])
    const r = await t.callTool('billing_choose_plan', { value: 'business' })
    expect(r.ok).toBe(true)
    expect(t.state.plan).toBe('business')
    expect((await t.callTool('billing_choose_plan', { value: 'gold' })).ok).toBe(false)
  })
})
