# Generated parts in `compose`, run in the QuickJS sandbox

Research spike for sandbox question Q2 (`dev-plans/research/sandbox/README.md` §9 and the
maintainer decisions). The question: can `sygnal/ai`'s `compose` take a **generated** part, a
component the model writes, and run it inside the QuickJS sandbox well enough to ship in the next
dev preview? If not, the fallback is the opt-in `render_component` client tool for chat cards only.

PLAN-9's invariant is "the model only chooses from components the app wrote". This spike relaxes
it on purpose, and only inside the box: the model writes the part's code, but the part reaches only
the data the app declares, and it can only send the events the app declares, each one checked
against a schema.

Branch `claude/explore-compose-sandbox`, cut from `claude/advanced-integration`. Nothing in `src/`
changes. The spike is plain JS on the public API of the built `dist/`, plus the sandbox spike's
files (`../sandbox/src`) used unchanged. One optional `src/` patch is kept as a file and not
applied (§7).

```bash
npm --prefix dev-plans/research/compose-sandbox test    # 39 tests, ~25 s (installs/builds what's missing first)
npm --prefix dev-plans/research/compose-sandbox run bench   # results/bench.md + bench.json (~2 min; RUNS=5)
```

`npm test` first runs `scripts/setup.mjs`. It installs or builds only what is missing: the root
`npm ci` and build, the sandbox spike's packages and guest kernel, and sygnal-check's parser. Then
it runs vitest in jsdom with `renderComponent(App, { dom: 'real' })`.

## Summary

- **It works, with no change to the core or to `compose`.** A generated part is an ordinary
  catalog part. Its `code` is a text param of the layout, so it comes in the same structured
  reply, schema and streaming as every other part. Its component is trusted app code that mounts
  `<Sandboxed>`, which runs in a Worker by default and in the page's thread as an opt-in. The part
  gets only the data keys its node `reads`, computed by the app's own `from(state)`. Its events
  are checked against declared Zod (Standard Schema) types before the host's intent sees them, and
  the host maps them to its own actions. The model never names a host action.
- **Partial code never mounts.** The test checks every cut of a streamed reply (80 even cuts, plus
  cuts inside each code string, just after it and just after its params). A part mounts only when
  its node's JSON object closes. It then keeps its node key from the preview to the final layout, so
  each part mounts exactly once. With 10 parts, the first one is ready after 12 % of the reply.
- **The repair loop works on every failure class tried (15).** Each failure becomes one small
  LLM request (about 3 K chars: the failing code plus one line naming the error). 13 classes are
  fixed in one turn, one needs two (fixing the first bug exposes a second), and a model that never
  fixes it is stopped after 2 attempts, with a fallback shown in that part's place only. Two
  classes never throw inside the box: `onClick` in JSX, and intent/model wiring mistakes. A check
  before mount catches them: sygnal-check plus a regex, 4–5 ms warm.
- **Fast enough.** On Node 22 with jsdom and 4 cores (medians):

  | | Worker (default) | in-page (opt-in) |
  |---|---|---|
  | first part ready, 1 / 10 parts | 177 / 390 ms | 66 / 471 ms |
  | all ready, 10 parts | 534 ms | 471 ms |
  | memory per part (RSS) | 14–22 MB | 2–3 MB |
  | click → validated event → host view patched | 1.5 ms | 1.2 ms |
  | keystroke → box re-rendered | 2.1 ms | 1.8 ms |

  The model's output time dominates everything else: about 270 tokens for each compact generated
  part, 2,670 tokens for 10, so **27 s at 100 tok/s**. A catalog-only page is under 100 tokens.
  Mounting costs are small next to that, and streaming shows each part as it completes.
- **Safety: the three sandbox findings hold on this path.**
  - ArrayBuffers stopped at 40 MB of the part's own 48 MB WASM memory, in 34 ms (worker) and
    156 ms (in-page).
  - The worker's watchdog terminated a loop over a slow builtin in 364 ms, and the page's timers
    kept running.
  - In-page, the same kind of loop overran the 50 ms deadline and froze the page for 4.9 s. That is
    why the Worker is the default.
  - Deep recursion is a QuickJS `stack overflow` (256 KB stack), not a crash, and each part has its
    own module.
  - The code reaches no page, network, storage or worker globals. Calling the bridge directly
    (`__host.emit`) still goes through the page's schemas.
- **Recommendation: include it in `compose` for the next dev preview, as an experimental opt-in**
  (`compose.generated(...)` on `sygnal/sandbox`). Defaults: the Worker tier, `maxUses: 3`,
  `maxAttempts: 2`, the check before mount on. It is not a default part of any catalog. The
  `render_component` chat card falls out of the same pieces as the one-part case, so it is not a
  separate fallback to build. Before it leaves dev preview, the open question is how often **real
  models** write working code against these rules (§9.1). This spike's model turns are scripted. §8
  has the reasoning.

## 1. Design (Q1)

```js
import {defineCatalog, compose} from 'sygnal'
import {z} from 'zod'

const gen = generated(runtime, {                       // src/generated.js
  data:  { orders: { description: 'the recent orders', shape: '[{ id, customer, total, status }]', from: (s) => s.orders } },
  emits: { OPEN_CUSTOMER: { description: 'the user picked a customer', schema: z.object({ id: z.number().int() }) } },
  // isolation: 'worker' (default) | 'thread';  maxCode: 6000;  maxUses: 10;  limits; capabilities (none by default)
})
const catalog = defineCatalog({ parts: { revenue: {...}, custom: gen.part } })
Dashboard.uses   = { page: compose(catalog, { backend: compose.llm({ instructions: gen.instructions }) }), fix: gen.repair({ maxAttempts: 2 }) }
Dashboard.intent = ({ CHILD }) => ({ OPEN_CUSTOMER: gen.events(CHILD, 'OPEN_CUSTOMER') })
Dashboard.model  = { OPEN_CUSTOMER: (state, { id }) => ({ ...state, openCustomer: id }) }
```

### 1.1 How the model sends code

- **One node per generated part,** inside compose.llm's normal reply:
  `{ part: 'custom', params: { title, reads, code } }`. In the reply schema, the part's params are
  `title` (≤ 60 chars), `reads` (at most one entry per declared data key) and `code`, a string
  capped by `maxLength: maxCode + 1`. `code` comes last in the schema, so it streams last.
- **The rules go in `instructions`** (`CODE_RULES`, 2.1 K chars of the 4.0 K-char prompt):
  - the component shape (a view, `initialState`, `intent` with `DOM` and `PROPS`, `model`);
  - "no hooks, no JSX handlers, no `document` / `fetch` / imports";
  - each data key with a shape description;
  - each event with its JSON Schema, generated from the Zod schema through Standard JSON Schema
    (`~standard.jsonSchema`).

  The prompt carries shapes only, never the user's data. A test checks that.
- **Size limits.** `maxCode` (6,000) is checked in `<Sandboxed>` before compiling. Code over the
  limit fails with reason `compile`, and a repair turn asks for a shorter part. The schema's
  `maxLength` is `maxCode + 1` because compose's own checks (`checkParams`, llm's `fixParams`)
  silently cut a text param at `maxLength`. With the extra character, cut code still reads as
  "too long" instead of mounting truncated. One more cap applies: `maxUses` (generated parts per
  page). §8 recommends 3 for the default.

### 1.2 How it mounts

- `gen.part.component` is `GeneratedHost`, a trusted Sygnal component. Each node is a child
  instance of the host keyed by its node key, as for any composed part. It renders a `<section>`,
  a title and the `<Sandboxed>` widget (`src/Sandboxed.js`, on `defineWidget`). Its local state
  (`local:`, so `slice.local[nodeKey]`) records the status, the tier and the time to ready.
- **The Worker tier is the default** (decision Q7). It is the sandbox spike's
  `createWorkerSandbox`: QuickJS in a worker, the mirror on the page, and a ping watchdog that
  calls `terminate()`. `isolation: 'thread'` is the opt-in. Each in-page part gets
  `loadQuickJS({ fresh: true, maxWasmBytes })`, its own capped instance, so both of the spike's
  memory findings apply per part (§4).
- **Compile.** esbuild compiles host-side (trusted tool, untrusted text). Then comes the check
  before mount (`src/check.js`): sygnal-check on the source in memory (`check([file], { sources })`,
  4–5 ms warm, 38 ms cold) for the wiring codes (SYG101 / 102 / 110 …), plus a regex for JSX
  `on*={…}` handlers. Any finding fails the part with reason `compile`.
- **A new `code` remounts the box in the same element.** That happens on a repair or on an edit's
  `setParams`. The sandbox spike's tag threw on a new source instead. A changed `input` crosses the
  bridge only when its JSON changed. Host renders pass a new object every time.

### 1.3 Props and data

- The node's `reads` list picks keys from the app's declared `data`. Each value is `from(state)`
  on the host state, computed by the part's `props(params, state)`, and arrives in the guest as
  `PROPS.stream`.
- An unknown name reads nothing. A test asks for `['orders', 'secrets', 'page']` and gets only
  `orders`.
- `PROPS` reach the guest before its first render. A part whose `initialState` has no data still
  renders correctly, so "reads data before it arrives" is not a failure class.

### 1.4 `emits`: required, validated, turned into host actions

- `<Sandboxed>` refuses to mount without `emits: { TYPE: StandardSchema }` (decision Q3).
- Every guest event is validated on the page.
  - **Valid:** the host gets the schema's **output**, not the guest's object. Extra keys are
    stripped, and so is `__proto__`.
  - **Undeclared type or invalid payload:** the event is dropped, with a dev warning. It is also
    reported as `rejected` to the repair loop, while the part keeps working.
- `GeneratedHost` sends `{ kind: 'emit', node, type, data }` up with `PARENT`.
  `gen.events(CHILD, type)` filters that into a stream of `{ node, ...data }`, and the host's intent
  names its own action for it. Tests check this end to end in both tiers.

### 1.5 Failures and repair (`gen.repair()`)

- Six failures are reported:
  - `compile`: syntax, the check before mount, or over the size limit;
  - `error`: the module threw while loading, such as a refused import;
  - `runtime`: the guest's `console.error`, which is how the core's SYG406 (view) and SYG216
    (reducer) reach the page;
  - `timeout`, `memory`, `cpu` and `crash`: the sandbox killed the part;
  - `empty`: no text and no control 250 ms after ready;
  - `rejected`: an event was dropped.

  Each report goes up with `PARENT`.
- The `fix` behavior answers each report with one LLM request: `key: 'fix:<hash of the code>'`, the
  repair rules, the failing code, and one line naming the error. The core's dev text around a guest
  exception is dropped, so a SYG406 reads `runtime: view threw (SYG406): ReferenceError: 'document'
  is not defined`.
- **The fix is an overlay, not a layout edit:** `fix.patches[hash(code)] = fixedCode`, and the
  part's `props()` follows the chain. The layout keeps the model's original code. A repair that
  lands while the reply is still streaming, an edit, or a restored layout all get the fix, because
  the same code always maps to the same fix.
- Attempts are counted per chain of fixes. When a chain reaches `maxAttempts` (2), it is marked
  `gave-up`, and that part shows "This part couldn't be built." The rest of the page is unaffected.

## 2. Repair loop (Q2)

`test/repair.test.js`, corpus `fixtures/code.js` `BROKEN`. Each case is a realistic first attempt,
then scripted repair replies. Results are written to `results/repair.md`.

| first attempt | reported as | turns | outcome | what the model reads |
|---|---|---:|---|---|
| syntax: an unclosed element | compile | 1 | fixed | `Transform failed … <stdin>:10:31: ERROR: Expected "}" but found ":"` |
| reaches for `document` in the view | runtime | 1 | fixed | `view threw (SYG406): ReferenceError: 'document' is not defined` |
| imports a library (`date-fns`) | error | 1 | fixed | `sandbox: 'date-fns' can't be imported here` |
| React habits: `useState` | runtime | 1 | fixed | `view threw (SYG406): ReferenceError: 'useState' is not defined` |
| React habits: `onClick` in JSX (*silent at run time*) | compile | 1 | fixed | `line 7: JSX event handlers (onClick) don't run …; read the event in intent: DOM.select('.cls').events('click')` |
| wiring: intent action with no model entry (*silent*) | compile | 1 | fixed | `line 13: SYG101 intent action 'PICK' has no model entry …` |
| event payload of the wrong shape | rejected | 1 | fixed | `the app dropped an event OPEN_CUSTOMER: invalid (id: Invalid input: expected number, received undefined)` |
| undeclared event type | rejected | 1 | fixed | `… SELECT_CUSTOMER: undeclared (it takes only OPEN_CUSTOMER, FILTER_STATUS)` |
| endless loop in the view (`i--`) | timeout | 1 | fixed | `the component ran into the 500 ms boot deadline (an endless loop?)` |
| lookup table over the memory cap | runtime | 1 | fixed | `view threw (SYG406): InternalError: out of memory` |
| recursion without a base case | runtime | 1 | fixed | `view threw (SYG406): InternalError: stack overflow` |
| renders nothing | empty | 1 | fixed | `the component rendered nothing` |
| over the size limit | compile | 1 | fixed | `the code is over the limit of 1500 characters; write a shorter part` |
| two mistakes (`lodash` import, then `document`) | error | **2** | fixed | first `'lodash' can't be imported`, then `'document' is not defined` |
| a model that doesn't fix it | runtime | **2** | gave up, fallback | `'window' is not defined`, then `cannot read property 'innerWidth' …` |

- **Detection is fast.** A failure is reported within 50–190 ms of the reply, or about 430–610 ms
  for `empty` and the boot-deadline timeout, which wait for a grace period or the deadline. A
  repair request is about 3.0–3.5 K chars, of which 2.3 K are the fixed repair rules, so prompt
  caching applies. It never contains the page or the other parts.
- **How many turns real failures need is not measured here.** The model is scripted. What the
  corpus shows is that each error reaches the model as a short message that names the problem,
  with a line number for compile and check failures. Runtime errors carry no source line (§9.2).
- **Two silent classes, and how they are caught.**
  - JSX handlers and wiring mistakes boot fine and then do nothing, so a loop that only listens for
    errors never repairs them. The check before mount catches both before any box boots.
  - Other silent bugs remain uncaught: a view that shows the wrong numbers, or a selector that
    matches the wrong element. Only a person or an eval can judge those.
- **Fixed during the spike** (false reports would cost model calls):
  - A working part was reported as `empty`. The cause was the check itself: under jsdom,
    `querySelector('[data-sandbox-root] *')` missed a tree that contained an `<input>`. It now
    looks for text or a control below the root. It also waits 250 ms before calling a part empty,
    because the core can defer the first render to its macrotask hop (a host timer), which arrives
    after the worker's `ready`.
  - An endless loop in the view was reported as `empty`. The core's error boundary catches
    QuickJS's `interrupted`, and the deadline also stops the SYG406 log, so the box stays alive and
    empty. A boot that used ≥ 90 % of `bootMs` without drawing is now reported as `timeout`.

## 3. Effectiveness (Q3)

Node 22.22 with jsdom, 4 cores, medians of 5 runs (`results/bench.md`). The sandbox spike's
Chromium numbers (§5 there) were 0.6–0.7× its Node numbers per event, and worker first paint was
about half.

### 3.1 Cold start: the layout reply → parts ready (ms)

| parts | tier | first ready | all ready | one part, create → ready (median / p95) | RSS growth | per part |
|---:|---|---:|---:|---:|---:|---:|
| 1 | worker | 177 | 177 | 151 / 176 | 21.6 MB | 21.6 MB |
| 3 | worker | 195 | 214 | 185 / 211 | 43.7 MB | 14.6 MB |
| 10 | worker | 390 | 534 | 427 / 469 | 141.4 MB | 14.1 MB |
| 1 | thread | 66 | 66 | 45 / 106 | 2.8 MB | 2.8 MB |
| 3 | thread | 157 | 157 | 91 / 135 | 5.2 MB | 1.7 MB |
| 10 | thread | 471 | 471 | 253 / 430 | 21.6 MB | 2.2 MB |

- **Worker:** each part pays a worker start, a WASM instantiation (the spike compiles the WASM in
  each worker), and a 156 KB kernel parse in QuickJS (about 20 ms). The parts run in parallel, so 10
  parts are ready in 0.5 s on 4 cores. Memory is the cost: a Node worker is about 12 MB before
  QuickJS. A browser worker is lighter, but each one still holds its own 16 MB-initial WASM memory.
- **In-page:** the parts are created one after another on the main thread. That is cheap in memory
  but blocks the page for about 25–45 ms per part.
- Both are small next to the model's output time (§3.3).

### 3.2 Per event (ms)

| tier | click → validated emit → host action → host view patched | keystroke → box re-rendered |
|---|---:|---:|
| worker | 1.48 (p95 1.99) | 2.07 (p95 2.96) |
| thread | 1.23 (p95 1.89) | 1.81 (p95 2.74) |

Per event, the Worker costs about 0.3 ms more than in-page. Async Zod validation adds a microtask.
Both are far below a frame.

### 3.3 Streaming and model time

| generated parts | reply | ≈ tokens (chars / 3.5) | model time at 100 / 50 tok/s | first part complete at | compose `delta` CPU, whole reply |
|---:|---:|---:|---:|---:|---:|
| 1 | 959 chars | 274 | 2.7 / 5.5 s | 100 % | 8 ms |
| 3 | 2,740 | 783 | 7.8 / 15.7 s | 36 % | 58 ms |
| 10 | 9,344 | 2,670 | 26.7 / 53.4 s | 12 % | 217 ms over 1,602 frames |

- **The model's output is the cost.** These fixtures are compact (about 900 chars a part). Code
  from a real model is usually 1.5–3 K chars, which comes to 4–9 s per part at 100 tok/s. That is
  the main reason §8 recommends `maxUses: 3` for the default and a page that prefers prepared parts.
- **Streaming makes it bearable.** Parts appear one by one as each node closes, and each one boots
  (about 150–430 ms) while the next is still being written.
- compose.llm re-parses the whole reply on every delta (`parsePartialJSON`), so the cost grows with
  the square of the length. Even at 10 parts it stays at 0.27 ms per delta, 217 ms in total, which
  is fine.
- **Edits carry the code.** The edit prompt's "current page" lists every node's params, so 10 parts
  add 9 K chars to every follow-up, and a `setParams` on `code` re-sends the whole module. That
  works (a test checks it): an edit remounts only that box, and the other boxes keep their instance
  and state. But edits of pages with generated parts are expensive. See §9.4.

## 4. Safety (Q4)

`test/safety.test.js`. The threat on this path is accidents plus prompt injection, which makes the
code hostile. In the Worker tier the code is contained either way.

| what the code tries | result |
|---|---|
| `document`, `window`, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, storage, `navigator`, `location`, `process`, `WebAssembly`, `importScripts`, `postMessage`, `self`, `parent`, `performance` (via `Function('return this')()`) | all `undefined`, in both tiers. QuickJS has a **`SharedArrayBuffer` constructor** but no `Atomics` and no threads (the sandbox README says "no SharedArrayBuffer"; the timer it worried about isn't there) |
| `require('fs' / 'child_process' / 'node:worker_threads' / 'quickjs-emscripten-core')`, `import()` | refused; only `'sygnal'` |
| `__host.emit(...)` directly, bypassing `EVENTS` | still validated on the page: invalid and undeclared types are dropped; a valid declared one is accepted (that is the contract) |
| the HTTP driver | `sandbox fetch denied: no fetch capability` (generated parts get none by default) |
| exfiltration through markup: `<img src>` to another origin, `javascript:` links, `<form action>` | attributes dropped by the mirror's allowlist; submit prevented |
| rendering `.picked`, a class the host's own intent listens to | the box's click never reaches the host's `DOM.select('.picked')`; the host's own element still does |
| data beyond its node's `reads` | not there (only declared keys, as JSON) |

**The three sandbox findings, on this path:**

1. **ArrayBuffer memory.** A click allocating 8 MB typed arrays in a loop stopped at 40 MB (cap 48
   MB): in 34 ms in the worker and 156 ms in-page. RSS stayed bounded, and the next part kept
   working. The reason is that every part, in both tiers, has its own instance with a capped
   `WebAssembly.Memory`. The in-page path must not use one shared module: the sandbox spike's
   `makeSandboxed(QJS)` mounts every tag on the one module it is given, which its tests load
   uncapped.
2. **The deadline.**
   - Worker: a click looping over `JSON.parse(JSON.stringify(10k rows))` was terminated by the
     watchdog after 364 ms (`hardMs: 300`). The page's timers ticked throughout, the neighbouring
     part still answered input, and the repair loop heard `timeout: the worker didn't answer in
     300 ms`.
   - In-page: a plain `for (;;)` stopped at the 50 ms deadline, blocking the page for 57 ms. But
     2,500 JSON round trips ran for **4.9 s**, far past the deadline. The in-page tier is
     documented as being for model-written code only, and it cannot stop that loop either. Prompt
     injection can make generated code hostile, which is one more reason to keep the Worker as the
     default.
3. **Stack.** Deep recursion is `InternalError: stack overflow` at 256 KB, inside the guest: no
   host `RangeError` and no poisoned module. The same part kept working, and so did its neighbour.

**Residual risks** (beyond the sandbox README §1.4):
- **Valid but unwanted events.** Code written under prompt injection can send
  `OPEN_CUSTOMER {id: 15}` for a customer the user never picked. Treat `emits` as user input:
  authorize on the server, confirm destructive actions, and never declare an event that does
  something irreversible with no confirmation.
- **Phishing UI inside the box** (no password fields; a frame or label marks generated content).
- **Cost and DoS.** A hostile or broken page can spend up to `maxUses × (1 + maxAttempts)` model
  calls on repairs. With the recommended defaults that is 3 × 3.
- **Quality.** The sandbox makes wrong code safe. It does not make it right.

## 5. Findings worth acting on (outside the spike)

1. **compose has no "code" param.** A generated part's source is a text param, so the prompt calls
   it "short text, at most 6001 characters". Also, `askedMax` sizes every `asked_for` item by the
   longest text param, so the schema allows 6,001-character `asked_for` items. The optional patch
   (§7) adds `format: 'code'`.
2. **Text params are cut silently at `maxLength`** (layout.ts `checkParams`; llm.ts `fixParams`,
   which also falls back to 40 when there is no `maxLength`). That is right for labels but wrong for
   code. The spike works around it with `maxLength: maxCode + 1`.
3. **sygnal-check has no rule for JSX event handler props** (`onClick={…}`). They are silently
   dropped in Sygnal, and this is the most common React habit. It is worth a rule for people, not
   only for generated code. The spike uses a regex.
4. **sygnal-check runs on in-memory sources in 4–5 ms (warm)** and catches the silent wiring
   classes. It is a good fit as a check before mount if it can run in the browser (§9.3).
5. **`sygnal/host`'s `dataset` keeps the raw value** (`data-id={9}` reads back as the number 9; in
   the DOM it is `'9'`). Code that works in the sandbox can behave differently in the real DOM, and
   the reverse. It is typed `Record<string, string>`, so it should stringify like the DOM does.
6. **A view stopped by the QuickJS deadline is caught by the core's error boundary** (the
   `interrupted` exception), and the deadline also stops the SYG406 log, so the failure is silent.
   The sandbox could check `bootMs` itself, as this spike does, or the kernel could rethrow
   `interrupted`.

## 6. Files

| File | What |
|---|---|
| `src/generated.js` | `generated(runtime, { data, emits, maxCode, maxUses, isolation, … })` → `{ part, Host, Sandboxed, instructions, events, repair }`; `CODE_RULES` (the prompt), `describe()` (failure → repair text), `codeOf()` (reads a repair reply), `hash`/`patched` (the overlay) |
| `src/Sandboxed.js` | the `<Sandboxed code emits input isolation maxCode>` widget: required Standard Schema `emits`, page-side validation, `emit` / `sandboxready` / `sandboxerror` / `sandboxreject` events, remount on new code, empty/timeout detection |
| `src/runtime.js` | `createRuntime({ kernel, compile, spawn })`: one sandbox per part, Worker (default) or thread (own capped instance), the limits |
| `src/check.js` | compile + the check before mount (sygnal-check on in-memory source, JSX handler regex) |
| `fixtures/app.js` | the host app: one prepared part + the generated part kind; orders/customers data; `OPEN_CUSTOMER` / `FILTER_STATUS` (zod) |
| `fixtures/code.js` | scripted model output: 4 working parts (`GOOD`, `variants(n)`), the 15-case repair corpus (`BROKEN`) |
| `test/design.test.js` (12) | Q1: request schema/prompt, both tiers, emits validation and stripping, data scoping, edits remount one box |
| `test/streaming.test.js` (2) | Q3: no partial code at any cut; mount once; a stream that fails mid-code |
| `test/repair.test.js` (15) | Q2: the corpus; writes `results/repair.md` |
| `test/safety.test.js` (10) | Q4: reach, the bridge, network, host selectors, the three findings |
| `bench/compose.bench.test.js` | Q3 numbers → `results/bench.md`, `results/bench.json` |
| `patches/compose-code-param.patch` | the optional `src/` patch (§7) |

## 7. Optional `src/` patch (not applied)

`patches/compose-code-param.patch` touches 3 files (+6 −4) and adds `format: 'code'` to text params:

- `catalog.ts` keeps `format` when it normalizes the param;
- `llm.ts` describes the param as "source code, at most N characters" instead of "short text";
- `askedMax` ignores code params, so `asked_for` items go back to 60 characters.

`src/generated.js` already passes `format: 'code'`. Without the patch, that field is ignored.

```bash
git apply dev-plans/research/compose-sandbox/patches/compose-code-param.patch
```

With the patch applied on this branch, the root compose suites pass (`npx vitest run test/p9-compose`:
10 files, 197 tests). It was reverted afterwards. The root `npm test` was not run because `src/` is
unchanged.

## 8. Recommendation (Q5)

**Include the generated part in `compose` for the next dev preview, as an experimental opt-in. Do
not fall back to chat cards only.**

Why:
- **It fits compose without changing it.** The part is one more catalog entry. Streaming, keys,
  edits, `local` state, `CHILD`/`PARENT` and `finish()` all apply unchanged, so the cost of
  shipping it is the sandbox package plus about 450 lines of glue (`src/` here), not a second UI path.
- **The safety story holds on this path.** All three sandbox findings are handled. Events are
  validated and stripped before the host sees them. The Worker default contains hostile code,
  including the slow-builtin loop that the in-page tier cannot stop.
- **The repair loop is cheap and contained.** Each request is about 3 K chars and covers one part.
  The fix is an overlay that survives streaming and edits, and a part that can't be fixed affects
  only itself.
- **The chat-card fallback is not a separate thing.** A `render_component` card is a page with one
  generated part, where the card's answer is one declared `emits` type, as an `ask` card's
  `result` part is today. Building compose support gives the card for free. The reverse is not
  true.

How to ship it:
- `sygnal/sandbox` gets `<Sandboxed emits>` and the runtime (as decided).
- `sygnal/ai` gets `compose.generated(sandbox, { data, emits })`, which returns the part
  declaration, the prompt rules and the repair behavior. Apply §7's patch.
- Defaults:
  - `isolation: 'worker'`;
  - `maxUses: 3`, because the model's output time dominates (§3.3);
  - `maxCode: 4000`;
  - `maxAttempts: 2`;
  - the check before mount on;
  - no capabilities.
- Keep it out of the default prompt: an app opts in per catalog.
- Label it experimental, outside semver.

What would change this to the fallback: an eval in which real models fail the rules often (for
example, under about 70 % working on the first or second turn at the current prompt), or a browser
compile step (§9.3) too heavy to ship. Both are measurable before the preview leaves "dev".

## 9. Open questions

1. **Real-model success rate.** How often do current models write a part that boots and works on
   the first try, and in how many turns do they fix the classes in §2? This needs the
   `evals/agent-ergonomics` harness (Sygnal vs React tasks with hidden tests), with the rules
   prompt as the variable. It is the evidence §8's "experimental" waits on.
2. **Source lines for runtime errors.** Compile and check errors carry `line:column`. A runtime
   error carries only its message, because QuickJS's stack points into the compiled CommonJS. A
   source map, or compiling with `sourcemap: 'inline'` and mapping `component.js:L:C`, would give
   the model a line.
3. **The compile step in the browser.** esbuild in Node here. Options in the browser:
   esbuild-wasm (heavy); `@babel/standalone`, which the docs' live editor already loads on demand;
   or sucrase inside the box, where an untrusted parse can't hurt the page. sygnal-check in the
   browser needs its `fs` paths stubbed; it already accepts in-memory `sources`.
4. **Edits.** Should the edit prompt elide generated code (`code=<1.4 K chars>`) and treat a
   `setParams` on `code` as "rewrite this part, here is its title and what it reads"? That makes
   edits cheaper but blind to the current code. Or should a generated part be editable only by its
   own small request, like a repair?
5. **Persisting the overlay.** `fix.patches` should be persisted with the page (`persist`), or
   folded into the layout once fixed. Otherwise a reload repairs again.
6. **One worker per part.** 14–22 MB RSS per part in Node. Should one worker run several parts
   (several QuickJS runtimes, each with its own instance)? That cuts memory but shares the watchdog,
   and with it the kill.
7. **Accessibility and styling.** Generated markup uses the app's classes (decision Q4) but nothing
   checks its semantics. sygnal-check's a11y lane (SYG7xx) could run in the check before mount.
