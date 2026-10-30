---
title: Running off the Main Thread
description: Run a whole Sygnal app in a Web Worker with sygnal/worker (experimental) — when it pays and when it doesn't, the page bridge, drivers that stay on the page, declared preventDefault, fields, and what isn't supported yet
---

:::caution[Experimental]
`sygnal/worker` and `sygnal/worker/page` are a dev preview in 7.2. Their API may change, and some features don't work in a worker app yet (see [Not supported yet](#not-supported-yet)). Feedback is welcome.
:::

A Sygnal app can run entirely in a Web Worker: its models, views, `Collection`s and the drivers that work there (HTTP, SSE, WebSocket, `sygnal/ai`, timers). The page runs only a small bridge. It applies the worker's changes to the DOM, sends the user's input back, and hosts the drivers that need the page, such as `localStorage` and the router. **The app code doesn't change.** Only the entry files do.

```
 page (main thread)                              worker
 ┌────────────────────────────┐  patch ops, once  ┌──────────────────────────────┐
 │ startBridge(worker, root)   │ ◀── per flush ──── │ createWorkerTarget(self)      │
 │  ops → the real DOM         │                    │  the app on a sygnal/host tree │
 │  events → the worker        │ ── events ───────▶ │  run(App, { DOM: target.driver,│
 │  preventDefault, right away │                    │            STORE: remote(…) }) │
 │  page drivers (STORE, …)    │ ◀─ sinks / sources ▶│                               │
 └────────────────────────────┘                    └──────────────────────────────┘
```

## When it pays, and when it doesn't

Moving the app to a worker trades latency for responsiveness. While the app works, the page stays at 60 fps and typing paints in the next frame. But every response to the user costs about one frame more, because it makes a round trip between the threads.

Measured on the TodoMVC app ([examples/todomvc-worker](https://github.com/tpresley/sygnal/tree/main/examples/todomvc-worker): the same app files as the main-thread example) and a streaming app, in headless Chromium, medians of 5 runs:

| | main thread | worker |
|---|---|---|
| a click → painted, 0 todos | 15.7 ms | 32.5 ms (one frame more) |
| a click → painted, 1,000 todos | 15.4 ms | 32.8 ms |
| first render, 10,000 todos (long tasks on the page) | 3,685 ms (3,511 ms) | 552 ms (253 ms) |
| a click → painted, 10,000 todos | 120 ms | 84 ms |
| a key pressed while toggling 10,000 todos, input → paint | 128 ms | 16 ms |
| a streaming reducer re-parsing 120 chunks while the user types: keystroke p95, page long tasks | 56 ms, 40 | 16 ms, 0 |

"Painted" is measured from the input event to the frame after the DOM shows the result.

**Use it when**

- the model does real work per action: parsing streamed LLM output (markdown, partial JSON), search or filtering over thousands of records, validation, diffing, CSV or JSON import;
- you render big Collections (thousands of rows), and typing and scrolling must stay smooth while they update;
- the app streams continuously (an AI chat, live data) while the user types;
- most of its I/O is network (`makeFetchDriver`, SSE, WebSocket, `sygnal/ai`, `sygnal/api`), which works in a worker as it is.

**Don't use it when**

- the app is small or form-like: every response gets one frame slower, with nothing to gain;
- the UI depends on synchronous layout or DOM APIs: drag and drop, measuring elements to position them, focus traps, rich text editing, the [UI parts](/ui/overview/) (see [Not supported yet](#not-supported-yet));
- the drivers that must stay on the page would copy large state across on every change. TodoMVC's `localStorage` driver writes the whole list on every state change: 568 KB per keystroke at 10,000 todos. Persist from the worker (IndexedDB) instead, or debounce.

### The middle ground: one heavy computation in a worker

When the problem is a single heavy reducer, move only that computation. Give it a driver that posts the work to a worker and returns the results as a source. The app stays on the main thread, with none of the constraints on this page:

```js
// parseDriver.js
import { xs } from 'sygnal'

// sink: { id, text } jobs; source: the worker's { id, outline } results
export function makeParseDriver(url) {
  return (job$) => {
    const worker = new Worker(url, { type: 'module' })
    job$.addListener({ next: (job) => worker.postMessage(job) })
    return xs.create({
      start: (l) => { worker.onmessage = (e) => l.next(e.data) },
      stop: () => { worker.onmessage = null },
    })
  }
}
```

```js
// parse.worker.js
import { parseMarkdown } from './markdown.js'

self.onmessage = (e) => self.postMessage({ id: e.data.id, outline: parseMarkdown(e.data.text).headings })
```

```jsx
// Editor.jsx
function Editor({ state }) {
  return (
    <div className="editor">
      <textarea className="source" aria-label="Markdown" value={state.text} />
      <ol className="outline">{state.outline.map((h) => <li>{h}</li>)}</ol>
    </div>
  )
}

Editor.initialState = { text: '', outline: [] }

Editor.intent = ({ DOM, PARSER }) => ({
  EDIT: DOM.select('.source').events('input').value(),
  PARSED: PARSER,
})

Editor.model = {
  // the reducer stays cheap: the parse runs in the worker
  EDIT: {
    STATE: (state, text) => ({ ...state, text }),
    PARSER: (state, text) => ({ id: 'doc', text }),
  },
  PARSED: (state, result) => ({ ...state, outline: result.outline }),
}

export default Editor
```

```js
// main.js
import { run } from 'sygnal'
import Editor from './Editor.jsx'
import { makeParseDriver } from './parseDriver.js'

run(Editor, { PARSER: makeParseDriver(new URL('./parse.worker.js', import.meta.url)) })
```

A whole-app worker pays off when the heavy work is spread across the model, the views and big Collections at once.

## Setting it up

Three entry files replace `run(App)` in the page. The components are the same files as before.

```js
// worker.js
import { run } from 'sygnal'
import { createWorkerTarget } from 'sygnal/worker'
import App from './App.jsx'

const target = createWorkerTarget(self)
run(App, {
  DOM: target.driver,
  STORE: target.remote('STORE', ['get']),   // a driver on the page, with a get() method
  ROUTER: target.remote('ROUTER'),          // a driver on the page whose source is a stream
})
```

```js
// main.js
import { startBridge } from 'sygnal/worker/page'
import localStorageDriver from './page/localStorageDriver.js'
import routerDriver from './page/routerDriver.js'

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
startBridge(worker, document.getElementById('root'), {
  drivers: { STORE: localStorageDriver, ROUTER: routerDriver },
})
```

```js
// vite.config.js
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal()],
  // the app's JSX now compiles inside a module worker
  worker: { format: 'es', plugins: () => [sygnal()] },
})
```

`sygnal/worker/page` loads no Sygnal core: the page bundle is the bridge (about 4 KB gzip), xstream, and your page drivers. Write those drivers on `xstream` directly (`import xs from 'xstream'`) rather than importing `xs` from `sygnal`, or the page loads the core for them.

## Drivers: which move, which stay

| Works in the worker | Must stay on the page |
|---|---|
| `makeFetchDriver`, `sygnal/api` clients, SSE, WebSocket, `sygnal/ai`'s chat driver | `localStorage` and `sessionStorage` |
| timers, `xs.periodic`, IndexedDB, `crypto`, `BroadcastChannel` | `location`, `history` and hash routing (a worker's `location` is its script's URL) |
| parsing, validation, formatting, search indexes | the [browser sources](/guide/browser-sources/) (`matchMedia`, visibility, resize, scroll), observers, geolocation, the clipboard, file pickers |

A page driver is any Sygnal driver, passed to `startBridge`'s `drivers`. In the worker, `target.remote(name)` stands in for it under the same name: its sink's values are posted to the page driver's sink, and its source is a stream (`remote('ROUTER')`) or an object whose methods return streams (`remote('STORE', ['get'])`). Everything that crosses must be [structured-cloneable](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm): plain data, no functions, no DOM nodes.

## Decisions the page makes right away

The browser decides whether to run an event's default action (follow a link, move focus on Tab, submit a form) while it dispatches the event. A `preventDefault()` in the worker would come a round trip too late. So the page makes these decisions, from declarations:

- **A `submit` in the mount is always prevented.** No Sygnal form wants the browser's submit.
- **An intent's `preventDefault` option** crosses to the page as a declaration:

  ```jsx
  // Menu.jsx
  Menu.intent = ({ DOM }) => ({
    MOVE: DOM.select('[role=menuitem]').events('keydown', { preventDefault: { key: 'ArrowDown' } }),
    NAVIGATE: DOM.select('a.route').events('click', { preventDefault: true }),
  })
  ```

  `true` always prevents. An object prevents when the event's fields match it (`{ key: 'Tab' }`, `{ key: 'Enter', shiftKey: false }`). The page applies it synchronously, to the same elements as the intent: the selector, inside the component's isolation scope. A predicate function (`(e) => e.key === 'Tab'`) can't cross threads. It still works when the app runs on the main thread, but in a worker the page can't call it, and the worker warns once.
- **A decision that depends on state** goes in the selector, because the page matches it on the live DOM: `DOM.select('.menu.open [role=menuitem]')` prevents only while the view renders the menu open.
- **`startBridge`'s `preventDefault`** adds `[type, selector]` pairs for anything not in an intent: `[['submit', '*'], ['dragover', '.dropzone']]`.

`stopPropagation()` inside the app works as usual: the worker's tree dispatches through the app's own listeners. It has no effect on the page's listeners outside the mount.

## Fields

While the user types into a field, the page owns its value:

- A value the page sent is never written back, so the caret stays put during normal typing.
- When the app changes a field's value (an EFFECT clears it after Enter) while the user has kept typing, the page **rebases** the user's newer typing onto the app's value: "Buy milk", Enter, then "W" before the app's clear arrived, leaves "W", not "Buy milkW" and not "". The app then receives the result as an `input` event, so a model that tracks the text follows. The caret keeps its place in the text around it.
- A submit waits until the worker has seen the form's last edit, and what the user types after it waits until the worker has handled the submit. A word and Enter typed inside one round trip submit exactly what was typed. This costs a round trip on Enter only when someone types that fast.
- No value is written into a field while an input method (IME) is composing.

## High-frequency events

`pointermove`, `mousemove`, `scroll` and `wheel` cross at most once a frame: the latest one, and for `wheel` the deltas summed. Any other event sends the pending ones first, so the app sees them in order. `startBridge(worker, root, { coalesce: [...] })` changes the list. A `scroll` event carries the element's `scrollTop` and `scrollLeft`, which the app reads from `e.target` as on the DOM.

## Not supported yet

These need the page's DOM synchronously, or code that runs on real elements. They are planned follow-ups; until then, keep apps that need them on the main thread:

- **The [UI parts](/ui/overview/)**: dialogs and popovers (`sygnal/ui` uses native `<dialog>` and the popover API), and Menu, Select and Combobox.
- **Widgets**: `defineWidget`, `fromReact`, `fromZag`, `sygnal/three`'s `<Scene>`, and `<VirtualCollection>` (it measures rows). They mount third-party code on real elements.
- **Element commands and layout reads**: the built-in `ELEMENT` sink's method calls (`scrollIntoView`, `select`, `showModal`), and `createRef()` reads that need layout (`getBoundingClientRect`, `offsetHeight`). In a worker, a ref is the worker's copy of the element: reading `value`, setting `value`, `classList` and `focus()` work, layout doesn't. Nor does state the browser changes by itself, such as a `<details>` the user opened.
- **DevTools and HMR**: the devtools panel doesn't see a worker app, and a changed worker module reloads with its state lost.
- **Synchronous DOM work**: drag and drop (`processDrag` and `sortable` read the event's `dataTransfer` and positions during dispatch), measuring elements to position them (tooltips, anchored popovers), focus traps (Tab can be kept in place with a declaration, but moving focus to the other end waits a round trip), and rich text editing (`contenteditable`, `beforeinput`).
- **Also web-only on any host target**: `Portal`, [view transitions](/guide/view-transitions/), SSR hydration (the worker renders the app fresh), and [compiled views](/integration/compiled-views/) (they need `document`; a worker build uses ordinary vnodes).

## Testing

The components' tests don't change: [`renderComponent`](/integration/testing/) runs a component on its mock DOM in one thread, and the worker is only wiring. To test the wiring itself, connect the target and the bridge with a `MessageChannel` in jsdom, as [examples/todomvc-worker](https://github.com/tpresley/sygnal/tree/main/examples/todomvc-worker) does:

```js
// worker.test.js
import { it, expect } from 'vitest'
import { run } from 'sygnal'
import { createWorkerTarget } from 'sygnal/worker'
import { startBridge } from 'sygnal/worker/page'
import App from './App.jsx'

it('renders through the bridge', async () => {
  document.body.innerHTML = '<div id="root"></div>'
  const { port1, port2 } = new MessageChannel()
  const bridge = startBridge(port2, document.getElementById('root'))
  const target = createWorkerTarget(port1)
  run(App, { DOM: target.driver })
  await bridge.ready
  expect(document.querySelector('#root h1').textContent).toBe('Todos')
})
```

## API

| | |
|---|---|
| `createWorkerTarget(port, { frame?, driver? })` (`sygnal/worker`) | in the worker. `port`: `self`, or a `MessagePort`. Returns `{ driver, remote(name, methods?), flush(), doc, stats }`. `frame`: the shortest gap between messages while the app is busy (16 ms). `driver`: the host driver's options |
| `startBridge(worker, mount, { drivers?, preventDefault?, coalesce?, onApply? })` (`sygnal/worker/page`) | on the page. `worker`: a `Worker`, or a `MessagePort`. Returns `{ ready, stop(), stats }`. `ready` resolves when the first render is on the page; `stop()` stops listening (terminate the worker yourself) |

Under the hood, the worker renders into a [`sygnal/host`](/renderers/custom-targets/) tree and sends one message of patch operations per flush, read from the tree's change tracking: a one-row change in a 10,000-row list is about 150 bytes.
