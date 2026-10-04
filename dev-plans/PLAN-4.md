# PLAN-4: Controls and core ergonomics for 6.0.0

**Goal:** make Sygnal easier for agents to write and for humans to read, without changing its MVI shape. Two parts:
1. **Controls** replace the class-string link between a view and its intent with a shared identifier.
2. The **gap-study items GS-1…GS-16** fill the remaining capability gaps against other front-end frameworks, mostly with 0-byte helpers, statics and checker rules.

**Release:** 6.0.0, together with PLAN-3 (network layer) and PLAN-5 (ecosystem components). It is one major release, held until the user says otherwise (D56): no version bumps, tags, PR to main or publish.

**Status:** complete (2026-10-04). See the tracker's close-out section and `evals/agent-ergonomics/results/REPORT-v4.md`. Decisions D100–D148. Next: [PLAN-4.5](PLAN-4.5.md) (performance), then PLAN-5. The tracker, [`PLAN-4-status.md`](PLAN-4-status.md), was created early to record PLAN-5's requests (D100–D107). The coordinator completes it in 0-A.

**Inputs (read these; this plan references them rather than repeating them):**

| Input | Where | What it gives |
|---|---|---|
| Gap study | [`research/sygnal-6-gap-study.html`](research/sygnal-6-gap-study.html) (https://claude.ai/artifact/MxVtAh3FVeJtmnVCbd5zXL) | For each GS item: rationale, prior art in other frameworks, fit/importance scores, sketch, budget notes |
| View–intent linking study | [`research/view-intent-linking.html`](research/view-intent-linking.html) (https://claude.ai/artifact/ELiw7MwhZDoNL1LrchMT3U) | Corpus measurements, options A–E, the controls design (option D), the `DOM.click(Component)` follow-up, bugs B-1 and the bubbling mismatch |
| Experiments | [`research/gap-study-experiments/`](research/gap-study-experiments/) | Throwaway tests X1–X8, the `controls()` userland prototype, corpus scripts. The README lists the expected results |
| PLAN-3 | `dev-plans/PLAN-3.md` and `PLAN-3-status.md` on `main`, plus `evals/agent-ergonomics/results/REPORT-v3.md` | Mechanisms reused here, budgets (D76, D87), process lessons |
| PLAN-5 (ecosystem) | `claude/sygnal-component-research-b1873e:dev-plans/PLAN-5.md` (named `PLAN-4.md` there until that session applies the rename) | Overlaps (§0.3) and the shared budgets |
| PLAN-1 §0, §1 | `dev-plans/PLAN-1.md` | The rejected element-bound triggers; the coordinator operating model |

**Invariants (as in PLAN-1…4):**
- models return descriptions of effects;
- drivers perform them;
- every state change is an action;
- **views have no event binding and never name an action** (PLAN-1 §0).

Controls keep this: a view renders a control, and only the intent says which events on it produce which actions.

**Plan numbering (2026-10-02):** the plans are numbered in run order. This plan was drafted as PLAN-5 and is now PLAN-4. The ecosystem plan, drafted as PLAN-4 on `claude/sygnal-component-research-b1873e`, is now PLAN-5, and its questions are P5-Q…. PLAN-3 documents written before the rename say "PLAN-4" for the ecosystem plan; read those as PLAN-5.

**ID conventions:**
- Features: **CT-1** (controls) and **GS-1…GS-16**, where GS-n is the gap study's G-n. The "GS" prefix avoids a clash with the trackers' G-### gap numbers.
- Open questions: **P4-Q1…**.
- Decisions start at **D100** and gaps at **G-200**. That leaves D92–D99 and G-184–G-199 for PLAN-3, which is still recording its final eval. PLAN-5 continues after PLAN-4's last number. "P4-D" with no number is the CT-1 canonical-form decision made after 1-E (P4-Q10); PLAN-5 refers to it by that name.

---

## 0. Starting point, dependencies and corrections

### 0.1 State of the 6.0.0 work (2026-10-02)

| Item | State | Effect on PLAN-4 |
|---|---|---|
| PLAN-3 | **Done and merged to `main`** as #14 (`6852127`, 2026-10-03), including its 4-C eval, REPORT-v3 and Phase 6. Its last IDs are D95 and G-189. | PLAN-4 branches from `main`. |
| PLAN-5 (ecosystem; was PLAN-4) | Plan only | Runs after PLAN-4 (P4-Q1, decided) and rebases onto `plan4-integration`. |
| Budgets after PLAN-3 | Core **about 1,897 B** left (40,403 / 42,300 B gated at the end of PLAN-3 Phase 5; the #12 fixes added about 145 B, so 0-A re-measures on `main`), `llms.txt` **17 lines** (283 / 300), SKILL.md **1,657 B** (34,343 / 36,000) | Shared with PLAN-5. See §6 and **P4-Q2**. |
| Bug-fix session "Fix DOM isolation and keystroke bugs" | **Merged to `main`** as #12 (`2cef7ee`), recorded as G-144…G-146 in `PLAN-2-status.md` | B-0, B-1 and the bubbling mismatch are fixed. Bubbling follows native DOM semantics: a parent's own wrapper hears events from inside a child, after the child's listeners, and the mock DOM delivers innermost listeners first (G-145). That settles P4-Q13. GS-14 docs and the controls wrapper pattern can rely on it. |

### 0.2 What PLAN-4 reuses from PLAN-3

These modules are on `main`.
- **The `__sygnalStatic` declaration mechanism** (`initStatics` in `src/component.ts`). Statics work without a model and pause in hidden Switchable pages unless `background: true`. Used by GS-7 (timers) and possibly GS-5 (persist).
- **Sender tagging and reply actions** (`src/extra/replies.ts`): a value on a sink is tagged with the sending instance, and replies reach exactly that instance. Used by GS-2 (element commands) and by `t.actions` causes (GS-10).
- **`src/extra/browserSignals.ts`** (focus, online, visibility): GS-7 pausing, GS-5 cross-tab sync.
- **`sygnal/devtools`** (dev-only entry, D77): GS-10's action log and "Copy as test".
- **The driverless fakes pattern** in `src/extra/testing.ts` (H-9: a fake runs the real driver): GS-2, GS-5 and GS-7 fakes.
- **`objIsEqual` and `dropRepeats`** usage in the core: GS-6 and GS-7 diffing.

### 0.3 Overlaps with PLAN-5

| PLAN-4 | PLAN-5 | Rule |
|---|---|---|
| CT-1 controls | W-1 `defineWidget` host element, F-1 forms, U-1 `sygnal-ui` examples | If controls become canonical (P4-D after 1-E), PLAN-5 writes every new example, recipe and component in the controls form. A widget host may be a control (`<Widget of={…} as={DueDate}>` or similar; PLAN-5 decides). This is why PLAN-4 runs first (P4-Q1). |
| GS-1 behaviors | U-1 headless components, F-1 forms | Native MVI parts of `sygnal-ui` (Tabs, Accordion, Disclosure) can ship as behaviors where they span host markup. F-1 may be a behavior. PLAN-5 decides, using the GS-1 API. |
| GS-2 element commands | U-1 Dialog (Zag) | A native `<dialog>` plus `showModal` becomes the lightweight path; U-1 keeps Zag for the hard widgets. |
| GS-3 a11y lane, GS-9 `uid` | U-1, F-1 | PLAN-5 components and examples must be clean under the SYG7xx rules. |
| GS-7 timers | B-3 browser-sources pack | GS-7 defines the declaration shape. B-3 reuses it for intersection, resize, media and so on; one shape, not two. |
| GS-12 View Transitions | A-1 FLIP for Collection | GS-12's decision record (P-1) comes first and decides whether A-1 shrinks to a fallback. |
| GS-14 Testing Library | none | None. |

### 0.4 Corrections to the reports

- **Gap study GS-4:** the report says to "keep the runtime check that flags in-place mutation". **No such check exists.** GS-4 adds one (SYG222, dev entry), because treating a same-object return as "no change" would otherwise hide in-place mutation. Today that mutation re-renders and is flagged by strict SYG502.
- **Gap study GS-1:** the report gives "0 B core". That holds only for an explicit helper (`withBehaviors(C, …)`). The preferred `uses` static needs a merge hook in the core, estimated at 60–100 B. Spike 0-B measures it.
- **Gap study GS-5 and GS-7:** "0 B" assumes the code arrives through an import (a helper or a registered driver). A plain-object static read by the core costs bytes. 0-B measures both forms.

### 0.5 Handoff to PLAN-5

[`HANDOFF-to-PLAN-5.md`](HANDOFF-to-PLAN-5.md) gives the ecosystem session three things:
- the renumbering;
- the constraints PLAN-5 inherits (budgets, the code reservations in §5, terminology, eval task numbers 30+, the a11y gate);
- 14 suggested updates and investigations (S-1…S-14).

**PLAN-5's answers** (`claude/sygnal-component-research-b1873e` `acc9b12`, `PLAN-5.md` §0.3) accept all 14 suggestions, some with changes, and are recorded in [`PLAN-4-status.md`](PLAN-4-status.md). Four requests affect this plan, all user-approved and accepted:
- the control spec contract (CT-1, D101);
- kind-blind acceptance (CT-1);
- the spec-provided props type (CT-1, D101);
- widget commands through `ELEMENT` (GS-2, D102).

Also: G-17 moves to PLAN-5 as B-4 (D103); the names `defineWidget` and `defineElement` are both kept (D104); `onError` gets a `'widget'` phase (D105). PLAN-5's code reservations (SYG140–149, 230–239, 430–439, 660–669, 720–729) don't overlap §5.

---

## 1. Coordinator operating model

PLAN-1 §1.1–§1.6 and PLAN-2 §1 apply unchanged, with the PLAN-3 lessons included. One coordinator delegates to subagents and doesn't implement features itself. The coordinator owns:
- communication with the user (batched `AskUserQuestion`, every answer logged as a decision);
- delegation, sequencing and concurrency (at most 4 implementation subagents at once);
- verification: it reruns every gate itself after every merge and never trusts a subagent's "tests pass";
- merges and conflict resolution (resuming the authoring subagent with `SendMessage` when a conflict needs domain judgement);
- the tracker.

The coordinator may split, merge or reorder workstreams when that improves quality or reduces conflicts, provided it respects file ownership (§1.3) and records the change in the tracker. The workstream list in §4 is the default split.

### 1.1 Branches, tracker and setup
- **Integration branch:** `plan4-integration`, cut from `main` (at or after the commit that merges the PLAN-4 and PLAN-5 plans). Phase tags `plan4-phaseN`.
- **Subagent branches:** `p4-<id>` (e.g. `p4-1a-controls`). Experiments: `exp/p4-<name>`.
- **Tracker:** `dev-plans/PLAN-4-status.md`, with a baseline, a workstream table, a gate table per merge, gaps, decisions, questions and a dated log (PLAN-3-status format).
- **Fresh-worktree setup** (in every brief):
  - `npm ci`
  - `npm ci --prefix browser-tests`
  - `npm install --prefix sygnal-check`
  - `npm ci --prefix docs`
  - `npm ci --prefix create-sygnal-app`
  - `npm install --prefix examples/<each>`
  - `npm run build`
- **Worktree guard:** use `git -C <abs>` and `npm --prefix <abs>` only, with no `cd &&` chains and no shell variables in git or sed commands. Never a bare `git stash`. Subagents never merge or push the integration branch.
- **Install denials (G-153, D69):** if a subagent's `npm ci` is denied, it reports that, and the coordinator gates on merge.

### 1.2 Gates (every merge)
Run by the coordinator from the integration worktree:
- `npm run build:all`, then `npm test` (library vitest, `test:examples`, `test:types`, `test:browser`)
- `npm --prefix sygnal-check test`
- `node scripts/check-doc-samples.mjs`
- `node scripts/gen-error-docs.mjs --check`
- `npm --prefix docs run build`
- `node scripts/size-gate.mjs`: 42,300 B gated, with PLAN-4's own cap from §6
- `llms.txt` line count, and the byte-identical `docs/public/llms.txt`

Added by PLAN-4, from the phase where they become possible:

| Gate | From |
|---|---|
| **Tree-shaking:** unused behaviors, element commands, persist, timers, undo and (if adopted) custom elements add 0 B to kanban | Phase 2 |
| **a11y-clean:** examples, templates and doc samples produce no SYG7xx warnings (`check-doc-samples` runs the a11y rules) | 2-D |
| **SSR determinism:** `uid` values match between `renderToString` and client hydration | 2-A |
| **Browser tests** for element commands (focus, `showModal`, `close`), controls in a real browser, and View Transitions / custom elements if adopted | where adopted |

**Phase close:** `/code-review high` on the phase diff. Fix confirmed findings, then tag.

### 1.3 File ownership

Only the listed owner edits a hot file during a phase. Anyone else returns `QUESTION:` with the proposed diff.

| Area | Phase 0 | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|---|---|---|---|---|---|
| `src/pragma/**` | 0-B (exp only) | **1-A** | — | P-2b if adopted | — |
| `src/cycle/dom/**` | — | **1-A** | — | 3-A (command resolution hook only) | — |
| `src/component.ts` | 0-B (exp only) | 1-A (only if needed for DOM-source tokens) | **2-A**, then **2-B** (serial) | 3-A, then 3-B, then 3-C (serial; small hooks), P-1b if adopted | — |
| `src/cycle/state/**` | — | — | **2-B** (`STATE.watch`) | — | — |
| `src/extra/testing.ts` | — | **1-A** (accept controls) | **2-C** (`t.actions`) | 3-A/3-B/3-C fakes (serial, after 2-C) | — |
| New modules (`src/extra/controls.ts`, `behaviors.ts`, `undo.ts`, `elementCommands.ts`, `persist.ts`, `timers.ts`) | — | 1-A (`controls.ts`) | 2-B (`behaviors.ts` runtime) | 3-D, 3-A, 3-B, 3-C (one module each) | — |
| `src/extra/devtools.ts`, `devtools/**` | — | — | — | **3-E** | — |
| `src/vite/plugin.ts` | — | — | — | 3-E (if needed); P-4 (exp) | — |
| `src/index.ts` (exports) | coordinator | coordinator applies requested export lines | coordinator | coordinator | — |
| `src/index.d.ts`, `type-tests/**` | — | **1-T** | **2-T** | **3-T** | — |
| `src/extra/diagnostics/codes.ts`, `sygnal-check/src/explanations.js` | — | each WS adds only its **pre-allocated** codes (§5); the coordinator regenerates `explanations.json` and `errors.md` after each merge | same | same | — |
| `src/extra/diagnostics/checks/**` | — | 1-D | 2-A (SYG222) | 3-A/3-B/3-C (own codes, serial) | — |
| `sygnal-check/**` | — | **1-D** | **2-D** (`src/rules/a11y/**`, shared rule plumbing) | **3-D**, then **3-K** (serial) | 4-C (`--fix` runs only) |
| `examples/**`, `create-sygnal-app/**` templates | — | — | 2-D (a11y fixes only) | — | **4-C** |
| `docs/**`, `llms.txt`, `skills/**`, template `AGENTS.md` | — | — | — | — | **4-A** (agent docs), **4-B** (site), split by path |
| `evals/**` | **0-C** | 1-E (coordinator-prepared commands) | — | — | 4-E |
| `benchmarks/**` (new), `browser-tests/perf/**` | — | — | **P-3** | — | — |
| `CHANGELOG.md`, `ROADMAP.md`, `dev-plans/**` | coordinator | coordinator | coordinator | coordinator | 4-D |

### 1.4 Brief template additions (on top of PLAN-1 §1.5)
- Read: CLAUDE.md, this plan's section for the workstream, the referenced report section, and the experiment file listed for the item.
- **Failing-first:** add the tests before the implementation, and report how many failed first.
- **Recipes run verbatim:** every new docs snippet runs in a scratch test before it is committed.
- **Size:** report the gated kanban size before and after, and each new module's "bytes added to an app" (D87 method).
- **Agent-facing sync rule:** an API or behaviour change updates `llms.txt`, SKILL.md, the template `AGENTS.md` files and the docs in the same workstream, unless the workstream's brief defers that to Phase 4.
- **Words:** use "reply actions" (D82), "route" only for the router, and "control" only for CT-1 element tokens. Don't use "control" in other senses (write "form field", not "form control").

### 1.5 Escalation
- **The coordinator decides alone:** naming internal to a module, test organisation, diagnostic wording, splitting or merging workstreams, and anything this plan already decides.
- **Ask the user:**
  - every P4-Q in §11 that is still open;
  - any canonical-form change, including the CT-1 decision after 1-E;
  - new runtime dependencies;
  - breaking changes beyond those listed in §2;
  - budget increases;
  - the decision records for the prototype items (P-1…P-4);
  - eval spending beyond §7;
  - anything that changes default behaviour of existing apps, including new production console output.

### 1.6 Evals
Eval trials run **only from the user's Terminal panel**: the coordinator prepares the commands, and the G-127 process guard stays on. Before any eval, re-sync the installed skill (D35). Isolated posture (3-H).

---

## 2. Target design

Each item lists its API, semantics, tests and acceptance criteria. The rationale and prior art are in the reports, so they aren't repeated here.

### CT-1 Controls: view–intent linking by identifier (P1, foundation)

Report: view-intent-linking, option D and the follow-up.

```jsx
import { controls } from 'sygnal'
const { Draft, Add } = controls({ Draft: 'input', Add: 'button' })

function AddTodo({ state }) {
  return <div><Draft className="field" value={state.draft} /><Add>Add</Add></div>
}
AddTodo.intent = ({ DOM }) => ({ DRAFT: DOM.input(Draft).value(), ADD: DOM.click(Add) })
// tests
t.simulateEvent(Add, 'click'); t.query(Draft).value
```

**Semantics:**
- `controls(spec)` returns one **control** per key. A control is a JSX tag that renders the named intrinsic element with every prop passed through, plus a marker attribute `data-control="<Key>"` (name per P4-Q3). The marker is the only thing it adds.
  - A control is not a component: no instantiation, no state, no isolation scope, no wrapper.
  - The pragma recognises it through a dedicated flag. It doesn't borrow the fragment path, as the X5 prototype did.
  - **Control specs (D101, for PLAN-5 widgets):** a spec value is either an intrinsic tag string or a **spec object** `{ kind, vnode(props, children), commands? }` (§2 "Control spec contract"). For a spec object, the pragma calls `spec.vnode(props, children)` and stamps `data-control` on the vnode it returns, the same way as for a tag. The stamp merges into `data.attrs` and keeps the returned vnode's `key`, `hook` and other data. PLAN-4 ships no spec kind except the tag string. Its tests use a test-only spec object to prove the hook.
- Anywhere a selector string is accepted today, a control is accepted:
  - `DOM.select(control)` and every `DOM.<event>(control)` shorthand;
  - enriched streams;
  - `DOM.select('document').select(control)`;
  - `simulateEvent`, `query` and `queryAll`;
  - the GS-2 element commands.

  It resolves to `[data-control="<Key>"]`. Acceptance is **kind-blind**: every control resolves this way whatever its spec. The `MainDOMSource.select` string check (`"expects the argument to be a string"`) accepts controls.
- **Isolation is unchanged.** A control used in a Collection item matches only that item's element. A parent that listens to a child's control never fires: SYG104, now detected exactly by identifier.
- **Scoping inside a Collection in tests:** `t.simulateEvent(Done, 'click', { within: '[data-id="2"]' })`. Template strings (`` `li:nth-child(2) ${Done}` ``) also work, because a control stringifies to its selector.
- **Names:** the keys are the names, so the HTML is deterministic (SSR and hydration safe) and readable. Two `controls()` calls in one file may not reuse a key; that's a checker error.
- **`DOM.click(SomeComponent)`** (a component where a control or selector is expected) is **SYG124**, an error. The message names both fixes: `CHILD.select` + `PARENT`, or a parent-owned control around the child.
- A control given `.intent`, `.model` or `.initialState` is **SYG125** (error): "controls are elements, not components".
- **Class selectors keep working.** Their status after the eval is P4-D (§4, 1-E). If controls become canonical, strict **SYG510** flags a single-class intent selector that targets an element in the component's own view ("use a control"). `document`/`body` selectors and attribute or structural selectors stay canonical where a control can't express them.

**Types:**
- `controls({ Draft: 'input' })` gives `Draft` the props of `JSX.IntrinsicElements['input']`.
- `DOM.input(Draft)` returns an event stream typed for `HTMLInputElement` events, and `.value()` is typed.
- `t.query(Draft)` returns `HTMLInputElement`.
- **Type hook (D101):** for a spec object, `controls()` takes the props type from the spec (a phantom `__props?: P` field on `ControlSpec<P>`), not from `JSX.IntrinsicElements`. A type test covers a test-only spec.

**Checker (sygnal-check):**
- resolves control identifiers in the same file and through relative imports;
- SYG110 is extended: a control the intent listens to but the view never renders;
- **SYG126** (info): rendered, never listened to;
- SYG104 by identifier;
- SYG124 and SYG125;
- duplicate keys;
- the graph and `inspect()` list controls next to selectors;
- **`--fix`** converts a single-class selector whose class is on exactly one element in the component's view into a control. It keeps `className` when CSS uses the class or when `--keep-classes` is set (needed by the eval starters, §7).

**Acceptance:**
- X5's scenario passes in the mock DOM, the real DOM and a real browser, with no `.sel` workaround.
- A Collection with per-item controls, a nested child using the same key names, SSR plus hydration, and HMR all work.
- Every diagnostic above has failing-first tests.
- `--fix` converts kanban and todomvc with no behaviour change: their tests pass unchanged.
- A test-only spec object renders through `vnode()`, gets the stamp, keeps its hooks, and is accepted by `DOM.*`, `simulateEvent`, `query` and element commands.
- Core cost is within the 0-B estimate (target ≤ 120 B gated).

**Control spec contract** (frozen for 1-A, 1-T and 3-A; PLAN-5 builds `defineWidget` on it):

```ts
type ControlSpec<P = any> =
  | keyof JSX.IntrinsicElements                     // 'button', 'input', 'wa-rating', ...
  | {
      kind: string                                 // 'widget' (PLAN-5); free-form, shown in inspect() and diagnostics
      vnode(props: P, children: unknown[], h: typeof createElement): VNode   // must return one element vnode; h is the pragma's own createElement (D116)
      commands?: Record<string, (elm: Element, options: Record<string, unknown>) => void>
      __props?: P                                  // phantom, types only
    }
```

- A `vnode()` that returns anything but one element vnode is SYG125, extended to cover it (error, names the control key).
- The control copies `key` onto the returned vnode when it has none (D116). Spec authors build vnodes with the `h` argument, never with an imported `createElement` (that would duplicate the pragma under the automatic JSX runtime).
- `commands` is read only by element commands (GS-2). Each handler gets the resolved host element and the command's options. The spec maps the element to its own instance.

### GS-1 Reusable behaviors (P1)

Report: gap study G-1.

```js
// behaviors/pager.js
export const pager = defineBehavior({
  initialState: { page: 0, pageSize: 20 },
  intent: ({ DOM }, { next, prev }) => ({ NEXT: DOM.click(next), PREV: DOM.click(prev) }),   // the host passes its controls
  model: { NEXT: (p) => ({ ...p, page: p.page + 1 }), PREV: (p) => (p.page === 0 ? ABORT : { ...p, page: p.page - 1 }) },
  calculated: { offset: (p) => p.page * p.pageSize },
})
// host
const { Older, Newer } = controls({ Older: 'button', Newer: 'button' })
TaskList.uses = { pager: pager({ pageSize: 10, next: Newer, prev: Older }) }   // state.pager; actions 'pager.NEXT'
```

**Semantics:**
- A behavior is `{ initialState, intent, model, calculated }` operating on `state[key]` (a lens). Its reducers see the slice, its calculated fields are computed on the slice, and `ABORT` works.
- Its intent gets the host's sources (including CHILD, EVENTS and drivers) plus the options passed at `uses` time. Controls are the natural options, which fixes the selector problem.
- **Action names are namespaced** `<key>.<ACTION>` (separator per P4-Q5).
- A host may also handle a behavior action in its own model: `'pager.NEXT': { EFFECT: … }` merges as a second sink entry.
- Behaviors may emit EVENTS and PARENT like any entry.
- **Merge:** at instantiation (static `uses`, P4-Q4), or at definition time (`withBehaviors(C, uses)`, 0 B). Collisions are SYG127 (error):
  - a behavior's `initialState` key already in the host's `initialState`;
  - two behaviors under one key.

**First-party behaviors** in this plan: `pager`, `selection` (single and multi, select-all), and `undoable` (GS-8). Each one is strict-clean, a11y-clean, tested and documented.

**Checker:**
- resolves `uses` entries to `defineBehavior` calls (same file and relative imports);
- SYG101, SYG102, SYG110 and SYG104 see the merged actions and controls;
- the graph shows behavior-owned actions;
- unresolvable behaviors (from packages) are treated as opaque, with no false positives.

**Acceptance:**
- X3 rewritten on the real API.
- Two components share `pager`, one of them inside a Collection item.
- A behavior that emits PARENT and EVENTS.
- A host overriding a behavior action's sink.
- The checker catches a typo in a behavior's control option.
- Unused `defineBehavior` adds 0 B.

### GS-2 Element commands (P1)

Report: gap study G-2.

```js
Signup.model = {
  SUBMIT: { STATE: (s) => ({ ...s, errors: validate(s) }), ELEMENT: (s) => (validate(s).email ? { focus: Email } : ABORT) },
  OPEN_HELP: { ELEMENT: { showModal: HelpDialog } },
}
Signup.intent = ({ DOM }) => ({ CLOSE_HELP: DOM.close(HelpDialog) })
```

**Semantics:**
- A sink (name per P4-Q6, `ELEMENT` by default) takes `{ <method>: control | selector, ...options }`. Supported methods:
  - `focus` (`{ preventScroll }`), `blur`, `select`;
  - `scrollIntoView` (`{ block, inline, behavior }`);
  - `showModal`, `show`, `close` (`{ returnValue }`);
  - `showPopover`, `hidePopover`, `togglePopover`;
  - `click` (programmatic, for file inputs).
- An array sends several commands. The **first key** of a command object is the method; the other keys are its options (D118). `close` passes `returnValue` as its argument.
- **Scoping:** the target is resolved inside the **sending instance's** DOM scope, using the PLAN-3 sender tag and that instance's isolated DOM source. Commands run **after the next patch** of that instance, so they reach elements rendered by the same action.
- **Spec commands (D102):** when the target is a control whose spec object declares `commands`, the method is looked up there first, so `ELEMENT: { open: DueDate }` calls `spec.commands.open(hostElement, options)`. A spec command overrides a native method of the same name. Only then does a native element method apply.
- No match is SYG640 (warn, dev). An unknown method is SYG641 (error). SYG641 is raised only after both lookups fail. It names the control's declared commands when it has any.
- SSR: no-op.

**Built in or registered** (P4-Q6): decided with 0-B's measured bytes. A registered driver needs `run(App, { ELEMENT: makeElementDriver() })` and an automatic fake in `renderComponent`.

**Tests:**
- `t.commands('ELEMENT')` lists the commands sent, matched by content.
- With `dom: 'real'` the commands execute: `document.activeElement` moves, `dialog.open` flips.
- jsdom lacks `showModal`; the fake records it and sets `open`. Browser tests cover real behaviour.

**Checker:** the SYG102 trigger set includes the native events the commands cause (`close`, `toggle`), and the method names are checked statically.

**Acceptance:**
- Focus the first invalid field after submit.
- Scroll a new Collection row into view.
- Open and close a native `<dialog>` and observe its `close` event in intent.
- A popover.
- Each in the mock DOM, the real DOM and a browser.
- Unused module: 0 B, if registered.

### GS-3 Accessibility checks (P1)

Report: gap study G-3. A new lane, **7xx "a11y"**.

| Code | Rule | Static | Notes |
|---|---|---|---|
| SYG701 | A click listener (`DOM.click(x)`) on a non-interactive element (`div`, `span`, `li`, `p`, `img` …) without `role` + `tabIndex`; with controls, `controls({ X: 'div' })` listened for `click` | ✓ (cross intent/view) | Fix: render a `button`, or add `role="button" tabIndex={0}` and also handle `DOM.keydown(x)` |
| SYG702 | Form field (`input` except hidden, `select`, `textarea`) without an accessible label: no wrapping `<label>`, no `<label for>` matching its `id` (static ids and `uid()`), no `aria-label` or `aria-labelledby` | ✓ | |
| SYG703 | `<img>` without `alt` | ✓ | `alt=""` is allowed |
| SYG704 | `<a>` without `href` that is listened for clicks | ✓ | Use a button |
| SYG705 | `<button>` with no accessible name (icon-only, no text, no `aria-label`) | ✓ (literal children) | |
| SYG706 | Positive `tabIndex` | ✓ | |
| SYG707 | `aria-*` attribute that doesn't exist, or a `role` value that isn't valid | ✓ | |
| SYG708 | `<label for>` or `aria-describedby` pointing at an id that isn't rendered in the component | ✓ (literals, `uid('x')`) | |

- Severity: **warn** by default and **error** under `--strict`. On by default in `sygnal-check` and in the Vite plugin's dev checker. `// sygnal-ignore SYG70x` suppresses one.
- Explanations come with fixes.
- No runtime checks in this plan. A dev-entry runtime pass for dynamic markup is a follow-up only if the eval shows misses.

**Acceptance:**
- Every rule has positive and negative fixtures.
- 0 findings on examples, templates and doc samples after 2-D's fixes. This becomes a gate.
- The false-positive rate on the eval agent corpora (`p4-final2`, `p3-final`) is reviewed by hand and recorded. Target: < 5% of findings are false positives.

### GS-4 Returning the same object means "no change" (P1, breaking)

Report: gap study G-4.
- A **STATE** reducer (component or Collection item) that returns the identical object it received is treated as `ABORT`: no state emission, no render. Other sinks are unchanged.
- Strict **SYG502 is retired**: documented as "retired in 6.0" and never reported.
- **New SYG222** (dev entry, warn): a reducer returned the same object but mutated it in place, so the change is ignored. Detection: in dev, a shallow snapshot (keys and top-level values) taken before the reducer runs is compared when the reducer returns the same reference.
- Immer is documented as a recipe and not bundled.

**Acceptance:**
- X1 passes (a no-op `produce` adds 0 states).
- An in-place mutation plus `return state` gives SYG222 in dev and no re-render.
- Collection item no-op.
- Core ≤ 15 B.

### GS-5 State persistence (P1)

Report: gap study G-5.

```js
TodoApp.persist = { key: 'todo-app', pick: ['todos', 'filter'], version: 2, migrate: (old, from) => …, storage: 'local' }
```

**Semantics:**
- Root component only (SYG224 elsewhere).
- **Restore:** a synchronous read before `INITIALIZE`, merged into `initialState`, so the restore is part of the initial-state action. With SSR, the client restores in a built-in `RESTORE` action after hydration, so hydration matches the server HTML.
- **Writes:** the picked keys only, debounced (default 100 ms), plus a final flush on `pagehide`.
- **Options:**
  - `pick` or `omit` (top-level keys);
  - `version` and `migrate`;
  - `storage`: `'local'`, `'session'` or a synchronous `{ getItem, setItem, removeItem }` adapter (async adapters are out of scope);
  - `sync: true` applies writes from other tabs through `RESTORE`;
  - `debounceMs`.
- **Clearing:** a `{ clear: true }` command on a sink (P4-Q7 decides which sink) removes the stored copy.
- Failures (quota, JSON parse, `migrate` throws) are SYG642 (warn). The app continues on `initialState`.
- Form: a plain-object static (core cost) or a helper value `persist({…})` (0 B), per P4-Q7 with 0-B's numbers.

**Tests:**
- `renderComponent(App, { storage: { 'todo-app': {...} } })` seeds the store;
- `t.storage('todo-app')` reads it;
- writes are flushed by `t.settle()`.

**Checker:** SYG223 for a `pick` key that isn't in `initialState`; SYG224.

**Acceptance:**
- Restore and save.
- `migrate` from v1.
- `sync` between two `renderComponent` instances that share a fake storage.
- SSR hydration without a mismatch.
- Unused: 0 B.

### GS-6 `STATE.watch` (P2)

Report: gap study G-6.
- `STATE.watch(selector, { immediate = false })` returns a stream of `selector(state)` values, emitted only when the value changes structurally (`objIsEqual`).
- In a Collection item, `state` is the item's slice.
- It ends on dispose.
- The canonical form for "when X changes, do Y". It replaces hand-rolled `STATE.stream.map(...).compose(dropRepeats())`.

**Acceptance:**
- An autosave recipe (watch + debounce + reply actions) passes against the HTTP fake.
- `immediate`.
- Object selectors don't re-emit on equal content.
- Core ≤ 70 B.

### GS-7 Timers (P2)

Report: gap study G-7.

```js
Stopwatch.timers = (state) => ({ tick: state.running && { every: 100, action: 'TICK' }, done: state.armed && { after: 5000, action: 'EXPIRE' }, frame: state.animating && { frame: 'FRAME' } })
```

- A `__sygnalStatic` declaration, diffed by name: new starts, falsy or removed stops, changed spec restarts.
- `every` uses drift-free scheduling. `frame` data is `{ t, dt }`.
- Pauses in hidden Switchable pages (existing mechanism), with an optional `background: true`.
- Nothing runs during SSR.
- Built-in or registered timer driver per P4-Q8. If registered, a component that declares `timers` with no driver gets **SYG643** (warn, dev), which also closes PLAN-3's "connections without a driver report nothing" gap.
- The shape is shared with PLAN-5 B-3.

**Tests:** fake timers drive it (`vi.advanceTimersByTimeAsync`), and `t.timers()` lists the active ones.

**Acceptance:**
- Stopwatch: start, pause, resume, reset, no drift over 1,000 ticks.
- Countdown `after`.
- Frame.
- Hidden-page pause.
- Dispose stops everything.
- Unused: 0 B.

### GS-8 Undo/redo (P2)

Report: gap study G-8.
- `undoable(model, { key, limit = 100, track, coalesceMs, resetOn })` wraps STATE reducers so that `state[key]` snapshots go into `state.history = { past, future }`, and adds `UNDO` and `REDO`.
- `coalesceMs` merges rapid changes, such as typing.
- `resetOn: ['LOAD']` clears the history.
- Also shipped as a behavior (`uses: { history: undo({ key: 'doc' }) }`) after GS-1, with `canUndo` and `canRedo` calculated.
- SYG226 for a `track` or `resetOn` name with no model entry.

**Acceptance:** X4 on the real API; coalescing; limit; reset; combined with persist (GS-5) without persisting history unless picked.

### GS-9 `uid` (P2)

Report: gap study G-9.
- A view prop: `uid(name?)` returns a stable string, unique per component instance.
- Derived from the instance's position: the parent's uid, the child index or key, and the Collection item key. Never from a global counter, which keeps SSR deterministic.
- Also on the reducer's `props` argument.
- `uid` becomes a reserved prop (SYG106 list). Breaking only for a parent that passes a `uid` prop.

**Acceptance:**
- Unique across Collection items and nested children.
- Stable across re-renders and key moves.
- Equal between `renderToString` and hydration.
- SYG702 and SYG708 accept `uid()` references.
- Core ≤ 50 B.

### GS-10 Action log and session export (P2)

Report: gap study G-10.
- **`t.actions`** is a live array of `{ type, data, component, instance, sinks, cause, at }`:
  - `cause` is one of `'intent' | 'next' | 'reply' | 'built-in' | 'simulateAction' | 'behavior'`;
  - `sinks` lists the sinks that produced a value (not ABORT);
  - `at` is ms since render;
  - behavior actions carry their namespaced type.

  Also listed in `inspect()`.
- **Stretch:** `t.explain(pred)` returns the first action whose resulting state matches `pred`, with its reducer source location if available.
- **DevTools** (`sygnal/devtools` plus the extension):
  - an action-log panel;
  - "Copy as test", which emits a `renderComponent` test: the initial state, a `simulateAction` sequence, and a final-state assertion. A test that is pasted unchanged must pass.
- **Stretch:** a dev-only Redux DevTools bridge (`sygnal({ devtools: { redux: true } })`).

**Acceptance:** `t.actions` covers every cause above. A copied test passes for 3 example sessions (kanban, todomvc, a reply-action form). 0 B in production.

### GS-11 App-level error hook (P2)

Report: gap study G-11.
- `run(App, drivers, { onError: (error, { componentName, action, phase }) => … })`, where `phase` is one of `'view' | 'reducer' | 'effect' | 'driver' | 'instantiate' | 'widget'`. `'widget'` is reserved for PLAN-5's `defineWidget` (D105); nothing in PLAN-4 emits it. It is reporting only, called after the component's `onError` boundary has chosen a fallback.
- It also works with the Vike and Astro wrappers and `renderToString`, and as a `renderComponent` option.
- An exception thrown inside `onError` itself is swallowed, with one console error.

**Acceptance:** each phase is reported once per error, in production mode (diagnostics off); core ≤ 40 B.

### GS-12 View Transitions (prototype, then decide)

Report: gap study G-12.
- **P-1 spike** (`exp/p4-view-transitions`):
  - a `viewTransitions: ['MOVE']` static that wraps the patch caused by those actions in `document.startViewTransition`;
  - a router option `viewTransitions: true`;
  - `prefers-reduced-motion` honoured;
  - unsupported browsers fall back silently.

  It measures core bytes and compares visually against PLAN-5 A-1 (FLIP) on a kanban move.
- **Decision record** → user (adopt, adapt or drop; effect on A-1).
- If adopted, **P-1b** implements it with browser tests.

### GS-13 Custom-element output (prototype, then decide)

Report: gap study G-13.
- **Name (D104):** `defineElement` (a Sygnal component published as a custom element) keeps its name next to PLAN-5's `defineWidget` (a foreign widget brought into Sygnal). If adopted, PLAN-5 owns the shared "Web components" guide (S-11).
- **P-2 spike** (`exp/p4-elements`):
  - `sygnal/element` `defineElement(tag, Component, { props, events: { PARENT: 'task-picked' }, shadow, styles })`;
  - property/attribute → state;
  - PARENT → `CustomEvent`;
  - disconnect disposes;
  - HMR.
- **Bar:** ≤ 60 lines; works inside a plain HTML page and inside a React 19 app.
- **Decision record** → user. If adopted, **P-2b** implements it as a separate entry (0 B core).

### GS-14 Testing Library (docs plus eval)

Report: gap study G-14. Depends on the B-0 fix.
- Docs: a "Testing with Testing Library" section (`within(t.container)`, `userEvent`, role queries) in `integration/testing.md`.
- The `t.screen`/`t.user` getters (optional peer dependencies) are built **only if** the 4-E eval A/B shows less test-authoring time. Otherwise the docs stand alone.

### GS-15 Live dev-server context for agents (decision record only)

Report: gap study G-15.
- **P-4:** a design note covering an endpoint `/__sygnal/inspect` (live graph, recent actions from GS-10, diagnostics) and an MCP tool in sygnal-check's server. It includes a cost estimate and an eval design that could justify it.
- Default outcome: deferred past 6.0 (E8 found MCP in agent docs didn't pay off). No code unless the user decides otherwise.

### GS-16 Performance baseline (measure)

Report: gap study G-16.
- **P-3:**
  - a `benchmarks/js-framework-benchmark/` implementation (keyed and non-keyed, following the benchmark's rules);
  - a `browser-tests/perf/` scenario: 1,000-row Collection, edit one row, swap two rows, append 1,000; median render ms over 10 runs.
- Record the numbers against React 19 and Vue 3.5 runs of the same scenario in the tracker.
- The record either proposes no change, or a scoped memoization follow-up (Elm-style `lazy` view or slice-equality skipping), with expected bytes. **Not gating.**

---

## 3. What changes for existing APIs (breaking changes and migration)

All entries go into CHANGELOG `[Unreleased]` (4-D).

| Change | Breaking? | Migration |
|---|---|---|
| A STATE reducer returning the same object is "no change" (GS-4) | **Yes** (behaviour) | Code that returned the same object to force a re-render: return a new object. In-place mutation: SYG222 in dev points to it. |
| SYG502 retired (GS-4) | Strict only | None; `return state` is now equivalent to `ABORT`. |
| `uid` reserved prop (GS-9) | **Yes** (rare) | Rename a `uid` prop passed by a parent. |
| Reserved statics `uses`, `persist`, `timers`, `viewTransitions` (if adopted) | **Yes** (rare) | Rename a same-named static used for something else. |
| `DOM.select` and shorthands accept controls; `simulateEvent`, `query` and `queryAll` accept controls (CT-1) | No | — |
| Class selectors become an alternative form; strict SYG510 (only if P4-D makes controls canonical) | Strict only | `sygnal-check --fix` converts them. |
| New lane 7xx (a11y) warnings in `sygnal-check` and the Vite dev checker | No (dev-time output only) | Fix or suppress. |
| New option `run(…, { onError })`, `t.actions`, `STATE.watch`, `controls`, `defineBehavior`, `undoable`, element commands, `persist` | No | — |

The PLAN-1 canonical forms doc (`dev-plans/PLAN-1-canonical-forms.md`) is updated in 4-D to match P4-D.

---

## 4. Phases and workstreams

The dependency order is listed at the end of this section.

### Phase 0: Setup (coordinator, with subagents for 0-B and 0-C)
- **0-A:**
  - create `plan4-integration` from `main`;
  - create the tracker;
  - baseline the size gate, `llms.txt`, SKILL.md and test counts;
  - settle §11 with the user, in batches;
  - post the §5 code reservations into the tracker, and note them in PLAN-5's tracker when it exists.
- **0-B spikes** (one subagent, `exp/p4-spikes`, throwaway). Measure gated core bytes for:
  1. CT-1 pragma marker plus DOM source and testing acceptance, including the D101 spec-object path and the D102 command lookup;
  2. GS-1 `uses` static merge vs `withBehaviors`;
  3. GS-2 built-in vs registered element commands;
  4. GS-5 plain-object static vs `persist()` helper;
  5. GS-7 built-in vs registered timers;
  6. GS-4, GS-6, GS-9 and GS-11 as a group.

  Output: a table in the tracker that feeds P4-Q2, Q4, Q6, Q7 and Q8.
- **0-C eval prep** (subagent, owns `evals/**`):
  - the new **`ergo` tier** (tasks 26–29, §7), both arms, with `verify.mjs` and mutants;
  - the CT-1 A/B variant: the controls skill, plus starters converted with `--fix --keep-classes` from 1-D. The variant is assembled after 1-D merges.
- **0-D (done before PLAN-4 started):** the bug fixes merged to `main` as #12. 0-A only re-runs experiments X2, X2b, X7 and X8 on `plan4-integration` to confirm they pass.
- **0-E (user's terminal):** run the `ergo` tier baseline on the PLAN-3 build, both arms.

### Phase 1: Controls
- **1-A Controls core:** owns `src/pragma/**`, `src/cycle/dom/**`, `src/extra/controls.ts` and `src/extra/testing.ts` (control acceptance and `{ within }` only). It delivers:
  - the control marker;
  - token acceptance everywhere listed in CT-1;
  - SYG124 and SYG125 at runtime (dev entry where possible);
  - browser tests.
  - Leave room in the control marker for other kinds of control (HANDOFF S-1: PLAN-5 widgets), for example a `kind` field. No widget code in this plan.
- **1-T Types:** `controls()` inference, typed streams and `query`, and type tests. It codes against the CT-1 API as written, in parallel with 1-A.
- **1-D Checker:** control resolution; SYG110, SYG104 and SYG126 by identifier; SYG124 and SYG125 statically; duplicate keys; graph; `--fix` with `--keep-classes`; explanations.
- **1-E Controls A/B eval (user's terminal):** §7. **P4-D:** canonical (SYG510 enabled, Phase 4 migration) or alternative form (documented on its own page, no SYG510). The user decides, with the numbers.

### Phase 2: Core runtime batch, checker and testing
- **2-A Core I** (owns `component.ts` first):
  - GS-4, plus SYG222 in the dev entry;
  - GS-11 `onError` (including `run.ts`, Vike/Astro wrappers, `renderToString`, `renderComponent` option);
  - GS-9 `uid` (including the SSR determinism test).
- **2-B Core II** (after 2-A; owns `component.ts`, `src/cycle/state/**`, `behaviors.ts`):
  - GS-6 `STATE.watch`;
  - GS-1 runtime: `defineBehavior`, the `uses` merge or `withBehaviors` per P4-Q4, namespacing, SYG127.
- **2-C Testing** (owns `testing.ts`, parallel with 2-A/2-B): GS-10 `t.actions`, with `t.explain` as a stretch. Behavior and reply causes are added once 2-B merges, by the coordinator or a follow-up commit.
- **2-D a11y checker** (owns `sygnal-check/**` for Phase 2, parallel):
  - GS-3 rules SYG701–708 and explanations;
  - fixes to examples and templates for a11y findings (the only edits to `examples/**` before Phase 4);
  - `check-doc-samples` runs the a11y rules.
- **2-T Types** for GS-4, GS-6, GS-9, GS-10, GS-11 and GS-1 runtime, in parallel against the spec.
- **Prototype track** (parallel from Phase 2; `exp/*` branches; decision records to the user):
  - **P-1** View Transitions;
  - **P-2** custom elements;
  - **P-3** performance baseline (owns `benchmarks/**`, `browser-tests/perf/**`; numbers recorded, merged as a non-gating suite);
  - **P-4** dev-context design note.

### Phase 3: Declarations, helpers, behaviors, DevTools
- **3-A Element commands (GS-2):** `elementCommands.ts`, a small `component.ts`/DOM hook (serial with 3-B and 3-C), fake plus `t.commands`, SYG640/641, browser tests.
- **3-B Persist (GS-5):** `persist.ts`, `RESTORE`, fake storage plus `t.storage`, SYG223/224/642, SSR hydration test.
- **3-C Timers (GS-7):** `timers.ts` plus the driver or built-in per P4-Q8, `t.timers`, SYG643.
- **3-D Behaviors complete (GS-1 + GS-8):**
  - owns `sygnal-check/**` in Phase 3, first;
  - checker resolution of `uses`;
  - first-party `pager`, `selection` and `undoable` (helper plus behavior);
  - SYG226;
  - recipes in scratch tests.
- **3-K Checker batch** (after 3-D): checker support for GS-2, GS-5 and GS-7 (SYG102 triggers for command-caused events and timer actions, SYG223/224 statically, `timers` and `persist` statics in the graph).
- **3-E DevTools (GS-10):** action-log panel, "Copy as test", Redux bridge (stretch).
- **3-T Types** for GS-2, GS-5, GS-7, GS-8 and GS-1 helpers.
- **P-1b / P-2b** implementations if the user adopts them. P-1b needs `component.ts`, so it is serialised after 3-C.

### Phase 4: Docs, agent context, migration, measure
- **4-A Agent-facing sync** (owns `llms.txt`, `docs/public/llms.txt`, `skills/sygnal-dev/**`, template `AGENTS.md` files). Within the §6 budgets, following the §6 ranking:
  - the CT-1 recipe replaces the class-selector guidance (if canonical);
  - GS-1, GS-2, GS-5 and GS-6 lines;
  - GS-4 removes the "never `return state`" rule;
  - the 7xx lane is added to the diagnostics line;
  - everything else goes to guide pages linked from one line;
  - re-sync the installed skill.
- **4-B Site docs:**
  - new pages: `guide/controls`, `guide/behaviors`, `guide/element-commands`, `guide/persistence`, `guide/timers`, `advanced/undo`, `guide/accessibility` (the 7xx rules);
  - updates: intent guide (controls and `STATE.watch`), testing (`t.actions`, Testing Library, controls in tests, `t.commands`/`t.storage`/`t.timers`), error reporting (`onError`), Immer recipe, `uid` in forms;
  - alternative-forms entries;
  - errors reference regenerated.
- **4-C Migration sweep** (only if CT-1 is canonical): `--fix` on every example, `create-sygnal-app` template and doc sample, followed by a manual review. Strict-clean plus a11y-clean gates. Examples' own suites pass unchanged.
- **4-D CHANGELOG `[Unreleased]`** (§3, plus additions), the ROADMAP entry, and the canonical-forms doc.
- **4-E Final eval (user's terminal):** §7. Learn time and peak context are checked against PLAN-3's 4-C run (D76 rule: more than about 10% worse → trim before release).
- **4-F REPORT-v4.md** (PLAN-3 writes REPORT-v3).

**Dependency order:**
1. 0-A → 0-B (spikes) → §11 budget and form answers. 0-C runs alongside 0-B.
2. 1-A ∥ 1-T ∥ 1-D → 1-E (eval) → P4-D.
3. 2-A → 2-B (serial on `component.ts`), with 2-C ∥ 2-D ∥ 2-T beside them. P-1…P-4 run from Phase 2 on.
4. 3-D → 3-K (serial on sygnal-check), with 3-A → 3-B → 3-C (serial on `component.ts` hooks) ∥ 3-E ∥ 3-T beside them.
5. P-1b and P-2b if adopted.
6. 4-A ∥ 4-B ∥ 4-C (path-split) → 4-D → 4-E → 4-F.

Phase 2 may start before 1-E's result, because nothing in Phase 2 depends on the canonical decision. Phase 4's migration waits for it.

---

## 5. Diagnostic code reservations

Pre-allocated so that parallel workstreams don't collide (the PLAN-3 SYG620 clash). PLAN-5 must not use these.

| Range | Codes | Use |
|---|---|---|
| 1xx wiring | **SYG124** component used as a control or selector (error) · **SYG125** control given `.intent`/`.model`/`.initialState` (error) · **SYG126** control rendered but never listened to (info) · **SYG127** behavior collision or unresolvable `uses` entry (error) · SYG128–129 spare | CT-1, GS-1 |
| 1xx extended | SYG104 and SYG110 gain control identifiers | CT-1 |
| 2xx model/state | **SYG222** same object returned after in-place mutation (warn, dev) · **SYG223** `persist.pick`/`omit` key not in `initialState` · **SYG224** `persist` on a non-root component · **SYG225** spare · **SYG226** `undoable` `track`/`resetOn` names an unknown action | GS-4, GS-5, GS-8 |
| 4xx components | **SYG422** invalid `timers` spec (non-positive interval, missing action) · SYG423 spare | GS-7 |
| 5xx strict | **SYG502** retired (documented as such) · **SYG510** single-class intent selector where a control would do (only if P4-D makes controls canonical) | GS-4, CT-1 |
| 6xx drivers/setup | **SYG640** element command target not found (warn, dev) · **SYG641** unknown element command (error) · **SYG642** persist read/write/migrate failure (warn) · **SYG643** `timers` declared with no timer driver (warn, dev; if registered) · SYG644–649 spare | GS-2, GS-5, GS-7 |
| 7xx a11y (new lane) | **SYG701–SYG708** (§2 GS-3) · SYG709–719 spare | GS-3 |

**PLAN-5's reservations**, which PLAN-4 must not use: SYG140–149, 230–239, 430–439, 660–669 and 720–729 (`PLAN-5.md` §4).

Per CLAUDE.md, each new code goes into both tables in `codes.ts` (non-core codes in `DEV_CODE_SEVERITY`, G-159), gets an explanation, and is followed by a regeneration of `explanations.json` and the errors doc. The new 7xx lane also updates the lane list in `codes.ts`, `llms.txt` §6 and `guide/diagnostics`.

---

## 6. Budgets (P4-Q2)

| Budget | Cap | Left after PLAN-3 | PLAN-4 estimate | PLAN-5 needs | Proposal |
|---|---|---|---|---|---|
| Core, gated kanban | 42,300 B | 1,897 B | 400–1,100 B (CT-1 ~120, GS-4 ~15, GS-6 ~70, GS-9 ~50, GS-11 ~40, GS-1 static ~100, GS-2/5/7 0–600 depending on built-in vs registered, GS-12 ~120 if adopted) | designs at 0 B; may ask for reserve | **PLAN-4 cap 900 B**, final numbers from 0-B; about 1 KB left for PLAN-5 |
| `llms.txt` | 300 lines | 17 | ≈ +10 net (CT-1 ≈ 0 net if canonical, GS-1 +4, GS-2 +2, GS-5 +1, GS-6 +1, GS-10 +1, 7xx +1, GS-4 −1) | ≈ 13 (F-1 8, W-1 5) | **Raise the cap to 315**, conditional on the learn-time check, **plus a trim target of −5 lines in 4-A** |
| SKILL.md | 36 KB | 1,657 B | ≈ 2.5 KB | ≥ 1 KB | **Raise the cap to 38 KB**, same condition |
| Agent cost | vs PLAN-3 4-C | — | — | — | Learn time or peak context more than about 10% worse → trim before release (D76 rule) |

**Agent-doc ranking for PLAN-4:**

| Rank | Item | Agent context |
|---|---|---|
| 1 | CT-1 (if canonical) | Replaces the selector recipe and wiring rules in §2–§5 of `llms.txt` |
| 2 | GS-1 behaviors | ≈ 4 lines |
| 3 | GS-2 element commands, GS-6 `STATE.watch`, GS-5 persist | 1–2 lines each |
| 4 | GS-10 `t.actions`, 7xx lane | 1 line each |
| 5 | Everything else | Guide pages only, reached from one "more" line |

---

## 7. Eval plan

**New `ergo` tier** (0-C; both arms; hidden tests; `verify.mjs` plus mutants):

| Task | Exercises | Hidden tests check |
|---|---|---|
| 26 autosave-draft | GS-6 watch + debounce + reply action, GS-5 persist | Debounced save request, status text, draft restored after "reload" (a second render with the same storage) |
| 27 undo-editor | GS-8 (GS-1 if canonical), Escape/Ctrl+Z on `document` | Undo/redo sequence, disabled buttons, coalesced typing |
| 28 stopwatch | GS-7 | Start/pause/resume/reset/lap under fake timers, no ticks after pause or unmount |
| 29 accessible-signup | GS-2 focus + native dialog, GS-9 ids, GS-3 | First invalid field focused on submit, `aria-describedby` wiring, confirm `<dialog>` opens/closes, labelled fields |

The React arm uses plain React plus whatever the agent picks.

**1-E controls A/B:**
- **Tasks:** 01, 02, 06, 07, 08, 09, 12, 16 plus TS 18–21. 12 tasks × 5 trials × 2 variants × Opus, plus the same on Haiku.
- **Variants:**
  - A: the current skill and starters;
  - B: the controls skill and starters converted with `--fix --keep-classes` (hidden tests select by class, so classes stay).
- **Measures:** wall time, iterations, failed runs, learn time, peak context, wiring-class failures (SYG104/110/124 hits and hidden-test failures caused by wiring), and Haiku pass rate.
- **Bar for canonical** (P4-D, user's call): all of
  - Opus matched wall no worse than +5%;
  - Haiku pass rate not lower;
  - wiring failures not higher;
  - learn time not higher by more than 1 s.

  If the result is mixed, controls become an alternative form.

**4-E final:**
- Sygnal all tiers, `net` and `ergo` on Opus and Haiku; the React arm for `ergo`.
- A GS-14 A/B on test-authoring time (default docs vs Testing Library docs), on 3 tasks.
- Learn time and context checked against PLAN-3's 4-C run.

**Success bars:**
- `ergo` Opus 20/20;
- Sygnal–React gap on `ergo` at most the tier-2 gap in PLAN-3's 4-C;
- Haiku `ergo` pass rate ≥ React Haiku;
- no regression on existing tiers beyond noise;
- 0 SYG7xx warnings in Opus final code on task 29 (measured, not gating).

**Rough spend** (API-equivalent, on the user's subscription; PLAN-2/3 rates):
- 0-E baseline about $15;
- 1-E about $55;
- 4-E about $110.

Total about $180. Anything beyond that is asked first.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Controls look like components, so agents give them state or listen to child controls from a parent | SYG124/125, SYG104 by identifier, docs say "controls are elements"; the 1-E eval measures it |
| A controls migration in the middle of the release churns every doc and example | Canonical status is eval-gated (1-E); `--fix` does the mechanical part; 4-C runs once, after all features land |
| Behaviors become a blind spot for the checker | Checker resolution is an acceptance criterion (3-D), not a follow-up; unresolvable packages are opaque, with no false positives |
| GS-4 hides in-place mutation | SYG222 in dev, a CHANGELOG migration entry, and the Immer recipe for people who want mutation |
| a11y rules are noisy, and agents spend time on warnings | Only high-precision rules; the false-positive review on agent corpora (< 5%); warn level outside strict |
| Budgets (core, `llms.txt`, SKILL) are too small for PLAN-5 plus PLAN-4 | 0-B measures before committing; P4-Q2; the 4-A trim target; learn-time check |
| Two plans touch the same hot files (`component.ts`, `testing.ts`, sygnal-check) | PLAN-4 then PLAN-5, one coordinator at a time (P4-Q1) |
| Prototype items grow into scope creep (View Transitions, custom elements, dev context) | Spike → decision record → user; nothing merges from `exp/*` without a decision |
| Eval noise (n = 5) hides small effects | Matched-task means, a Haiku arm for pass-rate signal, and the bars stated before the runs |

---

## 9. Definition of done

- CT-1, GS-1…GS-11 merged, with every gate green (including the new tree-shaking, a11y-clean and SSR-determinism gates).
- GS-12, GS-13 and GS-15 each have a decision record with the user's decision, and are implemented if adopted.
- GS-14 docs merged, and the getters built if the A/B justifies them.
- GS-16 numbers recorded.
- The P4-D canonical decision for controls is made and applied (migration done, or an alternative-forms page written).
- CHANGELOG `[Unreleased]` has every §3 entry. ROADMAP and the canonical-forms doc are updated.
- Agent docs are within the §6 budgets the user approved, and the 4-E learn-time check passes.
- REPORT-v4 is written. The tracker records the remaining budgets for PLAN-5.
- The release is still held (D56).

---

## 10. Out of scope

- Gap-study item G-17 (deferred loading triggers): **moved to PLAN-5 as B-4** (D103).
- Gap-study items G-18…G-20: scoped-styles docs, Storybook, props contracts.
- N-1…N-5: signals, a compiler, server components/resumability, two-way binding sugar, an optimistic primitive.
- `<button intent="X">`-style action tags (PLAN-1 §0).
- `DOM.click(Component)` (view-intent-linking follow-up; SYG124 replaces it).
- Async storage adapters for persist.
- A runtime a11y pass.
- Any memoization work, unless P-3's record proposes it and the user approves it as a separate item.

---

## 11. Decisions needed before code (recommendation first)

| # | Question | Recommendation |
|---|---|---|
| P4-Q1 | Order relative to PLAN-5 | **Decided by the user on 2026-10-02:** PLAN-4 (this plan) runs first, then PLAN-5 (ecosystem), rebased onto `plan4-integration`. The plans were renumbered to match the run order. |
| P4-Q2 | Budgets (§6) | PLAN-4 core cap 900 B; `llms.txt` cap 315 plus a −5 trim target; SKILL.md cap 38 KB; all subject to the learn-time check. Final numbers confirmed after 0-B. |
| P4-Q3 | Controls naming | Function `controls`; marker attribute `data-control`; capitalised keys. Alternatives: `elements`, `handles`. |
| P4-Q4 | Behaviors form | Static `uses` (reads like the other statics, checker-visible) if 0-B measures ≤ 100 B; otherwise `withBehaviors(C, …)` (0 B). |
| P4-Q5 | Behavior action separator | `pager.NEXT` (reads as a member); alternative `pager/NEXT` (Redux Toolkit style). |
| P4-Q6 | Element commands: sink name, and built in or registered | Name `ELEMENT`; **built in** if 0-B measures ≤ 300 B (agents forget driver registration, and SYG609 doesn't help a sink nobody reads); otherwise registered with an automatic fake. |
| P4-Q7 | Persist form, and where `{ clear }` goes | Plain-object static if 0-B measures ≤ 150 B, else a `persist({...})` helper. Clearing uses its own `PERSIST` sink (`PERSIST: { clear: true }`), not the element-commands sink. |
| P4-Q8 | Timers: built in or registered; shared shape with PLAN-5 B-3 | Registered `makeTimerDriver()` with SYG643 when missing, unless 0-B shows built-in ≤ 200 B; B-3 adopts the same declaration shape. |
| P4-Q9 | GS-4 breaking change and retiring SYG502 | Adopt both (major release; removes a rule from agent docs). |
| P4-Q10 | CT-1 canonical bar (§7) | As written. The user decides after 1-E with the numbers. |
| P4-Q11 | a11y default severity | warn by default and error under `--strict`; on in the Vite dev checker. |
| P4-Q12 | Eval spend (§7) | About $180 across 0-E, 1-E and 4-E; ask before more. |
| P4-Q13 | Bubbling semantics (from the bug-fix session) | **Settled in #12 (G-145):** native bubbling in both drivers. PLAN-4 docs (CT-1 wrapper pattern) follow it. |
