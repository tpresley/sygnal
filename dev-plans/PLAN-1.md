# PLAN-1 — Agent Ergonomics

**Goal:** Make Sygnal a framework that AI agents can write efficiently and humans can read easily. Do it by turning silent wiring failures into actionable diagnostics, typing the string links, narrowing the API to canonical forms, making apps introspectable, and shrinking the context an agent needs.

**Non-goals:** Changing the MVI architecture, pure reducers, drivers, or monolithic state. These are the agent-friendly core and stay as they are.

**Integration branch:** `worktree-agent-ergonomics` (worktree at `.claude/worktrees/agent-ergonomics`)
**Status ledger:** `dev-plans/PLAN-1-status.md` (created and maintained by the coordinator)

---

## 0. Background & Rationale

An assessment of Sygnal for agent usability found:

| Strengths (keep) | Weaknesses (fix) |
|---|---|
| Fixed component slots (view / intent / model / initialState / context) | Components are wired together by plain strings (view class ↔ intent selector, intent key ↔ model key, `EVENTS` emit ↔ select, Collection `from`), and mismatches fail **silently** |
| Pure reducers are unit-testable without a DOM | The isolation boundary (a parent can't see DOM events inside a child component) fails silently |
| Features are small, additive diffs | Many equivalent forms for one concept (reducer / `set()` / object / shorthand; ABORT vs EFFECT; two view signatures; `CHILD.select` string vs fn) |
| Side effects live in drivers; state lives in one place | xstream is less familiar to agents than RxJS, so they reach for RxJS operators that don't exist |
| Reducer/action model resembles Redux/Elm | `simulateAction` bypasses intent, the layer with the most bugs |
| | Errors and warnings don't point to a fix; the agent reference is 1,300 lines |

### Considered and rejected: element-bound triggers (`<button action:click="X">`)
Rejected. It breaks Sygnal's rule of no event binding in the view, and it would make readers (humans and agents) look in two places for actions. Its main benefit was catching view↔intent selector mismatches. Workstreams **1D** (static class ↔ selector cross-reference) and **1A** (runtime selector/isolation diagnostics) catch those instead, so actions stay defined only in `.intent`.

---

## 1. Coordinator Operating Model

The primary agent is the **coordinator**. It does not implement features. It delegates, sequences, validates, merges, and talks to the user.

### 1.1 Responsibilities
1. **Delegation:** Spawn one implementation subagent per workstream, using the brief template (§1.5).
2. **Concurrency control:** Run at most **4 implementation subagents at once**. Never run two concurrent workstreams that own the same file (§1.3).
3. **Communication:** Subagents can't ask the user questions. They return `QUESTION:` / `BLOCKED:` blocks. The coordinator answers from this plan when it can; otherwise it batches questions to the user with `AskUserQuestion`. Every decision goes in the Decision Log in the status ledger.
4. **Validation:** Rerun all gates independently after every merge (§1.4). Never trust a subagent's "tests pass" claim without rerunning. Review each diff against the workstream's acceptance criteria.
5. **Merging & conflicts:** Merge each workstream branch into the integration branch in the order given in each phase. Resolve conflicts yourself. If a resolution needs domain judgement, resume the authoring subagent with `SendMessage` and the conflict hunks.
6. **Ledger:** Keep `dev-plans/PLAN-1-status.md` up to date: workstream status, branch, agent ID, gate results, open questions, decisions.

### 1.2 Branch & worktree strategy
*(Revised during Phase 0. See status tracker D5 / G-004.)* Subagents inherit the coordinator's worktree pin, so a subagent can't run Bash in a worktree the coordinator created and passed by path. Instead:

1. Spawn each implementation subagent with `Agent({ isolation: "worktree", ... })`. The harness creates its own worktree and branch.
2. The subagent's **first** action syncs its branch to the integration branch and installs dependencies:
   ```bash
   git merge --ff-only worktree-agent-ergonomics   # if that fails: git reset --hard worktree-agent-ergonomics (fresh branch only)
   npm ci --no-audit --no-fund && npm ci --prefix browser-tests --no-audit --no-fund
   (cd examples/kanban && npm install --no-audit --no-fund)
   ```
3. The subagent commits on its harness-assigned branch and reports the **branch name** in its final report.

- Subagents never merge into or push the integration branch.
- The coordinator merges with `git merge --no-ff <branch>` from the integration worktree.
- Workstreams that depend on earlier merged work are spawned **after** that dependency is merged into the integration branch.
- Never use a bare `git stash` (the stash stack is shared across worktrees).
- Worktree cleanup after the phase closes is done by the user (removing worktrees from the coordinator was denied by the permission classifier).

### 1.3 File ownership (conflict avoidance)
Hot files. During a phase, only the listed owner may edit them. Others request changes through the coordinator.

| File / area | Phase 0 | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|---|
| `src/component.ts` | 0B (hook points only) | **1E** (message retrofit only) | 2A (strict hooks only, after 1E merged) | — |
| `src/extra/diagnostics/**` (new) | 0B (scaffold + API) | **1A** (checks) | 2A (strict rules), 2B (inspect) — serialized | — |
| `src/index.d.ts` | 0B (diagnostics types) | **1B** | 2B (inspect types) | — |
| `src/index.ts` (exports) | 0B | coordinator applies export lines requested by subagents | coordinator | — |
| `src/extra/testing.ts` | — | **1C** | — | — |
| `src/extra/reducers.ts` | — | **1B** (`event()`) | — | — |
| `src/extra/eventDriver.ts` | — | **1A** | — | — |
| `src/cycle/dom/**` | — | **1A** (instrumentation only) | — | — |
| `src/vite/plugin.ts` | 0B (dev flag define) | — | **2C** | — |
| `sygnal-check/**` (new package) | — | **1D** | 2A (rules), 2B (graph) — serialized | — |
| `examples/**` | — | — | **2D** | — |
| `docs/**`, `README.md`, `skills/**`, `llms.txt` | — | — | — | 3A/3B/3C split by path |
| `type-tests/**` | — | **1B** | — | — |
| `evals/**` (new) | 0A | — | — | 4A |

**Rule:** A subagent that needs to touch a file it doesn't own stops and returns `QUESTION:` with the proposed diff. The coordinator applies the change or reassigns ownership.

### 1.4 Validation gates
Run from the integration worktree after **every** merge:

```bash
npm run build
npm run build:types
npm test
```

`npm test` runs vitest, then `test:types`, then `test:browser`. All three must pass. In addition:

- **Bundle-size gate** (from Phase 1 on): the `dist/index.esm.js` gzip size must not grow by more than **1.5 KB** over the Phase 0 baseline when diagnostics are off. Record the baseline in the ledger during Phase 0.
- **Examples gate** (from Phase 2 on): `cd examples/<name> && npm run build` succeeds for kanban, todomvc, getting-started, ts-example-2048, and drag-drop.
- **Zero-diagnostics gate** (from Phase 2D on): every example produces zero warnings from runtime diagnostics and from `sygnal-check`.
- **Phase-close review:** at the end of each phase, run `/code-review high` on the phase's merged diff (`git diff <phase-start-tag>..HEAD`). Fix confirmed findings before tagging. Tag each phase close as `plan1-phase<N>`.

### 1.5 Subagent brief template
Each brief must stand alone. Subagents have no memory of this conversation.

```
You are implementing workstream <ID> of dev-plans/PLAN-1.md in the Sygnal repo.

FIRST (you run in your own isolated worktree): run
  git merge --ff-only worktree-agent-ergonomics   (fresh branch only: git reset --hard worktree-agent-ergonomics if ff fails)
  npm ci --no-audit --no-fund && npm ci --prefix browser-tests --no-audit --no-fund && (cd examples/kanban && npm install --no-audit --no-fund)
Report your branch name (git branch --show-current) in the final report.
Read: CLAUDE.md, dev-plans/PLAN-1.md §<workstream section>, and <listed files>.

Goal: <one paragraph>
You OWN (may edit): <paths>
You must NOT edit: <paths>. If you need a change there, stop and return QUESTION.
Frozen interfaces you must code against: <paths/signatures>
Deliverables: <list>
Acceptance criteria: <list, copied from the plan>
Validation: run `npm run build && npm run build:types && npm test` and paste the tail of the output.

Commit on branch plan1/<id> with small logical commits ending in:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

Final report format:
STATUS: DONE | BLOCKED | PARTIAL
SUMMARY: <what changed, by file>
TESTS: <added tests; gate output tail>
DEVIATIONS: <anything differing from the plan, and why>
QUESTION: <only if needed; include options and your recommendation>
```

### 1.6 Escalation rules
- **Coordinator decides alone:** naming, internal module structure, test organization, wording of diagnostic messages, anything this plan already decides.
- **Ask the user:** anything marked **[USER DECISION]** below; new runtime dependencies; breaking changes to public API; anything that changes the default behavior of existing apps (including new console warnings appearing in production); release/version decisions; spending on eval runs beyond the budget in §7.

---

## 2. Diagnostic Code Scheme (shared reference)

All new and retrofitted diagnostics use stable codes with a docs link:
`[Sygnal SYG123] <Component>: <what's wrong>. <how to fix>. https://sygnal.js.org/reference/errors#syg123`

The base URL is confirmed in 0B by reading `docs/astro.config.mjs`. Ranges:

| Range | Area |
|---|---|
| SYG1xx | Wiring: intent ↔ model ↔ view ↔ events |
| SYG2xx | State & reducers |
| SYG3xx | Streams & intent construction (incl. xstream hints) |
| SYG4xx | Collections, Switchable, sub-components, context |
| SYG5xx | Strict mode / canonical-form violations |
| SYG6xx | Drivers & run configuration |
| SYG9xx | Internal invariants |

Severity levels: `error` (throws), `warn` (console + collected), `info` (collected only, surfaced through inspect/test helpers).

---

## 3. Phase 0 — Foundations

Three workstreams run in parallel. **0C is a user-decision gate that blocks 2A, 2D and Phase 3.**

### 0A — Baseline agent-usability eval harness
**Owner paths:** `evals/agent-ergonomics/**`
**Goal:** Build a repeatable measurement of how well agents write Sygnal, so improvements can be proven.

Deliverables:
- `evals/agent-ergonomics/README.md`: methodology, how to run, how to score.
- `tasks/` with **8 tasks**. Each has a starter app (a copy of a small app based on kanban or todomvc, pinned to the integration-branch build), a natural-language task prompt, and **hidden acceptance tests** kept outside the task dir, so the agent under test never sees them. Required task mix:
  1. Add a new button + action + reducer.
  2. Add child→parent communication through a Collection.
  3. Cross-component communication through EVENTS.
  4. Add a derived value through context or calculated fields.
  5. Async side effect through a custom driver.
  6. Fix a seeded wiring bug (selector typo).
  7. Fix a seeded isolation-boundary bug (parent listening to a child's DOM).
  8. Refactor: extract a sub-component with PARENT output.
- **React arm:** equivalent tasks 1–5 and 8 in a minimal React + Vite starter.
- `run.md`: exact coordinator procedure for running a trial with a fresh subagent. The subagent gets only the task prompt, the starter dir, and the `sygnal-dev` skill (for the Sygnal arm).
- `score.mjs`: runs hidden tests and records pass/fail, iteration count (number of times the agent ran the app/tests), and failure category (wiring / isolation / reducer shape / stream operator / other).
- `results/baseline.json` from the baseline run.

Acceptance: harness runs end to end on one task in both arms; hidden tests can't be read from the task dir.
**[USER DECISION] before running the baseline:** the trial budget (see §7, Eval budget).

### 0B — Diagnostics infrastructure (frozen interface)
**Owner paths:** `src/extra/diagnostics/**` (new), plus minimal hook points in `src/component.ts`, `src/index.ts`, `src/index.d.ts`, `src/vite/plugin.ts`
**Goal:** One shared, tree-shake-friendly diagnostics core that every later workstream reports through.

Deliverables:
- `src/extra/diagnostics/codes.ts`: code registry `{ code, severity, title, docsSlug }` covering all SYG ranges. Later workstreams add entries. Seed it with codes for the existing messages that 1E will retrofit.
- `src/extra/diagnostics/index.ts`, with API:
  - `report(code, { component, message, fix, data })`
  - `getDiagnostics()`
  - `clearDiagnostics()`
  - `onDiagnostic(cb)`
  - mode resolution: `'off' | 'collect' | 'warn' | 'error'`
- **Dev-mode detection.** Use the first defined of:
  1. explicit `run(App, drivers, { diagnostics })` option;
  2. `globalThis.__SYGNAL_DEV__`, injected by the Vite plugin as `true` in `serve` mode;
  3. default `'off'`.

  In production the checks must be no-ops, and the size gate must hold.
- **Hook points in `component.ts`.** Add a small number of clearly labeled calls into the diagnostics module, with no check logic inside `component.ts`:
  - after intent is built: actions plus the selectors used;
  - after the model is normalized: action/sink map;
  - after each render (root DOM element available);
  - on each reducer result: previous state, next state, action;
  - on dispose.

  Name them `diag.onIntent`, `diag.onModel`, `diag.onRender`, `diag.onReducer`, `diag.onDispose`. They're no-ops when diagnostics are off.
- Wire through `getDevTools()` so the browser extension can read `getDiagnostics()`.
- Types in `src/index.d.ts`: `Diagnostic`, `DiagnosticCode`, `DiagnosticsMode`, and the new `RunOptions.diagnostics`.
- Unit tests in `test/diagnostics-core.test.js`.
- Record the bundle-size baseline in the ledger.

Acceptance: all gates pass; with diagnostics off, the hook calls do nothing measurable; the interface is documented in a header comment and **frozen** at merge. Changes after the freeze go through the coordinator.

### 0C — Canonical-forms specification **[USER DECISION]**
**Owner:** coordinator (drafts directly; no subagent)
**Goal:** Pick exactly one blessed form per concept. This drives strict mode (2A), example migration (2D), and all docs (Phase 3).

The coordinator writes `dev-plans/PLAN-1-canonical-forms.md` from the draft table below. It presents the table to the user with `AskUserQuestion`, one question per row that's genuinely contested, and records the answers.

| Concept | Proposed canonical | Non-canonical (strict mode flags) | Notes |
|---|---|---|---|
| View signature | `function C({ state, context, ...props })` | `(props, state)` positional | |
| State update | plain reducer `(state, data) => ({ ...state, ... })`; helpers `set()`/`toggle()` allowed | — | helpers have explicit names, so they don't add ambiguity |
| No-op from state reducer | `return ABORT` | returning `undefined` / the same state | |
| Side-effect only | `{ EFFECT: fn }` | `ABORT` used to suppress state after a side effect | |
| Multi-sink entry | object form `{ STATE, EVENTS, ... }` | — | |
| Single non-STATE sink | **[decide]** object form `{ EVENTS: fn }` *or* shorthand `'A \| EVENTS'` | the other one | Recommendation: object form (one structure to learn; shorthand hides the sink in a string key) |
| Emit global event | `emit('TYPE', fn)` helper **[decide]** vs `{ EVENTS: s => ({type, data}) }` | the other one | Recommendation: `emit()` (the type sits next to the call, so it's easy to grep) |
| Child → parent | `PARENT` + `CHILD.select(ComponentFn)` | `CHILD.select('Name')` | |
| Non-adjacent communication | `EVENTS` | — | |
| Parent → child imperative | `createCommand()` | — | |
| Top-down data | `.context` | prop-drilling through more than 2 levels (info only) | |

### Phase 0 merge order & close
Merge 0B first (other work depends on its frozen interface), then 0A. 0C is a document plus decisions; commit it directly. Run the gates, then tag `plan1-phase0`.
**Coordinator then asks the user:** approve the baseline eval budget, then run the baseline (0A procedure) *before* Phase 1 changes land. The baseline must reflect the current framework. Running it against the `plan1-phase0` tag is acceptable, since 0B has no visible behavior when diagnostics are off.

---

## 4. Phase 1 — Core Capabilities (parallel)

Five workstreams. Ownership is disjoint per §1.3, so all five can run concurrently, but cap concurrency at 4. **Start order:** 1A, 1B, 1C, 1D first; start 1E when the first of those finishes.

### 1A — Runtime consistency checks
**Owns:** `src/extra/diagnostics/checks/**`, `src/extra/eventDriver.ts`, instrumentation in `src/cycle/dom/**`
**Codes against:** the frozen 0B hook API. **Must not edit `component.ts`.**

| Code | Check | Severity | Mechanism / nuance |
|---|---|---|---|
| SYG101 | Intent action has no model entry | warn | Compare intent keys to model keys (after expanding shorthand). An intent action with no handler always does nothing, so no exclusions are needed. |
| SYG102 | Model entry is unreachable: no intent trigger, not a built-in (BOOTSTRAP/INITIALIZE/HYDRATE/DISPOSE), never targeted by `next()` | info | `next()` targets are only known at call time, so this is collected as info and shown in inspect/tests. The static checker (1D) owns the warn-level version. |
| SYG103 | Intent selector matched no rendered element during the component's lifetime so far | info → warn | Record selectors through `MainDOMSource.select` instrumentation. After each render, test against the component's root element. Escalate to warn only after the component has rendered ≥ 3 times **and** 2 s of idle without ever matching (to tolerate conditional rendering). The static check (1D) is the primary signal. |
| SYG104 | **Isolation boundary:** a selector matches nothing in the component's own scope but matches elements inside a child component | warn | Use `ScopeChecker` / isolation scope data. The message names the child component and says: "handle this event inside <Child> and send it up with PARENT or EVENTS". |
| SYG105 | `EVENTS.select('X')` but nothing ever emits `X` (and the reverse) | info | Registry in `eventDriver.ts`; reported via inspect. |
| SYG201 | STATE reducer returned an object missing keys that existed in the previous state (likely a forgotten spread) | warn | Once per action per component. Suppress if the reducer is a `set()`/`toggle()` helper. |
| SYG202 | STATE reducer returned `undefined` | warn | Unify with the existing warning (coordinate wording with 1E). |
| SYG301 | Intent construction threw `x.<op> is not a function` where `<op>` is a known RxJS operator | error (rethrow, enriched) | Map, e.g., `switchMap → map(...).flatten()`, `debounceTime(ms) → compose(debounce(ms))`, `mergeMap → map(...).flatten()` (note `flattenConcurrently`), `pipe → compose`, `tap → debug`, `distinctUntilChanged → compose(dropRepeats())`, `withLatestFrom → compose(sampleCombine(...))`, `scan → fold`, `take/skip → take/drop`. Put the mapping table in `checks/rxjsHints.ts`. |
| SYG401 | Collection `from` field missing or not an array | warn | Report through diagnostics in addition to the existing console output (1E rewrites the existing messages). |

Tests: one test file per check under `test/diagnostics/`, using `renderComponent`. Browser test for SYG103/104 in `browser-tests/src/` (needs a real DOM).
Acceptance: every check has a positive and a negative test; the kanban example produces no false positives (verify manually with diagnostics `'collect'`); size gate holds.

### 1B — Typed links
**Owns:** `src/index.d.ts`, `type-tests/**`, `test/types.test.ts`
**Goal:** Make the string links type-checked for TypeScript users, with no runtime changes.

Deliverables:
1. **`ActionsOf<typeof intent>`** utility type. It derives the `ACTIONS` map (action name → payload type) from an intent function's return type, so `Component<State, Props, Drivers, ActionsOf<typeof intent>>` type-checks model keys and reducer `data` types. A model key that's not in the intent becomes a type error. The built-in actions stay allowed.
2. **EVENTS registry via module augmentation:**
   ```ts
   declare module 'sygnal' { interface SygnalEvents { DELETE_LANE: { laneId: string } } }
   ```
   With it, `EVENTS.select('DELETE_LANE')` is typed `Stream<{laneId: string}>`, `emit('DELETE_LANE', fn)` checks `fn`'s return type, and unknown event names are errors once the registry is non-empty. When the registry is empty, behavior stays as it is today (`any`).
3. **Typed `CHILD.select(Comp)`:** infer the stream type from `Comp`'s PARENT sink return type.
4. **Collection `from`:** constrain to `keyof State` whose value is an array (when `State` is known).
5. **New `event(type, payload?)` helper** (decision D12; spec in `PLAN-1-canonical-forms.md`, "New API required"). Runtime in `src/extra/reducers.ts` (1B owns this file in Phase 1), exported from `src/index.ts` (coordinator applies the line), typed against the `SygnalEvents` registry. Unit tests go in `test/reducers.test.js`.
6. Investigate typing intent DOM selectors against the view. Expected outcome: **not feasible in TS**. Write up findings in the report; the static checker covers this.

Tests: type-tests showing correct code compiles and each misuse produces an error (use `// @ts-expect-error`).
Acceptance: all existing type-tests still pass unchanged (no breaking changes for existing typed users). **If any change breaks an existing type-test, stop and return QUESTION.**

### 1C — DOM-level test helpers
**Owns:** `src/extra/testing.ts`, `test/testing-utility.test.js`; also `src/index.d.ts` RenderOptions/RenderResult types — **coordinate with 1B:** 1C returns its type diff in the report and the coordinator applies it after 1B merges.
**Goal:** Let tests go through the intent layer, where wiring bugs live.

Deliverables:
- `simulateEvent(selector, eventType, eventInit?)`: feeds an event through the mock DOM source, so the component's real intent streams fire. Supports `target.value`, `key`, `dataset`, and `checked` through `eventInit`.
- Must work with the existing `DOM.click('.x')` shorthand and with `DOM.select('.x').events('click')`.
- `renderComponent` options: `diagnostics: 'collect' | 'error'` (default `'collect'`). Result gains `t.diagnostics` (an array) and `t.expectNoDiagnostics()`.
- `t.html()`: serializes the latest VNode to a string (reuse `renderToString` internals if suitable) so agents can assert on and inspect output.
- Rewrite at least one test in `examples/kanban/src/*.test.js` to use `simulateEvent`, as a demonstration. The coordinator checks this against 2D ownership; it's allowed because 2D hasn't started.

Acceptance: `simulateEvent` on a misspelled selector produces no state change **and** a collected SYG103 diagnostic once 1A has merged. If 1A isn't merged yet, mark that test `todo` and the coordinator enables it after both merge.

### 1D — Static checker package (`sygnal-check`)
**Owns:** `sygnal-check/**` (new top-level package, sibling of `create-sygnal-app/`)
**[USER DECISION — the coordinator asks before spawning]:** packaging. Recommendation: a separate npm package `sygnal-check` that depends on `@babel/parser` (handles JS/JSX/TS/TSX), keeping core runtime dependencies unchanged. Alternatives: (b) a subpath `sygnal/check` with `@babel/parser` as an optional peer dependency; (c) use the TypeScript compiler API (heavy, and JS users may not have it).

Deliverables:
- CLI: `npx sygnal-check [paths...] [--json] [--strict] [--graph]`. Exits non-zero on warn/error (configurable).
- Programmatic API: `check(files, options) → Diagnostic[]`, using the same `Diagnostic` shape and codes as 0B. Import the codes from the built `sygnal` package or a shared JSON generated at build time; never copy them by hand.
- Component discovery: functions with `.intent` / `.model` / `.initialState` assignments, including `export default`, plus TS `const X: Component<...> = ...`.
- Rules (static versions, warn level):
  - **SYG110** class/id selector in intent not present in the same component's JSX (static `className` strings, `classes()` calls, template literals with static parts; skip dynamic selectors with an info diagnostic).
  - **SYG101** intent key without model entry.
  - **SYG102** model key with no intent trigger, not built-in, and not a `next('X')` string literal anywhere in the component.
  - **SYG104s** intent selector whose class only appears in a *child* component's JSX (resolve imports of components used in this view, including `<Collection of={X}>`).
  - **SYG105s** EVENTS emitted/selected with no counterpart anywhere in the scanned project (string literals only).
  - **SYG401s** Collection `from="x"` where `x` isn't a key of `initialState` (when the state is statically known).
- Fixture-based tests: `sygnal-check/test/fixtures/{good,bad}/*.jsx`, with expected diagnostics in snapshots.
- Run against all `examples/`; record results in the report. Don't fix the examples (2D owns that).

Acceptance: zero false positives on the kanban and todomvc examples, or a documented reason for each remaining one; runs in < 2 s on the kanban example.

### 1E — Error-message retrofit
**Owns:** `src/component.ts` (message strings and `report()` call sites only), `src/collection.ts`, `src/switchable.ts`, `src/pragma/**`
**Goal:** Give every existing `throw` / `console.warn` / `console.error` a SYG code, a fix hint, and a docs link, through the 0B `report()` API.

Deliverables:
- Inventory table in the report (currently about 50 call sites in `component.ts`; see `grep -n "console\.\(warn\|error\)\|throw new Error" src/component.ts`).
- Convert each one. Errors that currently throw keep throwing, with the code in the message. Warnings route through `report()`. In `'off'` mode, keep the existing console behavior for messages that already exist today, so production apps keep their current visibility.
- Improve the wording of the worst offenders, e.g. the `sygnal-factory` capitalized-selector message, and the Collection `from` errors that end in "Attempting to use parent component state." (state what will actually happen).
- Add the codes to `codes.ts`. **Coordinate:** `codes.ts` is 1A-owned in Phase 1, so 1E returns its code entries in the report and the coordinator merges them. Alternative: the coordinator pre-assigns code ranges (1E: SYG2xx/4xx/6xx existing; 1A: new codes listed above).

Acceptance: `grep` finds no un-coded warn/error/throw left in the owned files; all existing tests pass. Tests that assert on message text may be updated; list each one in the report.

### 1F — Framework bug fixes (added in Phase 0; user decision Q5)
**Owns:** `src/component.ts` (sink/state-sampling and render-scheduling logic only), `src/extra/driverFactories.ts`, new regression tests under `test/` and `browser-tests/src/`
**Starts after 1E merges.** Both touch `component.ts`, so they're serialized.
- **B-003:** every sink of one action must see the same state snapshot, even when other actions land in the same tick. Write a failing regression test first.
- **B-004:** a controlled `<input value>` must reflect state after coalesced same-tick renders. Fix through a snabbdom props/hook strategy that compares against the live `elm.value`. Browser test required.
- **B-005:** `driverFromAsync` must deliver rejections to the app (a documented error channel, e.g. a `.select('error')` or an `{ error }` payload — the subagent proposes, the coordinator approves) and must handle `null`/`undefined` resolutions without throwing.
- **Added during Phase 1:** B-008 (isolatedState sub-component wipes parent state), B-009 (verify: Collections sharing item ids collide on isolation scope), G-020 (non-enumerable EVENTS emitter stamps), G-025 (renderComponent passes hmrActions/components), G-026 (double SYG412 print), and **G-024 (user request): `simulateEvent` reports SYG103/SYG104 under renderComponent**, using its vnode targeting and isolation-scope knowledge.
- Report each fix's behavior change. **Any change to existing public behavior → QUESTION.**

### Phase 1 merge order & close
1B → 1A → 1C (apply its type diff, enable the cross-dependent test) → 1D → 1E (most likely to conflict with 0B hook lines in `component.ts`; the coordinator resolves) → 1F.
Run the gates and the phase-close review, then tag `plan1-phase1`.

---

## 5. Phase 2 — Strictness, Introspection, Integration

Starts after `plan1-phase1` **and** after 0C decisions are recorded.

### 2A — Strict mode (canonical-form enforcement)
**Owns:** `src/extra/diagnostics/rules/strict/**`, strict hook lines in `component.ts`, `sygnal-check/src/rules/strict/**`
- Runtime: `run(App, drivers, { strict: true })` and `renderComponent(C, { strict: true })` turn on the SYG5xx checks from `PLAN-1-canonical-forms.md` (positional view signature, `CHILD.select(string)`, non-canonical model forms, ABORT-for-side-effect, …).
- Static: `sygnal-check --strict` implements the same rules. Use a single shared rule-ID list.
- Each SYG5xx message shows the canonical rewrite of the offending code where possible.
- **Optional, if cheap:** a `--fix` codemod for mechanical rewrites (shorthand ↔ object, `CHILD.select('Name')` → `CHILD.select(Name)` when it resolves). The coordinator decides based on how far 1D got.

Acceptance: strict mode is off by default (no behavior change for existing apps); every canonical-form row has a rule plus tests.

### 2B — Inspect (machine-readable app graph)
**Owns:** `src/extra/diagnostics/inspect.ts`, inspect types in `src/index.d.ts`, `sygnal-check/src/graph.ts`
- **Runtime:** `getDevTools().inspect()` (and `window.__SYGNAL_DEVTOOLS__.inspect()`) returns JSON. Build on the existing `_extractMviGraph` in `src/extra/devtools.ts`. Shape:
  ```
  { components: [{ name, id, parentId, actions: [{ name, trigger: 'intent'|'next'|'builtin', sinks }],
                   stateKeys, contextProvides, contextConsumes?, eventsEmitted, eventsSelected,
                   selectors: [{ selector, matched, isolationHit }], diagnostics }],
    events: { [type]: { emitters, selectors } } }
  ```
- **Static:** `sygnal-check --graph` emits the same shape (fields that can't be known statically are omitted or `null`).
- Docs: a short "how an agent should use inspect" section (handed to Phase 3).
- **[USER DECISION — the coordinator asks at phase start]:** also ship a tiny MCP server (`sygnal-check mcp`) exposing `check`, `graph`, and `explain(code)` tools? Recommendation: yes, but as a stretch goal after 2B core is merged.

### 2C — Vite plugin integration
**Owns:** `src/vite/plugin.ts`, `src/vite/plugin.d.ts`, `test/vite-plugin.test.js`
- Define `__SYGNAL_DEV__` (if 0B didn't already finish this).
- Option `check: boolean | { strict?: boolean }`. If `sygnal-check` is installed, run it on changed files during `serve` and send results to the Vite error overlay / terminal; skip silently when it isn't installed.
- Option `diagnostics: 'warn' | 'error'` passed to the runtime.

### 2D — Example migration & zero-diagnostics
**Owns:** `examples/**`, `create-sygnal-app/template-*/**`
- Split across up to 3 subagents by example group: (kanban, drag-drop, todomvc), (getting-started, playground, ts-example-2048, advanced-feature-tests), (ssr, vike, astro-smoke, hmr-smoke, ai-panel-spa, create-sygnal-app templates).
- Migrate each to canonical forms. Run `sygnal-check --strict` and runtime diagnostics in `'collect'` mode; get to zero.
- Convert example tests to use `simulateEvent` wherever they currently test only reducers *and* the intent wiring isn't otherwise covered.
- **Do not change app behavior.** Each example's existing tests and build must pass.

### Phase 2 merge order & close
2C → 2B → 2A → 2D (group merges one at a time).
Run the gates, including the examples gate and the zero-diagnostics gate, plus the phase-close review. Tag `plan1-phase2`.

---

## 6. Phase 3 — Agent Context & Documentation

Starts after `plan1-phase2`. Up to 3 parallel subagents, split by path.

### 3A — Normative spec (`llms.txt`)
**Owns:** `llms.txt` (repo root, and copied to `docs/public/llms.txt`), `llms-full.txt` (optional)
- At most **~250 lines**. **Only canonical forms.** Structure:
  1. mental model (5 lines);
  2. component anatomy;
  3. one canonical example per concept;
  4. the wiring rules (selectors are scoped to the component's own JSX; actions map 1:1 to model entries; …);
  5. xstream cheat-sheet for RxJS users (from the 1A hint table);
  6. diagnostics: how to read codes and use inspect;
  7. testing with `renderComponent` + `simulateEvent`.
- **Evidence-driven additions** (from the friction analyzer, `evals/agent-ergonomics/results/analysis/`; Sygnal agents spent 9 s per trial reading library source, which React agents never did):
  - An **"API facts" section** covering: how a child reads props (view spread, 4th reducer argument); the `CHILD.select(Comp)` payload shape; `run(App, drivers, options)` and its return value; ABORT; blur/focus handling (`DOM.blur`, focusout); which xstream operators exist (with the RxJS mapping).
  - A **"Testing your change" recipe**: when to use `renderComponent` + `simulateEvent` + `expectNoDiagnostics`, and how to mount with `run()` in jsdom. 35 of 40 and 20 of 20 Sygnal agents wrote their own tests, and the old skill had no testing section.
- Acceptance: a fresh subagent given only `llms.txt` completes eval tasks 1 and 3 (smoke check; not the full eval).

### 3B — Skill rewrite
**Owns:** `skills/sygnal-dev/**`, `create-sygnal-app` CLAUDE.md/AGENTS.md templates (if present; otherwise add them)
- `SKILL.md` becomes a lean router: workflow plus "run `sygnal-check` / read diagnostics / use inspect". Point at `llms.txt` as the primary reference. Trim `references/component-patterns.md` to canonical forms only, or replace it with `llms.txt`.
- Add a "debugging loop" section: run tests → read SYG codes → `inspect()` → fix.
- The skill must carry the API-facts and testing recipe content inline in SKILL.md (it is read whole in 100% of trials; `references/` was opened in only 25–38% of trials). Replace the Model Shorthand section with the canonical object form + `event()`: 14 of 20 tier-2 solutions used the shorthand because the skill teaches it.
- Scaffolded projects get an `AGENTS.md` / `CLAUDE.md` that points to `llms.txt` and the check command.
- **[USER DECISION]:** the user-level copy at `~/.claude/skills/sygnal-dev/` differs from the repo copy. Sync it from the repo after merge? (Recommendation: yes; the coordinator does it after Phase 3 merges, with confirmation.)

### 3C — Docs site & repo docs
**Owns:** `docs/src/content/docs/**`, `README.md`, `ROADMAP.md`, `CLAUDE.md`
- New pages:
  - `reference/errors.md`: every SYG code with an anchor, cause, fix, and before/after example. Generated from `codes.ts` plus a hand-written explanation file.
  - `guide/diagnostics.md`
  - `guide/strict-mode.md`
  - `integration/agents.md`: llms.txt, the skill, check, inspect, MCP.
- Update `integration/testing.md` (`simulateEvent`, diagnostics), `integration/typescript.md` (`ActionsOf`, EVENTS registry, typed CHILD), `integration/debugging.md`, `reference/api.md`, `reference/types.md`.
- Rewrite every docs code sample into canonical form. Non-canonical forms appear only on a single "Alternative forms" page, clearly labeled.
- README: short "Built for agents" section. ROADMAP: add an entry for this work. CLAUDE.md: new source paths, test counts, and the gate commands.
- Run the `update-sygnal-resources` skill's checklist as the final sweep.

### Phase 3 merge order & close
3A → 3B → 3C. Run the gates plus the docs build (`cd docs && npm run build`). Tag `plan1-phase3`.

---

## 7. Phase 4 — Measure & Release

### 4A — Eval re-run
- Rerun the 0A harness on `plan1-phase3` with the **same trial budget and task set** as the baseline. The Sygnal arm uses the new skill and `llms.txt`.
- `evals/agent-ergonomics/results/phase3.json` plus `REPORT.md`: first-attempt pass rate, mean iterations, failure-category distribution, baseline vs after vs React arm.
- If a failure category hasn't improved, the coordinator files follow-ups in `dev-plans/PLAN-2-candidates.md`.
- **Analyzer:** run `analysis/analyze.mjs` on each re-run, and `analysis/compare.mjs --base baseline --next phase3` (and the same for t2). Record the Agent tool's reported `total_tokens` and `duration_ms` per trial.
- **Harness noise:** the coordinator's worktree guard refused commands in both arms, costing 8–17 s per trial (D27). For the re-run, either run trials from a coordinator session that isn't worktree-pinned, or report the deltas with HARNESS-GUARD time subtracted, keeping the same method for the baseline comparison.

**Eval budget [USER DECISION at Phase 0 close]:**
- Recommendation: 8 Sygnal tasks × 3 trials, plus 6 React tasks × 3 trials, for baseline and for re-run: 84 agent runs in total.
- Cheaper option: 1 trial each (28 runs). Trial counts this small give directional results, not statistical ones; say so in the report.

### 4B — Release prep
- Changelog entry and a migration note. Strict mode and diagnostics are opt-in, so no breaking changes are expected; any breaking type changes from 1B were escalated earlier.
- **[USER DECISION]:** version bump (recommendation: minor, `5.4.0`); whether to publish `sygnal-check`; whether to merge the integration branch to `main` (the coordinator opens a PR, and does not merge without approval).
- Update auto-memory (`MEMORY.md` is over its 200-line limit; move details into topic files) with the new diagnostics and inspect architecture.

---

## 8. Dependency Graph

```
Phase 0:  0A ─────────────────────────────────────────────┐ (baseline run)
          0B ──┬─────────────┬────────┬────────┐           │
          0C ──┼─(decision)──┼────────┼────────┼──┐        │
               ▼             ▼        ▼        ▼  │        │
Phase 1:  1A  1B  1C(→needs 1A for one test)  1D  1E      │
               │   │          │        │      │   │        │
               └───┴────┬─────┴────────┴──────┘   │        │
                        ▼                         ▼        │
Phase 2:  2C → 2B → 2A(needs 0C, 1A, 1D) → 2D(needs 0C, 2A)│
                        ▼                                  │
Phase 3:  3A → 3B → 3C (all need 0C + Phase 2)             │
                        ▼                                  ▼
Phase 4:  4A (compares against 0A baseline) → 4B
```

## 9. Risk Register

| Risk | Mitigation |
|---|---|
| Runtime selector check (SYG103) is noisy because of conditional rendering | info-level by default, render-count + idle threshold before warn; the static check is primary |
| SYG201 (missing keys) flags intentional key removal | once per action; suppressible with `// sygnal-ignore SYG201` in static checks and with `{ diagnostics: { ignore: ['SYG201'] } }` at runtime |
| Diagnostics add production weight | hook calls are no-ops when off; 1.5 KB gzip gate; checks live in a separate module so they can be lazy-loaded in dev |
| `component.ts` merge conflicts (0B, 1E, 2A all touch it) | strict serialization through ownership (§1.3); hook lines are labeled and grouped |
| 1B type changes break existing typed users | any change to an existing type-test needs a QUESTION → user decision |
| Eval results are noisy | fixed task set, hidden tests, same budget for both runs; report confidence honestly |
| Subagent edits outside its owned paths | the coordinator checks `git diff --stat` against the ownership table before every merge and rejects stray edits |

## 10. Definition of Done
- All gates are green on the integration branch at `plan1-phase3`.
- Every example has zero diagnostics in strict mode.
- Every SYG code is documented, and every console message the library emits carries a code.
- `llms.txt` is ≤ 250 lines, and the skill points to it.
- The eval report shows baseline vs after numbers.
- A PR to `main` is open with a summary of each phase (not merged without user approval).
