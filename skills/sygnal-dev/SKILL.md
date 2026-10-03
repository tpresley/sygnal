---
name: sygnal-dev
description: >
  Build, change, test, and debug apps written with Sygnal, the reactive JSX component
  framework built on Cycle.js (Model-View-Intent, xstream streams, one state tree,
  driver-based side effects). Use it whenever a project depends on `sygnal`, imports from
  'sygnal', uses `.intent` / `.model` / `.initialState` on components, or the user asks to
  create a Sygnal app, add a feature or component, wire events or drivers, write Sygnal
  tests, or fix a `[Sygnal SYGnnn]` diagnostic.
---

# Sygnal Dev

Canonical forms, API facts, wiring rules and testing for everyday work. Full spec: `node_modules/sygnal/llms.txt`. Other features (Portals, Transitions, Suspense, Slots, forms, drag-and-drop, SSR, Astro/Vike): https://sygnal.js.org/guide/components/. **Write only the canonical forms shown here**: `sygnal-check --strict` flags the others (SYG5xx).

## 1. Workflow

**New app** (no prompts): `npm create sygnal-app@latest my-app -- --template vite --js --install` (templates `vite`, `vite-pwa`, `vike`, `astro`; `--ts` for TypeScript). Or in a Vite app: `npm i sygnal`, `npm i -D vitest`, `plugins: [sygnal()]` from `'sygnal/vite'`, and `run(App)` in `src/main.js` (§9).

**The task text is the spec**: copy labels, messages and punctuation verbatim (`Search failed.` keeps its period) and implement it; don't stop to explain or ask. Re-read the task itself, not a summary of it (such as the arguments you passed to this skill).

**Add a feature** (in this order):
1. **State**: add the fields to the root `initialState` (children get state from their parent).
2. **Intent**: name the action and its trigger (`DOM.click('.save')`, `EVENTS.select('X')`, `CHILD.select(Child)`).
3. **Model**: one entry per action; one function per sink (`STATE`, `EVENTS`, `PARENT`, `EFFECT`, drivers).
4. **View**: render from `state` / `context`; add the class names the intent selects.
5. **Test**: `renderComponent(C, { strict: true })` + `simulateEvent` + `t.next` + `expectNoDiagnostics()` (§7). Run `npm test`, then `npx --no-install sygnal-check --strict` (Vike: `npx --no-install sygnal-check pages --strict`; a dev dependency of `create-sygnal-app` projects, elsewhere `npm i -D sygnal-check`; not installed? rely on the tests' runtime diagnostics).

**Debugging loop**: run `npm test` and read every `[Sygnal SYGnnn]` line; `npx --no-install sygnal-check explain SYGnnn` says what it means and how to fix it. Unclear? Check the wiring: `t.inspect()` or `npx --no-install sygnal-check --graph --json` (actions and triggers, selectors with `matched` / `isolationHit`, EVENTS). Fix, re-run, then `--strict` until clean. A silent no-op (a click does nothing, no error) is almost always a §5 wiring rule.

## 2. Mental model and component anatomy
- A component is a pure view function plus static properties: `.intent` (WHEN: sources → named action streams), `.model` (WHAT: action → one reducer per sink), `.initialState`.
- There is one state tree. A child sees its parent's whole state, or a slice with `state="key"`. A Collection item sees one array element.
- Every side effect is a sink of a model entry (STATE, EVENTS, PARENT, EFFECT, custom drivers). JSX never has event handlers (`onClick`).
- Streams are xstream, not RxJS. An intent's DOM selectors only see the component's own JSX, never a child component's.

```jsx
import { ABORT } from 'sygnal'
function Counter({ state, context, label }) {  // 1st arg: parent props + state, context, children, slots
  return (
    <div className="counter">
      <span>{label} {state.count} (x2 = {state.double})</span>
      <button className="inc">+</button>
      <button className="reset">reset</button>
    </div>
  )
}
Counter.initialState = { count: 0 }                    // root only: a child gets state from its parent (SYG405)
Counter.calculated = { double: state => state.count * 2 } // or [['count'], fn]; read as state.double
Counter.context = { total: state => state.count }        // all descendants: ({ context }) => context.total
Counter.intent = ({ DOM }) => ({                          // sources: DOM STATE EVENTS CHILD props$ commands$ dispose$ + drivers
  INC:   DOM.click('.inc'),
  RESET: DOM.click('.reset'),
})
Counter.model = {
  INC:   (state, data, next, props) => ({ ...state, count: state.count + 1 }),
  RESET: (state) => (state.count === 0 ? ABORT : { ...state, count: 0 }),
}
Counter.onError = (error, { componentName }) => <div className="error">{componentName} failed</div>
export default Counter
```
- Reducer `(state, data, next, props)`. `data` is the action stream's value. `next('ACTION', data?, delayMs = 10)` dispatches another action of this component, also later from a timer (`EFFECT: (state, data, next) => { setTimeout(() => next('TICK'), 1000) }`). HTTP goes through `makeFetchDriver` (§3), not `fetch` + `next()`. `props`: the parent's props plus `state`, `context`, `children`, `slots`.
- Model entry: a function is the STATE reducer. An object `{ STATE, EVENTS, PARENT, EFFECT, LOG, <DRIVER>: fn }` maps each sink to a `(state, data, next, props)` function whose return value goes to that sink (`<SINK>: true` forwards `data`).
- **Every sink of one entry sees the state from before this action**: EVENTS, PARENT, EFFECT and drivers never see what STATE returns. Compute the new value from `(state, data)` inside the sink: `INC: { STATE: s => ({ ...s, n: s.n + 1 }), PARENT: s => ({ n: s.n + 1 }) }`.
- Built-in actions (model only): `BOOTSTRAP` (once, just after mount), `INITIALIZE` (sets initialState), `DISPOSE` (unmount). No `HYDRATE` (6.0): SSR data comes from Vike `+data` / `hydrateState`.
- Declaration statics (`connections`, `resources`, `route`, `head`) are computed from state and work with or without a model.

## 3. Canonical examples
### State update, ABORT, set / toggle, controlled input
```jsx
import { ABORT, set, toggle } from 'sygnal'
function AddTodo({ state }) {
  return (
    <div>
      <input className="draft" value={state.draft} />
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
    if (!text) return ABORT                              // "no change" is ABORT, never `return state`
    return { ...state, draft: '', nextId: state.nextId + 1, todos: [...state.todos, { id: state.nextId, text }] }
  },
  HELP: toggle('showHelp'),
}
```
### Multi-sink entry + EVENTS between non-adjacent components
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
`event('TYPE')` with no payload sends `undefined` as the data. A child that only reacts to EVENTS needs no `initialState`; it gets its state from the parent.
### Child → parent (PARENT + CHILD.select), Collection, item removal
```jsx
import { Collection } from 'sygnal'
function TaskItem({ state }) {
  return (
    <li className="task" data={{ id: state.id }}>
      {state.title} <button className="pick">pick</button> <button className="remove">x</button>
    </li>
  )
}
TaskItem.intent = ({ DOM }) => ({ PICK: DOM.click('.pick'), REMOVE: DOM.click('.remove') })
TaskItem.model = {
  PICK:   { PARENT: (state) => ({ taskId: state.id }) },   // the parent receives exactly this value
  REMOVE: () => undefined,                                   // a Collection item removes itself
}
function TaskList({ state }) {
  return (
    <div>
      <p className="picked">{state.picked}</p>
      <Collection of={TaskItem} from="tasks" className="tasks" />
    </div>
  )
}
TaskList.initialState = { picked: null, tasks: [{ id: 1, title: 'Write' }, { id: 2, title: 'Test' }] }
TaskList.intent = ({ CHILD }) => ({ PICKED: CHILD.select(TaskItem) })  // the function, not a string
TaskList.model = { PICKED: (state, { taskId }) => ({ ...state, picked: taskId }) }
```
- Removal in the object form keeps the STATE entry: `REMOVE: { STATE: () => undefined, EVENTS: event('REMOVED', (state) => state.id) }`. Without `STATE: () => undefined` the item stays.
- `from` names an array field; items are keyed by `.id` (else index). `filter={t => !t.done}`; `sort="title"`, `sort={{ title: 'desc' }}`, an array of those, or a compare function: they only change what renders, and an item's edit is written back to its element by key. Items render inside one `<div>` (`className` sets its class).
- Switchable: `<Switchable of={{ home: Home, settings: Settings }} current={state.tab} />` (optional `state="slice"`). Hidden pages stay alive; `instance={key}` re-creates the current page with fresh state when the key changes.
### Extract a component without changing the markup
**First**, on the unchanged code, pin the HTML: `expect(t.html()).toMatchSnapshot()` initially and after one interaction (run once with `npx vitest run -u`). Move the elements into the child verbatim (a component adds no wrapper or attributes); props in, `PARENT` out with an id, no `initialState`. The parent renders `<Child name="food" value={state.food} />`, drops the old selectors (SYG104) and listens with `CHILD.select(Child)`. The snapshot must still match.
```jsx
function StarRating({ name, value }) {
  return <div className={`rating ${name}`}>{[1, 2, 3].map(n => <button className={n <= value ? 'star filled' : 'star'} data-value={String(n)}>★</button>)}</div>
}
StarRating.intent = ({ DOM }) => ({ PICK: DOM.click('.star').data('value', Number) })
StarRating.model = { PICK: { PARENT: (state, value, next, props) => ({ name: props.name, value }) } }
// parent: intent RATE: CHILD.select(StarRating); model RATE: (state, { name, value }) => ({ ...state, [name]: value })
```
### Commands (parent → child) + EFFECT
`const player = createCommand()` (from `'sygnal'`); the parent renders `<Player commands={player} state="player" />` and calls it from an EFFECT (side effect only, returns nothing): `PLAY: { EFFECT: () => player.send('play', data?) }`; the child listens with `PLAY: commands$.select('play')` (emits `send()`'s data).
### HTTP (makeFetchDriver + reply actions), latest response only
```jsx
import { ABORT, debounce } from 'sygnal'
function Search({ state }) {
  return <div><input className="q" value={state.query} /><p className="status">{state.status}</p><ul>{state.results.map(r => <li>{r.title}</li>)}</ul></div>
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
- main.js: `run(Search, { HTTP: makeFetchDriver() })` (options `baseUrl headers init timeoutMs`). Request: `{ url, ok, error, key, query, json, body, method, headers, latest, timeoutMs, init }` (POST with json/body); extra fields aren't sent and come back on `request`. `ok` gets the parsed body; `error` gets `{ error, status, body, request }` (`status` undefined: network error). The reply reaches exactly the sending instance. Never `HTTP.select`/`HTTP.errors` for your own request (SYG508), never `then`/`catch` keys (SYG610).
- `latest: true`: a newer request in the same lane (`key`: a constant name, never an id or URL; default the `ok` action) aborts this instance's older ones; their replies never arrive. `{ abort: 'RESULTS' }` cancels that lane (with a custom `key`, abort that key). **Build the request from `(state, data)`**: sinks see the state before the action, so `SHOW: { STATE: (s, id) => ({ ...s, id }), HTTP: (s, id) => ({ url: '/api/q/' + id, ok: 'LOADED' }) }`, not `s.id`.
- Other promise APIs: `driverFromAsync(fn)` takes the same reply actions (`{ value, ok: 'DONE', error: 'FAILED' }` calls `fn(value)`). One-off async work: `EFFECT: async (state, data, next, { signal }) => { ...; next('DONE', r) }`. Page-wide events: `DOM.select('document').events(type)`, filtered: `DOM.select('document').select('.overlay').events('click')`.
### Reads that follow state: `resources`
```jsx
function Quote({ state }) {
  const { status, data, error, refreshing } = state.quote  // status: 'idle' | 'loading' | 'success' | 'error'
  const text = status === 'loading' ? 'Loading…' : status === 'error' ? `Failed (${error.status ?? 'network'})` : refreshing ? 'Updating…' : ''
  return <div><button className="next">Next</button><button className="refresh">Refresh</button><p className="status">{text}</p><p className="text">{data?.text}</p></div>
}
Quote.initialState = { id: 1 }
Quote.resources = { quote: (state) => state.id && `/api/quotes/${state.id}` }  // a URL or a request; falsy = idle
Quote.intent = ({ DOM }) => ({ NEXT: DOM.click('.next'), REFRESH: DOM.click('.refresh') })
Quote.model = {
  NEXT:    (state) => ({ ...state, id: state.id + 1 }),  // new request: 'loading' without data; the old one is aborted
  REFRESH: { HTTP: { refresh: 'quote' } },               // same request: data kept, refreshing: true
}
```
- For data a component shows; writes stay reply actions. Needs `makeFetchDriver()` in main.js. The built-in `RESOURCE` action writes `state.quote` (not in initialState). A changed request is fetched and the older one aborted: no ids, `latest` or loading flags. TS: `Resource<Quote>`.
- **A refetch of the same request keeps `data` with `refreshing: true`**: when the old value must not show (Refresh shows "Loading…"), treat `refreshing` as loading. `keepPrevious: true` on the request also keeps it across a request change (pagination). `ok`/`error` on the request also dispatch after the write.
- After a write, `invalidates: ['quotes']` refetches reads tagged `tags: ['quotes']` or under a `'/api/quotes'` prefix; `{ invalidate: 'quotes' }` on the sink does it now.
- Cache, `retry`, `validate`, `refetchEvery`, `{ prefetch }`, SSR: `node_modules/sygnal/dist/guide/resources.md` (or https://sygnal.js.org/guide/resources/)
### List/detail + save, cached
```jsx
// main.js: makeFetchDriver({ cache: queryCache() }); tests: renderComponent(App, { http: { cache: queryCache() } })
const label = (r) => r?.status === 'loading' ? 'Loading…' : r?.refreshing ? 'Updating…' : ''
App.resources = {  // only while shown; shown again: cached at once, refetched once stale
  items: (s) => s.view === 'list' && { url: '/api/items', staleTime: 2000 },
  item:  (s) => s.view === 'detail' && { url: `/api/items/${s.id}`, staleTime: 2000 },
}
App.model = { SAVE: { HTTP: (s) => ({ url: `/api/items/${s.id}`, method: 'PUT', json: { title: s.draft }, ok: 'SAVED', error: 'SAVE_FAILED',
  updates: 'item',  // state.item.data = the reply, now (setQueryData)
  invalidates: '/api/items' }) } }  // then both refetch (refreshing)
```
- `updates` and invalidation abort older reads in flight, so a reply sent before the save never lands. `updates: { items: (list, saved) => newList }` derives it.
### WebSocket / SSE (makeSocketDriver + connections)
```jsx
Chat.initialState = { room: 'general', status: 'connecting', messages: [] }
Chat.connections = (state) => ({   // from state, diffed by name: new opens, falsy/removed closes, changed URL reconnects
  room: state.room && { socket: `/ws/rooms/${state.room}`, message: 'RECEIVED', open: 'CONNECTED', close: 'DROPPED',
    reconnect: { delayMs: 1000, maxDelayMs: 1000, jitter: false } },   // fixed 1 s retry (default: 500 ms doubling to 10 s)
})
Chat.model = {
  JOIN:      (state, room) => room === state.room ? ABORT : { ...state, room, status: 'connecting', messages: [] },  // same room: no new `open`
  SAY:       { WS: (state, text) => text.trim() ? { to: 'room', json: { text } } : ABORT },   // queued while (re)connecting
  LEAVE:     (state) => ({ ...state, room: null, status: 'offline', messages: [] }),     // closes it: no DROPPED
  RECEIVED:  (state, msg) => ({ ...state, messages: [...state.messages, msg] }),          // the JSON-parsed frame
  CONNECTED: (state) => ({ ...state, status: 'online' }),                                 // { reconnected }
  DROPPED:   (state, { willReconnect }) => ({ ...state, status: willReconnect ? 'reconnecting' : 'offline' }),
}
```
- main.js: `run(Chat, { WS: makeSocketDriver() })`; without it nothing opens, silently. Spec: `socket` or `sse` (read-only; `events: { 'price-update': 'PRICE' }`), optional `message open close error` actions, `reconnect` (`false` = never), `share` (default: one socket per URL). `close` fires only for drops the app didn't cause (leaving, a URL change and unmount close silently), so no connection ids. `{ to }` on an undeclared, closed or SSE connection is SYG611. Guide: https://sygnal.js.org/guide/sockets/
- A hidden Switchable page pauses its connections and resources; an entry with `background: true` stays live (`alerts: { socket: '/ws/alerts', message: 'ALERT', background: true }`).
### Router (makeRouter + route) and HEAD
```jsx
// src/routes.js
import { makeRouter } from 'sygnal'
export const router = makeRouter({ routes: { home: '/', task: '/tasks/:id', admin: '/admin', notFound: '*' } })  // first match wins
export const { href } = router   // href('task', { id: 2 }) → '/tasks/2'
```
```jsx
// src/App.jsx; main.js: run(App, { ROUTER: router.driver, HEAD: makeHeadDriver() })
import { ABORT, Switchable } from 'sygnal'
import { router, href } from './routes.js'
function App({ state }) {
  return (
    <main>
      <nav><a href={href('home')}>All</a> <a href={href('task', { id: 2 })}>Task 2</a></nav>
      <Switchable of={{ home: Home, task: TaskPage, admin: Admin, notFound: NotFound }} current={state.route.name} instance={state.route.path} />
    </main>
  )
}
App.route = 'ROUTE'                                     // ROUTE gets { name, params, query, hash, path } on start and every change
App.initialState = { route: router.current(), user: null, draft: '', leaving: null }  // root: initialState required (SYG132)
App.head = (state) => ({ title: state.route.name === 'task' ? `Task ${state.route.params.id}` : 'Tasks' })  // also meta, link
App.model = {
  ROUTE: {                                              // a guard refuses the route and redirects
    STATE:  (state, route) => (route.name === 'admin' && !state.user ? ABORT : { ...state, route, draft: '', leaving: null }),
    ROUTER: (state, route) => (route.name === 'admin' && !state.user ? { to: 'home', replace: true } : ABORT),
  },
}
// TaskPage: a page sharing the parent's state (no initialState: SYG405); view + intent as usual
TaskPage.model = {
  EDIT:  { STATE: (state, draft) => ({ ...state, draft }), ROUTER: () => ({ block: 'CONFIRM_LEAVE' }) },  // guard unsaved changes
  CONFIRM_LEAVE: (state, { proceed }) => ({ ...state, leaving: proceed }),   // a blocked navigation: { to, route, proceed }
  LEAVE: { STATE: (state) => ({ ...state, leaving: null }), ROUTER: (state) => ({ ...state.leaving, block: false }) },
  DONE:  { ROUTER: () => ({ to: 'home', block: false }) },   // also { to, params, query, replace }, { url }, { back: true }
}
```
- Links are plain `<a href={href(...)}>`: the driver intercepts same-origin clicks. `params` are strings. `instance={state.route.path}` gives `/tasks/1` and `/tasks/2` separate page state. Pages derive `resources` from `state.route.params`. SSR: `router.current(req.url)`. Vike: `makeRouter({ routes, navigate })` (from `'vike/client/router'`). Guides: https://sygnal.js.org/guide/router/, https://sygnal.js.org/guide/head/

## 4. API facts
- **Child props**: `<Rating name="food" value={state.food} />` → `function Rating({ state, name, value })`; reducers read `props.name` (4th arg); intent gets `props$`. Reserved: `state` (lens: `"key"` or `{ get, set }`), `children`, `slots`, `context`, `peers` (SYG106). Without `state=` a child shares its parent's whole state.
- **CHILD.select(Comp)** emits exactly what the child's `PARENT` function returned, for every instance (Collection items too). Put an id in the payload.
- **run(App, drivers = {}, { mountPoint = '#root', diagnostics })** returns `{ sources, sinks, dispose, hmr }`. DOM, EVENTS, LOG and STATE are built in. `app.sources.STATE.stream` is the state stream; `app.dispose()` fires DISPOSE.
- **ABORT**: from a STATE reducer, the state is unchanged; from any other sink, nothing is sent.
- **Focus**: `blur`/`focus` don't bubble, but `DOM.blur('.field')` and `DOM.focus('.field')` work (listener on the element). For any field inside a container use the bubbling `DOM.focusout('.form')` / `DOM.focusin`.
- **Shorthands**: `DOM.<event>('.sel')` = `DOM.select('.sel').events('<event>')` for every real DOM event name. `DOM.key`/`DOM.enter`/`DOM.escape` never fire (SYG115). Escape anywhere: `DOM.keydown('document').key().filter(k => k === 'Escape')`.
- **Enriched streams** (chainable, optional mapper): `.value(fn?)` e.target.value; `.checked(fn?)` boolean; `.key(fn?)` e.key; `.target(fn?)`; `.data('id', Number)` reads `data-id` on the target or nearest ancestor (`data={{ id: 7 }}`); `.data('taskId')` reads `data-task-id`. A `data-task-id="1"` attribute works too, but a kebab key in the prop (`data={{ 'task-id': 1 }}`) throws (SYG421).
- **xstream**: `xs.merge/combine/of/periodic/never/fromPromise`; methods `map mapTo filter startWith fold take drop last endWhen flatten compose remember replaceError debug`. From `'sygnal'`, used with `.compose(...)`: `debounce(ms) throttle(ms) delay(ms) dropRepeats() sampleCombine(other$) flattenConcurrently flattenSequentially`; plus `concat(a$, b$)`. RxJS → xstream: `switchMap(f)` → `.map(f).flatten()`, `mergeMap` → `.map(f).compose(flattenConcurrently)`, `debounceTime` → `.compose(debounce(ms))`, `distinctUntilChanged` → `dropRepeats()`, `withLatestFrom` → `sampleCombine`, `combineLatest` → `xs.combine`, `scan` → `.fold`, `takeUntil` → `.endWhen`, `tap` → `.debug`, `catchError` → `.replaceError`, `shareReplay(1)` → `.remember()`.
- **TypeScript**: `const intent = ({ DOM }: IntentSources<State>) => ({ ... })`, then `const C: Component<State, Props, {}, ActionsOf<typeof intent>, Calculated, Context, { PARENT: Payload }> = ({ state, context }) => ...` (root: `RootComponent<State, {}, Actions>`; unused parameters `{}`). Without `{ PARENT: Payload }` the parent's `CHILD.select(C)` is a `Stream<unknown>`. Register EVENTS names in `declare module 'sygnal' { interface SygnalEvents { DOC_SAVED: { id: string } } }` in a file that keeps `export {}` (without it: "has no exported member"). Guide: https://sygnal.js.org/integration/typescript/
- **Imports** (all from `'sygnal'`): `run ABORT set toggle event createCommand makeFetchDriver queryCache makeSocketDriver makeRouter makeHeadDriver driverFromAsync xs debounce throttle delay dropRepeats sampleCombine classes processForm processDrag makeDragDriver Collection Switchable Portal Transition Slot Suspense lazy createRef createRef$ renderComponent renderToString`; types `Component RootComponent Lens Resource RenderResult`. Never import the JSX runtime by hand; the Vite plugin configures it.

## 5. Wiring rules (silent failures, and what catches them)
- **Selectors are scoped to the component's own JSX (the isolation trap).** A parent's `DOM.click('.remove')` never fires for `.remove` rendered by a child or a Collection item: handle it in the child and send it up with `PARENT` (`CHILD.select(Child)`) or `EVENTS` (SYG104; a selector the view never renders is SYG110). Events still bubble: a listener on an element the parent rendered (`DOM.click('.slot')` around `<Child />`) hears clicks inside the child, after the child's own.
- **Every intent action needs a model entry (SYG101), and every model entry needs a trigger (SYG102)**: an intent action, a built-in, a reply action, or `next('X')`. Names match exactly.
- **EVENTS types must match exactly** between `event('X')` and `EVENTS.select('X')` (SYG105). `event()` is the sink entry itself: `EVENTS: () => event('X')` sends a function, which nothing receives (SYG116).
- **Collection `from` must name an array field of the state** (SYG401). Over a calculated field the list is read-only: item writes and removal (`() => undefined`) are discarded, so use `from="items"` with `sort=`/`filter=`.
- **A controlled input needs an input listener**: `value={state.x}` plus `DOM.input('.x').value()`, otherwise a re-render resets the text (SYG111). `value={null}` clears the field; leaving `value` out makes it uncontrolled.
- Also: reducers return the complete new state (`{ ...state, ... }`); never mutate; no side effects in views or STATE reducers (use EFFECT or a driver).

## 6. Canonical forms (never write the right-hand column)

| Concept | Write | Never write (strict code) |
|---|---|---|
| View signature | `function C({ state, context, ...props })` | positional `(props, state, context)` (SYG501) |
| No change | `return ABORT` | `return state`, `return;`, or falling off the end (SYG502) |
| Side effect only | `ACTION: { EFFECT: (state, data, next) => { ... } }` | a STATE reducer that does the effect then returns ABORT (SYG503) |
| Any non-STATE sink | object form `ACTION: { SINK: fn }` | `'ACTION \| SINK'` shorthand keys (SYG504) |
| Emit a global event | `EVENTS: event('TYPE', (state, data) => payload)` | `emit(...)`, raw `EVENTS: s => ({ type, data })` (SYG505) |
| Child → parent | child `PARENT: fn`; parent `CHILD.select(ChildFn)` | `CHILD.select('ChildName')` (SYG506) |
| HTTP reply | `HTTP: s => ({ url, ok: 'LOADED', error: 'FAILED' })` | `HTTP.select('cat')` / `errors('cat')` for your own request (SYG508); `fetch` in an EFFECT |
| Top-down data | `.context = { total: (state) => … }` (an object of functions) | drilling a prop through 3+ levels (SYG507); `.context = (state) => ({ … })` (SYG402) |
| Parent → child call | `createCommand()` as a prop; child `commands$.select('name')` | — |

## 7. Testing your change
```js
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import TaskList from './TaskList.jsx'
let t
afterEach(() => t?.dispose())
it('picks, then removes a task', async () => {
  t = renderComponent(TaskList, { strict: true })   // also: initialState, drivers, timeoutMs
  t.simulateEvent('.pick', 'click')                 // first match; bubbles; reaches child components too
  await t.next(s => s.picked === 1)                 // a state emitted after this call
  t.simulateEvent('.task[data-id="2"] .remove', 'click')
  await t.next(s => s.tasks.length === 1)
  await t.settle()                                  // nothing pending anywhere in the tree
  expect(t.html()).not.toContain('Test')
  t.expectNoDiagnostics()                           // throws on any warn/error diagnostic
})
```
- `simulateEvent(sel, type, init?)`: init `{ value }`, `{ checked }`, `{ key: 'Enter' }`, `{ data: { id: 2 } }`; `'document'` targets `DOM.select('document')` listeners. Calls made before the component is ready are buffered. `sel` is a CSS selector over the rendered tree (not `:has()`, `+`, `~`); if it matches nothing within 300ms the test fails naming it (check `t.html()`; `{ allowMissing: true }` drops the event).
- `t.next(pred)` matches only future states. `t.waitForState(pred)` also matches states already recorded (e.g. the initial one): use it only for a state that can't already exist. Both resolve after the whole tree renders. `t.settle()` doesn't wait out a model `next('X', data, ms)` longer than 20ms: `await t.next(pred)` instead. `t.state` is the latest state (with calculated fields); `t.states`, `t.emitted` (EVENTS sent) and `t.sinkValues('PARENT')` (any sink, children's too) are live arrays. `t.html()` is serialised like `innerHTML` (`Couldn't`, not `&#39;`); before the first render it throws: `await t.ready()`.
- Timer tests: use fake timers, never sleep out a real delay. `t.next`/`t.waitForState`/`t.settle`/`t.ready` advance the fake clock themselves; `vi.advanceTimersByTimeAsync(ms)` moves it by hand:
```js
beforeEach(() => vi.useFakeTimers())
afterEach(() => { t?.dispose(); vi.useRealTimers() })
it('searches once, 300 ms after the last keystroke', async () => {
  t = renderComponent(Search)                       // HTTP needs no driver in tests
  await t.ready()                                   // mount first, so the input is timed from here
  for (const q of ['d', 'du', 'dune']) { t.simulateEvent('.q', 'input', { value: q }); await vi.advanceTimersByTimeAsync(50) }
  await vi.advanceTimersByTimeAsync(249)
  expect(t.requests('HTTP')).toHaveLength(0)
  await t.next(s => s.status === 'Searching…')      // advances to the debounce, no real wait
  expect(t.requests('HTTP')).toHaveLength(1)
  await t.respond('HTTP', { results: [{ title: 'Dune' }] }, 'RESULTS')  // delivered as RESULTS, then rendered
  expect(t.state.status).toBe('')
})
```
- `t.simulateAction('LOADED', data)` pushes an action into intent → model. **Drivers need no wiring in tests**: the HTTP fake is the real `makeFetchDriver` over an in-memory fetch. `t.requests('HTTP')` lists requests as objects (a string URL is `{ url }`). `await t.respond('HTTP', body, target?)` answers one (its `ok` action gets the body); `await t.fail('HTTP', 404 | error, target?)` fails it. Both resolve once reduced and rendered. Target: an action/key name, a resource name, a URL, a partial request (`{ url: '/items/2' }`) or a predicate; none = the newest pending. Identical requests (a refetch): `{ nth: 0 }` is exactly `t.requests('HTTP')[0]` (`-1` the newest). A superseded, aborted or answered request **throws at the call** (`expect(() => t.respond('HTTP', {}, { nth: -2 })).toThrow()`). Write `latest: true` on the request: the fake can't see main.js.
- Resources: a fetch is `{ url, resource: 'quote' }`: `await t.respond('HTTP', data, 'quote')`. Right after a `simulate*`, `t.respond` waits for the fetch it causes. Cache: `renderComponent(C, { http: { cache: queryCache({ staleTime: 2000 }) } })`, `t.cache('HTTP')` (`{ key, stale, data }`), `t.focus()`, `t.online()`.
- Sockets: `connections` get a fake `WS` (the real driver; they open by themselves, `{ autoConnect: false }` waits for `await t.open('WS')`). `await t.push('WS', { text: 'hi' })` = a server frame; `await t.drop('WS', { code: 1011 })` = a drop the app didn't make (retry: `await vi.advanceTimersByTimeAsync(1000)`); `t.sent('WS')` = the `{ to, json }` sent; `t.connections('WS')` = `{ name, url, state }`.
- Router: `renderComponent(App, { router, url: '/tasks/2' })` runs the real router on an in-memory history: `await t.navigate('/admin')` or `t.navigate({ to: 'task', params: { id: 1 } })`, `await t.back()`, `t.location.path`, `t.sent('ROUTER')` (commands); a `simulateEvent` click on a link goes through the router. `t.head()` = `{ title, meta, link }`.
- TypeScript: `renderComponent` infers the state; declare `let t: RenderResult<State>`, not `any`. Without the Vite plugin, `import 'sygnal/diagnostics'` in the test.
- `t.query(sel)` / `t.queryAll(sel)` work on the mock DOM: snapshots of what the view rendered (`textContent`, `value`, `checked`, `disabled`, `getAttribute`, `querySelector`). E.g. `t.query('input:checked').value`, `t.query('.save').disabled`. State the user typed/clicked, focus: `renderComponent(C, { dom: 'real' })` in a jsdom test (`// @vitest-environment jsdom`), same `t.*` API in ONE suite; `'click'` toggles a checkbox, `'focus'` moves `document.activeElement`.

## 8. Diagnostics and tools
- Format: `[Sygnal SYG104] Lane: <what is wrong>. <how to fix> https://sygnal.js.org/reference/errors#syg104`. Severities error/warn/info. 1xx wiring, 2xx model/state, 3xx streams (SYG301: RxJS operator on an xstream stream), 4xx components (Collection, Switchable, context), 5xx strict, 6xx drivers and setup, 9xx internal.
- `npx --no-install sygnal-check` runs the local checker on `src` (`pages` for Vike): `--strict` for canonical forms, `--fix` for the mechanical rewrites, `--json`. Suppress one line with `// sygnal-ignore SYG110`. App graph: `--graph --json`, `t.inspect()`, or `getDevTools()?.inspect()` in a running dev app.
- Vite plugin in dev: runtime checks print to the console, and an installed `sygnal-check` runs on every save. Stricter: `sygnal({ diagnostics: { mode: 'error', strict: true }, check: { strict: true } })`. Without the plugin: `run(App, drivers, { diagnostics: 'warn' })` and `import 'sygnal/diagnostics'`.

## 9. Project setup (Vite)
`index.html` has `<div id="root"></div>` and `<script type="module" src="/src/main.js">`; `src/App.test.js` sits next to `src/App.jsx`.
```js
// vite.config.js: the plugin sets up JSX, HMR, dev diagnostics and Vitest
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'
export default defineConfig({ plugins: [sygnal()] })
```
```js
// src/main.js
import { run } from 'sygnal'
import App from './App.jsx'
run(App)   // mounts on #root; pass drivers as the 2nd argument
```
Conventions: PascalCase component files, ALL_CAPS action names, `$` suffix for streams, class-name selectors, `classes()` for conditional class names, `state="key"` to give a child a slice.

## 10. Where to look next
Every SYG code: https://sygnal.js.org/reference/errors. Testing: https://sygnal.js.org/integration/testing/; API: https://sygnal.js.org/reference/api/.
