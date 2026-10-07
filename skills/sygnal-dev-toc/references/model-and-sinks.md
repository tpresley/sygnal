# Model, actions and sinks

State updates (`ABORT`, `set`, `toggle`, controlled inputs), multi-sink entries and EVENTS, EFFECT, ELEMENT, timers, persistence, reacting to a state change.

## ABORT, STATE.watch, async EFFECT
- **ABORT**: from a STATE reducer, the state is unchanged (so is returning the same `state` object); from any other sink, nothing is sent.
- **React to a state change**: `SAVE: STATE.watch(state => state.text).compose(debounce(1000))` in intent emits the value when it changes (structural compare; `{ immediate: true }` also emits the current one). Not `STATE.stream` + `dropRepeats()`.
- One-off async work: `EFFECT: async (state, data, next, { signal }) => { ...; next('DONE', r) }`.

## State update, ABORT, set / toggle, controlled input
```jsx
import { ABORT, set, toggle } from 'sygnal'
function AddTodo({ state }) {
  return (
    <div>
      <input className="draft" aria-label="New todo" value={state.draft} />
      <button className="add">Add</button>
      <button className="help">?</button>
      {state.showHelp && <p className="hint">Type, then Add</p>}
    </div>
  )
}
AddTodo.initialState = { draft: '', todos: [], nextId: 1, showHelp: false }
AddTodo.intent = ({ DOM }) => ({
  DRAFT: DOM.input('.draft').value(),   // a bound value={...} needs an input listener (SYG111)
  ADD:   DOM.click('.add'),
  HELP:  DOM.click('.help'),
})
AddTodo.model = {
  DRAFT: set((state, draft) => ({ draft })),           // merges: ({ ...state, draft }); never set('draft') (SYG221)
  ADD: (state) => {
    const text = state.draft.trim()
    if (!text) return ABORT                              // "no change" (returning the same `state` works too)
    return { ...state, draft: '', nextId: state.nextId + 1, todos: [...state.todos, { id: state.nextId, text }] }
  },
  HELP: toggle('showHelp'),
}
```
## Multi-sink entry + EVENTS between non-adjacent components
Siblings and distant components talk through EVENTS; a parent that owns the shared state can instead pass slices down (`state="key"`) and hear children via PARENT.
```jsx
import { event } from 'sygnal'
function SaveButton({ state }) {
  return <button className="save">{state.saving ? 'Saving' : 'Save'}</button>
}
SaveButton.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
SaveButton.model = {
  SAVE: {
    STATE:  (state) => ({ ...state, saving: true }),
    EVENTS: event('DOC_SAVED', (state) => ({ id: state.id })),  // or event('RESET'), event('MODE', 'dark')
  },
}
function Toast({ state }) {   // anywhere in the tree: EVENTS is a global bus
  return <p className="toast">{state.lastSaved}</p>
}
Toast.intent = ({ EVENTS }) => ({ SAVED: EVENTS.select('DOC_SAVED') })  // emits the payload only
Toast.model = { SAVED: (state, payload) => ({ ...state, lastSaved: payload.id }) }
```
`event('TYPE')` with no payload sends `undefined` as the data.

## Element commands, timers, persistence
- **ELEMENT** (built in) calls a method on an element of the sending instance's view, after the render the action causes: `ELEMENT: (s) => (validate(s).email ? { focus: '.email' } : ABORT)`. First key = method (`focus`, `scrollIntoView`, `showModal`, `close`…), its value the target; other keys are options (`{ close: '.help', returnValue: 'done' }`); an array sends several. Tests: `t.commands('ELEMENT')`. `element-commands.md`
- **Timers**: `Clock.timers = (state) => ({ tick: state.running && { every: 1000, action: 'TICK' } })` (or `{ after: ms, action }`, `{ frame: 'FRAME' }`), diffed by name: falsy stops. Needs `run(App, { TIMER: makeTimerDriver() })` (SYG643); `TICK` gets `{ n, t }`. Tests need no driver: fake timers + `t.timers()`. `timers.md`
- **Persistence** (root only): `App.persist = persist({ key: 'todo-app', pick: ['todos', 'filter'] })` (`version`, `migrate`, `omit`, `storage`, `sync`) restores before the first render and saves `{ version, state }` after changes (`format: 'plain'`: the picked keys alone); `PERSIST: { clear: true }` removes it. Tests: `renderComponent(App, { storage: { 'todo-app': { version: 1, state: { todos: [] } } } })`, `t.storage('todo-app')` after `await t.settle()`. `node_modules/sygnal/dist/guide/persistence.md`
