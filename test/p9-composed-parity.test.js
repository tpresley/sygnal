// PLAN-9 M-1 (D466): the parity run. The compose suites run again with every composition rendered
// through <Composed catalog from /> (and chat cards through <Composed card />) in place of
// catalog.render() / askCard() in the view: the behavior suite, the per-backend matrix, the agent
// and edit suites, the lenient reader and the cards in the chat. Each file also runs on its own
// (render()). The hosts pick the form with globalThis.__COMPOSE_VIA (test/p9-compose-app.js `show`,
// test/p9-chat-ask.test.js `card`), read at render time.
import { it, expect } from 'vitest'
import { VIA, makeApp, STATE } from './p9-compose-app.js'
import { makeChatApp } from './p9-chat-ask.test.js'
import { compose } from '../src/extra/ai/index.ts'
import './p9-compose-behavior.test.js'
import './p9-compose-matrix.test.js'
import './p9-compose-agent.test.js'
import './p9-decisions-edit.test.js'
import './p9-llm-lenient.test.js'
import './p9-chat-ask.test.js'

globalThis.__COMPOSE_VIA = 'marker'

const sels = (v, out = []) => { if (v && typeof v == 'object') { if (v.sel) out.push(v.sel); (v.children || []).forEach((c) => sels(c, out)) } return out }

it('this run renders through the marker', () => {
  expect(VIA()).toBe('marker')
  const App = makeApp(compose.decisions({ model: 'm' }))
  expect(sels(App({ state: { ...STATE, page: { prompt: '', status: 'idle', layout: null } } }))).toContain('composed')
  const Chat = makeChatApp()
  const part = { type: 'tool-ask_user', toolCallId: 'c1', state: 'input-available', input: { need: 'x' }, ui: { status: 'open', layout: { root: 'page', nodes: { page: { part: 'page', slots: {} } } } } }
  expect(sels(Chat({ state: { assistant: { messages: [{ role: 'assistant', parts: [part] }], status: 'ready', prompt: '' } } }))).toContain('composed')
})
