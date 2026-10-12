// PLAN-9 C-2: `page.COMPOSE` as an agent action. A chat assistant (the `chat` behavior on the same
// host) calls app_page_compose({ prompt }); the composition runs (compose.decisions() on HTTP, or
// compose.llm() on the same LLM sink as the chat, in its own lane); the tool result waits for it
// (`until`) and its state shows the new page (compose.summary in `read`). A follow-up call edits
// the page and keeps the keys of the parts it doesn't change. No network.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { chat } from '../src/extra/ai/chat/behavior.ts'
import { compose, composeWith } from '../src/extra/ai/index.ts'
import { makeApp, catalog } from './p9-compose-app.js'

let t
afterEach(() => { t?.dispose(); t = null })

function makeAssistedApp(backend) {
  const Base = makeApp(backend)
  function App(props) {
    const c = props.state.assistant
    return h('div', null, Base(props), h('ol', { className: 'messages' }, ...c.messages.map((m) => h('li', null, m.role))))
  }
  Object.assign(App, Base)
  App.uses = { ...Base.uses, assistant: chat({ instructions: 'You arrange the dashboard.' }) }
  App.agent = {
    name: 'app',
    read: (state) => ({ page: compose.summary(state.page) }),
    actions: { ...compose.action('page') },
  }
  return App
}

/** the output of the tool part `id` in the chat's last request (the result went back to the model) */
const toolOutput = (id) => t.requests('LLM').filter((r) => r.key === 'assistant').at(-1).messages.at(-1).parts.find((p) => p.toolCallId === id)

const BACKENDS = {
  decisions: () => compose.decisions({ model: 'jev-latest' }),
  llm: () => compose.llm({ model: 'qwen3:8b' }),
}

describe('compose.action(): the declaration', () => {
  it('offers <name>_page_compose({ prompt, fresh? }) with until and a 60 s timeout', async () => {
    const a = compose.action('page')['page.COMPOSE']
    expect(a.description).toMatch(/Rearrange the page/)
    expect(a.timeout).toBe(60000)
    expect(a.until({ page: { status: 'composing' } })).toBe(false)
    expect(a.until({ page: { status: 'preview' } })).toBe(false)
    for (const status of ['done', 'unavailable', 'error', 'idle']) expect(a.until({ page: { status } })).toBe(true)
    expect(Object.keys(compose.action('board', { description: 'x', timeout: 5 }))).toEqual(['board.COMPOSE'])
    t = renderComponent(makeAssistedApp(BACKENDS.llm()))
    await t.ready()
    const tool = t.tools().find((x) => x.name === 'app_page_compose')
    expect(tool.inputSchema).toMatchObject({ type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' }, fresh: { type: 'boolean' } } })
  })

  it('compose.summary(): status, the layout as a tree, the error', () => {
    expect(compose.summary(null)).toBeUndefined()
    expect(compose.summary({ status: 'idle', layout: null, error: null })).toEqual({ status: 'idle', page: [] })
    const layout = { root: 'page', nodes: { page: { part: 'page', slots: { default: ['row'] } }, row: { part: 'row', slots: { default: ['a', 'b'] } }, a: { part: 'a' }, b: { part: 'b', params: { x: 1 } } } }
    expect(compose.summary({ status: 'error', layout, error: 'no' })).toEqual({ status: 'error', page: [{ part: 'row', children: [{ part: 'a' }, { part: 'b', params: { x: 1 } }] }], error: 'no' })
  })
})

for (const [name, make] of Object.entries(BACKENDS)) {
  describe(`a chat assistant composes the page: compose.${name}()`, () => {
    it('the tool call composes, the result waits for it and shows the new page; a follow-up edits it, keys kept', async () => {
      t = renderComponent(makeAssistedApp(make()), { strict: true })
      await t.ready()
      t.simulateAction('assistant.SEND', 'Show me revenue and churn side by side')
      await t.settle()
      expect(t.requests('LLM')).toHaveLength(1)
      expect(t.requests('LLM')[0].tools.app_page_compose).toBeTruthy()
      await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'app_page_compose', input: { prompt: 'Revenue and churn side by side' } } }], 'assistant.REPLY')
      await t.waitForState((s) => s.page.status === 'composing')
      expect(t.state.page.prompt).toBe('Revenue and churn side by side')
      if (name === 'llm') {
        // the composition's request: the same sink, its own lane and reply actions
        const req = t.requests('LLM').at(-1)
        expect(req).toMatchObject({ key: 'compose', ok: 'page.REPLY', error: 'page.FAILED', parse: false })
        expect(t.requests('LLM')[0]).toMatchObject({ key: 'assistant', ok: 'assistant.REPLY' })
      }
      // the chat waits for the composition (`until`): no next request yet
      await t.settle()
      expect(t.requests('LLM').filter((r) => r.key === 'assistant')).toHaveLength(1)
      expect(t.state.assistant.status).toBe('streaming')
      await composeWith(t, catalog, [{ part: 'row', children: [{ part: 'revenue' }, { part: 'churn' }] }])
      await t.waitForState((s) => s.page.status === 'done')
      await t.settle()
      const chats = () => t.requests('LLM').filter((r) => r.key === 'assistant')
      expect(chats()).toHaveLength(2)
      expect(toolOutput('c1')).toMatchObject({ state: 'output-available', output: { ok: true, state: { page: { status: 'done', page: [{ part: 'row', children: [{ part: 'revenue' }, { part: 'churn' }] }] } } } })
      await t.stream('LLM', ['Done: revenue and churn are side by side.'], 'assistant.REPLY')
      await t.waitForState((s) => s.assistant.status === 'ready')
      expect(t.html()).toContain('$48.2k')
      const keys = Object.keys(t.state.page.layout.nodes).sort()
      expect(keys).toEqual(['churn', 'page', 'revenue', 'row'])

      // a follow-up: an edit of the current page (the backend gets it as previous)
      t.simulateAction('assistant.SEND', 'Add the weather below')
      await t.settle()
      await t.stream('LLM', [{ toolCall: { id: 'c2', name: 'app_page_compose', input: { prompt: 'Add the weather at the bottom' } } }], 'assistant.REPLY')
      await t.waitForState((s) => s.page.status === 'composing' && s.page.prompt === 'Add the weather at the bottom')
      expect(t.state.page.pending.previous ?? t.state.page.pending).toBeTruthy()
      if (name === 'llm') expect(t.state.page.pending.step).toBe('edit')
      await composeWith(t, catalog, [{ part: 'row', children: [{ part: 'revenue' }, { part: 'churn' }] }, { part: 'weather' }])
      await t.waitForState((s) => s.page.status === 'done' && !!s.page.layout.nodes.weather)
      await t.settle()
      await t.settle()
      expect(toolOutput('c2').output).toMatchObject({ ok: true, state: { page: { status: 'done', page: [{ part: 'row' }, { part: 'weather' }] } } })
      expect(t.state.page.layout.nodes.row.slots.default).toEqual(['revenue', 'churn'])
      expect(t.state.page.layout.nodes.page.slots.default).toEqual(['row', 'weather'])
      await t.stream('LLM', ['Added.'], 'assistant.REPLY')
      await t.waitForState((s) => s.assistant.status === 'ready')
      t.expectNoDiagnostics()
    })

    it('nothing fits: the result says unavailable and the page stays', async () => {
      t = renderComponent(makeAssistedApp(make()), { strict: true })
      await t.ready()
      t.simulateAction('page.SET_LAYOUT', { root: 'page', nodes: { page: { part: 'page', slots: { default: ['weather'] } }, weather: { part: 'weather' } } })
      await t.next((s) => s.page.status === 'done')
      t.simulateAction('assistant.SEND', 'Show the stock price of Apple')
      await t.settle()
      await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'app_page_compose', input: { prompt: 'The stock price of Apple' } } }], 'assistant.REPLY')
      await t.waitForState((s) => s.page.status === 'composing')
      await composeWith(t, catalog, [])
      await t.waitForState((s) => s.page.status === 'unavailable')
      await t.settle()
      await t.settle()
      expect(toolOutput('c1').output).toMatchObject({ ok: true, state: { page: { status: 'unavailable', page: [{ part: 'weather' }] } } })
    })
  })
}
