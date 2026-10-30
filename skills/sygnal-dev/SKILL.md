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

Canonical forms, API facts, wiring rules and testing for everyday work. Full spec: `node_modules/sygnal/llms.txt`. Other features (Portals, Transitions, Suspense, Slots, SSR, Astro/Vike): https://sygnal.js.org/guide/components/. **Write only the canonical forms shown here**: `sygnal-check --strict` flags the others (SYG5xx).

## 1. Workflow

**Version first:** this skill describes Sygnal 7. Check the installed package, not just its dependency range. For 6.x, use its shipped `llms.txt` as the API reference: output reducers see pre-action state, binding changes need keys, and `previousState`, the timing audit and generic test-query overloads are unavailable until an upgrade (https://sygnal.js.org/guide/migrating-to-7/). Current sygnal-check supports both installed versions.

**New app** (no prompts): `npm create sygnal-app@latest my-app -- --template vite --js --install` (templates `vite`, `vite-pwa`, `vike`, `astro`, `mcp-app`; `--ts` for TypeScript, whose `npm run check` runs sygnal-check and `tsc --noEmit`: sygnal-check doesn't check types). Or in a Vite app: `npm i sygnal`, `npm i -D vitest`, `plugins: [sygnal()]` from `'sygnal/vite'`, and `run(App)` in `src/main.js` (§9).

**The task text is the spec**: copy labels, messages and punctuation verbatim (`Search failed.` keeps its period) and implement it; don't stop to explain or ask. Re-read the task itself, not a summary of it (such as the arguments you passed to this skill).

**Read the shipped guide before coding these, and use its API** (`node_modules/sygnal/dist/guide/`; never hand-roll them): a form with validation → `form` behavior, `forms.md`; chart, date picker, editor → `defineWidget`, `widgets.md`; long list → `<VirtualCollection>`, `virtual-collections.md`; drag to reorder → `sortable`, `drag-and-drop.md`; dialog, popover, tabs, menu, select, toast → `sygnal/ui`, `ui/overview.md`; LLM chat (the `chat` behavior), AI decisions, agent tools → `sygnal/ai`, `ai-chat.md`, `ai-decisions.md`, `agent.md`; a page or chat card a model composes from your parts → `defineCatalog` + `compose` / `chat({ ask })`, `ai-compose.md`, `ai-cards.md`; calls typed by the server's API (an oRPC contract, OpenAPI `paths`, Hono routes, or function-first `*.server.ts` modules) → `sygnal/api` (dev preview), `typed-apis.md`; several users editing the same state live or offline (a shared list, a board) → `shared()` + `makeYjsDriver` from `sygnal/yjs` (experimental), `collaborative-state.md`.

**Add a feature** (in this order):
1. **State**: add the fields to the root `initialState` (children get state from their parent).
2. **Intent**: name the action and its trigger (`DOM.click('.save')`, `EVENTS.select('X')`, `CHILD.select(Child)`).
3. **Model**: one entry per action; one function per sink (`STATE`, `EVENTS`, `PARENT`, `EFFECT`, drivers).
4. **View**: render from `state` / `context`; add the class names the intent selects.
5. **Test**: `renderComponent(C, { strict: true })` + `simulateEvent` + `t.next` + `expectNoDiagnostics()` (§7). Run `npm test`, then `npx --no-install sygnal-check --strict` (Vike: `pages`; not installed? `npm i -D sygnal-check`, or rely on the tests' runtime diagnostics).

**Debugging loop**: run `npm test` and read every `[Sygnal SYGnnn]` line; `npx --no-install sygnal-check explain SYGnnn` says what it means and how to fix it. Unclear? `t.actions` (§7); check the wiring with `t.inspect()` or `npx --no-install sygnal-check --graph --json` (triggers, selectors' `matched` / `isolationHit`, EVENTS). Fix, re-run, then `--strict` until clean. A silent no-op (a click does nothing, no error) is almost always a §5 wiring rule.

## 2. Mental model and component anatomy
- A component is a pure view function plus static properties: `.intent` (WHEN: sources → named action streams), `.model` (WHAT: action → one reducer per sink), `.initialState`.
- There is one state tree. A child sees its parent's whole state, or a slice with `state="key"` (or a path: `state="settings.rules"`, `"boards[0].title"`). A Collection item sees one array element.
- A child belongs to the record its `state` points at (Sygnal 7): when a path or `byId()` target changes, or its record is deleted, the old child is disposed (its DISPOSE gets its last state; its requests, timers and subscriptions are cancelled) and a new one mounts with fresh local state and new DOM (focus and typing inside it are lost). So `<Workspace state={byId('projects', selected.id)} />` needs no key. Same for Collection/VirtualCollection `from` and Switchable `state`. A stable `key` doesn't keep a child across a target change (keep that state in the parent); a custom lens needs `key={record.id}`. Sygnal 6 fixes bindings at mount: use `key={selected.id}` there (SYG454).
- Every side effect is a sink of a model entry (STATE, EVENTS, PARENT, EFFECT, custom drivers). JSX never has event handlers (`onClick`).
- Streams are xstream, not RxJS: `import { xs } from 'sygnal'` (not `import xs from 'xstream'`, the module object under Node ESM / Vite 8: SYG302). An intent's DOM selectors only see the component's own JSX, never a child component's.

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
Counter.context = { total: state => state.count }        // itself + descendants: ({ context }) => context.total
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
- Reducer `(state, data, next, props)`. `data` is the action stream's value. `next('ACTION', data?, delayMs = 10)` dispatches another action of this component only (a child's `next('X')` never reaches a parent's `X`, SYG117: send it up with `PARENT` / `EVENTS`), also later (repeating: the `timers` static, §3). HTTP goes through `makeFetchDriver` (§3), not `fetch` + `next()`. `props`: as the view's 1st arg.
- Model entry: a function is the STATE reducer. An object `{ STATE, EVENTS, PARENT, EFFECT, LOG, <DRIVER>: fn }` maps each sink to a `(state, data, next, props)` function whose return value goes to that sink (`<SINK>: true` forwards `data`).
- **STATE runs first in every entry (Sygnal 7)**; every other sink gets the committed state, calculated fields included: `INC: { STATE: s => ({ ...s, n: s.n + 1 }), PARENT: s => ({ n: s.n }) }` (`s.n + 1` would count twice). The state from before the action is `props.previousState` (4th argument): read it for a value STATE cleared or deleted, and in a guard that admits the action: `HTTP: (s, d, next, { previousState }) => (previousState.status === 'working' ? ABORT : { url: '/api/work', ok: 'DONE' })` (`s.status` is already `'working'` there; keep the guard, since STATE's `ABORT` doesn't cancel other sinks; SYG256). The tradeoff: payloads read `state`, guards read `previousState`. When STATE removes the component's own state (`() => undefined`), its other sinks get its last state. Behaviors: the slice and `props.state` are after STATE, the old slice is `props.previousState[key]`. Code for 6 and 7 reads old values as `props.previousState ?? state`. Upgrading 6.x code (every reducer saw the old state): turn on the timing audit, `renderComponent(C, { timingAudit: true })` or `sygnal({ diagnostics: { timingAudit: true } })`, and decide each SYG257. Guide: `node_modules/sygnal/dist/guide/migrating-to-7.md`
- **The clock and randomness** come from the handler's 4th argument, never the globals: `ADD_TASK: (state, title, next, { now, uuid }) => ({ ...state, tasks: [...state.tasks, { id: uuid(), title, created: now() }] })` (also `random()`; EFFECTs too, also after an `await`). They are `Date.now()` / `Math.random()` / `crypto.randomUUID()`, but tests fix them (`renderComponent(C, { now: Date.parse('2026-01-01'), random: 1, uuid: true })`: fixed clock, seeded random, ids `00000000-0000-4000-8000-000000000001`, `…002`) and a replay supplies the recorded values. `Date.now()` / `new Date()` / `Math.random()` / `crypto.randomUUID()` in a STATE reducer is SYG258 (any handler: SYG509, strict); `sygnal-check --fix` rewrites them. A prop named `now` / `random` / `uuid` shadows them.
- Built-in actions (model only): `BOOTSTRAP` (once, just after mount), `INITIALIZE` (sets initialState), `DISPOSE` (unmount).
- Declaration statics (`connections`, `resources`, `route`, `head`, `timers`) are computed from state and work with or without a model. `uses`, `persist`, `viewTransitions` are reserved too.

## 3. Canonical examples
### State update, ABORT, set / toggle, controlled input
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
    EVENTS: event('DOC_SAVED', (state) => ({ id: state.id })),  // or event('RESET'), event('MODE', 'dark'); return ABORT to send nothing
  },
}
function Toast({ state }) {   // anywhere in the tree: EVENTS is a global bus
  return <p className="toast">{state.lastSaved}</p>
}
Toast.intent = ({ EVENTS }) => ({ SAVED: EVENTS.select('DOC_SAVED') })  // emits the payload only
Toast.model = { SAVED: (state, payload) => ({ ...state, lastSaved: payload.id }) }
```
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
      <ul className="tasks">
        <Collection of={TaskItem} from="tasks" />
      </ul>
    </div>
  )
}
TaskList.initialState = { picked: null, tasks: [{ id: 1, title: 'Write' }, { id: 2, title: 'Test' }] }
TaskList.intent = ({ CHILD }) => ({ PICKED: CHILD.select(TaskItem) })  // the function, not a string
TaskList.model = { PICKED: (state, { taskId }) => ({ ...state, picked: taskId }) }
```
- Removal in the object form keeps the STATE entry: `REMOVE: { STATE: () => undefined, EVENTS: event('REMOVED', (state) => state.id) }` (its other sinks get the item's last state). Without `STATE: () => undefined` the item stays.
- `from` names an array field (or a path to one: `from="board.cards"`); items are keyed by `.id` (else index). `filter={t => !t.done}`; `sort="title"`, `sort={{ title: 'desc' }}`, an array of those, or a compare function: they only change what renders, and an item's edit is written back to its element by key. Items render directly into the parent, no wrapper (`className` on it is SYG612: put it on your own `<ul>`).
- Switchable: `<Switchable of={{ home: Home, settings: Settings }} current={state.tab} />` (optional `state="slice"`, or per page: `state={{ projects: 'pages.projects', settings: byId('teams', state.teamId) }}`, each page following its own binding; unlisted pages share the owner's state; a key that names no page is SYG429). Hidden pages stay alive; `instance={key}` re-creates the current page with fresh state when the key changes.
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
`const player = createCommand()` (from `'sygnal'`); the parent renders `<Player commands={player} state="player" />` and calls it from an EFFECT (returns nothing): `PLAY: { EFFECT: () => player.send('play', data?) }`; the child listens with `PLAY: commands$.select('play')` (emits `send()`'s data).
### Behaviors (`uses`): shared state + actions
- `TaskList.uses = { pager: pager({ pageSize: 10, next: '.newer', prev: '.older' }) }` adds `state.pager` (`{ page, pageSize, total }` + calculated `offset`, `pages`, `hasPrev`, `hasNext`) and the actions `pager.NEXT`, `pager.PREV`, `pager.GOTO`, `pager.SET_TOTAL` (clicks on `next`/`prev`). The key must not also be in `initialState` (SYG127). Also `selection({ multi: true, item: '.pick', from: 'mails' })` + `isSelected(state.sel, id)`, `undo({ key: 'doc', undo: '.undo', redo: '.redo' })` (`coalesce: ['TYPE'], coalesceMs: 500` groups only typing).
- Your own: `const disclosure = defineBehavior({ initialState: { open: false }, intent: ({ DOM }, { toggle }) => ({ TOGGLE: DOM.click(toggle) }), model: { TOGGLE: (slice) => ({ ...slice, open: !slice.open }) } })`, used as `uses = { more: disclosure({ toggle: '.more' }) }`: reducers get and return the slice. The host writes `'more.TOGGLE'` in its intent (replaces the trigger) or model (runs after the behavior's, on the full state), and `t.simulateAction('more.TOGGLE')`. Guide: `node_modules/sygnal/dist/guide/behaviors.md`
### Forms, widgets, UI parts
- **Form with validation**: `Signup.uses = { form: form(schema, { values: { email: '', items: [{ id: 1, qty: '1' }] }, request: { url: '/api/signup' } }) }` (any Standard Schema). Fields inside the `<form>` match by `name`: no intent per field. View: `const f = state.form.fields`, `value={f.email.value}`, `{f.email.error}` (after blur/submit), `aria-invalid={f.email.invalid}`, ids from `uid()`. An invalid submit focuses the first invalid field; a valid one sends `request` with the parsed values (the form adds `json`/`multipart`, `ok: 'form.DONE'`, `error: 'form.ERRORS'`, `progress: 'form.PROGRESS'`; `(data, state) => ({ url, method: 'PUT' })` when it needs state); `state.form.submitting` until the reply; a submit that sends nothing: `submit: 'NEXT'` + `NEXT: { PARENT: … }`, done at once; a 422 `{ errors: { name: msg } }` or `[{ path, message }]` lands on the fields. Rows inline, no Collection child: `name={f['items.' + row.id + '.qty'].name}`, `'form.ADD': DOM.click('.add').mapTo({ field: 'items', value: { qty: '1' } })`, `'form.REMOVE': DOM.click('.remove').map(e => ({ field: 'items', id: e.target.dataset.id }))` (`data-id={row.id}`). Tests: `t.simulateEvent('[name="email"]', 'input', { value })`, `'focusout'`, `'submit'` on the form.
- **`form` values live in the host's state** (a Switchable page shares its parent's), so they survive visits. Empty on each visit: `form(schema, { values: EMPTY, submit: 'SAVE', resetOnShow: true })`; a default from state: `values: (state) => ({ ...EMPTY, kind: state.settings.kind })`. Keep `resetOnShow` when removing a feature.
- **Third-party widget** (date picker, chart, editor): `defineWidget({ tag, mount(el, props, dispatch), update, unmount, events, commands })` is a tag: `<DatePicker className="due" value={state.due} />`, `DOM.select('.due').events('pick').detail()` (never `DOM.select(DatePicker)`), `OPEN: { ELEMENT: { open: '.due' } }`; tests `t.widget('.due').dispatch('pick', d)`. `update` runs only when a prop is a different value (shallow): pass a chart a new array, never one changed in place. A web component is an element: render its tag, select its class (`web-components.md`).
- **Imperative island** (three.js scene, canvas, map with markers as JSX children): `defineWidget({ children: true, mount, sync })`; the children are elements the widget reads in `sync` and draws; it dispatches DOM events on them (raycast / hit test → `click` on `v.elm`), so each child component's intent uses `DOM.click('.cube')`. Per-frame motion is computed in the widget from props, not in state (`islands.md`). A three.js scene: `<Scene>` from `sygnal/three` (`npm install three`): meshes, geometries, materials, lights and cameras as lowercase tags, raycast hits as `click` / `pointerover` on the mesh's element with `event.point`, `animate={{ rotation: (t) => [0, t, 0] }}` for motion, `<Model src="/tree.glb" />` / `<Texture src="/wood.jpg" />` for loaded assets (with `<Suspense>`; a failed load renders `onError`), `capture="xz"` to drag a mesh along the floor (`pointermove` with `event.captured` and `event.delta`), `draggable` for `processDrag`, tests with `sceneOf(el).click(meshEl)` / `.drag(meshEl, [x, y])` under `dom: 'real'` (`renderers/three.md`).
- Dialog, popover, tooltip (`tooltips()` for many triggers), tabs, accordion, disclosure, toasts → `sygnal/ui` behaviors + `<Toaster />`; Menu/Select/Combobox → `sygnal/ui/menu|select|combobox` widget tags (events `select` / `value-change`); one React or Zag component → `fromReact` / `fromZag` (`adapters.md`).
- Drag to reorder → `uses = { sort: sortable({ from, item, handle }) }` + a live region for `state.sort.message` (English; a spec's wording: `messages: { drop, cancel, … }`, `(label, position, count) => text`). Long list → `<VirtualCollection className="rows">` is the scroll container: height, `aria-label`, `role` on it, never in your own scrolling `<ul>` (SYG430: fix the height); jump with `ELEMENT { scrollToIndex | scrollToId }`. Visibility/size/media/storage/network → `browser` static + `makeBrowserDriver()` (`browser-sources.md`); `lazy(…, { when: 'visible' })`.
- Table → TanStack in the view; i18n → `.context.t` + `persist` (`recipes/overview.md`).
- **AI** (`sygnal/ai`): a chat conversation is the `chat` behavior, never hand-rolled: `uses = { chat: chat({ agent: false, form: '.ask', prompt: '.prompt', stop: '.stop', regenerate: '.retry' }) }` → `state.chat` (`messages`, `prompt`, `draft`, `status`, `error`; Stop keeps the partial reply, Retry doesn't repeat the question); a one-off request (summary, structured `output`) is an `LLM` sink request `{ messages: [{ role: 'user', content: text }], delta: 'DELTA', ok: 'DONE', error: 'FAILED' }`; both need `makeChatDriver({ transport })` (tests: `t.stream('LLM', ['Hi'])`); what agents may run is the `agent` static `{ name, description, read, actions, queries }` (only declared actions; `read` is all they see; `queries: { find: { description, input, run: (state, input) => result } }` are read-only lookups, pure and synchronous; an action that starts a fetch answers once it lands with `until: 'resourceName'`; tests: `t.callTool(name, args)`); typed answers: `decide()` + `choice` / `noul` / `score` as a resource. No provider API key in the browser: `uiMessageStream('/api/chat')` to your server.
### Composed UI and chat cards (`sygnal/ai`)
A model builds a page (or a card in a chat) from parts the app prepared: it only picks parts, params and places, never markup. Guides: `ai-compose.md`, `ai-cards.md`.
```jsx
import { defineCatalog, compose, Composed } from 'sygnal/ai'
import { OrdersTable, Checklist } from './parts.jsx'

export const catalog = defineCatalog({
  parts: {
    orders: {
      component: OrdersTable,
      description: 'Orders (table of recent orders)',   // all a model sees: "Noun (what it shows)"
      params: { status: { default: 'any', options: { any: 'orders of every status', pending: 'pending orders (not paid yet)' } } },
    },
    tasks: { component: Checklist, state: 'tasks', description: "Tasks (the user's checklist)" },   // a lens into app state
  },
})

export function Dashboard({ state }) {
  return (
    <main>
      <form className="ask">
        <input className="prompt" aria-label="The page you want" value={state.page.prompt} />
        <button type="submit">Compose</button>
      </form>
      <Composed catalog={catalog} from="page" />
    </main>
  )
}
Dashboard.initialState = { tasks: [] }
Dashboard.uses = { page: compose(catalog, { backend: compose.decisions({ model: 'jev-latest' }), form: '.ask', prompt: '.prompt' }) }
```
```js
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { composeWith } from 'sygnal/ai'
import { catalog, Dashboard } from './Dashboard.jsx'

it('composes the pending orders', async () => {
  const t = renderComponent(Dashboard)
  t.simulateAction('page.COMPOSE', 'Pending orders')
  await composeWith(t, catalog, [{ part: 'orders', params: { status: 'pending' } }])   // answers either backend
  await t.waitForState((s) => s.page.status === 'done')
  expect(t.state.page.layout.nodes.orders.params).toEqual({ status: 'pending' })
  t.dispose()
})
```
- `backend: compose.llm()` (the `LLM` sink, a streamed preview) takes the same catalog, view and tests. `compose.decisions()` posts to your `/api/decide` route, which holds the API key. `state.page`: `status` (`'composing' | 'preview' | 'done' | 'unavailable' | 'error'`), `layout` (plain JSON), `decisions`, `error`.
- Parts are the host's children, keyed by their node key: params arrive as props, `CHILD.select(Part)` hears their `PARENT`, a `state` lens edits app state. A follow-up `next('page.COMPOSE', 'Move the orders to the top')` edits the page and keeps the untouched parts' instances; `{ prompt, fresh: true }` starts over. One part per record: a param `{ from: (state) => records }` + `state: (node) => byId('customers', node.params.id)` (`byId` from `'sygnal'`). Containers (`containers: { tabs: { slots, render: (view) => … } }`) are view functions, never components (SYG161). `{catalog.render(state.page, state)}` is the view-call form of `<Composed>`. An agent composes with `actions: { ...compose.action('page') }` and reads `compose.summary(state.page)`.
- **Chat cards**: `chat({ form: '.ask', prompt: '.prompt', ask: { catalog } })` under `assistant` gives the model `ask_user({ need })`; render each `tool-ask_user` message part with `askCard(catalog, state, part)` (null while composing; the card is `part.ui`, `status` `'composing' | 'open' | 'answered' | 'failed' | 'cancelled'`). A part with `result: true` answers it: `PICK: { PARENT: (state, id, next, props) => compose.answer(props, id) }` → the call's output `{ part, answer }` (no result part: SYG686). Tools the app answers itself: `clientTools: { confirm: { description, inputSchema } }`, `openToolCalls(state.assistant)`, `next('assistant.TOOL_OUTPUT', { toolCallId, output })`. Tests: `await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'ask_user', input: { need: 'Pick a plan' } } }])`, then `await composeWith(t, catalog, [{ part: 'plans' }])`.
### Element commands, timers, persistence
- **ELEMENT** (built in) calls a method on an element of the sending instance's view, after the render the action causes: `ELEMENT: (s) => (validate(s).email ? { focus: '.email' } : ABORT)`. First key = method (`focus`, `scrollIntoView`, `showModal`, `close`…), its value the target; other keys are options (`{ close: '.help', returnValue: 'done' }`); an array sends several. Tests: `t.commands('ELEMENT')`. `node_modules/sygnal/dist/guide/element-commands.md`
- **Timers**: `Clock.timers = (state) => ({ tick: state.running && { every: 1000, action: 'TICK' } })` (or `{ after: ms, action }`, `{ frame: 'FRAME' }`), diffed by name: falsy stops. Needs `run(App, { TIMER: makeTimerDriver() })` (SYG643); `TICK` gets `{ n, t }`. Tests need no driver: fake timers + `t.timers()`. `node_modules/sygnal/dist/guide/timers.md`
- **Persistence** (root only): `App.persist = persist({ key: 'todo-app', pick: ['todos', 'filter'] })` (`version`, `migrate`, `omit`, `storage`, `sync`) restores before the first render and saves `{ version, state }` after changes (`format: 'plain'`: the picked keys alone); `PERSIST: { clear: true }` removes it. Tests: `renderComponent(App, { storage: { 'todo-app': { version: 1, state: { todos: [] } } } })`, `t.storage('todo-app')` after `await t.settle()`. `node_modules/sygnal/dist/guide/persistence.md`
### HTTP (makeFetchDriver + reply actions), latest response only
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
- main.js: `run(Search, { HTTP: makeFetchDriver() })` (options `baseUrl headers init timeoutMs`). Request: `{ url, ok, error, key, query, json, body, method, headers, latest, timeoutMs, init }` (POST with json/body); extra fields aren't sent and come back on `request`. `ok` gets the parsed body; `error` gets `{ error, status, body, request }` (`status` undefined: network error). The reply reaches exactly the sending instance. Never `HTTP.select`/`HTTP.errors` for your own request (SYG508), never `then`/`catch` keys (SYG610). Upload progress: `progress: 'UPLOADING'` with `multipart: { file: state.file }` (the multipart body as data, not `new FormData()`; the file from the input's `change` event; in a `form`, a file input named in `values` is a field: `request` sends it as multipart, `state.form.progress`, key the input with `state.form.resets`) sends `{ phase, loaded, total, fraction }` steps as that action; tests `await t.progress('HTTP', { loaded: 1, total: 2 }, 'UPLOADING')`.
- Typed API (`sygnal/api`, dev preview): `api = orpcClient(contract, { prefix: '/api' })` builds requests from the server's contract: `api.quotes.list({ tag })` (a resource), `api.quotes.add(input, { ok: 'ADDED', error: 'FAILED', invalidates: [api.quotes.list] })`, streams as `connections` entries; type actions `Output<typeof api.quotes.add>` / `ApiFailure<…>`; tests `t.respond('HTTP', fixture(api.quotes.list, rows), api.quotes.list)`. Function-first, with `sygnal({ api: { functions: true } })`: `export const list = query(schema, async (input) => …)` (or `mutation`, `stream`) in `src/*.server.ts`, imported by components like an endpoint (only `query`/`mutation`/`stream` exports reach the client: SYG691); the server mounts `serverFunctions(import.meta.glob('/src/**/*.server.ts', { eager: true }), { os })` with oRPC. Contract-first is the primary form.
- `latest: true`: a newer request in the same lane (`key`: a constant name, never an id or URL; default the `ok` action) aborts this instance's older ones once sent; a reply landing earlier (during a debounce) still arrives. `{ abort: 'RESULTS' }` cancels that lane (with a custom `key`, abort that key). **The request sees what STATE stored**: `SHOW: { STATE: (s, id) => ({ ...s, id }), HTTP: (s) => ({ url: '/api/q/' + s.id, ok: 'LOADED' }) }` (or build it from `id`).
- Other promise APIs: `driverFromAsync(fn)` takes the same reply actions (`{ value, ok: 'DONE', error: 'FAILED' }` calls `fn(value)`). A hand-written driver that replies (several times: progress, then ok): `const { replies, reply } = makeReplies(onStop)`, `reply(senderOf(req), req.ok, value)`, return `{ ...replies }`. One-off async work: `EFFECT: async (state, data, next, { signal }) => { ...; next('DONE', r) }`. Page-wide events: `DOM.select('document').events(type)`, filtered: `DOM.select('document').select('.overlay').events('click')`.
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
- **A component that reads `state.items` declares `items` in its own `.resources`** (even if another page does): otherwise it is undefined on a direct visit, or what another page loaded; a test that starts on that page hides this. A `queryCache()` serves the repeat at once.
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
- main.js: `run(Chat, { WS: makeSocketDriver() })`; without it nothing opens, silently. Spec: `socket` or `sse` (read-only; `events: { 'price-update': 'PRICE' }`), optional `message open close error` actions, `reconnect` (`false` = never), `share` (default: one socket per URL), SSE `headers` (`{ authorization: 'Bearer ' + state.token }`: read with fetch, since EventSource sends no headers), SSE `meta: true` (`{ data, id, event }`), `resume: true | 'param'` (reconnects resume from the last event id), `staleAfterMs` (silence = a reconnecting drop, `close` gets `stale: true`). `close` fires only for drops the app didn't cause (leaving, a URL change and unmount close silently), so no connection ids. `{ to }` on an undeclared, closed or SSE connection is SYG611. Guide: https://sygnal.js.org/guide/sockets/
- A hidden Switchable page pauses its connections and resources; `background: true` on an entry keeps it live.
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
// TaskPage: no initialState (SYG405); view + intent as usual
TaskPage.model = {
  EDIT:  { STATE: (state, draft) => ({ ...state, draft }), ROUTER: () => ({ block: 'CONFIRM_LEAVE' }) },  // guard unsaved changes
  CONFIRM_LEAVE: (state, { proceed }) => ({ ...state, leaving: proceed }),   // a blocked navigation: { to, route, proceed }
  LEAVE: { STATE: (state) => ({ ...state, leaving: null }), ROUTER: (state, data, next, { previousState }) => ({ ...previousState.leaving, block: false }) },
  DONE:  { ROUTER: () => ({ to: 'home', block: false }) },   // also { to, params, query, replace }, { url }, { back: true }
}
```
- Links are plain `<a href={href(...)}>`: the driver intercepts same-origin clicks. `params` are strings. `instance={state.route.path}` gives `/tasks/1` and `/tasks/2` separate page state. SSR: `router.current(req.url)`. Vike: `makeRouter({ routes, navigate })` (from `'vike/client/router'`). Guides: https://sygnal.js.org/guide/router/, https://sygnal.js.org/guide/head/ Pages read the route from context (`App.context = { route: (s) => s.route }`), and every declaration static (`resources timers connections head browser`) gets `(state, context)`: `TaskPage.resources = { task: (s, { route }) => `/api/tasks/${route.params.id}` }` (recomputed when the context changes).

## 4. API facts
- **Child props**: `<Rating name="food" value={state.food} />` → `function Rating({ state, name, value })`; reducers read `props.name` (4th arg); intent gets `props$`. Reserved: `state` (`"key"`, a path `"a.b"` / `"a[0].b"` (for list items use `byId`), or a `{ get, set }` lens), `children`, `slots`, `context`, `uid` (SYG106). `key={…}` is a child's identity (not a prop; else its `id` prop, else its place): a new key re-creates it. Without `state=` a child shares its parent's whole state. A child rendered by tag (`<Stopwatch state="stopwatch" />`) has no `initialState`: its start values go in the parent's (`stopwatch: { ms: 0 }`); its own is SYG405. `uid('email')` (view prop) is a stable per-instance id for `id`/`for`/`aria-*` pairs.
- **CHILD.select(Comp)** emits exactly what the child's `PARENT` function returned, for every instance (Collection items too). Put an id in the payload.
- **run(App, drivers = {}, { mountPoint = '#root', diagnostics, onError })** returns `{ sources, sinks, dispose, hmr }`. `onError: (error, { componentName, action, phase }) => …` reports every error (reporting only). DOM, EVENTS, LOG and STATE are built in. `app.sources.STATE.stream` is the state stream; `app.dispose()` fires DISPOSE.
- **ABORT**: from a STATE reducer, the state is unchanged (so is returning the same `state` object); from any other sink, nothing is sent.
- **React to a state change**: `SAVE: STATE.watch(state => state.text).compose(debounce(1000))` in intent emits the value when it changes (structural compare; `{ immediate: true }` also emits the current one). Not `STATE.stream` + `dropRepeats()`.
- **Focus**: `blur`/`focus` don't bubble, but `DOM.blur('.field')` and `DOM.focus('.field')` work (listener on the element). For any field inside a container use the bubbling `DOM.focusout('.form')` / `DOM.focusin`.
- **Shorthands**: `DOM.<event>('.sel')` = `DOM.select('.sel').events('<event>')` for every real DOM event name. `DOM.key`/`DOM.enter`/`DOM.escape` never fire (SYG115). Escape anywhere: `DOM.keydown('document').key().filter(k => k === 'Escape')`. `preventDefault`: `DOM.select('form').events('submit', { preventDefault: true })`; a function picks events: `DOM.select('document').events('keydown', { preventDefault: (e) => e.ctrlKey && e.key === 'z' })`.
- **Enriched streams** (chainable, optional mapper): `.value(fn?)` e.target.value; `.checked(fn?)` boolean; `.key(fn?)` e.key; `.target(fn?)`; `.data('id', Number)` reads `data-id` on the target or nearest ancestor (`data={{ id: 7 }}`); `.data('taskId')` reads `data-task-id`. A `data-task-id="1"` attribute works too, but a kebab key in the prop (`data={{ 'task-id': 1 }}`) throws (SYG421).
- **xstream**: `xs.merge/combine/of/periodic/never/fromPromise`. From `'sygnal'`, used with `.compose(...)`: `debounce(ms) throttle(ms) delay(ms) dropRepeats() sampleCombine(other$) flattenConcurrently flattenSequentially`; plus `concat(a$, b$)`. RxJS → xstream: `switchMap(f)` → `.map(f).flatten()`, `mergeMap` → `.map(f).compose(flattenConcurrently)`, `debounceTime` → `.compose(debounce(ms))`, `distinctUntilChanged` → `dropRepeats()`, `withLatestFrom` → `sampleCombine`, `combineLatest` → `xs.combine`, `scan` → `.fold`, `takeUntil` → `.endWhen`, `tap` → `.debug`, `catchError` → `.replaceError`, `shareReplay(1)` → `.remember()`.
- **TypeScript**: `const intent = ({ DOM }: IntentSources<State>) => ({ ... })`, then `const C: Component<State, Props, {}, ActionsOf<typeof intent>, Calculated, Context, { PARENT: Payload }> = ({ state, context }) => ...` (root: `RootComponent<State, {}, Actions>`; unused parameters `{}`). Without `{ PARENT: Payload }` the parent's `CHILD.select(C)` is a `Stream<unknown>`. Register EVENTS names in `declare module 'sygnal' { interface SygnalEvents { DOC_SAVED: { id: string } } }` in a file that keeps `export {}` (without it: "has no exported member"). Guide: https://sygnal.js.org/integration/typescript/
- **Imports** (all from `'sygnal'`): `run ABORT set toggle event createCommand makeFetchDriver queryCache makeSocketDriver makeRouter makeHeadDriver makeTimerDriver makeViewTransitionDOMDriver persist defineBehavior pager selection isSelected undo undoable form defineWidget sortable focusWithin makeBrowserDriver driverFromAsync xs debounce throttle delay dropRepeats sampleCombine classes processForm processDrag makeDragDriver Collection VirtualCollection Switchable Portal Transition Slot Suspense lazy createRef createRef$ byId renderComponent renderToString`; types `Component RootComponent Lens Resource RenderResult`. Never import the JSX runtime by hand; the Vite plugin configures it.

## 5. Wiring rules (silent failures, and what catches them)
- **Selectors are scoped to the component's own JSX (the isolation trap).** A parent's `DOM.click('.remove')` never fires for `.remove` rendered by a child or a Collection item: handle it in the child and send it up with `PARENT` (`CHILD.select(Child)`) or `EVENTS` (SYG104; a selector the view never renders is SYG110). Events still bubble: a listener on an element the parent rendered (`DOM.click('.slot')` around `<Child />`) hears clicks inside the child, after the child's own.
- **Every intent action needs a model entry (SYG101), and every model entry needs a trigger (SYG102)**: an intent action, a built-in, a reply action, or `next('X')`. Names match exactly.
- **EVENTS types must match exactly** between `event('X')` and `EVENTS.select('X')` (SYG105). `event()` is the sink entry itself: `EVENTS: () => event('X')` sends a function, which nothing receives (SYG116).
- **Collection `from` must name an array field of the state** (SYG401). Over a calculated field the list is read-only: item writes and removal (`() => undefined`) are discarded, so use `from="items"` with `sort=`/`filter=`.
- **A controlled input needs an input listener**: `value={state.x}` plus `DOM.input('.x').value()`, otherwise a re-render resets the text (SYG111). `value={null}` clears the field; leaving `value` out makes it uncontrolled.
- Also: reducers return the complete new state (`{ ...state, ... }`); never mutate (a mutated `state` returned as-is is ignored: SYG222); no side effects in views or STATE reducers (use EFFECT or a driver).

## 6. Canonical forms (never write the right-hand column)

| Concept | Write | Never write (strict code) |
|---|---|---|
| View signature | `function C({ state, context, ...props })` | positional `(props, state, context)` (SYG501) |
| No change | `return ABORT` (the same `state` object works too) | mutating `state` and returning it (ignored: SYG222); `return;` or falling off the end (SYG202) |
| Side effect only | `ACTION: { EFFECT: (state, data, next) => { ... } }` | a STATE reducer that does the effect then returns ABORT (SYG503) |
| Any non-STATE sink | object form `ACTION: { SINK: fn }` | `'ACTION \| SINK'` shorthand keys (SYG504) |
| Emit a global event | `EVENTS: event('TYPE', (state, data) => payload)` | `emit(...)`, raw `EVENTS: s => ({ type, data })` (SYG505) |
| Child → parent | child `PARENT: fn`; parent `CHILD.select(ChildFn)` | `CHILD.select('ChildName')` (SYG506) |
| HTTP reply | `HTTP: s => ({ url, ok: 'LOADED', error: 'FAILED' })` | `HTTP.select('cat')` / `errors('cat')` for your own request (SYG508); `fetch` in an EFFECT |
| Top-down data | `.context = { total: (state) => … }` (an object of functions) | drilling a prop through 3+ levels (SYG507); `.context = (state) => ({ … })` (SYG402) |
| Clock / randomness in a handler | `(state, data, next, { now, random, uuid }) => …` (4th argument) | `Date.now()`, `new Date()`, `Math.random()`, `crypto.randomUUID()` in a reducer (SYG258) or any handler (SYG509) |
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
- `simulateEvent(sel, type, init?)`: init `{ value }`, `{ checked }`, `{ key: 'Enter' }`, `{ data: { id: 2 } }`; `'document'` targets `DOM.select('document')` listeners. Calls made before the component is ready are buffered. `sel` is a CSS selector over the rendered tree (not `:has()`, `+`, `~`); if it matches nothing within 300ms the test fails naming it (check `t.html()`; `{ allowMissing: true }` drops the event). Never an element (`t.query()` gives snapshots); real DOM: `dom: 'real'`, not `'jsdom'`.
- With `dom: 'real'`, simulated inputs wait for a quiet, patched tree between deliveries (10 ms), so a large queued batch may exceed `timeoutMs` without losing writes. Use native button `.click()` calls for a synchronous burst test, or give serialized tests a larger timeout. `eventWaitMs` is the target-readiness budget, not a quiet-window switch; wait timeouts report queued input counts.
- `t.next(pred)` matches only future states. `t.waitForState(pred)` also matches states already recorded (e.g. the initial one): use it only for a state that can't already exist. Both resolve after the whole tree renders. After `await t.respond`/`t.fail`/`t.settle` the state is there: assert on `t.state` (a `t.next` then times out). `t.settle()` doesn't wait out a model `next('X', data, ms)` longer than 20ms: `await t.next(pred)` instead. `t.state` is the latest state (with calculated fields); `t.states`, `t.emitted` (EVENTS sent) and `t.sinkValues('PARENT')` (any sink, children's too) are live arrays. `t.html()` is serialised like `innerHTML` (`Couldn't`, not `&#39;`); before the first render it throws: `await t.ready()`.
- Timer tests: use fake timers, never sleep out a real delay. `t.next`/`t.waitForState`/`t.settle`/`t.ready` advance the fake clock themselves; `vi.advanceTimersByTimeAsync(ms)` moves it by hand. Each wait fails after 2000 ms of clock time: for a state a longer timer brings, `t.next(pred, 6000)` (or `renderComponent(C, { timeoutMs })`):
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
- `t.actions` logs every action, `{ type, data, component, sinks, cause, at }`: when "nothing happened", it shows whether the action ran and what it produced. `t.explain(s => s.count === 5)` names the action behind a state.
- `t.simulateAction('LOADED', data)` pushes an action into intent → model. **Drivers need no wiring in tests**: the HTTP fake is the real `makeFetchDriver` over an in-memory fetch. `t.requests('HTTP')` lists requests as objects (a string URL is `{ url }`). `await t.respond('HTTP', body, target?)` answers one (its `ok` action gets the body); `await t.fail('HTTP', 404 | error, target?)` fails it. Both resolve once reduced and rendered. Target: an action/key name, a resource name, a URL, a partial request (`{ url: '/items/2' }`) or a predicate; none = the newest pending. Identical requests (a refetch): `{ nth: 0 }` is exactly `t.requests('HTTP')[0]` (`-1` the newest). A superseded, aborted or answered request **throws at the call**. Write `latest: true` on the request: the fake can't see main.js.
- Resources: a fetch is `{ url, resource: 'quote' }`: `await t.respond('HTTP', data, 'quote')`. Right after a `simulate*`, `t.respond` waits for the fetch it causes. Cache: `renderComponent(C, { http: { cache: queryCache({ staleTime: 2000 }) } })`, `t.cache('HTTP')` (`{ key, stale, data }`), `t.focus()`, `t.online()`.
- Sockets: `connections` get a fake `WS` (the real driver; they open by themselves, `{ autoConnect: false }` waits for `await t.open('WS')`). `await t.push('WS', { text: 'hi' })` = a server frame; `await t.drop('WS', { code: 1011 })` = a drop the app didn't make (retry: `await vi.advanceTimersByTimeAsync(1000)`); `t.sent('WS')` = the `{ to, json }` sent; `t.connections('WS')` = `{ name, url, state }`.
- Router: `renderComponent(App, { router, url: '/tasks/2' })` (the first render is already on `url`) runs the real router on an in-memory history: `await t.navigate('/admin')` or `t.navigate({ to: 'task', params: { id: 1 } })`, `await t.back()`, `t.location.path`, `t.sent('ROUTER')` (commands); a `simulateEvent` click on a link goes through the router. `t.head()` = `{ title, meta, link }`.
- TypeScript: `renderComponent` infers the state; declare `let t: RenderResult<State>`, not `any`. Without the Vite plugin, `import 'sygnal/diagnostics'` in the test.
- `t.query<HTMLInputElement>(sel)` / `t.queryAll<HTMLInputElement>(sel)` (or typed control tokens; generic types are assertions, and a single query is nullable) work on the mock DOM: snapshots of what the view rendered (`textContent`, `value`, `checked`, `disabled`, `getAttribute`, `querySelector`). State the user typed/clicked, focus: `renderComponent(C, { dom: 'real' })` in a jsdom test (`// @vitest-environment jsdom`), same `t.*` API in ONE suite; `'click'` toggles a checkbox, `'focus'` moves `document.activeElement`.
- Record and replay (dev preview, `sygnal/replay`): `const rec = startRecording()` before `run(App)` records the session's input actions (redaction of typed text and server data on by default; `{ redact: { keep: ['SET_FILTER'] } }` / `false`); `rec.stop()` gives JSON. In a test, `const r = await replay(App, log)` (also from `'sygnal'`) replays it in renderComponent: `r.divergence` (first action whose state differs, with `diff`), `r.view` (view-only change), `r.effects`, `r.unhandled`, `r.warnings`, `r.final`, `r.t.dispose()`. `replayTest(log)` writes the test file, `bugReport(log, r)` Markdown; DevTools' Copy as test has `{ mode: 'replay' }`. Guide: https://sygnal.js.org/guide/record-replay/

## 8. Diagnostics and tools
- Format: `[Sygnal SYG104] Lane: <what is wrong>. <how to fix> https://sygnal.js.org/reference/errors#syg104`. 1xx wiring, 2xx model/state, 3xx streams (SYG301: an RxJS operator), 4xx components, 5xx strict, 6xx drivers, 7xx accessibility (static: a clicked `div`, an unlabelled field, `<img>` without `alt`; warn, `--a11y=error` fails), 9xx internal.
- `npx --no-install sygnal-check` runs the local checker on `src` (`pages` for Vike): `--strict` for canonical forms, `--fix` for the mechanical rewrites, `--json`. Suppress one line with `// sygnal-ignore SYG110`. In a running dev app: `getDevTools()?.inspect()`.
- App graph: `npx --no-install sygnal-check --graph --json` maps the app before an edit (who renders what, actions with `trigger` and the state keys they `writes`, each view's `stateReads`, EVENTS, `childSelects` for `PARENT`, `line` on each); `--graph --json --base main` lists what a branch changed. `--graph=html` (or `/__sygnal/graph` in the Vite dev server) is the same graph as a page for the user: https://sygnal.js.org/guide/app-graph/.
- Vite plugin in dev: runtime checks print to the console, and an installed `sygnal-check` runs on every save. Stricter: `sygnal({ diagnostics: { mode: 'error', strict: true }, check: { strict: true } })`. Without the plugin: `run(App, drivers, { diagnostics: 'warn' })` and `import 'sygnal/diagnostics'`.

## 9. Project setup (Vite)
`index.html` has `<div id="root"></div>` and `<script type="module" src="/src/main.js">`; `src/App.test.js` sits next to `src/App.jsx`.
`vite.config.js`: `export default defineConfig({ plugins: [sygnal()] })` (`import sygnal from 'sygnal/vite'`: JSX, HMR, dev diagnostics, Vitest). `src/main.js`: `run(App)` mounts on `#root`; drivers are the 2nd argument. Optional, experimental (Vite 8): `sygnal({ compile: true })` compiles JSX views at build time (same DOM; write components as usual): https://sygnal.js.org/integration/compiled-views/
Conventions: PascalCase component files, ALL_CAPS action names, `$` suffix for streams, class-name selectors, `classes()` for conditional class names.

## 10. Where to look next
Every SYG code: https://sygnal.js.org/reference/errors. Testing: https://sygnal.js.org/integration/testing/. More: `node_modules/sygnal/dist/guide/undo.md`, https://sygnal.js.org/guide/view-transitions/, https://sygnal.js.org/reference/api/#sygnalelement (`defineElement`), `node_modules/sygnal/dist/guide/error-boundaries.md` (`run({ onError })` phases).
