---
title: "Testing"
description: "Test Sygnal components in isolation with renderComponent"
---

`renderComponent()` renders a Sygnal component in isolation with a minimal runtime — mocked DOM, event bus, and state drivers. No browser or build step required.

```jsx
import { renderComponent } from 'sygnal'

const t = renderComponent(Counter, {
  initialState: { count: 0 },
})

t.simulateAction('INCREMENT')
await t.waitForState(s => s.count === 1)

t.dispose()
```

## Setup

`renderComponent` works with any JavaScript test runner. With [Vitest](https://vitest.dev/):

```bash
npm install -D vitest
```

```javascript
// counter.test.js
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import Counter from './Counter.jsx'

describe('Counter', () => {
  let t

  afterEach(() => {
    if (t) { t.dispose(); t = null }
  })

  it('increments on INCREMENT action', async () => {
    t = renderComponent(Counter, { initialState: { count: 0 } })
    await new Promise(r => setTimeout(r, 60))  // let streams settle

    t.simulateAction('INCREMENT')
    const state = await t.waitForState(s => s.count === 1)

    expect(state.count).toBe(1)
  })
})
```

## API

### renderComponent(component, options?)

| Parameter | Type | Description |
|-----------|------|-------------|
| `component` | `Function` | A Sygnal component function with `.intent`, `.model`, etc. |
| `options` | `RenderOptions` | Optional configuration (see below) |

### RenderOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `initialState` | `any` | Component's `.initialState` | Override the component's initial state |
| `mockConfig` | `object` | `{}` | Mock DOM events — maps selectors to event streams |
| `drivers` | `object` | `{}` | Additional drivers beyond the defaults (DOM, EVENTS, STATE, LOG) |

### RenderResult

| Property | Type | Description |
|----------|------|-------------|
| `state$` | `Stream<any>` | Live stream of state values |
| `dom$` | `Stream<any>` | Live stream of rendered VNode trees |
| `events$` | `EventsSource` | Event bus source — call `.select(type)` to filter |
| `sinks` | `object` | All driver sink streams |
| `sources` | `object` | All driver source objects |
| `states` | `any[]` | Collected state values — grows as new states are emitted |
| `simulateAction` | `(name, data?) => void` | Push an action into the intent→model pipeline |
| `waitForState` | `(predicate, timeout?) => Promise` | Resolve when state matches, reject on timeout |
| `dispose` | `() => void` | Tear down the component and clean up listeners |

## simulateAction

Push an action directly into the component's model, as if it came from intent:

```jsx
// Plain state reducer
t.simulateAction('INCREMENT')

// With data
t.simulateAction('SET_NAME', 'Alice')

// Works with object-style model entries
// model = { SUBMIT: { STATE: ..., EFFECT: ... } }
t.simulateAction('SUBMIT', formData)

// Works with shorthand entries
// model = { 'NOTIFY | EVENTS': (state) => ({ type: 'alert', data: state.msg }) }
t.simulateAction('NOTIFY')
```

`simulateAction` handles all model entry formats — plain reducers, object-style multi-sink entries (STATE, EFFECT, etc.), and `'ACTION | DRIVER'` shorthand. EFFECT handlers with `next()` dispatch follow-up actions automatically.

## waitForState

Wait for the component's state to satisfy a predicate. Returns a promise that resolves with the matching state:

```jsx
// Wait for a specific value
const state = await t.waitForState(s => s.count === 5)
expect(state.count).toBe(5)

// Custom timeout (default is 2000ms)
await t.waitForState(s => s.loaded, 5000)
```

If the predicate already matches a previously-emitted state, `waitForState` resolves immediately. If no match is found before the timeout, the promise rejects.

## Mock DOM Events

Use `mockConfig` to simulate DOM events that drive the component's intent:

```jsx
import xs from 'xstream'

function Counter({ state }) {
  return <button className="inc">{state.count}</button>
}

Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({
  INCREMENT: DOM.select('.inc').events('click'),
})
Counter.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
}

// The mock click fires immediately, triggering INCREMENT
const t = renderComponent(Counter, {
  mockConfig: {
    '.inc': { click: xs.of({}) },
  },
})

await t.waitForState(s => s.count === 1)
```

The `mockConfig` format mirrors Sygnal's `DOM.select().events()` pattern: keys are CSS selectors, values are objects mapping event types to xstream streams.

## Inspecting State

The `states` array collects every state value the component emits, in order:

```jsx
const t = renderComponent(Counter, { initialState: { count: 0 } })
await new Promise(r => setTimeout(r, 60))

t.simulateAction('INCREMENT')
await new Promise(r => setTimeout(r, 60))

t.simulateAction('INCREMENT')
await new Promise(r => setTimeout(r, 60))

// states[0] is the initial state
expect(t.states[0]).toEqual({ count: 0 })
// Last state reflects all actions
expect(t.states[t.states.length - 1]).toEqual({ count: 2 })
```

## Testing EFFECT Handlers

`simulateAction` executes EFFECT handlers and supports `next()` for dispatching follow-up actions:

```jsx
function Router({ state }) {
  return <div>{state.result}</div>
}

Router.initialState = { mode: 'a', result: 'none' }
Router.intent = ({ DOM }) => ({
  ROUTE: DOM.select('.btn').events('click'),
})
Router.model = {
  ROUTE: {
    EFFECT: (state, data, next) => {
      if (state.mode === 'a') next('DO_A')
      else next('DO_B')
    },
  },
  DO_A: (state) => ({ ...state, result: 'routed-to-A' }),
  DO_B: (state) => ({ ...state, result: 'routed-to-B' }),
}

const t = renderComponent(Router)
await new Promise(r => setTimeout(r, 60))

t.simulateAction('ROUTE')
const state = await t.waitForState(s => s.result === 'routed-to-A')
expect(state.result).toBe('routed-to-A')

t.dispose()
```

## Cleanup

Always call `dispose()` when you're done. In Vitest, use `afterEach`:

```jsx
describe('MyComponent', () => {
  let t

  afterEach(() => {
    if (t) { t.dispose(); t = null }
  })

  it('does something', async () => {
    t = renderComponent(MyComponent, { initialState: { ... } })
    // ...
  })
})
```
