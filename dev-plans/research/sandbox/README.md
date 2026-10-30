# Sandboxing untrusted and generated Sygnal components

Research and a working spike (branch `claude/explore-sandbox-quickjs`, cut from
`claude/advanced-integration` at 7.2.0-dev). The question: can a Sygnal component the app didn't
write run with no access to the page, while the page keeps the real DOM? Examples are a model's
output, a user plugin, a marketplace widget, or another tenant's code on a shared server.
The starting point was `compile-wasm/README.md` §5: the unmodified core runs headless in
QuickJS-in-WASM at about 10× V8.

Nothing here touches `src/`. The spike is plain JS under this folder with its own
`package.json` (`quickjs-emscripten-core` and its release-sync variant, pinned). It links the
repo's `dist/` (`npm run build` first).

```bash
npm --prefix dev-plans/research/sandbox install
npm --prefix dev-plans/research/sandbox test         # builds dist/guest.js, then 29 node:test tests
npm --prefix dev-plans/research/sandbox run bench    # sizes, cold start, per-event, memory, SES (Node)
node dev-plans/research/sandbox/bench-browser.mjs    # the same in Playwright's Chromium (real DOM)
node dev-plans/research/sandbox/probes/deadline.mjs  # how far hostile code overruns the deadline
```

## Summary

- **It works.** The real core, the `sygnal/host` renderer kit and a component run in a QuickJS
  context. The guest renders into a host tree, and its changes go to the page as JSON deltas.
  The page mirrors them into the real DOM through an allowlist sanitizer, and real DOM events go
  back in. The guest can use model, intent, view, context, `Collection`, timers, `EVENTS`, an
  allowlisted HTTP driver (the core's own `makeFetchDriver`) and `PROPS` from the page.
  The host app gets it as a JSX tag: `<Sandboxed source={code} input={…} />` (on
  `defineWidget`), and its intent reads the guest's `EVENTS` as DOM events on the tag.
- **It is fast enough for UI.**
  - Chromium 153: cold start is about 21 ms for a counter and 40 ms for a 100-row list, once the
    WASM is compiled (2–13 ms, once per page).
  - A click to the guest's render on the page takes 0.2 ms in-thread (counter) and 2.3 ms (one
    toggle in a 100-row Collection).
  - Size: 194 KB brotli of `.wasm`, plus 45 KB brotli of guest kernel and 18 KB of page-side JS.
- **Three things the earlier note missed:**
  1. **`setMemoryLimit()` does not cap ArrayBuffer storage.** With a 16 MB limit, a guest
     allocated 255 × 8 MB typed arrays, and the host process went to 2–4 GB RSS. The fix is an
     instance per sandbox with its own `WebAssembly.Memory({maximum})`. The build imports its
     memory, so this works with stock packages. A 48 MB cap stops the same guest in 29 ms.
  2. **The deadline only stops accidents.** QuickJS checks the interrupt handler once per
     10,000 ticks, and a builtin call (JSON, sort, a big string op) is one tick however long it
     runs. A loop over a 1 ms builtin ran 2.3 s, and a loop over a 40 ms one ran 57–78 s, before
     the first check (same in quickjs-ng). Against hostile code, only a Worker you can
     `terminate()` is a hard stop. The spike has that mode, and stopped the same loop in about
     450 ms with the page's timers ticking throughout.
  3. **A stack limit over ~384 KB is a crash, not an error.** At 512 KB, guest recursion
     overflows V8's native stack first. A host `RangeError` then unwinds the WASM mid-call, and
     freeing that runtime aborts the whole Emscripten module, which is every sandbox sharing it.
     The spike uses a 256 KB limit, never frees a crashed runtime, and refuses a "poisoned" module.
- **Recommendation:** QuickJS, in two tiers behind one API. In-thread with a capped instance for
  generated code: synchronous events, so `preventDefault()` works, and its threat is accidents
  plus prompt injection. In a Worker with a watchdog for code that may be hostile: plugins, a
  marketplace, other tenants. Ship it as an opt-in `sygnal/sandbox` subpath with
  `quickjs-emscripten-core` and a variant as optional peers (D209). Nothing goes in the core.
  §8 has the plan and §9 the questions.

## 1. Use cases and threat model

### 1.1 Who writes the code

| Use case | Author | Trust | What goes wrong in practice |
|---|---|---|---|
| `sygnal/ai` generating a component (compose beyond the fixed catalog, a chat card the catalog doesn't have) | a model, steered by a user and by whatever text reached the prompt | **low, mostly not adversarial**: wrong code, endless loops, reaching for `document`; prompt injection can make it hostile | bugs, loops, phishing UI, exfiltration through anything that reaches the network |
| User plugins (a dashboard widget a user pastes in) | the user, or someone the user copied from | low | the same as above, plus deliberate escapes |
| Marketplace widgets | third parties | untrusted, possibly adversarial | everything, including DoS tuned to the sandbox |
| Edge / multi-tenant SSR | other tenants | untrusted | cross-tenant reads, server DoS, memory blowups |

### 1.2 What the sandbox must prevent, and how the spike does it

The trust boundary is the **bridge**, not the guest. Everything inside QuickJS is untrusted,
including the kernel this spike runs there: a component can overwrite `Array.prototype.map` and
break its own kernel. The page validates everything that crosses the bridge.

| Threat | Mechanism | Test |
|---|---|---|
| DOM, cookies, storage, network, Node APIs | QuickJS has none: no `window`, `document`, `fetch`, `XMLHttpRequest`, `WebSocket`, `localStorage`, `indexedDB`, `process`, `WebAssembly`. The `Function` constructor reaches only the guest global; `require` and `import()` fail | `escape: no window…`, `dynamic import or require` |
| Network exfiltration through markup | the mirror creates only allowlisted tags and attributes: no `<script>`, `<iframe>`, `<style>`, `<svg>`, `on*`, `srcdoc`, `formaction`, `action`. `href` is http(s)/mailto only, with a forced `rel=noopener noreferrer target=_blank`. `<img src>` takes `data:image/*` or an allowlisted origin (a pixel is a request). Inline style can't use `url()`, `image-set()`, `expression()`, escapes or `@` | `a hostile render message`, `ssr` |
| Navigation and form posts | every link click and form submit is `preventDefault()`ed at the sandbox root. An unprevented link click goes to the `navigate(href)` capability; the page decides | `link click` |
| UI escaping its box (overlays, spoofing the page) | the root has `contain: content` (paint clipped, and a containing block for `position: fixed`), `isolation: isolate` and `overflow: hidden`. `<input type=password|file>` is dropped by default (phishing) | `hostile render` |
| DOM clobbering | guest ids get a per-sandbox prefix (and `for`/`aria-*` references with them); `name` only on form fields | `hostile render` |
| Triggering the host app's intents | the guest's events `stopPropagation()` at the sandbox root, so a guest `.danger` button never reaches the host's `DOM.select('.danger')` (the host's intents delegate in the bubble phase) | `widget: a sandboxed tag in a host app` |
| Endless loops | the interrupt deadline per entry (boot 1 s, each event/timer/reply 100 ms), endless promise jobs, a CPU share per rolling second (50 %), and in the worker tier a watchdog `terminate()` | `endless loop` ×3, `busy interval`, `worker: slow builtin` |
| Memory blowups | `setMemoryLimit` (QuickJS heap) and, for ArrayBuffers, an instance with its own capped `WebAssembly.Memory` | `huge allocation`, `string doubling` |
| Stack overflow | `setMaxStackSize(256 KB)`, below the host stack; a host-side overflow poisons the module (`poisoned`) | `deep recursion` |
| Floods | at most 64 timers (the core's macrotask hop has its own channel), 4 fetches in flight, 100 logs, 4 renders and 64 `EVENTS` per entry, 1 MB per message, 5,000 nodes, depth 128, 1 MB of text | `timer flood`, `hostile render` (6,000 nodes) |
| Prototype pollution of the host | separate realm; the host only `JSON.parse`s strings. `__proto__` in a message stays an own data property. Spread or `structuredClone` it, never `Object.assign({}, data)` | `prototype pollution` |
| Malformed or cyclic trees | ids must be guest-created nodes; a node placed inside itself, too many nodes or bad JSON kill the sandbox (`protocol`) | `hostile render` |
| Cross-tenant reads (SSR) | a fresh runtime per request; contexts share no objects | `ssr: tenants share nothing` |

### 1.3 What it grants

Capabilities are host functions with host-side checks. The guest kernel wraps them as Sygnal
drivers:

| Driver / global | Backed by | Host-side policy |
|---|---|---|
| `DOM` | `sygnal/host`'s `makeHostDriver` on a `HostDocument` (selectors, isolation, `Collection`) | the mirror's allowlist and limits |
| `STATE` | the core's own | none needed |
| `EVENTS` | an in-guest bus (`eventBusDriver` needs `EventTarget`); each event also goes to the page | JSON only (functions dropped, dates stringified), at most 64 per entry, 64 KB each. They arrive as `emit` DOM events on `<Sandboxed>`. The host must treat them as untrusted input (§9 Q3) |
| `PROPS` | data from the page (`input` on `<Sandboxed>`, `setProps`) | JSON |
| `HTTP` | the core's `makeFetchDriver({fetch})` over a Response-shaped capability | an allowlist of URL prefixes (same origin, path under the prefix, no userinfo), GET unless the page allows more, `credentials: 'omit'`, `redirect: 'error'` (a redirect could leave the allowlist), accept/content-type headers only, response size capped. The page re-checks in worker mode |
| `setTimeout` / `setInterval` / `setImmediate` / `requestAnimationFrame` | host timers | ≥ 4 ms, at most 64 pending, each callback under the deadline |
| `console` | host log | 100 lines, 4 KB each |
| `navigate(href)` | the page | the page decides (confirm, open a tab, ignore) |

Not granted: storage, cookies, focus control, clipboard, `ELEMENT` commands on the real DOM,
other drivers. Each one would be a new capability with its own policy.

### 1.4 Residual risks (not solved here)

- **Phishing inside the box.** A guest can draw a convincing form, though not a password field,
  and the user can type into it. Mitigation is product-level: a visible frame or label for
  generated content.
- **Exfiltration through granted channels.** The allowlisted API, `EVENTS` the host logic acts
  on, and links the user clicks. The capabilities are the policy.
- **Timing side channels.** The guest has `Date.now()` (QuickJS's own) but no
  `performance.now`, `SharedArrayBuffer` or threads. It shares the page's process. For
  process-level isolation from page secrets, use a cross-site iframe (Site Isolation), not any
  in-process sandbox.
- **Bugs in QuickJS or the bridge.** QuickJS is a large C engine compiled to WASM. A memory-safety
  bug stays inside the instance's linear memory, which is one more reason for an instance per
  sandbox. The bridge is about 300 lines of JS that parse JSON and check strings.

## 2. Architecture

```
 page (trusted)                                     │  QuickJS context (untrusted)
                                                    │
 <Sandboxed source input capabilities> ──defineWidget──▶ createSandbox
   mirror.js: sanitize + apply deltas  ◀── render JSON ── guest kernel: sygnal/host HostDocument
     (real DOM under data-sandbox-root)             │      ↑ makeHostDriver (snabbdom on the host tree)
   bindEvents: delegated listeners ── {id,type,init} ──▶   HostEvent → intents → model → flush
   capability fns (timer, fetch, log, emit) ◀─ __host.* ─  drivers: DOM, EVENTS, PROPS, HTTP, timers
   'emit' / 'sandboxerror' DOM events on the tag    │      the component (CommonJS from the host's compile step)
```

- **Why a host tree and not raw vnodes:** vnodes carry functions (hooks, `on` handlers) and
  snabbdom's diff needs the previous tree. `sygnal/host` already runs the real driver contract,
  isolation and selectors on a browser-free tree. A `revision` per node moves when anything at or
  below it changes, so the kernel sends an unchanged subtree as its bare id. The delta for one
  toggled row in 100 is the path to it plus 99 ids.
- **One render per entry.** The bridge calls `__sandbox.flush()` after the entry's promise jobs.
  A checkbox click changes the tree twice (its checked state, then the patch); with one flush
  this sends one message. Renders are deltas, so the page applies every one, in order.
- **Events in-thread are synchronous.** `el.click()` → listener → into QuickJS → the core runs
  the intent → the listener returns. So the guest's `preventDefault()` reaches the real event
  (`keydown` Enter, a link it handles). The worker tier can't do this (§3).
- **The mirror keeps the real nodes by guest id,** so focus, selection and the caret survive
  re-renders. A controlled input's value is written back only when it differs.
- **The kernel's platform shims** (timers, console, microtasks) load before the core's modules,
  which read `setTimeout` when they load. The core's macrotask hop
  (`runtime.ts` `macro()`) gets `setImmediate` on its own capped channel, so a component's timer
  flood can't stall the core.

## 3. Options compared

Measured on the same guest kernel and components where possible (Node 22, and headless
Chromium 153 for the browser rows). Scores: ●●● good, ●○○ poor.

| | QuickJS in-thread | QuickJS in a Worker | SES / Compartment | ShadowRealm | sandboxed iframe | bare Web Worker |
|---|---|---|---|---|---|---|
| **No ambient capabilities** | ●●● none exist | ●●● none exist | ●●○ only what you endow (but lockdown is page-wide) | ●●○ its own globals, plus the web APIs marked `[Exposed=*]` | ●●○ opaque origin with `sandbox="allow-scripts"`; network needs a CSP (`connect-src 'none'`, `img-src`) | ●○○ has `fetch`, `WebSocket`, `importScripts`, IndexedDB; deleting globals is not a boundary |
| **Hard stop of a hostile loop** | ●○○ deadline polled per 10k ticks, not in builtins (§5.4) | ●●● `terminate()` from a watchdog (450 ms with `hardMs: 300`) | ○○○ none: the page freezes | ○○○ none | ●○○ same-process iframes share the page's thread; a cross-site one has its own process but can only be removed | ●●● `terminate()` |
| **Memory cap** | ●●● capped instance (48 MB cap: OOM in 29 ms) | ●●● same | ○○○ | ○○○ | ●○○ per process at best | ○○○ |
| **Synchronous events (`preventDefault`)** | ●●● | ○○○ async (submit and links always prevented; keys declared up front) | ●●● | ●●● | ○○○ async | ○○○ async |
| **Cold start** (counter, Chromium) | ●●○ 21 ms (+ 2–13 ms WASM compile once) | ●○○ 45 ms to first paint | ●○○ 10 ms `lockdown()` once + 56 ms Compartment boot (Node) | n/a | ●●○ ~7 ms empty iframe + the core's own evaluation in V8 | ●●○ ~6 ms + V8 evaluation |
| **Per event** (click → render on page, counter / one row of 100) | ●●○ 0.2 / 2.3 ms (guest about 12–22× V8) | ●●○ 0.3 / 2.7 ms | ●●● ~0.03 ms in the guest (V8) | ●●● V8 | ●●● postMessage < 0.1 ms + V8 | ●●● postMessage < 0.1 ms + V8 |
| **Download** (brotli) | ●○○ 194 KB `.wasm` + 45 KB kernel + 18 KB glue | ●○○ same + the worker script | ●●○ `ses` 40 KB + the core | ●●● 0 | ●●● 0 + the core in the frame | ●●● 0 |
| **Support** | ●●● any WASM: browsers, Node, Deno, edge workers (Cloudflare needs its variant) | ●●● browsers, Node (`worker_threads`) | ●●● modern JS; Sygnal runs under `lockdown()` (`Date`, `Math` endowed: compartments throw on `Date.now()`) | ○○○ not shipped: `typeof ShadowRealm` is `undefined` in Chromium 153 | ●●● browsers only | ●●● |
| **Same API for SSR / edge** | ●●● (`ssr.js`) | ●●○ | ●○○ server-side lockdown is process-wide | ○○○ | ○○○ | ○○○ |

What the table means:
- **SES** is the cheapest per event and Sygnal runs under it unchanged, which is good to know.
  But it has no answer to `for (;;) {}` or memory blowups, and `lockdown()` must run before any
  other code on the page. That is a page architecture decision, not a component feature.
- **ShadowRealm** isn't available. Its callable boundary would fit this protocol (strings in and
  out), but it has no preemption or memory limit either.
- **A sandboxed iframe** is the strongest boundary when it is cross-site (its own process), and
  it could render its own DOM. Its weak points are layout, styling, focus and accessibility
  across frames, plus async events. It only works in browsers, and a same-site iframe shares the
  page's thread, so a loop freezes the page.
- **A bare Worker** gives preemption but not capability isolation. **QuickJS inside a Worker**
  gives both, which is why it is the hostile tier.
- **QuickJS in-thread** is the only option with no ambient capabilities, a memory cap,
  synchronous events and the same code on every runtime. It costs about 260 KB brotli and 10–20×
  V8 per event, which is well inside UI budgets.

## 4. The spike

| File | What |
|---|---|
| `src/guest-platform.js`, `src/guest-kernel.js` | inside QuickJS: timers/console/microtask shims on `__host`; the core + `sygnal/host` driver, the tree serializer (revision deltas), event dispatch, drivers (`DOM`, `EVENTS`, `PROPS`, `HTTP`), a `require('sygnal')` whitelist for components; a root without `initialState` gets `{}` (the core doesn't render a stateless root) |
| `build-guest.mjs` | Rollup + terser → `dist/guest.js` (156 KB min, 52 KB gzip) |
| `src/sandbox.js` | `loadQuickJS({fresh, maxWasmBytes, wasm})`, `createSandbox(QJS, opts)`: the runtime, limits, deadline, CPU share, the bridge (`render`, `emit`, `log`, `timer`, `clearTimer`, `fetch`), crash handling (`poisoned`) |
| `src/mirror.js` | `sanitize()` (the allowlist), `createMirror()` (deltas → real DOM, limits, id prefixing, containment), `bindEvents()` (delegation, stopPropagation, submit/link policy), `treeToHTML()` (SSR through the same allowlist) |
| `src/worker-sandbox.js`, `src/worker-entry.js` | the worker tier: the page keeps the mirror and the fetch policy, the worker runs `createSandbox` without a container; a ping watchdog `terminate()`s it |
| `src/Sandboxed.js` | `makeSandboxed(QJS, kernel)` → a `defineWidget` tag: `source`, `input` (→ `PROPS`), `capabilities`, `limits`; events `emit`, `sandboxerror`; key it by the source to swap code |
| `src/generated.js` | `runGenerated(toolCall, …)`: a `render_component` tool call → compile → sandbox; a failure becomes repair feedback, the guest's `ANSWER` event resolves the tool result |
| `src/ssr.js` | `renderSandboxedToHTML(QJS, {kernel, source, props})`: a fresh runtime per request |
| `src/compile.js` | the host-side compile step (esbuild: JSX → `__h`, ESM → CommonJS) |
| `fixtures/model-turns.json` | two scripted model turns (no LLM call): turn 1 touches `document`, turn 2 is the repair |
| `test/*.test.mjs` | 29 tests: render (6), escape (12), capabilities (2), widget (2), generated (1), worker (3), SSR (3) |
| `bench.mjs`, `bench-browser.mjs`, `browser/page-entry.js` | the numbers below |
| `probes/` | `deadline.mjs`, `stack.mjs` (where the stack limit turns into a crash), `json-debug.mjs` (the 10k-tick poll), `oom-debug.mjs` (ArrayBuffers vs the limit), `kernel-parse.mjs`, `kernel-size.mjs`, `kernel-rollup.mjs`, `ses.mjs` |

### The generated-component flow (`test/generated.test.mjs`)

1. Scripted turn 1: a `render_component` call whose view sets `document.title`.
2. `runGenerated` compiles it and boots it in the sandbox. The view throws inside QuickJS, and
   the core reports SYG406 through the guest console.
3. That error becomes the tool result
   (`… ReferenceError: 'document' is not defined`). Nothing reached the user, and the failed
   sandbox left no DOM behind.
4. Scripted turn 2, the repair: a tip calculator with buttons, a controlled number input and
   `ABORT` for invalid input.
5. It renders from `PROPS` (`{bill: 84.5, currency: 'EUR'}`). The test clicks 20 %, types 3
   people and checks "Each pays EUR 33.80", then clicks "Use this". The guest's
   `EVENTS {type: 'ANSWER'}` resolves the tool result: `{pct: 20, people: 3, each: 33.8}`.

This is the shape PLAN-9's `ask` cards already have (D454: the card's answer is the tool
result). The difference is that the model wrote the card instead of composing it from the
catalog.

## 5. Numbers

Node 22.22 (V8) on the session's Linux container, jsdom for the page DOM; headless Chromium 153
(Playwright 1243 build) for the browser rows. Medians unless noted.

### 5.1 Size (KB)

| file | raw | gzip -9 | brotli |
|---|---:|---:|---:|
| quickjs `.wasm` (release-sync) | 491.3 | 228.1 | 194.4 |
| quickjs-ng `.wasm` (release-sync) | 516.2 | 243.2 | 207.3 |
| `quickjs-emscripten-core` + variant glue (JS) | 56.7 | 15.5 | 13.9 |
| page side: glue + `sandbox.js` + `mirror.js` | 64.8 | 20.1 | 18.0 |
| guest kernel (core + `sygnal/host` + kernel), evaluated in QuickJS | 156.4 | 52.0 | 44.6 |
| for comparison: `ses` (`ses.umd.min.js`) | 232.1 | 47.1 | 40.1 |

The kernel was 203 KB when bundled with esbuild; Rollup keeps 156 KB (`probes/kernel-rollup.mjs`).
In the esbuild build, `dist/index.esm.js` was 118 KB of it. `@tanstack/virtual-core` (22 KB,
`<VirtualCollection>`, unused here) and `get-intrinsic` & co. (the globalthis shim's
dependencies) were kept as well (`probes/kernel-size.mjs`). A slim core entry for the guest
would cut parse time in proportion (§5.2).

### 5.2 Cold start (ms)

| step | Node | Chromium |
|---|---:|---:|
| fetch the `.wasm` (local server) | – | 5–12 |
| `WebAssembly.compile` (once per page) | 1.6–2.0 | 2.4–13.4 |
| instantiate with its own capped Memory (compiled module reused) | 1.1–2.7 | 2.2–5.5 |
| new runtime + context | 0.17 | – |
| evaluate the guest kernel (156 KB): **parse is 20.3 of 20.9 ms** | 20.6 | – |
| `createSandbox` → first render on the page, counter | 23.1 | 21.2 |
| same, 100-row `Collection` | 42.2 | 36.8–39.6 |
| worker tier: create → first paint, counter / 100 rows | 84 | 45 / 61 |

Almost all of a boot is QuickJS parsing the kernel. quickjs-emscripten 0.32 can compile without
running (`compileOnly`) but doesn't expose `JS_WriteObject`/`JS_ReadObject`, so compiled bytecode
can't be reused across contexts. A custom variant with a bytecode cache would bring boot to about
3 ms (§9 Q6).

### 5.3 Per event (ms; a click on the page → the guest's render applied to the page)

| | median | p95 |
|---|---:|---:|
| in-thread, counter (Node / Chromium) | 0.32 / 0.2 | 0.49 / 0.4 |
| in-thread, one toggle in a 100-row Collection (Node / Chromium) | 3.2 / 2.3 | 3.4 / 2.6 |
| in-thread, counter, guest call only (`sb.dispatch`, mirror included) | 0.21 | 0.30 |
| the same guest in V8 (`node:vm`), guest side only: counter / 100 rows | 0.016 / 0.14 | 0.027 / 0.24 |
| SES Compartment (V8), guest side only: counter | 0.027 | – |
| worker tier, counter (Node / Chromium) | 0.39 / 0.3 | 0.59 / 0.6 |
| worker tier, 100 rows (Node / Chromium) | 3.6 / 2.7 | 4.0 / 3.2 |
| bare worker echo (Node / Chromium) | 0.04 / < 0.1 | – |
| sandboxed iframe postMessage echo (Chromium) | < 0.1 | 0.1 |

(Chromium's `performance.now()` is coarsened to 0.1 ms.) QuickJS costs 12–22× V8 per event. The
100-row case is dominated by the host driver's event delegation: every `Collection` item adds
its own `click` delegate, and each event walks all of them with a selector match per ancestor.
That is fine in V8 (0.14 ms) but visible in QuickJS. An index of delegates by scope would help
`sygnal/host` everywhere (terminal, agent UI), not only here.

### 5.4 Deadlines and limits under attack (`probes/deadline.mjs`, `callMs: 100`)

Each case runs in its own process with a 15 s hard timeout. "reducer threw": the guest ran out of
memory, the core caught it (SYG216) and the sandbox lives on inside its limit.

| case | heap limit 16 MB | heap limit 64 MB | heap 16 MB, instance capped at 48 MB |
|---|---|---|---|
| loop | 111 ms, timeout | 111 ms, timeout | 115 ms, timeout |
| objects to the limit | 127 ms, timeout | 135 ms, timeout | 136 ms, timeout |
| typed arrays to the limit (core catches) | 5535 ms, reducer threw out of memory (SYG216) | 1071 ms, reducer threw out of memory (SYG216) | 29 ms, reducer threw out of memory (SYG216) |
| typed arrays to the limit (guest catches) | 2491 ms, none | 974 ms, none | 38 ms, none |
| regexp backtracking | 110 ms, timeout | 111 ms, timeout | 111 ms, timeout |
| sort 200k | 113 ms, timeout | 113 ms, timeout | 113 ms, timeout |
| repeat + split 8M | 108 ms, reducer threw out of memory (SYG216) | 298 ms, reducer threw out of memory (SYG216) | 115 ms, reducer threw out of memory (SYG216) |
| JSON round trip, 10k rows | **> 15 s (process killed)** | **> 15 s (process killed)** | **> 15 s (process killed)** |
| JSON round trip, 100k rows | **> 15 s (process killed)** | **> 15 s (process killed)** | **> 15 s (process killed)** |

- Plain loops, object floods, regexp backtracking and sorts stop at the deadline (QuickJS's
  regexp engine polls the interrupt handler).
- **Loops over slow builtins don't.** The handler is polled once per 10,000 ticks, and a
  `JSON.stringify` of 10k rows is one 40 ms tick, so the first poll comes after
  10,000 × 40 ms ≈ 57 s (`probes/json-debug.mjs`: 57 s for quickjs, 78 s for quickjs-ng; a loop
  of 1 ms builtins takes 2.3 s). A custom build with a smaller `JS_INTERRUPT_COUNTER_INIT` (and
  polls inside JSON/sort) would narrow the gap. Only the worker tier closes it.
- **Without a capped instance, reaching the memory limit takes seconds** (the WASM memory grows
  toward 2 GB because ArrayBuffers aren't counted, `probes/oom-debug.mjs`: 2–4 GB RSS). With a
  48 MB capped instance it takes 29 ms.
- In Chromium, an in-thread endless loop froze the page for 103–104 ms before the kill.

### 5.5 Memory

- QuickJS heap after boot, 100-row list: 1.6 MB (the kernel is most of it).
- RSS per sandbox in Node (jsdom page included): 2.4 MB with its own instance (16 MB initial
  linear memory, mostly untouched), 1.2 MB as a runtime on a shared instance.

## 6. Findings worth acting on (outside the spike)

1. **`sygnal/host`: `HostSource.events(type, options)` ignores `options`.** The DOM driver honours
   `{ preventDefault: true }` (`EventDelegator`), but the host driver drops it
   (`src/host/driver.ts` `events(type, _options)`). An intent written for the DOM silently stops
   preventing in the terminal, agent UI and sandbox targets.
2. **`sygnal/host` event delegation is O(delegates × depth) per event.** See §5.3.
3. **The loop guard defers a flush after `HARD = 1000` flushes in one macrotask**
   (`runtime.ts`). 1,000 synchronous clicks in one task (a benchmark, or a host replaying events)
   left the last render one macrotask late. That is correct behaviour, but the benchmarks here
   yield every 100 events because of it, and a sandbox host replaying a batch must do the same.
4. **A root component without `initialState` never renders** (`instance.ts`: no state, no view).
   This is documented in the code, but it surprises generated code, which often has no state. The
   kernel defaults it to `{}`. Worth a dev diagnostic for a root?
5. **The package has no `sideEffects` field.** esbuild kept 47 KB more of `dist/index.esm.js` than
   Rollup did for the same entry. If the modules really are side-effect free (as PLAN-6/9 state for
   `sygnal/ai`), declaring it would help esbuild and webpack users, not only this kernel. To verify
   before acting.
6. **`Object.assign({}, data)` on a parsed message sets the copy's prototype from a `__proto__`
   key.** The sandbox's own code spreads instead, and docs for `EVENTS` from untrusted senders
   should say so.

## 7. D209 and packaging

- **`quickjs-emscripten-core` + `@jitl/quickjs-wasmfile-release-sync`** are actively maintained
  and heavy (0.5 MB of WASM), and rarely needed. Under D209 that makes them **optional
  `peerDependencies` behind a subpath**, `sygnal/sandbox`, the way `sygnal/react` does it.
  The full `quickjs-emscripten` package would pull in all four variants (debug and asyncify),
  so depend on the core package plus one variant and let users swap in quickjs-ng.
- **The core: 0 bytes.** Everything is outside `src/core/`; the kernel uses only public exports
  (`run`, `makeFetchDriver`, `sygnal/host`). The one core change worth considering is §6.1, and
  it's in `sygnal/host`.
- **The guest kernel is the D209 question.** It bundles `xstream`, `snabbdom` and
  `@tanstack/virtual-core` into one script that runs inside QuickJS. A prebuilt kernel shipped in
  Sygnal's npm package is exactly "bundling maintained third-party code" (only the UMD build may).
  Options:
  - **(a)** `sygnal/vite` builds the kernel from the app's installed packages
    (`import kernel from 'sygnal/sandbox/kernel?raw'` resolved by the plugin, like the existing
    `api` option's nested build), so patches arrive through npm and `npm audit` sees them;
  - **(b)** ship it prebuilt, documented as the second exception next to the UMD build;
  - **(c)** the app builds it with a provided `buildSandboxKernel()` (Rollup/esbuild), as this
    spike does.

  (a) is consistent with D209 and costs the plugin an entry. The spike used (c). §9 Q1.

## 8. Recommended direction

1. **`sygnal/sandbox` (dev preview)**:
   - `createSandbox`, `<Sandboxed>`, `loadQuickJS({maxWasmBytes})`, `treeToHTML` / SSR, and the
     worker tier as an option (`isolation: 'thread' | 'worker'`) behind one API.
   - Defaults: an instance per sandbox with a 64 MB cap; heap 32 MB; stack 256 KB; boot 1 s,
     100 ms per entry; CPU 50 %; the allowlist above.
   - Keep the protocol (render deltas by host node id, events by id) internal and versioned. It
     is the part a native or edge host would reimplement.
2. **`sygnal/ai`**: a client tool `render_component` (or a `compose` part kind `generated`) that
   runs the model's code in-thread. Errors become the tool result for a repair turn, and the
   card's answer is `EVENTS {type: 'ANSWER'}`. This breaks PLAN-9's invariant "no model output
   becomes markup or action names", deliberately and only inside the box. §9 Q2.
3. **Fix §6.1 and §6.2 in `sygnal/host`**, which help every target.
4. **Then measure the custom QuickJS variant** (bytecode cache, a smaller interrupt counter),
   because it removes most of the cold start and narrows the deadline gap. Only if the
   maintainer accepts owning a WASM build (§9 Q6).
5. **Not now:** SES. It is good per event and Sygnal runs under it, but it is a page-wide
   decision with no loop or memory control. Also not ShadowRealm, which hasn't shipped.

## 9. Questions for the maintainer

1. **Kernel packaging and D209** (§7): build it from installed packages in `sygnal/vite` (a), ship it
   prebuilt as an exception (b), or leave it to apps (c)?
2. **Generated code vs PLAN-9's "the model only chooses"**: is a sandboxed `generated` part (or a
   `render_component` client tool) in scope for `sygnal/ai`, and as which: an opt-in for chat cards
   only, or for `compose` too?
3. **`EVENTS` from a sandbox are untrusted input.** Should `<Sandboxed>` require declared event
   types with schemas (`emits: { ANSWER: schema }`, Standard Schema as `form` does), so the host
   intent only ever sees validated data?
4. **Styling.** Guest classes are kept, so the page's design system styles generated UI, and the
   guest can only use inline style. The alternative is prefixing classes (full CSS isolation, no
   design system). Which default? Should a guest stylesheet (sanitized CSS) be a capability?
5. **Focus and accessibility.** The mirror doesn't move real focus (`autoFocus`, focus commands),
   so a guest can't steal focus, but it also can't manage focus in a dialog. Is focus a
   capability to add (scoped to the box)?
6. **A custom QuickJS variant** (bytecode cache: boot from ~21 ms to ~3 ms; a smaller interrupt
   counter and polls in JSON/sort: a tighter in-thread deadline). Worth owning a WASM build?
   Otherwise stay on stock `@jitl/*` packages.
7. **Default tier.** In-thread (sync events, accidents only) for generated code and the worker
   for everything else, or the worker everywhere and accept async events?


---

## Maintainer decisions (2026-10-30)

Reviewed on the research decisions page. Unless a line says otherwise, the recommendation was approved as written.

- Q1 kernel: `sygnal/vite` builds it from the app's installed packages, and `buildSandboxKernel()` covers non-Vite apps. Not shipped prebuilt.
- Q2 generated code in `sygnal/ai`: **changed.** Spike a `compose` part kind for generated components now, and include it if it works well. The fallback is the recommendation: an opt-in `render_component` client tool for chat cards only, with errors returned for a repair turn.
- Q3: `<Sandboxed>` requires `emits: { TYPE: schema }` (Standard Schema). Undeclared or invalid events are dropped, with a dev warning.
- Q4: keep guest class names by default, with a prefix option. No guest stylesheets for now.
- Q5: focus is a capability scoped to the box, off by default, and only effective while focus is already inside it.
- Q6: no custom QuickJS build. Stay on the stock `@jitl/*` packages.
- Q7: the default tier is the Worker (`isolation: 'worker'`). In-page is an opt-in, documented as being for model-written code, not hostile code.
- §6 findings: all approved for fixing. Host `preventDefault` (together with web-worker Q-WW-2), host delegation indexed by event type, a dev diagnostic for a root without `initialState`, a verified `sideEffects` allowlist, and spreads instead of `Object.assign` on untrusted data.
