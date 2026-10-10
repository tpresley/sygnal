// 0-S3 edge cases for positions.mjs (not a real app): agent, timers, undoable, a removed-form
// shorthand key, a user behavior, decide(), a computed intent key, constant-built next() names,
// a cross-file EVENTS constant.
import { event, undoable, defineBehavior } from 'sygnal'
import { decide } from 'sygnal/ai'
import { SAVED } from './names.js'

const counter = defineBehavior({
  initialState: { n: 0 },
  intent: ({ DOM }, opts) => ({ BUMP: DOM.click(opts.button) }),
  model: { BUMP: (s, d, next) => { next('RESET'); return { n: s.n + 1 } }, RESET: () => ({ n: 0 }) },
})

const PREFIX = 'LOAD'
const ACTIONS = { TICK: 'TICK' }

export function Edge({ state }) {
  return <div className="edge"><button className="save">Save</button><span id="count">{state.n}</span></div>
}
Edge.uses = { c: counter({ button: '.save' }) }
Edge.initialState = { n: 0, items: [] }
Edge.intent = ({ DOM, EVENTS }) => ({
  SAVE: DOM.click('.save'),
  [ACTIONS.TICK]: DOM.click('#count'),
  EXTERNAL: EVENTS.select(SAVED),
})
Edge.model = undoable({
  SAVE: {
    STATE: (s, d, next) => { next(PREFIX + '_DONE'); next(`${PREFIX}_MORE`); return s },
    HTTP: () => ({ url: '/x', ok: 'LOADED', error: 'FAILED' }),
    LLM: () => decide({ messages: [], ok: 'TRIAGED' }),
    EVENTS: event('SAVED', s => s),
  },
  LOADED: (s) => s,
  'FAILED | EFFECT': () => {},
  TICK: (s) => s,
  'c.BUMP': (s) => s,
})
Edge.timers = (s) => ({ poll: s.n && { every: 1000, action: 'POLL' } })
Edge.agent = { name: 'edge', actions: { SAVE: { description: 'save' }, LOADED: { description: 'x' } } }
