import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent, persist } from 'sygnal'
import { makeChatApp, chatCatalog } from './app/ChatApp.jsx'
import { decisions } from './lib/backends.js'
import { composeWith } from './lib/testing.js'

let t
afterEach(() => t?.dispose())

const toolPart = (req) => req.messages.flatMap((m) => m.parts || []).filter((p) => p.type === 'tool-ui_cards_ask')

async function say(text) {
  t.simulateEvent('.prompt', 'input', { value: text })
  t.simulateEvent('.ask', 'submit')
  await t.next((s) => s.assistant.status === 'submitted')
}

describe('in-chat agent UI, LLM backend: the tool input is the layout', () => {
  it('renders the card inline, the click is the tool result, the chat continues', async () => {
    t = renderComponent(makeChatApp(), { strict: true })
    await say('Which plan should I take?')
    const first = t.requests('LLM')[0]
    expect(first.tools.ui_cards_ask.inputSchema.$defs.node.anyOf.map((v) => v.properties.part.const)).toContain('plans')

    // the model asks with a card: a generated question + the prepared plan picker
    await t.stream('LLM', [{ toolCall: { id: 'call1', name: 'ui_cards_ask', input: { page: [
      { part: 'choice', params: { question: 'How many people will use it?', options: ['Just me', '2–10', 'More'] } },
    ] } } }])
    await t.waitForState((s) => s.cards.open === 'c1')
    expect(t.query('.msg.assistant .question').textContent).toBe('How many people will use it?')
    expect(t.state.assistant.status).toBe('streaming')        // the call waits for the user
    expect(t.requests('LLM')).toHaveLength(1)

    t.simulateEvent('.option[data-value="2–10"]', 'click')
    await t.waitForState((s) => t.requests('LLM').length === 2)
    const [part] = toolPart(t.requests('LLM')[1])
    expect(part.state).toBe('output-available')
    expect(part.output).toEqual({ ok: true, state: { card: 'c1', status: 'answered', part: 'choice', answer: '2–10' } })

    // frozen: a second click changes nothing
    expect(t.query('.ask-card').getAttribute('class')).toContain('answered')
    expect(t.query('fieldset.compose-frozen')).toBeTruthy()
    t.simulateEvent('.option[data-value="More"]', 'click')
    await t.settle()
    expect(t.state.cards.byId.c1.answer.value).toBe('2–10')
    expect(t.requests('LLM')).toHaveLength(2)
    await t.stream('LLM', ['Then Team is the right plan.'])
    await t.waitForState((s) => s.assistant.status === 'ready')
    expect(t.html()).toContain('Then Team is the right plan.')
    t.expectNoDiagnostics()
  })

  it('many cards, one per message: each has its own scope (instance ids, local form state)', async () => {
    t = renderComponent(makeChatApp(), { strict: true })
    await say('Sign me up')
    await t.stream('LLM', [{ toolCall: { id: 'a', name: 'ui_cards_ask', input: { page: [{ part: 'contact' }] } } }])
    await t.waitForState((s) => s.cards.open === 'c1')
    t.simulateEvent('.ask-card[data-card="c1"] .name', 'input', { value: 'Ann' })
    await t.next((s) => s.cards.byId.c1.local.contact?.name === 'Ann')
    t.simulateEvent('.ask-card[data-card="c1"] .email', 'input', { value: 'ann@example.com' })
    await t.next((s) => s.cards.byId.c1.local.contact?.email === 'ann@example.com')
    t.simulateEvent('.ask-card[data-card="c1"] .contact', 'submit')
    await t.waitForState(() => t.requests('LLM').length === 2)
    expect(toolPart(t.requests('LLM')[1])[0].output.state.answer).toEqual({ name: 'Ann', email: 'ann@example.com' })

    // the same turn goes on: a second card, the same part, a fresh scope
    await t.stream('LLM', [{ toolCall: { id: 'b', name: 'ui_cards_ask', input: { page: [{ part: 'chart', params: { range: 'quarter' } }, { part: 'looksRight' }] } } }])
    await t.waitForState((s) => s.cards.open === 'c2')
    expect(t.queryAll('.ask-card')).toHaveLength(2)
    expect(t.query('.ask-card[data-card="c1"] .name').value).toBe('Ann')   // the answered card keeps its values
    t.simulateEvent('.ask-card[data-card="c2"] .yes', 'click')
    await t.waitForState(() => t.requests('LLM').length === 3)
    expect(toolPart(t.requests('LLM')[2]).map((p) => p.output.state.answer)).toEqual([{ name: 'Ann', email: 'ann@example.com' }, true])
    const ids = t.inspect().components.filter((c) => c.name === 'ContactForm' || c.name === 'LooksRight')
    expect(ids).toHaveLength(2)
  })

  it('a reload shows the answered card frozen, from persisted messages + cards', async () => {
    const App = makeChatApp()
    App.persist = persist({ key: 'chat', pick: ['assistant', 'cards'] })
    t = renderComponent(App)
    await say('plans?')
    await t.stream('LLM', [{ toolCall: { id: 'x', name: 'ui_cards_ask', input: { page: [{ part: 'plans' }] } } }])
    await t.waitForState((s) => s.cards.open === 'c1')
    t.simulateEvent('.plan[data-id="team"]', 'click')
    await t.waitForState(() => t.requests('LLM').length === 2)
    await t.stream('LLM', ['Team it is.'])
    await t.waitForState((s) => s.assistant.status === 'ready')
    await t.settle()
    const saved = t.storage('chat')
    t.dispose()

    t = renderComponent(App, { storage: { chat: saved } })
    await t.ready()
    expect(t.query('.ask-card').getAttribute('class')).toContain('answered')
    expect(t.query('.plan.picked').textContent).toContain('Team')
    expect(t.query('.plan[data-id="free"]').disabled).toBe(true)
    expect(t.html()).toContain('Team it is.')
  })
})

describe('in-chat agent UI, decision backend: the LLM names the request, a decision model picks parts', () => {
  it('composes the card from prepared parts with decide(), then the answer goes back', async () => {
    t = renderComponent(makeChatApp(decisions({ url: '/api/decide', model: 'nimble' })), { strict: true })
    await say('Help me choose')
    expect(t.requests('LLM')[0].tools.ui_cards_ask.inputSchema.required).toEqual(['request'])
    await t.stream('LLM', [{ toolCall: { id: 'd1', name: 'ui_cards_ask', input: { request: 'Let the user pick a pricing plan' } } }])
    await t.waitForState((s) => s.cards.byId.c1?.status === 'composing')
    const q = t.requests('HTTP').at(-1).json.questions
    expect(Object.keys(q)).not.toContain('use_choice')   // generated-text part: LLM only
    await composeWith(t, chatCatalog, [{ part: 'plans' }])
    await t.waitForState((s) => s.cards.byId.c1.status === 'open')
    t.simulateEvent('.plan[data-id="biz"]', 'click')
    await t.waitForState(() => t.requests('LLM').length === 2)
    expect(toolPart(t.requests('LLM')[1])[0].output.state).toMatchObject({ part: 'plans', answer: 'biz' })
  })
})
