---
title: Strict Mode
description: Keep every component in Sygnal's canonical forms
---

Sygnal often accepts more than one way to write the same thing. A model entry can use the object form or the `'ACTION | SINK'` shorthand, an event can be emitted with `event()`, `emit()` or a hand-built `{ type, data }` object, and so on. All of these keep working. Strict mode flags every form except the canonical one, so a codebase (and any agent working on it) reads the same everywhere.

Strict mode is off by default. Its rules are SYG501 to SYG508; SYG502 is retired in 6.0 and never reported.

## The rules

| Code | Canonical form | Flagged | Static | Runtime | `--fix` |
|---|---|---|---|---|---|
| [SYG501](/reference/errors/#syg501) | `function C({ state, context, ...props })` | positional `(props, state, context)` view arguments | yes | yes | no |
| [SYG502](/reference/errors/#syg502) | Retired in 6.0 | — (see [below](#syg502-retired-in-60)) | — | — | — |
| [SYG503](/reference/errors/#syg503) | `ACTION: { EFFECT: (state, data, next) => { … } }` | a STATE reducer that runs a side effect and returns `ABORT` | yes (heuristic) | no | no |
| [SYG504](/reference/errors/#syg504) | `ACTION: { SINK: fn }` | `'ACTION \| SINK'` shorthand keys | yes | yes | yes |
| [SYG505](/reference/errors/#syg505) | `ACTION: { EVENTS: event('TYPE', fn) }` | `emit('TYPE', fn)` and a raw `EVENTS: s => ({ type, data })` | yes | no | yes |
| [SYG506](/reference/errors/#syg506) | `CHILD.select(ChildFn)` | `CHILD.select('ChildName')` | yes | no | yes, when the name is in scope |
| [SYG507](/reference/errors/#syg507) | `.context` for data that crosses levels | a prop passed on unchanged through 3 component levels | yes (info) | no | no |
| [SYG508](/reference/errors/#syg508) | reply actions `{ url, ok: 'LOADED', error: 'FAILED' }` | `HTTP.select('c')` / `HTTP.errors('c')` reading back the component's own `category: 'c'` request | yes | yes | no |

All strict findings are warnings, except SYG507, which is info.

Strict mode also raises one non-strict code: [SYG106](/reference/errors/#syg106) (a parent prop named `state`, `children`, `slots`, `context`, `peers` or `uid` that the view overwrites) is an **error** instead of a warning while runtime strict mode is on. SYG106 is a runtime check of `sygnal/diagnostics`; `sygnal-check` has no static rule for it.

### SYG501: destructure the view's first argument

```jsx
// Flagged:
// function Lane(props, state, context) {
//   return <h2 className={props.className}>{state.title}</h2>
// }

function Lane({ state, context, className }) {
  return <h2 className={className}>{state.title}</h2>
}
```

### SYG502: retired in 6.0

Before 6.0, SYG502 flagged a STATE reducer that returned the state it received (`cond ? { ...state, title } : state`) instead of `ABORT`, because that still emitted a new state. Since 6.0, returning the same object means "no change", exactly like `ABORT` ([Model](/guide/model/#aborting-an-action)), so there is nothing left to flag. The code is never reported. A reducer that changes the state in place and returns it is [SYG222](/reference/errors/#syg222) (dev checks, not strict mode). The docs still write `ABORT`, which says "no change" explicitly.

Static detection of a bare `return;` (or a block body that can end without returning) went with it. At runtime, a STATE reducer that returns `undefined` in a root component is still [SYG202](/reference/errors/#syg202).

### SYG503: side effects go in `EFFECT`

```jsx
Player.model = {
  // Flagged:
  // PLAY: (state) => { playerCmd.send('play'); return ABORT },
  PLAY: {
    EFFECT: () => playerCmd.send('play'),
  },
}
```

### SYG504: object form for every non-STATE sink

```jsx
TaskCard.model = {
  // Flagged: 'DELETE | PARENT': (state) => ({ taskId: state.id }),
  DELETE: {
    PARENT: (state) => ({ taskId: state.id }),
  },
}
```

### SYG505: emit with `event()` inside the object form

```jsx
import { event } from 'sygnal'

Lane.model = {
  // Flagged: DELETE_LANE: emit('DELETE_LANE', (state) => ({ laneId: state.id })),
  // Flagged: DELETE_LANE: { EVENTS: (state) => ({ type: 'DELETE_LANE', data: { laneId: state.id } }) },
  DELETE_LANE: {
    STATE:  (state) => ({ ...state, deleting: true }),
    EVENTS: event('DELETE_LANE', (state) => ({ laneId: state.id })),
  },
}
```

### SYG506: select children by component reference

```jsx
import TaskCard from './TaskCard.jsx'

Lane.intent = ({ CHILD }) => ({
  // Flagged: DELETE_TASK: CHILD.select('TaskCard'),
  DELETE_TASK: CHILD.select(TaskCard).map(p => p.taskId),
})
```

A string name breaks when a minifier renames the function.

### SYG507: use context for data that travels down

```jsx
// Flagged: App passes theme to Board, Board passes it to Lane, Lane passes it to Card.
App.context = {
  theme: (state) => state.theme,
}

function Card({ state, context }) {
  return <div className={`card ${context.theme}`}>{state.title}</div>
}
```

### SYG508: name reply actions, don't read the reply back

```jsx
// Flagged: LOADED: HTTP.select('quote') in the intent, { category: 'quote', url } in the model
Quote.intent = ({ DOM }) => ({ LOAD: DOM.click('.get') })
Quote.model = {
  LOAD:   { HTTP: () => ({ url: '/api/quote', ok: 'LOADED', error: 'FAILED' }) },
  LOADED: (state, quote) => ({ ...state, quote }),
  FAILED: (state, { status }) => ({ ...state, status }),
}
```

See [HTTP](/guide/http/).

The [Alternative Forms](/advanced/alternative-forms/) page lists every non-canonical form with its canonical equivalent.

## Enabling strict mode

### In the static checker

```bash
npx --no-install sygnal-check --strict   # report SYG501-508 with the regular rules
npx --no-install sygnal-check --fix      # rewrite SYG504/505/506 in place, then check (implies --strict)
```

`--strict` doesn't change the [accessibility](/guide/accessibility/) checks (SYG701-708): they stay warnings, so a strict run doesn't fail on markup you didn't touch. Add `--a11y=error` to make them errors too.

`--fix` is mechanical and idempotent: it rewrites shorthand keys into the object form (unless another entry already handles the action), turns `emit()` and raw EVENTS returns into `event()` (adding `event` to your `sygnal` import and removing an unused `emit` import), and replaces `CHILD.select('Name')` with the identifier when a binding of that name is in scope. It re-parses each file after rewriting it. Review the diff before committing.

### In the Vite dev server

```javascript
// vite.config.js
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal({ diagnostics: { strict: true } })],
})
```

`diagnostics.strict` turns on the runtime strict checks in dev (the plugin sets `globalThis.__SYGNAL_STRICT__ = true`) and is also the default for `check.strict`, so the dev server's `sygnal-check` run includes the strict rules. The accessibility findings stay warnings there and don't open Vite's error overlay; `check: { a11y: 'error' }` makes them errors.

### At runtime, from `run()`

```javascript
import 'sygnal/diagnostics'   // dev only; the strict checks live in this entry
import { run } from 'sygnal'
import App from './App.jsx'

run(App, {}, { diagnostics: { strict: true } })
```

`strict: true` turns the runtime strict checks on, and diagnostics too (`'warn'`) unless you give a `mode`. `strict: false` turns them off; leaving `strict` out keeps an earlier `configureStrict()` setting. The app's `dispose()` restores the setting `run()` replaced. Without the `sygnal/diagnostics` entry there are no strict checks to run, so `run()` prints [SYG608](/reference/errors/#syg608) once and continues.

### At runtime, from code

```javascript
import { configureStrict } from 'sygnal/diagnostics'

configureStrict(true)    // on
configureStrict(false)   // off
configureStrict()        // back to the default: on only when globalThis.__SYGNAL_STRICT__ === true
```

Diagnostics must also be on (any mode but `'off'`), since strict findings are reported through the same core.

### In tests

```javascript
import 'sygnal/diagnostics'
import { renderComponent } from 'sygnal'

const t = renderComponent(Lane, { strict: true })
await t.ready()
t.expectNoDiagnostics()   // fails on SYG501/504/508 (and SYG106) as well
t.dispose()               // restores the previous strict setting
```

## Limits

- The runtime only checks what it can detect reliably: SYG501, SYG504 and SYG508. SYG503, SYG505, SYG506 and SYG507 are static only (`sygnal-check --strict`), because at runtime `emit()` and `{ EVENTS }` look the same, a side effect looks like any other call, and `CHILD.select()` arguments aren't visible.
- SYG501 at runtime uses the view's declared arity, so a default value or a rest parameter (`(props, state = {})`) can hide a positional use. The static rule doesn't have this gap.
- Every runtime switch (`run(App, drivers, { diagnostics: { strict: true } })`, `configureStrict(true)`, `globalThis.__SYGNAL_STRICT__ = true`, the Vite plugin's `diagnostics.strict`, `renderComponent(C, { strict: true })`) needs the `sygnal/diagnostics` entry loaded; the Vite plugin and its Vitest setup add it for you.
- The strict codes' severities are registered by the `sygnal/diagnostics` entry, so `getCodeInfo('SYG501')` only returns them once that entry is loaded.
- SYG503 is a heuristic: it looks for a call whose result is unused on the path to `return ABORT`.
