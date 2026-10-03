---
title: Diagnostics
description: Coded runtime warnings, dev checks, the static checker, and inspect
---

Most Sygnal mistakes don't throw. A selector with a typo, an intent action with no model entry, or an `EVENTS` type nobody listens to just does nothing. Sygnal's diagnostics find these silent failures and report each one with a stable code, a fix, and a link to the [Error Reference](/reference/errors/).

There are three layers:

| Layer | What it is | Where it runs |
|---|---|---|
| Runtime messages | Errors and warnings built into the core (invalid props, reducers that threw, a Collection `from` that isn't an array, …) | Every app, production included |
| Dev checks | The `sygnal/diagnostics` entry: wiring, selector, state-shape and EVENTS checks, strict mode, `inspect()` | Vite dev server, Vitest, or wherever you import it |
| Static checker | `sygnal-check`, a separate package that reads your source without running it | CLI, the Vite dev server, CI, MCP |

## Message format

Every runtime diagnostic is printed as one line:

```text
[Sygnal SYG101] Form: Intent action 'SAVE' has no model entry, so it never does anything. Add 'SAVE' to Form.model, or remove it from Form.intent. https://sygnal.js.org/reference/errors#syg101
```

That is `[Sygnal CODE] Component: message. fix. link`. The code is stable across versions, so you can search for it, ignore it, or look it up:

```bash
npx --no-install sygnal-check explain SYG101
```

`sygnal-check` uses the same codes, prefixed with the location: `src/Form.jsx:12:9 SYG101 Form: …`.

Codes are grouped by area: `SYG1xx` wiring (intent, model, view, EVENTS), `SYG2xx` state and reducers, `SYG3xx` streams, `SYG4xx` Collections, Switchable, sub-components and context, `SYG5xx` [strict mode](/guide/strict-mode/), `SYG6xx` drivers and setup, `SYG9xx` internal.

Each diagnostic has a severity:

- `error`: something is broken. Thrown, or caught and logged with `console.error` while the app keeps running (a reducer, EFFECT or view that threw). An error thrown by Sygnal inside your code, such as `next()` with a bad delay inside a reducer, is reported under its own code, not as "reducer threw".
- `warn`: almost certainly a bug.
- `info`: a hint that needs a judgment call. Collected, never printed.

## Modes

The runtime has four diagnostics modes:

| Mode | Behavior |
|---|---|
| `'off'` | No dev checks, nothing collected. The core's own error and warning messages are still printed (with their codes). The default in production. |
| `'collect'` | Diagnostics are collected silently. Read them with `getDiagnostics()`. Error-severity messages are still printed. The default under `renderComponent()`. |
| `'warn'` | Collected, and warnings and errors are printed to the console. The default in the Vite dev server. |
| `'error'` | Collected, and every warning or error throws a `DiagnosticError`. Inside the stream pipeline it is rethrown asynchronously, so the stream that hit the problem keeps running. Useful in CI and tests. |

Set the mode with `run()`'s `diagnostics` option:

```javascript
import { run } from 'sygnal'
import App from './App.jsx'

run(App, {}, { diagnostics: 'error' })

// mode plus codes to ignore
run(App, {}, { diagnostics: { mode: 'warn', ignore: ['SYG105'] } })

// strict-mode checks too (needs import 'sygnal/diagnostics'; mode defaults to 'warn')
run(App, {}, { diagnostics: { strict: true } })
```

The option takes precedence over the dev flag the Vite plugin sets. `run(App, {}, { diagnostics: 'off' })` turns diagnostics off for that app even in dev.

### The ignore list

`ignore` drops codes entirely: they are not collected, printed or thrown. Use it for a check that doesn't fit your app, such as SYG105 when events are emitted for code outside Sygnal. Prefer fixing the cause, or suppressing one finding in `sygnal-check` with a `// sygnal-ignore SYG110` comment on (or above) the line. The Vite plugin's `diagnostics.ignore` applies the same list to the runtime and to `sygnal-check`.

## The `sygnal/diagnostics` dev entry

Most runtime checks don't ship in your app. They live in a separate entry that you load only in development:

```javascript
import 'sygnal/diagnostics'   // registers the checks (side effect)
```

Loading it registers the dev checks: SYG101/102 (intent and model wiring; `ok`/`error` reply actions and `connections` actions count as triggers), SYG103/104 (selectors that match nothing, or only match inside a child component), SYG105 (EVENTS types), SYG106 (props overwritten by reserved view arguments; an error in strict mode), SYG112 (a request or connection names a reply action with no model entry), SYG115 (a `DOM.<name>` shorthand that isn't a DOM event), SYG116 (an EVENTS value with no type, such as a function), SYG201/202 (reducer results), SYG221 (`set()` called with a string), SYG301 (RxJS operators on xstream streams), SYG401 (Collection `from`), SYG421 (a `data` key the DOM rejects), SYG609 (a sink or source with no driver) and the strict-mode rules, including SYG508 (a `select()`/`errors()` round trip where reply actions would do). The checks only run while diagnostics are on (any mode but `'off'`).

The network drivers report two codes themselves, in every build: [SYG610](/reference/errors/#syg610) (a request or connection spec with a `then`/`catch` key, not sent; use `ok`/`error`) and [SYG611](/reference/errors/#syg611) (a socket send to a connection the instance hasn't declared, that closed for good or is read-only SSE, or a value `makeSocketDriver()` can't use). A component with a `connections` static but no registered `makeSocketDriver()` opens nothing and is not reported: check `run()`'s drivers first.

The entry also exports a few helpers:

| Export | Purpose |
|---|---|
| `inspect(options?)` | The app graph of the live components (see [inspect](#inspect)) |
| `configureStrict(on?)` / `isStrictEnabled()` | Turn the runtime [strict-mode](/guide/strict-mode/) checks on or off |
| `checkEventBus()` | Report SYG105 for every EVENTS type that was selected but never emitted, and return the bus registry |
| `listCodes()` / `getCodeInfo(code)` | Metadata for every registered code |
| `configureChecks({ settleMs, idleMs, minRenders })` | Tune the timing of the DOM checks (mostly for tests) |
| `resetChecks()` | Forget what the checks have seen and reported (for tests) |
| `RXJS_HINTS` | The RxJS operator → xstream table SYG301 uses |

From the main `sygnal` entry, `getDiagnostics()`, `clearDiagnostics()` and `onDiagnostic(callback)` read collected diagnostics in every mode but `'off'`:

```javascript
import { onDiagnostic } from 'sygnal'

const stop = onDiagnostic(d => sendToMyLogger(d.code, d.text))
```

Each diagnostic is `{ code, severity, component, message, fix, data, docsUrl, text, timestamp }`.

## What the Vite plugin does in dev

With the [Vite plugin](/integration/bundler-config/), diagnostics are on in the dev server with no setup. In `vite` / `vite dev` (never in `vite build`), the plugin adds two lines to every file that imports `run` from `sygnal`:

```javascript
if (globalThis.__SYGNAL_DEV__ === undefined) globalThis.__SYGNAL_DEV__ = true;
import 'sygnal/diagnostics';import 'virtual:sygnal/dev';
```

- The flag turns runtime diagnostics on in `'warn'` mode.
- `sygnal/diagnostics` registers the dev checks.
- `virtual:sygnal/dev` shows `sygnal-check` findings in the browser console.

The lines go on an existing line, so line numbers and source maps stay correct. The Vike and Astro client entries get the same treatment. Production builds contain none of this: the dev checks add 0 bytes to your app bundle.

When `sygnal-check` is installed (`npm install -D sygnal-check`), the plugin also runs it when the dev server starts and after every source change. Findings go to the terminal and the browser console. Error-severity findings also open Vite's error overlay.

The plugin's `diagnostics` option sets the mode, strict mode and the ignore list for the dev server:

```javascript
// vite.config.js
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [
    sygnal({
      diagnostics: { mode: 'error', strict: true, ignore: ['SYG105'] },
      check: { strict: true },
    }),
  ],
})
```

`sygnal({ diagnostics: 'off' })` turns all of it off. See [Bundler Configuration](/integration/bundler-config/#plugin-options) for every option.

Under Vitest, the plugin adds `sygnal/diagnostics` to `test.setupFiles` instead (opt out with `vitestSetup: false`), and [`renderComponent()`](/integration/testing/#diagnostics-in-tests) manages the mode per test.

### Without Vite

Import the entry yourself in development and pass a mode to `run()`:

```javascript
import { run } from 'sygnal'
import App from './App.jsx'

if (process.env.NODE_ENV !== 'production') await import('sygnal/diagnostics')

run(App, {}, { diagnostics: process.env.NODE_ENV === 'production' ? 'off' : 'warn' })
```

## inspect

`inspect()` returns a machine-readable graph of the running app: every live component with its actions (and what triggers them), sinks, state keys, context, EVENTS traffic, children, DOM selectors (and whether they matched), and its diagnostics.

```javascript
import { inspect } from 'sygnal/diagnostics'

const graph = inspect()
graph.components.find(c => c.name === 'Lane').selectors
// [{ selector: '.delete-lane-btn', events: null, matched: true, isolationHit: null }]
```

It is also available as:

- `getDevTools().inspect()` (or `window.__SYGNAL_DEVTOOLS__.inspect()` in the browser console) in a dev app;
- `t.inspect()` on a [`renderComponent()`](/integration/testing/#inspect) result;
- `sygnal-check --graph --json`, which builds the same shape statically from source.

The graph is built from what the dev checks have seen, so `sygnal/diagnostics` must be loaded and diagnostics on. Its type is `InspectGraph`, exported from `sygnal` and `sygnal/diagnostics`. The JSON Schema ships with `sygnal-check` (`sygnal-check/schema/inspect.schema.json`).

Things to look for in a graph:

- a selector with `matched: false`: the action never fires. Fix the class, or handle the event in the child named by `isolationHit`;
- an action with `sinks: []` (no model entry);
- an `events` entry with no emitters or no selectors;
- a non-empty `diagnostics` array.

## The static checker

`sygnal-check` finds the same wiring bugs without running the app, across the whole project at once:

```bash
npm install -D sygnal-check
npx --no-install sygnal-check            # checks ./src (or pass paths: pages, renderer, ...)
npx --no-install sygnal-check --strict   # plus the canonical-form rules
npx --no-install sygnal-check --graph    # the app graph
npx --no-install sygnal-check explain SYG104
```

It exits with code 1 when it finds a warning or error, so it works as a CI step. See [Building with AI Agents](/integration/agents/#sygnal-check) for the full command list and the MCP server.

## Related

- [Error Reference](/reference/errors/): every code, its cause and its fix
- [Strict Mode](/guide/strict-mode/): canonical-form rules
- [Testing](/integration/testing/#diagnostics-in-tests): `expectNoDiagnostics()` and per-test modes
- [Debugging](/integration/debugging/): debug logging and DevTools
