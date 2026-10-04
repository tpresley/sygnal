# Changelog

All notable changes to Sygnal are listed here. Versions follow [semantic versioning](https://semver.org). Releases before 5.4.0 are described in the [GitHub releases](https://github.com/tpresley/sygnal/releases) and tags.

## [Unreleased]

Network calls get a first-class layer. A request names the actions its answer becomes (`HTTP: (state) => ({ url, ok: 'LOADED', error: 'FAILED' })`), so there is no `select()` round trip; `makeFetchDriver()` replaces hand-written `fetch` drivers and request-id bookkeeping; `makeSocketDriver()` and the `connections` static open, close and reconnect WebSockets and server-sent events from state. `renderComponent()` tests answer requests and script sockets without wiring a driver. Tests can run on fake timers, against a real DOM, and read `t.state`. This release also fixes Switchable, calculated-field, Collection and Vike bugs that the agent evals found, and makes apps about 6 KB smaller: DevTools leave production builds (about 2 KB, every bundler) and `sygnal/vite` drops xstream's `globalthis` polyfill (about 4 KB).

6.0 also smooths the everyday parts of writing a component. `controls()` link views and intents by identifier, as an alternative to class selectors. Behaviors (`uses`) package state, intent and model for reuse, with first-party `pager`, `selection` and `undo`. A built-in `ELEMENT` sink focuses fields, opens dialogs and scrolls rows into view from the model. `persist()` saves the root's state, `STATE.watch()` reacts to a state change, and the `timers` static declares intervals and timeouts from state. `uid()` gives stable ids for labels, `run(…, { onError })` reports every error from one place, `viewTransitions` animates renders with the View Transitions API, and `sygnal/element` publishes a component as a custom element. Tests and DevTools get an action log (`t.actions`, "Copy as test"), and `sygnal-check` gets an accessibility lane (SYG701–708). One change breaks old code: a STATE reducer that returns the object it received now means "no change". The core grows by about 0.8 KB gzipped for all of this; every helper is 0 bytes unless imported.

<!-- TODO(4-E): add PLAN-4's measured impact (ergo tier, controls A/B from 1-E) to "Measured impact" below once the 4-E eval is scored (REPORT-v4). -->

Covers `sygnal`, `sygnal-check` and `create-sygnal-app`. A few fixes change behavior that an app or test could have relied on, and the TypeScript declarations are stricter in several places; both are listed under [Breaking changes](#breaking-changes-runtime-behavior) and [Migration](#migration).

**Measured impact** (agent evals; Opus 5.5 unless noted; [REPORT-v2](evals/agent-ergonomics/results/REPORT-v2.md), [REPORT-v3](evals/agent-ergonomics/results/REPORT-v3.md)). On tiers 1–3 (15 tasks shared with React), Sygnal agents finish in 40.5 s on average against 49.6 s on 5.4.0, which cuts the gap to React from 1.50× to 1.22×; the TypeScript tier went from 1.40× to 1.30×. Every Opus trial passes in both versions.
- A one-request HTTP task is now faster than React. The gaps on debounced search and form-plus-lookup fell by 70% and 50% during PLAN-3.
- The new network tier passes 20/20 on Opus. WebSocket chat with `makeSocketDriver` and `connections` takes 63 s, against 88 s with a hand-written driver before PLAN-3 (React: 42 s), and the router task is within 1.14× of React.
- List/detail caching went from 2.25× React to 1.37× once the cache path was fixed (`updates`, guides shipped in the package, a recipe): agents now use `queryCache()` in 5/5 trials, up from 0/5. The quote-resource task went from 2.0× to 1.4×.
- Haiku 4.5 now passes the WebSocket task 10/10 (was 1/5), and its pass rate on the 15 tasks shared with React is 75% against React's 65% (not significant at n = 5).
- `resources` ships as an advanced form: a resources-first skill was not faster (+3%).

### Added

- **Reply actions** ([HTTP guide](https://sygnal.js.org/guide/http/)). A request to `makeFetchDriver`, `driverFromAsync` or `makeSocketDriver` names its continuation actions, and the reply arrives as that action on exactly the component instance that sent it, with no intent wiring:
  ```jsx
  LOAD:   { STATE: (state) => ({ ...state, status: 'loading' }),
            HTTP:  (state, id) => ({ url: `/api/quotes/${id}`, ok: 'LOADED', error: 'FAILED', latest: true }) },
  LOADED: (state, quote) => ({ ...state, status: 'done', quote }),        // the parsed body
  FAILED: (state, { status }) => ({ ...state, status: 'error' }),          // { error, status, body, request }
  ```
  - `latest: true` cancels the instance's earlier requests with the same `ok` action (or the same `key`); `{ abort: 'LOADED' }` / `{ abort: true, key }` cancel them; a disposed instance's requests are aborted at once;
  - a request with only `ok` still sends failures to `errors()` (and one with only `error` sends successes to `select()`); requests without `ok`/`error` work as before (`category` + `select()`/`errors()`);
  - `driverFromAsync` requests take the same reply actions (`ok` gets the resolved value, `error` gets `{ error, request }`).
- **`makeFetchDriver()`**, an HTTP driver over `fetch`. `run(App, { HTTP: makeFetchDriver() })`:
  - a request is `{ url, ok, error, key, method, query, json, body, headers, latest, timeoutMs, parse, init, category }` or a URL string; POST when `json`/`body` is set, else GET. Other `fetch()` options go under `init` (`init: { credentials: 'include' }`); any other key is app data that isn't sent and comes back on `request`;
  - replies without reply actions: `HTTP.select(category)` emits `{ category, value, status, request }` for 2xx responses; `HTTP.errors(category)` emits `{ error, category, request, status, body }` for non-2xx, network errors, parse errors and timeouts;
  - plain requests (no reply actions) are isolated per component instance like `@cycle/http`: a component's `select()` sees the replies to its own and its descendants' requests; the root sees everything. Header names are sent lowercased (`Headers` semantics);
  - driver options `baseUrl`, `headers`, `init`, `latest`, `timeoutMs`, `parse` and `fetch`; disposing the app aborts everything in flight; no requests during SSR;
  - 0 bytes when unused (about 2.7 KB gzipped standalone, with the reply-actions helper). New types `FetchRequest`, `FetchResponse`, `FetchError`, `FetchFailure`, `FetchSource`, `FetchDriverOptions`, `FetchInit`, `ReplyRequest` and `AsyncRequest`.
- **`makeSocketDriver()` and the `connections` static** (WebSocket and server-sent events; [sockets guide](https://sygnal.js.org/guide/sockets/)). A component declares its connections as a function of state; Sygnal sends the set to the driver whenever it changes, and the driver opens, closes and reconnects:
  ```jsx
  Chat.connections = (state) => ({ room: state.room && {
    socket: `/ws/rooms/${state.room}`, message: 'RECEIVED', open: 'CONNECTED', close: 'DROPPED' } })
  Chat.model = { SEND: { WS: (state) => ({ to: 'room', json: { text: state.draft } }) }, /* RECEIVED, CONNECTED, DROPPED */ }
  // run(Chat, { WS: makeSocketDriver() })
  ```
  - connections are compared per instance and name: a new name opens, a removed or falsy one closes, a changed URL reconnects; dispose closes them;
  - reply actions: `message` (JSON-parsed when it parses), `open` (`{ reconnected }`), `close` (`{ code, reason, willReconnect }`, only for closes the app didn't make), `error`; other events on `WS.select(name)`;
  - reconnects with jittered backoff by default (`reconnect: { delayMs, maxDelayMs, jitter }`, or `false`; a fixed delay with `jitter: false`); sends are queued while connecting; connections to the same URL share one socket; `sse:` uses `EventSource`, with `events: { name: 'ACTION' }` for named events; nothing opens during SSR;
  - a `{ to }` send in the same action that opens or changes a connection goes to the new connection;
  - 0 bytes when unused (about 2.6 KB gzipped standalone); the `connections` static costs about 100 B in the core. New types `Connections`, `SocketRequest` and the spec types.
- **`resources` (experimental)**: reads declared from state for `makeFetchDriver()`: `Quote.resources = { quote: (state) => state.id && `/api/quotes/${state.id}` }`. Sygnal keeps `state.quote` as `{ status: 'idle' | 'loading' | 'success' | 'error', data, error }` through the built-in `RESOURCE` action (a model `RESOURCE` entry replaces it); a changed request is fetched with latest semantics, so a stale reply is never shown; a falsy request aborts and goes idle; `{ refresh: 'quote' }` on the HTTP sink refetches; `ok`/`error` on the request also dispatch those actions. Tests answer it with `t.respond('HTTP', body, 'quote')` (`resourceSink` option, default `'HTTP'`). Types `Resource<D, E>` and `ResourceRequest`.
- **`makeRouter()` / `makeRouterDriver()`**, an SPA router driver ([router guide](https://sygnal.js.org/guide/router/)). `export const router = makeRouter({ routes: { home: '/', task: '/tasks/:id', notFound: '*' } })` gives a typed `href()`, `match()`, `current(url?)` (the first route, also for SSR) and `driver` (`run(App, { ROUTER: router.driver })`). A component declares `App.route = 'ROUTE'` and its reducer stores `{ name, params, query, hash, path }`; guards and redirects stay in the model (the first declarer owns redirects). Links are plain `<a href={href('task', { id })}>`: the driver intercepts same-origin clicks at the document level (modifier keys, `target`, `download`, `rel="external"`, SVG, shadow DOM, `<base>` and `data-router-ignore` respected). Commands `{ to, params, query, hash, replace }`, `{ url }`, `{ back }`, `{ forward }`, `{ go }`, `{ block: 'ACTION' }` (unsaved-changes guard, with `proceed`) and `{ prefetch }`; scroll restoration and focus after navigation; hash mode; no-op during SSR; Vike mode (`makeRouter({ routes, navigate })` with Vike's `navigate`). About 2.8 KB gzipped in an app that uses it.
- **`makeHeadDriver()`**: `App.head = (state) => ({ title, meta, link })` (or `HEAD` sink values) sets the document title, meta and link tags, merged in mount order and removed on dispose, with `titleTemplate`. SSR: `renderToString(App, { head: list })` and `renderHead(list)`; Vike's `onRenderHtml` collects `head` statics. About 0.8 KB gzipped.
- **Resources reload and the query cache** ([resources guide](https://sygnal.js.org/guide/resources/)):
  - a refetch of the same request (`{ refresh }`, `{ invalidate }`, focus, polling, a hidden page shown again) keeps `data` and `error` with `refreshing: true`; a new request clears `data` unless `keepPrevious: true`; a failed refetch keeps `data`;
  - `queryCache({ staleTime, gcTime, refetchOnFocus, refetchOnReconnect, initial })`, passed as `makeFetchDriver({ cache: queryCache() })`: an opt-in cache (a separate export, so apps that only make requests don't ship it) with stale-while-revalidate, de-duplication of identical requests across components, and refetch of stale resources on focus and reconnect; `cache` / `staleTime` on a request opt one in (SYG635 without a `queryCache`);
  - SSR cache seeding: `cache.set(request, data)`, `cache.dehydrate()` / `hydrate()` / `queryCache({ initial })`, and `renderToString(App, { cache })`, which renders cached resources as `'success'`; with Vike, set `pageContext.queryCache` in `+data` and the extension renders from it and hydrates the client's fetch-driver cache (no loading flash, no refetch while fresh);
  - `{ prefetch: request }` on the HTTP sink and `cache.prefetch(request)` warm the cache without a reply; with the router's `prefetch` option a route's data is prefetched on hover;
  - `refetchEvery: ms` on a resource polls, paused while the page is hidden;
  - `{ invalidate: tag | tags | '/prefix' | fn }` from any component, and `invalidates: [...]` on a write (applied on success); explicit `tags` on requests and resources;
  - `updates` on a request (React Query's `setQueryData`): after a 2xx, the reply becomes the data of the sending component's named resources and their `queryCache()` entries at once (`updates: 'item'`, `['a', 'b']`, or `{ items: (list, reply) => newList }`), before the `ok` action and `invalidates`; their reads in flight are aborted, and other resources showing the same entry update too;
  - an invalidation aborts mounted resources' older reads and stops a shared cache fetch already in flight from writing the cache, so a reply from before a write never overwrites newer data;
  - the Resources and HTTP guides ship in the package (`node_modules/sygnal/dist/guide/{resources,http}.md`, copied at build) so agents can read them offline; SKILL.md and `llms.txt` link there first, and teach a list/detail + save recipe (`staleTime` on the request, `queryCache()` in `main.js` and in every test, `updates` + `invalidates` on the save, "Updating…" from `refreshing`);
  - the PLAN-4 guides ship in the package too: `node_modules/sygnal/dist/guide/{persistence,timers,element-commands,behaviors,accessibility,undo}.md` (copied at build; `scripts/copy-guides.mjs` accepts a docs section prefix such as `advanced/undo`), and SKILL.md and `llms.txt` link them locally instead of by site URL.
  - `retry: n | { count, delayMs, maxDelayMs, jitter }` (default 0; the driver option applies to GET/HEAD): network errors, 408, 429 (`Retry-After` in seconds) and 5xx, with `attempts` on the failure;
  - `validate: schema` (any Standard Schema) on requests and resources; a failure carries `issues`;
  - tests: `renderComponent(C, { http })`, `t.cache()`, `t.focus()`, `t.online()`; `inspect()` lists resources per instance and cache entries.
- **Switchable `instance`**: `<Switchable of={pages} current={name} instance={key} />`. When `instance` changes, the current page is disposed and created again with fresh state (a page shown again after its key changed while hidden is re-created on show); `switchable()` accepts `[name, instance]` pairs. The router recipe uses `instance={state.route.path}`.
- **Hidden Switchable pages pause their declarations**: while a page is hidden, it and everything inside it declare only the `connections` / `resources` entries marked `background: true`; the others close or abort, and are declared again when the page is shown. A `route` declaration stays live.
- **Async EFFECTs** ([EFFECT](https://sygnal.js.org/advanced/effect/)). `EFFECT: async (state, data, next, { signal }) => { … next('DONE', value) }` for async work that isn't HTTP (IndexedDB, clipboard, workers): a returned promise is expected, a rejection is reported as SYG214, `next()` after the component is disposed does nothing, and `signal` is an `AbortSignal` aborted on DISPOSE (EFFECT only).
- **`controls()`** links views and intents by identifier ([guide](https://sygnal.js.org/guide/controls/), [API](https://sygnal.js.org/reference/api/#controls)), an [alternative form](https://sygnal.js.org/advanced/alternative-forms/#controls-instead-of-class-selectors) to class selectors. `const { Draft, Add } = controls({ Draft: 'input', Add: 'button' })` returns element tokens: the view renders `<Add>Add</Add>` (a `<button data-control="Add">`, every prop passed through), and anything that takes a selector takes the control instead: `DOM.click(Add)`, `DOM.input(Draft).value()`, `DOM.select('document').select(Add)`, element commands, behavior options, and in tests `t.simulateEvent(Add, 'click', { within })`, `t.query(Draft)` and `t.queryAll`. A control resolves to `[data-control="Add"]` and also works inside template-string selectors.
  - class selectors stay canonical: the docs, examples, templates and agent docs use them, and no strict rule flags them. In the A/B eval controls didn't pay for themselves (a smaller model read a control's name as the button's label), so they are opt-in;
  - a control is an element, not a component: no state, no isolation scope, no wrapper. Isolation is unchanged, so a control in a Collection item matches only that item's element;
  - typed from its element: `Draft` takes `<input>` props and `t.query(Draft)` is an `HTMLInputElement`;
  - diagnostics: SYG124 (a component passed where a control or selector is expected: `DOM.click(Child)` is not supported, use `CHILD.select` + `PARENT`), SYG125 (a control given `.intent`, `.model` or `.initialState`), SYG126 (rendered but never listened to, info), SYG128 (a duplicate key); SYG104 and SYG110 match controls by identifier;
  - a spec object `{ kind, vnode(props, children, h), commands }` in place of a tag is the extension point for third-party widgets.
- **Behaviors** ([guide](https://sygnal.js.org/guide/behaviors/)). `defineBehavior({ initialState, intent, model, calculated })` packages state, intent and model without a view. A component lists the behaviors it uses under state keys:
  ```jsx
  TaskList.uses = { pager: pager({ pageSize: 10, next: '.newer', prev: '.older' }) }   // state.pager; actions 'pager.NEXT'
  ```
  - the behavior's reducers and calculated fields work on its slice (`state.pager`); its actions are named after the key (`pager.NEXT`); its intent gets the host's sources plus the options;
  - a host model entry for `'pager.NEXT'` runs after the behavior's; a host intent action of the same name replaces the behavior's trigger;
  - first-party behaviors `pager()`, `selection()` (single or multi, select-all; `isSelected()`) and `undo()`, and `undoable(model, { key, limit, track, coalesceMs, resetOn })`, which wraps a model's STATE reducers with undo/redo history ([undo](https://sygnal.js.org/advanced/undo/));
  - `undo()` / `undoable()` take `coalesce: ['TYPE']`: only the listed actions' quick changes join one step (within `coalesceMs`, 500 by default with `coalesce`), and every other action is always its own step, so two quick clicks on a button stay two steps while typing is one. Without `coalesce`, `coalesceMs` joins any action's repeats, as before ([undo](https://sygnal.js.org/advanced/undo/#grouping-only-some-actions)).
  - SYG127 (a `uses` key already in `initialState`, or a value that isn't a behavior) and SYG226 (`track` / `resetOn` / `coalesce` naming an unknown action); types `UsesState` and `UsesActions`;
  - about 30 B in the core; 0 bytes unless imported (in an app: `pager` about 0.95 KB gzipped, `selection` 1.2 KB, `undo` 1.6 KB).
- **Element commands** ([guide](https://sygnal.js.org/guide/element-commands/)). The built-in `ELEMENT` sink calls a method of an element the component rendered, with no driver to register:
  ```jsx
  SUBMIT:    { STATE: (s) => ({ ...s, errors: validate(s) }), ELEMENT: (s) => (validate(s).email ? { focus: '.email' } : ABORT) },
  OPEN_HELP: { ELEMENT: { showModal: '.help' } },
  ```
  - the first key is the method (`focus`, `blur`, `select`, `click`, `scrollIntoView`, `showModal`, `show`, `close`, `showPopover`, `hidePopover`, `togglePopover`), the other keys its options (`close` gets `returnValue`); an array runs in order. Any other method the element has also runs (declare it in `ElementCommandRegistry` for TypeScript);
  - the target, a selector (or a control), is looked up in the sending instance's own view, and the command runs after the next patch at which it exists, so it reaches elements the same action renders. A control's spec `commands` are asked first;
  - SYG640 (target not found after about 1 s, warn), SYG641 (unknown or DOM-mutating method); nothing runs during SSR;
  - tests: `t.commands('ELEMENT')` lists what was sent; with `dom: 'real'` the commands also run (jsdom gets fakes for `<dialog>`, popovers and `scrollIntoView`);
  - about 220 B in the core.
- **`persist()`** ([guide](https://sygnal.js.org/guide/persistence/)). `TodoApp.persist = persist({ key: 'todo-app', pick: ['todos', 'filter'], version: 2, migrate })` saves the root component's state in `localStorage` and restores it at startup:
  - restored synchronously before `INITIALIZE`, merged into `initialState`. Over server-rendered markup (a `run()` mount point with children, a hydrated Astro island or Vike page) it restores in the built-in `RESTORE` action after the first render instead, so hydration matches; `hydrate: true | false` overrides the detection;
  - stored as `{ version, state }` JSON: the `pick` keys, or all but `omit`, never calculated fields; another version goes through `migrate`;
  - `format: 'plain'` stores the picked keys themselves (`{"title":"…","body":"…"}`) instead of `{ version, state }`, for an entry another program reads or writes; `version` / `migrate` don't apply (a TypeScript error). `t.storage<Entry>(key)` reads it typed ([a plain format](https://sygnal.js.org/guide/persistence/#a-plain-format)).
  - written after `debounceMs` (100) without a change, on `pagehide` and on dispose; `sync: true` applies other tabs' writes; `storage: 'local' | 'session'` or a synchronous `{ getItem, setItem, removeItem }` adapter;
  - `PERSIST: { clear: true }` in a model entry removes the stored copy;
  - root component only (SYG224; Vike pages are not supported in 6.0), SYG223 (a `pick` / `omit` key not in `initialState`), SYG642 (a failed read, migrate or write; the app continues on `initialState`). Nothing is read or written during SSR;
  - tests: `renderComponent(App, { storage })` seeds the fake storage and `t.storage(key)` reads it;
  - about 20 B in the core, about 0.9 KB gzipped in an app that uses it.
- **`STATE.watch(selector, { immediate })`** ([intent](https://sygnal.js.org/guide/intent/#reacting-to-state-changes-statewatch)): a stream of `selector(state)` that emits only when the selected value changes (compared structurally), for "when X changes, do Y" (`SAVE: STATE.watch(s => s.text).compose(debounce(1000))`). In a Collection item, `state` is the item's; the stream ends on dispose.
- **Timers** ([guide](https://sygnal.js.org/guide/timers/)). A component declares its timers from state, and `makeTimerDriver()` runs them:
  ```jsx
  Stopwatch.timers = (state) => ({ tick: state.running && { every: 100, action: 'TICK' } })
  // run(Stopwatch, { TIMER: makeTimerDriver() })
  ```
  - `{ every: ms, action }` repeats without drift (data `{ n, t }`), `{ after: ms, action }` fires once (`{ t }`), `{ frame: 'ACTION' }` runs every animation frame (`{ t, dt }`);
  - compared by name whenever the state changes: a new name starts, a falsy or missing one stops, a changed spec restarts. The action reaches the declaring instance with every sink of its model entry;
  - a hidden Switchable page's timers stop (and start from scratch when shown) unless `background: true`; dispose stops them; nothing runs during SSR;
  - SYG422 (an invalid spec, not started) and SYG643 (dev: `timers`, `connections` or `resources` declared with no driver to take them);
  - tests: `renderComponent()` runs the real driver on the test's clock (fake timers included); `t.timers()` lists the running ones;
  - 0 bytes in the core; about 0.6 KB gzipped in an app that uses it.
- **View Transitions** ([guide](https://sygnal.js.org/guide/view-transitions/)). `Board.viewTransitions = ['MOVE']` with `run(App, { DOM: makeViewTransitionDOMDriver('#root') })` applies the render that a listed action's state change causes inside `document.startViewTransition()`. The renders of one action are folded into one transition; `App.viewTransitions = ['ROUTE']` animates route changes. The first render, `prefers-reduced-motion: reduce` and browsers without the API apply at once; `renderComponent()` never animates. SYG645 (dev) when the static is set without the driver. About 30 B in the core; the driver is about 350 B gzipped in an app that uses it.
- **`uid()`** ([forms](https://sygnal.js.org/guide/forms/#labels-and-ids-uid)), a view prop (and `props.uid` in reducers) for `id` / `for` / `aria-*` pairs: `<label for={uid('email')}>` + `<input id={uid('email')}>`.
  - ids come from the instance's position in the tree and its Collection item key, never a counter: unique per instance, stable across renders and reorders, and equal between `renderToString` and hydration ([SSR](https://sygnal.js.org/integration/ssr/#stable-ids-uid));
  - the root is `u`; `run(App, drivers, { uid })`, `renderToString(App, { uid })` and an Astro island's `uid` prop give each app on a page its own; Vike Pages, Layouts and Wrappers get matching ids on both sides automatically;
  - ids are opaque strings: path parts are encoded so that different keys never collide (`'0.2'` becomes `0_46_2`); don't parse them;
  - `sygnal-check` matches `uid('x')` references for SYG702 and SYG708.
- **App-level error hook** ([error boundaries](https://sygnal.js.org/advanced/error-boundaries/#app-level-error-hook)). `run(App, drivers, { onError: (error, { componentName, action, phase, driver }) => … })` reports every error of the app to one place, such as an error tracker:
  - reporting only: called once per error, after the component's own `onError` picked its fallback, in every diagnostics mode (production included). If the hook throws, the error is logged once and swallowed;
  - `phase` is `'view'`, `'reducer'`, `'effect'`, `'declaration'` (a static a driver reads, such as `connections`, threw), `'instantiate'` or `'driver'` (a driver threw synchronously while taking a sink value); `'widget'` is reserved;
  - each `run()` has its own hook. Also `renderToString(App, { onError })` (phase `'view'`), `renderComponent(C, { onError })`, the Vike config `sygnalOnError` (`pages/+sygnalOnError.js`; Vike's own `onError` is a different, server-only hook), and the Astro integration option `sygnal({ onError: './src/onError.js' })`.
- **`sygnal/element`** ([API](https://sygnal.js.org/reference/api/#sygnalelement)): `defineElement(tag, Component, { props, events, shadow, styles })` publishes a component as a custom element. Attributes and properties become props, sinks become DOM events (`events: { PARENT: 'task-picked' }`), an optional shadow root takes `styles`, disconnecting disposes, and `sygnal/vite` hot-swaps it in dev. It works in a plain HTML page and inside other frameworks (checked with React 19). A separate entry: 0 bytes in the core, about 1.6 KB gzipped. SYG644 (dev) for a prop that hides an `HTMLElement` member.
- **Action log in tests** ([testing](https://sygnal.js.org/integration/testing/#action-log-tactions-and-texplain)):
  - `t.actions` lists every action the rendered tree ran, live: `{ type, data, component, instance, sinks, cause, at }`, with `cause` one of `'intent'`, `'next'`, `'reply'`, `'built-in'`, `'simulateAction'` or `'behavior'`, and `sinks` the sinks that produced a value;
  - `t.explain(predicate)` returns the first action whose resulting state matches, with that state and its STATE reducer;
  - `t.inspect({ actions: true })` and the dev entry's `inspect({ actions })` add `recentActions` in the same shape;
  - also new on `renderComponent()`: `t.commands()`, `t.timers()`, `t.storage(key)` and the `storage`, `timerSink` and `onError` options (above). 0 bytes in production.
- **DevTools: action log, "Copy as test", Redux DevTools** ([debugging](https://sygnal.js.org/integration/debugging/#the-action-log)):
  - the panel's Actions tab lists every action of every instance with its cause, sinks and data, filtered by component or name; selecting one shows its state change as a diff;
  - [Copy as test](https://sygnal.js.org/integration/debugging/#copy-as-test) turns a session into a `renderComponent` test: the starting state, the replayed actions, `t.respond` / `t.fail` for `makeFetchDriver()` replies, and a final-state assertion when the replay is complete. `configureCopyAsTest()` on the bridge sets imports and drivers;
  - `sygnal/devtools` exports `getActions`, `onAction`, `clearActions`, `copyAsTest`, `copyAsTestResult`, `getSession`, `recordActions`, `isRecording` and `connectReduxDevtools`;
  - [Redux DevTools](https://sygnal.js.org/integration/debugging/#redux-devtools): `sygnal({ devtools: { redux: true } })` in the dev server (or `connectReduxDevtools(app)`) sends the actions and the root's state to the Redux DevTools extension, with time travel;
  - dev-only: the `sygnal/devtools` entry grows to about 17 KB gzipped, and production builds still contain none of it.
- **Accessibility checks** ([guide](https://sygnal.js.org/guide/accessibility/)), a new SYG7xx lane in `sygnal-check` and the Vite plugin's dev checker. Static only; warnings, also under `--strict`; `--a11y=error` makes them errors; `// sygnal-ignore SYG70x` silences one:
  - [SYG701](https://sygnal.js.org/reference/errors#syg701): a click listener on a non-interactive element (`div`, `span`, `li`, …) without `role` and `tabIndex`;
  - [SYG702](https://sygnal.js.org/reference/errors#syg702): a form field without an accessible label;
  - [SYG703](https://sygnal.js.org/reference/errors#syg703): an `<img>` without `alt`;
  - [SYG704](https://sygnal.js.org/reference/errors#syg704): a click listener on an `<a>` without `href`;
  - [SYG705](https://sygnal.js.org/reference/errors#syg705): a `<button>` with no accessible name;
  - [SYG706](https://sygnal.js.org/reference/errors#syg706): a positive `tabIndex`;
  - [SYG707](https://sygnal.js.org/reference/errors#syg707): an `aria-*` attribute or `role` that doesn't exist;
  - [SYG708](https://sygnal.js.org/reference/errors#syg708): `<label for>` or `aria-describedby` / `aria-labelledby` naming an id that isn't rendered.
- **Test fakes for drivers** ([testing](https://sygnal.js.org/integration/testing/)). In `renderComponent()`, a sink with no driver, in the component or any child, is recorded, and its source is a fake that behaves like the real driver:
  - HTTP: reply actions are answered to the sending instance; `latest`, `abort` and isolation follow `makeFetchDriver`;
  - `await t.respond(name, value, target?)` answers, and `await t.fail(name, 404 | error, target?)` fails, the newest pending request that matches `target`: an `ok`/`error` action name, key or category, a partial request compared by value (`{ url: '/items/2' }`), a predicate, or `{ request, category, status, body, nth }` (`nth` picks one request of `t.requests(name)` by position, `0` the first, `-1` the newest, counting only the matches of `request`/`category`, so a test can answer the older of two identical requests). They **throw at the call** when nothing matching is pending (unless simulated input is still queued, the call comes right after a `simulate*` call on a sink that carries `resources`, whose requests leave two microtasks later, or the component isn't ready yet), and return a promise that resolves after the reply has been reduced and rendered;
  - the HTTP fake runs the real `makeFetchDriver` over an in-memory `fetch`, so `latest`, `abort`, `timeoutMs` (on fake timers), isolation, reply actions and `resources` behave exactly as in the app; `t.respond` sends a JSON (or text) response the driver parses, `t.fail(404)` is an HTTP error response, `t.fail(error)` a network failure;
  - `t.requests(name)` lists requests only, as objects (a string request is `{ url }`, a resource fetch `{ url, …, resource: name }`); `t.sinkValues(name)` keeps everything, `{ abort }`, `{ resources }` and `{ refresh }` values included;
  - resources: `t.respond('HTTP', body, 'quote')` by resource name right after a `simulate*` call that changes the request waits for that fetch (it is sent after the state change);
  - router: `renderComponent(App, { router, url })` (the `makeRouter()` object; required when a component declares `route`) runs the real router driver over an in-memory history; `t.navigate(url | { to, params })`, `t.back()`, `t.forward()` (throw when they can't act, resolve after render), `t.location`, `t.sent('ROUTER')`; link clicks go through the driver's interception (mock DOM and `dom: 'real'`); scroll and focus off by default (`routerScroll`, `routerFocus`);
  - head: with no HEAD driver, `t.head()` returns the merged `{ title, meta, link }` (`headSink`, `titleTemplate`);
  - sockets: the fake runs the real `makeSocketDriver` over in-memory sockets. `t.connections(name)`, `t.open(name, target?)`, `t.push(name, data, target?)`, `t.drop(name, { code, reason }?, target?)` and `t.sent(name, to?)`; options `autoConnect` (default `true`; `false` holds connections in 'connecting' until `t.open`) and `socketSink` (default `'WS'`: the fake that receives the `connections` static, created even when no model entry names it).
- **More `renderComponent()` options and results** ([testing](https://sygnal.js.org/integration/testing/)):
  - `dom: 'real'` mounts into a real container (jsdom or happy-dom), so `checked`, `value`, `disabled`, focus, refs and Portals are real; `simulateEvent` then dispatches real events on any CSS selector, and `t.container`, `t.query(sel)` and `t.queryAll(sel)` read the DOM ([Real DOM](https://sygnal.js.org/integration/testing/#real-dom));
  - `t.query(sel)` and `t.queryAll(sel)` also work on the default mock DOM: they return read-only snapshots of what the view rendered (`textContent`, `value`, `checked`, `disabled`, `getAttribute`, `classList`, `dataset`, `querySelector`, `closest`, …); `focus()` and similar calls point to `dom: 'real'`. Mock-DOM selectors (also for `simulateEvent`) gain `:checked`, `:disabled` and `:enabled`;
  - `timeoutMs` (2000), `settleMs` (20) and `eventWaitMs` (300) tune the waits; a timeout error names a model `next('X', data, ms)` that is still pending and a recorded state that already matched;
  - `t.state`, the latest state (`t.states.at(-1)`), read-only;
  - `t.sinkValues(name)` also records the sinks of children, grandchildren and Collection items, including their DISPOSE output.
- **Fake timers in tests.** `renderComponent()` works with `vi.useFakeTimers()` (and Jest's modern fake timers): `ready()`, `next()`, `waitForState()` and `settle()` advance the fake clock themselves, so tests of `debounce`, `delay` or `next('X', data, ms)` run in milliseconds ([Fake timers](https://sygnal.js.org/integration/testing/#fake-timers)). Before, every wait hung under fake timers.
- **`run(App, drivers, { diagnostics: { strict: true } })`** turns on the runtime strict checks (and `'warn'` diagnostics unless a `mode` is given); `dispose()` restores the previous setting.
- **New diagnostic codes:**
  - [SYG608](https://sygnal.js.org/reference/errors#syg608) (warn): strict mode requested from `run()` without the `sygnal/diagnostics` entry loaded;
  - [SYG609](https://sygnal.js.org/reference/errors#syg609) (warn, dev entry): a component sends to a sink, or reads a source, that has no driver under `run()` (before, the values were dropped silently and the source was `undefined`);
  - [SYG112](https://sygnal.js.org/reference/errors#syg112) (error, dev entry and `sygnal-check`): a request's `ok`/`error` reply action, or a connection's `message`/`open`/`close`/`error`/`events` action, has no model entry (the reply would be dropped); suggests the nearest model key;
  - [SYG115](https://sygnal.js.org/reference/errors#syg115) (warn, dev entry): a `DOM.<name>` shorthand that isn't a DOM event (`DOM.key('.x')`); the fix names `DOM.keydown(sel).key()`;
  - [SYG116](https://sygnal.js.org/reference/errors#syg116) (error, dev entry): an EVENTS value without a string `type` (a function or `undefined`);
  - [SYG221](https://sygnal.js.org/reference/errors#syg221) (error, dev entry): `set()` called with a string (`set('field')`);
  - [SYG421](https://sygnal.js.org/reference/errors#syg421) (error, dev entry): a `data={{ ... }}` key the DOM can't store (`'task-id'`), which made rendering stop with a bare `DOMException {}`;
  - [SYG508](https://sygnal.js.org/reference/errors#syg508) (strict): a component reads `HTTP.select('c')` / `errors('c')` for its own `category: 'c'` requests where reply actions would do;
  - [SYG610](https://sygnal.js.org/reference/errors#syg610) (error): a request with a `then` or `catch` key (it would be a thenable); it is not sent;
  - [SYG611](https://sygnal.js.org/reference/errors#syg611) (error, dev entry): a socket send to a connection that doesn't exist, has died or is SSE, or an invalid connection spec;
  - [SYG620](https://sygnal.js.org/reference/errors#syg620) (error): a router command that wasn't performed;
  - [SYG630](https://sygnal.js.org/reference/errors#syg630)–[SYG635](https://sygnal.js.org/reference/errors#syg635) (dev entry; SYG634 in `sygnal-check`): a cached request that isn't idempotent, `validate` that isn't a Standard Schema, `invalidate` matching nothing (info), `abort` naming a lane its requests don't use, `latest: true` with a computed `key` (info), `cache` / `staleTime` / `prefetch` without a `queryCache()`;
  - [SYG130](https://sygnal.js.org/reference/errors#syg130)–[SYG133](https://sygnal.js.org/reference/errors#syg133) (dev entry): `href()` / `{ to }` with an unknown route or a missing param, an extra param, a declaration static a root without `initialState` never sends, and the SPA router inside a Vike app;
  - [SYG124](https://sygnal.js.org/reference/errors#syg124)–[SYG126](https://sygnal.js.org/reference/errors#syg126) and [SYG128](https://sygnal.js.org/reference/errors#syg128) (controls: a component used as a control or selector, a control given `.intent`/`.model`/`.initialState`, a control never listened to (info), a duplicate control key);
  - [SYG127](https://sygnal.js.org/reference/errors#syg127) (error): a behavior collision or a `uses` value that isn't a behavior; [SYG226](https://sygnal.js.org/reference/errors#syg226) (warn): `undo` / `undoable` `track` or `resetOn` names an unknown action;
  - [SYG222](https://sygnal.js.org/reference/errors#syg222) (warn, dev entry): a STATE reducer changed the state in place and returned it, so the change is ignored;
  - [SYG223](https://sygnal.js.org/reference/errors#syg223) (warn), [SYG224](https://sygnal.js.org/reference/errors#syg224) (error) and [SYG642](https://sygnal.js.org/reference/errors#syg642) (warn): `persist` names a key not in `initialState`, is on a component that isn't the root, or failed to read, migrate or write;
  - [SYG422](https://sygnal.js.org/reference/errors#syg422) (error): an invalid timer spec; [SYG643](https://sygnal.js.org/reference/errors#syg643) (warn, dev entry and `sygnal-check`): `timers`, `connections` or `resources` declared with no driver to take them;
  - [SYG640](https://sygnal.js.org/reference/errors#syg640) (warn) and [SYG641](https://sygnal.js.org/reference/errors#syg641) (error): an element command's target not found, an unknown element command;
  - [SYG644](https://sygnal.js.org/reference/errors#syg644) (warn, dev): a `defineElement` prop that hides an `HTMLElement` member; [SYG645](https://sygnal.js.org/reference/errors#syg645) (warn, dev entry): `viewTransitions` without the View Transition DOM driver;
  - [SYG701](https://sygnal.js.org/reference/errors#syg701)–[SYG708](https://sygnal.js.org/reference/errors#syg708): the accessibility lane above.
- **`sygnal/vite` `nativeGlobalThis`** (default `true`). xstream loads the `globalthis` npm polyfill and its dependency chain; the plugin now aliases it to a stub that returns the native `globalThis` in dev, build and Vitest, which makes a typical app about 4 KB gzipped smaller (kanban example: 42.1 → 38.1 KB). The Astro integration adds it to `astro build` too. A `globalthis` alias of your own wins; `nativeGlobalThis: false` keeps the polyfill ([details](https://sygnal.js.org/integration/bundler-config/#native-globalthis)). The stub is also exported as `sygnal/shims/globalthis` for other bundlers.
- **Collection `sort`** accepts `1`/`-1` per field and arrays of field names, sort objects and comparators (new `SortSpec` type).
- **`class`** accepts strings, arrays and clsx-style mixes: `class={['btn', { active: on }]}`.
- **Types** ([TypeScript guide](https://sygnal.js.org/integration/typescript/)):
  - a typed sub-component takes `state="slice"`, a lens or no `state` in JSX, plus its own props (`ViewProps`, `ElementProps` and `StateProp` exported);
  - `Component`'s 8th parameter `PROVIDED_CONTEXT` types a component's own `.context` separately from the context it reads;
  - an intent annotated `IntentSources<State>` is accepted on a component with `calculated` fields;
  - constants on non-STATE sinks (`LOG: 'saved'`) type-check (`NonStateSinkValue`);
  - `renderComponent()` infers the state type from the component, and `RenderResult<State>` types `t.state`, `t.states`, `t.next(s => …)` and `t.waitForState`, so typed tests need no `any`;
  - `Component.connections`, reply-action request fields, and `signal` on the EFFECT props;
  - the 6.0 additions: `Control` / `ControlSpec`, `ElementCommand` and the `ElementCommandRegistry` interface, `UsesState` / `UsesActions`, `Persist`, `TimerSpec` / `Timers`, `UidFunction` (`uid` on view and reducer props), `StateSource.watch`, `TestAction` / `ExplainedAction` / `ActiveTimer` for `t.actions`, `t.explain` and `t.timers`.
- **Docs:** new pages for [HTTP](https://sygnal.js.org/guide/http/), [sockets](https://sygnal.js.org/guide/sockets/), [custom drivers](https://sygnal.js.org/guide/custom-drivers/) and [server functions](https://sygnal.js.org/integration/server-functions/) (Telefunc through a `driverFromAsync` with reply actions, with security rules for exposing server functions); sections on sinks seeing the state from before the action, extracting a component without changing its markup, latest-only responses, HTTP, fake timers, the real DOM mode, and TypeScript sub-components and context. For 6.0's ergonomics: new pages for [behaviors](https://sygnal.js.org/guide/behaviors/), [element commands](https://sygnal.js.org/guide/element-commands/), [persistence](https://sygnal.js.org/guide/persistence/), [timers](https://sygnal.js.org/guide/timers/), [View Transitions](https://sygnal.js.org/guide/view-transitions/), [accessibility](https://sygnal.js.org/guide/accessibility/), [controls](https://sygnal.js.org/guide/controls/) (also an entry on [alternative forms](https://sygnal.js.org/advanced/alternative-forms/#controls-instead-of-class-selectors)) and [undo](https://sygnal.js.org/advanced/undo/); sections on the [app-level error hook](https://sygnal.js.org/advanced/error-boundaries/#app-level-error-hook), [`uid()`](https://sygnal.js.org/guide/forms/#labels-and-ids-uid), [`STATE.watch`](https://sygnal.js.org/guide/intent/#reacting-to-state-changes-statewatch), [Immer](https://sygnal.js.org/guide/model/#writing-updates-as-mutations-with-immer), [testing with Testing Library](https://sygnal.js.org/integration/testing/#testing-with-testing-library), the [action log](https://sygnal.js.org/integration/testing/#action-log-tactions-and-texplain) and [big lists](https://sygnal.js.org/guide/collections/#big-lists-collection-or-mapped-rows).
- **`sygnal-check`:** explanations for every new code (`sygnal-check explain SYG112`), SYG112 and SYG508 as static rules, `ok`/`error` reply-action names and `connections` names counted as triggers by SYG102, a `'reply'` action trigger in `--graph` / `inspect()`, and the updated severity semantics below. For 6.0's ergonomics:
  - controls are resolved in the same file and through relative imports and re-exports: SYG110 and SYG104 by identifier, SYG124–SYG126, SYG128, and SYG111 looks through controls;
  - `--fix --controls` converts a single-class intent selector into a control when the class is on exactly one element of the component's own view; the class stays when CSS, another source file or `--keep-classes` needs it. Opt-in, since controls are an alternative form (plain `--fix` leaves selectors alone); running it again changes nothing;
  - `uses` is resolved to `defineBehavior` factories (same file, relative imports) and the first-party behaviors, so SYG101, SYG102, SYG104 and SYG110 see behavior actions and controls; a behavior from a package is opaque (no findings). SYG127 and SYG226 are static too;
  - `persist` (SYG223, SYG224), timers (SYG422; timer actions count as triggers for SYG102), element commands (SYG640, SYG641; the `close` and `toggle` events commands cause count as triggers), SYG643 when the scanned `run()` call registers no driver for `timers`, `connections` or `resources`;
  - the accessibility lane (SYG701–708), warnings unless `--a11y=error` (`check(…, { a11y: 'error' })`, the MCP tools' `a11y` argument, `check: { a11y: 'error' }` in the Vite plugin);
  - static checks for three traps the agent evals hit (REPORT-v4), each silent unless every fact is in the source:
    - [SYG405](https://sygnal.js.org/reference/errors#syg405) at a sub-component's `initialState` when a view renders it without `isolatedState = true` (an error for `<Stopwatch state="stopwatch" />` or `<Stopwatch />`, which throw at run time; a warning for a Collection or Switchable target);
    - [SYG129](https://sygnal.js.org/reference/errors#syg129) (new, warn): `CHILD.select(TaskRow)` in a component that doesn't render `TaskRow` while a component it renders does (a grandchild, such as a Collection item inside a child). `PARENT` reaches only the direct parent; the fix relays it through the component in between;
    - [SYG609](https://sygnal.js.org/reference/errors#syg609) (warn): a model sink such as `HTTP` or `WS` that the scanned `run()` call registers no driver for, so the app drops every value sent there while `renderComponent()`'s fakes keep its tests passing;
  - `--graph` lists controls, behavior-owned actions, element commands and timers;
  - the SYG502 rule is removed (retired, see Changed).
- **`create-sygnal-app`:** `README.md` in the package.

### Changed

- **A STATE reducer that returns the object it received means "no change"** ([Model](https://sygnal.js.org/guide/model/#aborting-an-action)), exactly like `ABORT`: no state is emitted and nothing re-renders, in components and Collection items alike. The entry's other sinks are unchanged. Before, it emitted the same object as a new state and re-rendered. A reducer that changes the state in place and returns it therefore has no effect; the dev entry reports it as SYG222. Immer's `produce()` works as a STATE reducer as is (a recipe that changes nothing returns the original).
- **Strict SYG502 is retired** ([strict mode](https://sygnal.js.org/guide/strict-mode/#syg502-retired-in-60)). It flagged `return state` for "no change", which is now the same as `ABORT`. The code is never reported. Static detection of a bare `return;` (or a reducer body that can end without returning) went with it; at runtime, a root STATE reducer returning `undefined` is still SYG202. `ABORT` stays the form the docs use.
- **New reserved names:**
  - the prop `uid` (the view's [`uid()`](https://sygnal.js.org/guide/forms/#labels-and-ids-uid)): a parent can't pass its own (SYG106, an error under strict mode);
  - the statics `uses`, `persist`, `timers` and `viewTransitions`, which Sygnal reads (`viewTransitions` must be an array of action names);
  - the sink `ELEMENT`, built in (element commands) for every component; on a root with `persist()`, the sink `PERSIST` and the action `RESTORE` (a `RESTORE` model entry replaces the built-in one);
  - in `renderComponent()`, the sink `TIMER` (or the `timerSink` option) is served by the timer fake unless a driver is passed under that name.
- **The accessibility lane is on by default** in `sygnal-check` and the Vite plugin's dev checker, so existing projects may see new SYG7xx warnings. They stay warnings under `--strict` and `diagnostics.strict` (strict mode is about canonical forms, and an upgrade shouldn't fail on markup nobody touched), so they never open the Vite overlay unless you opt in with `--a11y=error` / `check: { a11y: 'error' }`. An earlier 6.0 pre-release plan made them errors under `--strict`; that was dropped before release (D144). Fix them, or silence one with `// sygnal-ignore SYG70x`. Nothing changes at runtime.
- **`run()` is scoped to its app.** Hot module replacement keeps each app's own state: `hmr()` reads the app's own state stream, and a hot swap is visible only to that app. The page-wide `window.__SYGNAL_HMR_PERSISTED_STATE`, `__SYGNAL_HMR_UPDATING` and `__SYGNAL_HMR_STATE` are gone, and a swap no longer writes the kept state into the component's `initialState` static. A `run()` without the `diagnostics` option keeps the current mode while another app is live (it reset it before). The first live app keeps `window.__SYGNAL_DEVTOOLS_APP__`, and disposing it gives the slot back.
- **Mock DOM: events that don't bubble in the browser don't bubble in `renderComponent()`.** `focus`, `blur`, `mouseenter`/`mouseleave`, `pointerenter`/`pointerleave`, `load`, `unload`, `scroll`, `scrollend`, `invalid`, `close`, `cancel`, `toggle`, `beforetoggle`, `error` and `abort` reach only listeners on the target element, not its ancestors; with `dom: 'real'`, `simulateEvent` dispatches them with `bubbles: false`.
- **Collection items keep their identity.** After an item writes its state back, the other items that have an id are the same objects in the parent's array, and an item component receives its item as is (before: `{ ...item }` copies). Items without an id are still copied with their index as the id. With duplicate ids, the first match still wins.
- **A Collection removal can wait for a moved item** (part of the G-213 fix under Fixed). While an item that moved into another Collection in the same update is still rendering its first view, the removal waits for it (at most 100 ms), so a moved item is never painted missing; only new items of that update hold a removal. A plain delete is rendered at once when its Collection is the only one alive on the page, and one task later when several are (a delete can't be told from the first half of a move between them then). First renders and pure reorders are not delayed.
- **`renderToString()` marks its root element with `data-sygnal-ssr=""`** ([SSR](https://sygnal.js.org/integration/ssr/)): `<div class="counter" data-sygnal-ssr="">…</div>` (on a fragment, its first element). The first client render removes it. It tells Sygnal's markup apart from other content in `run()`'s mount point, such as a client-only app's loading placeholder, so a [`persist()`](https://sygnal.js.org/guide/persistence/#server-rendering-hydrate) app restores its saved state after the first render only over server HTML. Every app's SSR output changes by this attribute.
- **Vike:** the Page, Layouts and Wrappers get matching `uid()` roots on the server and the client (an internal `id` per shell, `w0`, `l0`, `p`), so ids survive hydration under a Layout or Wrapper. A Vike page doesn't support `persist()` in 6.0 (SYG224 says so).
- **Astro:** island roots forward the `persist`, `uses`, `timers` and `viewTransitions` statics. Islands get no drivers, so `timers` (like `connections` and `resources`) can't run in an island yet.
- **Switchable pages stay alive and keep their state** ([Switchable](https://sygnal.js.org/guide/switchable/)). Every page is instantiated once and kept for the Switchable's lifetime. A hidden page keeps its own state and its sub-components, and its reducers, `EVENTS`/`PARENT`/`EFFECT` and `.context` see the current state, but it doesn't re-render while hidden: it renders the current state once when it is shown again. Before, a page's sub-components were re-created (their state reset) on every switch.
- **Severity and codes follow one rule** (`error` = the operation failed, thrown or caught and logged while the app keeps running; `warn` = likely mistake). A coded Sygnal error caught by a reducer, EFFECT or a parent is now reported under its own code (SYG215, SYG405, SYG413, SYG414, SYG903, …) instead of SYG216, SYG214 or SYG408. SYG405 is an `error` by default (still a warning for Collection and Switchable items). SYG420 (JSX tag is undefined) is now collected like other diagnostics.
- **A component's statics are shared by its instances, and frozen in dev** (PLAN-4.5, D152). `initialState`, `model`, `context` and `calculated` are no longer copied for each instance. With diagnostics on (the `sygnal/diagnostics` entry, which `sygnal/vite` injects in dev), they are frozen when the first instance is created, `initialState` deeply (its plain objects and arrays), so a reducer or view that changes them in place (`state.items.push(x)` on the initial state) throws where it happens and is reported (SYG216 in a reducer, SYG406 in a view) instead of silently changing every instance. Production builds freeze nothing.
- **SYG106 is an error in strict mode** (a parent prop named `state`, `children`, `slots`, `context` or `peers`); a warning otherwise.
- **Non-STATE reducers may return `null`, arrays and bigints**; they are sent to the driver as-is. Only a symbol other than `ABORT` is SYG218. Before, these were rejected with SYG218/SYG216 and nothing was sent.
- **`renderComponent()` waits:**
  - `ready()` is also a cursor: a `next()` right after `await t.ready()` also matches states produced by the calls buffered before it;
  - a `next()` right after another wait starts after the state that wait returned, so `await t.next(a); await t.next(b)` sees a `b` that arrived while `a` was rendering;
  - `t.html()` throws before the first render (it returned `''`), naming `await t.ready()`;
  - `t.html()` serializes like `innerHTML`: text escapes only `& < >` (`Couldn't`, not `Couldn&#39;t`), attributes only `& "`. `renderToString()` output is unchanged;
  - `dispose()` rejects waits still pending instead of leaving them open.
- **`sygnal-check` SYG111** also reports a literal `<select value="a">` with no change listener: the runtime puts the selection back on every render, like any controlled field.
- **Vike:**
  - `sygnal/config` (also `sygnal/vike` and `sygnal/vike/config`) is a single ESM file, `dist/vike/config/+config.js`; the CommonJS `+config.cjs.js` build is gone. This removes the `unexpected export { module.exports }` and `MODULE_TYPELESS_PACKAGE_JSON` warnings on every dev start;
  - `urlPathname` is no longer in `passToClient` (Vike provides it on the client, and listing it logged a warning); the client falls back to `window.location.pathname`;
  - in dev, `sygnal/vike/onRenderClient` is kept out of dependency pre-bundling, so the client entry and your pages share one Sygnal core;
  - Pages, Layouts and Wrappers keep their function names (or `componentName`) in diagnostics; the root is `VikeLayoutWrapper` when a Layout or Wrapper is configured.
- **Agent context:** `llms.txt` and the `sygnal-dev` skill cover `makeFetchDriver`, the test fakes, fake timers, `dom: 'real'`, `t.state` and TypeScript. The skill's `references/component-patterns.md` is removed (its content is in `SKILL.md`), and the agent docs no longer recommend the `sygnal-check` MCP server (the server itself is unchanged). They teach reply actions as the canonical HTTP form, `connections` for sockets, and the socket fakes; the old `category` + `select()` round trip is on the alternative-forms page.
  <!-- TODO(4-A): add the 6.0 ergonomics to this entry once 4-A syncs llms.txt and the skill (behaviors, element commands, persist, STATE.watch, t.actions, the 7xx lane, no "never return state" rule; controls stay out of them: an alternative form, D141). -->
  <!-- TODO(4-E): if the Testing Library A/B justifies t.screen / t.user getters (GS-14), add them under Added. -->
  <!-- TODO(Phase 4 follow-up, G-228): if a dev check for a non-array viewTransitions lands, mention it in the Reserved names breaking entry. -->

- **The core is about 250 B smaller** (gzipped) with the same behavior, which pays for the `connections` static.
- **`create-sygnal-app` templates:** `AGENTS.md` tells agents to read the whole `npm test` output instead of piping it through `tail`, which hid the failure.

### Fixed

- **A model without `INITIALIZE` is no longer written to** (G-252). The first instance of such a component added its default `INITIALIZE` reducer to the shared `model` object, which kept that instance (and its streams) in memory for the life of the page and gave every later instance the first one's calculated-field cache. Each instance now has its own.
- **`renderComponent` `ready()`** no longer resolves before the first render when that render takes longer than 30 ms (a loaded machine or a slow view). Before, `t.query()` could return `null` right after `await t.ready()`.
- **Vike docs:** custom drivers go in `pages/+drivers.js`. The [Vike guide](https://sygnal.js.org/integration/vike/#custom-drivers) showed `drivers` inside `+config.js`, which Vike rejects: `vike build` fails with "must be defined using a separate file +drivers.js", and in `vike dev` the page never hydrates.
- **Switchable.**
  - A page's `PARENT` never reached the parent's `CHILD.select(Page)`: only sinks that were also sources were forwarded.
  - The Switchable could stay on the previous page after a switch (a page shown again while its stream chain was being torn down never rendered).
  - `stateSourceName` wasn't passed on by the stream form of `switchable()`.
- **State.**
  - After a child's lens write (a Collection item or a `state="slice"` child), the stored root state (`STATE` stream, devtools, `t.state`/`t.states`) kept stale calculated fields; the view was right.
  - `.context` reading a calculated field lagged one update behind a Collection item's write.
  - An `isolatedState` sub-component with `initialState` and no model never applied its `initialState`.
  - A root component with an `intent` but no `model` rendered nothing under `run()` (its `initialState` was never applied), while `renderComponent()` rendered it.
  - A component static that is neither a function nor an object (such as `App.route = 'ROUTE'`) was iterated character by character and threw SYG216; it is sent to its driver as is.
  - A sub-component with a `model` but no `intent` never got `BOOTSTRAP`.
  - A child rendered inside another child was instantiated once per ancestor; the duplicates ran BOOTSTRAP and timers and wrote state.
  - A stream from `STATE.select(…)` didn't end when its component was disposed (the select dropped the end stream).
- **Collections.**
  - A Collection in a child component ignored a change to its `filter` or `sort` prop until some item's state changed.
  - `sort` without `filter` sorted the parent's state array in place; sorting now only changes what renders.
  - Moving an item from one Collection to another (a kanban card to another lane) painted frames without it: 0–1 per move, 4–8 in rapid moves, even with no animation. The old Collection's removal rendered before the moved item's new instance did; it now waits for it (see Changed).
- **Rendering and forms.**
  - A string or array `class` became one class name or `[object Object]`.
  - A prop removed on re-render (`title`, `disabled`, `href`, …) stayed on the element, and `src={null}` / `title={null}` were written as the text "null". `null` and `undefined` props are never written; a removed prop is cleared.
  - `value={null}` and `checked={null}` clear a controlled field and keep it controlled, as in 5.4.0; leaving the prop out makes the field uncontrolled.
  - A `<select>`'s `value` was applied before its new options were patched, so it could select nothing.
  - A `data-task-id="7"` JSX attribute became the dataset key `task-id`, which the DOM rejects: rendering stopped with a bare `DOMException {}`. It is now the key `taskId`, so the attribute renders as written and `.data('taskId')` reads it.
  - A controlled input dropped keystrokes typed faster than the app rendered ('Hello world' became 'Hlowrd' with keys 1–2 ms apart; in Chromium, a 40 ms view with keys 30 ms apart lost about half): a render of an older state wrote its older `value` over newer text. A render now leaves a field the user changed after the rendered state until the newer render arrives; `value={null}`, resets and model rewrites still land. A model that rewrites the typed text back to the value it already had (a length cap) re-renders, so the field shows the state again (PLAN-4.5).
- **DOM events.**
  - A component whose view returns a fragment (`<>…</>`), also as a Collection item or Switchable page, lost its DOM isolation under the real DOM driver: its own intent never fired, and the parent's selectors matched its elements. Every top-level element of a fragment now carries the component's scope, and `DOM.select(...).elements()` searches all of them. The mock DOM was already right.
  - The real and mock DOM disagreed on events from inside a child component. Both now follow browser bubbling: a listener on an element the parent rendered itself (`<div className="slot"><Child /></div>` with `DOM.click('.slot')`) hears events from inside the child, after the child's own listeners; the real DOM driver stopped them at the child. The parent still can't select elements inside a child (SYG104).
  - A `<dialog>`'s `close` and `cancel`, a popover's `beforetoggle`, and the media and image events `abort`, `error`, `loadstart` and `progress` never reached intent: they don't bubble, and the driver listened for them at the root, even with `useCapture: true`. They are now listened for on the element, so `DOM.close(dialog)` and `DOM.select('img').events('error')` fire.
- **Several apps on one page** (two `run()` calls, or an app plus custom elements). Hot module replacement could restore another app's state, and an app started during another app's hot swap took that app's state and skipped its own `INITIALIZE`; a second `run()` reset the diagnostics mode of the first. Each app is now independent (see Changed).
- **Drivers.**
  - `driverFromAsync` lost replies and errors that arrived before the first `select()` / `errors()` listener (a request sent on `BOOTSTRAP`); they are buffered and delivered once a listener subscribes.
- **Testing.**
  - Waits hung under fake timers.
  - A child component's sink with no driver went to a no-op driver, so its output couldn't be asserted.
- **Vike.**
  - After client navigation with both a Wrapper and a Layout, the page's `+data` was lost. Shell components now each get a lens onto their own slice (serialized 5.4.0 state still hydrates).
  - Resources in a page under a Layout or Wrapper lost their first state write (they showed `idle`): the page no longer re-applies `initialState` over its root slice.
  - In dev, the pre-bundled client entry inlined a second copy of the Sygnal core.
- **Types.**
  - The root component's view `state` was untyped (`RootComponent` props were `any`).
  - Typed sub-components couldn't be used in JSX with `state="slice"` or without `state`.
  - `CHILD.select(Child)` silently became `any` for an annotated child without a `PARENT` type.
  - DOM shorthands (`DOM.keydown('.x')`) were streams of plain `Event`.
  - `event()` with an unregistered name gave two errors; it gives one.
  - `SortObject` allowed a per-field function, which the runtime rejects (SYG418).
  - A `PARENT: false` constant was typed as `never`.
  - `npm run build` printed 56 TypeScript diagnostics; it prints none, and `test:types` type-checks the whole source.
- **A view that returns the same root vnode object again** (a cached or memoized tree) kept its child components (G-255). Before, they were disposed on that render and their placeholders reached the DOM as bare tags.
- **`Transition`, `Portal`, `ClientOnly` and lazy components inside a fragment** (`<>…</>`) work (G-256). Before, they reached the DOM as `<transition>`, `<portal>`… elements.
- **Messages.** SYG218 says "returned null" / "returned an array" instead of "returned a object".

### Performance

- **Collection item lookups are O(1).** An item's write-back and lookup no longer scan the list (two O(n²) paths), with no API change and about 40 B in the core. In a 1,000-row Collection (median of 10 runs, Chromium), editing one row went from 16.2 to 8.3 ms and swapping two rows from 10.7 to 5.5 ms. Unchanged items keep their identity (see Changed).
- **One render scheduler per app** (PLAN-4.5). A state change no longer renders each component through its own 1 ms debounce timers, with a DOM patch from the root for every component that re-rendered: the components it touched are rendered once, parents before children, and the page is patched once, in a microtask after the action's reducers. Selecting a row in a 1,000-item Collection went from 1,001 DOM patches to 1 (main-thread time 88 → 31 ms), updating every 10th row from 102 to 1, a click 30 components deep from 51 to 1 (6.6 → 2.5 ms); a keystroke in a 1,000-item page takes 1.6 ms (was 4.7 ms, now within 2× of React). A move between two Collections is one patch, so the removal hold that kept a moved item from disappearing for a frame is gone, and a View Transition no longer waits 20 ms after the last render.
- **A performance baseline** against React 19 and Vue 3.5 (create, edit, swap, append and clear on 1,000 rows, plus a js-framework-benchmark implementation): `npm --prefix browser-tests run perf`, results in `benchmarks/RESULTS.md`. The [Collections guide](https://sygnal.js.org/guide/collections/#big-lists-collection-or-mapped-rows) now says when to map rows in one component instead.

### Breaking changes (runtime behavior)

These are fixes, but code or tests may depend on the old behavior:

- **A STATE reducer that returns the object it received is "no change"** (see Changed). Code that returned the same object to force a re-render, or changed the state in place and returned it, now does nothing.
- **SYG502 is retired.** Strict mode no longer reports `return state`, and `sygnal-check --strict` no longer reports a bare `return;` in a reducer.
- **Reserved names:** a `uid` prop passed by a parent is overwritten by the view's `uid()`; statics named `uses`, `persist`, `timers` or `viewTransitions` are read by Sygnal (a `viewTransitions` that isn't an array makes every STATE reducer of the component fail with SYG216); a model's `ELEMENT` sink runs element commands and is not sent to a driver of that name; in `renderComponent()`, a `TIMER` sink without a driver goes to the timer fake.
- **Mock DOM:** a test that sent a non-bubbling event (`focus`, `blur`, `close`, `toggle`, `scroll`, `error`, …) to an element and expected an ancestor's listener to hear it now gets nothing, as in the browser.
- **HMR globals:** `window.__SYGNAL_HMR_PERSISTED_STATE`, `__SYGNAL_HMR_UPDATING` and `__SYGNAL_HMR_STATE` no longer exist; a hot swap no longer writes into the component's `initialState` static.
- **Collections:** unchanged items with an id are the same objects after another item writes back (no `{ ...item }` copies).
- **SSR markup:** `renderToString()` output has `data-sygnal-ssr=""` on its root element, so a test or snapshot that compares the HTML exactly changes.

- **Hidden Switchable pages don't re-render** and keep their sub-components' state across switches (before: re-created on each switch). Code that relied on a page resetting when it is switched away should reset its state explicitly (for example on the action that switches).
- **`t.html()` throws before the first render** instead of returning `''`, and **escapes like `innerHTML`**, so stored snapshots containing `&#39;` or `&quot;` in text change.
- **`next()` cursor semantics:** a `next()` right after `await t.ready()` or after another wait can now match a state that the old `next()` skipped; a test that awaited `t.next()` to skip such a state needs a more specific predicate.
- **Codes and severities:** SYG405 is an `error`; errors caught by a handler are reported under their own code, so `ignore: ['SYG408']` or `['SYG216']` no longer silences a SYG405/414/903 or a SYG215. SYG106 is an error under strict mode. In `diagnostics: 'error'` mode, these throw.
- **Events bubble out of child components in the real DOM**, so a parent listener on its own element around a child (or around a Collection) now also fires for events from inside the child; a handler that should ignore them can check `e.target`, or the child can call `e.stopPropagation()`. In `renderComponent()` (mock DOM), one event now reaches listeners innermost first, like the browser (before: parent before child), so the order of actions recorded from one event can change.
- **Driver sinks receive `null`, arrays and bigints** from reducers instead of nothing (and an error).
- **Vike:** `require('sygnal/config')` loads the ESM config (Node's `require(esm)`); nothing points at `dist/vike/+config.js` or `+config.cjs.js` any more. `pageContext.urlPathname` isn't serialized to the client.
- **`HYDRATE` is no longer a built-in action.** Nothing dispatched it except the legacy `@cycle/http` path below. A model entry named `HYDRATE` is now an ordinary action (SYG102 if nothing triggers it).
- **Legacy `@cycle/http` hydration removed:** an `HTTP` source's `select('initial')` no longer becomes `HYDRATE`, and the component option `requestSourceName` is gone.
- **Async EFFECTs:** a returned promise no longer warns (SYG219); its rejection is reported as SYG214; `next()` called from an EFFECT after the component is disposed does nothing.
- **Reserved request keys:** `ok`, `error` and `key` on requests to `makeFetchDriver`, `driverFromAsync` and `makeSocketDriver` name reply actions (a 5.4.0 `driverFromAsync` request that used `ok`/`error` as data keys now gets reply actions); a request with a `then` or `catch` key is refused (SYG610).
- **Strict mode** reports the `select('c')` round trip for a component's own `category: 'c'` requests (SYG508), so strict-clean 5.4.0 code using `driverFromAsync` + `QUOTE.select('quote')` for its own requests gets a finding.
- **`sygnal/vite`** aliases `globalthis` for every dependency in the app, not only xstream. Set `nativeGlobalThis: false` if a dependency needs the polyfill package.
- **DevTools are no longer in production builds** ([Debugging](https://sygnal.js.org/integration/debugging/#devtools-extension)). `run()` no longer installs the DevTools bridge (`window.__SYGNAL_DEVTOOLS__`); the new dev-only entry `sygnal/devtools` does on import, and `sygnal/vite` injects it in dev (`vite`, the Vike and Astro dev servers; `devtools: false` opts out), never in `vite build`. With `sygnal/vite` nothing changes in dev, and the bridge (about 2 KB gzipped) leaves every production bundle. `getDevTools()` from `sygnal` returns `undefined` when the bridge isn't installed (before: a bridge object even outside a browser), so `getDevTools().inspect()` needs the bridge loaded. The UMD build (`sygnal.min.js`) has no DevTools.
- **Render timing** (PLAN-4.5). Views render once per tick, in a microtask after the reducers, instead of 1–2 ms after a change: code or tests that waited a fixed 1–2 ms still work (the render comes sooner). Two components that re-render for one change are now in the same DOM patch, so nothing sees the DOM in between (a `MutationObserver`, a test reading the DOM between them). A component's first render still waits for its `INITIALIZE` and for its intent to listen (about 1 ms after it is created).
- **The DOM source emits after Sygnal's patches only** (PLAN-4.5). `DOM.select(…).elements()` (and anything built on the DOM driver's root element) emitted on every change inside the app's root, watched with a `MutationObserver`; it now emits after each patch. Changes another script makes to the app's DOM no longer make it emit.
- **In dev, mutating a component's statics throws** (PLAN-4.5, D152). With diagnostics on, `initialState` is deep-frozen and `model`, `context` and `calculated` are frozen, so code that changed the initial state in place (an item of an initial array, say) gets a TypeError (SYG216 or SYG406) in dev. Create new objects instead; production is unchanged.
- **JSX: nested prop objects are passed by reference** (PLAN-4.5). The JSX pragma no longer deep-copies `style`, `attrs`, `props`, `on`, `hook`, `class` and `data` objects, or a component's object and array props: the vnode holds the object you passed, as in React, Vue and snabbdom. Changing such an object in place and rendering it again can leave the DOM as it was (the next diff compares the object with itself); create a new object instead. An entry set to `undefined` is still dropped, and an object Sygnal adds to (`attrs={…}` plus `aria-label`, a `ref` on an element with a `hook`) is copied, never written to.

### Breaking changes (TypeScript)

Type-level only; JavaScript and runtime behavior are unaffected:

| Change | Before | Now | Migration |
|---|---|---|---|
| `CHILD.select(Child)` of a `Component<…>`-annotated child without a `PARENT` type | `Stream<any>` | `Stream<unknown>` | Declare the payload in the 7th parameter: `Component<S, P, D, A, C, X, { PARENT: Payload }>`, or annotate at the call site |
| DOM shorthands `DOM.click('.x')`, `DOM.keydown('.x')`, … | `Stream<Event>` | the event's own type (`MouseEvent`/`PointerEvent`, `KeyboardEvent`, … from `HTMLElementEventMap`) | Fix handlers annotated with the wrong event type. xstream streams are invariant, so `const clicks: Stream<Event> = DOM.click('.x')` no longer compiles: drop the annotation or use the specific type (`Stream<MouseEvent>`; `click` is `PointerEvent` in recent DOM typings). Custom event names (`DOM['my-event']`) are still `Event` |
| `RootComponent` view props | `any` | `{}` (state typed by `STATE`) | A root view gets no props: drop props destructured from it, or type the component as `Component<S, Props>` |
| View `context` | optional (`context?.x`) | required in `ViewProps` | Calling a view directly (`App({ state })` in a test) needs `context: {}`; `context?.` still compiles |
| `event()` | two overloads | one signature `event(type, payload?)` | No change for valid calls. With an empty `SygnalEvents` registry, a static payload was `any` and is now a plain value: an `interface`-typed object fails ("Index signature … is missing"). Declare it as a `type` alias, register the event in `SygnalEvents`, or pass a payload function (`event('X', () => payload)`) |
| `SortObject` | `'asc' \| 'desc' \| SortFunction` per field | `'asc' \| 'desc' \| 1 \| -1` (`sort` is `SortSpec`) | Use a comparator `sort={(a, b) => …}` or an array `[{ priority: -1 }, cmp]` (the runtime already rejected per-field functions, SYG418) |
| Non-STATE sink values | `true` or a reducer | also constants (`NonStateSinkValue`) | None (wider); an untyped sink's constant can't be a function |
| JSX attributes of a typed sub-component | the view's props, `state` required | own props + optional `state` (`ElementProps`) | Passing `context=` or `slots=` in JSX is now a type error (they were overwritten at runtime, SYG106) |
| `HYDRATE` built-in action key | always allowed in typed models (`HYDRATE?: any`) | an ordinary action | List it in ACTIONS if you dispatch it; for SSR data use Vike `+data` / `hydrateState` |
| `set()` argument | any | `Partial<S> & object` or a reducer | `set('field')` was always wrong (SYG221): use `set((state, v) => ({ field: v }))` |
| `renderComponent` / `RenderResult` | not generic (`any`) | `renderComponent` infers the state; `RenderResult<S = any>` | None for untyped tests. Typed tests may now report real errors in predicates; for a handle declared before assignment use `let t: RenderResult<State>` |
| `FetchRequest` reply-action keys | `ok`/`error`/`key`/`then` were free app fields | `ok`/`error`/`key` are `string`, `then`/`catch` are `never`, `abort` is `true \| string` | Rename app fields with those names, or nest them |

`FetchInit`, `FetchRequest` and the other fetch and socket types are new.

### Removed

- `dist/vike/+config.cjs.js` (CommonJS Vike config); see Vike above.
- `skills/sygnal-dev/references/component-patterns.md` (content folded into `SKILL.md`).
- `HYDRATE` as a built-in action, the `@cycle/http` `select('initial')` hydration path and the `requestSourceName` component option.
- The strict rule SYG502 (runtime and `sygnal-check`); the code stays in the reference, marked retired.
- The page-wide HMR globals `window.__SYGNAL_HMR_PERSISTED_STATE`, `__SYGNAL_HMR_UPDATING` and `__SYGNAL_HMR_STATE`.
- The `extend` runtime dependency: the JSX pragma sorts props into snabbdom's modules in one pass without deep copies (about 280 B gzipped less in an app). `snabbdom` and `xstream` are the only runtime dependencies.

### Migration

Most apps need no changes. Check these:

- **Returning the same state object:** a reducer that returned `state` to force a re-render must return a new object (`{ ...state }`). One that changed the state in place and returned it must return a new object (the dev entry's SYG222 points to it), or wrap the reducer in Immer's `produce()` ([recipe](https://sygnal.js.org/guide/model/#writing-updates-as-mutations-with-immer)). `return state` for "no change" can stay; the docs keep `ABORT`.
- **SYG502:** nothing to do. Entries in `ignore` lists and `// sygnal-ignore SYG502` comments are harmless and can be removed.
- **Accessibility warnings in CI:** `sygnal-check` exits 1 on warnings by default, so the new SYG7xx findings fail a CI step that runs it, with or without `--strict`. Fix them, silence the ones you keep on purpose (`// sygnal-ignore SYG70x`), or run with `--fail-on=error` while you work through them; `--a11y=error` makes them errors once the app is clean. New static findings can appear too: SYG405 (a child with `initialState` that a view renders, which already throws at run time), SYG129 (`CHILD.select()` of a grandchild, which never fired) and SYG609 (a sink with no driver in `run()`, which was dropped).
- **Reserved names:** rename a `uid` prop passed to a child; rename a static of your own named `uses`, `persist`, `timers` or `viewTransitions`; rename a custom driver registered as `ELEMENT` (it receives nothing now: a model's `ELEMENT` entries go to the built-in sink only, like `EFFECT`); in tests, pass a driver of your own named `TIMER` in `drivers` (or set `timerSink`).
- **Tests of non-bubbling events** in the mock DOM: send the event to the element that has the listener.
- **HMR:** code that read or set `window.__SYGNAL_HMR_PERSISTED_STATE` (or relied on the swap writing `initialState`) has nothing to replace it with: each app's `hmr()` keeps its own state.
- **Collection removals in tests:** with more than one Collection on the page, await `t.settle()` (or `t.next()` / `t.waitForState()`) before reading the DOM after an item is removed.
- **SSR HTML compared exactly:** update snapshots and string comparisons of `renderToString()` output for the `data-sygnal-ssr=""` attribute on the root element, or strip it before comparing (`html.replace(' data-sygnal-ssr=""', '')`). Code that post-processes the server HTML should keep the attribute, or pass `hydrate: true` to `persist()` (see the [persistence guide](https://sygnal.js.org/guide/persistence/#server-rendering-hydrate)).

- **Switchable:** if a page should start fresh each time it's shown, reset its state on the switching action.
- **Tests:** replace `expect(t.html()).toBe('')` before a render with `await t.ready()` first; update `t.html()` snapshots containing `&#39;`/`&quot;` in text; tighten `next()` predicates that relied on skipping a state; update `ignore` lists and console expectations that named SYG408, SYG216 or SYG214 for errors that now carry their own code.
- **HTTP:** replace a hand-written `driverFromAsync(fetch…)` driver and request-id/ABORT bookkeeping with `makeFetchDriver()`. Move the reply wiring from the intent into the request: `HTTP: (state, id) => ({ url, ok: 'LOADED', error: 'FAILED', latest: true })` replaces `category: 'quote'` + `LOADED: HTTP.select('quote')` / `FAILED: HTTP.errors('quote')` (strict mode flags the old form, SYG508). `category` + `select()` keeps working for requests without reply actions and stream composition. In tests, drop the driver and use `await t.respond('HTTP', body, 'LOADED')` / `t.fail`; a test that expected answering a superseded request to do nothing now gets a synchronous throw. `makeFetchDriver` sends header names in lowercase (`Headers` semantics): a `fetch` stub that reads `init.headers['Content-Type']` must read `content-type` or use `new Headers(init.headers).get(…)`.
- **WebSockets:** replace a hand-written socket driver and connection-generation ids with `makeSocketDriver()` plus `Component.connections = (state) => ({ … })`; register it as `WS` (or pass `socketSink` to `renderComponent`).
- **`HYDRATE` / `requestSourceName`:** pass SSR data through Vike `+data` or the SSR state handoff (`hydrateState`); drop `requestSourceName`. A model entry named `HYDRATE` must now be triggered like any other action.
- **Async EFFECT:** tests that expected SYG219 for an async EFFECT, or relied on `next()` firing after dispose, need updating.
- **Requests with `ok`/`error`/`key`/`then`/`catch` data keys:** rename them or nest them under `value`.
- **Vike:** if you imported `sygnal/dist/vike/+config.js` or `+config.cjs.js` directly, import `sygnal/config` instead. If client code read `pageContext.urlPathname` without Client Routing, use `window.location.pathname`.
- **Bundles:** if a dependency needs the real `globalthis` package, set `sygnal({ nativeGlobalThis: false })`.
- **DevTools:** DevTools are no longer in production builds. With `sygnal/vite` nothing changes in dev; without it, `import 'sygnal/devtools'` in your development entry, before `run()`. Code that called `getDevTools()` unconditionally should use `getDevTools()?.…`.
- **TypeScript:** see the table above. The most common fixes are adding `{ PARENT: Payload }` to children selected with `CHILD.select`, and correcting DOM event annotations.
- **Fake timers:** tests that switched fake timers off around `renderComponent()` can now keep them on.

## 5.4.0 — 2026-10-01

Sygnal's silent failures are now loud, and coding agents get one clear way to write each concept. Every runtime warning and error has a code (`SYGnnn`) with a fix and a docs link. New dev-only checks catch wiring mistakes as they happen, a static checker (`sygnal-check`) catches them before the app runs, and the test helpers drive components the way a user would. This release also fixes a long list of rendering, state and tooling bugs that these checks and the agent evals found.

Nothing here is a breaking API change. The new checks run only in development and in tests, and the forms that strict mode doesn't recommend keep working.

**Measured impact.** In the agent eval ([`evals/agent-ergonomics/results/REPORT.md`](evals/agent-ergonomics/results/REPORT.md)), agents built the same features in Sygnal and in React. Every trial passed in both frameworks before and after this release, so speed is the measure. On the standard tasks, Sygnal trials went from 74.8 s to 50.3 s, the gap to React shrank from 46.1 s to 15.8 s (66% smaller), and failed test runs per trial fell from 1.7 to 0.1. On the harder tasks, trials went from 92.2 s to 78.5 s, the gap to React shrank from 29.0 s to 15.4 s, and iterations per trial (2.4) now match React's (2.5).

### Added

- **Coded diagnostics.** Every runtime warning and error carries a `SYGnnn` code, a fix and a link to the [error reference](https://sygnal.js.org/reference/errors). Choose a mode with `run(App, drivers, { diagnostics: 'off' | 'collect' | 'warn' | 'error' })` (or `{ mode, ignore }`). You can also read findings with `getDiagnostics()`, `clearDiagnostics()` and `onDiagnostic()`.
- **`sygnal/diagnostics`**, a dev-only entry with runtime checks:
  - intent/model wiring (actions with no reducer, reducers with no action);
  - selectors that match nothing, or that only match inside a child component's isolation boundary;
  - EVENTS that are emitted but never selected, or selected but never emitted;
  - reducer return shapes, reserved-prop collisions, and Collection `from` problems;
  - hints when an RxJS operator is used on an xstream stream.
  
  It also provides `inspect()`, a machine-readable app graph. These checks add 0 bytes to production bundles.
- **Strict mode** for the canonical forms (SYG501–507). Turn it on with `sygnal-check --strict`, at runtime with `renderComponent(C, { strict: true })`, or in dev through the Vite plugin. Other forms still run; strict mode only reports them.
- **`event()`**, the canonical way to emit a global event from a model entry: `{ STATE: …, EVENTS: event('SAVED', state => state.id) }`.
- **Test helpers on `renderComponent()`:**
  - `simulateEvent(selector, type, init?)` sends DOM events with bubbling and isolation, the enriched `.value()` / `.data()` / … API, and structural selectors (`:nth-child`, `>`, `:not()`, …);
  - `ready()`, `next(predicate)` and `settle()` wait for renders and states;
  - `html()` returns the rendered markup;
  - `sinkValues()` and `emitted()` return what each sink produced, and `simulateAction` now drives every sink;
  - `expectNoDiagnostics()` fails a test on any Sygnal warning, and the `strict` and `diagnostics` options configure the checks;
  - `inspect()` returns the app graph.
- **Vite plugin dev integration.** In `vite` dev (never in `vite build`), the plugin:
  - loads the runtime diagnostics;
  - runs `sygnal-check` on start and on every save, printing to the terminal and the browser console;
  - adds the diagnostics setup file to Vitest;
  - turns on dev mode for Vike and Astro.
  
  New options: `diagnostics`, `check` and `vitestSetup`. The plugin also configures JSX under Vite 7 as well as Vite 8.
- **`sygnal-check`**, a new separate package (`npm i -D sygnal-check`) that reads your source and never runs it:
  - the same wiring rules across the whole project, plus a controlled-input rule (SYG111);
  - `--strict`, and `--fix` for the mechanical canonical-form rewrites;
  - `--graph [--json]`, the static app graph, in the same shape as `inspect()`;
  - `explain <code>`, which explains any SYG code;
  - `mcp`, an MCP server with `check`, `graph` and `explain` tools;
  - `// sygnal-ignore SYGnnn` comments to silence one finding.
- **Agent context:**
  - `llms.txt`, a normative spec for language models, ships in the package (`node_modules/sygnal/llms.txt`) and at https://sygnal.js.org/llms.txt;
  - a rewritten `sygnal-dev` agent skill (`skills/sygnal-dev`);
  - every `create-sygnal-app` template now has an `AGENTS.md` (and a `CLAUDE.md` that imports it), a strict-mode starter test, and `sygnal-check` as a dev dependency.
- **New exports:**
  - the xstream extras `concat`, `flattenConcurrently` and `flattenSequentially`, next to the existing `debounce`, `throttle`, `delay`, `dropRepeats` and `sampleCombine`, now as tree-shakable ESM ports;
  - `errors()` on `driverFromAsync` sources;
  - `getDevTools` and `Suspense` type declarations;
  - typed links: `ActionsOf`, `IntentSources`, the `SygnalEvents` registry, typed `CHILD.select(Component)` and typed Collection `from`;
  - `isolatedState` and `idfield` in the types, and `LazyComponent`.
- **Docs:**
  - a generated [error reference](https://sygnal.js.org/reference/errors) for all 64 codes;
  - new pages on diagnostics, strict mode, agents and the alternative forms;
  - the guide pages rewritten to the canonical forms.

### Changed

- **`simulateEvent` throws when its selector matches nothing.** The error names the selector after a short wait for a render. Before, the event was dropped silently and the test timed out later. Pass `{ allowMissing: true }` to get the old behavior (the event is dropped and reported as SYG103).
- **Model shorthand (`'ACTION | SINK'`) and `emit()` are now "alternative forms".** They keep working, but the docs, `llms.txt` and the templates use the object form and `event()`, and strict mode reports them (SYG504 for shorthand, SYG505 for `emit()`; `sygnal-check --fix` rewrites both).
- **Messages carry codes.** Existing console warnings and errors now start with `[Sygnal SYGnnn]`, including in production, and several misleading messages were corrected.
- **Inputs are fully controlled.** `value` and `checked` always reflect state after a render, as in React, even when renders are coalesced. A field with a `value` but no input listener gets a SYG111 warning.
- **Non-STATE sinks see the same state as STATE.** Every sink of one action (EVENTS, PARENT, EFFECT, drivers) now reads the same state snapshot, and runs synchronously unless a same-tick STATE reducer is still pending.
- **`driverFromAsync`** delivers `null` and `undefined` results to `select()`. Rejections go to the new `errors()` source and are still logged when nothing listens.
- **`data-sygnal-ready`** now appears only on child components that aren't ready yet, so extracting markup into a sub-component no longer changes the DOM.
- **`lazy()`** returns `LazyComponent<PROPS>`, which is used in JSX without a `state` prop.

### Fixed

- **Plain Node.**
  - `run()` threw `xs.create is not a function` under plain Node CommonJS (`require('sygnal')`) and native Node ESM; only bundlers worked.
  - The re-exported xstream extras (`debounce`, `concat`, …) were `{ default }` objects instead of functions there.
  - Both now work, with a test that runs a whole app in each.
- **State and sinks.**
  - EVENTS and other sinks could see stale state when an action arrived in the same tick as a state change.
  - Two same-tick actions inside a Collection item lost the first update.
  - An `isolatedState` sub-component without a `state` prop replaced its parent's state.
  - Returning `ABORT` from a PARENT, EVENTS, EFFECT or driver sink reported an error instead of sending nothing.
- **Rendering.**
  - A Collection didn't re-render when its items were only reordered.
  - An element patched from one text child to several children kept the old text.
  - A removed `className` stayed on a reused element.
  - A controlled input wasn't cleared when actions arrived in the same tick.
- **Collections and disposal.**
  - Nested Collection and Switchable items weren't disposed with their parent item (a leak, and DISPOSE never fired).
  - Two Collections whose items shared ids shared isolation scopes, so events could cross between them.
  - An invalid `from` was reported twice.
- **DOM events.** `.data('taskId')` failed when the event target was a nested child of the `data-task-id` element. `.data('task-id')` works too.
- **`driverFromAsync`.** A rejected promise was only logged, so loading UIs hung. A `null` result crashed. Teardown printed a spurious warning.
- **Testing.**
  - `renderComponent`'s mock DOM lacked the enriched event API (`.value()`, `.data()`).
  - Events sent right after `renderComponent()` were lost.
  - `simulateAction` ignored non-STATE sinks.
  - Switchable didn't render under the mock DOM.
  - `waitForState` could resolve before children re-rendered.
  - `hmrActions` and `components` were ignored.
- **Vite plugin.**
  - The HMR transform broke test files and other files that call `run()`: it produced invalid code or `__sygnal is not defined`.
  - Under Vite 8, the dependency scanner compiled JSX for React in every Sygnal app.
  - JSX wasn't configured under Vite 7.
  - The diagnostics setup file didn't load under jsdom.
- **Astro.** `sygnal/astro/client` bundled a second copy of the Sygnal core. Island props were nested on the client but spread on the server. Island roots were named "Wrapped" in diagnostics.
- **Vike.** `import vikeSygnal from 'sygnal/config'` failed type-checking (no default export).
- **Devtools.** EVENTS were always attributed to the root component, and devtools stamps broke `toEqual` on sink output.
- **Types.**
  - `lazy()` components required a `state` prop in JSX.
  - `Suspense`, `getDevTools`, `isolatedState` and `idfield` had no declarations.
  - `npm run build` now bundles the declarations, and `prepublishOnly` runs it. The published 5.0.0–5.1.1 declarations referenced a file missing from the package; 5.1.2–5.3.7 were complete.
- **Bundle size.** Unused xstream extras no longer ship in every app.

### Migration notes

No code changes are required. What an existing app may notice:

- **New warnings in development.** Under `vite` dev and in tests, the runtime checks and `sygnal-check` report wiring problems as `[Sygnal SYGnnn]` warnings in the terminal and console. They don't change behavior. Run `npx --no-install sygnal-check explain SYGnnn` or see the error reference for each code. To turn them down:
  - Vite plugin: `sygnal({ diagnostics: 'off', check: false, vitestSetup: false })`, or `diagnostics: { ignore: ['SYG105'] }` to drop single codes;
  - `run(App, drivers, { diagnostics: 'off' })` for a running app;
  - `// sygnal-ignore SYG110` on a line for `sygnal-check`.
- **Tests that relied on a silent no-match.** `simulateEvent` with a selector that matches nothing now throws instead of doing nothing. Fix the selector, or pass `{ allowMissing: true }` where a missing element is expected.
- **Tests that compare console output or markup.** Messages now start with a code, and `data-sygnal-ready` is gone from ready child components.
- **Inputs.** If a field relied on a stale `value` (for example, "save on blur" without an input listener), it now resets to state on every render. Keep the draft in state with an input listener.
