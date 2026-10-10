# Proposal: "Coming from React / Vue" docs pages

Status: proposal, for review. Nothing in `docs/` has changed yet.

## 1. Who these pages are for, and what they need

A React or Vue developer arriving at sygnal.js.org already knows components, props, JSX or templates, lists with keys, derived values, context, and fetching. They don't need those concepts taught again. They need four things:

1. **A translation table**: "I'd reach for `useEffect` / `computed` / `emit` here. What's the Sygnal word?" This is the page they keep open while writing their first app.
2. **The few real mental shifts, explained once**, not scattered across 40 guide pages. Sygnal differs from both frameworks in roughly five places, and everything else follows from them.
3. **Side-by-side code they recognise**, next to Sygnal code they can **edit and run on the page**. A snippet that runs beats a paragraph of explanation.
4. **The mistakes people like them actually make**, before they make them.

Today the site has one line for them (`getting-started.md`: "If you've used React, you'll feel right at home") and a few scattered asides (`useEffect(() => {}, [])` in `guide/model.md`, `setQueryData` in `guide/resources.md`). There is nothing for Vue developers.

### How other frameworks do it

Three formats recur, and the strong pages combine them:

| Format | Examples | Good at | Weak at |
|---|---|---|---|
| **Rosetta / cheat sheet**: one feature per row, code in each framework | component-party.dev, Qwik's and Solid's React comparison pages | quick lookup, scanning | explaining *why*; hides the mental shifts |
| **Concept guide**: "what's different, and why" | Preact's "Differences to React", Lit's "Lit for React developers" | the mental model | slow to find one answer |
| **Port-an-app walkthrough** | React's own "Thinking in React", framework migration tutorials | showing the architecture as a whole | long; one example only |

Recommendation: each page **opens with the table** (lookup), then **five short "shift" sections, each with paired code and a live Sygnal demo** (concept), and links to one **shared walkthrough** (architecture). Sygnal's mental model differs more from React than Preact's or Solid's does, so the concept part matters more here than on those sites: a table alone would lead people to look for `onClick` and not find it.

### Evidence for what trips people up

The agent-ergonomics evals (`evals/agent-ergonomics/`) ran the same tasks in a React arm and a Sygnal arm. The failures in the Sygnal arm are mostly React habits, and they are the right list for the pitfalls section:

- **Selecting a child's element from the parent** (tasks 07, 14: SYG104). In React the handler lives wherever the callback is; in Sygnal a component's `DOM` only sees its own JSX.
- **View/intent selector mismatches** (task 06: SYG110). No `onClick` means the class is the link; a typo breaks it silently without `sygnal-check`.
- **Reading the new state in a non-STATE sink.** Sinks see the pre-action state, like a closure over the old value, but for a different reason.
- **Giving a child its own `initialState`** like a local `useState` (SYG405 / `isolatedState`).

Each pitfall links to its diagnostic code, which also sells `sygnal-check` and the dev diagnostics.

## 2. Proposed pages

A new sidebar group right after **Getting Started**:

```
Coming from…
  React          /coming-from/react/
  Vue            /coming-from/vue/
  Port an App    /coming-from/port-an-app/     (shared walkthrough, phase 2)
```

Plus small edits elsewhere: link the group from `getting-started.md` (replacing the "right at home" line) and from the homepage, and add a "Coming from React or Vue?" card to `index.mdx`.

Why separate React and Vue pages instead of one comparison page with three columns: readers search for their own vocabulary (`useEffect`, `v-model`), and a three-way page makes everyone read the other framework's code. The Sygnal demos can be the **same examples** on both pages, so a reader comparing the two sees the same Sygnal answer.

### 2.1 "Sygnal for React developers" (`coming-from/react.md`)

**1. What carries over (short).** JSX, function components, props, `key`, a virtual DOM (snabbdom), Vite, `Suspense` / `lazy` / portals / error boundaries under familiar names. Sygnal is closest to **`useReducer` + Redux with the effects moved out of components**. Say that early: it's the best single hook for a React developer.

**2. The translation table** (each row links to the guide page):

| React | Sygnal | Guide |
|---|---|---|
| `useState` | `initialState` + a `model` entry per action | State, Model |
| `useReducer` / Redux reducers | `model` (one reducer per action name), one state tree | Model, State |
| `onClick={…}` in JSX | an `intent` entry: `DOM.click('.save')` (no handlers in JSX) | Intent |
| controlled `<input value onChange>` | `value={state.x}` + `DOM.input('.x').value()` | Inputs |
| `useMemo` / derived values | `calculated` fields | Calculated Fields |
| `useEffect(() => …, [])` | the `BOOTSTRAP` action | Model |
| `useEffect` cleanup | the `DISPOSE` action | Disposal Hooks |
| `useEffect` for a side effect | an `EFFECT` sink, or a driver sink | Effect Handlers, Drivers |
| `setInterval` in an effect | the `timers` static | Timers |
| `fetch` in `useEffect` / React Query `useQuery` | the `resources` static (+ `queryCache()`) | Resources and Caching |
| a mutation / `setQueryData` | an `HTTP` sink with reply actions, `updates` / `invalidates` | HTTP, Resources |
| callback props (`onDelete`) | the child's `PARENT` sink + `CHILD.select(Child)` in the parent | Parent-Child |
| lifting state up | it's already up: one tree; `state="key"` gives a child a slice | State |
| `items.map(i => <Item key …/>)` with per-item logic | `<Collection of={Item} from="items" />` | Collections |
| `createContext` / `useContext` | the `.context` static, `({ context })` in the view | Context |
| sibling communication via a store | the `EVENTS` bus | Drivers |
| custom hooks | behaviors (`defineBehavior`, `uses`) | Behaviors |
| `useRef` + `.focus()` | `autoFocus` / element commands / `createRef` | Inputs, Element Commands, Refs |
| `createPortal` | `<Portal>` | Portals |
| `React.lazy` + `<Suspense>` | `lazy()` + `<Suspense>` | Lazy Loading, Suspense |
| error boundary class | `.onError` on any component | Error Boundaries |
| React Hook Form / Formik | the `form` behavior (Standard Schema) | Forms |
| React Router | `makeRouter()` + the `route` static | Router |
| `localStorage` in an effect | `persist()` | Persistence |
| React Testing Library | `renderComponent()` | Testing |
| Next.js | Vike or Astro | Vike, Astro, SSR |
| an existing React component | `fromReact()` (escape hatch) | Adapters |

**3. Five shifts**, each one section: the React code (static), the Sygnal code (**live**), then two or three bullets on what changed and why.

1. *Events are named in `intent`, not bound in JSX.* Counter → todo input. Why: the view stays a pure function of state; every action is listed in one place; tests drive actions directly.
2. *State changes are pure reducers keyed by action.* `useState` setters → model entries, `ABORT`, `set` / `toggle`. No stale closures: a reducer always gets the current state.
3. *Side effects are sinks, not hooks.* `useEffect` + `fetch` → `resources` (live, with a demo server); `setInterval` → `timers`; `localStorage` → `persist`. No dependency arrays to get wrong.
4. *Data flows up through `PARENT`, not callbacks.* Callback prop → `PARENT` + `CHILD.select`; list `map` → `Collection`. Includes the "a parent can't select a child's button" rule (SYG104), shown with a live demo of the right way.
5. *One state tree; children get slices.* Lifting state up / context / a store → `state="key"`, `.context`, `calculated`. When local state is right (`isolatedState`).

**4. Pitfalls** (from the evals above), each with its SYG code and a one-line fix. End with "run `sygnal-check` in your editor" (links: Diagnostics, Strict Mode, PLAN-7's VS Code extension once released).

**5. Adopting Sygnal in a React codebase.** Both directions exist today: `fromReact()` puts a React component inside a Sygnal app (Adapters), and `defineElement()` from `sygnal/element` publishes a Sygnal component as a custom element that a React app renders like any tag (Web Components). That is the incremental-migration story; state it plainly, with the costs the Adapters page already lists.

### 2.2 "Sygnal for Vue developers" (`coming-from/vue.md`)

Same skeleton, Vue vocabulary, and two shifts of its own:

- **Templates → JSX.** Vue developers mostly write SFC templates. A short "JSX for template authors" section: `v-if` → `&&` / ternary, `v-for` → `.map()` or `<Collection>`, `:class` → `className={…}` (an expression), `{{ }}` → `{ }`, no directives. (React developers skip this; Vue developers need it first.)
- **Mutable reactivity → immutable reducers.** `count.value++` / `state.items.push(x)` become reducers that return new state. Explain why (one tree, time-travel / undo, testability) without arguing against Vue.

Vue gets more familiar names than React does, which the page should lean on:

| Vue | Sygnal |
|---|---|
| `ref` / `reactive` | `initialState` + `model` |
| `@click` / `v-on` | `intent`: `DOM.click('.sel')` |
| `v-model` | `value={state.x}` + `DOM.input('.x').value()` (no two-way binding), or the `form` behavior |
| `computed` | `calculated` fields |
| `watch` / `watchEffect` | `STATE.watch(selector)` in intent, `EFFECT` sinks |
| `onMounted` / `onUnmounted` | `BOOTSTRAP` / `DISPOSE` |
| `defineEmits` / `emit` | `PARENT` sink + `CHILD.select` |
| `provide` / `inject` | `.context` |
| default and named slots | `children` and `<Slot name>` |
| `<Teleport>` | `<Portal>` |
| `<Transition>` | `<Transition>` |
| `<KeepAlive>` | `<Switchable>` (hidden pages stay alive, keep their state) |
| `defineAsyncComponent` / `<Suspense>` | `lazy()` / `<Suspense>` |
| composables | behaviors |
| Pinia | the state tree itself (+ `EVENTS` for cross-tree messages) |
| Vue Router | `makeRouter()` |
| template refs | `createRef()` |
| Vue Test Utils | `renderComponent()` |
| Nuxt | Vike or Astro |

(Vue has no adapter in Sygnal; the interop section covers `defineElement()` only, since Vue renders custom elements natively.)

### 2.3 "Port an App" (phase 2, shared)

One small app (a filtered list with a detail panel, a fetch and a child that reports up), built in five steps: draw the component boxes, write the static views, find the state and the actions, wire the intents, add the effects. Each step is a live Sygnal block building on the last (`live-file` lets later blocks import earlier components). A tab or a `<details>` at each step shows the React and Vue code for readers who want it. It's the same shape as "Thinking in React", which React developers know, with our own example. This is the most work and the least urgent, so ship it after the two pages.

## 3. Live code: what works, and the recommendation

The existing live-block tooling (`docs/src/plugins/remark-live.mjs`) covers everything these pages need on the Sygnal side:

- ` ```jsx live ` for each Sygnal sample: editable, Reset, a Result panel.
- ` ```js live-server ` for the fetching examples: a visible demo server, so the `resources` vs `useEffect`/`useQuery` comparison runs for real, with loading and error states.
- ` ```jsx live-file=./Child.jsx ` for the parent/child examples (the child in its own block, as `guide/parent-child.md` does).
- The `TIMER` driver is there for the `timers` example; `persist()` works in the panel (it uses the page's storage).
- Not available live: the router (and WebSockets). The router row links out; that's acceptable.

**React and Vue code: static, not live.** The live compiler turns JSX into Sygnal's `createElement`, so React JSX can't run as-is, and Vue isn't in the module map. React *is* in `docs/src/live/modules.ts` (for the Adapters page), so a React side could run through `fromReact` with `createElement` calls, but that's not the code React developers write, and it would double the demos to maintain. Static React/Vue blocks with syntax highlighting (` ```jsx title="React" `, ` ```vue title="Vue" `) are the clear choice.

**Layout per comparison:** the React (or Vue) block first, short, with a frame title; the Sygnal live block directly under it. Not tabs: putting a live block in a hidden Starlight tab risks an unmounted demo for `check-live`, and readers want both visible to compare. Keep each foreign snippet under ~20 lines.

Gates that already protect the new pages, at no extra cost: `npm --prefix docs run build` (every live block compiles), `check-live` on chromium/firefox/webkit (every demo renders without errors), and `scripts/check-doc-samples.mjs` (every Sygnal sample is `sygnal-check --strict` clean, so the pages stay in canonical form). The React/Vue blocks need a skip marker for `check-doc-samples` (it already supports one).

## 4. A sample section, as it would appear

> ### Fetching data
>
> In React, a fetch lives in an effect, with its own loading and error state and a guard against stale responses:
>
> ```jsx title="React"
> function Quote() {
>   const [id, setId] = useState(1)
>   const [quote, setQuote] = useState({ status: 'loading' })
>   useEffect(() => {
>     let stale = false
>     setQuote({ status: 'loading' })
>     fetch(`/api/quotes/${id}`)
>       .then(r => (r.ok ? r.json() : Promise.reject(r)))
>       .then(data => !stale && setQuote({ status: 'success', data }))
>       .catch(error => !stale && setQuote({ status: 'error', error }))
>     return () => { stale = true }
>   }, [id])
>   return (/* … */)
> }
> ```
>
> In Sygnal, the component **declares** the request it needs from state, and the fetch driver keeps `state.quote` up to date. There's no effect, no dependency array and no stale-response guard: changing `id` aborts the previous request.
>
> ```js live-server
> const quotes = { 1: 'Start where you are.', 2: 'Less, but better.', 3: 'Done is done.' }
> export default {
>   'GET /api/quotes/:id': ({ params }) => quotes[params.id]
>     ? { json: { id: Number(params.id), text: quotes[params.id] }, delayMs: 800 }
>     : { status: 404, json: { message: 'No such quote' } },
> }
> ```
>
> ```jsx live
> function Quote({ state }) {
>   const { status, data } = state.quote
>   return (
>     <div>
>       <button className="next">Next</button>
>       <p>{status === 'loading' ? 'Loading…' : status === 'error' ? 'No such quote.' : data?.text}</p>
>     </div>
>   )
> }
> Quote.initialState = { id: 1 }
> Quote.resources = { quote: (state) => `/api/quotes/${state.id}` }
> Quote.intent = ({ DOM }) => ({ NEXT: DOM.click('.next') })
> Quote.model = { NEXT: (state) => ({ ...state, id: state.id + 1 }) }
> ```
>
> - `resources` is the closest thing to React Query's `useQuery`; add `queryCache()` for caching and sharing between components.
> - Click Next past quote 3 to see the error state. Edit the server's `delayMs` and click quickly: earlier requests are aborted.

The Vue page would show the same Sygnal blocks under a `<script setup>` version with `ref`, `watch(id, …, { immediate: true })` and `onWatcherCleanup`.

## 5. Plan and effort

| Step | Content | Size |
|---|---|---|
| 1 | React page: table, five shifts (~8 live demos), pitfalls, adoption | ~1 day |
| 2 | Vue page: reuse the demos, Vue snippets, JSX-for-templates section | ~0.5 day |
| 3 | Sidebar group, links from Quick Start and the homepage | small |
| 4 | Build, `check-live` × 3 browsers, `check-doc-samples` | part of 1–2 |
| 5 (later) | Port-an-App walkthrough | ~1 day |

Also worth considering, separately: `llms.txt` and the `sygnal-dev` skill could carry a compressed form of the React table, since agents bring React habits too (the eval failures above are agent failures).

## 6. Decisions for you

1. **Placement**: a "Coming from…" sidebar group after Getting Started (recommended), or entries inside Getting Started.
2. **Scope of the first pass**: React + Vue pages now and the walkthrough later (recommended), or all three at once.
3. **Tone toward React/Vue**: neutral "here's the equivalent and why it's shaped this way" (recommended), with no benchmarks or claims of superiority on these pages.
4. **Other frameworks**: Svelte, Solid or Angular pages later? The same skeleton works; I'd wait to see whether the React and Vue pages get traffic.
