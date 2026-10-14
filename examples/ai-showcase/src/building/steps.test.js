// The Building Chat steps without a model: t.stream answers the chat's requests (and the
// follow-up suggestions'), t.fail fails one, and the agent's tools are called as the model would.
import { it, expect, afterEach, describe } from 'vitest'
import { renderComponent } from 'sygnal'
import Step1 from './01-streaming.jsx'
import Step2 from './02-stop-retry.jsx'
import Step3 from './03-thinking.jsx'
import Step4 from './04-follow-ups.jsx'
import Step5 from './05-remember.jsx'
import Step6 from './06-sees-the-page.jsx'
import Step7 from './07-changes-the-page.jsx'
import Step8 from './08-answers-with-a-click.jsx'

let t
afterEach(() => { t?.dispose(); t = null })

const chatRequests = () => t.requests('LLM').filter((r) => r.key === 'chat')
const appState = (request) => request.messages.find((m) => m.id === 'sygnal-app-state')

/** type a prompt and send it */
async function send(text) {
  t.simulateEvent('.prompt', 'input', { value: text })
  t.simulateEvent('.ask', 'submit')
  await t.waitForState((s) => s.chat.status === 'submitted' && s.chat.messages.at(-1)?.role === 'user')
}

describe('1: a streaming chat', () => {
  it('an example fills the prompt without sending; Send streams the reply', async () => {
    t = renderComponent(Step1)
    t.simulateEvent('.example', 'click', { dataset: { prompt: 'Hello there' } })
    await t.settle()
    expect(t.state.chat.prompt).toBe('Hello there')
    expect(t.requests('LLM')).toHaveLength(0)

    t.simulateEvent('.ask', 'submit')
    await t.waitForState((s) => s.chat.status === 'submitted')
    expect(chatRequests()[0]).not.toHaveProperty('tools')   // agent: false
    await t.stream('LLM', ['Hi', ' you'], 'chat', { end: false })
    expect(t.query('.msg.assistant.streaming').textContent).toBe('Hi you')
    await t.stream('LLM', ['!'], 'chat')
    await t.settle()
    expect(t.queryAll('.msg').map((m) => m.textContent)).toEqual(['Hello there', 'Hi you!'])
    t.expectNoDiagnostics()
  })
})

describe('2: stop, retry, start over', () => {
  it('Stop keeps the partial reply; a failure offers Try again, which sends the message again', async () => {
    t = renderComponent(Step2)
    await send('Tell me a story')
    await t.stream('LLM', ['Once upon'], 'chat', { end: false })
    t.simulateEvent('.stop', 'click')
    await t.waitForState((s) => s.chat.status === 'ready')
    expect(t.state.chat.messages.at(-1).parts.at(-1).text).toBe('Once upon')

    await send('Another one')
    await t.fail('LLM', 429, 'chat')
    expect(t.query('.status-line.error')).toBeTruthy()
    expect(t.query('.retry').textContent).toContain('Try again')
    t.simulateEvent('.retry', 'click')
    await t.waitForState((s) => s.chat.status === 'submitted')
    expect(chatRequests().at(-1).messages.at(-1)).toMatchObject({ role: 'user' })
    await t.stream('LLM', ['The end.'], 'chat')
    await t.settle()

    t.simulateEvent('.clear', 'click')
    await t.settle()
    expect(t.state.chat.messages).toEqual([])
    t.expectNoDiagnostics()
  })
})

describe('3: show the thinking, count the tokens', () => {
  it('streams the reasoning before the text, keeps it on the reply, and tallies the usage', async () => {
    t = renderComponent(Step3)
    await send('Is 9.11 bigger than 9.9?')
    await t.stream('LLM', [{ reasoning: 'Compare the decimals.' }], 'chat', { end: false })
    expect(t.query('details.reasoning').getAttribute('open')).not.toBeNull()
    expect(t.query('details.reasoning').textContent).toContain('Compare the decimals.')
    await t.stream('LLM', ['No: 9.9 is bigger.', { finish: { reason: 'stop', usage: { inputTokens: 40, outputTokens: 30, reasoningTokens: 20 } } }], 'chat')
    await t.settle()
    expect(t.query('.msg.assistant details.reasoning summary').textContent).toBe('Thought it through')
    expect(t.query('.msg.assistant').textContent).toContain('No: 9.9 is bigger.')
    expect(t.state.usage).toEqual({ replies: 1, input: 40, output: 30, reasoning: 20 })
    expect(t.query('.bc-meter').textContent).toContain('40')
    t.expectNoDiagnostics()
  })
})

describe('4: suggested follow-ups', () => {
  it('asks for follow-ups with a schema after each reply; a chip fills the prompt', async () => {
    t = renderComponent(Step4)
    await send('What is a good first houseplant?')
    await t.stream('LLM', ['A pothos.'], 'chat')
    await t.waitForState(() => t.requests('LLM').some((r) => r.key === 'follow-ups'))
    const request = t.requests('LLM').find((r) => r.key === 'follow-ups')
    expect(request.output).toBeTruthy()
    expect(request.messages.at(-1).content).toMatch(/questions I might ask/)
    expect(t.query('.follow-ups').textContent).toContain('Suggesting')

    await t.stream('LLM', [JSON.stringify({ questions: ['How often do I water it?', 'Does it need sun?'] })], 'follow-ups')
    await t.settle()
    expect(t.queryAll('.suggested').map((b) => b.textContent)).toEqual(['How often do I water it?', 'Does it need sun?'])
    t.simulateEvent('.suggested', 'click', { dataset: { prompt: 'Does it need sun?' } })
    await t.settle()
    expect(t.state.chat.prompt).toBe('Does it need sun?')

    // a new message hides them
    t.simulateEvent('.ask', 'submit')
    await t.waitForState((s) => s.chat.status === 'submitted')
    expect(t.query('.follow-ups')).toBeNull()
    t.expectNoDiagnostics()
  })
})

describe('5: remember the conversation', () => {
  it('saves the conversation and brings it back; New chat starts over', async () => {
    const storage = {}
    t = renderComponent(Step5, { storage })
    await send('My name is Sam.')
    await t.stream('LLM', ['Hi Sam!'], 'chat')
    await t.settle()
    expect(t.storage('building-chat:5').state.chat.messages).toHaveLength(2)
    t.dispose()

    t = renderComponent(Step5, { storage })
    await t.ready()
    expect(t.queryAll('.msg').map((m) => m.textContent)).toEqual(['My name is Sam.', 'Hi Sam!'])
    t.simulateEvent('.clear', 'click')
    await t.settle()
    expect(t.state.chat.messages).toEqual([])
    expect(t.state.usage.replies).toBe(0)
    t.expectNoDiagnostics()
  })
})

describe('6: it sees the page', () => {
  it('sends the answer style with every request, as it is now', async () => {
    t = renderComponent(Step6)
    await send('Introduce yourself.')
    expect(appState(chatRequests()[0]).content ?? JSON.stringify(appState(chatRequests()[0]))).toContain('friendly')
    await t.stream('LLM', ['Hello!'], 'chat')
    await t.settle()

    t.simulateEvent('.tone', 'click', { dataset: { value: 'pirate' } })
    await t.settle()
    expect(t.query('.tone[aria-pressed="true"]').textContent).toBe('Pirate')
    await send('Again, please.')
    expect(JSON.stringify(appState(chatRequests().at(-1)))).toContain('pirate')
    t.expectNoDiagnostics()
  })
})

describe('7: it changes the page', () => {
  it('offers the actions as tools, and asks before clearing the list', async () => {
    t = renderComponent(Step7)
    expect(t.tools().map((tool) => tool.name)).toEqual(expect.arrayContaining(['page_add_items', 'page_check_item', 'page_set_style']))
    expect(t.tools().map((tool) => tool.name)).not.toContain('page_clear_list')   // `when`: the list is empty

    await send('Add guacamole things')
    await t.stream('LLM', [{ toolCall: { id: 'a', name: 'page_add_items', input: { items: ['avocados', 'limes', 'onions'] } } }], 'chat')
    await t.waitForState((s) => s.list.length === 3)
    await t.waitForState(() => chatRequests().length === 2)
    await t.stream('LLM', ['Added three things.'], 'chat')
    await t.settle()
    expect(t.queryAll('.bc-list .item').map((i) => i.textContent)).toEqual(['avocados', 'limes', 'onions'])
    expect(t.query('.tool-line').textContent).toContain('✓ Add to the list')

    // a click and a call go through the same kind of reducer
    t.simulateEvent('.item', 'click', { dataset: { id: 1 } })
    await t.settle()
    expect(t.state.list[0].done).toBe(true)
    expect(await t.callTool('page_check_item', { id: 9, done: true })).toMatchObject({ ok: false })

    await send('Clear my list')
    await t.stream('LLM', [{ toolCall: { id: 'c', name: 'page_clear_list', input: {} } }], 'chat', { end: true })
    await t.waitForState((s) => s.chat.pending)
    expect(t.query('.confirm-box').textContent).toContain('Remove every item')
    t.simulateEvent('.approve', 'click')
    await t.waitForState((s) => s.list.length === 0)
    t.expectNoDiagnostics()
  })
})

describe('8: answers with a click', () => {
  it('renders a choose call as buttons; the click is the tool output', async () => {
    t = renderComponent(Step8)
    await send('Help me pick a dinner')
    expect(chatRequests()[0].tools).toHaveProperty('choose')
    await t.stream('LLM', [{ toolCall: { id: 'q', name: 'choose', input: { question: 'Which dinner?', options: ['Tacos', 'Pasta'] } } }], 'chat')
    await t.settle()
    expect(t.query('.bc-choice b').textContent).toBe('Which dinner?')
    expect(t.queryAll('.pick').map((b) => b.textContent)).toEqual(['Tacos', 'Pasta'])
    expect(t.query('.retry')).toBeNull()   // the call waits for a pick

    t.simulateEvent('.pick', 'click', { dataset: { call: 'q', option: 'Tacos' } })
    await t.waitForState(() => chatRequests().length === 2)
    const answered = chatRequests().at(-1).messages.flatMap((m) => m.parts ?? []).find((p) => p.toolCallId === 'q')
    expect(answered.output).toEqual({ picked: 'Tacos' })
    expect(t.query('.pick.picked').textContent).toBe('Tacos')
    expect(t.query('.pick').disabled).toBe(true)
    t.expectNoDiagnostics()
  })
})
