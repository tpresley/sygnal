# Sygnal: the full canonical examples

It assumes the core (`llms.txt`).

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
```jsx
import { event } from 'sygnal'
function SaveButton({ state }) {
  return <button className="save">{state.saving ? 'Saving' : 'Save'}</button>
}
SaveButton.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
SaveButton.model = {
  SAVE: {
    STATE:  (state) => ({ ...state, saving: true }),
    EVENTS: event('DOC_SAVED', (state) => ({ id: state.id })),  // or event('RESET'), event('MODE', 'dark'); return ABORT to send nothing
  },
}
function Toast({ state }) {   // anywhere in the tree: EVENTS is a global bus
  return <p className="toast">{state.lastSaved}</p>
}
Toast.intent = ({ EVENTS }) => ({ SAVED: EVENTS.select('DOC_SAVED') })  // emits the payload only
Toast.model = { SAVED: (state, payload) => ({ ...state, lastSaved: payload.id }) }
```
```jsx
import { ABORT, debounce } from 'sygnal'
function Search({ state }) {
  return <div><input className="q" aria-label="Search" value={state.query} /><p className="status">{state.status}</p><ul>{state.results.map(r => <li>{r.title}</li>)}</ul></div>
}
Search.initialState = { query: '', status: '', results: [] }
Search.intent = ({ DOM }) => ({   // no intent line for the reply
  TYPE:   DOM.input('.q').value(),
  SEARCH: DOM.input('.q').value().compose(debounce(300)).filter(q => q !== ''),
})
Search.model = {
  TYPE: {
    STATE: (state, query) => (query === '' ? { ...state, query, status: '', results: [] } : { ...state, query }),
    HTTP:  (state, query) => (query === '' ? { abort: 'RESULTS' } : ABORT),   // clearing cancels the request in flight
  },
  SEARCH: {
    STATE: (state) => ({ ...state, status: 'Searching…' }),
    HTTP:  (state, q) => ({ url: '/api/search', query: { q }, ok: 'RESULTS', error: 'FAILED', latest: true }),
  },
  RESULTS: (state, body) => ({ ...state, status: '', results: body.results }),   // ok: the parsed body
  FAILED:  (state, { status, error }) => ({ ...state, status: status === 404 ? 'Not found.' : 'Search failed.', results: [] }),
}
```
```jsx
import { ABORT } from 'sygnal'
function Chat({ state }) {
  return <div><p className="status">{state.status}</p><ul>{state.messages.map(m => <li>{m.text}</li>)}</ul><input className="draft" aria-label="Message" value={state.draft} /><button className="send">Send</button><button className="leave">Leave</button></div>
}
Chat.initialState = { room: 'general', status: 'connecting', messages: [], draft: '' }
Chat.connections = (state) => ({   // from state, diffed by name: new opens, falsy/removed closes, changed URL reconnects
  room: state.room && { socket: `/ws/rooms/${state.room}`, message: 'RECEIVED', open: 'CONNECTED', close: 'DROPPED',
    reconnect: { delayMs: 1000, maxDelayMs: 1000, jitter: false } },   // fixed 1 s retry (default: 500 ms doubling to 10 s, ±20%)
})
Chat.intent = ({ DOM }) => ({ DRAFT: DOM.input('.draft').value(), SEND: DOM.click('.send'), LEAVE: DOM.click('.leave') })
Chat.model = {
  DRAFT: (state, draft) => ({ ...state, draft }),
  SEND: {
    STATE: (state) => (state.draft.trim() ? { ...state, draft: '' } : ABORT),
    WS:    (state, data, next, { previousState }) => (previousState.draft.trim() ? { to: 'room', json: { text: previousState.draft } } : ABORT),  // queued while (re)connecting
  },
  LEAVE:     (state) => ({ ...state, room: null, status: 'offline', messages: [] }),   // closes it: no DROPPED
  RECEIVED:  (state, msg) => ({ ...state, messages: [...state.messages, msg] }),        // the JSON-parsed frame
  CONNECTED: (state) => ({ ...state, status: 'online' }),                               // data: { reconnected }
  DROPPED:   (state, { willReconnect }) => ({ ...state, status: willReconnect ? 'reconnecting' : 'offline' }),  // { code, reason, willReconnect }
}
```
```jsx
// src/routes.js: one module the views import
import { makeRouter } from 'sygnal'
export const router = makeRouter({ routes: { home: '/', task: '/tasks/:id', admin: '/admin', notFound: '*' } })  // first match wins
export const { href } = router   // href('task', { id: 2 }, { tab: 'notes' }) → '/tasks/2?tab=notes'
```
```jsx
// src/App.jsx; main.js: run(App, { ROUTER: router.driver, HEAD: makeHeadDriver({ titleTemplate: '%s · Tasks' }) })
import { ABORT } from 'sygnal'
import { router, href } from './routes.js'
const PAGES = { home: Home, task: TaskPage, admin: Admin, notFound: NotFound }
function App({ state }) {
  const { route } = state, Page = PAGES[route.name]
  return <main><nav><a href={href('home')}>All</a></nav><Page key={`${route.name}:${route.path}`} /></main>
}
App.route = 'ROUTE'                                    // ROUTE gets { name, params, query, hash, path } on start and every change
App.initialState = { route: router.current(), user: null, draft: '', leaving: null }   // seeded: the first paint shows the right page
App.head = (state) => ({ title: state.route.name === 'task' ? `Task ${state.route.params.id}` : 'Tasks' })   // { title, meta, link }
App.model = {
  ROUTE: {                                             // a guard: refuse the route and redirect
    STATE:  (state, route) => (route.name === 'admin' && !state.user ? ABORT : { ...state, route, draft: '', leaving: null }),
    ROUTER: (state, route) => (route.name === 'admin' && !state.user ? { to: 'home', replace: true } : ABORT),
  },
}
TaskPage.model = {   // a page shares the parent's state: no initialState (SYG405)
  EDIT:  { STATE: (state, draft) => ({ ...state, draft }), ROUTER: () => ({ block: 'CONFIRM_LEAVE' }) },   // unsaved changes
  CONFIRM_LEAVE: (state, { proceed }) => ({ ...state, leaving: proceed }),   // a blocked attempt: { to, route, proceed }
  LEAVE: { STATE: (state) => ({ ...state, leaving: null }), ROUTER: (state, data, next, { previousState }) => ({ ...previousState.leaving, block: false }) },
  DONE:  { ROUTER: () => ({ to: 'home', block: false }) },
}
```
```js
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import TaskList from './TaskList.jsx'
it('picks, then removes a task', async () => {
  const t = renderComponent(TaskList, { strict: true })   // disposed after the test; also: initialState, context, drivers, mockConfig, diagnostics, timeoutMs, settleMs, eventWaitMs
  t.simulateEvent('.pick', 'click')                 // first match; bubbles; reaches child components too
  await t.next(s => s.picked === 1)                 // a state emitted after this call
  await t.simulateEvent('.task[data-id="2"] .remove', 'click')
  expect(t.state.tasks.length).toBe(1)
  await t.settle()                                  // nothing pending anywhere in the tree
  expect(t.html()).not.toContain('Test')
  t.expectNoDiagnostics()                           // throws on warn/error; strict fails unread ones
})
```
