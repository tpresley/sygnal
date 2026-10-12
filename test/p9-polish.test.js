// PLAN-9 polish (Phase 3):
// - a card keeps its backend's `decisions` on `part.ui.decisions` (as a compose slice keeps them),
//   through a reload;
// - `chat({ model })` and `compose.llm({ model })` take a function of the host's state, resolved per
//   request (one chat behavior for an app's model picker; the default card backend follows it);
// - `asked_for` items may be as long as the longest text param (a 60-character cap cut a
//   120-character choice question under Ollama's grammar: the model copies its plan into the text);
//   a text param without a label reads "question; short text, …", not "question: undefined".
import { it, expect, afterEach, describe } from 'vitest'
import { renderComponent } from '../src/extra/testing.ts'
import { persist } from '../src/extra/persist.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { chat, openToolCalls } from '../src/extra/ai/chat/behavior.ts'
import { defineCatalog, compose, composeWith, askCard } from '../src/extra/ai/compose/index.ts'
import { layoutSchema, llm } from '../src/extra/ai/compose/llm.ts'

function Choice({ question, options = [], frozen }) {
  return h('div', { className: 'choice' }, h('p', { className: 'question' }, question),
    ...options.map((o) => h('button', { type: 'button', className: 'option', 'data-value': o, disabled: !!frozen }, o)))
}
Choice.intent = ({ DOM }) => ({ PICK: DOM.click('.option').data('value') })
Choice.model = { PICK: { PARENT: (_s, v, _n, props) => compose.answer(props, v) } }
function Plans({ frozen }) {
  return h('ul', { className: 'plans' }, h('li', null, h('button', { type: 'button', className: 'plan', 'data-id': 'team', disabled: !!frozen }, 'Team')))
}
Plans.intent = ({ DOM }) => ({ PICK: DOM.click('.plan').data('id') })
Plans.model = { PICK: { PARENT: (_s, id, _n, props) => compose.answer(props, id) } }

const catalog = defineCatalog({
  parts: {
    choice: {
      component: Choice, result: true, description: 'A question with 2 to 5 short options; the user picks one',
      params: { question: { type: 'text', maxLength: 120, required: true }, options: { type: 'list', items: { maxLength: 40 }, min: 2, max: 5, required: true } },
    },
    plans: { component: Plans, result: true, description: 'The pricing plans to pick from' },
  },
})

function makeApp(opts = {}) {
  function App({ state }) {
    const a = state.assistant
    return h('div', null,
      h('ol', null, ...a.messages.map((m) => h('li', null, ...m.parts.map((p) => p.type === 'tool-ask_user' ? h('section', { className: 'card' }, askCard(catalog, state, p)) : null)))),
      h('form', { className: 'ask' }, h('input', { className: 'prompt', 'aria-label': 'Message', value: a.prompt })),
      h('button', { type: 'button', className: 'stop' }, 'Stop'))
  }
  App.initialState = { chatModel: 'qwen3:8b' }
  App.intent = ({ DOM }) => ({ PICK_MODEL: DOM.change('.model').value() })
  App.model = { PICK_MODEL: (s, chatModel) => ({ ...s, chatModel }) }
  App.uses = { assistant: chat({ form: '.ask', prompt: '.prompt', stop: '.stop', ask: { catalog }, ...opts }) }
  return App
}

let t
afterEach(() => { t?.dispose(); t = null })
const S = () => t.state.assistant
async function say(text) {
  t.simulateEvent('.prompt', 'input', { value: text })
  t.simulateEvent('.ask', 'submit')
  await t.next((s) => s.assistant.status === 'submitted')
}
const askCall = (id, need) => ({ toolCall: { id, name: 'ask_user', input: { need } } })
const card = () => S().messages.flatMap((m) => m.parts).find((p) => p.type === 'tool-ask_user')

describe('a card keeps its backend\'s decisions (part.ui.decisions)', () => {
  it('compose.llm(): the plan and the repairs, kept through a reload', async () => {
    const App = makeApp()
    App.persist = persist({ key: 'chat', pick: ['assistant'] })
    t = renderComponent(App)
    await say('Which plan?')
    await t.stream('LLM', [askCall('c1', 'Pick a plan')])
    await t.settle()
    expect(card().ui.decisions).toBeUndefined()            // nothing explained before the reply
    await composeWith(t, catalog, [{ part: 'plans' }])
    expect(card().ui).toMatchObject({ status: 'open', decisions: { asked_for: ['plans'] } })
    await t.settle()
    const saved = t.storage('chat')
    expect(saved.state.assistant.messages.at(-1).parts.at(-1).ui.decisions).toEqual({ asked_for: ['plans'] })
    t.dispose()
    t = renderComponent(App, { storage: { chat: saved } })
    await t.ready()
    expect(card().ui.decisions).toEqual({ asked_for: ['plans'] })
  })

  it('compose.decisions(): the answers per step, by question name (use_<part>, ...)', async () => {
    t = renderComponent(makeApp({ ask: { catalog, backend: compose.decisions({ url: '/api/decide', model: 'nimble' }) } }))
    await say('Help me choose')
    await t.stream('LLM', [askCall('d1', 'Let the user pick a pricing plan')])
    await t.settle()
    await composeWith(t, catalog, [{ part: 'plans' }])
    const d = card().ui.decisions
    expect(card().ui.status).toBe('open')
    expect(d.select.use_plans).toMatchObject({ choice: 'use' })
    expect(Object.keys(d.select)).not.toContain('use_choice')   // LLM-only part: not asked
  })

  it('a card that fails keeps what the backend explained', async () => {
    t = renderComponent(makeApp())
    await say('Ask me')
    await t.stream('LLM', [askCall('f', 'Pick a plan')])
    await t.settle()
    await t.respond('LLM', '{"asked_for": ["a plan"], "children": [{"part": "nope"}]}', 'assistant.CARD')
    await t.settle()
    expect(card().ui).toMatchObject({ status: 'failed', decisions: { asked_for: ['a plan'], repairs: [{ kind: 'unknownPart' }] } })
  })
})

describe('chat({ model }) as a function of the host state', () => {
  it('is resolved per request: the chat requests and the default card backend follow the app\'s pick', async () => {
    const seen = []
    t = renderComponent(makeApp({ model: (state) => { seen.push(state.chatModel); return state.chatModel } }))
    await say('Which plan?')
    expect(t.requests('LLM')[0].model).toBe('qwen3:8b')
    await t.stream('LLM', [askCall('c1', 'Pick a plan')])
    await t.settle()
    const cardReq = t.requests('LLM').find((r) => r.key === 'assistant.ask:c1')
    expect(cardReq.model).toBe('qwen3:8b')
    await composeWith(t, catalog, [{ part: 'plans' }])
    t.simulateEvent('.plan', 'click')
    await t.settle()
    await t.stream('LLM', ['Team it is.'])
    await t.settle()

    // the picker changes the model: the next turn's request names it, with the same behavior
    t.simulateAction('PICK_MODEL', 'llama3.2')
    await t.settle()
    await say('And now?')
    const chatReqs = t.requests('LLM').filter((r) => r.key === 'assistant')
    expect(chatReqs.map((r) => r.model)).toEqual(['qwen3:8b', 'qwen3:8b', 'llama3.2'])
    expect(seen).toContain('llama3.2')
  })

  it('a function that returns nothing sends no model (the transport\'s default)', async () => {
    t = renderComponent(makeApp({ model: () => undefined }))
    await say('hi')
    expect('model' in t.requests('LLM')[0]).toBe(false)
  })

  it('compose.llm({ model }) takes one too (start gets the host state)', () => {
    const b = llm({ model: (state) => state.m })
    const r = b.start({ catalog, state: { m: 'gpt-x' }, prompt: 'a question', previous: null, names: { ok: 'A', error: 'B', key: 'k' } })
    expect(r.request.model).toBe('gpt-x')
    expect('model' in llm({ model: () => '' }).start({ catalog, state: {}, prompt: 'x', previous: null, names: {} }).request).toBe(false)
    expect(llm({ model: 'fixed' }).start({ catalog, state: {}, prompt: 'x', previous: null, names: {} }).request.model).toBe('fixed')
  })
})

describe('compose.llm(): text params are not cut by the plan field', () => {
  const Q = 'How many people on your team will use the app every day, including you and your manager?'

  it('asked_for items may be as long as the longest text param (60 without one)', () => {
    const asked = (cat) => layoutSchema(cat, {}, { plan: true }).properties.asked_for.items.maxLength
    expect(asked(catalog)).toBe(120)
    expect(asked(defineCatalog({ parts: { plans: { component: Plans, description: 'The plans' } } }))).toBe(60)
    expect(asked(defineCatalog({ parts: { note: { component: Choice, description: 'A note', params: { text: { type: 'text', maxLength: 30, default: '' } } } } }))).toBe(60)
  })

  it('a 90-character question and its plan item reach the card whole', async () => {
    expect(Q.length).toBeGreaterThan(60)
    t = renderComponent(makeApp())
    await say('Ask me')
    await t.stream('LLM', [askCall('q', Q)])
    await t.settle()
    const req = t.requests('LLM').find((r) => r.key === 'assistant.ask:q')
    expect(req.instructions).toContain('question; short text, at most 120 characters')
    expect(req.instructions).not.toContain('undefined')
    await t.respond('LLM', JSON.stringify({ asked_for: [Q], children: [{ part: 'choice', params: { question: Q, options: ['1', '2-10', 'more'] } }] }), 'assistant.CARD')
    await t.settle()
    expect(card().ui.decisions.asked_for).toEqual([Q])
    expect(t.query('.question').textContent).toBe(Q)
  })
})
