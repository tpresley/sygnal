---
title: Sandboxed Components
description: Run untrusted or model-written Sygnal components with sygnal/sandbox. QuickJS-in-WASM with no access to the page, rendered into the real DOM through an allowlist, events declared with Standard Schemas, a Worker tier for hostile code, and hard limits on time, memory and output
---

:::caution[Dev preview]
`sygnal/sandbox` is experimental in 7.2. Its options and defaults may change before it is stable. The protocol between the page and the guest is internal and versioned.
:::

`sygnal/sandbox` runs a Sygnal component that your app didn't write: a component a model generated, a plugin a user pasted in, or a marketplace widget. The component runs in its own QuickJS engine compiled to WebAssembly. It has no `window`, `document`, `fetch`, storage or Node APIs, only the drivers the page grants. It still renders into the page's real DOM, so it looks and feels like the rest of the app, and its events come back to your intent as validated data.

```sh
npm install quickjs-emscripten-core @jitl/quickjs-wasmfile-release-sync
```

Both packages are optional peer dependencies of `sygnal`. Install them in the app (0.32). They are loaded the first time a sandbox starts, so an app that never uses one pays nothing.

## A sandboxed component as a tag

```jsx
// Checkout.jsx
import { Sandboxed } from 'sygnal/sandbox'
import kernel from 'sygnal/sandbox/kernel?raw'
import { z } from 'zod'

const Answer = z.object({ pct: z.number(), people: z.number().int().positive() })

export default function Checkout({ state }) {
  return (
    <div>
      <Sandboxed className="tip" kernel={kernel} source={state.cardSource}
        emits={{ ANSWER: Answer }} input={{ bill: state.bill, currency: 'EUR' }} />
      <p className="split">{state.split}</p>
    </div>
  )
}

Checkout.initialState = { bill: 84.5, cardSource: '', split: '' }

Checkout.intent = ({ DOM }) => ({
  ANSWER: DOM.select('.tip').events('emit').detail().filter((e) => e.type === 'ANSWER').map((e) => e.data),
  FAILED: DOM.select('.tip').events('sandboxerror').detail(),
})

Checkout.model = {
  ANSWER: (state, a) => ({ ...state, split: `${a.people} × ${(state.bill * (1 + a.pct / 100) / a.people).toFixed(2)}` }),
  FAILED: (state, e) => ({ ...state, split: `The card stopped (${e.reason})` }),
}
```

- `kernel` is the code that runs inside the box before the component: Sygnal's core, the `sygnal/host` renderer kit and a small bridge. `sygnal/vite` builds it from the packages you installed when you import `sygnal/sandbox/kernel?raw`. Nothing is shipped prebuilt, so updates to `xstream` and `snabbdom` reach it through npm like everything else.
- `source` is the component as a CommonJS module (see [Compiling the guest's code](#compiling-the-guests-code)). A new `source` replaces the sandbox.
- `emits` is required. It names every `EVENTS` type the page accepts, each with a [Standard Schema](https://standardschema.dev) (zod, valibot, arktype, …) for its data.
- `input` becomes the guest's `PROPS` source. A new value is sent to the guest.
- The tag dispatches `emit` (detail `{ type, data }`, with `data` as the schema returned it) and `sandboxerror` (detail `{ reason, message }`) on itself, so your intent reads them like any widget's events.

To preset props once, make your own tag: `const Card = sandboxed({ kernel, limits: { hardMs: 500 } })`.

## Threat model

The guest is untrusted. The boundary is the bridge between the guest and the page, not the guest's own code: a component can overwrite `Array.prototype.map` and break its own kernel, but everything it sends out is checked by the page.

| A guest tries to… | What stops it |
|---|---|
| read the DOM, cookies or storage, call `fetch`, use Node | QuickJS has none of them; the `Function` constructor reaches only the guest's own global |
| exfiltrate data through markup (`<img src>`, `<a href>`, CSS `url()`) | the mirror creates only allowlisted tags and attributes; `<img>` takes `data:image/*` or `policy.imageOrigins`; inline style can't use `url()`, `image-set()`, escapes or `@`; links get `rel="noopener noreferrer" target="_blank"` |
| run script (`<script>`, `on*`, `<iframe srcdoc>`, `<svg>`) | not on the allowlist: dropped and recorded in `violations` |
| navigate the page or post a form | link clicks and form submits are always prevented at the box; an unprevented link click goes to `capabilities.navigate(href)` |
| draw over the page (fake login dialog) | the box has `contain: content`, `isolation: isolate` and `overflow: hidden` (no `position: fixed` escape); `<input type="password">` and `type="file"` are dropped |
| clobber the page's ids or trigger its intents | guest ids are prefixed (`for` and `aria-*` references too); guest events stop at the box, so a guest `.danger` button never reaches your `DOM.select('.danger')` |
| send the page events it didn't ask for | only `emits` types with schema-valid data reach `onEmit` / `emit`; the rest are dropped (SYG692 in development) |
| hang the page | a deadline per entry, a CPU share, and in the Worker tier a watchdog that terminates the worker |
| exhaust memory | a heap limit, and a WebAssembly instance per sandbox whose whole memory is capped (ArrayBuffers included) |
| crash the engine for other sandboxes | a stack limit below the host's; a crashed instance is never reused, and every sandbox has its own instance |
| pollute the page's prototypes | separate engine; the page only parses JSON strings from it |

What it doesn't solve: phishing inside the box (a guest can draw a convincing form; label generated content in your UI), exfiltration through channels you granted (an allowlisted API, events your model acts on), and timing side channels. For isolation from the page's process, use a cross-site iframe.

## Two tiers

```js
createSandbox({ kernel, source, container, isolation: 'worker' })   // the default
createSandbox({ kernel, source, container, isolation: 'thread' })
```

| | `'worker'` (default) | `'thread'` |
|---|---|---|
| For | code that may be hostile: plugins, a marketplace, other tenants | code a model wrote for this user: its threat is accidents and prompt injection, not a crafted attack |
| Where QuickJS runs | in a Web Worker (Node: `worker_threads`) | on the page's thread |
| Hard stop | yes: a watchdog terminates a worker that stops answering for `limits.hardMs` | no: the deadline is polled, see below |
| A stuck guest | never freezes the page | can freeze it for up to the deadline, or longer (below) |
| Events | asynchronous: the guest's `preventDefault()` arrives too late; declare keys to prevent with `preventKeys: ['Enter']` | synchronous: `preventDefault()` works |
| Cost per event | one more `postMessage` hop (~0.3 ms for a counter) | ~0.2 ms for a counter |

**Why the in-thread tier isn't for hostile code:** QuickJS checks its deadline once per 10,000 operations and never inside a builtin. A plain endless loop stops at the deadline (100 ms), but a loop over a slow builtin (`JSON.stringify` of a large object, a big sort) can run for seconds to minutes before the first check. Only a Worker you can terminate stops that.

The Worker script ships with `sygnal/sandbox`. Vite and webpack bundle it, with QuickJS and its `.wasm`, from `new Worker(new URL(...))` in the package. To make the worker yourself, pass `worker: () => new SandboxWorker()` (for example `import SandboxWorker from 'sygnal/sandbox/worker?worker'` in Vite).

## The guest's world

The component is an ordinary Sygnal component: view, `intent`, `model`, `initialState`, `context`, `Collection`, `Switchable`, timers and `EFFECT` all work. A root without `initialState` gets `{}`, so a stateless card renders. Its drivers:

| Driver | What it is |
|---|---|
| `DOM` | the `sygnal/host` driver on a host tree; the page mirrors the tree into the real DOM |
| `STATE` | the core's own |
| `EVENTS` | a bus inside the box; each event also goes to the page, through `emits` |
| `PROPS` | data from the page (`input`, `props`, `setProps`): `PROPS.get('bill')` |
| `HTTP` | the core's `makeFetchDriver`, through `capabilities.fetch` (none by default) |

`require('sygnal')` (an `import ... from 'sygnal'` once compiled) gives `xs`, `createElement`, `Fragment`, `ABORT`, `classes`, `set`, `toggle`, `event`, `debounce`, `throttle`, `delay`, `dropRepeats`, `sampleCombine`, `Collection` and `Switchable`. Anything else fails to import. `setTimeout`, `setInterval`, `requestAnimationFrame` and `console` are the page's, capped.

## Events: `emits`

The guest's `EVENTS` are untrusted input. The page delivers an event only when its type is an own key of `emits` and its data passes that type's schema; the delivered `data` is the schema's output (a zod object strips unknown keys). Everything else is dropped. In development each drop is reported as [SYG692](/reference/errors#syg692) with the reason: not declared, invalid data with the schema's issues, or no `emits` at all. Async schemas are fine: events keep the order the guest sent them in.

```js
// emits.js
import * as v from 'valibot'

export const emits = {
  PICKED: v.object({ id: v.number() }),
  ANSWER: v.object({ pct: v.number(), people: v.pipe(v.number(), v.integer(), v.minValue(1)) }),
}
```

`emits={{}}` accepts no events, for a card that only displays.

## Capabilities

Every capability is off unless you pass it in `capabilities`:

- `fetch: { allow: ['https://api.example.com/v1/'], methods: ['GET'], impl }`: the guest's `HTTP` driver. Each entry is a URL prefix (same origin, a path under it) or a RegExp on the URL. Requests always go out with `credentials: 'omit'` and `redirect: 'error'`, only `accept` and `content-type` headers are kept, and the response is capped at `limits.maxMessageBytes`. In the Worker tier the page checks the URL again before it makes the request.
- `navigate(href)`: a link click the guest didn't prevent. The page decides: open a tab, confirm, or ignore it.
- `focus: true`: the guest may move focus (`autoFocus`, an `ELEMENT` focus command), but only while the page's focus is already inside the box. A guest can manage focus in its own dialog, never take focus from the page. Off by default.
- `log(level, text)`: the guest's console (default: the page's console with a `[sandbox]` prefix; 100 lines, 4 KB each).

## Styling

Guest class names are kept, so your design system's CSS styles generated UI, and the guest can also use inline `style` (filtered). For full CSS isolation, prefix them: `policy: { classPrefix: 'gen-' }` turns `class="card"` into `class="gen-card"`, and then only your `.gen-*` rules apply. Guest stylesheets are not supported.

## Limits

| `limits.` | Default | What happens |
|---|---|---|
| `bootMs` | 1000 | kernel + component + first render; killed with `'timeout'` |
| `callMs` | 100 | one event, timer or fetch reply with its render; `'timeout'` |
| `cpuShare` | 0.5 | guest time per rolling second; `'cpu'` |
| `hardMs` | 1000 | Worker: no answer to the watchdog this long; terminated, `'timeout'` |
| `memoryBytes` | 32 MB | QuickJS's heap; an allocation fails inside the guest (a reducer that throws is reported, the guest lives on) |
| `maxWasmBytes` | 64 MB | the instance's whole memory, ArrayBuffers included |
| `stackBytes` | 256 KB | at most 384 KB: above that, a deep recursion can overflow the host's stack first and crash the engine |
| `maxTimers` / `minTimerMs` | 64 / 4 ms | a 65th timer throws inside the guest |
| `maxFetches` | 4 | in flight |
| `maxMessageBytes` | 1 MB | one render or response |
| `maxLogs` | 100 | console lines |

`policy` limits the mirror: `maxNodes` (5,000), `maxDepth` (128) and `maxText` (1 MB). A malformed render (a node inside itself, too many nodes, bad JSON) kills the sandbox with `'protocol'`.

A killed sandbox can't be resumed. It leaves no DOM behind, `onError` (or the tag's `sandboxerror`) gets a `SandboxError` with `reason` `'timeout'`, `'memory'`, `'cpu'`, `'protocol'`, `'error'` or `'crash'`, and `ready` rejects with it if it died during boot. To try again, mount a new one: give the tag a new `source`, or `key` it.

## `createSandbox`

```js
// card.js
import { createSandbox } from 'sygnal/sandbox'

export function showCard(container, kernel, source, emits) {
  const sb = createSandbox({
    kernel, source, container, emits,
    props: { bill: 84.5 },
    capabilities: { fetch: { allow: ['https://api.example.com/v1/'] } },
    onEmit: (ev) => console.log(ev.type, ev.data),
    onError: (e) => console.warn(e.reason, e.message),
  })
  sb.ready.then(() => sb.setProps({ bill: 90 }))
  return () => sb.dispose()
}
```

The handle has `ready`, `dead`, `violations` (what the sanitizer dropped), `stats`, `setProps(props)`, `dispose()` and, in the thread tier, `memory()`. Each in-thread sandbox gets a fresh capped WebAssembly instance by default (compiled once per page). Pass `quickjs: await loadQuickJS({ maxWasmBytes })` to choose the instance yourself.

## Compiling the guest's code

`source` is plain JavaScript in CommonJS form: imports become `require('sygnal')`, the component is `module.exports.default` (or the first exported function, or `exportName`), and JSX is compiled to `__h(tag, props, ...children)` with `__frag` for fragments. Compiling is the page's job, because only the page has a compiler. Compiling is trusted code reading untrusted text, so it is safe. With esbuild:

```js
// compileCard.js
import { transform } from 'esbuild-wasm'

export async function compileCard(code) {
  const out = await transform(code, { loader: 'jsx', format: 'cjs', jsxFactory: '__h', jsxFragment: '__frag', target: 'es2020' })
  return out.code
}
```

Sucrase, Babel or the TypeScript compiler (`jsx: 'react'`, `jsxFactory: '__h'`, `module: 'commonjs'`) work the same way.

## Model-generated parts (experimental)

`generatedRuntime({ kernel, compile })` is the runtime of parts a model writes for [`compose`](/guide/ai-compose/#generated-parts-experimental): it compiles the model's module (`sucraseCompiler(() => import('sucrase'))`, with sucrase as your app's own dependency), checks it before it mounts, and runs it in a box whose failures (`compile`, `check`, `runtime`, `empty`, and the sandbox's own) and dropped events (`sandboxreject`, with `onReject` on `createSandbox`) are what a repair loop needs. It is experimental and outside semver; the guide has the API.

## Without Vite

`buildSandboxKernel()` from `sygnal/sandbox/build` builds the same kernel string in Node with the project's Vite, esbuild or Rollup (`bundler: 'auto'` picks the first one installed). Build it once, at build time or at server start, and serve it to the page as a string:

```js
// scripts/build-kernel.mjs
import fs from 'node:fs'
import { buildSandboxKernel } from 'sygnal/sandbox/build'

fs.writeFileSync('public/sandbox-kernel.js', await buildSandboxKernel({ bundler: 'esbuild' }))
```

## Server rendering

`renderToHTML({ kernel, source, props })` renders a guest's first view to HTML on the server through the same allowlist, in a fresh engine and WebAssembly instance per call, so tenants share nothing. It runs on the caller's thread with the in-thread deadline, so for code that may be hostile, call it in a worker or a process you can kill. `treeToHTML(tree)` prints one render message's tree.

## Cost

Measured in Chromium 153 (research: `dev-plans/research/sandbox`):

- Download: about 194 KB brotli of `.wasm`, 45 KB of kernel and 18 KB of page-side code, loaded only where a sandbox is used.
- Start: about 21 ms to a counter's first render in-thread, 45 ms in a Worker, after the `.wasm` is compiled once per page. Most of a start is QuickJS parsing the kernel.
- Per event: 0.2–0.3 ms for a counter, 2–3 ms to toggle one row of a 100-row `Collection`. QuickJS runs at about a tenth to a twentieth of V8's speed, which is well within UI budgets for a card or a widget.
