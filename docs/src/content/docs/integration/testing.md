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

Every `next()` started while the cursor is armed starts there, so `await Promise.all([t.next(a), t.next(b)])` works too. The cursor is used up by `simulateEvent`/`simulateAction`, `waitForState`, `settle`, and by the first of those `next()` calls resolving (a later `next()` waits for a new state). If no `next()` uses it before the next macrotask after `ready()` resolves (for example `await t.ready()` followed by `await sleep(10)`, or an un-awaited `t.ready()` in a `beforeEach`), it expires. Calling `ready()` again on a ready component re-arms it at that point.

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
- The mock DOM finds `<Portal>` content as if it were rendered in place, which is more lenient than a real DOM, where portal content is outside the component's event scope.

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
  expect(t.states.at(-1).status).toBe('idle')
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
| `t.states` | Live array of every state emitted, in order (`t.states[0]` is the initial state) |
| `t.html()` | The latest render, serialized to HTML (`''` before the first render) |
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

The source of a driver you don't pass is a fake you answer from the test, so a component that uses [`makeFetchDriver()`](/guide/drivers/#http-requests-with-makefetchdriver) (or any `driverFromAsync` driver) needs no driver wiring in tests:

```jsx
// Quote: LOAD: { HTTP: () => ({ category: 'quote', url: '/api/quote' }) },
//        LOADED: HTTP.select('quote'), FAILED: HTTP.errors('quote')
const t = renderComponent(Quote)
t.simulateEvent('.get', 'click')
t.respond('HTTP', { text: 'Hi', author: 'Me' })
await t.next(s => s.text === 'Hi — Me')
expect(t.requests('HTTP')).toEqual([{ category: 'quote', url: '/api/quote' }])

t.simulateEvent('.get', 'click')
t.fail('HTTP', 404)                   // an HTTP status, an Error, or a message
await t.next(s => s.error !== '')
```

- `t.requests(name)` is the live list of values sent to the sink (an alias of `sinkValues`).
- `t.respond(name, value, opts?)` answers the most recent pending request and delivers `{ category, value, status: 200, request }` on `select()`. It is delivered in order with `simulateEvent`/`simulateAction` calls and waits up to 1 s (half of `timeoutMs` if lower) for the component to send a request, e.g. after a debounce.
- `t.fail(name, error, opts?)` delivers `{ error, category, request, status, body }` on `errors()`. A number is an HTTP status: `t.fail('HTTP', 404)` fails with `Error('HTTP 404')` and `status: 404`.
- `opts`: a category string, or `{ category, request, status, body }`. `request` picks an exact element of `t.requests(name)`; `request: null` pushes a value no request asked for.
- The fake follows `latest: true` and `{ category, abort: true }` like the real driver: a superseded or cancelled request is no longer pending, and answering it explicitly delivers nothing.
- The test fails with an explanation when no request is pending, or when nothing selects the reply (a category typo, or no `errors()` handler for a failure).

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
| `states` | `any[]` | Every state emitted |
| `html` | `() => string` | Latest render as HTML |
| `emitted` | `{ type, data }[]` | EVENTS emissions |
| `sinkValues` | `(sink) => any[]` | Values sent to a sink |
| `requests` | `(sink) => any[]` | Requests sent to a driverless sink (alias of `sinkValues`) |
| `respond` | `(sink, value, opts?) => void` | Answer the latest pending request on the fake source (`select()`) |
| `fail` | `(sink, error, opts?) => void` | Fail the latest pending request on the fake source (`errors()`) |
| `diagnostics` | `Diagnostic[]` | Diagnostics collected while rendered |
| `expectNoDiagnostics` | `() => void` | Throws if any warning or error was collected |
| `inspect` | `() => InspectGraph` | The app graph of the rendered tree |
| `state$`, `dom$` | `Stream` | Live state and VNode streams |
| `events$` | `EventsSource` | The event bus source (`.select(type)`) |
| `sinks`, `sources` | `object` | All sink streams and source objects |
| `dispose` | `() => void` | Tear down the tree (fires `DISPOSE`) and restore the diagnostics settings |

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

## Testing a Whole App in jsdom

To test the app as it runs in the browser (real DOM, real isolation), mount it with `run()` in a jsdom environment (`npm install -D jsdom`) and dispatch real DOM events:

```jsx
// @vitest-environment jsdom
import { it, expect } from 'vitest'
import { run } from 'sygnal'
import App from './App.jsx'

it('adds a todo', async () => {
  document.body.innerHTML = '<div id="root"></div>'
  const app = run(App, {}, { mountPoint: '#root', diagnostics: 'error' })
  await new Promise(r => setTimeout(r, 50))

  const input = document.querySelector('.new-todo')
  input.value = 'Write docs'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  document.querySelector('.add').click()
  await new Promise(r => setTimeout(r, 50))

  expect(document.querySelectorAll('li')).toHaveLength(1)
  app.dispose()
})
```

## Cleanup

Always call `dispose()` when a test is done, for example in `afterEach`. It disposes the whole tree (children's `DISPOSE` actions run), removes listeners, and restores the diagnostics mode and strict setting.
