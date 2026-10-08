---
title: Timers
description: Intervals, timeouts and animation frames declared from state with the timers static and makeTimerDriver()
---

A component declares the timers it needs as a function of its state, and gets each tick as one of its own actions. There is no `setInterval` to start or clear: while `state.running` is true the tick runs, and when it turns false the timer stops.

```jsx
Stopwatch.timers = (state) => ({
  tick: state.running && { every: 100, action: 'TICK' },
})
```

## Setup

Timers are run by `makeTimerDriver()`, which you register when you start the app:

```jsx
import { run, makeTimerDriver } from 'sygnal'
import App from './App.jsx'

run(App, { TIMER: makeTimerDriver() })
```

The key is yours to choose (`TIMER` by convention): Sygnal finds the driver by the `timers` static it takes, not by its name. One driver serves every component of the app. A component that declares `timers` in an app without the driver gets [SYG643](/reference/errors/#syg643) in development, since nothing would ever fire.

## The timers static

`timers` takes the state (with its calculated fields) and returns an object of named timers. Each value is a timer spec, or a falsy value for "not now":

```jsx
Game.timers = (state) => ({
  tick: state.running && { every: 100, action: 'TICK' },
  done: state.armed && { after: 5000, action: 'EXPIRE' },
  frame: state.animating && { frame: 'FRAME' },
})
```

| Spec | Runs | Action data |
|---|---|---|
| `{ every: ms, action }` | Every `ms` milliseconds (a positive number) | `{ n, t }`: the tick number from 1, and `Date.now()` |
| `{ after: ms, action }` | Once, `ms` milliseconds (0 or more) after it is declared | `{ t }`: `Date.now()` |
| `{ frame: 'ACTION' }` | Every animation frame (`requestAnimationFrame`; every 16 ms where there is none) | `{ t, dt }`: `Date.now()`, and the milliseconds since the previous frame (0 on the first) |

Any spec can add `background: true` (see [hidden pages](#hidden-pages)). The action is one of the component's own actions: it goes to the instance that declared the timer, and every sink of its model entry runs, as for an intent action.

Sygnal compares the result with the previous one, name by name, whenever the state changes:

- a new name starts its timer;
- a name that is gone, or now falsy, stops its timer;
- a spec that changed (another interval, another action) restarts its timer;
- a spec that is the same as before keeps running, even though the function returned a new object.

So `timers` is a description, not a command: return what should be running now. An `after` timer fires once; it doesn't fire again while the same spec stays declared. Make it falsy (and then declared again) to arm it once more.

### Ticks don't drift

An `every` timer schedules each tick from the moment it started, not from the previous tick: tick `n` is due at start + n × `every`. A late tick doesn't push the later ones back, so 1,000 ticks of 100 ms end 100 s after the start. Use the `t` in the data (or `Date.now()` in the intent) for elapsed time rather than counting ticks.

When a tick comes very late (a browser throttles timers in a background tab), the missed ticks are not delivered one by one: they are coalesced into the next one, and `n` jumps over them.

## A stopwatch

The stopwatch keeps the clock time it started at and adds up the finished runs, so it is exact however late a tick comes. The tick only moves `now`, which the view reads. It stops when the stopwatch pauses, resets or is removed:

```jsx live
const pad = (n) => String(n).padStart(2, '0')
const format = (ms) => {
  const tenths = Math.floor(ms / 100)
  return `${pad(Math.floor(tenths / 600))}:${pad(Math.floor(tenths / 10) % 60)}.${tenths % 10}`
}

// the running time at clock time `at`: the finished runs plus the current one
const elapsed = (state, at) => state.done + (state.status === 'running' ? at - state.since : 0)

export function Stopwatch({ state }) {
  const label = { idle: 'Start', running: 'Pause', paused: 'Resume' }[state.status]
  return (
    <section className="stopwatch">
      <p className="time">{format(elapsed(state, state.now))}</p>
      <button className="toggle">{label}</button>
      <button className="lap" disabled={state.status !== 'running'}>Lap</button>
      <button className="reset" disabled={state.status !== 'paused'}>Reset</button>
      <ol className="laps">
        {state.laps.map((lap, i) => <li>{`Lap ${i + 1}: ${format(lap)}`}</li>)}
      </ol>
    </section>
  )
}

const INITIAL = { status: 'idle', done: 0, since: 0, now: 0, lapStart: 0, laps: [] }

Stopwatch.initialState = INITIAL
// a tick every 100 ms while running; stopped when it pauses, resets or unmounts
Stopwatch.timers = (state) => ({ tick: state.status === 'running' && { every: 100, action: 'TICK' } })
Stopwatch.intent = ({ DOM }) => ({
  TOGGLE: DOM.click('.toggle').map(() => Date.now()),
  LAP: DOM.click('.lap').map(() => Date.now()),
  RESET: DOM.click('.reset'),
})
Stopwatch.model = {
  TOGGLE: (state, at) => state.status === 'running'
    ? { ...state, status: 'paused', done: elapsed(state, at), now: at }
    : { ...state, status: 'running', since: at, now: at },
  TICK: (state, { t }) => ({ ...state, now: t }),
  LAP: (state, at) => {
    const total = elapsed(state, at)
    return { ...state, now: at, laps: [...state.laps, total - state.lapStart], lapStart: total }
  },
  RESET: () => INITIAL,
}
```

## Hidden pages

A component on a hidden [Switchable](/guide/switchable/) page keeps its state, but its timers stop while the page is hidden. When the page is shown again they start from scratch: an `every` timer counts from 1 again, and an `after` timer waits its whole delay. A timer that should go on in the background says so:

```jsx
Inbox.timers = () => ({
  // keeps checking for new mail while another page is shown
  poll: { every: 30000, action: 'CHECK_MAIL', background: true },
})
```

When a component is removed, its timers stop; when the app is disposed, all of them do.

## Server rendering

Drivers don't run during `renderToString`, so no timer starts on the server. The view renders the initial state, and the timers start in the browser after hydration.

## Testing

`renderComponent` runs the real timer driver for you (no `drivers` option needed), on whatever clock the test uses. With Vitest's fake timers, `vi.advanceTimersByTimeAsync(ms)` moves time forward and the timers fire as they would. `t.timers()` lists the timers running now, each as its spec plus `name`, `action` and `component`:

```jsx
// @vitest-environment jsdom
import { it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from 'sygnal'
import { Stopwatch } from './Stopwatch.jsx'

let t
afterEach(() => {
  t?.dispose()
  vi.useRealTimers()
})

it('ticks while running and stops when paused', async () => {
  vi.useFakeTimers()
  t = renderComponent(Stopwatch)
  await t.ready()
  expect(t.timers()).toEqual([])

  t.simulateEvent('.toggle', 'click')
  await t.next(s => s.status === 'running')
  expect(t.timers()).toEqual([{ name: 'tick', every: 100, action: 'TICK', component: 'Stopwatch' }])

  await vi.advanceTimersByTimeAsync(1000)
  expect(t.state.now - t.state.since).toBe(1000)

  t.simulateEvent('.toggle', 'click')
  await t.next(s => s.status === 'paused')
  expect(t.timers()).toEqual([])
})
```

- The fake is registered as the `TIMER` sink (`timerSink: 'CLOCK'` gives it another name, when a test needs `TIMER` for something else). If the test passes its own `makeTimerDriver()` in `drivers`, the fake stands down, so no timer runs twice; `t.timers()` then lists nothing, and throws when that driver is under the fake's name.
- `t.actions` lists each tick with its data (`t.actions.filter(a => a.type === 'TICK')`), so a test can check the `{ n, t }` values.
- `vi.getTimerCount()` is 0 after `t.dispose()`: removing a component stops its timers.
- A `frame` timer uses `requestAnimationFrame` when the environment has one, and a 16 ms timeout otherwise (as in jsdom), so fake timers drive it too.

See [Fake timers](/integration/testing/#fake-timers) for how the waits (`next()`, `settle()`) behave on a fake clock.

## Diagnostics

| Code | When |
|---|---|
| [SYG422](/reference/errors/#syg422) (error) | A spec the driver can't run: a zero or negative `every`, a negative `after`, no `action`, a `frame` that isn't an action name. That timer is not started; the others are |
| [SYG643](/reference/errors/#syg643) (warning) | The component declares `timers`, but no `makeTimerDriver()` is registered. `sygnal-check` reports it too when it can read the app's `run()` call |

To stop a timer, return a falsy value for it, not an invalid spec.
