# A whole Sygnal app in a Web Worker

Research + spike, 2026-10-29, branch `claude/explore-web-worker-a598d6` (cut from `claude/advanced-integration`, the 7.2.0 dev preview with `sygnal/host`). This is research, not a plan of record. IDs here (D-WW-n decisions, Q-WW-n questions) are local to this folder.

**Short answer.** It works, and the app code doesn't change. `examples/todomvc` (views, intents, models, Collection, Transition, refs, autoFocus, `processForm`, its localStorage and hash-router drivers) runs in a module Web Worker on `sygnal/host`. A ~220-line page bridge applies one message of patch ops per flush to the real DOM and forwards events. The same 17-step browser script passes on the main-thread build and the worker build in Chromium, Firefox and WebKit. A jsdom test drives 120 seeded random actions and checks that the page DOM equals the worker's host tree after each one. The core needed **one fix** to run in a worker at all (`src/cycle/run/adapt.ts`, §6).

The trade is the one every earlier worker renderer found: **responsiveness for latency**. While the worker does heavy work, the page stays at 60 fps and keystrokes paint in one frame (a CPU-heavy streaming reducer: 0 long tasks instead of 40, and keystroke p95 of 16 ms instead of 64 ms). Every app response costs about one extra frame (+15–17 ms for a click in a small app), plus copying data the page-side drivers need. The decisions that must be synchronous (`preventDefault`, layout reads) can't be made in the worker; they become data the page reads, as declarations or attributes. **Verdict:** worth shipping as an opt-in pair of subpaths for apps with heavy models (AI streaming and parsing, big Collections, data crunching). Not a default, and not for small apps (§5).

---

## 1. Prior art

| Project | What runs where | How sync DOM needs are met | Blockers it hit / documents |
|---|---|---|---|
| **WorkerDOM** (AMP, 2018–) | the author's code + a DOM implementation in a worker; mutations transferred to the page in batches; events back | not at all: it lists `preventDefault()` and `getBoundingClientRect()` as unimplemented ([compat table](https://www.github.com/ampproject/worker-dom/blob/main/web_compat_table.md)); its early design offered `…Async` variants returning promises ([Malte Ubl's talk](https://speakerdeck.com/cramforce/workerdom-javascript-concurrency-and-the-dom?slide=43)) | `preventDefault`, layout reads, focus/selection; AMP used it with limits on what scripts may do (`amp-script` needs a user gesture to mutate) |
| **Partytown** (Builder.io/Qwik) | third-party scripts in a worker, against a proxied `window`/`document` | **synchronous** access, via `Atomics.wait` on a SharedArrayBuffer (needs cross-origin isolation) or a synchronous XHR answered by a service worker; Atomics is ~10× faster ([how it works](https://partytown.qwik.dev/how-does-partytown-work/), [trade-offs](https://partytown.qwik.dev/trade-offs/)) | every DOM read blocks the worker on a round trip, so it's throttled; `event.preventDefault()` has no effect; scripts that insert many nodes or must block the page are a poor fit |
| **Comlink** (Google Chrome Labs) | any object in a worker, as an async proxy (`await api.method()`) | none: RPC with promises, `transfer()` for buffers | not a renderer; the off-main-thread pattern it promotes is "compute in a worker, UI on the page" (Surma's posts); every call is async |
| **preact-worker-demo**, **react-worker-dom**, diffHTML worker middleware (2016–17) | the whole component tree and diff in a worker; serialized DOM changes to the page, events back | none | Jason Miller's demo replaced elements by ids on both sides; the React experiments found [postMessage per mutation too slow (batch it), and the worker slower than react-dom for small apps but faster for DBMonster-sized trees](https://github.com/STRML/react-worker-dom); in [preact#417](https://github.com/preactjs/preact/issues/417) the counterargument: the DOM operations, not the diff, are the cost, and they stay on the page |
| **React Native, old architecture** | the JS thread runs React; the native UI thread renders; an async JSON bridge between them | none (async only), until JSI | the canonical controlled-`TextInput` echo problem (JS answers keystrokes late and resets the text), solved with an event count: a JS value is applied only if JS had seen every native event; layout reads async (`measure` callbacks). The new architecture (JSI, Fabric) made layout and some events **synchronous** again, because async was the main source of jank |
| **Lynx** (ByteDance) | "dual-thread": main-thread script for first frame and gestures, background thread for the app | lets a component mark a handler to run on the **main thread** (main-thread scripting) | exactly the sync-decision problem, solved by moving that small piece of code to the page |
| **Flutter isolates** | UI in the root isolate; `compute()`/`Isolate.run` for heavy work; no shared memory, messages are copied | not needed: rendering stays on the UI isolate | the cost model of copying data between isolates; Flutter keeps the UI where its inputs are and moves only work off |
| **Neo.mjs** | the app (components, state) in an "App worker", vdom diff in a "VDom worker", the page applies deltas | delta batches, events forwarded | the most complete framework doing this today; same latency/responsiveness trade |

The blockers are the same everywhere: (1) **`preventDefault`/`stopPropagation`**, which must be decided during dispatch; (2) **synchronous layout reads** (`getBoundingClientRect`, `offsetHeight`, scroll positions); (3) **focus and selection**, which the page owns; (4) **controlled inputs**, where late values overwrite newer typing; (5) **input-to-paint latency**: one round trip more for every response; (6) DOM-only APIs (storage, history, clipboard, media, custom elements, third-party widgets). Two families of answers exist: make it synchronous (Partytown's Atomics, RN's JSI, Lynx's main-thread scripts), or keep it async and move the decisions into data the page can read (WorkerDOM, Neo, this spike). Sygnal is an unusually good fit for the second family: views never bind handlers (intents select events by CSS), so no closure has to cross threads, and the core already speaks a driver contract with no DOM in it.

---

## 2. Design

```
 page (main thread)                                     worker
 ┌──────────────────────────────┐   {ops, ack, listen?}  ┌───────────────────────────────────────┐
 │ bridge                        │ ◀───────────────────── │ worker target                          │
 │  apply ops → real DOM         │   one per flush        │  HostDocument (sygnal/host)            │
 │  events → {seq,type,id,init,  │                        │  makeHostDriver: snabbdom + Sygnal's   │
 │            state}             │ ─────────────────────▶ │   modules on the host tree             │
 │  sync decisions (preventDefault)│   {ev:[…]}  {sync}     │  diff host tree → ops (revisions)      │
 │  page drivers (STORE, ROUTER) │ ◀── {drv,sink} ──────── │  remote(name): sink → page,            │
 │                               │ ─── {emit,v} ─────────▶ │   source ← page                        │
 └──────────────────────────────┘                        │  run(App, {DOM, STORE, ROUTER, HTTP…}) │
                                                         └───────────────────────────────────────┘
```

### 2.1 Wire format: host-tree patch ops, not vnodes (D-WW-1)

The worker renders exactly as the terminal target does: `makeHostDriver(doc)` patches a `HostDocument` with snabbdom and Sygnal's own modules, so keyed lists, refs, `autoFocus`, `<Transition>` and the controlled-input module all run unchanged. After a change, the worker **diffs the host tree against what it last sent** and posts flat op tuples:

| op | tuple |
|---|---|
| create element / text | `[0, id, tag]`, `[1, id, data]` |
| a parent's children | `[2, parentId, childIds]` (the page removes the missing ones, then makes one pass of moves and inserts) |
| attribute, property, text, style | `[3, id, name, value\|null]`, `[4, id, 'value'\|'checked'\|'selected', v]`, `[5, id, data]`, `[6, id, key, v\|null]` |
| focus | `[7, id\|0]` |
| free | `[8, ids]` (detached and not reinserted this flush) |

The diff uses `sygnal/host`'s change tracking (round 4): every mutation moves `revision` on the node and its ancestors, and `attrRevision` on attribute, class, style and dataset changes. The walk skips every subtree whose revision didn't move, so a toggle on one of 10,000 rows visits the root-to-row path plus one comparison of the list's child ids. It needs **no change to `sygnal/host`**: the diff reads the public tree (`attributes`, `style`, `value`, `checked`, `childNodes`, `nodeId`).

Why not ship the vnode and run snabbdom on the page:
- **Size:** Sygnal emits the whole tree's vnode per flush, so its JSON (without elements, hooks and functions) is 2.1 KB / 665 KB / 6.7 MB per flush at 0 / 1k / 10k todos, against the ops' 0.1–1.5 KB for a one-row change (§4.2).
- **Main-thread work:** the diff and Sygnal's modules would run on the page again, which is most of what we want to move.
- **Functions:** vnodes carry hooks (refs, autoFocus, Transition, widgets) and component functions, which can't be cloned.

Ops are applied in order with no reads, so the page side is a loop over a flat array. The page's only per-op cost is the DOM call itself.

**Batching (D-WW-2): one message per flush, frame-coalesced when busy.** `doc.onChange` (one microtask after any change) schedules the flush on a `MessageChannel` macrotask, after Sygnal's flush, the EFFECTs' writes and `autoFocus`. If a message went out less than a frame (16 ms) ago, the flush waits for the rest of that frame. Without that, the initial render's 10,000 `<Transition>` timers produced 1,160 three-op messages, each walking the 10k-child list, for ~500 ms of worker time. Before handling a page event, the worker flushes any pending changes first (D-WW-3, §2.3).

### 2.2 Events (D-WW-4)

- **Which events cross.** The worker sends the event types its intents listen for (`doc.delegates`) with each flush whose set changed. The page listens for those in the capture phase on the mount, plus `input`, `change`, `focus` and `blur` always: the host tree's copy of field values and focus must follow the page even when no intent listens (`processForm` reads the worker's form on submit).
- **What crosses.** `{seq, type, id, init, state}`: the nearest bridged element's id, the event's plain fields (`key`, `keyCode`, modifiers, pointer coordinates, `inputType`, `data`, `detail`, …) and the target field's `value`/`checked` at dispatch time. No DOM objects cross. The worker writes the state into the host element (recorded as already sent, so there's no echo) and dispatches a plain `HostEvent` of the same type. It never uses `activate()` or `pressKey()`, because the browser already ran the default action (typed, toggled, submitted).
- **Synchronous decisions.** `preventDefault()` and `stopPropagation()` in the worker come too late for the browser. That breaks `processForm`, which prevents a submit's navigation, so the default bridge **prevents every `submit` in the mount**: no Sygnal form wants the browser's submit. Other cases are declared on the bridge as `[type, selector]` pairs (`['click', 'a[data-route]']`, `['keydown', '.menu [role=menuitem]']`, `['dragover', '.dropzone']`).

  Events that need this: `submit`, clicks on client-routed links, keys an app consumes (Tab trapping, arrows in a listbox, Enter in a textarea), `contextmenu`, `dragover`/`drop`, `wheel`/`touchmove` when the app scrolls itself, `beforeinput` and `paste` for input masks.

  A decision that depends on state ("prevent Tab only while the menu is open") becomes **data in the tree**: the view renders an attribute (`data-prevent="keydown"`), and the page reads it synchronously. The declarative form already exists in the intent API Cycle inherited, `DOM.select(sel).events(type, { preventDefault: true })` (`src/cycle/dom/fromEvent.ts`). The host driver ignores that option today. Recording it on the delegate would let the worker mark matching elements in the ops, so the declaration sits in the intent (Q-WW-2; not built).

  `stopPropagation` inside the app still works, because the host tree dispatches through host listeners and honours `cancelBubble`. It only matters on the page for non-Sygnal listeners outside the mount.
- **High-frequency events** (`pointermove`, `scroll`, `wheel`) should be coalesced per frame on the page before crossing. Not built; todomvc has none.

### 2.3 Controlled inputs, IME and selection (D-WW-3)

While the user edits a field, **the page owns its value**. Three rules make that safe:

1. **No echo.** A value the page sent with an event is written into the host element and into the diff's "last sent" record together. The model handing back the same value produces no op (§4.2, "edit keystroke": 0 ops).
2. **Flush before the next event.** The worker sends its pending writes before it applies a page event's form state. Otherwise the page's state overwrites a worker write that was never sent (the EFFECT clearing the new-todo field, while the next keystroke is already queued), and the clear is lost entirely. The functional test found this.
3. **Rebase instead of drop.** Each flush carries `ack`, the last page event the worker had handled. If the user has edited the field since `ack`, the worker's value is a decision about older text. React Native's rule (apply only if the native event count matches) **drops** it, so "Buy milk", Enter, "W" leaves "Buy milkW" in the field: the clear never happens. Applying it as is loses the "W". The bridge does a three-way merge instead: base (the value the page sent at `ack`), mine (on screen) and theirs (the worker's). The user's edit since the base is reapplied to the worker's value, anchored to the end when the user typed at the end, so the result is "W". The page then sends `{sync}` so the host's copy follows. Covered by `mirror.test.ts`.

**IME:** no value writes to a field between `compositionstart` and `compositionend` (the composition's `input` events still cross). **Selection:** a value is written only when it differs, so the caret stays put during normal typing. A rebase moves the caret to the end (not preserved yet; Q-WW-4).

**The residual race:** a user who types a whole word **and** presses Enter inside one worker round trip submits what is on screen ("Buy milkWalk dog"). At Playwright's default 0 ms per key, the functional test hit it. At 20 ms per key (50 keys/s, three times a fast typist) it doesn't. A real fix would hold a submit on the page until the worker has acknowledged the field's last edit (Q-WW-3).

### 2.4 Drivers: which move, which stay (D-WW-5)

| In the worker (the API exists there) | Must stay on the page |
|---|---|
| `makeFetchDriver`/HTTP (`fetch`; XHR for upload progress), `sygnal/api` clients | `localStorage`/`sessionStorage` (not in workers): todomvc's STORE |
| SSE, WebSocket, `sygnal/ai` (`makeChatDriver` streams over fetch) | `location`/`history`/`hashchange` routing (the worker's `location` is its script URL): todomvc's ROUTER |
| timers, `xs.periodic`, IndexedDB, `crypto`, `BroadcastChannel`, `navigator.onLine` | clipboard, view transitions (`document.startViewTransition` must wrap the DOM update: an op flag that makes the page apply that batch inside the callback) |
| parsing, validation (Standard Schema), formatting, search indexes | `makeBrowserDriver` sources (`matchMedia`, visibility, resize, scroll), Intersection/ResizeObserver, geolocation, fullscreen, notifications permission, file pickers |
| an `OffscreenCanvas` handed over by the page | drag and drop (`processDrag` reads `dataTransfer` during the event), media playback, WebMCP (`navigator.modelContext`), `sygnal/element`, `sygnal/ui`'s native `<dialog>`/popover methods, `defineWidget`/`fromReact`/`fromZag` widgets (third-party code on real elements) |

The bridge hosts page drivers by name, and the worker reaches them with `target.remote(name, methods?)`. Sink values are posted to the page driver's sink. The source is a stream (`remote('ROUTER')`) or an object whose methods return streams (`remote('STORE', ['get'])`); subscriptions are opened and closed by message. Values must be structured-cloneable. This costs something: todomvc's `TO_STORE` writes the whole todo list on every state change, so every keystroke in an edit field clones 55 KB (1k todos) or 568 KB (10k) to the page. In a worker app that persistence belongs in the worker (IndexedDB) or debounced.

### 2.5 Refs and element commands

`createRef().current` is the **host** element in the worker. Reading `value`/`checked`, setting `value` (todomvc's EFFECT clears the input through its ref), `classList` and `focus()`/`blur()` work: they are host-tree changes and become ops. Methods with a result or a page-only effect (`getBoundingClientRect`, `scrollIntoView`, `select`, `setSelectionRange`, `showModal`, `play`) can't run on a host element. The spike has `target.call(el, method, ...args)`, which flushes and then resolves with the page's answer (a `DOMRect` comes back as JSON), so measurement is **async**, as in every earlier worker renderer. Two extensions are worth building: fire-and-forget commands queued as an op in the next flush, so they are ordered with the patch that created the element; and page-originated state the page changes by itself (a `<dialog>` closed by Escape, `<details>` toggled), synced back as attribute changes through a MutationObserver on a small attribute list (Q-WW-5).

### 2.6 SSR hydration (not built)

The server's HTML is on screen before the worker starts. A hydrating bridge would apply the worker's first message (all creates, in pre-order) by **adopting** the existing nodes in the same order: tag and text match → map the id to the node and apply only attribute differences; a mismatch → replace that subtree. Until the worker is ready, the page queues events with their form state and replays them (the event-replay technique Angular and Qwik use), so a click during boot isn't lost. Hydration then costs no main-thread rendering at all: the first message is mostly ids. It's the same adopt-by-order walk `sygnal/vike` and Astro's hydration would need.

### 2.7 Devtools, diagnostics, HMR

Diagnostics run where the app runs. Console output from the worker shows in the browser's devtools under the worker's context, and the dev entry's checks (`checks/next.ts`) work on vnodes and sources, not the DOM. The devtools panel (`sygnal/devtools`) talks to the page's `window.__SYGNAL_DEVTOOLS__`, so in a worker its hook layer would have to post through the bridge's channel, and the bridge would re-expose it on the page. The runtime API (`setState`, `getState`, `dispatch`, `flushed`) is the natural surface to relay. Vite reloads a changed worker module whole, so HMR loses state unless the bridge carries `getState()` across the reload. None of this is built.

### 2.8 `renderComponent` tests stay unchanged

The app code doesn't change, so neither do its tests: `renderComponent` runs components on its mock DOM in one thread, and the worker is wiring in the entry file (a page module and a worker module instead of `run(App, drivers)` in `index.html`). What's worth testing in the bridge itself (the op diff, events, rebase) is covered in jsdom with the target and the bridge on one `MessageChannel` (`spike/mirror.test.ts`). A shipped version could offer that as `renderComponent(App, { worker: true })`, so an app can check that it doesn't rely on synchronous `preventDefault` or layout reads.

---

## 3. The spike

| File | Lines | What |
|---|---|---|
| `spike/src/worker-target.ts` | 287 | `createWorkerTarget(port, {stats})` → `{doc, driver, remote, call, flush, stats}`: host tree → ops diff, frame-coalesced flushes, page events → host events, page drivers by name, element calls; with `stats`, also the size of the vnode format for comparison |
| `spike/src/bridge.ts` | 216 | `startBridge(worker, mount, {drivers, preventDefault, stats})`: ops → DOM, events → worker, sync `preventDefault`, rebase of field values, IME guard, page drivers; imports only xstream |
| `spike/src/worker-env.ts` | 6 | the workaround for the core bug (§6), not needed with the fix |
| `spike/todomvc/` | 27 | `worker.ts` (`run(App, {DOM: target.driver, STORE: target.remote('STORE', ['get']), ROUTER: target.remote('ROUTER')})`), `page-worker.ts` (bridge + the two page drivers), `page-main.ts` (the baseline: `index.html`'s script); `examples/todomvc` is imported **unchanged** |
| `spike/stream/` | 59 | a heavy-model app (§4.3) for both threads |
| `spike/mirror.test.ts` | 151 | 4 jsdom tests: the mirror invariant over 120 seeded random actions, no echo, sync `preventDefault` of submit, rebase |
| `spike/functional.mjs`, `measure.mjs`, `measure-stream.mjs`, `serve.mjs`, `vite.config.mjs`, `vitest.config.mjs` | 410 | the browser checks and the benchmarks |

Run it (after the worktree setup in CLAUDE.md and `npm run build`):

```bash
node examples/todomvc/node_modules/vite/bin/vite.js build --config dev-plans/research/web-worker/spike/vite.config.mjs
node dev-plans/research/web-worker/spike/functional.mjs        # 17 checks × main, worker; BROWSER=firefox|webkit
npx vitest run --config dev-plans/research/web-worker/spike/vitest.config.mjs   # 4 tests, ~9 s (against src/)
node dev-plans/research/web-worker/spike/measure.mjs           # ~6 min; RUNS, SIZES
node dev-plans/research/web-worker/spike/measure-stream.mjs    # ~1 min
```

**Functional result:** 17/17 checks on both builds in Chromium 1243, Firefox 1543 and WebKit 2359: add (form submit kept on the page), the EFFECT clearing the field through its ref, focus kept, toggle, the count, dblclick to edit with `autoFocus` moving focus to the edit field, Enter / Escape / blur to finish an edit, `#/active` and `#/completed` through the page's router driver, Clear completed after the 300 ms leave transition, toggle all, destroy, and persistence across a reload through the page's localStorage driver. No page errors.

**What the spike found and fixed on the way:**
1. The core throws in a module worker (§6).
2. A worker write lost to the page's next keystroke → flush before applying a page event (D-WW-3).
3. A worker write dropped by React Native's stale-value rule → rebase (D-WW-3).
4. 1,160 messages from the initial render's transitions → frame coalescing (D-WW-2).
5. A checkbox's DOM `value` defaults to `"on"` and the host's to `""`. The bridge sends the page's value with the event, so `DOM.click('.toggle').value()` reads the same thing in both builds.

---

## 4. Numbers

NUMBERS_PLACEHOLDER

---

## 5. Verdict

VERDICT_PLACEHOLDER

---

## 6. Size, subpaths and D209

**The one core change (committed on this branch):** `src/cycle/run/adapt.ts`'s `getGlobal()` picked `window`, then `global`, then `this`. In a module worker none of them exists (`this` is undefined in a module), so `run()` threw `Cannot read properties of undefined (reading 'Cyclejs')` before anything rendered. QuickJS in the compile-wasm session hit the same fallback. It's now `globalThis`, which the core already uses (`runtime.ts`, `actions.ts`), and the change **saves bytes**:

| `node scripts/size-gate.mjs` | before | after | Δ |
|---|---|---|---|
| (a) kanban, `nativeGlobalThis: false` (gated) | 42,413 B | 42,401 B | **−12 B** (headroom 587 → 599 B) |
| (b) kanban, default | 38,421 B | 38,404 B | −17 B |
| (c) `src/core/**` alone | 19,153 B | 19,153 B | 0 (`adapt.ts` is outside `src/core`) |

Nothing else in the core changed. `sygnal/host` is unchanged too: the diff reads its public tree and revisions.

**Subpaths (proposed, D-WW-6):** two entries, so each thread loads only its half, and neither adds a runtime dependency (D209: none new; xstream is already one).

| Subpath | Contents | Imports | Size of the spike's code (esbuild, minified, gzip -9) |
|---|---|---|---|
| `sygnal/worker` | `createWorkerTarget(port, options)` → `{ driver, remote, call, flush }` | `sygnal`, `sygnal/host` (external) | 4.8 KB / **2.2 KB** |
| `sygnal/worker/page` (or `sygnal/bridge`) | `startBridge(worker, mount, options)` | `xstream` only (for page-side drivers' sinks) | 4.4 KB / **2.0 KB** (10.3 KB with xstream, which a page with Sygnal-style drivers loads anyway) |

The worker bundle is the app plus the core plus `sygnal/host` (`dist/host.esm.js`: 20 KB gzip unminified, with snabbdom's modules inlined). The page bundle is the bridge and the page drivers only. In todomvc, the page still pulls in the core because its drivers `import { xs } from 'sygnal'`. Page drivers written for a worker app should import `xstream` directly.

---

## 7. Open questions

For the maintainer:

- **Q-WW-1. Ship it as a dev preview?** The proposal is two subpaths (§6), with todomvc-in-a-worker as an example and a docs page "Running off the main thread", building on the existing custom-targets JSON sketch. They'd be marked experimental, like `sygnal/api`. The core fix (§6) is worth taking either way: Sygnal shouldn't throw in a module worker or in an embedded engine (compile-wasm's QuickJS guest hit the same thing).
- **Q-WW-2. Declarative `preventDefault` in intents.** Should `sygnal/host` keep the `events(type, { preventDefault })` option on its delegates, so a worker app declares sync decisions where it reads the event (`DOM.select('.menu').events('keydown', { preventDefault: (e) => e.key === 'Tab' })`)? A function can't cross threads, so only `true` or an object pattern (`{ key: 'Tab' }`, which `fromEvent.ts` already supports) would work. The change is in the host subpath, not the core.

Technical, for whoever builds it:

- **Q-WW-3. Hold a submit until the field's last edit is acknowledged**, which closes the "word + Enter inside one round trip" race (§2.3). It costs a round trip of latency on Enter only when typing is that fast.
- **Q-WW-4. Keep the caret through a rebase**: map `selectionStart`/`selectionEnd` through the same edit.
- **Q-WW-5. Element commands as ops** (`scrollIntoView`, `select`, `showModal` ordered with the patch), and a page → worker attribute sync for state the browser changes by itself (`<dialog open>`, `<details open>`, popovers). This is needed before `sygnal/ui` can run in a worker app.
- **Q-WW-6. Widgets in worker apps.** `defineWidget`, `fromReact` and `fromZag` mount third-party code on real elements, so they must run on the page. They'd be a page-side registry the bridge mounts on a placeholder element the worker renders, with props as ops and widget events forwarded.
- **Q-WW-7. Coalesce high-frequency events** (`pointermove`, `scroll`, `wheel`) per frame on the page.
- **Q-WW-8. Devtools relay and HMR**: the devtools hook layer through the bridge's channel, and `getState()` carried across a worker reload.
- **Q-WW-9. A dirty-node list in `sygnal/host`** (a `Set` of changed nodes since the last read) would make the flush O(changes) instead of O(children of each dirty parent). Today a one-row change in a 10,000-row list compares 10,000 child ids, about 0.1 ms each flush (§4.2). It only matters for very large lists.
- **Not recommended:** Partytown-style synchronous access through `Atomics.wait`. It needs cross-origin isolation (COOP/COEP headers, which break many third-party embeds), it blocks the worker on every read, and it doesn't fix `preventDefault` either: the page's dispatch can't wait for the worker.
