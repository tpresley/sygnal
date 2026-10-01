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
- If nothing matches yet, the event waits (up to 300 ms, re-checked on every render) for a matching element, for example a Collection item that is about to render. If none appears, it is dropped and reported as [SYG103](/reference/errors/#syg103). It is never sent to every listener with that selector.
- If the selector only matches inside a child component, Sygnal reports [SYG104](/reference/errors/#syg104): the parent's intent can never see that event.

### simulateAction

`simulateAction(name, data?)` pushes an action into the component under its real name, as if its intent had emitted it. Every sink of the model entry runs (STATE, EVENTS, EFFECT, PARENT, custom drivers), and `next()` follow-ups are dispatched.

```jsx
t.simulateAction('SET_NAME', 'Alice')
t.simulateAction('SUBMIT', { email: 'a@example.com' })
```

Prefer `simulateEvent`: it also tests the intent wiring (the selector, the event type, the value extraction). Use `simulateAction` for actions that don't come from the DOM, such as driver responses.

### Ordering and ready()

`simulateEvent` and `simulateAction` calls are delivered in the order you make them. Calls made before the component has finished subscribing are buffered and replayed, so you can call them right after `renderComponent()`. `await t.ready()` resolves once the component is subscribed and the buffered calls have been delivered.

## Waiting for Results

State updates and re-renders are **asynchronous**: after a `simulate*` call, the new state and DOM arrive a few milliseconds later. Always await one of these before asserting:

| Helper | Resolves with | Use it for |
|---|---|---|
| `t.next(predicate?, timeout?)` | the first state emitted **after the call** that matches | the result of something you just did |
| `t.waitForState(predicate, timeout?)` | the first matching state **in the whole history**, including earlier ones | "has the component ever been in this state?" |
| `t.settle(timeout?)` | nothing | waiting until everything has calmed down |
| `t.ready()` | nothing | waiting for the initial subscription |

Both `next()` and `waitForState()` resolve only once the whole tree, children included, has rendered the matching state, so `t.html()` is up to date when they return. They reject after the timeout (default 2000 ms).

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

Calls buffered before `ready()` may already have been applied when `ready()` resolves; check those with `waitForState()` (or `t.states`), not with a `next()` started afterwards.

### settle()

`settle()` resolves once nothing is pending: the component is ready, no simulated input is waiting, and nothing anywhere in the tree has rendered, reduced or changed state for 20 ms. Use it before checking that something did **not** happen, or before `expectNoDiagnostics()`:

```jsx
t.simulateEvent('.save', 'click')
await t.settle()
expect(t.emitted).toEqual([])
```

### Timing details

- `next()`, `waitForState()` and `settle()` decide that the tree is quiet when nothing has rendered, reduced or changed state for a short window (10 ms per check for `next`/`waitForState`, 20 ms for `settle`). A `next(action, data, delay)` follow-up with a delay longer than about 20 ms isn't seen as pending: wait for its result with `next(predicate)`.
- Child renders are observed through the diagnostics hooks. With `diagnostics: 'off'` the helpers can't see them and fall back to waiting up to 250 ms.
- These windows (and the 300 ms wait for a missing element) aren't configurable.
- The mock DOM finds `<Portal>` content as if it were rendered in place, which is more lenient than a real DOM, where portal content is outside the component's event scope.

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

A sink named in the rendered component's own model that has no driver (for example `API` when you don't pass an `API` driver) gets a no-op driver, so its output is still visible through `sinkValues`. For a custom sink that only a **child** uses, pass a driver for it in `drivers`; otherwise the child's values don't show up. To feed responses back in, give the driver a source, or push the response action with `simulateAction`.

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

Two DOM checks are built into `renderComponent` itself, because the real-DOM versions can't run on the mock DOM: SYG104 (a selector that only matches inside a child) and SYG103 (a `simulateEvent` selector that matches nothing). The other checks need `sygnal/diagnostics` (added by the Vite plugin under Vitest, or imported by you).

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

## Result

| Property | Type | Description |
|----------|------|-------------|
| `simulateEvent` | `(selector, type, init?) => void` | Dispatch a DOM event through the mock DOM |
| `simulateAction` | `(name, data?) => void` | Push an action under its real name |
| `ready` | `() => Promise<void>` | Resolves once subscribed and buffered calls are delivered |
| `next` | `(predicate?, timeout?) => Promise<state>` | Next matching state after the call |
| `waitForState` | `(predicate, timeout?) => Promise<state>` | First matching state, history included |
| `settle` | `(timeout?) => Promise<void>` | Resolves once nothing is pending |
| `states` | `any[]` | Every state emitted |
| `html` | `() => string` | Latest render as HTML |
| `emitted` | `{ type, data }[]` | EVENTS emissions |
| `sinkValues` | `(sink) => any[]` | Values sent to a sink |
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
