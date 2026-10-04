---
title: Debugging
description: Diagnostics, inspect, debug logging and DevTools
---

When something in a Sygnal app "does nothing", work through these in order:

1. **Read the diagnostics.** In the Vite dev server, Sygnal's [diagnostics](/guide/diagnostics/) print a `[Sygnal SYGnnn]` line in the console for most silent failures (a selector that matches nothing, an action with no model entry, an event nobody listens to). Each line names the component, says how to fix it, and links to the [Error Reference](/reference/errors/).
2. **Run the static checker.** `npx --no-install sygnal-check --strict` checks the whole project at once, including problems the running app hasn't hit yet.
3. **Inspect the app graph.** `window.__SYGNAL_DEVTOOLS__.inspect()` in the browser console (or `t.inspect()` in a test) shows every component's actions and sinks, which selectors matched rendered elements, and the EVENTS traffic.
4. **Turn on debug logging** for the component involved (below).

## Common Silent Failures

| Symptom | Likely cause | Code |
|---|---|---|
| A click does nothing | The selector has a typo, or the element is rendered by a child component | [SYG103](/reference/errors/#syg103), [SYG104](/reference/errors/#syg104), [SYG110](/reference/errors/#syg110) |
| An action never changes anything | The intent action has no model entry with the same name | [SYG101](/reference/errors/#syg101) |
| A component never receives an event | The EVENTS type names don't match | [SYG105](/reference/errors/#syg105) |
| An input resets while typing | A bound `value` with no `input` listener | [SYG111](/reference/errors/#syg111) |
| State loses fields | A reducer forgot `...state` | [SYG201](/reference/errors/#syg201) |
| A list renders nothing | Collection `from` names a missing or non-array field | [SYG401](/reference/errors/#syg401) |
| `x.pipe is not a function` | An RxJS operator on an xstream stream | [SYG301](/reference/errors/#syg301) |

## inspect()

With the dev checks and the DevTools bridge loaded (both automatic with the Vite plugin in dev), the bridge has an `inspect()` method that returns the live app graph:

```javascript
// in the browser console
const graph = window.__SYGNAL_DEVTOOLS__.inspect()
graph.components.map(c => [c.name, c.selectors.filter(s => s.matched === false)])
```

From code, use `getDevTools()?.inspect?.()` (from `sygnal`) or `inspect()` (from `sygnal/diagnostics`). See [Diagnostics](/guide/diagnostics/#inspect) for the fields.

## Collected Diagnostics

`getDiagnostics()` returns everything collected so far, info-level findings included (which are never printed). `onDiagnostic(callback)` subscribes to new ones:

```javascript
import { getDiagnostics, onDiagnostic } from 'sygnal'

console.table(getDiagnostics().map(d => ({ code: d.code, component: d.component, message: d.message })))

onDiagnostic(d => {
  if (d.severity !== 'info') reportToMyErrorTracker(d.text)
})
```

## Per-Component Debug

Enable debug logging for a specific component:

```jsx
MyComponent.debug = true
```

## Global Debug

In the browser, set `window.SYGNAL_DEBUG = 'true'` (the DevTools extension can toggle it). In Node, set the environment variable:

```bash
SYGNAL_DEBUG=true node server.js
```

## Debug Output

When enabled, Sygnal logs:
- Component instantiation with a unique component number
- Action triggers and the data they carry
- State changes before and after reducers
- Driver interactions

Each log entry is prefixed with the component number and name (e.g., `3 | MyComponent`) for easy identification.

## DevTools Extension

The Sygnal DevTools browser extension (in the repository's `devtools/` folder) shows the component tree, lets you inspect and edit state, time-travel through state history, toggle debug logging, and lists every action with its cause. It connects to the `window.__SYGNAL_DEVTOOLS__` bridge, which the dev-only `sygnal/devtools` entry installs.

The bridge is a development tool and is not part of production builds. With the [Vite plugin](/integration/bundler-config/#what-the-plugin-does-in-dev) nothing needs setting up: the dev server (`vite`, and the Vike and Astro dev servers) installs it, `vite build` leaves it out, and `sygnal({ devtools: false })` turns it off. `getDevTools()` from `sygnal` returns the installed bridge, or `undefined` when there is none (always in a production build).

### Without Vite

Import `sygnal/devtools` in development builds only, before `run()`. Components created before the import are not in the extension's tree, and their actions are not in the log.

```javascript
// main.dev.js: the development entry
import 'sygnal/devtools'
import './main.js'
```

Keep the import out of your production entry so the bridge (about 17 KB gzipped, with the action log and "Copy as test") isn't bundled.

### The action log

The panel's **Actions** tab lists every action of every component instance, oldest first, as it happens: its name, the component and instance, its data, the sinks it produced a value for, and its cause:

| Cause | The action came from |
|---|---|
| `intent` | The component's intent (a DOM event, a stream) |
| `next` | A reducer's or `EFFECT`'s `next('ACTION')` |
| `reply` | A [reply action](/guide/http/) of a driver (`ok`/`error` of a request, a [timer](/guide/timers/), a socket message) |
| `built-in` | `INITIALIZE`, `BOOTSTRAP`, `DISPOSE`, `RESOURCE` (hidden unless **Built-in** is ticked) |
| `behavior` | A [behavior](/guide/behaviors/)'s own trigger; its actions are listed under their namespaced name (`pager.NEXT`) |
| `simulateAction` | A test's `t.simulateAction()` |

Filter by component or action name in the tab's toolbar. Select an action that changed its component's state to see that change as a diff in the inspector. The log is the same one `t.actions` gives in [tests](/integration/testing/#action-log-tactions-and-texplain).

### Copy as test

**Copy as test** (in the Actions tab) turns what you just did in the app into a [`renderComponent`](/integration/testing/) test: select a component in the tree first, or it uses the root. The test renders the component with the state it had when the session started, replays the session's actions with `t.simulateAction()`, and asserts the final state:

```javascript
// Copied from a sygnal/devtools session of SignupForm (7 recorded actions, 6 replayed)
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import SignupForm from './signup-form.js'

it('signup form: a recorded session with replies replays (copied from sygnal/devtools)', async () => {
  const t = renderComponent(SignupForm)
  try {
    await t.ready()
    t.simulateAction('EMAIL', 'ada')
    // SUBMIT: DOM event/element data as a stub (type, key, target dataset/value/checked/id)
    t.simulateAction('SUBMIT', { type: 'click' })
    await t.fail('HTTP', 422, { request: (r) => r.error === 'SIGNUP_FAILED', body: { message: 'Email is invalid' } })
    t.simulateAction('EMAIL', 'ada@example.com')
    // SUBMIT: DOM event/element data as a stub (type, key, target dataset/value/checked/id)
    t.simulateAction('SUBMIT', { type: 'click' })
    await t.respond('HTTP', { id: 1, name: 'Ada', email: 'ada@example.com' }, 'SIGNED_UP')
    await t.settle()
    expect(t.state).toEqual({
      email: 'ada@example.com',
      saving: false,
      user: { id: 1, name: 'Ada', email: 'ada@example.com' },
      error: null,
    })
  } finally {
    t.dispose()
  }
})
```

What is replayed:

- the actions the component's intent, a behavior or a test sent (causes `intent`, `behavior`, `simulateAction`), with the data they had. `next`, `built-in` and reply actions are consequences: the replay produces them again;
- the replies of a [`makeFetchDriver()`](/guide/http/) source, as `t.respond()` and `t.fail()` (renderComponent fakes that driver);
- data as JavaScript literals: JSON values, `Date`, `Map`, `Set`, `NaN`, `Infinity`, `-0` and bigints. A DOM event or element becomes a **stub** with its `type`, `key` and the target's `dataset`, `value`, `checked` and `id`, marked with a comment. An intent that reads something else from the event needs the stub filled in.

The final-state assertion is written only when the replay can be complete. It is left out, with a comment saying why, when an action's data couldn't be written (a function, a class instance, a cycle), when a child component changed the state through its own intent (copy the test from that child instead), when the session was longer than the log keeps (5,000 actions), or when the final state isn't JSON-safe. A test copied with its assertion passes unchanged. The dialog's title says "(no final-state assertion)" when it was left out, and lists what was.

The defaults name the component's import `import <Name> from './<Name>.js'` and pass no drivers. Set your own for the panel with `configureCopyAsTest()` on the bridge, for example in the development entry:

```javascript
import { getDevTools } from 'sygnal/devtools'

getDevTools().configureCopyAsTest({
  componentImport: "import App from './App.jsx'",
  imports: ["import { mockDragDriver } from './test-helpers.js'"],
  drivers: { DND: 'mockDragDriver().driver' },
  environment: 'jsdom',
})
```

| Option | Description |
|---|---|
| `componentImport` | The import line(s) for the component |
| `componentName` | The component's identifier in the test (default: its name) |
| `imports` | More import lines (drivers, helpers) |
| `drivers` | Drivers for `renderComponent`, as source code by sink name. Sessions of apps with drivers other than `makeFetchDriver()` need them |
| `renderOptions` | More `renderComponent` options, as source code (`'strict: true'`) |
| `testName` | The test's name |
| `environment` | Adds a `// @vitest-environment <env>` first line (`'jsdom'`) |

### From code: copyAsTest() and getActions()

The same log and the same tests are available from `sygnal/devtools`, for a console helper or a dev-only script:

```javascript
// main.dev.js: the development entry
import { copyAsTest, getActions } from 'sygnal/devtools'
import { run } from 'sygnal'
import App from './App.jsx'

const app = run(App)

// in the browser console: actions() lists what happened, copyTest() prints it as a test
window.actions = () => console.table(getActions({ cause: 'intent' }).map(a => ({ type: a.type, component: a.component, sinks: a.sinks.join(' ') })))
window.copyTest = () => console.log(copyAsTest(app, { componentImport: "import App from './App.jsx'", environment: 'jsdom' }))
```

| Export | Description |
|---|---|
| `getActions(filter?)` | The recorded actions, oldest first: `{ seq, type, data, component, instance, parent, sinks, cause, at, before?, after? }`. The filter takes `component`, `instance`, `type` (a string or RegExp) and `cause` (one or an array) |
| `onAction(fn)` | Calls `fn(action, 'add' \| 'update')` as actions are recorded and fill in, `fn(null, 'reset')` on `clearActions()`; returns an unsubscribe function |
| `clearActions()` | Starts a new session: forgets the recorded actions. A test copied afterwards starts from the state at this point |
| `copyAsTest(target?, options?)` | The test, as a string. `target`: `run()`'s result, a component, an instance id, or a recorded session; default the newest root |
| `copyAsTestResult(target?, options?)` | `{ code, complete, warnings, replayed }`: the test, whether it asserts the final state, and what was left out |
| `getSession(target?)` | One instance's session as plain data (what the test is written from) |
| `recordActions()` | Starts recording, and returns a function that stops it. In a browser, importing the entry starts it; elsewhere (Node, a test) call it first |
| `isRecording()` | Whether the log is recording |

The options are `configureCopyAsTest()`'s. Recording costs nothing in production: the entry is dev-only, and the core has no recording code.

### Redux DevTools

If you already use the [Redux DevTools](https://github.com/reduxjs/redux-devtools) browser extension, Sygnal can send it the recorded actions and the root component's state. With the Vite plugin, turn it on in the dev server:

```javascript
// vite.config.js
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal({ devtools: { redux: true } })],
})
```

Without Vite, call `connectReduxDevtools()` from `sygnal/devtools` in the development entry:

```javascript
// main.dev.js: the development entry
import { connectReduxDevtools } from 'sygnal/devtools'
import { run } from 'sygnal'
import App from './App.jsx'

const app = run(App)
connectReduxDevtools(app, { name: 'My app' })
```

Each action appears as `<Component>/<ACTION>` (`TodoList/ADD`), with its data as the payload and the root's state after it; built-in actions are left out (pass `filter: (action) => …` to choose). Jumping to a state or an action in the extension replaces the root's state, as time travel in the Sygnal panel does. `connectReduxDevtools()` returns a function that disconnects, and does nothing when the extension isn't installed.
