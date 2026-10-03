---
title: "Testing"
description: "Test Sygnal components in isolation with renderComponent"
---

`renderComponent()` renders a Sygnal component, with all its children, on a minimal runtime: a mock DOM, the event bus, state, and any drivers you pass. It needs no browser and no build step. You drive it with the same DOM events a user would produce, so your component's real intent runs.

```jsx
import { renderComponent } from 'sygnal'
import Counter from './Counter.jsx'

const t = renderComponent(Counter, { initialState: { count: 0 } })

t.simulateEvent('.inc', 'click')
const state = await t.next(s => s.count === 1)

t.dispose()
```

## Setup

`renderComponent` works with any JavaScript test runner. With [Vitest](https://vitest.dev/) and the [Sygnal Vite plugin](/integration/bundler-config/), JSX is configured and the dev checks (`sygnal/diagnostics`) are added to the test setup automatically:

```bash
npm install -D vitest
```

```javascript
// vite.config.js
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal()],
})
```

```jsx
// Counter.test.jsx
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import Counter from './Counter.jsx'

describe('Counter', () => {
  let t

  afterEach(() => {
    t?.dispose()
    t = null
  })

  it('increments when the button is clicked', async () => {
    t = renderComponent(Counter, { initialState: { count: 0 } })

    t.simulateEvent('.inc', 'click')
    const state = await t.next(s => s.count === 1)

    expect(state.count).toBe(1)
    expect(t.html()).toContain('1')
    t.expectNoDiagnostics()
  })
})
```

Without the Vite plugin, add `import 'sygnal/diagnostics'` at the top of the test file (or to `test.setupFiles`) to get the dev checks.

## Driving the Component

### simulateEvent

`simulateEvent(selector, eventType, init?)` dispatches a synthetic DOM event through the mock DOM, so the component's real intent streams fire: `DOM.click('.x')`, `DOM.select('.x').events('click')`, `.value()`, `.checked()`, `.data()`, `.key()`.

```jsx
t.simulateEvent('.add', 'click')
t.simulateEvent('.new-todo', 'input', { value: 'Buy milk' })
t.simulateEvent('.done', 'change', { checked: true })
t.simulateEvent('.item', 'click', { dataset: { id: '42' } })
t.simulateEvent('.new-todo', 'keydown', { key: 'Enter' })
t.simulateEvent('document', 'keydown', { key: 'Escape' })   // DOM.select('document') listeners
```

How it works:

- It targets the **first rendered element** that matches `selector`, and bubbles within that element's component scope, like a real event. Events inside a child component (or Collection item) reach the child's intent, not the parent's.
- `event.target.value`, `.checked` and `.dataset` default to what the element renders, and `init` overrides them. `init.value`, `init.checked`, `init.dataset` (alias `init.data`) and `init.key` are shorthands; any other property is copied onto the event.
- If nothing matches yet, the event waits (up to `eventWaitMs`, default 300 ms, re-checked on every render) for a matching element, for example a Collection item that is about to render. It is never sent to every listener with that selector.
- If no element matches, the test **fails** with an error that names the selector, says it matched nothing in the rendered output, and shows the start of `t.html()`. The error rejects the pending `t.next()`, `t.waitForState()` or `t.settle()`. If none is pending, the next `t.*` call or `t.dispose()` throws it. When nothing is queued and the tree is quiet, `simulateEvent` throws it straight away. To drop the event instead (reported as [SYG103](/reference/errors/#syg103), info), pass `{ allowMissing: true }`.
- If the selector only matches inside a child component, Sygnal reports [SYG104](/reference/errors/#syg104): the parent's intent can never see that event.

#### Supported selectors

Selectors are matched against the rendered vnode tree with the same rules as the real DOM:

| Syntax | Example |
|---|---|
| Tag, `*`, `.class`, `#id` | `button.save`, `#main` |
| Attributes: `[attr]`, `[attr="v"]`, `^=`, `$=`, `*=`, `~=` | `.task[data-id="2"]`, `[type=checkbox]` |
| `:first-child`, `:last-child`, `:only-child` | `li:first-child .remove` |
| `:nth-child(an+b)`, `:nth-last-child()`, including `odd` / `even` | `.card:nth-child(3) .next` |
| `:first-of-type`, `:last-of-type`, `:only-of-type`, `:nth-of-type()`, `:nth-last-of-type()` | `p:nth-of-type(2)` |
| `:not(...)` (no combinators inside) | `.item:not(.done)` |
| Descendant (space) and child (`>`) combinators | `.board > .list:nth-child(2) .card:first-child .next` |
| Selector lists (`,`) | `.save, .submit` |

Anything else, such as `:has()`, the `+` and `~` combinators, `:hover` or pseudo-elements, throws an "Unsupported selector syntax" error when you call `simulateEvent`. It is never silently ignored. Positional selectors follow the rendered DOM, so `:nth-child` counts every element sibling, including headings and other elements around a Collection's items. If the position is hard to pin down, give the element an attribute and select that instead, e.g. `[data-id="3"]`.

### simulateAction

`simulateAction(name, data?)` pushes an action into the component under its real name, as if its intent had emitted it. Every sink of the model entry runs (STATE, EVENTS, EFFECT, PARENT, custom drivers), and `next()` follow-ups are dispatched.

```jsx
t.simulateAction('SET_NAME', 'Alice')
t.simulateAction('SUBMIT', { email: 'a@example.com' })
```

Prefer `simulateEvent`: it also tests the intent wiring (the selector, the event type, the value extraction). Use `simulateAction` for actions that don't come from the DOM, such as driver responses.

### Ordering and ready()

`simulateEvent` and `simulateAction` calls are delivered in the order you make them. Calls made before the component has finished subscribing are buffered and replayed, so you can call them right after `renderComponent()`. `await t.ready()` resolves once the component is subscribed and the buffered calls have been delivered.

`ready()` is also a cursor for the `next()` calls that follow it: a `next()` right after `await t.ready()` starts at the moment the component became ready, so it also matches the states the replayed calls produced. Both orders work:

```jsx
t.simulateEvent('.inc', 'click')      // buffered
await t.ready()
await t.next(s => s.count === 1)      // sees the buffered click's state

t.simulateEvent('.inc', 'click')      // buffered
const p = t.next(s => s.count === 1)  // started before ready()
await t.ready()
await p
```

Every `next()` started while the cursor is armed starts there, so `await Promise.all([t.next(a), t.next(b)])` works too. The cursor is used up by `simulateEvent`/`simulateAction`, `waitForState`, `settle`, and by the first of those `next()` calls resolving (a later `next()` starts after the state it returned). If no `next()` uses it before the next macrotask after `ready()` resolves (for example `await t.ready()` followed by `await sleep(10)`, or an un-awaited `t.ready()` in a `beforeEach`), it expires. Calling `ready()` again on a ready component re-arms it at that point.

## Waiting for Results

State updates and re-renders are **asynchronous**: after a `simulate*` call, the new state and DOM arrive a few milliseconds later. Always await one of these before asserting:

| Helper | Resolves with | Use it for |
|---|---|---|
| `t.next(predicate?, timeout?)` | the first state emitted **after the call** that matches | the result of something you just did |
| `t.waitForState(predicate, timeout?)` | the first matching state **in the whole history**, including earlier ones | "has the component ever been in this state?" |
| `t.settle(timeout?)` | nothing | waiting until everything has calmed down |
| `t.ready()` | nothing | waiting for the initial subscription |

Both `next()` and `waitForState()` resolve only once the whole tree, children included, has rendered the matching state, so `t.html()` is up to date when they return. They reject after the timeout (default 2000 ms; the `timeoutMs` option changes it for every wait). The timeout error names any model `next()` follow-up that was scheduled during the wait or is still pending, and, for `next()`, a recorded state that already matched before the call.

### next() vs waitForState()

`waitForState` searches the recorded history, so it can resolve immediately with an old state:

```jsx
t.simulateEvent('.inc', 'click')
await t.next(s => s.count === 1)

t.simulateEvent('.reset', 'click')
await t.waitForState(s => s.count === 0)   // resolves at once with the INITIAL state, before the reset
await t.next(s => s.count === 0)           // waits for the reset
```

Use `next()` for the effect of an action. Call it right after the `simulate*` call, without awaiting anything in between, so the state can't arrive before `next()` starts listening. With no predicate, `next()` resolves with the next state of any kind.

A `next()` right after another wait (with no input in between) starts after the state that wait returned, so `await t.next(a); await t.next(b)` also matches a `b` that arrived while `a` was rendering (a fast reply, a model `next()`).


### settle()

`settle()` resolves once nothing is pending: the component is ready, no simulated input is waiting, and nothing anywhere in the tree has rendered, reduced or changed state for `settleMs` (default 20 ms). Use it before checking that something did **not** happen, or before `expectNoDiagnostics()`:

```jsx
t.simulateEvent('.save', 'click')
await t.settle()
expect(t.emitted).toEqual([])
```

### Timing details

- `next()`, `waitForState()` and `settle()` decide that the tree is quiet when nothing has rendered, reduced or changed state for a short window (10 ms per check for `next`/`waitForState`, `settleMs` = 20 ms for `settle`).
- A model `next('ACTION', data, delay)` follow-up with a delay longer than `settleMs` fires after `settle()` has resolved. Wait for its result with `await t.next(predicate)`, or raise `settleMs` above the delay. If a wait times out first, its error names the follow-up (`next('DONE') scheduled by Saver with a 400ms delay is still pending`) and the `timeoutMs` option.
- Child renders, child sinks and `next()` follow-ups are observed through internal hooks that also run with `diagnostics: 'off'` (which only turns off the reported diagnostics).
- The options `settleMs` (20), `eventWaitMs` (300, how long `simulateEvent` waits for its element) and `timeoutMs` (2000) change these; see [Options](#options).
- The mock DOM finds `<Portal>` content as if it were rendered in place, which is more lenient than a real DOM, where portal content is outside the component's event scope. [`dom: 'real'`](#real-dom) behaves like the browser.

### Fake timers

Tests of `debounce`, `throttle`, `delay`, `xs.periodic` or a model `next('X', data, ms)` don't need to wait out the real delay. `renderComponent` works with Vitest's `vi.useFakeTimers()` (and Jest's modern fake timers):

```jsx
import { it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderComponent } from 'sygnal'
import Search from './Search.jsx'

let t
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  t?.dispose()
  vi.useRealTimers()
})

it('updates the query at once and searches 300 ms after the last keystroke', async () => {
  t = renderComponent(Search)
  await t.ready()                          // mount first, so the input below is timed from here
  for (const q of ['d', 'du', 'dune']) {
    t.simulateEvent('.q', 'input', { value: q })
    await vi.advanceTimersByTimeAsync(50)
  }
  await vi.advanceTimersByTimeAsync(249)   // 299 ms after the last keystroke
  expect(t.state.status).toBe('idle')
  await t.next(s => s.status === 'searching')   // advances the clock to the debounce
  expect(t.html()).toContain('Searching')
})
```

- While fake timers are installed, `ready()`, `next()`, `waitForState()` and `settle()` advance the fake clock themselves, timer by timer, until they resolve, so they never wait in real time. They advance it only as far as they would take in real time: to the timer that produces the state, plus the few milliseconds of the render quiet window.
- Use `vi.advanceTimersByTimeAsync(ms)` (the async form, so promises run between timers) to move the clock by hand, e.g. to check that nothing happened yet. Views render 1 ms after a state change, so read `t.html()` after a `t.next()`/`t.settle()`, not straight after advancing the clock.
- `await t.ready()` before timing-sensitive input: the component mounts in about 15 ms of clock time, and input sent before that is delivered when it is ready.
- Timeouts are clock time too: a wait that never matches fails at once in real time with the usual timeout error. A model `next('X', data, 5000)` needs `t.next(pred, 6000)` (or the `timeoutMs` option), as with real timers.
- Keep the defaults for what is faked: faking `queueMicrotask` or `nextTick` stops the state pipeline. Waits that need real I/O (a real request, a dynamic `import()`) don't progress on a fake clock; test those with real timers.

## Reading Output

| Helper | Returns |
|---|---|
| `t.state` | The latest state (`t.states.at(-1)`), read-only; `undefined` before the first one. Calculated fields in it are current, also after a child component or Collection item changed the state |
| `t.states` | Live array of every state emitted, in order (`t.states[0]` is the initial state) |
| `t.html()` | The latest render, serialized to HTML like the browser's `innerHTML`: text escapes only `&`, `<` and `>` (`Couldn't`, not `Couldn&#39;t`), attribute values only `&` and `"`. It throws if called before the first render, so `await t.ready()` (or a `t.next()`) first; a component that hasn't rendered by then (no state yet) gives `''` |
| `t.emitted` | Live array of `{ type, data }` the component (and its children) put on the EVENTS bus |
| `t.sinkValues(name)` | Live array of values sent to a sink: `'EVENTS'`, `'PARENT'` (the plain value), `'LOG'`, or a custom driver name |
| `t.diagnostics` | Live array of diagnostics reported while rendered |

```jsx
import { event } from 'sygnal'

Counter.model = {
  RESET: {
    STATE:  (state) => ({ ...state, count: 0 }),
    EVENTS: event('COUNTER_RESET', (state) => state.count),
  },
}

// in the test
t.simulateEvent('.inc', 'click')
await t.next(s => s.count === 1)
t.simulateEvent('.reset', 'click')
await t.next(s => s.count === 0)

expect(t.emitted).toEqual([{ type: 'COUNTER_RESET', data: 1 }])
expect(t.html()).toContain('<span class="count">0</span>')
```

A custom sink with no driver (for example `API` when you don't pass an `API` driver) gets a recording no-op driver, for the rendered component and for every child, grandchild and Collection item, so its output is still visible through `sinkValues`:

```jsx
// SaveButton (a child of Editor) has  SAVE: { API: (state) => ({ url: '/save', body: state.text }) }
const t = renderComponent(Editor)
t.simulateEvent('.save', 'click')
await t.settle()
expect(t.sinkValues('API')).toEqual([{ url: '/save', body: 'draft' }])
```

A driver you pass in `drivers` still wins: it receives the values (and `sinkValues` records them once).

### Answering requests: respond() and fail()

The source of a driver you don't pass is a fake you answer from the test, so a component that uses [`makeFetchDriver()`](/guide/http/) (or any `driverFromAsync` driver) needs no driver wiring in tests. The fake **is** `makeFetchDriver()`, run over an in-memory `fetch`: every request it sends stays pending until the test answers it, so `ok` / `error` reply actions, `latest`, `abort`, `timeoutMs`, isolation and `resources` behave exactly as in the app. A request that names `ok` / `error` actions gets its reply as that action, on exactly the component instance that sent it.

```jsx
function Quote({ state }) {
  return <div><button className="get">Get</button><p>{state.text}</p></div>
}
Quote.initialState = { text: '', status: 'idle' }
Quote.intent = ({ DOM }) => ({ LOAD: DOM.click('.get') })
Quote.model = {
  LOAD: {
    STATE: (state) => ({ ...state, status: 'loading' }),
    HTTP: () => ({ url: '/api/quote', ok: 'LOADED', error: 'FAILED' }),
  },
  LOADED: (state, quote) => ({ ...state, status: 'done', text: quote.text }),
  FAILED: (state, { status }) => ({ ...state, status: status === 404 ? 'missing' : 'error' }),
}

it('loads a quote', async () => {
  const t = renderComponent(Quote)
  t.simulateEvent('.get', 'click')
  await t.respond('HTTP', { text: 'Hi' }, 'LOADED')   // resolves once LOADED is reduced and rendered
  expect(t.html()).toContain('Hi')
  expect(t.requests('HTTP')).toEqual([{ url: '/api/quote', ok: 'LOADED', error: 'FAILED' }])

  t.simulateEvent('.get', 'click')
  await t.fail('HTTP', 404)                           // an HTTP status, an Error, or a message
  expect(t.state.status).toBe('missing')
})
```

- `t.respond(name, value, target?)` answers a pending request with a response whose body is `value` (JSON, or text for a string; `{ status: 201 }` sets the status). The driver parses it as it would a server's, so a request with reply actions (`ok: 'LOADED'`) gets the parsed body as its `LOADED` action, and a plain one gets `{ category, value, status, request }` on `select()`. The body goes through JSON, as over the network: a `Date` arrives as a string, and `undefined` as `null`.
- `t.fail(name, error, target?)` fails it. A request with reply actions (`error: 'FAILED'`) gets `{ error, request, status, body }` as its `FAILED` action. A plain one gets `{ error, category, request, status, body }` on `errors()`. A number (or a `status` option) is an HTTP error response: `t.fail('HTTP', 404, { body: { message: 'gone' } })` fails with the driver's `Error('HTTP 404: /api/quote')`, with `status: 404` and the body. An `Error` or a message is a network failure: the fetch rejects with it, and there is no `status`.
- Both return a promise that resolves once the reply action has been reduced and the whole tree has rendered (on the real DOM, once it is in the DOM). `await` it, then assert.

**Which request.** `target` picks the newest pending request that matches it. Matching is by content, never by object identity alone:

| `target` | Matches a request |
|---|---|
| (none) | any (the newest pending one) |
| `'LOADED'` | whose `ok`, `error`, `key` or `category` is `'LOADED'`; also a resource name (`'quote'`) or a URL (`'/api/quotes/2'`) |
| `{ url: '/items/2' }` | whose fields equal these, compared by value (a partial request in its `t.requests` form; also the constant object the model returns) |
| `(request) => request.query.q === 'du'` | for which the predicate is true (it gets the request in its `t.requests` form) |
| `{ request, category, status, body }` | `request` is any of the above, or an element of `t.requests(name)`. Among equal pending requests, that very element is answered. `request: null` pushes a value no request asked for. `category` narrows the match, and `status`/`body` set the reply's |

An object whose keys are all `request`, `category`, `status` or `body` is read as options. Any other object is a request pattern.

**When nothing matches.** `t.respond` and `t.fail` throw at the call, so `expect(() => t.respond('HTTP', [], { query: { q: 'du' } })).toThrow()` asserts that a stale request is no longer pending. The exception is a call made while `simulateEvent`/`simulateAction`/`respond`/`fail` calls are still queued before it, or before the component is ready (a request sent on `BOOTSTRAP`). That call is delivered after them and waits up to 1 s (half of `timeoutMs` if lower) for its request, e.g. after a debounce. If none comes, its promise rejects, and if nothing awaited it, the next wait (`next`, `settle`, ...) fails.

- **Pending** is the driver's own. Each send is its own request, even the same object sent again. A request stops being pending when it is answered, superseded by `latest: true` (or by a newer request for the same resource), aborted (`{ abort: 'LOADED' }`, `{ abort: true, key }`, `{ category, abort: true }`), timed out (`timeoutMs`), or when the instance that sent it is disposed (a removed Collection item).
- **Isolation** is the driver's own. A reply action reaches only its sender, so a parent and a child can both use `ok: 'LOADED'`. Two Collection items can be answered by URL: `t.respond('HTTP', detail, { url: '/items/2' })`. Plain replies keep the scoped `select()`/`errors()` behaviour: each instance sees the replies to its own and its descendants' requests, and the root sees every reply.
- **`t.requests(name)` vs `t.sinkValues(name)`.** `t.requests(name)` is the live list of requests, each as an object: a string request is listed as `{ url }`, so `expect(t.requests('HTTP')[0]).toMatchObject({ url: '/api/quote' })` works for either form, and a resource fetch is listed with its name (below). `t.sinkValues(name)` is every value the sink was sent, as sent: strings, the `{ abort }` commands, and the `{ resources }` and `{ refresh }` values. After a clear that aborts a search, `t.requests('HTTP')` still lists only the search.
- **Timers.** `timeoutMs` runs on the test's timers, so under `vi.useFakeTimers()` a request fails with a `TimeoutError` when the clock passes it, and is no longer pending.
- The fake can't see options given to the real driver in `main.js`: a `makeFetchDriver({ latest: true })` there doesn't apply in tests. Write `latest: true` on the request itself (the canonical form).
- A plain reply that nothing selects fails the test with an explanation (a category typo, or no `errors()` handler for a failure).

### Resources

A component's `resources` static goes to the fake named `HTTP` (`renderComponent(C, { resourceSink: 'API' })` for another name). Each fetch the driver makes for a resource is a pending request, listed in `t.requests('HTTP')` as `{ url, ...request, resource: 'quote' }`. The `{ resources }` declarations and the `{ refresh }` and `{ invalidate }` commands are not requests: they are only in `t.sinkValues('HTTP')`. Answer a fetch by the resource name, its URL, or a partial request:

```jsx
function Quote({ state }) {
  return <p className="status">{state.quote.status === 'success' ? state.quote.data.text : state.quote.status}</p>
}
Quote.initialState = { id: null }
Quote.resources = { quote: (state) => state.id && `/api/quotes/${state.id}` }
Quote.model = { PICK: (state, id) => ({ ...state, id }), REFRESH: { HTTP: { refresh: 'quote' } } }

it('loads the picked quote, and only the latest one', async () => {
  const t = renderComponent(Quote)
  await t.ready()
  expect(t.requests('HTTP')).toEqual([])                  // idle: nothing fetched

  t.simulateAction('PICK', 1)
  t.simulateAction('PICK', 2)
  await t.waitForState((s) => s.id === 2 && s.quote.status === 'loading')
  expect(t.requests('HTTP')).toEqual([
    { url: '/api/quotes/1', resource: 'quote' },
    { url: '/api/quotes/2', resource: 'quote' },
  ])
  expect(() => t.respond('HTTP', { text: 'old' }, '/api/quotes/1')).toThrow()  // superseded
  await t.respond('HTTP', { text: 'Hi' }, 'quote')        // or '/api/quotes/2', or { url: '/api/quotes/2' }
  expect(t.html()).toContain('Hi')

  t.simulateAction('REFRESH')
  await t.waitForState((s) => s.quote.refreshing)       // a refetch keeps status and data
  await t.fail('HTTP', 500, 'quote')
  expect(t.state.quote.error.status).toBe(500)
})
```

A resource's request is derived from state, so it is sent after the state change, not during the event that caused it. `t.respond('HTTP', body, 'quote')` by resource name right after a `simulateEvent` / `simulateAction` that hasn't produced its state yet waits (up to 1 s) for that fetch, so no `await t.settle()` is needed in between. Targeting it by URL or a partial request still needs the fetch to be pending.

`t.states` shows every `RESOURCE` write (`idle`, `loading`, `success`, `error`, with `refreshing` during a refetch), and `ok` / `error` actions on the resource's request run after the write, as in the app. For the cache (`renderComponent(C, { http: { cache: queryCache() } })`, `t.cache`, `t.focus`, `t.online`, `{ prefetch }`), see [Resources and Caching](/guide/resources/#testing).

### Sockets: connections(), push(), drop()

A driverless sink that receives `{ connections }` or `{ to, json }` values (a component written for `makeSocketDriver()`) gets a fake that behaves like the real driver, with in-memory sockets in place of the network. You don't pass an option: the same fake handles HTTP requests and socket values, and a component's `connections` static goes to the fake named `WS` (`renderComponent(C, { socketSink: 'SOCKET' })` for another name). Connections are compared per component and name, so a room switch closes the old connection and opens the new one. `open`, `message`, `close` and `error` reach the sender's actions. Closes the app makes itself never send a `close` action. Events without an action name reach `WS.select(name)`. Reconnects follow the spec's `reconnect` on the test's timers.

```jsx
function Chat({ state }) {
  return <div><p className="status">{state.status}</p><ul>{state.messages.map(m => <li>{m.text}</li>)}</ul></div>
}
Chat.initialState = { room: 'general', status: 'connecting', messages: [] }
Chat.connections = (state) => ({
  room: {
    socket: `/ws/rooms/${state.room}`,
    message: 'RECEIVED', open: 'CONNECTED', close: 'DROPPED',
    reconnect: { delayMs: 1000, maxDelayMs: 1000, jitter: false },
  },
})
Chat.model = {
  SAY: { WS: (state, text) => ({ to: 'room', json: { text } }) },
  RECEIVED: (state, msg) => ({ ...state, messages: [...state.messages, msg] }),
  CONNECTED: (state) => ({ ...state, status: 'online' }),
  DROPPED: (state) => ({ ...state, status: 'reconnecting' }),
}

it('chats, and reconnects after a drop', async () => {
  vi.useFakeTimers()
  const t = renderComponent(Chat)
  await t.push('WS', { text: 'hi' })                 // the server sends a frame (objects as JSON)
  expect(t.html()).toContain('<li>hi</li>')
  expect(t.connections('WS')[0]).toMatchObject({ name: 'room', socket: '/ws/rooms/general', state: 'open' })

  t.simulateAction('SAY', 'hello')
  await t.settle()
  expect(t.sent('WS')).toEqual([{ to: 'room', json: { text: 'hello' } }])

  await t.drop('WS', { code: 1011 })                 // a close the app didn't make
  expect(t.state.status).toBe('reconnecting')
  await vi.advanceTimersByTimeAsync(1000)            // the retry opens
  await t.waitForState(s => s.status === 'online')
})
```

- `t.connections(name)` lists the connections declared now, in order: the spec as declared, plus `name`, `url` (the URL opened: a socket path resolves to `ws:`/`wss:` on the page's host), `state` (`'connecting'`, `'open'` or `'closed'`) and `sender` (the component's name). A removed or replaced connection is not listed. `'closed'` is one that dropped and is waiting for its retry, or one that dropped with `reconnect: false`.
- `t.push(name, data, target?)` sends a frame from the server on the matching open connections, and `message` fires with the data, JSON-parsed when it parses. Objects are sent as JSON. Strings and binary data are sent as they are. For an SSE named event, pass `{ event: 'price', connection? }`.
- `t.drop(name, { code, reason }?, target?)` closes connections the app didn't close. `close` fires with `{ code, reason, willReconnect }` (default code 1006), and the fake reconnects per the spec. Dropping a connection that is still connecting is a failure to open: `error` fires first.
- `t.open(name, target?)` completes a pending open: `open` fires with `{ reconnected }`.
- `t.sent(name, to?)` is the live list of `{ to, json | text | binary }` values the components sent. `t.requests(name)` and `t.sinkValues(name)` keep their meaning: every value, the `{ connections }` ones included.

**Opening.** Connections open by themselves a moment after they are declared, retries included, so a test can `t.push` right away. A `t.push` or `t.drop` made before then opens the connection first. To assert a "Connecting…" state, or to make an open fail, render with `renderComponent(C, { autoConnect: false })`. Connections then stay `'connecting'` until `t.open('WS')`, or until `t.drop('WS')` makes the open fail.

**Which connection.** `target` is a connection name (`'room'`), a URL as declared or opened (`'/ws/rooms/general'`), a partial connection compared by value (`{ socket: '/ws/b' }`), or a predicate `(connection) => boolean`. A call acts on every matching connection. Two Collection items can be told apart by URL, and connections that share a URL share one socket, so one push reaches all of them. With no target, the call acts on the newest connection that can take it.

**When nothing matches.** As with `t.respond`, `t.push`, `t.drop` and `t.open` throw at the call when no connection matches. A push needs an open connection, an open needs a connecting one, and a drop needs either. The same exception applies: a call made while input is still queued, or before the component is ready, waits up to 1 s for its connection. Each call returns a promise that resolves once the resulting actions have been reduced and the tree has rendered.

Disposing a component closes its connections, and `t.dispose()` closes all of them, with no `close` action.

### Routing: navigate(), back(), location

A component that declares `route` needs the app's router: pass the object `makeRouter()` returns as `router`. With no `ROUTER` driver in `drivers`, `renderComponent` runs that router's real driver over an in-memory history, so guards, redirects, `block` and link handling are the driver's own code. The real `window.location` never changes. The history starts at `url` (default `'/'`). Without `router`, a component that declares `route` throws, naming the option.

```jsx
import { renderComponent } from 'sygnal'
import { router } from './routes.js'
import App from './App.jsx'

it('opens a task from the list, and goes back', async () => {
  const t = renderComponent(App, { router, url: '/tasks/2' })
  await t.ready()                                    // the route for url is in the state
  expect(t.html()).toContain('<h1>Beta</h1>')

  await t.navigate('/')                              // as a click on <a href="/">
  t.simulateEvent('li:nth-child(1) a', 'click')      // a real link click, intercepted by the router
  await t.waitForState(s => s.route.name === 'task')
  expect(t.location.path + t.location.search).toBe('/tasks/1?tab=notes')

  await t.back()                                     // the browser's back button
  expect(t.state.route.name).toBe('home')
  await t.navigate({ to: 'task', params: { id: 2 } })
})
```

- `t.navigate(url)` navigates as a click on a link with that `href` would. `t.navigate({ to, params, query?, hash?, replace? })` sends that command. Both go through `{ block }` like the real thing. An unknown route name, a missing param or a URL on another origin throws at the call.
- `t.back()` and `t.forward()` press the browser's buttons: the history moves, and `popstate` fires a task later. A `block` undoes it, as in a browser. They throw when there is no entry to go to.
- `t.location` is `{ path, search, hash, href }` of the in-memory location.
- `t.sent('ROUTER')` lists the commands the components sent (`{ to, params }`, `{ back: true }`, `{ block }`). The `route` declarations aren't listed.
- Links: in the mock DOM, `simulateEvent(selector, 'click')` on an `<a>`, or on an element inside one, also reaches the router's document listener, so the driver decides as it would in a browser. Modified clicks (`{ metaKey: true }`), `target="_blank"`, `download`, `rel="external"`, `data-router-ignore` and other origins are left alone. With `dom: 'real'` the click is a real event that bubbles to the document.
- Each call returns a promise that resolves once the new route has been reduced and the tree has rendered, as `t.respond` does. Fake timers work: `popstate` and the redirect order run on the test's clock.
- Scroll restoration and focus are off by default, so tests stay deterministic. `routerScroll: true` runs the scroll handling, with positions kept in memory. `routerFocus: true` (or a selector string) runs the focus handling, with `dom: 'real'`.

**Head.** With no `HEAD` driver, a fake records what the components declare (`head` statics and `HEAD` sink values). `t.head()` returns the merged result, `{ title, meta, link }`, as `makeHeadDriver` would write it. Pass its `titleTemplate` to apply it:

```jsx
const t = renderComponent(App, { router, titleTemplate: '%s · Tasks' })
await t.ready()
expect(t.head().title).toBe('All tasks · Tasks')
await t.navigate({ to: 'task', params: { id: 2 } })
expect(t.head()).toEqual({ title: 'Task 2 · Tasks', meta: { description: 'Details of task 2' }, link: [] })
```

## Diagnostics in Tests

While a component is rendered, diagnostics are collected (`'collect'` mode by default, or the current mode if diagnostics are already on). Error-severity messages are still printed.

- `t.expectNoDiagnostics()` throws, with the formatted messages, if any warning or error was collected. Call it at the end of a test (after `settle()` or `next()`).
- `t.diagnostics` lists everything collected, info included.
- `renderComponent(C, { diagnostics: 'error' })` makes every warning throw instead.
- `renderComponent(C, { strict: true })` turns on the [strict-mode](/guide/strict-mode/) runtime checks (SYG501, SYG502, SYG504) for this render.

```jsx
const t = renderComponent(TodoList, { strict: true })
t.simulateEvent('.add', 'click')
await t.settle()
t.expectNoDiagnostics()
```

The previous diagnostics mode and strict setting are restored when the last rendered component is disposed. Each `renderComponent` call starts with fresh dedupe state, so a finding reported in one test is reported again in the next.

Two DOM checks are built into `renderComponent` itself, because the real-DOM versions can't run on the mock DOM: SYG104 (a selector that only matches inside a child) and SYG103 (a `simulateEvent(..., { allowMissing: true })` selector that matches nothing; without `allowMissing` the test fails instead). The other checks need `sygnal/diagnostics` (added by the Vite plugin under Vitest, or imported by you).

## inspect

`t.inspect()` returns the [app graph](/guide/diagnostics/#inspect) of the rendered tree: every component instance, its actions and sinks, its state keys, the EVENTS it emitted and selected, and, for each intent selector, whether it matched an element in the latest render (`matched`) or only inside a child (`isolationHit`). It needs `sygnal/diagnostics`.

```jsx
const graph = t.inspect()
const root = graph.components[0]
root.selectors   // [{ selector: '.inc', events: ['click'], matched: true, isolationHit: null }, …]
root.actions     // [{ name: 'INC', trigger: 'intent', sinks: ['STATE'] }, …]
```

When an event "does nothing" in a test, `t.inspect()` usually shows why: a selector with `matched: false`, or an action with `sinks: []`.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `initialState` | `any` | the component's `.initialState` | Initial state for the render |
| `drivers` | `object` | `{}` | Extra drivers beyond DOM, EVENTS, STATE and LOG |
| `diagnostics` | `'off' \| 'collect' \| 'warn' \| 'error'` | `'collect'` (or the current mode) | Diagnostics mode while rendered |
| `strict` | `boolean` | unchanged | Strict-mode runtime checks while rendered |
| `mockConfig` | `object` | `{}` | Extra mock DOM event streams, by selector (see below) |
| `timeoutMs` | `number` | `2000` | Default timeout of `next()`, `waitForState()` and `settle()` |
| `settleMs` | `number` | `20` | `settle()`'s quiet window: how long nothing may happen before it resolves (at most `timeoutMs`) |
| `eventWaitMs` | `number` | `300` | How long `simulateEvent` waits for a matching element (and its listeners) |
| `dom` | `'mock' \| 'real'` | `'mock'` | `'real'` mounts into a real container element; see [Real DOM](#real-dom) |
| `autoConnect` | `boolean` | `true` | Fake socket connections open by themselves; `false` holds them until `t.open()` (see [Sockets](#sockets-connections-push-drop)) |
| `socketSink` | `string` | `'WS'` | The driverless sink that receives the components' `connections` static; created even when no model entry names it (a read-only SSE component). Pass a driver under this name in `drivers` to use a real one |
| `resourceSink` | `string` | `'HTTP'` | The driverless sink that receives the components' `resources` static (see [Resources](#resources)) |
| `http` | `object` | — | Options for the HTTP fakes' `makeFetchDriver()` (all but `fetch`), e.g. `{ cache: queryCache() }` or `{ retry: 2 }` ([Resources and Caching](/guide/resources/#testing)) |
| `router` | `Router` | none | The app's router (`makeRouter()`'s result): runs its driver over an in-memory history (see [Routing](#routing-navigate-back-location)). Required when a component declares `route` |
| `url` | `string` | `'/'` | The router fake's start URL |
| `routerSink` | `string` | `'ROUTER'` | The sink the router fake serves |
| `routerScroll`, `routerFocus` | `boolean` (`routerFocus`: or selectors) | `false` | Run the router's scroll restoration / focus handling |
| `headSink` | `string` | `'HEAD'` | The sink the HEAD fake serves (`t.head()`) |
| `titleTemplate` | `string` | none | The HEAD fake's title template (`'%s · App'`) |

The timing options (and a timeout passed to `next()`, `waitForState()` or `settle()`) must be finite numbers of milliseconds from 0 to 2147483647 (`setTimeout`'s limit); anything else throws.

## Result

| Property | Type | Description |
|----------|------|-------------|
| `simulateEvent` | `(selector, type, init?) => void` | Dispatch a DOM event through the mock DOM |
| `simulateAction` | `(name, data?) => void` | Push an action under its real name |
| `ready` | `() => Promise<void>` | Resolves once subscribed and buffered calls are delivered; the next `next()` starts there |
| `next` | `(predicate?, timeout?) => Promise<state>` | Next matching state after the call |
| `waitForState` | `(predicate, timeout?) => Promise<state>` | First matching state, history included |
| `settle` | `(timeout?) => Promise<void>` | Resolves once nothing is pending |
| `state` | `any` (read-only) | The latest state |
| `states` | `any[]` | Every state emitted |
| `html` | `() => string` | Latest render as HTML (throws before the first render) |
| `emitted` | `{ type, data }[]` | EVENTS emissions |
| `sinkValues` | `(sink) => any[]` | Values sent to a sink |
| `requests` | `(sink) => any[]` | Requests sent to a sink, as objects (a string is `{ url }`, a resource fetch has `resource`); no `{ abort }`, `{ resources }`, `{ refresh }` or `{ invalidate }` values |
| `cache` | `(sink) => FakeCacheEntry[]` | The cache entries of an HTTP fake (`{ key, age, stale, subscribers, data, tags }`; with the `http: { cache: queryCache() }` option; `[]` without) |
| `focus`, `online` | `() => void` | The window regains focus / the browser comes back online (queued like `simulate*`): stale mounted resources refetch when the cache is on |
| `respond` | `(sink, value, target?) => Promise<void>` | Answer the newest pending request matching `target` on the fake source (its `ok` action, or `select()`); throws if none is pending |
| `fail` | `(sink, error, target?) => Promise<void>` | Fail it (its `error` action, or `errors()`); throws if none is pending |
| `connections` | `(sink) => FakeConnection[]` | The connections declared on a fake socket sink (`name`, `url`, `state`, `sender`, the spec) |
| `push`, `drop`, `open` | `(sink, …, target?) => Promise<void>` | Server frame, unexpected close, completed open on the matching connections; throw if none matches |
| `sent` | `(sink, to?) => any[]` | The `{ to, json \| text \| binary }` values sent; for the router's sink, the commands sent |
| `navigate` | `(url \| { to, params }) => Promise<void>` | Router fake: navigate as a link click or a command (through `block`); throws for an unknown route |
| `back`, `forward` | `() => Promise<void>` | Router fake: the browser's back and forward buttons |
| `location` | `{ path, search, hash, href }` | Router fake: the in-memory location |
| `head` | `() => { title, meta, link }` | HEAD fake: the merged head the components declare |
| `diagnostics` | `Diagnostic[]` | Diagnostics collected while rendered |
| `expectNoDiagnostics` | `() => void` | Throws if any warning or error was collected |
| `inspect` | `() => InspectGraph` | The app graph of the rendered tree |
| `state$`, `dom$` | `Stream` | Live state and VNode streams |
| `events$` | `EventsSource` | The event bus source (`.select(type)`) |
| `sinks`, `sources` | `object` | All sink streams and source objects |
| `dispose` | `() => void` | Tear down the tree (fires `DISPOSE`) and restore the diagnostics settings |
| `query`, `queryAll` | `(selector) => Element \| null`, `Element[]` | `dom: 'real'` only: real elements of the rendered tree |
| `container` | `Element \| null` | `dom: 'real'`: the mount element (`null` with the mock DOM) |

## Mock DOM Streams

`mockConfig` maps selectors to event streams, for event sources you want to control as streams rather than with `simulateEvent`:

```jsx
import { xs } from 'sygnal'

const t = renderComponent(Counter, {
  mockConfig: {
    '.inc': { click: xs.of({}, {}) },   // two clicks, as soon as the intent subscribes
  },
})

await t.waitForState(s => s.count === 2)
```

## Real DOM

The mock DOM has no elements, so it can't tell you whether a checkbox is really checked, what an input really holds, whether a button is disabled, or where focus is. For that, pass `dom: 'real'`: the tree is patched into a real container element by the same DOM driver `run()` uses, and the rest of the `t.*` API stays the same. It needs a DOM in the test environment (`npm install -D jsdom`, then `// @vitest-environment jsdom` at the top of the file, or `test.environment: 'jsdom'`; `happy-dom` works too).

```jsx
// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import Signup from './Signup.jsx'

let t
afterEach(() => t?.dispose())

it('keeps the real fields when going back', async () => {
  t = renderComponent(Signup, { dom: 'real' })
  t.simulateEvent('input[name="email"]', 'input', { value: 'ada@example.com' })
  t.simulateEvent('input[value="team"]', 'click')    // a real click: the radio gets checked, change fires
  await t.next(s => s.plan === 'team')
  expect(t.query('input[name="plan"]:checked').value).toBe('team')
  expect(t.query('input[name="email"]').value).toBe('ada@example.com')
  expect(t.query('.next').disabled).toBe(false)
})
```

What changes with `dom: 'real'`:

- `simulateEvent(selector, type, init?)` dispatches a real DOM event on the first element matching `selector` (any CSS selector the DOM supports, `:has()`, `+` and `:checked` included). `init.value` / `init.checked` / `init.dataset` are set on the element first, so `{ value }` is like typing. A plain `'click'` runs the browser's default action (a checkbox or radio toggles and fires `change`; a click on a disabled control does nothing). `'focus'` and `'blur'` move `document.activeElement`. Events travel through the real event delegation and isolation, so Portal content outside the component is reached only by `DOM.select('document')` listeners, as in the browser.
- Each event waits until every state so far is rendered into the DOM and the tree has been quiet for 10 ms, like a user who acts on what is on the screen: a button that the previous input enabled is enabled when it is clicked.
- `t.query(selector)` returns the first matching element (or `null`) and `t.queryAll(selector)` all of them, searching the rendered tree and the Portal content it mounted. Before the first render is in the DOM they throw (`await t.ready()` first). `t.container` is the mount element. Refs (`createRef()`) point at the real elements.
- Every wait resolves once its state is in the DOM: `ready()` after the first render, `next()` and `waitForState()` after the matching state's render, `settle()` after the latest one. If a later state arrives meanwhile (a fast response, a model `next()`), its render is held back until the code after your `await` has run, so `t.query()` there reads the state the wait returned. A `next()` right after another wait (with no input in between) also matches such a later state:

```jsx
t.simulateEvent('input[name="zip"]', 'input', { value: '62704' })
await t.next(s => s.status === 'Looking up…')
expect(t.query('.zip-status').textContent).toBe('Looking up…')   // even if the reply is already in
await t.next(s => s.city === 'Springfield')                       // matches the reply's state
expect(t.query('input[name="city"]').value).toBe('Springfield')
```

  A state that is replaced before it ever renders (views render a few milliseconds after a change) never reaches the DOM, as in a browser; to see an in-flight state, answer the request yourself (`t.respond`, or a `fetch` stub you resolve later).
- `t.html()`, `t.states`, `t.state`, `sinkValues()`, `expectNoDiagnostics()` and `inspect()` work as with the mock DOM. With `sygnal/diagnostics` loaded, its real-DOM SYG103/SYG104 checks run.
- `dispose()` unmounts the container. `mockConfig` can't be combined with `dom: 'real'`.

Use the mock DOM (the default) for logic and output, and `dom: 'real'` when a test asserts on real element state or focus. One suite is enough; there is no need for a second `run()`-based suite.

## Cleanup

Always call `dispose()` when a test is done, for example in `afterEach`. It disposes the whole tree (children's `DISPOSE` actions run), removes listeners, and restores the diagnostics mode and strict setting. A wait still pending (`ready`, `next`, `waitForState`, `settle`) rejects with "renderComponent was disposed", also under fake timers, so await every wait before disposing.
