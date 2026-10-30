# Deterministic record / replay for Sygnal apps (research + spike)

Research done 2026-10-30 on `claude/explore-record-replay` (branched from
`claude/advanced-integration`, Sygnal 7.1.0 → 7.2.0 dev preview). Nothing under `src/` changed:
the spike is a hook layer, a replayer and generators under `spike/`, run against the built
package.

## 1. Summary

**Sygnal can record a real session and replay it exactly with the hooks it already has, and
0 B added to the core bundle.** The spike records `examples/kanban` and `examples/todomvc`
running under `run()` on the real DOM driver (jsdom), with a real `makeFetchDriver` against a
real HTTP server, real `makeTimerDriver` timers, `next()` timeouts, localStorage and drag and
drop. It then replays each recording in `renderComponent` (mock DOM, no network) and gets the same
root state and the same vnode at every one of the recording's checkpoints (21 / 23), and the
same final state. Replay is hermetic: the server gets no requests.

What makes that cheap is Sygnal's existing contract: **actions are data, models are pure, and
every async input enters through the action queue.** A log of the *input actions*, the values
reducers read from `Date.now()` / `Math.random()` / `crypto.randomUUID()`, and an address for
the instance each action ran on is enough. No DOM, network or timer recording is needed.

Recommended direction (§12):

1. Record at the **action level** (inputs: intent, reply, next, behavior, agent actions), not the
   source level. Regenerate the consequences (INITIALIZE, BOOTSTRAP, PARENT) and compare them.
2. Replay is **log-driven**: the replayer dispatches every input from the log and mutes the
   inputs the replayed code produces by itself (fake timers, `next()` timeouts, EVENTS re-emits).
   The order of inputs is then exactly the recorded one, whatever the clock does.
3. Ship it as a **dev entry** (`sygnal/devtools` or a new `sygnal/replay` subpath), plus
   `replay()` next to `renderComponent` in `sygnal/testing`. "Copy as test" gains a mode that
   writes a recording and a one-line replay test, which works for sessions it can't express
   today (child instances, timer replies, entropy).
4. Two small core hooks would make it sturdier (§13 Q1–Q3). Neither is needed for a first
   version.

Numbers (§8; jsdom, Node 22): **≈0.2 ms recording overhead per action** (0.44 ms per click,
about 2 actions per click, on a 50-item TodoMVC list), **≈213 B per action**, **≈87 KB/min raw,
≈17 KB/min gzipped** for a typing-heavy session (411 actions/min). Replay ≈2 ms per input,
most of it waiting for the app to settle between groups.

## 2. What determinism needs

A Sygnal app's behaviour is `fold(model, initialState, actions)` plus the view. Models are pure
*by convention*, and actions are data. So the question is which inputs reach the queue, and what a
reducer can read that isn't in its arguments.

| Source of nondeterminism | Where it enters | How the spike handles it |
|---|---|---|
| User input (DOM events) | intent streams → **intent actions** | the action's data, recorded (events and elements as stubs: `{ $event, key, target: { $el, dataset, value, checked } }`) |
| `makeFetchDriver` replies, resources | **reply actions** (`ok`/`error`, `RESOURCE`), or intent actions over `HTTP.select()` | the reply's data, recorded; the request is compared (hash of the sink value) |
| Sockets (`connections`), SSE, the LLM driver | reply / intent actions with the received data | same as HTTP (data recorded). Streaming LLM output is many small actions, and each one is recorded |
| The `browser` static (media queries, visibility, online, storage, geolocation) | reply actions | data recorded |
| Router (`ROUTER`, todomvc's director) | intent actions | data recorded |
| Timers (`makeTimerDriver`) | reply actions (`{ n, t }`, `t = Date.now()`) | recorded like any reply. The replay's own fake timer ticks are muted |
| `next(type, data, ms)` | `'next'` actions after a `setTimeout` | recorded as inputs and dispatched from the log. The replay's own timeouts are muted, so the interleaving with other inputs is the recorded one |
| `Date.now()`, `new Date()`, `Math.random()`, `performance.now()`, `crypto.randomUUID()` **inside a reducer / EFFECT** | not visible in actions | **entropy capture**: `wrapHandler` swaps them for the duration of each handler call, logs the values (`e: [["now", 1793336341280]]`), and the replay returns them in order. Kanban's own `ADD_TASK` (`task-${Date.now()}`) needs it: with it switched off the replay diverges at `ADD_TASK` (test) |
| Entropy in a **view** or an **intent** | view: not captured. Intent: in the action's data | a view reading `Math.random()` shows up as a view divergence |
| Instance ids, isolation scopes, `uid()` | per-app counters | not compared: instances are addressed by path (§4.3), and scope classes and isolation keys are left out of the vnode markup |
| Async EFFECT continuation (`await` inside an EFFECT) | after the handler returned | **not captured** (the real globals are back). It is invisible unless it dispatches, and then that action is an input |
| `setState` from devtools time travel, HMR, `sygnal/element` props, Vike swaps | the queue's `SET` entry; **no `onAction`** | **not recorded** (§13 Q3) |

### Intent level (actions) vs source level (DOM events + driver replies)

| | **Action level** (the spike) | **Source level** (cycle-restart, rrweb, Playwright codegen) |
|---|---|---|
| What is logged | the actions the intents and drivers produced, with data | DOM events (selector + event), driver source emissions |
| What the replay exercises | model, view, children, statics, effects (the requests sent) | intent **and** everything after it |
| Survives a **view refactor** (classes, markup) | **yes**: the state replays unchanged and the vnode difference is reported as view-only (test: renamed `.add-lane-btn` → `.new-lane`) | no: the recorded click finds no element (the same test shows `simulateEvent('.add-lane-btn')` changing nothing) |
| Survives an **intent refactor** (stream wiring) | yes if action names stay; a renamed action is reported (`unhandled: ['EDIT_TITLE']`) | yes if selectors and event types stay |
| Survives a **model change** | it is the point: the first action whose state differs is reported, with the diff | same, after the intent |
| Needs | the action data to be serializable (stubs for events) | a DOM (or mock) and every driver faked at the source |
| Log size | one entry per action (typing: one per keystroke) | one per DOM event (often several per action: focus, keydown, input, keyup) |

**Decision:** the action level is the primary format. The model is what users want regression
tests for, and it is what changes in the bugs they report. Views churn, and a view-only diff
is still reported. The action log can carry what a later source-level mode would need. The
spike already notes when a text-entry DOM event produced an action, for redaction (§7).

## 3. Prior art

- **Redux DevTools.** It keeps a "lifted" state: every action plus the computed states. Time
  travel re-runs the reducers over the kept actions (skip / jump / commit). Export and import
  write that history as JSON. Hot-reloading a reducer recomputes all states from the actions,
  which is a replay against changed code, but nothing reports where the new states start to
  differ. Options: `actionSanitizer` / `stateSanitizer` (privacy and size), `serialize` (Map,
  Set, Date), `maxAge`. A "Test" monitor generates assertion code from action/state pairs.
  *Taken:* actions as the record; sanitizers → redaction; test generation. *Not taken:* storing
  every state (the spike stores diffs and hashes).
- **Elm debugger.** It exports and imports the message history as JSON. On import it checks that
  the program's message types match, and refuses otherwise. Elm needs nothing else because
  `Time.now` and `Random` are effects whose results come back *as messages*, so the messages are
  the complete record. *Taken:* the type check becomes `unhandled` (an action the code no
  longer has). Elm's design is also the argument for §13 Q4: make entropy explicit and the
  global patching goes away.
- **Replay.io.** It records the whole browser below the JS engine (system calls and
  nondeterministic APIs) and replays the engine deterministically. That gives retroactive
  console logs and stepping, works for any code, and needs no framework support. The cost is a
  custom browser, large recordings, and capturing everything (privacy). *Lesson:* a framework
  that owns its inputs can get "replay any session" for a tiny fraction of that cost. A
  Sygnal recording is a list of actions, not a process trace.
- **rrweb** (and LogRocket's DOM replay). It records a DOM snapshot plus mutations and input
  events, and replays them *visually* in an iframe. No app logic runs. Privacy: `maskAllInputs`,
  mask/block selectors. *Taken:* masking typed text by default. *Different:* rrweb shows what
  happened. A Sygnal replay re-runs the code and can tell you when it changed.
- **Playwright traces / codegen.** Traces hold per-action screenshots, DOM snapshots, network
  and console for a *test run*. Codegen records user interactions as selector-level test code,
  which is source level and brittle under markup changes. *Taken:* the per-step timeline in
  the generated test and the bug report.
- **LogRocket.** DOM replay plus Redux/NgRx action and state logs via middleware, plus network
  and console, with sanitizers for inputs, requests and actions. It is closest to the "attach a
  recording to a bug report" use (§11). Its replay is for viewing only.
- **Cycle.js.** `cycle-time-travel` scrubbed recorded stream events visually.
  **`cycle-restart`** did hot reloading by *recording driver source events* and replaying them
  into the new `main`, pausing sinks during the replay so effects don't run twice. That is the
  source-level design, and its sink pausing is this spike's muting seen from the other side.
  `@cycle/time` added virtual time for tests. *Taken:* replaying into new code to see what
  changed, and effects not running for real during a replay.

## 4. Design (the spike)

### 4.1 Recording format (`spike/recorder.js`)

```jsonc
{ "v": 1, "kind": "sygnal-recording", "app": "KanbanSync", "recorded": "<ISO>", "redacted": false,
  "sources": { "DND": "other", "HTTP": "resources", "TIMER": "timers" },
  "init": { /* root state after INITIALIZE */ },
  "p": ["KanbanSync", "KanbanSync/LaneComponent[lane-1]", "KanbanSync/LaneComponent[lane-2]/TaskCard[task-3]", …],
  "a": [   // every action, in queue order
    { "s": 11, "t": 1, "p": 1, "y": "FINISH_EDIT", "c": "i", "d": "Backlog", "h": "7ea7f164" },
    { "s": 13, "t": 7, "p": 2, "y": "ADD_TASK", "c": "i", "d": "Ship the replay spike",
      "e": [["now", 1793336341280]], "h": "c816fc46" },
    { "s": 17, "t": 152, "p": 0, "y": "AUTOSAVE", "c": "r", "r": "TIMER", "d": { "n": 1, "t": 1793336341438 },
      "h": "d8a00915", "f": [["HTTP", "c6ab4785"]] } ],
  "k": [ { "s": 11, "v": "c8d609be", "o": [[["lanes", 0, "title"], "Backlog"], [["lanes", 0, "isEditing"], false]] }, …],   // checkpoints
  "fx": [[0, "TIMER", "474cf326"]],   // declaration statics sent to drivers
  "end": { "s": 24, "ms": 457, "dropped": 1 } }
```

- `s` sequence, `t` ms since the previous kept action, `p` address index, `y` type, `c` cause
  (`i` intent, `r` reply (+ `r`: the driver), `n` next, `a` simulateAction, `B` behavior, `g`
  agent: **inputs**; `b` built-in, `p` parent: **consequences**, kept without data), `d` data
  (inputs only; `{ "$echo": 1 }` for an intent over the instance's own `STATE.stream`, such as
  TodoMVC's `TO_STORE`, which the replay sends with the instance's current state), `e` entropy,
  `h` hash of the instance's new state (when its STATE changed), `f` hashes of the values its
  other sinks produced.
- Checkpoints (`k`): one per patch (one per flush that changed the vnode). `v` is the hash of the
  vnode as markup (no listeners, isolation scope classes or keys; fragments flattened). `o` is the
  root state's diff from the previous checkpoint (`[path, value]`, `[path]` deletes). The log
  therefore holds every state the user saw, and a divergence report can show the recorded value.
- `dropNoops` (default on): an input that changed nothing (no STATE change, no sink value, no
  EFFECT, no entropy) is left out. An idle `every: 200` timer otherwise doubles the log
  (§8: 674 vs 411 actions/min). The trade-off: if new code would make such an action do
  something, the replay doesn't send it. A replay of the same code is unaffected.

### 4.2 The recorder

A hook-layer factory added to `globalThis.__SYGNAL_DIAGNOSTICS__.layers`, the mechanism
`sygnal/devtools`' action log and `sygnal/ai`'s link already use. The core calls it only when a
dev entry put it there. It records the first app started after `startRecording()`. Hooks used:
`onCreate`/`onDispose` (addresses), `onAction` (the entry), `wrapHandler` (entropy, EFFECT
seen), `onReducer` (state hash), `onSink` (effect hashes, statics), `onPatch` (checkpoint),
`wrapSources` (only when redacting: tags text-entry DOM events, §7).

### 4.3 Addresses (`spike/address.js`)

Instance ids are per-app counters, and any extra child shifts them. An address is a path from
the root: a Collection item is named by its state's `id` (the item key:
`KanbanSync/LaneComponent[lane-2]/TaskCard[task-3]`), any other child as `Name:n` (the n-th of
that name under its parent). The root takes the recording's root name, so a replay into a
renamed or wrapped root still lines up. This was a real bug in the first version, caught by the
view-refactor test.

### 4.4 The replayer (`spike/replayer.js`)

1. `renderComponent(Component, { initialState: log.init, drivers })`. Sources that were plain
   drivers in the recording (DND, STORE, ROUTER) get an **inert driver** (`spike/inert.js`: any
   call chain, every stream `xs.never()`). `makeFetchDriver` and `makeTimerDriver` sources are
   left to renderComponent's fakes, so requests and timer declarations are real and their
   answers come from the log.
2. **Log-driven, with muting.** Inputs are dispatched from the log through the runtime API
   (`api.dispatch(instance, type, data, cause)`). An input the replayed code makes by itself has
   its handlers replaced by `() => ABORT` in `wrapHandler`. Examples: a fake timer's tick, a
   `next()` timeout, a child's `EVENTS` re-emitted to the root intent, the `STATE.stream` echo.
   Its recorded twin is dispatched instead. Consequences (INITIALIZE, BOOTSTRAP, PARENT) run for
   real.
3. **Groups.** The inputs of one recorded checkpoint are dispatched together, so they land in
   one flush as they did in the recording. Then the replayer waits until two turns in a row
   patch nothing and compares the root state and the vnode hash with the checkpoint.
4. **Alignment.** Recorded and replayed actions are matched by `address|type|occurrence`, which
   survives a different number of muted actions. Per action it compares the state hash
   (`divergence`) and the sink-value hashes (`effects`). It also reports actions that didn't
   happen (`missing`), new ones (`extra`), types the code no longer handles (`unhandled`),
   inputs whose target never appeared (`unresolved`), and entropy the replay asked for that
   wasn't logged (`misses`).
5. **Result.** `ok`; `divergence` is the first action whose instance state differs, with
   reason, and the root-state diff at its checkpoint (`[{ path: 'lanes.3.title', expected: 'New
   Lane', actual: 'Untitled' }]`); `view` is the first checkpoint whose vnode differs while the
   state matches (a view-only change); `effects`; `final`.

### 4.5 Tests and reports (`spike/toTest.js`)

- `logToVitest(log, …)` writes a Vitest file that replays the recording (the JSON next to it)
  and asserts no divergence, no view or effect change, and the final state, with the input
  timeline as a comment (`spike/generated/kanban.replay.test.js`, `todomvc.replay.test.js`;
  both run in the suite). It works for every session the replayer handles: children, replies,
  timers, entropy.
- `toSessionRecording(log)` converts a log into sygnal/devtools' existing `SessionRecording`,
  so today's **Copy as test** can write explicit `t.simulateAction` / `t.respond` lines
  (`spike/generated/kanban.copied.test.js`). For the kanban session that copy is incomplete,
  and the reasons are the gaps the replay closes: child instances changed the state on their
  own, the `AUTOSAVE` timer replies can't be replayed (renderComponent fakes only fetch
  sources), and `SAVED` / `ADD_TASK` read `Date.now()`.
- `bugReport(log, result)` produces Markdown: the timeline, the first divergence with its diff,
  the effects that changed (with the request the new code sends), and how to reproduce it
  (`spike/generated/kanban-divergence.report.md`).

## 5. What the spike found (beyond "it works")

1. **Fragments.** The first vnode serializer treated fragment vnodes (no `sel`: a Collection's
   items, injected children) as empty text, so checkpoints compared only the root's own markup.
   The fix is to flatten fragments.
2. **The real DOM driver mutates cached vnodes.** Its isolation module writes scope keys onto
   cached vnodes and the mock DOM doesn't, so a run() recording and a renderComponent replay
   differ in `key`. Keys and the `.___sN` scope classes are left out of the view markup.
   *Consequence for any vnode-level tooling:* the vnode handed to `onPatch` is not immutable
   afterwards.
3. **Hooks that read the clock run inside the entropy scope.** renderComponent's own `onNext`
   (its `t.actions` bookkeeping) calls `Date.now()` while BOOTSTRAP's EFFECT runs `next()`. In
   the replay those reads find no logged values (`misses`, harmless here). If such a read fell
   between two of the app's reads of the same kind, it would take the app's value. A core
   handler scope (§13 Q4) removes the problem.
4. **The root's address must not be its name**, or a replay into a wrapped or renamed root
   aligns nothing (§4.3).
5. **Redaction by action type is too blunt** (§7): masking `VISIBILITY`'s route name or the
   drag source's `task-1` breaks the model.
6. Memoizing the vnode markup and the state encoding by object identity is what keeps the
   overhead proportional to what changed. The core's cached vnodes and immutable state make
   that work (§8).

## 6. Divergence reporting, in the tests

| Change | What the replay reports |
|---|---|
| root model (`ADD_LANE` names the lane `Untitled`) | `divergence` at action #2 `ADD_LANE`, diff `lanes.3.title: 'New Lane' → 'Untitled'`; `effects`: both `AUTOSAVE` POSTs now carry other bodies |
| a Collection item's model (`FINISH_EDIT` upper-cases) | `divergence` at `FINISH_EDIT` on `KanbanSync/LaneComponent[lane-1]`, `lanes.0.title: 'Backlog' → 'BACKLOG'` |
| renamed action (intent + model: `EDIT_TITLE` → `SET_DRAFT`) | `unhandled: ['EDIT_TITLE']`, divergence "no longer changes the state" |
| view refactor (classes renamed) | `divergence: null`, `effects: []`, `view` at checkpoint 0 with the new markup |
| entropy injection off | `divergence` at `ADD_TASK` (`lanes.1.tasks.1.id`) |

## 7. Privacy

- What a log can contain: typed text (every keystroke of a controlled input), server data
  (replies), and anything in state. `init` is the code's `initialState` (or run()'s) and is
  stored as is.
- `redact: true` in the spike works **by provenance**. The recorder wraps each instance's DOM
  source (`wrapSources`) and patches each event stream's `_n`, so it knows when a *text-entry*
  event (an `input`/`keydown` on a text field, a form `submit`) is being delivered. An intent
  action dispatched during that delivery, or of a type that once was, has its strings
  pseudonymized, and so does every reply. Datasets, event types and keys (`Enter`) are kept, and
  so is `next()` data (the code's own).
- **Pseudonyms, not masks.** `pseudo()` keeps each character's class (letter case, digit,
  whitespace, punctuation) and is a deterministic function of (per-recording salt, the whole
  string), so equal strings stay equal and different ones (almost) never collide. Ids in a
  reply still match the dataset of what was clicked. `trim()`, `=== ''` and `split(' ')`
  behave the same. The salt is not stored, so tokens can't be reversed from the log.
- Checkpoints in a redacted log are stored and compared on `maskAll` values (shape only), so
  state diffs and vnode hashes never hold the text either.
- **Where it fails, the replay says so.** A redacted string that the model branches on, such as
  forcing the route name through with `also: ['VISIBILITY']`, makes the replay diverge at
  exactly that action (a test shows the view divergence after `VISIBILITY`). The fix is
  `keep: ['VISIBILITY']`.
- The first version masked by action type and failed on kanban (the drag source's `task-1` and
  `EVENTS`' `laneId` are program data). Provenance tagging fixed that. It is still approximate:
  an action dispatched *after* the event (queued during a render, a `blur` fired by a patch)
  isn't tagged the first time. Types tagged once stay tagged. A core `onDispatch` hook that
  carries the DOM event (§13 Q2) would make it exact.
- Not covered: secrets in request headers (only hashes of sink values are logged, so they
  aren't in the log, but a future "values" mode must sanitize them), file contents, and
  clipboard data in the `browser` static.

## 8. Numbers (`results.json`, `MEASURE=1`)

Measured in jsdom on Node 22 (`spike/measure.test.jsx`). The absolute times are jsdom's; in a
browser a click costs more (layout and paint), so the *relative* overhead would be lower.

**Recording overhead.** TodoMVC (the example's APP) with 50 todos, 300 real clicks on item
checkboxes, each awaited to its patch (each click is an item `TOGGLE` plus the root's `TO_STORE`
echo: 2.02 actions). Runs alternate between configurations; median of 11.

| | ms per click | overhead |
|---|---|---|
| off | 1.16 | |
| record | 1.60 | **+0.44 ms (≈0.22 ms per action)** |
| record, vnode markup kept (`vnodes: 'html'`) | 1.62 | +0.46 |
| record, `redact: true` | 1.86 | +0.70 |

Per hook, per click: `onPatch` 0.125 ms (root state encoding + diff + vnode markup),
`onSink` 0.091 (hashing `TO_STORE`'s value, all 50 todos, on every click), `onReducer` 0.026,
`onAction` 0.009. The rest is the entropy wrapper and GC. The steps that got it there: vnode
markup memoized per vnode object, ≈0.6 → 0.44 ms (the core reuses an un-rerendered
instance's vnode); state encoding memoized by identity; entropy fakes created once instead of
per handler call. Cheaper still, if needed: hash sink values lazily (keep a reference and hash
at the next idle moment), or checkpoint every N patches.

**Log size per minute.** A paced 20.6 s kanban session (KanbanSync: autosave timer every 200 ms)
typing lane titles at 6.7 characters/s (80 wpm), adding tasks, dragging, deleting:

| | actions/min | raw | gzip | B/action |
|---|---|---|---|---|
| `dropNoops` (default) | 411 | **87 KB/min** | **17 KB/min** | 213 |
| everything kept | 674 | 110 KB/min | 20 KB/min | 163 |

The two committed sample recordings: kanban 22 inputs in 457 ms, 6.2 KB (1.6 KB gzip); TodoMVC
48 inputs, 7.4 KB (1.7 KB gzip). Most of the size is checkpoints (a state diff per patch). A
`checkpoints: 'hash'` mode (state hash only, no diff) would roughly halve it, at the cost of
diffs in divergence reports. **Replay:** ≈2.1 ms per input (the 300-click log: 606 actions),
and 0.55 s for the 20 s session. Nearly all of that is the settle wait between groups (two
`setTimeout(0)` turns), not compute.

## 9. Size and D209

- `src/`, `rollup.config.mjs` and `package.json` are unchanged (`git diff --stat
  origin/claude/advanced-integration -- src rollup.config.mjs package.json` is empty), so the
  core bundle is unchanged: **0 B** of the ~587 B headroom used. The spike uses only existing
  hooks and the runtime API.
- The recorder never reaches a production bundle: like the devtools action log, it is a layer
  a dev entry adds to `__SYGNAL_DIAGNOSTICS__.layers`. No new dependency (D209 n/a). The
  spike's own code is plain JS, about 1,140 lines including comments.
- If the core hooks of §13 were added: `onDispatch(inst, type, data, cause)` at enqueue ≈ 25–35
  B gzip, `onSetState` ≈ 20 B, a handler-scope hook (or passing `now`/`random` in handler props)
  ≈ 30–40 B. These are estimates, not measured; each would need the size gate.
- `npm run build` was run. `scripts/size-gate.mjs` was not, because `npm install --prefix
  examples/kanban` fails in this container with npm's `Cannot read properties of null (reading
  'edgesOut')` on the `file:` links. With no source change it has nothing new to measure.

## 10. Implementation (where it would live)

- `src/extra/replay/` (recorder layer, format, replayer), exported from **`sygnal/devtools`**
  (the recorder starts with the action log; the panel gets "Save recording" / "Copy as replay
  test" / "Replay against current code") and **`replay()` from the testing entry**, next to
  `renderComponent`. Alternatively a separate `sygnal/replay` subpath: it is pure dev tooling,
  and a subpath keeps devtools' size flat.
- Reuse what exists: devtools' `actionHooks` / `ensure` already keep per-action records. The
  recorder can share the layer, and `copyAsTest` keeps its literal printer and gains the
  replay-file mode.
- `sygnal-check` could check a recording against the code statically, which is cheaper than a
  replay: every logged action type exists on the addressed component (Elm's import check).

## 11. Ideas

- **Bug reports with a recording attached.** A "Report a bug" button in dev builds or
  `sygnal/devtools` saves a redacted recording plus a `bugReport()` Markdown. The maintainer runs
  `replay()` and gets the exact states. Once the fix is in, the same file is the regression
  test: it should now diverge exactly where the bug was, and be re-recorded or edited to the
  new expected value.
- **Agent-generated tests from recordings.** An agent gets the recording and the timeline (the
  generated test's comment is written for that). It can turn the replay test into intent-level
  assertions (`expect(t.state.lanes[0].title).toBe('Backlog')` after `FINISH_EDIT`), minimize
  the session (delta-debug the input list while `divergence` stays at the same action), or
  explain a divergence from the diff and the reducer's source (t.explain already has it). The
  `sygnal/agent-ui` / `devMcp` tools could expose `record`, `replay` and `diff` as MCP tools.
- **Recordings as a regression corpus.** Keep a folder of recordings per app and replay all of
  them in CI. A model change shows *which* recorded user flows it alters, with diffs, before
  anyone writes a test. A deliberate change is accepted by re-recording (snapshot-test
  semantics), or by a tool that rewrites the checkpoints from the replay.
- **HMR with replay** (cycle-restart's idea). On a model edit, replay the session so far into the
  new code instead of keeping the old state. The divergence report says what the edit changed.
- **Time travel in devtools** without storing states: jump to action n by replaying the prefix
  (the checkpoints already give the states).
- **Source-level complement.** The recorder already knows which DOM event produced an action
  (§7). Storing a selector for it would let a "re-drive the UI" mode test the intent too, or
  produce a Playwright script from the same log.

## 12. Recommended direction

1. **7.2 dev preview:** move the spike into `src/extra/replay/` behind `sygnal/devtools` (or
   `sygnal/replay`). Formalize the log as `version: 1` JSON with a schema. Add `replay()` to the
   testing entry and a "replay file" mode to Copy as test. Docs: one guide page (record → test →
   report), redaction defaults on.
2. Keep **action level, log-driven, consequences regenerated, checkpoints per patch** as the
   model. Keep `dropNoops` on by default and make it switchable.
3. **Redaction on by default** for anything that leaves the machine (bug reports), with
   `keep` / `also` overrides, and the divergence report as the way to find a needed `keep`.
4. Decide on the core hooks (§13) once the dev entry has users. The first version needs none.

## 13. Open questions for the maintainer

1. **A mute/drop hook.** Muting works by replacing every handler with `() => ABORT` in
   `wrapHandler`. It works, but the action still runs `onAction`, D205's refresh and a pass of
   the handler loop. Would you accept `filterAction?(inst, action): boolean` (or `onAction`
   returning `false`)? About 25 B.
2. **`onDispatch` at enqueue time**, with the DOM event when there is one
   (`globalThis.event`). It would make redaction provenance exact (§7) and give true input
   times (queue time vs processing time).
3. **`setState` is invisible to hooks** (devtools time travel, HMR restore, `sygnal/element`
   props, Vike swaps). A recording made across one of those can't be replayed. Should
   `setState` go through `onAction` as a `'setState'` cause (`ActionCause` already lists it),
   or get its own hook?
4. **Explicit entropy?** Elm's lesson: if handlers got `now()` / `random()` / `uuid()` through
   their props (or `next`'s context), replay would need no global patching, and async EFFECTs
   would be covered. Is a canonical form worth it (sygnal-check could then flag `Date.now()` in
   reducers, a determinism lint), or is the dev-only patching enough?
5. **Where it ships:** `sygnal/devtools` (one dev import) or a new `sygnal/replay` subpath?
   And does `replay()` belong on the testing entry?
6. **Checkpoint granularity:** per patch (the spike) or per input? Per patch matches what the
   user saw. Per input pinpoints faster but costs more.
7. **`dropNoops` default:** on (smaller logs, about 40% fewer actions with an idle timer) or off
   (a model change that makes a no-op meaningful is still replayed)?
8. **Compatibility across versions:** should a recording carry the Sygnal version and the
   component names and action names it used, so that loading one against different code warns
   before replaying (Elm's import check)?

## 14. Running the spike

```bash
npm run build                      # at the root (the spike imports dist/)
npx vitest run --config dev-plans/research/record-replay/vitest.config.mjs
MEASURE=1 npx vitest run --config dev-plans/research/record-replay/vitest.config.mjs spike/measure.test.jsx   # writes results.json
UPDATE_GENERATED=1 npx vitest run --config dev-plans/research/record-replay/vitest.config.mjs              # re-record spike/generated/*
```

No example install is needed: the config aliases `sygnal` to `dist/`, and the examples' source
files are imported as they are (fixtures wrap them without changes).

| File | What |
|---|---|
| `spike/recorder.js` | the recorder hook layer (`startRecording({ redact, dropNoops, vnodes, profile })`) |
| `spike/replayer.js` | `replay(Component, log, { drivers, render, entropy, stopAt })` |
| `spike/format.js` | encode/decode of action data, stable hash, JSON diff/patch, vnode markup, mask / pseudo / redaction |
| `spike/entropy.js` | the Date / Math.random / performance.now / randomUUID scope |
| `spike/address.js` | instance addresses |
| `spike/inert.js` | the inert driver |
| `spike/toTest.js` | `logToVitest`, `toSessionRecording` (→ Copy as test), `bugReport`, `timeline` |
| `spike/sessions.js` | the two recorded sessions (run() on jsdom, a real HTTP server, real timers) |
| `spike/fixtures/` | kanban + autosave (timer, POST, Date.now / Math.random), TodoMVC + seed GET + toast (randomUUID, `after` timer) |
| `spike/replay.test.jsx` | the 11 tests: replays, divergences, generators, redaction |
| `spike/measure.test.jsx` | §8 (opt-in) |
| `spike/generated/` | committed recordings, the generated replay tests (run in the suite), the Copy as test output, a divergence report |


---

## Maintainer decisions (2026-10-30)

Reviewed on the research decisions page. Unless a line says otherwise, the recommendation was approved as written.

- Q1 `filterAction` / `onAction` returning `false`: **changed, add it now.** Bytes were the main reason to wait, and the maintainer accepts the bytes.
- Q2 `onDispatch` at enqueue time: **changed, add it now.** Getting the DOM event there needs the browser and host DOM drivers to expose the event they're delivering (not `globalThis.event`, which workers and host targets don't have). That is design work, not a reason to wait.
- Q3: `setState` goes through `onAction` as a `'setState'` cause, as long as it fits within the size budget.
- Q4 explicit entropy: **changed, add a canonical form.** Handlers get `now()`, `random()` and `uuid()` through their props (and `next`'s context), so replay and `renderComponent` can supply them (fixed clock and ids in tests). sygnal-check flags `Date.now()`, `Math.random()` and `crypto.randomUUID()` in reducers: a strict-mode SYG5xx (the existing convention for non-canonical forms that still work), and a default-mode hint inside reducers, where drift breaks replay. Developers can ignore or turn off either. Global patching stays as the fallback for code that keeps the globals.
- Q5: a new `sygnal/replay` subpath, with `replay()` on the testing entry.
- Q6: checkpoints after each patch.
- Q7: `dropNoops` on by default, with an option to keep them.
- Q8: recordings carry the Sygnal version and the component and action names. A mismatch warns, and the recording still replays.

## Productized (2026-10-30)

Built as the `sygnal/replay` subpath for the 7.2 dev preview, following the decisions above: the
code is in `src/extra/replay/` (the spike's design, with the drop hook replacing `() => ABORT`
muting, `onDispatch` replacing the DOM-source tapping for redaction provenance, `setState` recorded
as an input, and explicit `now()` / `random()` / `uuid()` on the handlers' props with the global
patching kept as the fallback). Tests: `test/replay.test.js`, `test/replay-core-hooks.test.js`;
guide: `docs/src/content/docs/guide/record-replay.md`. The spike under `spike/` is kept as it was.
