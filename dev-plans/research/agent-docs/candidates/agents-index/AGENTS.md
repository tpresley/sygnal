# Agent instructions

This project uses **Sygnal**, a reactive JSX component framework (Model-View-Intent, xstream streams, one state tree). It is not React: no hooks, no `onClick`, no `useState`. Your training data is probably wrong about it. **This file is the map.** The examples to copy are in `node_modules/sygnal/llms.txt`: read it before writing your first new component or a kind of code you don't see in this project; then use the triggers below.

## Shape of every component
```jsx
function Counter({ state }) { return <button className="inc">{state.count}</button> }
Counter.initialState = { count: 0 }                    // root only; a child's start values go in the parent's
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })   // when: source → named action; no handlers in JSX
Counter.model = { INC: (state) => ({ ...state, count: state.count + 1 }) }   // what: action → new state
```
Children, lists, events up:
```jsx
function Item({ state }) { return <li data={{ id: state.id }}>{state.title}<button className="pick">pick</button><button className="remove">x</button></li> }
Item.intent = ({ DOM }) => ({ PICK: DOM.click('.pick'), REMOVE: DOM.click('.remove') })
Item.model = { PICK: { PARENT: (state) => ({ id: state.id }) }, REMOVE: () => undefined }   // an item removes itself
function List({ state }) { return <ul><Collection of={Item} from="items" /></ul> }   // no wrapper element; filter=, sort=
List.intent = ({ CHILD }) => ({ PICKED: CHILD.select(Item) })                           // exactly what PARENT returned
List.model = { PICKED: (state, { id }) => ({ ...state, picked: id }) }
```
HTTP is a sink with named replies, never `fetch`: `SEARCH: { HTTP: (state, q) => ({ url: '/api/s', query: { q }, ok: 'RESULTS', error: 'FAILED', latest: true }) }`, `RESULTS: (state, body) => ...`, `FAILED: (state, { status }) => ...`; `run(App, { HTTP: makeFetchDriver() })` in `main.js`. A read that follows state is a declaration: `App.resources = { quote: (state) => state.id && `/api/quotes/${state.id}` }`, read `state.quote` (`status`, `data`, `error`, `refreshing`).

Events: `DOM.click('.x')`, `DOM.input('.x').value()`, `DOM.change('.x').checked()`, `DOM.keydown('.x').key()`, `DOM.select('form').events('submit', { preventDefault: true })`, `.data('id', Number)`, `EVENTS.select('T')`, `STATE.watch(fn)`. Streams are xstream from `'sygnal'`: `.compose(debounce(300))`, `.map(f).flatten()`.

Side effects are model sinks: `SAVE: { STATE: fn, EFFECT: fn, PARENT: fn, EVENTS: event('T', fn), HTTP: fn }`. STATE runs first; the other sinks get the committed state, and `previousState` (4th argument) has the old one. Say "no change" with `ABORT`. An intent sees only its own JSX: a child sends events up with `PARENT` (parent: `CHILD.select(Child)`) or `EVENTS`.

## Read before writing (all paths under `node_modules/sygnal/`)
`when you are about to write` → `read this first`. Follow it even if you think you know.

- a test beyond a click and a `t.next` → `llms/testing.md`
- a request a user action triggers, POST, upload, cancel, streaming reply → `llms/http.md`, `dist/guide/http.md`
- data a view shows, that follows state; cache, refetch, invalidate, pagination, infinite list → `llms/resources.md`, `dist/guide/resources.md`
- WebSocket, SSE, reconnects → `llms/sockets.md`
- pages, links, redirects, guards, a leave prompt, the document title → `llms/router.md`
- a form with validation, error messages, rows, a file field → `llms/forms.md`, `dist/guide/forms.md`
- pager, selection, undo/redo, shared state plus actions → `llms/behaviors.md`, `dist/guide/undo.md`
- focus or scroll after a render, a dialog's `showModal`, a parent calling a child → `llms/commands.md`, `dist/guide/element-commands.md`
- an interval, delay, game loop → `llms/commands.md`, `dist/guide/timers.md`
- anything saved across reloads → `llms/commands.md`, `dist/guide/persistence.md`
- chart, date picker, map, rich editor, any imperative library → `llms/widgets.md`, `dist/guide/widgets.md`; a web component → `dist/guide/web-components.md`
- dialog, popover, tooltip, tabs, accordion, disclosure, toast → `llms/ui.md`, `dist/guide/ui/overview.md`; never hand-roll them
- menu, select, combobox → `llms/ui.md`, `dist/guide/ui/menu.md`, `ui/select.md`, `ui/combobox.md`
- drag to reorder → `llms/ui.md`, `dist/guide/drag-and-drop.md`
- 1,000+ rows → `llms/ui.md`, `dist/guide/virtual-collections.md`
- a multi-step flow → `llms/ui.md`, `dist/guide/wizards.md`
- window size, media query, clipboard, online state → `llms/ui.md`, `dist/guide/browser-sources.md`
- LLM chat → `llms/ai.md`, `dist/guide/ai-chat.md`; tools an LLM may call → `dist/guide/agent.md`; a yes/no decision by a model → `dist/guide/ai-decisions.md`; UI a model composes → `dist/guide/ai-compose.md`, `ai-cards.md`. Never a provider API key in browser code
- TypeScript types for a component or a separate `const model` → `llms/typescript.md`
- CSS Modules, Tailwind, `style` values → `llms/styling.md`
- SSR → `dist/guide/ssr.md`
- an import of `sygnal/yjs` → `llms/collaboration.md`; `sygnal/three`, `sygnal/canvas` → `llms/graphics.md`; `sygnal/api` → `llms/typed-apis.md`; `sygnal/terminal`, `agent-ui`, `react-native`, `primitives`, `host`, `worker` → `llms/renderers.md`; `sygnal/sandbox` → `llms/sandbox.md`; `sygnal/replay` → `llms/replay.md`
- a prop or option name you don't see in those → `llms/api-facts.md`, or `grep -n 'name' node_modules/sygnal/dist/index.d.ts`: never read that whole file (390 KB), never read `dist/*.esm.js`

## Commands
| Command | What it does |
|---|---|
| `npm test` | Vitest, next to the components. Read all of the output: every failure prints above the summary |
| `npx --no-install sygnal-check --strict` | wiring bugs and non-canonical forms; must report nothing; `--fix` applies the mechanical rewrites |
| `npx --no-install sygnal-check explain SYGnnn` | what a `[Sygnal SYGnnn]` line means and the fix |
| `npx --no-install sygnal-check --graph --json` | components, actions, selectors, EVENTS |

## Workflow
State (`initialState`) → intent → model → view → test. Finish with `npm test` and the checker, both clean. **A `[Sygnal SYGnnn]` line is the documentation for that mistake**: it names the problem and the fix, so act on it instead of guessing. A click that silently does nothing: a selector inside a child, an action name that doesn't match, or a driver missing from `run()`; `t.actions` shows what ran.

## Testing your change
```js
import { renderComponent } from 'sygnal'
const t = renderComponent(App, { strict: true })    // no browser, no driver wiring
t.simulateEvent('.add', 'click')                    // or ('.field', 'input', { value: 'x' })
await t.next(s => s.items.length === 1)             // waits for a new matching state; t.state is the latest
await t.respond('HTTP', body, 'LOADED')             // answers a pending request by its ok action or resource name
t.expectNoDiagnostics(); t.dispose()
```
