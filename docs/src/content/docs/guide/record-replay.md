---
title: Record and Replay
description: Record a session in the browser, replay it as a test, and get a report of where changed code diverges
---

:::caution[Dev preview]
`sygnal/replay` is experimental in 7.2. The recording format is versioned (`version: 1`), but the API may still change.
:::

A Sygnal app's behavior is its models folded over its actions, and every input (a click, a server reply, a timer tick) enters as an action. `sygnal/replay` records those input actions, plus the clock and randomness the handlers read, while you use the app. It can then replay the session in [`renderComponent`](/integration/testing/): the same inputs reach the same component instances in the same order, with no browser, network or timers. After every action and every screen update the replay compares the result with the recording, so it can tell you where new code first behaves differently.

Three uses:

- **A regression test from a real session.** Click through a flow once, save the recording, and commit a one-line test that replays it.
- **A bug report you can run.** Attach a recording to an issue; the maintainer replays it and gets the exact states the reporter saw.
- **A review of a change.** Replay old recordings against new code: the report names the first action whose state changed, with the difference.

## Record

Start a recorder before the app starts. It records the next app that `run()` (or `renderComponent()`) starts:

```jsx title="src/main.jsx"
import { run } from 'sygnal'
import { startRecording } from 'sygnal/replay'
import App from './App.jsx'

const recorder = import.meta.env.DEV ? startRecording() : null
run(App)

// later, from the console or a "Save recording" button:
// copy(JSON.stringify(recorder.stop()))
```

`recorder.stop()` ends the recording and returns it; `recorder.log()` returns the recording so far and keeps going. A recording is plain JSON. Keep it out of production builds: `sygnal/replay` is dev tooling, and an app that never imports it pays nothing.

In sygnal/devtools, **Copy as test** has a replay mode that uses the newest recorder. It returns the test file and the recording to save next to it:

```js
import { copyAsTestResult } from 'sygnal/devtools'

const { code, recording, file } = copyAsTestResult(undefined, { mode: 'replay', componentImport: "import App from './App.jsx'" })
// save `recording` as `file` (App.recording.json) next to the test in `code`
```

## Replay as a test

`replayTest(recording)` writes a Vitest file, and the replay mode of Copy as test writes the same file. It replays the recording and asserts that nothing diverged:

```js title="src/App.replay.test.js"
// A recorded session of App (sygnal/replay): 22 inputs, 21 checkpoints, 457 ms.
// Timeline (inputs):
//   +    3ms  (root)        ADD_LANE (intent)
//   +   98ms  Lane[lane-1]  EDIT_TITLE (intent) "Backlog"
//   …
import { it, expect } from 'vitest'
import { replay } from 'sygnal/replay'
import App from './App.jsx'
import log from './App.recording.json' with { type: 'json' }

it('App: a recorded session replays', async () => {
  const r = await replay(App, log)
  try {
    expect(r.divergence).toBeNull()
    expect(r.view).toBeNull()
    expect(r.effects).toEqual([])
    expect(r.unhandled).toEqual([])
  } finally {
    r.t.dispose()
  }
})
```

`replay()` is also exported from `'sygnal'`, next to `renderComponent`. It takes the recording or its JSON text, and options:

| Option | Default | |
|---|---|---|
| `drivers` | inert drivers | Drivers for the recording's own sources. By default a `makeFetchDriver` or `makeTimerDriver` source gets `renderComponent`'s fake (requests are made, answers come from the recording) and any other source an inert driver that never emits |
| `render` | `{}` | More `renderComponent` options |
| `stopAt` | all | Stop after this many checkpoints |
| `entropy` | `true` | `false`: handlers read the real clock and randomness, not the recorded values |
| `warn` | `true` | `false`: no `console.warn` for a version or name mismatch (still in `warnings`) |

### What the replay compares

The result:

| Field | |
|---|---|
| `ok` | nothing below differs |
| `divergence` | the first action whose state differs from the recording: its type, the instance (`App/Lane[lane-2]`), the reason, and the root state's difference at the next screen update (`[{ path: 'lanes.3.title', expected: 'New Lane', actual: 'Untitled' }]`) |
| `view` | the first screen update whose markup differs while the state matches: a view-only change |
| `effects` | actions whose requests, events or other sink values differ, with what the code sends now |
| `unhandled` | action types the code no longer handles |
| `unresolved` | inputs whose component instance never appeared |
| `warnings` | the recording was made with another Sygnal version, or names a component or action the code doesn't have. The recording still replays |
| `final` | the final root state |
| `t` | the `renderComponent` handle (dispose it) |

The recording holds the *actions*, not the DOM events, so a markup refactor (renamed classes, a moved button) replays the same states and shows up only as `view`. A model change shows up at the first action it affects. A renamed action shows up in `unhandled`.

### Accepting a change

When a divergence is the change you meant to make, record the flow again (or rewrite the test's expectations). A recording is a snapshot of behavior, like a snapshot test.

## A bug report

`bugReport(recording, result)` writes Markdown: the timeline of inputs, what the replay found (the first divergence with its difference, changed effects, unhandled actions) and how to reproduce it:

```js
import { replay, bugReport } from 'sygnal/replay'

const r = await replay(App, recording)
console.log(bugReport(recording, r, { expected: 'a new lane is called "New Lane"' }))
```

`timeline(recording)` gives the input lines alone, and `finalState(recording)` the recorded final state.

## The clock and randomness

A handler that reads [`now()`, `random()` or `uuid()`](/guide/model/#the-clock-and-randomness) from its 4th argument gets the value it read in the recording, including in an `EFFECT` after an `await`:

```jsx
Board.model = {
  ADD_TASK: (state, title, next, { now, uuid }) => ({ ...state, tasks: [...state.tasks, { id: uuid(), title, created: now() }] }),
}
```

Code that still calls `Date.now()`, `new Date()`, `Math.random()`, `performance.now()` or `crypto.randomUUID()` in a handler is covered while the handler runs synchronously: the recorder and the replay patch those globals for that call. A read after an `await`, or in a view, isn't recorded. `sygnal-check` flags the globals in reducers ([SYG258](/reference/errors/#syg258), [SYG509](/reference/errors/#syg509) in strict mode), and `--fix` rewrites them.

## Privacy

Recordings are made to be shared, so **redaction is on by default**:

- Text the user typed is pseudonymized: the strings of an action dispatched while a text-entry event was delivered (an `input` or `keydown` in a text field, a form `submit`), and of later actions of the same type. Server replies and `setState` values are pseudonymized too. A timer's actions are the app's own data and are kept: a tick, and a game loop's sampled buttons (`pressed: ['jump']`), so a recorded game replays exactly.
- A pseudonym keeps the shape of the string (letter case, digits, spaces and punctuation in place), and equal strings get equal pseudonyms within one recording, so `trim()`, `=== ''` and an id that appears in a reply and in a click still behave the same. The salt isn't stored.
- Checkpoints are compared on masked values, so state differences and view hashes hold no text either.
- Event types, keys (`Enter`), element datasets (ids your app rendered) and `next()` data (your code's own) are kept.

When the model branches on a redacted string (a route name typed into a filter, say), the replay diverges at that action and the report says so. Keep that action type as recorded:

```js
startRecording({ redact: { keep: ['SET_FILTER'] } })     // never redact SET_FILTER
startRecording({ redact: { also: ['SET_NOTE'] } })       // redact SET_NOTE too
startRecording({ redact: false })                        // record everything as is
```

What a recording can still contain: the app's initial state (your code's) and the structure of the state. Request headers aren't stored (only hashes of what sinks send).

## Recording options

| Option | Default | |
|---|---|---|
| `redact` | `true` | `true`, `{ keep, also }` or `false` (see [Privacy](#privacy)) |
| `dropNoops` | `true` | Leave out inputs that changed nothing (an idle timer's ticks). A replay of the same code is unaffected; with `false`, an input that new code would make meaningful is replayed too |
| `vnodes` | `'hash'` | `'html'`: each checkpoint also keeps the view's markup, for reports |

## The format

A recording is JSON with `kind: 'sygnal-recording'` and `version: 1`, the Sygnal version, the root component, every component's action names, the initial state, the instance addresses, the actions (type, cause, data for inputs, the clock and randomness read, a hash of each new state and of each sink value) and one checkpoint per screen update. `RECORDING_SCHEMA` is its JSON Schema. Instances are addressed by path (`App/Lane[lane-2]/Card[task-3]` for Collection items by id, `App/Header:0` otherwise), so a recording survives a wrapped or renamed root and added siblings.

## Limits

- Replays run in `renderComponent`'s mock DOM. A view that reads `Math.random()` shows up as a view difference.
- Drivers beyond `makeFetchDriver` and `makeTimerDriver` get an inert stand-in; their recorded answers (replies, intent events from their sources) are replayed as actions.
- A recording made with `dropNoops` (the default) doesn't hold the inputs that changed nothing.
