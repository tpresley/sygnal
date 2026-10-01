---
title: Debugging
description: Diagnostics, inspect, debug logging and DevTools
---

When something in a Sygnal app "does nothing", work through these in order:

1. **Read the diagnostics.** In the Vite dev server, Sygnal's [diagnostics](/guide/diagnostics/) print a `[Sygnal SYGnnn]` line in the console for most silent failures (a selector that matches nothing, an action with no model entry, an event nobody listens to). Each line names the component, says how to fix it, and links to the [Error Reference](/reference/errors/).
2. **Run the static checker.** `npx sygnal-check --strict` checks the whole project at once, including problems the running app hasn't hit yet.
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

With the dev checks loaded (automatic with the Vite plugin), the DevTools bridge has an `inspect()` method that returns the live app graph:

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

The Sygnal DevTools browser extension (in the repository's `devtools/` folder) shows the component tree, lets you inspect and edit state, time-travel through state history, and toggle debug logging. It connects to the same `window.__SYGNAL_DEVTOOLS__` bridge that `run()` creates in the browser.
