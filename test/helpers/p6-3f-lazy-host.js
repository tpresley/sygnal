// PLAN-6 3-F (G-625): a chat host in a module loaded lazily, after the app started. chat() runs
// when this module is imported, i.e. after run(): the link must attach to the running app.
import { createElement as h } from '../../src/pragma/index.ts'
import { chat } from '../../src/extra/ai/chat/behavior.ts'

export default function Counter({ state }) {
  return h('section', null, h('p', { className: 'count' }, String(state.count)), h('p', { className: 'status' }, state.assistant.status))
}
Counter.initialState = { count: 0 }
Counter.isolatedState = true
Counter.model = { BUMP: (state) => ({ ...state, count: state.count + 1 }) }
Counter.agent = { name: 'counter', read: (state) => ({ count: state.count }), actions: { BUMP: { description: 'Add one' } } }
Counter.uses = { assistant: chat({ instructions: 'Count.' }) }
